import { sniffMediaBytes } from "../media/ingest.js";
import { LIMITS, analyzeAudio } from "./project.js";

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
  { language = "", onStatus = () => {}, signal } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Cancelled", "AbortError"));
    const worker = new Worker("/workers/lyrical-transcription.worker.js", {
      type: "module",
    });
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error(
            "Transcription took too long on this device. Your song is safe; retry or paste lyrics.",
          ),
        ),
      10 * 60 * 1000,
    );
    const cancel = () =>
      finish(reject, new DOMException("Cancelled", "AbortError"));
    let settled = false;
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      fn(value);
    }
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "status") onStatus(data.message);
      else if (data.type === "complete") {
        console.info("Lyrical transcription language:", data.language, data.prompt);
        finish(resolve, data.chunks);
      }
      else if (data.type === "error") {
        console.warn(
          "Lyrical speech engine:",
          data.diagnostic || "No diagnostic available",
        );
        finish(reject, new Error(data.message));
      }
    };
    worker.onerror = () =>
      finish(
        reject,
        new Error(
          "The transcription engine could not start. Retry or paste your lyrics.",
        ),
      );
    const copy = mono.slice();
    worker.postMessage({ audio: copy, language }, [copy.buffer]);
  });
}
