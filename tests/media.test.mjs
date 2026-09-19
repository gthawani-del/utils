import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffMediaBytes, validateMediaUrl, validateMediaFileBudget } from '../lib/media/ingest.js';

test('sniffs MP4 family from ftyp signature', () => {
  const bytes = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]);
  const result = sniffMediaBytes(bytes);
  assert.equal(result.supported, true);
  assert.equal(result.container, 'mp4');
  assert.equal(result.mediaType, 'video');
});

test('sniffs WAV without trusting filename', () => {
  const bytes = new Uint8Array([...Buffer.from('RIFF'),0,0,0,0,...Buffer.from('WAVE')]);
  const result = sniffMediaBytes(bytes);
  assert.equal(result.supported, true);
  assert.equal(result.mime, 'audio/wav');
});

test('rejects unknown media signatures', () => {
  const result = sniffMediaBytes(new Uint8Array([1,2,3,4,5,6]));
  assert.equal(result.supported, false);
});

test('media file budget rejects zero byte and over-budget inputs', () => {
  assert.equal(validateMediaFileBudget({ size: 0 }).ok, false);
  assert.equal(validateMediaFileBudget({ size: 2 * 1024 * 1024 * 1024 + 1 }).ok, false);
  assert.equal(validateMediaFileBudget({ size: 1024 }).ok, true);
});

test('provider URL validation only allows HTTPS YouTube and Vimeo video URLs', () => {
  assert.equal(validateMediaUrl('http://youtube.com/watch?v=abc').ok, false);
  assert.equal(validateMediaUrl('https://youtube.com.evil.test/watch?v=abc').ok, false);
  assert.equal(validateMediaUrl('https://127.0.0.1/video').ok, false);
  assert.equal(validateMediaUrl('https://www.youtube.com/watch?v=abc123').ok, true);
  assert.equal(validateMediaUrl('https://youtu.be/abc123').ok, true);
  assert.equal(validateMediaUrl('https://vimeo.com/123456789').ok, true);
});
