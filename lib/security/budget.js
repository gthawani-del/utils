export const SECURITY_BUDGET = Object.freeze({
  maxFileBytes: 40 * 1024 * 1024,
  maxBatchFiles: 50,
  maxBatchBytes: 250 * 1024 * 1024,
  maxDecodedMegapixels: 60,
  maxCanvasPixels: 60_000_000,
  maxOutputBytes: 60 * 1024 * 1024,
  workerTimeoutMs: 30_000,
  batchConcurrency: 1,
  maxSvgBytes: 5 * 1024 * 1024,
  maxSvgCharacters: 5_000_000
});

export function validateFileBudget(file, budget = SECURITY_BUDGET) {
  if (!file || typeof file.size !== 'number') return { ok: false, reason: 'Invalid file object.' };
  if (file.size === 0) return { ok: false, reason: 'Zero-byte files are not supported.' };
  if (file.size > budget.maxFileBytes) return { ok: false, reason: `File exceeds ${Math.round(budget.maxFileBytes / 1024 / 1024)} MB limit.` };
  return { ok: true };
}

export function validateBatchBudget(files, budget = SECURITY_BUDGET) {
  if (files.length > budget.maxBatchFiles) return { ok: false, reason: `Maximum batch size is ${budget.maxBatchFiles} files.` };
  const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (bytes > budget.maxBatchBytes) return { ok: false, reason: 'Combined batch size exceeds the session budget.' };
  return { ok: true };
}

export function validateDimensions(width, height, budget = SECURITY_BUDGET) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ok: false, reason: 'Invalid image dimensions.' };
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > budget.maxCanvasPixels) return { ok: false, reason: `Decoded image exceeds ${budget.maxDecodedMegapixels} megapixels.` };
  return { ok: true, pixels };
}

export function estimateRgbaBytes(width, height) {
  return width * height * 4;
}
