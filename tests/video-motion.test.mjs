import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBeats, beatPulse, parseWordTimings, activeWord, MOTION_TEMPLATES } from '../lib/media/video/motion.js';
import { normalizeTextCue, kineticTextFrame } from '../lib/media/video/kinetic.js';
test('word timing produces bounded individual words', () => {
  const words = parseWordTimings('one two three', 1, 4);
  assert.equal(words.length, 3);
  assert.equal(activeWord(words, 2.5), 1);
  assert.equal(activeWord(words, 4), -1);
});
test('keyframe interpolation and presets', () => {
  const cue = normalizeTextCue({ text: 'Hello', start: 0, end: 4, template: 'cinematic', keyframes: [{time:0,scale:1,y:0},{time:4,scale:2,y:80}] }, 5);
  assert.ok(Math.abs(kineticTextFrame(cue, 2).scale - 1.5) < 0.001);
  assert.ok(kineticTextFrame(cue, 2).offsetY >= 40);
  assert.ok(MOTION_TEMPLATES.rhythm.beatReactive);
});
test('beat pulses decay and invalid input is safe', () => {
  assert.equal(beatPulse([1], 1), 1);
  assert.equal(beatPulse([1], 2), 0);
  assert.deepEqual(detectBeats([], 44100), []);
});
