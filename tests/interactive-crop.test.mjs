import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedCrop, cropFrameSize, cropInPixels, dragCropCorner, ratioCrop, scaleCrop } from '../lib/image/interactive-crop.js';

test('crop presets preserve ratios on portrait photos and allow frames near the edges', () => {
  const dims = { width: 1800, height: 2400 };
  const frame = ratioCrop(dims.width, dims.height, 16 / 9, .5, .9);
  const crop = cropInPixels(dims.width, dims.height, frame);
  assert.ok(crop.y > 1000);
  assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < .005);
  assert.ok(crop.y + crop.height <= dims.height);
  assert.deepEqual(cropFrameSize(1800, 2400, 1), { width: 2400, height: 1800 });
});

test('pinch and locked corners preserve proportions and opposite anchor', () => {
  const rect = ratioCrop(1000, 1000, .8);
  const zoom = scaleCrop(rect, .5);
  assert.ok(Math.abs(zoom.width / zoom.height - .8) < .0001);
  const corner = dragCropCorner(rect, 'nw', .3, .2, .8);
  assert.ok(Math.abs(corner.width / corner.height - .8) < .0001);
  assert.ok(Math.abs(corner.x + corner.width - rect.x - rect.width) < .0001);
  assert.ok(Math.abs(corner.y + corner.height - rect.y - rect.height) < .0001);
  const free = dragCropCorner(rect, 'nw', .3, .2, 0);
  assert.notEqual(free.width / free.height, .8);
});

test('moving a crop outside the photo clamps the frame within the image', () => {
  assert.deepEqual(boundedCrop({ x: -1, y: 2, width: .2, height: .4 }), { x: 0, y: .6, width: .2, height: .4 });
});
