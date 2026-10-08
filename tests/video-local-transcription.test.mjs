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

test('recognizer uses supported Transformers.js v3 Whisper browser runtime', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../lib/media/video/local-transcription.js', import.meta.url), 'utf8');
  assert.match(source, /@huggingface\/transformers@3\.8\.1/);
  assert.doesNotMatch(source, /@xenova\/transformers@2\.17\.2/);
  assert.match(source, /device: 'wasm'/);
  assert.match(source, /dtype: 'q8'/);
});
