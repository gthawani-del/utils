import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lyricCuesFromLrc } from '../lib/media/video/lyrics-sync.js';
import { normalizeTextCue, kineticTextFrame } from '../lib/media/video/kinetic.js';

test('LRC importer preserves line timing and generates karaoke word cues', () => {
  const lyrics = '[00:01.00]Hello world\n[00:03.50]Next line';
  const cues = lyricCuesFromLrc(lyrics, 6);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].words.length, 2);
  assert.equal(cues[0].template, 'rhythm');
});
test('invalid and out-of-range lyrics are rejected', () => {
  assert.deepEqual(parseLrc('not timed', 10), []);
  assert.deepEqual(parseLrc('[00:12.00]Too late', 10), []);
});
test('text style is normalized and animation stays deterministic', () => {
  const cue = normalizeTextCue({text:'Hello',start:0,end:3,effect:'zoom',style:{font:'serif',size:90,color:'#ff0000'}},5);
  assert.equal(cue.style.font,'serif');
  assert.equal(cue.style.color,'#ff0000');
  assert.ok(kineticTextFrame(cue,0.1).scale < kineticTextFrame(cue,1).scale);
  assert.equal(normalizeTextCue({...cue,style:{font:'unknown',color:'red'}},5).style.color,'#ffffff');
});
