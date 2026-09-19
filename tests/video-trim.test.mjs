import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVideoRenderSettings,
  normalizeVideoTrimRange,
  selectVideoOutputTracks,
  selectVideoRecorderMime,
  videoTrimTimeoutMs
} from '../lib/media/render/native-trim.js';

test('video trim range clamps to source duration deterministically', () => {
  assert.deepEqual(normalizeVideoTrimRange(-5, 14, 10), { start: 0, end: 10, duration: 10 });
  assert.deepEqual(normalizeVideoTrimRange(3, 8, 10), { start: 3, end: 8, duration: 5 });
  assert.deepEqual(normalizeVideoTrimRange(8, 3, 10), { start: 8, end: 8, duration: 0 });
});

test('video trim timeout scales with selected duration rather than using a universal media-length cap', () => {
  const short = videoTrimTimeoutMs(5);
  const long = videoTrimTimeoutMs(60 * 60);
  assert.equal(short >= 30_000, true);
  assert.equal(long > short, true);
});

test('video recorder MIME selection prefers supported WebM codecs and falls back safely', () => {
  const supported = new Set(['video/webm;codecs=vp8,opus', 'video/webm']);
  const selected = selectVideoRecorderMime((type) => supported.has(type));
  assert.equal(selected, 'video/webm;codecs=vp8,opus');
  assert.equal(selectVideoRecorderMime(() => false), '');
});


test('video render settings carry mute independently from trim', () => {
  assert.deepEqual(
    normalizeVideoRenderSettings({ start: 0, end: 10, muted: true }, 10),
    { start: 0, end: 10, duration: 10, muted: true }
  );
  assert.equal(normalizeVideoRenderSettings({ start: 2, end: 8, muted: false }, 10).muted, false);
});

test('mute render removes audio tracks from the recorder stream plan', () => {
  const videoTrack = { kind: 'video', id: 'v1' };
  const audioTrack = { kind: 'audio', id: 'a1' };
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [audioTrack]
  };
  assert.deepEqual(selectVideoOutputTracks(stream, true), [videoTrack]);
  assert.deepEqual(selectVideoOutputTracks(stream, false), [videoTrack, audioTrack]);
});
