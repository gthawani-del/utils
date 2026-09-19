import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubtitleText,
  parseSubtitleTimestamp,
  runSubtitleQa,
  transcriptToSrt,
  transcriptToTxt,
  transcriptToVtt
} from '../lib/media/transcript/subtitles.js';

test('subtitle timestamps parse both SRT and VTT separators', () => {
  assert.equal(parseSubtitleTimestamp('00:01:02,500'), 62.5);
  assert.equal(parseSubtitleTimestamp('01:02.250'), 62.25);
});

test('SRT import parses timed cues deterministically', () => {
  const parsed = parseSubtitleText('1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n2\n00:00:04,000 --> 00:00:05,500\nSecond line\n', 'srt');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.transcript.cues.length, 2);
  assert.equal(parsed.transcript.cues[0].text, 'Hello world');
  assert.equal(parsed.transcript.cues[1].end, 5.5);
});

test('VTT export carries WEBVTT header and TXT strips timing', () => {
  const transcript = { cues: [{ id: 'a', start: 1, end: 2.5, text: 'Caption' }] };
  assert.match(transcriptToVtt(transcript), /^WEBVTT/);
  assert.equal(transcriptToTxt(transcript), 'Caption');
  assert.match(transcriptToSrt(transcript), /00:00:01,000 --> 00:00:02,500/);
});

test('subtitle QA finds overlaps, blank cues and safe-area risks', () => {
  const report = runSubtitleQa({
    cues: [
      { id: 'a', start: 0, end: 3, text: 'A'.repeat(50) },
      { id: 'b', start: 2.5, end: 4, text: '' }
    ]
  }, { duration: 10 });
  assert.equal(report.overlaps, 1);
  assert.equal(report.blanks, 1);
  assert.equal(report.safeArea, 1);
});
