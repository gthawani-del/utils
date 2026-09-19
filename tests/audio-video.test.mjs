import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioVideoConfig, lyricFrame, normalizeAudioVideoConfig, outputDimensions } from '../lib/media/audio-video/visualizer.js';

test('audio-video config derives useful local defaults', () => {
  const config = createAudioVideoConfig({ name: 'episode-one.mp3' }, { title: 'Episode One', artist: 'Host', lines: [] });
  assert.equal(config.title, 'Episode One');
  assert.equal(config.artist, 'Host');
  assert.equal(config.mode, 'bars');
  assert.equal(config.aspect, '16:9');
});

test('audio-video settings clamp to supported deterministic presets', () => {
  const config = normalizeAudioVideoConfig({ mode: 'unknown', aspect: '4:3', theme: 'other', showLyrics: true }, { name: 'track.wav' }, null);
  assert.equal(config.mode, 'bars');
  assert.equal(config.aspect, '16:9');
  assert.equal(config.theme, 'midnight');
  assert.equal(config.showLyrics, true);
});

test('multi-format dimensions are deterministic', () => {
  assert.deepEqual(outputDimensions('16:9'), { width: 1280, height: 720 });
  assert.deepEqual(outputDimensions('9:16'), { width: 720, height: 1280 });
  assert.deepEqual(outputDimensions('1:1'), { width: 720, height: 720 });
  assert.deepEqual(outputDimensions('9:16', { compact: true }), { width: 540, height: 960 });
});

test('lyric frame exposes explicit word progress without inventing timing', () => {
  const lyrics = {
    lines: [{
      id: 'line-1',
      start: 5,
      text: 'Hello world',
      words: [{ start: 5, text: 'Hello' }, { start: 5.5, text: 'world' }]
    }]
  };
  const frame = lyricFrame(lyrics, 5.6);
  assert.equal(frame.text, 'Hello world');
  assert.deepEqual(frame.words.map((word) => word.active), [true, true]);
});
