import test from "node:test";
import assert from "node:assert/strict";
import {
  alignLyrics,
  timingWords,
  splitTimedLine,
  mergeTimedLines,
  insertTimedLine,
} from "../lib/lyrical/timing.js";
import { reviseLine, validateLines } from "../lib/lyrical/project.js";

const word = (text, start, end) => ({ text, start, end });
test("pasted lyrics follow detected vocals and preserve instrumental gaps", () => {
  const source = [
    word("Hello", 8, 8.5),
    word("world", 8.5, 9),
    word("Come", 25, 25.5),
    word("home", 25.5, 26),
  ];
  const lines = alignLyrics(["Hello world!", "Come home."], source, 40);
  assert.deepEqual(
    lines.map(({ start, end }) => [start, end]),
    [
      [8, 9],
      [25, 26],
    ],
  );
  assert.equal(lines[0].text, "Hello world!");
  assert.equal(lines[0].words.length, 2);
  assert.equal(validateLines(lines, 40), "");
});
test("repeated choruses stay in recording order", () => {
  const source = [
    word("come", 1, 2),
    word("home", 2, 3),
    word("stay", 8, 9),
    word("come", 20, 21),
    word("home", 21, 22),
  ];
  const lines = alignLyrics(["come home", "stay", "come home"], source, 30);
  assert.deepEqual(
    lines.map((l) => l.start),
    [1, 8, 20],
  );
});
test("recognition substitutions and extra words are estimated inside local audio windows", () => {
  const source = [
    word("I", 3, 3.5),
    word("no", 3.5, 4),
    word("you", 4, 5),
    word("stay", 20, 21),
  ];
  const before = structuredClone(source);
  const lines = alignLyrics(["I know only you", "stay"], source, 30);
  assert.equal(lines[0].timingQuality, "estimated");
  assert.deepEqual(lines[0].words, []);
  assert.equal(lines[0].start, 3);
  assert.equal(lines[0].end, 5);
  assert.equal(lines[1].start, 20);
  assert.equal(validateLines(lines, 30), "");
  assert.deepEqual(source, before);
});
test("unmatched leading and trailing words receive nonoverlapping automatic timing", () => {
  const lines = alignLyrics(
    ["Oh hello", "world again"],
    [word("hello", 5, 6), word("world", 6, 7)],
    20,
  );
  assert.equal(validateLines(lines, 20), "");
  assert.equal(lines[0].start, 5);
  assert.equal(lines[1].end, 7);
  assert.ok(lines.every((l) => l.timingQuality === "estimated"));
});
test("mixed Hindi, English, RTL and unspaced scripts retain text and valid boundaries", () => {
  for (const text of ["तूने game खेली", "مرحبا بالعالم", "你好世界"]) {
    const result = alignLyrics([text], [word(text, 2, 5)], 10);
    assert.equal(result[0].text, text);
    assert.equal(validateLines(result, 10), "");
  }
});
test("silence, missing timestamps and oversized input do not produce invented song-wide timing", () => {
  assert.throws(() => alignLyrics(["hello"], [], 20), /No usable vocal timing/);
  assert.throws(
    () => alignLyrics(["hello"], [{ text: "hello", timestamp: [1, null] }], 20),
    /No usable vocal timing/,
  );
  assert.throws(
    () =>
      alignLyrics(
        Array.from({ length: 50 }, () => "a ".repeat(100)),
        [word("a", 0, 1)],
        20,
      ),
    /too many words/,
  );
  assert.deepEqual(
    timingWords(
      [word("a", 1, 2), word("b", 1.8, 3), word("bad", 4, NaN)],
      10,
    ).map((w) => [w.start, w.end]),
    [
      [1, 2],
      [2, 3],
    ],
  );
});
test("splits use detected word boundaries and edited splits need no entered timestamps", () => {
  const line = {
    id: "a",
    text: "hello world",
    start: 3,
    end: 6,
    words: [word("hello", 3, 4), word("world", 5, 6)],
    timing: "detected",
  };
  const split = splitTimedLine(line, 5, "b");
  assert.deepEqual(
    split.map((l) => [l.start, l.end]),
    [
      [3, 4],
      [5, 6],
    ],
  );
  assert.equal(validateLines(split, 10), "");
  const edited = reviseLine(line, "hello wonderful world");
  const revisedSplit = splitTimedLine(edited, 5, "b");
  assert.equal(validateLines(revisedSplit, 10), "");
  assert.equal(revisedSplit[0].end, revisedSplit[1].start);
  assert.equal(revisedSplit[1].end, 6);
  assert.ok(revisedSplit.every((l) => l.timingQuality === "estimated"));
});
test("merge preserves the full span, and text edits keep line timing", () => {
  const a = {
    id: "a",
    text: "hello",
    start: 1,
    end: 2,
    words: [word("hello", 1, 2)],
  };
  const b = {
    id: "b",
    text: "world",
    start: 3,
    end: 4,
    words: [word("world", 3, 4)],
  };
  const merged = mergeTimedLines(a, b);
  assert.deepEqual([merged.start, merged.end], [1, 4]);
  assert.equal(merged.words.length, 2);
  assert.deepEqual(
    [
      reviseLine(merged, "different words").start,
      reviseLine(merged, "different words").end,
    ],
    [1, 4],
  );
});
test("adding a line at beginning, middle, gap and end always allocates valid timing", () => {
  for (const time of [0, 1, 2, 3, 4, 5.99, 6]) {
    const original = [
      { id: "a", text: "one", start: 1, end: 2, words: [] },
      { id: "b", text: "two", start: 4, end: 6, words: [] },
    ];
    const inserted = insertTimedLine(original, time, 6, "new");
    inserted.lines[inserted.index].text = "new words";
    assert.equal(validateLines(inserted.lines, 6), "", String(time));
    assert.equal(original[1].end, 6);
  }
});

test("unrelated lyrics are rejected instead of silently inventing alignment", () => {
  assert.throws(
    () =>
      alignLyrics(
        ["different song"],
        [word("hello", 1, 2), word("world", 2, 3)],
        10,
      ),
    /could not be matched/,
  );
});
test("a split inside a word cannot claim exact word timestamps", () => {
  const line = {
    text: "hello world",
    start: 1,
    end: 3,
    words: [word("hello", 1, 2), word("world", 2, 3)],
  };
  const result = splitTimedLine(line, 2, "new");
  assert.ok(
    result.every(
      (l) => l.words.length === 0 && l.timingQuality === "estimated",
    ),
  );
  assert.equal(validateLines(result, 4), "");
});
