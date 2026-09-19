import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoEdits, normalizeVideoEdits, selectionDuration, updateVideoEdits } from '../lib/media/video/edits.js';

test('video edit state starts as full-duration selection', () => {
  assert.deepEqual(createVideoEdits(12.5), { trimStart: 0, trimEnd: 12.5, playbackRate: 1 });
});

test('video trim bounds are clamped to duration', () => {
  assert.deepEqual(
    normalizeVideoEdits({ trimStart: -2, trimEnd: 99, playbackRate: 7 }, 10),
    { trimStart: 0, trimEnd: 10, playbackRate: 1 }
  );
});

test('video trim end never precedes trim start', () => {
  assert.deepEqual(
    normalizeVideoEdits({ trimStart: 8, trimEnd: 3, playbackRate: 1 }, 10),
    { trimStart: 8, trimEnd: 8, playbackRate: 1 }
  );
});

test('video edit patches remain deterministic', () => {
  const initial = createVideoEdits(30);
  const edited = updateVideoEdits(initial, { trimStart: 4.25, trimEnd: 20.5, playbackRate: 1.5 }, 30);
  assert.equal(selectionDuration(edited, 30), 16.25);
  assert.equal(edited.playbackRate, 1.5);
});
