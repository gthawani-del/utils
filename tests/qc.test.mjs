import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicQcFixes, runQcReport } from '../lib/media/qc/report.js';

const baseProject = {
  source: {
    kind: 'local-file',
    name: 'clip.mp4',
    mediaType: 'video',
    container: 'mp4',
    detectedMime: 'video/mp4',
    bytes: 10_000_000,
    duration: 10,
    width: 1920,
    height: 1080,
    warning: ''
  }
};

test('QC report distinguishes measured, partial and not-inspected checks', () => {
  const report = runQcReport(baseProject);
  assert.equal(report.checks.find((item) => item.id === 'codec').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'bitrate').status, 'partial');
  assert.equal(report.checks.find((item) => item.id === 'frame-rate').status, 'not-inspected');
  assert.equal(report.checks.find((item) => item.id === 'resolution').status, 'pass');
});

test('subtitle QC warning is surfaced in the media report', () => {
  const report = runQcReport({
    ...baseProject,
    transcript: {
      cues: [
        { id: 'a', start: 0, end: 5, text: 'First' },
        { id: 'b', start: 4, end: 12, text: '' }
      ]
    }
  });
  const subtitles = report.checks.find((item) => item.id === 'subtitles');
  assert.equal(subtitles.status, 'warning');
  assert.match(subtitles.detail, /Overlaps: 1/);
});

test('safe fixes clamp subtitle end overflow and normalize project edit bounds', () => {
  const result = deterministicQcFixes({
    ...baseProject,
    videoEdits: { trimStart: -10, trimEnd: 99, playbackRate: 7 },
    transcript: {
      cues: [
        { id: 'b', start: 4, end: 14, text: 'Second   ' },
        { id: 'a', start: 1, end: 2, text: 'First' }
      ]
    }
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.patch.videoEdits, { trimStart: 0, trimEnd: 10, playbackRate: 1 });
  assert.equal(result.patch.transcript.cues[0].id, 'a');
  assert.equal(result.patch.transcript.cues[1].end, 10);
  assert.equal(result.patch.transcript.cues[1].text, 'Second');
});
