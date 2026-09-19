const STORAGE_KEY = 'utility-os:media-recipes:v1';
const MAX_RECIPES = 50;
const MAX_ACTIONS = 30;

const BUILT_INS = Object.freeze([
  {
    id: 'builtin-youtube-ready',
    name: 'YouTube Ready',
    description: 'Prepare 16:9 output and run QC.',
    actions: [{ type: 'set-aspect', params: { aspect: '16:9' } }, { type: 'run-qc', params: {} }]
  },
  {
    id: 'builtin-instagram-reel',
    name: 'Instagram Reel',
    description: 'Prepare a 9:16 output and run QC.',
    actions: [{ type: 'set-aspect', params: { aspect: '9:16' } }, { type: 'run-qc', params: {} }]
  },
  {
    id: 'builtin-karaoke-video',
    name: 'Karaoke Video',
    description: 'Open lyrics, prepare 16:9, then move to Audio → Video.',
    actions: [
      { type: 'open-category', params: { category: 'lyrics' } },
      { type: 'set-aspect', params: { aspect: '16:9' } },
      { type: 'open-category', params: { category: 'audio-video' } }
    ]
  },
  {
    id: 'builtin-client-delivery',
    name: 'Client Delivery',
    description: 'Run QC, then open professional delivery.',
    actions: [{ type: 'run-qc', params: {} }, { type: 'open-category', params: { category: 'delivery' } }]
  },
  {
    id: 'builtin-archive-master',
    name: 'Archive Master',
    description: 'Open the deterministic handoff and archive workflow.',
    actions: [{ type: 'open-category', params: { category: 'delivery' } }]
  },
  {
    id: 'builtin-audio-visualizer',
    name: 'Audio → Visualizer',
    description: 'Prepare landscape visualizer output and open Audio → Video.',
    actions: [
      { type: 'set-aspect', params: { aspect: '16:9' } },
      { type: 'open-category', params: { category: 'audio-video' } }
    ]
  }
]);

const TYPES = new Set([
  'open-category', 'run-qc', 'apply-qc-fixes', 'trim', 'volume', 'fade-in', 'fade-out',
  'set-aspect', 'remove-silence', 'normalize-audio', 'generate-captions', 'target-size', 'encode-mp3'
]);

function cleanName(value, fallback = 'Untitled Recipe') {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, 80) || fallback;
}

function cleanAction(action) {
  const type = String(action?.type || '');
  if (!TYPES.has(type)) return null;
  const input = action?.params && typeof action.params === 'object' && !Array.isArray(action.params) ? action.params : {};
  const params = {};

  for (const [key, value] of Object.entries(input).slice(0, 12)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/i.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) params[key] = value;
    if (typeof value === 'string') params[key] = value.slice(0, 80);
    if (typeof value === 'boolean') params[key] = value;
  }
  return { type, params };
}

function cleanActions(actions) {
  return (Array.isArray(actions) ? actions : [])
    .slice(0, MAX_ACTIONS)
    .map(cleanAction)
    .filter(Boolean);
}

function cleanRecipe(recipe, index = 0) {
  const actions = cleanActions(recipe?.actions);
  if (!actions.length) return null;
  return {
    id: String(recipe?.id || `recipe-${index + 1}`).replace(/[^a-z0-9_-]/gi, '-').slice(0, 100),
    name: cleanName(recipe?.name),
    description: String(recipe?.description || '').replace(/\u0000/g, '').trim().slice(0, 240),
    origin: 'custom',
    createdAt: String(recipe?.createdAt || ''),
    updatedAt: String(recipe?.updatedAt || ''),
    actions
  };
}

function nowIso() {
  return new Date().toISOString();
}

function recipeId() {
  if (globalThis.crypto?.randomUUID) return `recipe-${globalThis.crypto.randomUUID()}`;
  return `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function write(recipes, storage) {
  try {
    storageOrDefault(storage).setItem(STORAGE_KEY, JSON.stringify(recipes.slice(0, MAX_RECIPES)));
    return true;
  } catch {
    return false;
  }
}

export function builtInRecipes() {
  return BUILT_INS.map((recipe) => ({
    ...recipe,
    origin: 'built-in',
    actions: cleanActions(recipe.actions)
  }));
}

export function loadCustomRecipes(storage) {
  try {
    const raw = storageOrDefault(storage).getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECIPES).map(cleanRecipe).filter(Boolean);
  } catch {
    return [];
  }
}

export function createCustomRecipe({ name, actions, description = '' }, storage) {
  const recipes = loadCustomRecipes(storage);
  const timestamp = nowIso();
  const recipe = cleanRecipe({
    id: recipeId(),
    name,
    description,
    createdAt: timestamp,
    updatedAt: timestamp,
    actions
  }, recipes.length);
  if (!recipe) return { ok: false, reason: 'A recipe needs at least one supported deterministic action.' };
  recipes.unshift(recipe);
  if (!write(recipes, storage)) return { ok: false, reason: 'Browser storage is unavailable or full.' };
  return { ok: true, recipe };
}

export function updateCustomRecipe(id, patch, storage) {
  const recipes = loadCustomRecipes(storage);
  const index = recipes.findIndex((recipe) => recipe.id === String(id));
  if (index < 0) return { ok: false, reason: 'Recipe was not found.' };

  const existing = recipes[index];
  const updated = cleanRecipe({
    ...existing,
    name: patch?.name ?? existing.name,
    description: patch?.description ?? existing.description,
    actions: patch?.actions ?? existing.actions,
    updatedAt: nowIso()
  }, index);
  if (!updated) return { ok: false, reason: 'A recipe needs at least one supported deterministic action.' };
  recipes[index] = updated;
  if (!write(recipes, storage)) return { ok: false, reason: 'Browser storage is unavailable or full.' };
  return { ok: true, recipe: updated };
}

export function duplicateRecipe(recipe, storage) {
  return createCustomRecipe({
    name: `${cleanName(recipe?.name, 'Recipe')} Copy`,
    description: recipe?.description || '',
    actions: cleanActions(recipe?.actions)
  }, storage);
}

export function deleteCustomRecipe(id, storage) {
  const recipes = loadCustomRecipes(storage);
  const next = recipes.filter((recipe) => recipe.id !== String(id));
  if (next.length === recipes.length) return { ok: false, reason: 'Recipe was not found.' };
  if (!write(next, storage)) return { ok: false, reason: 'Browser storage is unavailable or full.' };
  return { ok: true };
}
