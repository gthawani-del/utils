// The coordinator sends one bounded audio window at a time and periodically
// terminates this worker to release the complete WASM heap.
import { transcriptionOptions } from "/lib/lyrical/transcription-options.js";
import { createSpeechLoadReporter } from "/lib/lyrical/transcription-progress.js";
import { TRANSCRIPTION_PROFILES, transcriptionQuality, transcriptionDevice } from "/lib/lyrical/transcription-policy.js";
import { TRANSCRIPTION_RATE, WINDOW_SECONDS, CONTEXT_SECONDS } from "/lib/lyrical/transcription-windows.js";
import { pipeline, env } from "/assets/recognition-runtime.js";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = "/assets/ort/";
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let transcriber = null;
let options = null;
let running = false;
const status = (message) => self.postMessage({ type: "status", message });
self.onmessage = async ({ data }) => {
  if (running) return;
  running = true;
  try {
    if (data.type === "init") {
      if (transcriber) throw new Error("Speech engine already initialized.");
      const quality = transcriptionQuality(data.quality, transcriptionDevice());
      status("Preparing speech engine. First-time setup downloads the engine once…");
      transcriber = await pipeline("automatic-speech-recognition", TRANSCRIPTION_PROFILES[quality].model, {
        device: "wasm",
        // Keep the small encoder at full precision: Whisper's encoder is
        // sensitive to quantization, especially for multilingual recognition.
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
        progress_callback: createSpeechLoadReporter(status),
      });
      options = transcriptionOptions(data.language, transcriber.model.generation_config);
      self.postMessage({ type: "ready" });
    } else if (data.type === "transcribe") {
      if (!transcriber || !(data.audio instanceof Float32Array) || !data.audio.length ||
          data.audio.length > (WINDOW_SECONDS + 2 * CONTEXT_SECONDS) * TRANSCRIPTION_RATE)
        throw new Error("Invalid audio section.");
      const result = await transcriber(data.audio, options);
      self.postMessage({ type: "chunk", index: data.index, chunks: result.chunks || [] });
    }
  } catch (error) {
    console.warn("Lyrical transcription failed:", error?.message || String(error));
    if (transcriber) await transcriber.dispose().catch(() => {});
    transcriber = null;
    self.postMessage({
      type: "error",
      diagnostic: error?.message || String(error),
      message: "Transcription could not finish this section. Your progress is saved. Check your connection and retry to resume, or use Standard quality.",
    });
  } finally { running = false; }
};
