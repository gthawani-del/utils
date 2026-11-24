import assert from 'node:assert/strict';
import test from 'node:test';
import { drawAlgorithmicArt } from '../lib/image/algorithmic-drawing.js';

function recordDrawing(overrides = {}) {
  const calls = [];
  const context = {};
  for (const method of ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke']) {
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
