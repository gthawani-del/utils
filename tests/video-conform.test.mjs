import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSmoothMatch, validateConformSources, timelinePositionToSegment } from '../lib/media/video/conform.js';
import { outputDimensions } from '../lib/media/video/render.js';
test('Smooth & Match defaults to 9:16 fit 30fps', () => {
  assert.deepEqual(normalizeSmoothMatch(), { aspect: '9:16', fit: 'contain', fps: 30 });
  assert.deepEqual(outputDimensions(1920, 1080, '9:16'), { width: 720, height: 1280 });
});
test('mixed source durations and clip mapping', () => {
  const sources = { a: { objectUrl:'blob:a', duration: 5 }, b: { objectUrl:'blob:b', duration: 9 } };
  const segments = [{sourceId:'a',start:1,end:4},{sourceId:'b',start:2,end:7}];
  assert.equal(validateConformSources(segments,sources),8);
  assert.deepEqual(timelinePositionToSegment(segments,4), { index:1,sourceId:'b',sourceTime:3 });
});
test('rejects missing source, invalid trims and overlong exports', () => {
  const sources = { a:{objectUrl:'blob:a',duration:5} };
  assert.throws(() => validateConformSources([{sourceId:'b',start:0,end:1}],sources),RangeError);
  assert.throws(() => validateConformSources([{sourceId:'a',start:0,end:6}],sources),RangeError);
  assert.throws(() => validateConformSources([{sourceId:'a',start:3,end:3}],sources),RangeError);
});
