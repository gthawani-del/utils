import assert from 'node:assert/strict';
import test from 'node:test';
import { drawAlgorithmicArt } from '../lib/image/algorithmic-drawing.js';
import { interpretBrief, recipeFromInput, recipeHash } from '../lib/image/art-recipe.js';

function recordDrawing(overrides = {}) {
  const calls = [];
  const context = {};
  for (const method of ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'stroke']) {
    context[method] = (...args) => calls.push([method, ...args]);
  }
  drawAlgorithmicArt(context, 1080, 1920, {
    pattern: 'rosette', palette: 'fern', seed: 0, density: 54, transparent: false, ...overrides,
  });
  return calls;
}

test('drawing geometry repeats for the same seed and responds to pattern and seed', () => {
  const original = recordDrawing();
  assert.deepEqual(recordDrawing(), original);
  assert.notDeepEqual(recordDrawing({ seed: 1 }), original);
  assert.notDeepEqual(recordDrawing({ pattern: 'waves' }), original);
  assert.notDeepEqual(recordDrawing({ pattern: 'contours' }), original);
});

test('transparent drawings skip the background and retain the artwork', () => {
  const opaque = recordDrawing();
  const transparent = recordDrawing({ transparent: true });
  assert.deepEqual(transparent, opaque.filter(([method]) => method !== 'fillRect'));
});

test('new generators vary with the seed while palette changes preserve paths', () => {
  for (const pattern of ['flow', 'interference', 'branches']) {
    const drawing = recordDrawing({ pattern });
    assert.ok(drawing.length > 100, pattern);
    assert.deepEqual(recordDrawing({ pattern }), drawing);
    assert.deepEqual(recordDrawing({ pattern, palette: 'clay' }), drawing);
    assert.notDeepEqual(recordDrawing({ pattern, seed: 50 }), drawing);
  }
});

test('briefs select useful settings and recipes reopen the same resolved choices', () => {
  const jazz = interpretBrief('A midnight-blue jazz poster with flowing lines and room for a title at the top');
  assert.equal(jazz.recipe.pattern, 'flow');
  assert.equal(jazz.recipe.palette, 'midnight');
  assert.equal(jazz.recipe.composition, 'top');
  assert.equal(jazz.recipe.size, '1080x1350');
  assert.equal(jazz.abstract, false);
  const poster = interpretBrief('Portrait design, navy with ribbons, leave space up top');
  assert.equal(poster.recipe.pattern, 'flow');
  assert.equal(poster.recipe.palette, 'midnight');
  assert.equal(poster.recipe.composition, 'top');
  assert.equal(interpretBrief('Mumbai skyline in the monsoon').abstract, true);
  assert.equal(interpretBrief('Violet moiré for a 1:1 album cover').recipe.pattern, 'interference');
  assert.equal(interpretBrief('A transparent branching botanical overlay').recipe.transparent, true);
  assert.deepEqual(recipeFromInput(recipeHash(jazz.recipe)), jazz.recipe);
  assert.deepEqual(recipeFromInput(JSON.stringify(jazz.recipe)), jazz.recipe);
  assert.equal(recipeFromInput('#art=%'), null);
  assert.equal(recipeFromInput(JSON.stringify({ ...jazz.recipe, version: 2 })), null);
});

test('red flower brief selects a floral drawing and explicit red palette', () => {
  const { recipe, abstract } = interpretBrief('Create a red flower');
  assert.equal(recipe.pattern, 'flower');
  assert.equal(recipe.palette, 'red');
  assert.equal(abstract, false);
  assert.equal(interpretBrief('Symmetric flower mandala').recipe.pattern, 'rosette');
  assert.equal(interpretBrief('A blue bicycle').recipe, null);
  assert.equal(interpretBrief('बारिश').recipe, null);
  assert.deepEqual(recipeFromInput(recipeHash(recipe)), recipe);
});
