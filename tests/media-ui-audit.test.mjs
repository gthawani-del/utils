import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtInRecipes } from '../lib/media/recipes/store.js';

const html = await readFile(new URL('../media/index.html', import.meta.url), 'utf8');

test('Media Studio exposes no generic placeholder actions after capability audit', () => {
  assert.equal(html.includes('data-placeholder-action'), false);
  assert.equal(html.includes('>Media Library<'), false);
  assert.equal(html.includes('>Settings<'), false);
  assert.equal(/<button[^>]*>Generate transcript<\/button>/.test(html), false);
  assert.equal(/<button[^>]*>Clean Voice<\/button>/.test(html), false);
  assert.equal(/<button[^>]*>Remove Silence<\/button>/.test(html), false);
  assert.equal(/<button[^>]*>Normalize<\/button>/.test(html), false);
  assert.equal(/<button[^>]*>Separate Stems<\/button>/.test(html), false);
});

test('working and preview-only surfaces are labelled truthfully without badge spam', () => {
  assert.equal(html.includes('data-recipe-action="open"'), true);
  assert.equal(html.includes('<span>Renderable</span>'), true);
  assert.equal(html.includes('<span>Preview only</span>'), true);
  assert.equal(html.includes('Visual styles are preview-only until rendering is implemented.'), true);
  assert.equal(html.includes('Create Version processes only Renderable actions'), true);
});

test('universally unavailable built-in recipes are hidden from the default recipe gallery', () => {
  const names = builtInRecipes().map((recipe) => recipe.name);
  assert.deepEqual(names, [
    'YouTube Ready',
    'Instagram Reel',
    'Karaoke Video',
    'Client Delivery',
    'Archive Master',
    'Audio → Visualizer'
  ]);
  assert.equal(names.includes('Podcast Clean'), false);
  assert.equal(names.includes('WhatsApp Compress'), false);
  assert.equal(names.includes('Remove Silence + Captions'), false);
});

test('initially disabled controls are stateful working controls, not permanent future placeholders', () => {
  const allowed = new Set([
    'command-save-recipe', 'command-run-plan', 'command-create-version',
    'render-proof-cancel', 'version-export',
    'delivery-export-manifest', 'delivery-export-project', 'delivery-build-pack',
    'qc-fix', 'qc-export', 'compiler-build-package', 'audio-video-cancel',
    'lyrics-export-lrc', 'lyrics-export-txt',
    'transcript-export-srt', 'transcript-export-vtt', 'transcript-export-txt',
    'audio-undo', 'audio-redo', 'video-undo', 'video-redo'
  ]);
  const matches = [...html.matchAll(/<button[^>]*id="([^"]+)"[^>]*disabled[^>]*>/g)].map((match) => match[1]);
  for (const id of matches) assert.equal(allowed.has(id), true, `Unexpected permanently-disabled-looking control: ${id}`);
});
