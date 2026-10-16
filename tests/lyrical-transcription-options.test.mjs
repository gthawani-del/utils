import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionOptions} from '../lib/lyrical/transcription-options.js';
const config={decoder_start_token_id:50258,lang_to_id:{'<|en|>':50259,'<|hi|>':50276},task_to_id:{transcribe:50359,translate:50358},no_timestamps_token_id:50363};
test('selected language is in the actual decoder prefix and transcription task',()=>{
 assert.deepEqual(transcriptionOptions('hi',config).decoder_input_ids,[50258,50276,50359,50363]);
 assert.deepEqual(transcriptionOptions('en',config).decoder_input_ids,[50258,50259,50359,50363]);
 assert.equal(transcriptionOptions('hi',config).return_timestamps,'word');
});
test('missing or unsupported language cannot silently become English',()=>{
 for(const lang of ['', 'auto', 'unknown'])assert.throws(()=>transcriptionOptions(lang,config),/Choose a supported/);
 assert.throws(()=>transcriptionOptions('hi',{}),/Choose a supported/);
});
