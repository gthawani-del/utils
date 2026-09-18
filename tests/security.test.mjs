import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFileBudget, validateBatchBudget, validateDimensions } from '../lib/security/budget.js';
import { sanitizeFilename, exportFilename } from '../lib/security/filename.js';
import { sniffBytes } from '../lib/security/sniff.js';
import { sanitizeSvgText } from '../lib/security/svg.js';
import { OperationState, ok, fail, timedOut } from '../lib/security/result.js';

test('zero-byte and oversized files are rejected', () => {
  assert.equal(validateFileBudget({ size: 0 }).ok, false);
  assert.equal(validateFileBudget({ size: 41 * 1024 * 1024 }).ok, false);
});

test('batch budgets are cumulative', () => {
  const files = Array.from({ length: 6 }, () => ({ size: 45 * 1024 * 1024 }));
  assert.equal(validateBatchBudget(files).ok, false);
});

test('decoded megapixel budget blocks decompression-bomb style dimensions', () => {
  assert.equal(validateDimensions(12000, 12000).ok, false);
  assert.equal(validateDimensions(4000, 3000).ok, true);
});

test('signatures override filenames and MIME claims', () => {
  const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  assert.equal(sniffBytes(png).kind, 'png');
  const fake = new TextEncoder().encode('not really a jpeg');
  assert.equal(sniffBytes(fake).kind, 'unknown');
});

test('AVIF requires an AVIF compatible brand and generic HEIF is not accepted', () => {
  const generic = new Uint8Array(24); generic.set(new TextEncoder().encode('ftyp'), 4); generic.set(new TextEncoder().encode('heic'), 8);
  assert.equal(sniffBytes(generic).kind, 'unknown');
  const avif = new Uint8Array(24); avif.set(new TextEncoder().encode('ftyp'), 4); avif.set(new TextEncoder().encode('avif'), 8);
  assert.equal(sniffBytes(avif).kind, 'avif');
});

test('SVG executable and external content is rejected', () => {
  assert.throws(() => sanitizeSvgText('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => sanitizeSvgText('<svg onload="alert(1)"></svg>'));
  assert.throws(() => sanitizeSvgText('<svg><image href="https://example.com/a.png"/></svg>'));
  assert.throws(() => sanitizeSvgText('<!DOCTYPE svg><svg></svg>'));
  assert.equal(sanitizeSvgText('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>').startsWith('<svg'), true);
});

test('export filenames block traversal, control chars, reserved names and extension injection', () => {
  assert.equal(sanitizeFilename('../../CON?.jpg').includes('/'), false);
  assert.equal(sanitizeFilename('bad\u0000name.png').includes('\u0000'), false);
  assert.equal(exportFilename('../photo.exe', 'webp').endsWith('.webp'), true);
});

test('operation states are controlled', () => {
  assert.equal(ok(1).state, OperationState.COMPLETED);
  assert.equal(fail('x').state, OperationState.FAILED);
  assert.equal(timedOut().state, OperationState.TIMED_OUT);
});
