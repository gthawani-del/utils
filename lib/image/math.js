export function calculateResize(sourceWidth, sourceHeight, options) {
  const mode = options.resizeMode || 'fit';
  let width = positive(options.width, sourceWidth);
  let height = positive(options.height, sourceHeight);
  const pct = positive(options.percentage, 100) / 100;
  if (mode === 'percentage') return rounded(sourceWidth * pct, sourceHeight * pct);
  if (mode === 'longest') {
    const target = positive(options.longestEdge, Math.max(sourceWidth, sourceHeight));
    const scale = target / Math.max(sourceWidth, sourceHeight);
    return rounded(sourceWidth * scale, sourceHeight * scale);
  }
  if (mode === 'shortest') {
    const target = positive(options.shortestEdge, Math.min(sourceWidth, sourceHeight));
    const scale = target / Math.min(sourceWidth, sourceHeight);
    return rounded(sourceWidth * scale, sourceHeight * scale);
  }
  if (options.preserveAspect !== false && mode === 'fit') {
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    return rounded(sourceWidth * scale, sourceHeight * scale);
  }
  return rounded(width, height);
}

export function calculateCrop(sourceWidth, sourceHeight, crop) {
  if (!crop || crop.mode === 'none') return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (crop.mode === 'free') {
    const x = clamp(Math.round(Number(crop.x) || 0), 0, sourceWidth - 1);
    const y = clamp(Math.round(Number(crop.y) || 0), 0, sourceHeight - 1);
    const width = clamp(Math.round(Number(crop.width) || sourceWidth), 1, sourceWidth - x);
    const height = clamp(Math.round(Number(crop.height) || sourceHeight), 1, sourceHeight - y);
    return { x, y, width, height };
  }
  const ratio = Number(crop.ratio);
  if (!Number.isFinite(ratio) || ratio <= 0) return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  let width = sourceWidth;
  let height = Math.round(width / ratio);
  if (height > sourceHeight) { height = sourceHeight; width = Math.round(height * ratio); }
  return { x: Math.round((sourceWidth - width) / 2), y: Math.round((sourceHeight - height) / 2), width, height };
}

export function coverRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = targetWidth / scale;
  const height = targetHeight / scale;
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

function positive(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function rounded(width, height) { return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
