import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
test('dedicated editor has Lyrics entry, language picker and no-lyrics result', async () => {
  const ui = await read('assets/video-editor-ui.js');
  assert.match(ui, /data-studio-tool="captions"[^\n]*Lyrics/);
  assert.match(ui, /id="studio-lyrics-language"/);
  assert.match(ui, /No lyrics detected/);
  for (const language of ['auto','english','hindi','marathi','tamil','telugu','bengali','gujarati','punjabi','kannada','malayalam','urdu']) {
    assert.ok(ui.includes('value="' + language + '"'), language);
  }
});
test('recognition is multilingual and Media Studio remains isolated', async () => {
  const engine = await read('lib/media/video/local-transcription.js');
  assert.match(engine, /Xenova\/whisper-tiny'/);
  assert.match(engine, /options\.language = language/);
  const media = await read('media/index.html');
  assert.doesNotMatch(media, /studio-lyrics-language/);
});
