import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVideoTrimRange,
  selectVideoRecorderMime,
  videoTrimTimeoutMs
} from '../lib/media/render/native-trim.js';

test('video trim range clamps to source duration deterministically', () => {
  assert.deepEqual(normalizeVideoTrimRange(-5, 14, 10), { start: 0, end: 10, duration: 10 });
  assert.deepEqual(normalizeVideoTrimRange(3, 8, 10), { start: 3, end: 8, duration: 5 });
  assert.deepEqual(normalizeVideoTrimRange(8, 3, 10), { start: 8, end: 8, duration: 0 });
});

test('video trim timeout scales with selected duration rather than using a universal media-length cap', () => {
  const short = videoTrimTimeoutMs(5);
  const long = videoTrimTimeoutMs(60 * 60);
  assert.equal(short >= 30_000, true);
  assert.equal(long > short, true);
});

test('video recorder MIME selection prefers supported WebM codecs and falls back safely', () => {
  const supported = new Set(['video/webm;codecs=vp8,opus', 'video/webm']);
  const selected = selectVideoRecorderMime((type) => supported.has(type));
  assert.equal(selected, 'video/webm;codecs=vp8,opus');
  assert.equal(selectVideoRecorderMime(() => false), '');
});
