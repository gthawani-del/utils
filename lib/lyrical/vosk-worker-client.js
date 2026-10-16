import { TRANSCRIPTION_RATE, WINDOW_SECONDS, CONTEXT_SECONDS } from "./transcription-windows.js";
import { voskLanguage } from "./transcription-policy.js";

export const VOSK_CHUNK_SAMPLES = 4096;
const MODEL_FILES = Object.freeze({
  en: "vosk-model-small-en-us-0.15.tar.gz",
  hi: "vosk-model-small-hi-0.22.tar.gz",
});

// Adapt the pinned Vosk worker protocol to the existing resumable coordinator.
// Use the actual engine worker directly: no nested workers, hidden queues or
// asynchronous terminate message. Cancellation destroys its WASM heap at once.
export function createVoskWorker() {
  const worker = new Worker("/assets/lyrical-vosk-engine.js");
  let stopped = false, loading = false, ready = false, serial = 0;
  let active = null;
  const client = {
    onmessage: null,
    onerror: null,
    postMessage(data) {
      if (stopped) return;
      if (data.type === "init") {
        if (loading || ready || !voskLanguage(data.language))
          throw new Error("Vosk is currently available for English and Hindi only.");
        loading = true;
        emit({ type: "status", message: "Preparing Vosk · first use downloads about 40–45 MB. Keep this tab open…" });
        if (stopped) return;
        worker.postMessage({ action: "set", key: "logLevel", value: -1 });
        // Same-origin model assets are prepared and checksum-verified at build.
        const modelUrl = new URL("/assets/models/" + MODEL_FILES[data.language], import.meta.url).href;
        worker.postMessage({ action: "load", modelUrl });
      } else if (data.type === "transcribe") {
        if (!ready || active || !(data.audio instanceof Float32Array) || !data.audio.length ||
            data.audio.length > (WINDOW_SECONDS + 2 * CONTEXT_SECONDS) * TRANSCRIPTION_RATE ||
            !Number.isInteger(data.index) || data.index < 0)
          throw new Error("Invalid Vosk audio section.");
        active = {
          id: "lyrical-" + ++serial, index: data.index, audio: data.audio,
          offset: 0, waiting: false, flushing: false, chunks: [],
        };
        worker.postMessage({ action: "create", recognizerId: active.id, sampleRate: TRANSCRIPTION_RATE });
        worker.postMessage({ action: "set", recognizerId: active.id, key: "words", value: true });
        sendNext();
      }
    },
    terminate() {
      if (stopped) return;
      stopped = true;
      active = null;
      worker.terminate();
      worker.onmessage = null;
      worker.onerror = null;
    },
  };
  function emit(data) {
    if (!stopped) client.onmessage?.({ data });
  }
  function fail(error) {
    emit({ type: "error", diagnostic: String(error?.message || error),
      message: "Vosk could not finish. Your completed sections are saved. Retry, or choose Standard." });
    client.terminate();
  }
  function sendNext() {
    if (!active || active.waiting) return;
    active.waiting = true;
    if (active.offset === active.audio.length) {
      active.flushing = true;
      worker.postMessage({ action: "retrieveFinalResult", recognizerId: active.id });
      return;
    }
    const end = Math.min(active.audio.length, active.offset + VOSK_CHUNK_SAMPLES);
    // Match vosk-browser's acceptWaveformFloat normalization. Allocate and
    // transfer only this chunk; never detach the saved song/window samples.
    const data = active.audio.slice(active.offset, end);
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) throw new Error("Invalid audio samples.");
      data[i] = Math.max(-1, Math.min(1, data[i])) * 0x8000;
    }
    active.offset = end;
    worker.postMessage({ action: "audioChunk", recognizerId: active.id,
      sampleRate: TRANSCRIPTION_RATE, data }, [data.buffer]);
  }
  worker.onmessage = ({ data }) => {
    if (stopped || !data) return;
    try {
      if (data.event === "error") {
        // A retired recognizer's cleanup cannot invalidate the next section.
        if (!data.recognizerId || data.recognizerId === active?.id) fail(data.error || "Engine error");
        return;
      }
      if (data.event === "load") {
        if (!loading) return;
        if (!data.result) throw new Error("Model failed to load.");
        loading = false;
        ready = true;
        emit({ type: "ready" });
        return;
      }
      if (!active || data.recognizerId !== active.id || !active.waiting ||
          (data.event !== "result" && data.event !== "partialresult")) return;
      if (active.flushing && data.event !== "result")
        throw new Error("Unexpected Vosk final response.");
      if (data.event === "result") {
        for (const word of data.result?.result || []) {
          if (typeof word.word !== "string" || !word.word.trim() || word.word.length > 500 ||
              !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
              word.start < 0 || word.end <= word.start) continue;
          active.chunks.push({ text: word.word, timestamp: [word.start, word.end] });
          if (active.chunks.length > 1000) throw new Error("Too many words in one section.");
        }
      }
      active.waiting = false;
      emit({ type: "progress" });
      if (stopped || !active) return;
      if (active.flushing) {
        const done = active;
        active = null;
        // FinalResult also emits 'result'. Wait for it (even an empty final
        // result) before removing the recognizer or completing this section.
        worker.postMessage({ action: "remove", recognizerId: done.id });
        emit({ type: "chunk", index: done.index, chunks: done.chunks });
      } else sendNext();
    } catch (error) { fail(error); }
  };
  worker.onerror = (event) => {
    if (stopped) return;
    client.onerror?.(event);
    client.terminate();
  };
  return client;
}
