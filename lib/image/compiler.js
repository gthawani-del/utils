export const COMPILER_PRESETS = Object.freeze([
  { id: 'instagram-square', label: 'Instagram Square', width: 1080, height: 1080 },
  { id: 'instagram-portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
  { id: 'story-reel', label: 'Story / Reel', width: 1080, height: 1920 },
  { id: 'youtube-thumbnail', label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { id: 'linkedin', label: 'LinkedIn', width: 1200, height: 627 },
  { id: 'x', label: 'X', width: 1600, height: 900 },
  { id: 'website-hero', label: 'Website Hero', width: 1920, height: 1080 },
  { id: 'website-thumbnail', label: 'Website Thumbnail', width: 800, height: 450 },
  { id: 'whatsapp', label: 'WhatsApp', width: 1600, height: 1200 },
  { id: 'og-image', label: 'OG Image', width: 1200, height: 630 }
]);

export const MAX_COMPILER_OUTPUTS = 20;
export const MAX_COMPILER_PACK_BYTES = 200 * 1024 * 1024;

export function normalizeCompilerOutput(input = {}, index = 0) {
  const width = clampInt(input.width, 1, 12000, 1200);
  const height = clampInt(input.height, 1, 12000, 630);
  const label = String(input.label || `Custom ${index + 1}`).trim().slice(0, 60) || `Custom ${index + 1}`;
  const id = slug(String(input.id || label)) || `custom-${index + 1}`;
  return { id: id.slice(0, 60), label, width, height };
}

export function normalizeCompilerOutputs(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set(); const output = [];
  for (let i = 0; i < input.length && output.length < MAX_COMPILER_OUTPUTS; i++) {
    const item = normalizeCompilerOutput(input[i], i);
    const key = `${item.id}:${item.width}x${item.height}`;
    if (seen.has(key)) continue;
    seen.add(key); output.push(item);
  }
  return output;
}

export function compilerSettings(base = {}, output, fitMode = 'fill') {
  const spec = normalizeCompilerOutput(output);
  return {
    ...base,
    resizeMode: fitMode === 'contain' ? 'contain' : 'fill',
    width: spec.width,
    height: spec.height,
    preserveAspect: true,
    crop: { mode: 'none' }
  };
}

function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function clampInt(value, min, max, fallback) { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
