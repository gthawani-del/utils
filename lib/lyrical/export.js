// Keep the encoder bundle off the upload/editing path.
let runtimePromise;
function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("/assets/lyrical-export-runtime.js").catch(() => {
      runtimePromise = null;
      throw new Error(
        "The video exporter could not load. Check your connection and retry. Your project is still editable.",
      );
    });
  }
  return runtimePromise;
}

export const EXPORT_LIMITS = Object.freeze({
  maxDuration: 300,
  maxPixels: 1920 * 1080,
  maxEdge: 1920,
  maxAudioBytes: 128 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
});

export function validateExportSettings({
  width,
  height,
  sampleRate = 48000,
  numberOfChannels = 2,
  fps = 30,
} = {}) {
  if (
    ![width, height].every(
      (value) =>
        Number.isInteger(value) &&
        value >= 2 &&
        value <= EXPORT_LIMITS.maxEdge &&
        value % 2 === 0,
    ) ||
    width * height > EXPORT_LIMITS.maxPixels
  ) {
    throw new RangeError("Choose an even-sized video up to 1080p.");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    ![1, 2].includes(numberOfChannels)
  ) {
    throw new RangeError(
      "Export supports mono or stereo songs at sample rates from 8 to 96 kHz.",
    );
  }
  if (![24, 25, 30].includes(fps))
    throw new RangeError("Choose 24, 25 or 30 frames per second.");
  return {
    width,
    height,
    sampleRate,
    numberOfChannels,
    fps,
    videoBitrate: width * height > 1280 * 720 ? 5000000 : 3000000,
    audioBitrate: numberOfChannels === 1 ? 128000 : 192000,
  };
}

export function frameCount(duration, fps = 30) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > EXPORT_LIMITS.maxDuration
  ) {
    throw new RangeError("Choose a song between zero and five minutes long.");
  }
  if (![24, 25, 30].includes(fps))
    throw new RangeError("Choose 24, 25 or 30 frames per second.");
  // Avoid one extra zero-length frame at floating-point boundaries.
  return Math.max(1, Math.ceil(duration * fps - 1e-9));
}

export function frameTiming(index, duration, fps = 30) {
  const count = frameCount(duration, fps);
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new RangeError("Invalid frame index.");
  const timestamp = index / fps;
  return {
    timestamp,
    duration: Math.min((index + 1) / fps, duration) - timestamp,
  };
}

export function validateExportInput({
  canvas,
  drawFrame,
  audioBuffer,
  duration,
  fps = 30,
  format = "mp4",
} = {}) {
  if (!canvas || typeof drawFrame !== "function")
    throw new TypeError("A canvas and frame renderer are required.");
  if (
    !audioBuffer ||
    typeof audioBuffer.getChannelData !== "function" ||
    !Number.isInteger(audioBuffer.length) ||
    audioBuffer.length <= 0
  ) {
    throw new TypeError("Load the original song before exporting.");
  }
  if (!["mp4", "webm"].includes(format))
    throw new RangeError("Choose MP4 or WebM.");
  const settings = validateExportSettings({
    width: canvas.width,
    height: canvas.height,
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
    fps,
  });
  const audioDuration = audioBuffer.length / settings.sampleRate;
  if (
    duration !== undefined &&
    (!Number.isFinite(duration) ||
      Math.abs(duration - audioDuration) > 1 / settings.sampleRate)
  ) {
    throw new RangeError("The video duration must match the complete song.");
  }
  const totalFrames = frameCount(audioDuration, fps);
  if (
    audioBuffer.length * settings.numberOfChannels * 4 >
    EXPORT_LIMITS.maxAudioBytes
  ) {
    throw new RangeError(
      "This decoded song is too large for browser export. Use a shorter mono or stereo file.",
    );
  }
  return { ...settings, duration: audioDuration, totalFrames, format };
}

// A seekable in-memory sink. MP4 and WebM update their headers during finalization.
// Fixed blocks avoid repeatedly copying one ever-growing contiguous ArrayBuffer.
export function createOutputStore(
  maxBytes = EXPORT_LIMITS.maxOutputBytes,
  blockSize = 1024 * 1024,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(blockSize) ||
    blockSize <= 0
  ) {
    throw new RangeError("Invalid output storage limit.");
  }
  const blocks = [];
  let size = 0;
  return {
    get size() {
      return size;
    },
    write(position, data) {
      if (
        !Number.isSafeInteger(position) ||
        position < 0 ||
        !(data instanceof Uint8Array)
      )
        throw new TypeError("Invalid output write.");
      const end = position + data.byteLength;
      if (!Number.isSafeInteger(end) || end > maxBytes)
        throw new RangeError(
          "The video exceeds the browser export size limit. Try 720p or a shorter song.",
        );
      for (let offset = 0; offset < data.byteLength; ) {
        const absolute = position + offset;
        const blockIndex = Math.floor(absolute / blockSize);
        while (blocks.length <= blockIndex)
          blocks.push(
            new Uint8Array(
              Math.min(blockSize, maxBytes - blocks.length * blockSize),
            ),
          );
        const blockOffset = absolute % blockSize;
        const length = Math.min(
          data.byteLength - offset,
          blocks[blockIndex].length - blockOffset,
        );
        blocks[blockIndex].set(
          data.subarray(offset, offset + length),
          blockOffset,
        );
        offset += length;
      }
      size = Math.max(size, end);
    },
    toBlob(type) {
      if (!size) throw new Error("The exporter produced an empty file.");
      return new Blob(
        blocks.map((block, index) =>
          block.subarray(0, Math.min(block.length, size - index * blockSize)),
        ),
        { type },
      );
    },
    clear() {
      blocks.length = 0;
      size = 0;
    },
  };
}

export async function probeExport(options) {
  validateExportSettings(options);
  if (
    !globalThis.VideoEncoder ||
    !globalThis.AudioEncoder ||
    !globalThis.VideoFrame ||
    !globalThis.AudioData
  )
    return [];
  return (await loadRuntime()).probeExport(options);
}

export async function exportLyrical(options) {
  validateExportInput(options);
  if (options.signal?.aborted)
    throw new DOMException("Video export cancelled.", "AbortError");
  return (await loadRuntime()).exportLyrical(options);
}
