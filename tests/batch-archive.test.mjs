import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { exportBatch } from '../lib/image/batch-archive.js';
import { cameraExif, addCameraExif } from '../lib/image/batch-exif.js';
import { parseExifSummary } from '../lib/image/preflight.js';
import { ok, fail } from '../lib/security/result.js';

const dimensions = { width: 800, height: 400 };
const options = { framing: 'original', format: 'jpeg', targetBytes: 300_000 };
const item = id => ({ id, file: new File(['test'], 'image.jpg'), inspect: { kind: 'jpeg', dimensions } });
const image = new Blob([Uint8Array.from([255, 216, 255, 217]), new Uint8Array(270_000)], { type: 'image/jpeg' });

test('stored archive slices match unzipped bytes and retry names keep their original ordering', async () => {
  const first = { ...item(1), skip: true };
  const events = [];
  const result = await exportBatch([first, item(2), item(3)], options, {
    report: event => events.push(event),
    process: async entry => entry.id === 2 ? ok({ blob: image, mime: image.type, ...dimensions }) : fail('Test failure'),
  });
  assert.deepEqual(events.filter(event => event.type === 'progress').map(event => [event.current, event.total]), [[1, 2], [2, 2]]);
  assert.equal(events.at(-1).message, 'Test failure');
  const [output] = result.outputs;
  assert.equal(output.name, 'image-2.jpg');
  const slice = new Uint8Array(await result.blob.slice(output.start, output.start + output.size).arrayBuffer());
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(slice, files[output.name]);
  assert.deepEqual(slice, new Uint8Array(await image.arrayBuffer()));
});

test('camera metadata is rebuilt, GPS excluded, and strict limit includes the new bytes', async () => {
  const exif = { make: 'Test', model: 'Camera', dateTimeOriginal: '2026:11:25 12:00:00', hasGps: true, orientation: 6 };
  const tagged = addCameraExif(image, cameraExif(exif));
  const details = parseExifSummary(new Uint8Array(await tagged.arrayBuffer()));
  assert.deepEqual(details, { ...exif, hasGps: false, orientation: 1, hasExif: true });
  const entry = item(1);
  entry.inspect.exif = exif;
  const events = [];
  const result = await exportBatch([entry], { ...options, keepCamera: true, targetBytes: image.size }, {
    report: event => events.push(event),
    process: async (_, settings) => {
      assert.ok(settings.targetBytes < image.size);
      return ok({ blob: image, mime: image.type, ...dimensions });
    },
  });
  assert.equal(result.blob, null);
  assert.match(events.at(-1).message, /maximum file size/);
});
