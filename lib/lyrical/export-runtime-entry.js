import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  StreamTarget,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
} from "mediabunny";
import {
  validateExportSettings,
  validateExportInput,
  frameTiming,
  createOutputStore,
} from "./export.js";

const UNSUPPORTED =
  "This browser cannot export this video with its audio. You can keep editing; try another supported format, a smaller size, or a current desktop browser.";

export async function probeExport(options) {
  const settings = validateExportSettings(options);
  if (
    !globalThis.VideoEncoder ||
    !globalThis.AudioEncoder ||
    !globalThis.VideoFrame ||
    !globalThis.AudioData
  )
    return [];
  const videoOptions = {
    width: settings.width,
    height: settings.height,
    frameRate: settings.fps,
    quality: new Quality({ bitrate: settings.videoBitrate }),
    latencyMode: "quality",
  };
  const audioOptions = {
    numberOfChannels: settings.numberOfChannels,
    sampleRate: settings.sampleRate,
    quality: new Quality({ bitrate: settings.audioBitrate }),
  };
  const candidates = [
    {
      format: "mp4",
      mimeType: "video/mp4",
      videoCodec: "avc",
      audioCodec: "aac",
    },
    {
      format: "webm",
      mimeType: "video/webm",
      videoCodec: "vp9",
      audioCodec: "opus",
    },
    {
      format: "webm",
      mimeType: "video/webm",
      videoCodec: "vp8",
      audioCodec: "opus",
    },
  ];
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const supported = await Promise.all([
          canEncodeVideo(candidate.videoCodec, videoOptions),
          canEncodeAudio(candidate.audioCodec, audioOptions),
        ]);
        return supported.every(Boolean) ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter(
    (candidate, index) =>
      candidate &&
      results.findIndex((value) => value?.format === candidate.format) ===
        index,
  );
}

function abortError() {
  return new DOMException("Video export cancelled.", "AbortError");
}

export async function exportLyrical({
  canvas,
  drawFrame,
  audioBuffer,
  duration,
  fps = 30,
  format = "mp4",
  signal,
  onProgress = () => {},
}) {
  const settings = validateExportInput({
    canvas,
    drawFrame,
    audioBuffer,
    duration,
    fps,
    format,
  });
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };
  checkAbort();
  const selected = (await probeExport(settings)).find(
    (candidate) => candidate.format === format,
  );
  checkAbort();
  if (!selected) throw new Error(UNSUPPORTED);

  const store = createOutputStore();
  const target = new StreamTarget(
    new WritableStream({
      write({ position, data }) {
        checkAbort();
        store.write(position, data);
      },
    }),
    { chunked: true, chunkSize: 1024 * 1024 },
  );
  const output = new Output({
    format:
      format === "mp4"
        ? new Mp4OutputFormat({ fastStart: false })
        : new WebMOutputFormat(),
    target,
  });
  const video = new CanvasSource(canvas, {
    codec: selected.videoCodec,
    quality: new Quality({ bitrate: settings.videoBitrate }),
    keyFrameInterval: 2,
    latencyMode: "quality",
    alpha: "discard",
  });
  const audio = new AudioSampleSource({
    codec: selected.audioCodec,
    quality: new Quality({ bitrate: settings.audioBitrate }),
  });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audio);

  let abortReject;
  let cancellation;
  const aborted = new Promise((_, reject) => {
    abortReject = reject;
  });
  // Aborting can happen between awaited encoder operations.
  aborted.catch(() => {});
  const abort = () => {
    abortReject(abortError());
    cancellation = output.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const wait = (promise) => Promise.race([promise, aborted]);
  let lastProgress = -1;
  let videoIndex = 0;
  let audioIndex = 0;
  function progress(value, stage) {
    const percent = Math.max(lastProgress, Math.floor(value));
    if (percent === lastProgress && stage !== "finalizing") return;
    lastProgress = percent;
    onProgress(percent, {
      stage,
      completedFrames: videoIndex,
      totalFrames: settings.totalFrames,
    });
  }
  try {
    checkAbort();
    progress(0, "encoding");
    await wait(output.start());
    const channels = Array.from(
      { length: settings.numberOfChannels },
      (_, channel) => audioBuffer.getChannelData(channel),
    );
    if (channels.some((channel) => channel.length !== audioBuffer.length))
      throw new Error("The song audio could not be read completely.");
    const chunkFrames = Math.min(
      2048,
      Math.max(128, Math.floor(settings.sampleRate / 20)),
    );

    while (
      videoIndex < settings.totalFrames ||
      audioIndex < audioBuffer.length
    ) {
      checkAbort();
      // Feed in timestamp order: neither track can build a whole-song muxing backlog.
      if (
        videoIndex < settings.totalFrames &&
        (audioIndex >= audioBuffer.length ||
          videoIndex / fps <= audioIndex / settings.sampleRate)
      ) {
        const frame = frameTiming(videoIndex, settings.duration, fps);
        await wait(Promise.resolve(drawFrame(frame.timestamp)));
        checkAbort();
        if (
          canvas.width !== settings.width ||
          canvas.height !== settings.height
        )
          throw new Error(
            "The video size changed during export. Please retry.",
          );
        await wait(video.add(frame.timestamp, frame.duration));
        videoIndex++;
        // Yield to controls without tying video timestamps to display refresh or wall-clock time.
        if (videoIndex % 8 === 0)
          await wait(new Promise((resolve) => setTimeout(resolve, 0)));
      } else {
        const length = Math.min(chunkFrames, audioBuffer.length - audioIndex);
        const planar = new Float32Array(length * settings.numberOfChannels);
        channels.forEach((channel, index) =>
          planar.set(
            channel.subarray(audioIndex, audioIndex + length),
            index * length,
          ),
        );
        const sample = new AudioSample({
          format: "f32-planar",
          data: planar,
          numberOfChannels: settings.numberOfChannels,
          sampleRate: settings.sampleRate,
          timestamp: audioIndex / settings.sampleRate,
        });
        try {
          await wait(audio.add(sample));
        } finally {
          sample.close();
        }
        audioIndex += length;
      }
      progress(
        95 *
          Math.min(
            videoIndex / settings.totalFrames,
            audioIndex / audioBuffer.length,
          ),
        "encoding",
      );
    }
    checkAbort();
    progress(96, "finalizing");
    // Finalization flushes and closes both native encoders, then completes container metadata.
    // Cancellation during this short phase discards its result after cleanup completes.
    await output.finalize();
    checkAbort();
    const blob = store.toBlob(selected.mimeType);
    checkAbort();
    progress(100, "complete");
    return blob;
  } catch (error) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (cancellation) await cancellation;
    store.clear();
  }
}
