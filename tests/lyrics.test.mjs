import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWordIndex,
  lyricLineAtTime,
  lyricsToLrc,
  lyricsToTxt,
  parseLrcTimestamp,
  parseLyricsText,
  stampLyricLine
} from '../lib/media/lyrics/lyrics.js';

test('LRC timestamps parse common minute and hour forms', () => {
  assert.equal(parseLrcTimestamp('01:02.50'), 62.5);
  assert.equal(parseLrcTimestamp('1:01:02.250'), 3662.25);
});

test('standard LRC import creates timed lyric lines', () => {
  const parsed = parseLyricsText('[ar:Artist]\n[ti:Song]\n[00:01.00]Hello\n[00:03.50]World', 'lrc');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lyrics.artist, 'Artist');
  assert.equal(parsed.lyrics.title, 'Song');
  assert.equal(parsed.lyrics.lines.length, 2);
  assert.equal(lyricLineAtTime(parsed.lyrics, 3.8).text, 'World');
});

test('enhanced LRC preserves explicit word timing', () => {
  const parsed = parseLyricsText('[00:10.00]<00:10.00>Hello <00:10.50>world', 'lrc');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lyrics.lines[0].words.length, 2);
  assert.equal(activeWordIndex(parsed.lyrics.lines[0], 10.7), 1);
});

test('plain text imports untimed lines and can be stamped deterministically', () => {
  const parsed = parseLyricsText('First line\nSecond line', 'txt');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lyrics.lines[0].start, null);
  const stamped = stampLyricLine(parsed.lyrics, parsed.lyrics.lines[0].id, 12.25);
  assert.equal(stamped.lines[0].start, 12.25);
  assert.match(lyricsToLrc(stamped), /\[00:12\.25\]First line/);
  assert.equal(lyricsToTxt(stamped), 'First line\nSecond line');
});
