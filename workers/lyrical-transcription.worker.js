// Model download is initiated only for fresh transcription, never review edits.
import { transcriptionOptions } from "/lib/lyrical/transcription-options.js";
import { createSpeechLoadReporter } from "/lib/lyrical/transcription-progress.js";
import { pipeline, env } from "/assets/recognition-runtime.js";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = "/assets/ort/";
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
self.onmessage = async ({ data }) => {
  const status = (message) => self.postMessage({ type: "status", message });
  try {
    status("Preparing speech engine. First-time setup can take a few minutes…");
    const transcriber = await pipeline(
      "automatic-speech-recognition",
      data.quality === "base"
        ? "onnx-community/whisper-base_timestamped"
        : "onnx-community/whisper-small_timestamped",
      {
        device: "wasm",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
        progress_callback: createSpeechLoadReporter(status),
      },
    );
    status(
      "Transcribing in " +
        (data.languageName || data.language) +
        " on your device…",
    );
    const options = transcriptionOptions(
      data.language,
      transcriber.model.generation_config,
    );
    const result = await transcriber(data.audio, options);
    self.postMessage({
      type: "complete",
      chunks: result.chunks || [],
      language: data.language,
      prompt: options.decoder_input_ids,
    });
    await transcriber.dispose();
  } catch (error) {
    // Public model/runtime diagnostics only; never log audio or recognized text.
    console.warn(
      "Lyrical transcription failed:",
      error?.message || String(error),
    );
    self.postMessage({
      type: "error",
      diagnostic: error?.message || String(error),
      message:
        "Local transcription could not finish. Check your connection for the model download, then retry. Your existing lyrics are safe; retry with the song language selected.",
    });
  }
};
