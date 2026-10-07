import test from 'node:test';
import assert from 'node:assert/strict';
import { outputDimensions, supportedVideoExportFormats } from '../lib/media/video/render.js';

test('export dimensions honor portrait, landscape and square presets', () => {
  assert.deepEqual(outputDimensions(1920, 1080, '9:16'), { width: 720, height: 1280 });
  assert.deepEqual(outputDimensions(1920, 1080, '16:9'), { width: 1280, height: 720 });
  assert.deepEqual(outputDimensions(1080, 1920, '1:1'), { width: 1280, height: 1280 });
});
test('rejects invalid export geometry', () => {
  assert.throws(() => outputDimensions(0, 100, 'original'), RangeError);
  assert.throws(() => outputDimensions(100, 100, 'unknown'), RangeError);
});

test('MP4 is offered only with browser codec support', () => {
  const formats = supportedVideoExportFormats({ isTypeSupported: type => type.includes('mp4') });
  assert.ok(formats.some(item => item.format === 'mp4'));
  assert.ok(!formats.some(item => item.format === 'webm'));
});
test('WebM remains available as a fallback', () => {
  const formats = supportedVideoExportFormats({ isTypeSupported: type => type.includes('webm') });
  assert.ok(!formats.some(item => item.format === 'mp4'));
  assert.ok(formats.some(item => item.format === 'webm'));
  assert.deepEqual(supportedVideoExportFormats(null), []);
});
