const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MEDIA_RENDER_BUDGET = Object.freeze({
  maxInputBytes: 2 * GB,
  proofChunkBytes: 8 * MB,
  lowMemoryWarningBytes: 300 * MB,
  standardWarningBytes: 750 * MB,
  baseTimeoutMs: 15_000,
  maxTimeoutMs: 90_000,
  validationTimeoutMs: 12_000,
  maxConcurrentJobs: 1
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function renderJobTimeoutMs(bytes, budget = MEDIA_RENDER_BUDGET) {
  const megabytes = finite(bytes) / MB;
  return Math.min(
    budget.maxTimeoutMs,
    Math.max(budget.baseTimeoutMs, Math.round(budget.baseTimeoutMs + megabytes * 20))
  );
}

export function preflightRenderJob(source, { deviceMemory = Number(globalThis.navigator?.deviceMemory || 0) } = {}) {
  if (!source || source.kind !== 'local-file' || !(source.file instanceof Blob)) {
    return { ok: false, reason: 'Relink a local media source before starting a render job.' };
  }

  const bytes = finite(source.file.size || source.bytes);
  if (!bytes) return { ok: false, reason: 'Zero-byte media cannot be processed.' };
  if (bytes > MEDIA_RENDER_BUDGET.maxInputBytes) {
    return { ok: false, reason: 'This source exceeds the 2 GB media-processing input budget.' };
  }

  const width = finite(source.width);
  const height = finite(source.height);
  const decodedFrameBytes = width && height ? width * height * 4 : 0;
  const warningLimit = deviceMemory > 0 && deviceMemory <= 4
    ? MEDIA_RENDER_BUDGET.lowMemoryWarningBytes
    : MEDIA_RENDER_BUDGET.standardWarningBytes;

  const warnings = [];
  if (bytes > warningLimit) {
    warnings.push('Large source: future transforms may require proxy/chunked processing on this device.');
  }
  if (decodedFrameBytes > 128 * MB) {
    warnings.push('Large video frame: future decoded-frame transforms may exceed comfortable browser memory.');
  }

  return {
    ok: true,
    bytes,
    duration: finite(source.duration),
    width: width || null,
    height: height || null,
    decodedFrameBytes,
    complexity: 'low',
    warnings,
    timeoutMs: renderJobTimeoutMs(bytes)
  };
}
