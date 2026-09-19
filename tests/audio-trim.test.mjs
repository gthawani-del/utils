import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioGainPlan,
  audioTrimTimeoutMs,
  normalizeAudioRenderSettings,
  normalizeAudioTrimRange,
  selectAudioRecorderMime
} from '../lib/media/render/native-audio-trim.js';

test('audio trim range clamps safely to source duration', () => {
  assert.deepEqual(normalizeAudioTrimRange(-2, 14, 10), { start: 0, end: 10, duration: 10 });
  assert.deepEqual(normalizeAudioTrimRange(2.5, 7.5, 10), { start: 2.5, end: 7.5, duration: 5 });
  assert.deepEqual(normalizeAudioTrimRange(9, 3, 10), { start: 9, end: 9, duration: 0 });
});

test('audio render settings chain trim, volume and fades deterministically', () => {
  assert.deepEqual(
    normalizeAudioRenderSettings({ trimStart: 2, trimEnd: 8, volume: 0.65, fadeIn: 1.5, fadeOut: 2 }, 10),
    { start: 2, end: 8, duration: 6, volume: 0.65, fadeIn: 1.5, fadeOut: 2 }
  );
  assert.deepEqual(
    normalizeAudioRenderSettings({ trimStart: 0, trimEnd: 5, volume: 4, fadeIn: 10, fadeOut: -1 }, 5),
    { start: 0, end: 5, duration: 5, volume: 1, fadeIn: 5, fadeOut: 0 }
  );
});

test('gain plan keeps fades independent so overlapping fades multiply instead of overwriting each other', () => {
  const plan = audioGainPlan({ start: 0, end: 4, sourceDuration: 4, volume: 0.5, fadeIn: 3, fadeOut: 3 });
  assert.equal(plan.volume, 0.5);
  assert.equal(plan.fadeIn, 3);
  assert.equal(plan.fadeOut, 3);
  assert.equal(plan.fadeOutStart, 1);
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
