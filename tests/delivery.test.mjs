import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDeliveryMarker,
  buildRebuildManifest,
  fnv1a32,
  normalizeDeliveryState,
  selectedPreset,
  stableStringify
} from '../lib/media/delivery/plan.js';

test('delivery markers normalize and sort deterministically', () => {
  const state = normalizeDeliveryState({
    preset: 'vertical-social',
    markers: [
      { id: 'b', time: 8, label: 'Second', chapter: false },
      { id: 'a', time: 2, label: ' First ', chapter: true }
    ]
  });
  assert.equal(state.preset, 'vertical-social');
  assert.deepEqual(state.markers.map((marker) => marker.id), ['a', 'b']);
  assert.equal(state.markers[0].label, 'First');
});

test('marker addition retains deterministic sorted state', () => {
  const next = addDeliveryMarker({ preset: 'archive-handoff', markers: [] }, { id: 'm1', time: 12.5, label: 'Intro', chapter: true });
  assert.equal(next.markers[0].time, 12.5);
  assert.equal(next.markers[0].chapter, true);
});

test('stable stringify and FNV fingerprint ignore object key order', () => {
  const a = stableStringify({ b: 2, a: { y: 4, x: 3 } });
  const b = stableStringify({ a: { x: 3, y: 4 }, b: 2 });
  assert.equal(a, b);
  assert.equal(fnv1a32(a), fnv1a32(b));
});

test('rebuild manifest fingerprints render-relevant project state', () => {
  const project = {
    id: 'p1',
    source: { kind: 'local-file', name: 'clip.mp4', mediaType: 'video', bytes: 100, duration: 10 },
    videoEdits: { trimStart: 1, trimEnd: 8, playbackRate: 1 },
    delivery: { preset: 'archive-handoff', markers: [{ id: 'm', time: 2, label: 'Start', chapter: true }] }
  };
  const first = buildRebuildManifest(project);
  const second = buildRebuildManifest({ ...project, activeCategory: 'audio' });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(selectedPreset(project.delivery).id, 'archive-handoff');
});
