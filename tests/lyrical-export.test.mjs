import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_LIMITS, frameCount, frameTiming, validateExportSettings,
  validateExportInput, createOutputStore, probeExport
} from '../lib/lyrical/export.js';

function fakeAudio(seconds = 1, sampleRate = 48000, channels = 2) {
  return {
    length: Math.round(seconds * sampleRate), sampleRate, numberOfChannels: channels,
    getChannelData() { throw new Error('Validation must not allocate or read audio.'); }
  };
}

test('full-song frame schedule has no accumulated drift and clips its last frame', () => {
  const duration = 200.72;
  const count = frameCount(duration, 30);
  assert.equal(count, 6022);
  let end = 0;
  for (let index = 0; index < count; index++) {
    const frame = frameTiming(index, duration, 30);
    assert.equal(frame.timestamp, index / 30);
    assert.ok(Math.abs(frame.timestamp - end) < 1e-12);
    assert.ok(frame.duration > 0 && frame.duration <= 1 / 30 + 1e-12);
    end = frame.timestamp + frame.duration;
  }
  assert.equal(end, duration);
  assert.equal(frameCount(300, 30), 9000);
  assert.equal(frameCount(1 / 96000, 30), 1);
  assert.throws(() => frameTiming(count, duration, 30), /frame index/);
});

test('five-minute, resolution, channel and PCM memory limits are checked before allocation', () => {
  assert.throws(() => frameCount(300.01), /five minutes/);
  assert.throws(() => frameCount(0), /five minutes/);
  assert.throws(() => validateExportSettings({ width: 1081, height: 1920 }), /1080p/);
  assert.throws(() => validateExportSettings({ width: 1920, height: 1920 }), /1080p/);
  assert.throws(() => validateExportSettings({ width: 720, height: 1280, numberOfChannels: 6 }), /mono or stereo/);
  assert.throws(() => validateExportSettings({ width: 720, height: 1280, fps: 60 }), /24, 25 or 30/);
  assert.throws(() => validateExportInput({
    canvas: { width: 720, height: 1280 }, drawFrame() {}, audioBuffer: fakeAudio(300, 96000)
  }), /too large/);
  assert.equal(validateExportInput({
    canvas: { width: 1080, height: 1920 }, drawFrame() {}, audioBuffer: fakeAudio(300)
  }).totalFrames, 9000);
  assert.equal(EXPORT_LIMITS.maxOutputBytes, 256 * 1024 * 1024);
});

test('complete original decoded audio determines duration, never silently trims or stretches it', () => {
  const input = { canvas: { width: 720, height: 1280 }, drawFrame() {}, audioBuffer: fakeAudio(4.123) };
  assert.equal(validateExportInput(input).duration, input.audioBuffer.length / 48000);
  assert.throws(() => validateExportInput({ ...input, duration: 4 }), /complete song/);
  assert.throws(() => validateExportInput({ ...input, format: 'gif' }), /MP4 or WebM/);
});

test('seekable output supports cross-block writes and late container-header patches', async () => {
  const store = createOutputStore(32, 4);
  store.write(0, new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
  store.write(3, new Uint8Array([8, 9, 10]));
  store.write(10, new Uint8Array([11, 12]));
  assert.equal(store.size, 12);
  const blob = store.toBlob('video/mp4');
  assert.equal(blob.type, 'video/mp4');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 8, 9, 10, 7, 0, 0, 0, 11, 12]);
  store.clear();
  assert.equal(store.size, 0);
  assert.throws(() => store.toBlob('video/mp4'), /empty/);
  assert.equal(blob.size, 12, 'clearing working blocks must not alter a completed download');
});

test('output byte limit rejects before a large allocation and preserves existing data', async () => {
  const store = createOutputStore(9, 4);
  store.write(0, new Uint8Array([1]));
  assert.throws(() => store.write(8, new Uint8Array(2)), /size limit/);
  assert.equal(store.size, 1);
  store.write(8, new Uint8Array([9]));
  assert.equal(store.size, 9);
  assert.equal((new Uint8Array(await store.toBlob('video/webm').arrayBuffer()))[8], 9);
  assert.throws(() => store.write(-1, new Uint8Array(1)), /Invalid/);
});

test('unsupported browser returns no formats without loading encoder bundle', async () => {
  assert.deepEqual(await probeExport({ width: 720, height: 1280 }), []);
});
