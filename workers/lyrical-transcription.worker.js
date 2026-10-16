// Model download is initiated only by the user's Transcribe action. Audio never leaves this worker.
import { pipeline, env } from "/assets/recognition-runtime.js";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = "/assets/ort/";
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
self.onmessage = async ({ data }) => {
  const status = (message) => self.postMessage({ type: "status", message });
  try {
    status("Loading speech model. The first download can take a few minutes…");
    const transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny_timestamped",
      {
        device: "wasm",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
        progress_callback: (p) => {
          if (p.status === "progress" && Number.isFinite(p.progress))
            status(
              "Downloading " +
                String(p.file || "speech model")
                  .split("/")
                  .at(-1) +
                " · " +
                Math.round(p.progress) +
                "%",
            );
        },
      },
    );
    status(
      "Transcribing on your device. Singing and layered vocals may need corrections…",
    );
    const options = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: "word",
      task: "transcribe",
    };
    if (data.language !== "auto") options.language = data.language;
    const result = await transcriber(data.audio, options);
    self.postMessage({ type: "complete", chunks: result.chunks || [] });
    await transcriber.dispose();
  } catch (error) {
    // Public model/runtime diagnostics only; never log audio or recognized text.
    console.warn("Lyrical transcription failed:", error?.message || String(error));
    self.postMessage({
      type: "error",
      message:
        "Local transcription could not finish. Check your connection for the model download, then retry. You can also paste lyrics and set line timing.",
    });
  }
};
