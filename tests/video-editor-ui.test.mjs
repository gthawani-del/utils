import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tools, quickTools } from '../assets/tool-directory.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('standalone video editor loads dedicated presentation only', async () => {
  const [standalone, studio] = await Promise.all([read('media/video-editor/index.html'), read('media/index.html')]);
  assert.match(standalone, /video-editor-ui\.css/);
  assert.match(standalone, /video-editor-ui\.js/);
  assert.doesNotMatch(studio, /video-editor-ui\.css/);
  assert.doesNotMatch(studio, /video-editor-ui\.js/);
  assert.match(studio, /id="audio-editor-panel"/);
});

test('all eight tool groups and playback controls have handlers', async () => {
  const script = await read('assets/video-editor-ui.js');
  const markup = await read('media/video-editor/index.html');
  for (const group of ['edit','kinetic','captions','audio','effects','adjust','reframe','more']) {
    assert.ok(markup.includes('data-studio-tool="' + group + '"'));
    assert.ok(script.includes(group + ': ['));
  }
  for (const control of ['studio-v2-play','studio-v2-export','studio-v2-seek','studio-v2-add-clips']) {
    assert.ok(script.includes(control));
  }
  assert.match(script, /buildThumbnails/);
  assert.match(script, /decodeAudioData/);
});

test('homepage retains dedicated Video Editor link', async () => {
  assert.equal(quickTools.find(tool => tool.id === 'trim-video')?.href, '/media/video-editor');
  assert.equal(tools.find(tool => tool.id === 'video-editor')?.href, '/media/video-editor');
});
