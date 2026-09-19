import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateResize, calculateCrop, coverRect } from '../lib/image/math.js';
import { parsePngDimensions, parseWebpDimensions, parseSvgDimensions } from '../lib/image/preflight.js';
import { DEFAULT_EDITS, normalizeEdits, hasPixelEdits } from '../lib/image/edits.js';
import { createLayer, normalizeLayer, normalizeLayers } from '../lib/image/layers.js';
import { DEFAULT_WATERMARK, normalizeWatermark, resolveWatermarkPosition } from '../lib/image/watermark.js';
import { normalizeCleanup, cleanupHasMask } from '../lib/image/cleanup.js';

test('fit resize preserves aspect ratio', () => {
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'fit', width: 1000, height: 1000, preserveAspect: true }), { width: 1000, height: 500 });
});

test('percentage, longest and shortest edge resize are distinct', () => {
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'percentage', percentage: 50 }), { width: 2000, height: 1000 });
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'longest', longestEdge: 1600 }), { width: 1600, height: 800 });
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'shortest', shortestEdge: 1000 }), { width: 2000, height: 1000 });
});

test('ratio crop is centered and free crop is clamped', () => {
  assert.deepEqual(calculateCrop(1600, 1200, { mode: 'ratio', ratio: 1 }), { x: 200, y: 0, width: 1200, height: 1200 });
  assert.deepEqual(calculateCrop(100, 100, { mode: 'free', x: 90, y: 90, width: 100, height: 100 }), { x: 90, y: 90, width: 10, height: 10 });
});

test('fill cover rectangle preserves aspect ratio', () => {
  const r = coverRect(1600, 900, 1080, 1080);
  assert.equal(Math.round(r.width), 900);
  assert.equal(Math.round(r.height), 900);
});

test('PNG dimensions are preflighted without decode', () => {
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer); view.setUint32(16, 1920, false); view.setUint32(20, 1080, false);
  assert.deepEqual(parsePngDimensions(bytes), { width: 1920, height: 1080 });
});

test('SVG dimensions use safe numeric attributes or viewBox', () => {
  assert.deepEqual(parseSvgDimensions('<svg width="100" height="50"></svg>'), { width: 100, height: 50 });
  assert.deepEqual(parseSvgDimensions('<svg viewBox="0 0 300 200"></svg>'), { width: 300, height: 200 });
});


test('edit settings are normalized and bounded', () => {
  const edits = normalizeEdits({ brightness: 400, exposure: -9, gamma: 0, blur: 99, straighten: -50 });
  assert.equal(edits.brightness, 100);
  assert.equal(edits.exposure, -2);
  assert.equal(edits.gamma, 0.4);
  assert.equal(edits.blur, 20);
  assert.equal(edits.straighten, -15);
});

test('default edits remain non-destructive and pixel-edit detection is precise', () => {
  assert.equal(hasPixelEdits(DEFAULT_EDITS), false);
  assert.equal(hasPixelEdits({ ...DEFAULT_EDITS, saturation: 1 }), true);
  assert.equal(hasPixelEdits({ ...DEFAULT_EDITS, straighten: 2 }), false);
});


test('design layers normalize untrusted values and restrict fonts', () => {
  const layer = normalizeLayer({ type: 'text', text: '<b>plain text</b>', fontFamily: 'url(evil)', x: 999, opacity: 4 });
  assert.equal(layer.type, 'text');
  assert.equal(layer.fontFamily, 'system-ui');
  assert.equal(layer.x, 150);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.text, '<b>plain text</b>');
});

test('layer creation is deterministic in shape and normalization caps layer count', () => {
  const text = createLayer('text', 'layer-1');
  assert.equal(text.type, 'text');
  assert.equal(text.id, 'layer-1');
  const many = Array.from({ length: 80 }, (_, i) => ({ type: 'rectangle', id: String(i) }));
  assert.equal(normalizeLayers(many).length, 50);
});


test('watermark recipes clamp values and restrict types/fonts', () => {
  const recipe = normalizeWatermark({ enabled: true, type: 'script', fontFamily: 'evil()', opacity: 9, position: 'nowhere', x: 500 });
  assert.equal(recipe.type, 'text');
  assert.equal(recipe.fontFamily, 'system-ui');
  assert.equal(recipe.opacity, 1);
  assert.equal(recipe.position, 'bottom-right');
  assert.equal(recipe.x, 100);
});

test('watermark preset positioning respects margins', () => {
  const recipe = normalizeWatermark({ ...DEFAULT_WATERMARK, position: 'bottom-right', margin: 20 });
  assert.deepEqual(resolveWatermarkPosition(1000, 500, 200, 50, recipe), { x: 880, y: 455 });
});


test('cleanup masks normalize bounded local strokes', () => {
  const cleanup = normalizeCleanup({ enabled: true, strokes: [{ radius: 9, points: [{ x: -1, y: 2 }, { x: .4, y: .6 }] }] });
  assert.equal(cleanup.enabled, true);
  assert.equal(cleanup.strokes[0].radius, .12);
  assert.deepEqual(cleanup.strokes[0].points[0], { x: 0, y: 1 });
  assert.equal(cleanupHasMask(cleanup), true);
});

test('cleanup ignores empty masks and caps stroke count', () => {
  assert.equal(cleanupHasMask(normalizeCleanup({ enabled: true, strokes: [] })), false);
  const many = Array.from({ length: 140 }, () => ({ radius: .01, points: [{ x: .5, y: .5 }] }));
  assert.equal(normalizeCleanup({ enabled: true, strokes: many }).strokes.length, 100);
});
