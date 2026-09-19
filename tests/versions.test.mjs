import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteVersionState,
  duplicateVersionState,
  renameVersionState,
  setActiveVersionState,
  setBranchBaseState
} from '../lib/media/versions/actions.js';
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


const branchState = {
  versions: [
    { id: 'v1', parentVersionId: 'original', status: 'ready', name: 'V1', outputDuration: 8 },
    { id: 'v2', parentVersionId: 'v1', status: 'ready', name: 'V2', outputDuration: 6 }
  ],
  activeVersionId: 'v2',
  baseVersionId: 'original'
};

test('version actions support rename, active selection and explicit branch bases', () => {
  const renamed = renameVersionState(branchState, 'v1', '  Client Cut  ');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.state.versions[0].name, 'Client Cut');

  const activeOriginal = setActiveVersionState(branchState, 'original');
  assert.equal(activeOriginal.state.activeVersionId, null);

  const branch = setBranchBaseState(branchState, 'v1');
  assert.equal(branch.state.baseVersionId, 'v1');
  assert.equal(branch.state.activeVersionId, 'v1');

  const originalBranch = setBranchBaseState(branch.state, 'original');
  assert.equal(originalBranch.state.baseVersionId, 'original');
  assert.equal(originalBranch.state.activeVersionId, null);
});

test('duplicate creates a separate stable Version without inventing persistence', () => {
  const result = duplicateVersionState(branchState, 'v1', {
    newId: 'v3',
    createdAt: '2026-09-19T12:00:00Z',
    blobRef: { kind: 'session-blob-url', url: 'blob:copy', sessionOnly: true },
    sessionAvailable: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.version.id, 'v3');
  assert.equal(result.version.name, 'V1 Copy');
  assert.equal(result.version.parentVersionId, 'original');
  assert.equal(result.version.sessionAvailable, true);
});

test('delete protects Original, current branch bases and parent lineage', () => {
  assert.equal(deleteVersionState(branchState, 'original').ok, false);
  assert.equal(deleteVersionState(branchState, 'v1').ok, false);

  const baseOnV1 = { ...branchState, baseVersionId: 'v1' };
  assert.equal(deleteVersionState(baseOnV1, 'v1').ok, false);

  const leaf = deleteVersionState(branchState, 'v2');
  assert.equal(leaf.ok, true);
  assert.equal(leaf.state.versions.length, 1);
  assert.equal(leaf.state.activeVersionId, null);
});


import {
  compareReference,
  durationSyncMode,
  equivalentCompareTime,
  measuredAspect,
  measuredComparison
} from '../lib/media/compare/model.js';

test('duration-aware comparison uses absolute sync only when durations genuinely match', () => {
  assert.equal(durationSyncMode(60, 60.2), 'absolute');
  assert.equal(durationSyncMode(60, 45), 'relative');
  assert.equal(durationSyncMode(null, 45), 'unavailable');
  assert.equal(equivalentCompareTime(30, 60, 45), 22.5);
  assert.equal(equivalentCompareTime(30, 60, 60.1), 30);
});

test('parent comparison resolves only an actual previous Version', () => {
  const versions = [
    { id: 'v1', parentVersionId: 'original', status: 'ready', name: 'V1' },
    { id: 'v2', parentVersionId: 'v1', status: 'ready', name: 'V2' }
  ];
  assert.equal(compareReference(versions[1], versions, 'parent').id, 'v1');
  assert.equal(compareReference(versions[0], versions, 'parent').type, 'original');
});

test('measured comparison reports actual metadata and only recorded operations', () => {
  const comparison = measuredComparison(
    { duration: 60, bytes: 1000, width: 1920, height: 1080, container: 'mp4' },
    {
      outputDuration: 30,
      outputBytes: 700,
      outputWidth: 1080,
      outputHeight: 1920,
      outputFormat: 'webm',
      operations: [
        { type: 'video-trim', label: 'Video trim' },
        { type: 'resize-aspect', label: 'Fit to 9:16' }
      ]
    }
  );
  assert.equal(comparison.original.aspect, '16:9');
  assert.equal(comparison.result.aspect, '9:16');
  assert.equal(comparison.durationDelta, -30);
  assert.equal(comparison.bytesDelta, -300);
  assert.deepEqual(comparison.operations.map((item) => item.type), ['video-trim', 'resize-aspect']);
  assert.equal(measuredAspect(1000, 1000), '1:1');
});
