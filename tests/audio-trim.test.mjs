import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioTrimTimeoutMs,
  normalizeAudioTrimRange,
  selectAudioRecorderMime
} from '../lib/media/render/native-audio-trim.js';

test('audio trim range clamps safely to source duration', () => {
  assert.deepEqual(normalizeAudioTrimRange(-2, 14, 10), { start: 0, end: 10, duration: 10 });
  assert.deepEqual(normalizeAudioTrimRange(2.5, 7.5, 10), { start: 2.5, end: 7.5, duration: 5 });
  assert.deepEqual(normalizeAudioTrimRange(9, 3, 10), { start: 9, end: 9, duration: 0 });
});

test('audio trim timeout follows selected duration instead of a universal media-length maximum', () => {
  const short = audioTrimTimeoutMs(5);
  const long = audioTrimTimeoutMs(60 * 60);
  assert.equal(short >= 30_000, true);
  assert.equal(long > short, true);
});

test('audio MIME selection prefers Opus WebM and falls back to browser-supported audio containers', () => {
  const supported = new Set(['audio/webm', 'audio/mp4']);
  assert.equal(selectAudioRecorderMime((type) => supported.has(type)), 'audio/webm');
  assert.equal(selectAudioRecorderMime(() => false), '');
});
