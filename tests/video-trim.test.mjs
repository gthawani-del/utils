import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containRect,
  normalizeVideoRenderSettings,
  normalizeVideoTrimRange,
  selectVideoOutputTracks,
  selectVideoRecorderMime,
  videoOutputDimensions,
  videoOutputDuration,
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
    { start: 0, end: 10, duration: 10, muted: true, playbackRate: 1, outputDuration: 10, outputAspect: 'original', outputWidth: 1, outputHeight: 1, resizeChanged: false }
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
  assert.deepEqual(selectVideoOutputTracks(stream, stream, true), [videoTrack]);
  assert.deepEqual(selectVideoOutputTracks(stream, stream, false), [videoTrack, audioTrack]);
});


test('video playback-speed render settings change real output duration deterministically', () => {
  assert.equal(videoOutputDuration(20, 2), 10);
  assert.equal(videoOutputDuration(20, 0.5), 40);
  assert.deepEqual(
    normalizeVideoRenderSettings({ start: 2, end: 12, playbackRate: 2, muted: false }, 20),
    { start: 2, end: 12, duration: 10, muted: false, playbackRate: 2, outputDuration: 5, outputAspect: 'original', outputWidth: 1, outputHeight: 1, resizeChanged: false }
  );
});

test('unsupported render playback rate falls back safely to 1x', () => {
  const settings = normalizeVideoRenderSettings({ start: 0, end: 10, playbackRate: 7 }, 10);
  assert.equal(settings.playbackRate, 1);
  assert.equal(settings.outputDuration, 10);
});


test('safe aspect dimensions stay within source/preset pixel budgets and use even encoded dimensions', () => {
  assert.deepEqual(videoOutputDimensions(1920, 1080, '16:9'), { width: 1920, height: 1080, aspect: '16:9', changed: false });
  const vertical = videoOutputDimensions(1920, 1080, '9:16');
  assert.equal(vertical.aspect, '9:16');
  assert.equal(vertical.width % 2, 0);
  assert.equal(vertical.height % 2, 0);
  assert.equal(vertical.width * vertical.height <= 1920 * 1080, true);

  const square = videoOutputDimensions(3840, 2160, '1:1');
  assert.equal(square.width, square.height);
  assert.equal(square.width * square.height <= 1080 * 1080, true);
});

test('original aspect preserves measured source dimensions exactly', () => {
  assert.deepEqual(videoOutputDimensions(1919, 1079, 'original'), { width: 1919, height: 1079, aspect: 'original', changed: false });
});

test('contain fit preserves the entire source frame without cropping', () => {
  const rect = containRect(1920, 1080, 1080, 1920);
  assert.equal(Math.round(rect.width), 1080);
  assert.equal(Math.round(rect.height), 608);
  assert.equal(Math.round(rect.x), 0);
  assert.equal(Math.round(rect.y), 656);
});
