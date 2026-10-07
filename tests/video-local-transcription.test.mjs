import test from 'node:test';
import assert from 'node:assert/strict';
import { speechSegmentsToCues } from '../lib/media/video/local-transcription.js';
test('speech model timestamps are converted to bounded cues', () => {
  const cues = speechSegmentsToCues([{ text:' hello', timestamp:[1,1.5] },{ text:'world',timestamp:[1.5,2]}],3);
  assert.deepEqual(cues,[{text:'hello',start:1,end:1.5},{text:'world',start:1.5,end:2}]);
});
test('invalid recognition timestamps are discarded', () => {
  assert.deepEqual(speechSegmentsToCues([{text:'x',timestamp:[-1,1]},{text:'',timestamp:[1,2]}],3),[]);
});
