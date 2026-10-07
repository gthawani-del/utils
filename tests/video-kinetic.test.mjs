import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTextCue, kineticTextFrame } from '../lib/media/video/kinetic.js';
test('normalizes valid text and animation', () => {
  assert.deepEqual(normalizeTextCue({ text: ' Hello ', start: 1, end: 3, effect: 'pop' }, 5), { text: 'Hello', start: 1, end: 3, effect: 'pop' });
});
test('rejects empty text and invalid times', () => {
  assert.throws(() => normalizeTextCue({ text: '', start: 0, end: 2 }), RangeError);
  assert.throws(() => normalizeTextCue({ text: 'x', start: 3, end: 2 }), RangeError);
  assert.throws(() => normalizeTextCue({ text: 'x', start: 1, end: 9 }, 5), RangeError);
});
test('effect frames are deterministic and time-bounded', () => {
  const cue = normalizeTextCue({ text: 'Hello', start: 1, end: 3, effect: 'slide' });
  assert.equal(kineticTextFrame(cue, 0), null);
  assert.equal(kineticTextFrame(cue, 3), null);
  assert.ok(kineticTextFrame(cue, 1.1).offsetY > 0);
  assert.equal(kineticTextFrame(cue, 2).offsetY, 0);
});
