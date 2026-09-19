import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompilerManifest,
  defaultCompilerSelection,
  deriveCompilerOutputs,
  normalizeCompilerConfig
} from '../lib/media/compiler/plan.js';
import { createTar, tarBlockAligned } from '../lib/media/compiler/tar.js';

const project = {
  id: 'p1',
  updatedAt: '2026-09-19T12:00:00Z',
  source: {
    kind: 'local-file',
    name: 'episode.mp3',
    mediaType: 'audio',
    container: 'mp3',
    detectedMime: 'audio/mpeg',
    objectUrl: 'blob:local',
    bytes: 1234,
    duration: 60
  },
  transcript: { cues: [{ id: 'c1', start: 0, end: 1, text: 'Hello' }] },
  lyrics: { lines: [{ id: 'l1', start: 0, text: 'Hello', words: [] }] }
};

test('compiler marks only genuinely buildable artifacts as ready', () => {
  const outputs = deriveCompilerOutputs(project, { mediaRecorder: true, canvasCapture: true });
  assert.equal(outputs.find((output) => output.id === 'transcript-txt').status, 'ready');
  assert.equal(outputs.find((output) => output.id === 'thumbnail-png').status, 'ready');
  assert.equal(outputs.find((output) => output.id === 'youtube-16x9').status, 'prepare');
  assert.equal(outputs.find((output) => output.id === 'podcast-mp3').status, 'unavailable');
});

test('compiler selection excludes unsupported outputs', () => {
  const outputs = deriveCompilerOutputs(project, { mediaRecorder: true, canvasCapture: true });
  const normalized = normalizeCompilerConfig({ selected: ['transcript-txt', 'podcast-mp3', 'source-metadata'] }, outputs);
  assert.deepEqual(normalized.selected, ['transcript-txt', 'source-metadata']);
  assert.ok(defaultCompilerSelection(outputs).includes('thumbnail-png'));
});

test('compiler manifest records status instead of pretending unavailable outputs exist', () => {
  const outputs = deriveCompilerOutputs(project, { mediaRecorder: true, canvasCapture: true });
  const manifest = buildCompilerManifest(project, outputs, ['transcript-txt']);
  assert.equal(manifest.format, 'utility-os-media-compiler-manifest');
  assert.equal(manifest.outputs.find((output) => output.id === 'podcast-mp3').status, 'unavailable');
  assert.equal(manifest.outputs.find((output) => output.id === 'transcript-txt').selected, true);
});

test('TAR package is block aligned and includes terminal blocks', async () => {
  const tar = await createTar([{ name: 'a.txt', data: 'hello' }]);
  assert.equal(tarBlockAligned(tar.size), true);
  assert.equal(tar.size >= 1536, true);
});
