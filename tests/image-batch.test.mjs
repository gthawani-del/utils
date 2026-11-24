import assert from 'node:assert/strict';
import test from 'node:test';
import { batchCover, batchDimensions, batchFilenames, batchSettings, contactSheetLayout } from '../lib/image/batch.js';
import { drawResize } from '../lib/image/draw-resize.js';

const portrait = { width: 1000, height: 2000 };
const defaults = { framing: 'contain', width: 1080, height: 1080, format: 'webp', quality: .82, targetBytes: 0, padding: 'white' };

test('batch framing distinguishes proportional fit, exact padding, crop and convert only', () => {
  const fit = batchSettings(portrait, { ...defaults, framing: 'fit' });
  const padded = batchSettings(portrait, defaults);
  const crop = batchSettings(portrait, { ...defaults, framing: 'fill' });
  const conversion = batchSettings(portrait, { ...defaults, framing: 'original' });
  assert.deepEqual(batchDimensions(portrait, fit), { width: 540, height: 1080 });
  assert.deepEqual(batchDimensions(portrait, padded), { width: 1080, height: 1080 });
  assert.deepEqual(batchDimensions(portrait, crop), { width: 1080, height: 1080 });
  assert.deepEqual(batchDimensions(portrait, conversion), portrait);
  assert.equal(padded.solidBackground, true);
  assert.equal(crop.solidBackground, false);
  assert.equal(conversion.targetBytes, 0);
  assert.equal(batchSettings(portrait, { ...defaults, padding: 'transparent' }).solidBackground, false);
});

test('batch filenames are ordered, safe and unique even across formats and casing', () => {
  const files = [{ name: 'Front.jpg' }, { name: 'front.png' }, { name: 'front-2.jpeg' }];
  assert.deepEqual(batchFilenames(files, 'webp', ''), ['Front.webp', 'front-2.webp', 'front-2-2.webp']);
  assert.deepEqual(batchFilenames(files, 'jpeg', 'Campaign'), ['Campaign-001.jpg', 'Campaign-002.jpg', 'Campaign-003.jpg']);
  assert.ok(batchFilenames([{ name: 'a'.repeat(200) + '.png' }], 'webp', '')[0].endsWith('.webp'));
});

test('contact sheet uses a bounded grid and allocates room for labels only when requested', () => {
  const sheet = contactSheetLayout(5, 4, true);
  assert.deepEqual(sheet, { columns: 4, tile: 240, gap: 16, labelHeight: 28, width: 1040, height: 584 });
  assert.deepEqual(contactSheetLayout(1, 6, false), {
    columns: 1, tile: 240, gap: 16, labelHeight: 0, width: 272, height: 272,
  });
  const max = contactSheetLayout(50, 6, true);
  assert.ok(max.width * max.height < 5_000_000);
});

test('relative presets preserve individual proportions and max width does not enlarge', () => {
  assert.deepEqual(batchDimensions(portrait, batchSettings(portrait, { ...defaults, preset: 'half' })), { width: 500, height: 1000 });
  assert.deepEqual(batchDimensions(portrait, batchSettings(portrait, { ...defaults, preset: 'max-width' })), portrait);
  const landscape = { width: 3000, height: 2000 };
  assert.deepEqual(batchDimensions(landscape, batchSettings(landscape, { ...defaults, preset: 'max-width' })), { width: 1200, height: 800 });
  assert.deepEqual(batchFilenames([{ name: 'front.jpg' }], 'jpeg', '', '{name}-{width}x{height}-{index}', [portrait]), ['front-1000x2000-001.jpg']);
});

test('a focal point stays on the original photo as crop ratios change', () => {
  const focus = { x: .7, y: .5 };
  assert.equal(batchCover(1000, 500, 400, 400, focus).x, 450);
  assert.equal(batchCover(1000, 500, 200, 400, focus).x, 575);
  assert.equal(batchCover(1000, 500, 400, 400, { x: 1 }).x, 500);
  assert.equal(batchCover(1000, 500, 400, 400, { x: 0 }).x, 0);
});

test('a rounded proxy canvas samples the exact output crop ratio', () => {
  const draws = [];
  const context = { drawImage: (...params) => draws.push(params) };
  const original = { x: 0, y: 0, width: 1000, height: 500 };
  const proxy = { x: 0, y: 0, width: 250, height: 125 };
  const target = { width: 801, height: 641 };
  const settings = { resizeMode: 'fill', batchFocus: { x: .8, y: .5 } };
  drawResize(context, 'original', original, target, settings);
  drawResize(context, 'proxy', proxy, { width: 250, height: 200 }, settings, original, target);
  assert.deepEqual(draws[1].slice(1, 5).map(value => value * 4), draws[0].slice(1, 5));
});
