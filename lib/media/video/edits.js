const ALLOWED_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createVideoEdits(duration) {
  const safeDuration = Math.max(0, finite(duration));
  return {
    trimStart: 0,
    trimEnd: safeDuration,
    playbackRate: 1
  };
}

export function normalizeVideoEdits(edits, duration) {
  const safeDuration = Math.max(0, finite(duration));
  const source = edits && typeof edits === 'object' ? edits : {};
  const trimStart = clamp(finite(source.trimStart), 0, safeDuration);
  const rawEnd = finite(source.trimEnd, safeDuration);
  const trimEnd = clamp(Math.max(rawEnd, trimStart), trimStart, safeDuration);
  const playbackRate = ALLOWED_RATES.includes(Number(source.playbackRate)) ? Number(source.playbackRate) : 1;

  return { trimStart, trimEnd, playbackRate };
}

export function updateVideoEdits(edits, patch, duration) {
  return normalizeVideoEdits({ ...edits, ...patch }, duration);
}

export function selectionDuration(edits, duration) {
  const normalized = normalizeVideoEdits(edits, duration);
  return Math.max(0, normalized.trimEnd - normalized.trimStart);
}

export function isInsideSelection(time, edits, duration) {
  const normalized = normalizeVideoEdits(edits, duration);
  const value = finite(time);
  return value >= normalized.trimStart && value <= normalized.trimEnd;
}

export function allowedPlaybackRates() {
  return [...ALLOWED_RATES];
}
