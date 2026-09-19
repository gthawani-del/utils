import test from 'node:test';
import assert from 'node:assert/strict';
import { audioSelectionDuration, createAudioEdits, normalizeAudioEdits, previewVolumeAt, updateAudioEdits } from '../lib/media/audio/edits.js';

test('audio edit state starts as full selection at unity volume', () => {
  assert.deepEqual(createAudioEdits(20), {
    trimStart: 0,
    trimEnd: 20,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0
  });
});

test('audio edit values clamp safely', () => {
  assert.deepEqual(
    normalizeAudioEdits({ trimStart: -5, trimEnd: 50, volume: 3, fadeIn: 99, fadeOut: -1 }, 10),
    { trimStart: 0, trimEnd: 10, volume: 1, fadeIn: 10, fadeOut: 0 }
  );
});

test('audio selection duration is deterministic', () => {
  const edited = updateAudioEdits(createAudioEdits(30), { trimStart: 5, trimEnd: 22.5 }, 30);
  assert.equal(audioSelectionDuration(edited, 30), 17.5);
});

test('preview volume applies linear fades without boosting above unity', () => {
  const edits = normalizeAudioEdits({ trimStart: 2, trimEnd: 12, volume: 0.8, fadeIn: 2, fadeOut: 2 }, 12);
  assert.equal(previewVolumeAt(2, edits, 12), 0);
  assert.equal(previewVolumeAt(3, edits, 12), 0.4);
  assert.equal(previewVolumeAt(7, edits, 12), 0.8);
  assert.equal(previewVolumeAt(11, edits, 12), 0.4);
  assert.equal(previewVolumeAt(12, edits, 12), 0);
});
