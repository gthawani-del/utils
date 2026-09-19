export const DEFAULT_EDITS = Object.freeze({
  brightness: 0,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  gamma: 1,
  sharpen: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  straighten: 0
});

const LIMITS = Object.freeze({
  brightness: [-100, 100], exposure: [-2, 2], contrast: [-100, 100], saturation: [-100, 100], vibrance: [-100, 100],
  highlights: [-100, 100], shadows: [-100, 100], temperature: [-100, 100], tint: [-100, 100], gamma: [0.4, 2.5],
  sharpen: [0, 100], blur: [0, 20], grayscale: [0, 100], sepia: [0, 100], straighten: [-15, 15]
});

export function normalizeEdits(input = {}) {
  const output = {};
  for (const [key, fallback] of Object.entries(DEFAULT_EDITS)) {
    const n = Number(input[key]);
    const [min, max] = LIMITS[key];
    output[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  return output;
}

export function hasPixelEdits(input = {}) {
  const edits = normalizeEdits(input);
  return ['brightness','exposure','contrast','saturation','vibrance','highlights','shadows','temperature','tint','gamma','sharpen','blur','grayscale','sepia']
    .some((key) => edits[key] !== DEFAULT_EDITS[key]);
}

export function editsEqual(a = {}, b = {}) {
  const left = normalizeEdits(a); const right = normalizeEdits(b);
  return Object.keys(DEFAULT_EDITS).every((key) => left[key] === right[key]);
}
