import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSilentRanges, keepRangesWithoutSilence } from '../lib/media/video/smart-audio.js';
test('detects sustained silence and retains spoken sections', () => {
  const samples = new Float32Array(5000);
  for (let i = 0; i < 1000; i++) samples[i] = 0.5;
  for (let i = 3000; i < 5000; i++) samples[i] = 0.5;
  const ranges = detectSilentRanges(samples, 1000);
  assert.equal(ranges.length, 1);
  assert.equal(keepRangesWithoutSilence(5, ranges).length, 2);
});
test('empty audio is safe', () => {
  assert.deepEqual(detectSilentRanges([], 1000), []);
});
