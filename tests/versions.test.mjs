import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL_VERSION_ID,
  activeVersion,
  editingBaseLabel,
  normalizeMediaVersion,
  normalizeVersionState,
  originalSourceNode,
  sourceMetadataFingerprint
} from '../lib/media/versions/model.js';

test('version state starts from immutable Original with no rendered result', () => {
  const state = normalizeVersionState({});
  assert.deepEqual(state, {
    versions: [],
    activeVersionId: null,
    baseVersionId: ORIGINAL_VERSION_ID
  });
  assert.equal(activeVersion(state), null);
  assert.equal(editingBaseLabel(state), 'Original');
});

test('Original source descriptor is immutable and stable across transient blob URLs', () => {
  const base = {
    kind: 'local-file',
    name: 'clip.mp4',
    bytes: 1000,
    container: 'mp4',
    detectedMime: 'video/mp4',
    mediaType: 'video',
    duration: 10,
    width: 1920,
    height: 1080
  };
  const first = originalSourceNode({ ...base, objectUrl: 'blob:first' });
  const second = originalSourceNode({ ...base, objectUrl: 'blob:second' });
  assert.equal(first.id, 'original');
  assert.equal(first.immutable, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.equal(sourceMetadataFingerprint({ ...base, bytes: 1001 }) === first.sourceFingerprint, false);
});

test('MediaVersion model preserves render metadata without confusing it with preview state', () => {
  const version = normalizeMediaVersion({
    id: 'v1',
    parentVersionId: 'original',
    createdAt: '2026-09-19T10:00:00Z',
    operations: [{ type: 'trim', label: 'Trimmed', params: { start: 2, end: 8 } }],
    sourceFingerprint: 'metadata-v1:abc12345',
    outputFormat: 'webm',
    outputDuration: 6,
    outputWidth: 1280,
    outputHeight: 720,
    outputBytes: 500000,
    status: 'ready',
    blobRef: { kind: 'session-blob', url: 'blob:result', sessionOnly: true },
    name: 'V1 — Trimmed',
    sessionAvailable: true
  });
  assert.equal(version.status, 'ready');
  assert.equal(version.parentVersionId, 'original');
  assert.equal(version.operations[0].type, 'trim');
  assert.equal(version.outputDuration, 6);
  assert.equal(version.blobRef.sessionOnly, true);
});

test('invalid active/base version references fall safely back to Original', () => {
  const state = normalizeVersionState({
    versions: [{ id: 'v1', status: 'ready', name: 'V1', parentVersionId: 'original' }],
    activeVersionId: 'missing',
    baseVersionId: 'missing'
  });
  assert.equal(state.activeVersionId, null);
  assert.equal(state.baseVersionId, 'original');
});
