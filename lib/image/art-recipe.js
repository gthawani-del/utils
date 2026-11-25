import { palettes } from './algorithmic-drawing.js';

export const modes = {
  flower: { label: 'Flower', fields: [] },
  flow: { label: 'Flow Fields', fields: [['direction', 'Direction', 55], ['turbulence', 'Turbulence', 55], ['trail', 'Trail length', 62]] },
  interference: { label: 'Wave Interference', fields: [['frequency', 'Frequency', 54], ['angle', 'Crossing angle', 46], ['spacing', 'Spacing', 58]] },
  branches: { label: 'Branching Forms', fields: [['angle', 'Lean', 44], ['spread', 'Branch spread', 56], ['depth', 'Growth depth', 56]] },
  rosette: { label: 'Rosette', fields: [] },
  waves: { label: 'Wave Lines', fields: [] },
  contours: { label: 'Contour Lines', fields: [] },
};

export const sizes = ['1080x1080', '1080x1350', '1080x1920', '1920x1080'];
export const layouts = {
  balanced: 'Balanced', top: 'Space at top', bottom: 'Space at bottom',
  left: 'Space on left', right: 'Space on right',
};
const isOwn = (object, key) => Object.hasOwn(object, key);
const integer = (value, fallback, max = 100) => Number.isFinite(value) ? Math.round(Math.min(max, Math.max(0, value))) : fallback;

export function normalizeRecipe(data = {}) {
  const pattern = isOwn(modes, data.pattern) ? data.pattern : 'flow';
  return {
    version: 1, pattern,
    seed: integer(data.seed, 4173, 4294967295),
    palette: isOwn(palettes, data.palette) ? data.palette : 'midnight',
    density: integer(data.density, 58),
    size: sizes.includes(data.size) ? data.size : sizes[0],
    composition: isOwn(layouts, data.composition) ? data.composition : 'balanced',
    transparent: data.transparent === true,
    parameters: Object.fromEntries(modes[pattern].fields.map(([key, , value]) => [key, integer(data.parameters?.[key], value)])),
  };
}

export function readRecipe(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  try {
    const value = JSON.parse(text);
    if (!value || value.version !== 1 || !isOwn(modes, value.pattern) || !sizes.includes(value.size)) return null;
    return normalizeRecipe(value);
  } catch {
    return null;
  }
}

export function recipeHash(recipe) {
  return '#art=' + encodeURIComponent(JSON.stringify(normalizeRecipe(recipe)));
}

export function recipeFromInput(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (raw.startsWith('{')) return readRecipe(raw);
  if (raw.length > 5000) return null;
  const hash = raw.slice(raw.indexOf('#'));
  if (!hash.startsWith('#art=')) return null;
  try { return readRecipe(decodeURIComponent(hash.slice(5))); } catch { return null; }
}

function choose(text, rules, fallback) {
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? fallback;
}

export function interpretBrief(input) {
  const text = input.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9\s\-:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
  const pattern = choose(text, [
    ['rosette', /\b(rosettes?|mandalas?|symmetric flowers?)\b/],
    ['flower', /\b(flowers?|blossoms?|blooms?|roses?|dais(?:y|ies)|tulips?|popp(?:y|ies))\b/],
    ['branches', /\b(branch\w*|botanic\w*|coral|tree\w*|roots?|fractal)\b/],
    ['interference', /\b(interference|moire|overlapping waves|wave bands|optical)\b/],
    ['contours', /\b(contours?|topograph\w*|terrain lines)\b/],
    ['rosette', /\bradial\b/],
    ['waves', /\b(wave lines|parallel waves)\b/],
    ['flow', /\b(flow\w*|ribbons?|ink trails?|curves?|currents?|monsoon|silk|stream\w*)\b/],
  ]);
  if (!pattern) return { recipe: null, abstract: false };
  const palette = choose(text, [
    ['midnight', /\b(midnight|navy|dark blue|deep blue|jazz|night)\b/],
    ['ocean', /\b(blue|teal|aqua|ocean|sea)\b/],
    ['violet', /\b(violet|purple|lavender|neon)\b/],
    ['fern', /\b(green|forest|fern|sage|emerald)\b/],
    ['red', /\b(red|crimson|scarlet|ruby)\b/],
    ['clay', /\b(terracotta|copper|orange|clay|warm)\b/],
    ['monochrome', /\b(monochrome|black and white|black|grayscale)\b/],
  ]);
  const size = choose(text, [
    ['1080x1920', /\b(9:16|story|reel|phone wallpaper|vertical)\b/],
    ['1080x1080', /\b(square|1:1|album cover)\b/],
    ['1920x1080', /\b(16:9|horizontal|landscape|wide|banner)\b/],
    ['1080x1350', /\b(4:5|poster|portrait)\b/],
  ]);
  const side = '(?:top|bottom|left|right)';
  const detail = text.match(new RegExp('(?:space|room|title|heading|text|headline|negative space)[^.!?]{0,38}\\b(' + side + ')\\b'))
    || text.match(new RegExp('\\b(' + side + ')\\b[^.!?]{0,24}(?:space|room|title|heading|headline)'));
  const density = choose(text, [[32, /\b(minimal|sparse|airy|simple|subtle)\b/], [82, /\b(dense|intricate|layered|busy|complex)\b/]]);
  const transparent = !/\b(no|not|without)\s+transparent\b/.test(text) && /\b(transparent|overlay|no background)\b/.test(text);
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const selected = pattern;
  const parameters = {};
  if (selected === 'flow') {
    if (/\b(calm|soft|gentle|smooth)\b/.test(text)) parameters.turbulence = 25;
    if (/\b(chaotic|stormy|turbulent)\b/.test(text)) parameters.turbulence = 86;
    if (/\blong trails?\b/.test(text)) parameters.trail = 88;
  }
  return {
    recipe: normalizeRecipe({ pattern: selected, palette, size, density, composition: detail?.[1], transparent, seed: seed >>> 0, parameters }),
    abstract: /\b(realistic|photoreal\w*|skyline|cityscape|mumbai|portrait of|illustrat\w*|a person|street|landmark)\b/.test(text),
  };
}
