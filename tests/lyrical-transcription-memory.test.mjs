import test from "node:test";
import assert from "node:assert/strict";
import { limitedTranscriptionDevice, transcriptionQuality, TRANSCRIPTION_PROFILES } from "../lib/lyrical/transcription-policy.js";
import { transcriptionWindows, appendWindowWords, resumeTranscription, TRANSCRIPTION_RATE } from "../lib/lyrical/transcription-windows.js";
import { transcriptionOptions } from "../lib/lyrical/transcription-options.js";

const config = { decoder_start_token_id: 50258, lang_to_id: { '<|hi|>': 50276 }, task_to_id: { transcribe: 50359 }, no_timestamps_token_id: 50363 };
test("default, unknown, and legacy large-model settings use the compact multilingual model", () => {
  for (const quality of [undefined, "", "small", "unknown", "tiny"])
    assert.equal(transcriptionQuality(quality), "tiny");
  assert.equal(transcriptionQuality("base"), "base");
  assert.ok(!Object.keys(TRANSCRIPTION_PROFILES).includes("small"));
  assert.match(TRANSCRIPTION_PROFILES.tiny.model, /whisper-tiny_timestamped$/);
});
test("phones, desktop-mode iPads, and low-memory desktops cannot select the larger profile", () => {
  for (const device of [
    { userAgent: "Mozilla iPhone" }, { userAgent: "Mozilla Android" },
    { platform: "MacIntel", maxTouchPoints: 5 }, { mobile: true }, { deviceMemory: 4 },
  ]) {
    assert.equal(limitedTranscriptionDevice(device), true);
    assert.equal(transcriptionQuality("base", device), "tiny");
  }
  assert.equal(limitedTranscriptionDevice({ platform: "MacIntel", maxTouchPoints: 0, deviceMemory: 8 }), false);
});
test("recognition keeps word timing with bounded token generation and no eager whole-song chunking", () => {
  const options = transcriptionOptions("hi", config);
  assert.equal(options.chunk_length_s, 0);
  assert.equal(options.return_timestamps, "word");
  assert.equal(options.max_new_tokens, 224);
  assert.deepEqual(options.decoder_input_ids, [50258, 50276, 50359, 50363]);
});
test("window ownership covers the full recording once, including a short final section", () => {
  const samples = Math.round(181.25 * TRANSCRIPTION_RATE);
  const windows = transcriptionWindows(samples);
  let end = 0;
  for (const window of windows) {
    assert.equal(window.coreStart, end);
    assert.ok(window.end - window.start <= 19 * TRANSCRIPTION_RATE);
    assert.ok(window.coreEnd - window.coreStart > 10 * TRANSCRIPTION_RATE);
    assert.ok(window.start <= window.coreStart && window.end >= window.coreEnd);
    end = window.coreEnd;
  }
  assert.equal(end, samples);
  assert.equal(windows.length, 13);
  for (const invalid of [0, -1, Infinity, 301 * TRANSCRIPTION_RATE])
    assert.throws(() => transcriptionWindows(invalid));
});
test("overlap ownership removes duplicate words and keeps timestamps on the song timeline", () => {
  const windows = transcriptionWindows(30 * TRANSCRIPTION_RATE);
  const words = [];
  appendWindowWords(words, [
    { text: "before", timestamp: [13, 14] },
    { text: "boundary", timestamp: [14.6, 15.2] },
    { text: "after", timestamp: [15.5, 16] },
  ], windows[0]);
  appendWindowWords(words, [
    { text: "before", timestamp: [0, 1] },
    { text: "boundary", timestamp: [1.8, 2.3] },
    { text: "after", timestamp: [2.5, 3] },
    { text: "invalid", timestamp: [9, null] },
  ], windows[1]);
  assert.deepEqual(words.map((word) => word.text), ["before", "boundary", "after"]);
  assert.deepEqual(words.at(-1).timestamp, [15.5, 16]);
});
test("checkpoints are rejected for changed song, language, model, or invalid timestamps", () => {
  const identity = { samples: 30 * TRANSCRIPTION_RATE, language: "hi", quality: "tiny" };
  const windows = transcriptionWindows(identity.samples);
  const checkpoint = { version: 1, ...identity, nextWindow: 1, chunks: [{ text: "word", timestamp: [1, 2] }] };
  assert.equal(resumeTranscription(checkpoint, windows, identity).nextWindow, 1);
  for (const patch of [
    { language: "en" }, { quality: "base" }, { samples: 1 }, { nextWindow: 99 },
    { chunks: [{ text: "bad", timestamp: [4, 3] }] },
    { chunks: [{ text: "bad", timestamp: [16, 20] }] },
  ]) assert.equal(resumeTranscription({ ...checkpoint, ...patch }, windows, identity).nextWindow, 0);
});
