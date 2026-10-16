import { sniffMediaBytes } from "../media/ingest.js";
import { LIMITS, analyzeAudio, timeLabel } from "./project.js";
import { transcriptionQuality, transcriptionDevice } from "./transcription-policy.js";
import {
  TRANSCRIPTION_RATE, WINDOWS_PER_WORKER, transcriptionWindows,
  appendWindowWords, resumeTranscription,
} from "./transcription-windows.js";

export async function decodeSong(file) {
  if (!file || !file.size || file.size > LIMITS.audioBytes)
    throw new Error("Choose an audio file up to 45 MB.");
  const signature = sniffMediaBytes(
    new Uint8Array(await file.slice(0, 4096).arrayBuffer()),
  );
  if (!signature.supported)
    throw new Error(
      "This file is not a supported audio recording. Try MP3, WAV, M4A, FLAC or OGG.",
    );
  // Inspect duration before decoding the complete recording into memory.
  const url = URL.createObjectURL(file);
  const player = document.createElement("audio");
  player.preload = "metadata";
  try {
    const duration = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Could not read this song. Try another audio format."),
          ),
        12000,
      );
      player.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(player.duration);
      };
      player.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Your browser cannot read this audio format. Try MP3 or WAV.",
          ),
        );
      };
      player.src = url;
    });
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > LIMITS.duration
    )
      throw new Error("Choose a song up to five minutes long.");
  } finally {
    player.removeAttribute("src");
    player.load();
    URL.revokeObjectURL(url);
  }
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context)
    throw new Error("Audio processing is unavailable in this browser.");
  const context = new Context({ sampleRate: 44100 });
  try {
    const audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
    if (
      audioBuffer.duration > LIMITS.duration ||
      audioBuffer.length * audioBuffer.numberOfChannels * 4 > 128 * 1024 * 1024
    )
      throw new Error(
        "This recording is too large to process safely. Try a shorter stereo recording.",
      );
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start();
    const mono = (await offline.startRendering()).getChannelData(0).slice();
    return { audioBuffer, mono, analysis: analyzeAudio(mono, 16000) };
  } finally {
    await context.close();
  }
}

export function transcribeSong(
  mono,
  {
    language = "",
    languageName = language,
    quality = "tiny",
    device = transcriptionDevice(),
    onStatus = () => {},
    onCheckpoint = () => {},
    checkpoint = null,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Cancelled", "AbortError"));
    if (!(mono instanceof Float32Array))
      return reject(new Error("Choose your song before generating lyrics."));
    const windows = transcriptionWindows(mono.length);
    const selectedQuality = transcriptionQuality(quality, device);
    const identity = { language, quality: selectedQuality, samples: mono.length };
    const resume = resumeTranscription(checkpoint, windows, identity);
    const chunks = resume.chunks;
    let nextWindow = resume.nextWindow;
    let worker = null;
    let timer = null;
    let settled = false;
    let inFlight = null;
    let workerWindows = 0;
    const cancel = () => finish(reject, new DOMException("Cancelled", "AbortError"));

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker?.terminate();
      worker = null;
      fn(value);
    }
    function armTimeout() {
      clearTimeout(timer);
      // This is a per-stage stall timeout, not a limit on the complete song.
      timer = setTimeout(() => finish(reject, new Error(
        "Transcription stopped responding. Your completed sections are saved. Retry to resume, or choose Standard on a phone.",
      )), 180_000);
    }
    function sendWindow() {
      const window = windows[nextWindow];
      inFlight = window.index;
      const audio = mono.slice(window.start, window.end);
      onStatus("Transcribing in " + languageName + " · section " +
        (nextWindow + 1) + " of " + windows.length + " · " +
        timeLabel(window.coreStart / TRANSCRIPTION_RATE) + " / " +
        timeLabel(mono.length / TRANSCRIPTION_RATE));
      armTimeout();
      worker.postMessage({ type: "transcribe", index: window.index, audio }, [audio.buffer]);
    }
    function startWorker() {
      workerWindows = 0;
      inFlight = null;
      const current = new Worker("/workers/lyrical-transcription.worker.js", { type: "module" });
      worker = current;
      armTimeout();
      current.onmessage = ({ data }) => {
        if (settled || worker !== current) return;
        try {
          if (data.type === "status") {
            armTimeout();
            // Recycled workers normally load from cache. Keep completed-song
            // progress visible rather than restarting the download counter.
            if (!nextWindow) onStatus(data.message);
          } else if (data.type === "ready") {
            if (inFlight === null) sendWindow();
          } else if (data.type === "chunk") {
            if (data.index !== inFlight || data.index !== nextWindow || !Array.isArray(data.chunks))
              throw new Error("Transcription returned an unexpected section. Retry to resume.");
            appendWindowWords(chunks, data.chunks, windows[nextWindow]);
            nextWindow++;
            inFlight = null;
            workerWindows++;
            onCheckpoint({ version: 1, ...identity, nextWindow, chunks: structuredClone(chunks) });
            if (nextWindow === windows.length) finish(resolve, chunks);
            else if (workerWindows >= WINDOWS_PER_WORKER) {
              // Destroy the WASM heap and retained inference state regularly.
              // Never overlap old/new model instances.
              current.terminate();
              worker = null;
              onStatus("Preparing the next section · " +
                timeLabel(windows[nextWindow].coreStart / TRANSCRIPTION_RATE) + " saved");
              startWorker();
            } else sendWindow();
          } else if (data.type === "error") {
            console.warn("Lyrical speech engine:", data.diagnostic || "No diagnostic available");
            finish(reject, new Error(data.message));
          }
        } catch (error) { finish(reject, error); }
      };
      current.onerror = () => {
        if (!settled && worker === current) finish(reject, new Error(
          "The speech engine stopped. Your completed sections are saved. Retry to resume with Standard quality.",
        ));
      };
      current.postMessage({ type: "init", language, quality: selectedQuality });
    }
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (nextWindow === windows.length) return finish(resolve, chunks);
      if (nextWindow) onStatus("Resuming from " + timeLabel(windows[nextWindow].coreStart / TRANSCRIPTION_RATE) + "…");
      startWorker();
    } catch (error) { finish(reject, error); }
  });
}
