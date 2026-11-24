import { drawAlgorithmicArt, palettes } from '/lib/image/algorithmic-drawing.js';
import { interpretBrief, layouts, modes, normalizeRecipe, recipeFromInput, recipeHash } from '/lib/image/art-recipe.js';
import { curatedSeeds, examples } from '/lib/image/art-examples.js';

const $ = id => document.getElementById(id);
const controls = Object.fromEntries(['pattern','palette','composition','size','density','seed','transparent'].map(key => [key, $(key)]));
const status = $('drawing-status');
const preview = $('drawing-preview');
const modeFields = $('drawing-mode-fields');
const gallery = $('drawing-gallery');
const paletteName = name => name[0].toUpperCase() + name.slice(1);
const sharedRecipe = recipeFromInput(location.hash);
let recipe = sharedRecipe || normalizeRecipe(examples[0].settings);
let abstract = false;
let previous = [];
let next = [];
let frame = 0;
let galleryFrame = 0;

for (const [key, mode] of Object.entries(modes)) controls.pattern.add(new Option(mode.label, key));
for (const key of Object.keys(palettes)) controls.palette.add(new Option(paletteName(key), key));
for (const [key, label] of Object.entries(layouts)) controls.composition.add(new Option(label, key));

function paint(canvas, art, maxEdge) {
  const [width, height] = art.size.split('x').map(Number);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  drawAlgorithmicArt(canvas.getContext('2d'), canvas.width, canvas.height, art);
}

function renderGallery() {
  cancelAnimationFrame(galleryFrame);
  if (!gallery.open) return;
  galleryFrame = requestAnimationFrame(() => {
    const seeds = curatedSeeds[recipe.pattern] || [4173, 6131, 7029, 8141, 9419, 11311];
    $('drawing-seeds').replaceChildren(...seeds.map((seed, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      const art = { ...recipe, seed };
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden','true');
      paint(canvas, art, 148);
      const label = document.createElement('span');
      label.textContent = 'Variation ' + (index + 1);
      button.append(canvas, label);
      button.addEventListener('click', () => vary(seed));
      return button;
    }));
  });
}

function schedulePaint() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    paint(preview, recipe, matchMedia('(max-width:730px)').matches ? 480 : 640);
    preview.setAttribute('aria-label', `${modes[recipe.pattern].label}, ${paletteName(recipe.palette)} palette, seed ${recipe.seed}`);
    $('drawing-interpretation').textContent = [
      abstract && 'Abstract interpretation', modes[recipe.pattern].label, paletteName(recipe.palette),
      recipe.composition !== 'balanced' && layouts[recipe.composition], recipe.transparent && 'Transparent',
    ].filter(Boolean).join(' · ');
  });
}

function rebuildFields() {
  modeFields.replaceChildren(...modes[recipe.pattern].fields.map(([key, name]) => {
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    Object.assign(input, { type:'range', min:'0', max:'100', value:String(recipe.parameters[key]) });
    input.dataset.parameter = key;
    input.addEventListener('input', () => update({ parameters: { ...recipe.parameters, [key]: input.valueAsNumber } }));
    input.addEventListener('change', renderGallery);
    label.append(input);
    return label;
  }));
}

function setRecipe(art) {
  recipe = normalizeRecipe(art);
  for (const [key, control] of Object.entries(controls)) {
    if (key === 'transparent') control.checked = recipe.transparent;
    else control.value = String(recipe[key]);
  }
  rebuildFields();
  renderHistory();
  schedulePaint();
  renderGallery();
}

function update(changes) {
  recipe = normalizeRecipe({ ...recipe, ...changes });
  status.textContent = '';
  schedulePaint();
}

function renderHistory() {
  $('previous-variation').disabled = !previous.length;
  $('next-variation').disabled = !next.length;
}

function vary(seed) {
  if (seed === recipe.seed) return;
  previous = [...previous.slice(-39), recipe.seed];
  next = [];
  setRecipe({ ...recipe, seed });
}

function step(from, to) {
  if (!from.length) return;
  to.push(recipe.seed);
  setRecipe({ ...recipe, seed: from.pop() });
}

for (const [key, control] of Object.entries(controls)) {
  control.addEventListener('input', () => {
    if (key === 'seed' && (!control.value || !control.validity.valid)) return;
    const value = key === 'transparent' ? control.checked
      : key === 'seed' || key === 'density' ? control.valueAsNumber : control.value;
    if (key === 'seed') vary(value);
    else if (key === 'pattern') {
      abstract = false;
      setRecipe({ ...recipe, pattern:value, parameters:{} });
    } else update({ [key]:value });
  });
  control.addEventListener('change', () => {
    if (key === 'seed' && (!control.value || !control.validity.valid)) control.value = String(recipe.seed);
    renderGallery();
  });
}

function showIdea(open) {
  $('drawing-idea-panel').hidden = !open;
  $('edit-art-brief').hidden = open;
  $('edit-art-brief').setAttribute('aria-expanded', String(open));
}

$('edit-art-brief').addEventListener('click', () => {
  showIdea(true);
  $('art-brief').focus();
});

function openArtwork(art, { idea = '', fallback = false } = {}) {
  previous = [];
  next = [];
  abstract = fallback;
  $('art-brief').value = idea;
  status.textContent = '';
  const focusInBrief = $('drawing-idea-panel').contains(document.activeElement);
  showIdea(false);
  setRecipe(art);
  if (focusInBrief) $('edit-art-brief').focus({ preventScroll: true });
}

$('brief-form').addEventListener('submit', event => {
  event.preventDefault();
  const idea = $('art-brief').value.trim();
  if (!idea) return;
  const result = interpretBrief(idea);
  openArtwork(result.recipe, { idea, fallback:result.abstract });
});
for (const example of examples) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = example.name;
  button.addEventListener('click', () => openArtwork(example.settings, { idea:example.brief }));
  $('drawing-examples').append(button);
}
$('new-seed').addEventListener('click', () => vary(crypto.getRandomValues(new Uint32Array(1))[0]));
$('previous-variation').addEventListener('click', () => step(previous, next));
$('next-variation').addEventListener('click', () => step(next, previous));
$('drawing-reset').addEventListener('click', () => setRecipe({
  pattern:recipe.pattern, seed:recipe.seed, size:recipe.size,
}));
gallery.addEventListener('toggle', renderGallery);
matchMedia('(max-width:730px)').addEventListener('change', schedulePaint);

$('open-recipe').addEventListener('click', () => {
  $('recipe-input').value = '';
  $('recipe-error').textContent = '';
  $('recipe-dialog').showModal();
});
$('recipe-form').addEventListener('submit', event => {
  event.preventDefault();
  const art = recipeFromInput($('recipe-input').value);
  if (!art) {
    $('recipe-error').textContent = 'This recipe is invalid or uses an unsupported version.';
    return;
  }
  openArtwork(art);
  $('recipe-dialog').close();
});
$('copy-recipe').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = recipeHash(recipe);
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = 'Recipe link copied.';
  } catch {
    $('recipe-dialog').showModal();
    $('recipe-input').value = url.href;
    $('recipe-input').select();
    $('recipe-error').textContent = 'Copy the selected link to share this artwork.';
  }
});
window.addEventListener('hashchange', () => {
  const art = recipeFromInput(location.hash);
  if (art) openArtwork(art);
});
for (const btn of document.querySelectorAll('[data-close]')) btn.addEventListener('click', () => $(btn.dataset.close).close());

$('export-art').addEventListener('click', () => {
  $('art-export-size').textContent = recipe.size.replace('x',' × ') + ' px';
  $('art-export-status').textContent = '';
  $('art-export-dialog').showModal();
});

async function download(format) {
  const art = recipe;
  const output = document.createElement('canvas');
  const type = 'image/' + format;
  const message = $('art-export-status');
  const png = $('download-png');
  const webp = $('download-webp');
  png.disabled = webp.disabled = true;
  message.textContent = 'Preparing artwork…';
  try {
    paint(output, art, Infinity);
    const blob = await new Promise(resolve => output.toBlob(resolve, type, .94));
    if (!blob || blob.type !== type) {
      message.textContent = format === 'webp' ? 'WebP is unavailable in this browser. Use PNG.' : 'Could not create the PNG.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${art.pattern}-${art.seed}-${art.size}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    message.textContent = 'Artwork ready.';
  } catch {
    message.textContent = 'Could not export this artwork. Try again.';
  } finally {
    output.width = output.height = 1;
    png.disabled = webp.disabled = false;
  }
}
$('download-png').addEventListener('click', () => download('png'));
$('download-webp').addEventListener('click', () => download('webp'));
setRecipe(recipe);
if (sharedRecipe) showIdea(false);
