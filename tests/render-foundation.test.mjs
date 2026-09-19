import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_RENDER_BUDGET, preflightRenderJob, renderJobTimeoutMs } from '../lib/media/render/budget.js';
import { validateRenderBlobStructure } from '../lib/media/render/validate.js';

test('render preflight uses operation-specific limits without a fake duration maximum', () => {
  const file = new Blob(['media']);
  const source = {
    kind: 'local-file',
    file,
    bytes: file.size,
    duration: 60 * 60 * 8,
    mediaType: 'audio'
  };
  const result = preflightRenderJob(source, { deviceMemory: 8 });
  assert.equal(result.ok, true);
  assert.equal(result.duration, 60 * 60 * 8);
  assert.equal(result.complexity, 'low');
});

test('render preflight warns based on device/file pressure and estimates decoded frame memory', () => {
  const size = MEDIA_RENDER_BUDGET.lowMemoryWarningBytes + 1;
  const fakeFile = { size };
  Object.setPrototypeOf(fakeFile, Blob.prototype);
  const source = {
    kind: 'local-file',
    file: fakeFile,
    bytes: size,
    duration: 10,
    width: 8000,
    height: 5000,
    mediaType: 'video'
  };
  const result = preflightRenderJob(source, { deviceMemory: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length >= 1, true);
  assert.equal(result.decodedFrameBytes, 8000 * 5000 * 4);
});

test('worker timeout scales with input size and stays bounded', () => {
  const small = renderJobTimeoutMs(1024);
  const large = renderJobTimeoutMs(2 * 1024 * 1024 * 1024);
  assert.equal(small >= MEDIA_RENDER_BUDGET.baseTimeoutMs, true);
  assert.equal(large <= MEDIA_RENDER_BUDGET.maxTimeoutMs, true);
  assert.equal(large >= small, true);
});

test('render output structural validation rejects empty and mismatched proof outputs', () => {
  const empty = validateRenderBlobStructure(new Blob([], { type: 'audio/mpeg' }), { bytes: 10, mime: 'audio/mpeg' });
  assert.equal(empty.ok, false);

  const wrongSize = validateRenderBlobStructure(new Blob(['abc'], { type: 'audio/mpeg' }), { bytes: 4, mime: 'audio/mpeg' });
  assert.equal(wrongSize.ok, false);

  const wrongType = validateRenderBlobStructure(new Blob(['abcd'], { type: 'audio/wav' }), { bytes: 4, mime: 'audio/mpeg' });
  assert.equal(wrongType.ok, false);

  const good = validateRenderBlobStructure(new Blob(['abcd'], { type: 'audio/mpeg' }), { bytes: 4, mime: 'audio/mpeg' });
  assert.equal(good.ok, true);
});
