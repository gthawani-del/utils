import { normalizeLayer } from './layers.js';

export function normalizeTextSelection(input = {}) {
  const x = clamp(input.x, 0, 0.995, 0);
  const y = clamp(input.y, 0, 0.995, 0);
  const width = clamp(input.width, 0.005, 1 - x, 0.1);
  const height = clamp(input.height, 0.005, 1 - y, 0.05);
  return { x, y, width, height };
}

export function selectionFromPoints(a = {}, b = {}) {
  const ax = clamp(a.x, 0, 1, 0), ay = clamp(a.y, 0, 1, 0);
  const bx = clamp(b.x, 0, 1, ax), by = clamp(b.y, 0, 1, ay);
  return normalizeTextSelection({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) });
}

export function normalizeTextReplacements(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((entry) => ({
    id: String(entry?.id || '').slice(0, 80),
    selection: normalizeTextSelection(entry?.selection)
  }));
}

export function replacementsToCleanup(input) {
  const replacements = normalizeTextReplacements(input);
  const strokes = [];
  for (const { selection } of replacements) {
    const rows = Math.max(1, Math.min(12, Math.ceil(selection.height / 0.018)));
    const radius = Math.max(0.001, Math.min(0.12, selection.height / (rows * 2)));
    const left = selection.x + Math.min(radius, selection.width / 2);
    const right = selection.x + selection.width - Math.min(radius, selection.width / 2);
    for (let row = 0; row < rows; row++) {
      const y = selection.y + radius + row * radius * 2;
      strokes.push({ radius, points: [{ x: left, y }, { x: right, y }] });
    }
  }
  return { enabled: strokes.length > 0, strokes: strokes.slice(0, 100) };
}

export function replacementLayerFromSelection(selectionInput, style = {}, id = '') {
  const selection = normalizeTextSelection(selectionInput);
  return normalizeLayer({
    id,
    type: 'text',
    name: 'Replacement text',
    text: String(style.text ?? 'Replacement').slice(0, 500),
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    align: style.align,
    x: (selection.x + selection.width / 2) * 100,
    y: (selection.y + selection.height / 2) * 100,
    width: selection.width * 100,
    height: selection.height * 100,
    opacity: 1,
    letterSpacing: 0,
    lineSpacing: 1.1
  });
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
