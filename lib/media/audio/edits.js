function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createAudioEdits(duration) {
  const safeDuration = Math.max(0, finite(duration));
  return {
    trimStart: 0,
    trimEnd: safeDuration,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0
  };
}

export function normalizeAudioEdits(edits, duration) {
  const safeDuration = Math.max(0, finite(duration));
  const source = edits && typeof edits === 'object' ? edits : {};
  const trimStart = clamp(finite(source.trimStart), 0, safeDuration);
  const trimEnd = clamp(Math.max(finite(source.trimEnd, safeDuration), trimStart), trimStart, safeDuration);
  const selected = Math.max(0, trimEnd - trimStart);

  return {
    trimStart,
    trimEnd,
    volume: clamp(finite(source.volume, 1), 0, 1),
    fadeIn: clamp(finite(source.fadeIn), 0, selected),
    fadeOut: clamp(finite(source.fadeOut), 0, selected)
  };
}

export function updateAudioEdits(edits, patch, duration) {
  return normalizeAudioEdits({ ...edits, ...patch }, duration);
}

export function audioSelectionDuration(edits, duration) {
  const normalized = normalizeAudioEdits(edits, duration);
  return Math.max(0, normalized.trimEnd - normalized.trimStart);
}

export function previewVolumeAt(time, edits, duration) {
  const normalized = normalizeAudioEdits(edits, duration);
  const current = clamp(finite(time), normalized.trimStart, normalized.trimEnd);
  let gain = normalized.volume;

  if (normalized.fadeIn > 0 && current < normalized.trimStart + normalized.fadeIn) {
    gain *= clamp((current - normalized.trimStart) / normalized.fadeIn, 0, 1);
  }

  if (normalized.fadeOut > 0 && current > normalized.trimEnd - normalized.fadeOut) {
    gain *= clamp((normalized.trimEnd - current) / normalized.fadeOut, 0, 1);
  }

  return clamp(gain, 0, 1);
}
