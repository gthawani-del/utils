import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechLoadReporter } from "../lib/lyrical/transcription-progress.js";

test("concurrent model files report accumulated bytes without backwards percentages", () => {
  const statuses = [];
  const report = createSpeechLoadReporter((text) => statuses.push(text));
  const progress = (file, loaded, percent) => report({
    status: "progress", name: "speech-model", file, loaded, progress: percent,
  });
  progress("encoder", 10_000_000, 50);
  progress("decoder", 2_000_000, 2);
  progress("encoder", 11_000_000, 55);
  progress("decoder", 4_000_000, 4);
  assert.deepEqual(statuses, [10, 12, 13, 15].map(
    (mb) => "Preparing speech engine · " + mb + " MB loaded",
  ));
});

test("repeated or stale file events do not double-count bytes or announce duplicates", () => {
  const statuses = [];
  const report = createSpeechLoadReporter((text) => statuses.push(text));
  for (const loaded of [2_000_000, 2_000_000, 1_000_000, 2_100_000])
    report({ status: "progress", file: "model", loaded });
  for (const loaded of [NaN, Infinity, -1, undefined])
    report({ status: "progress", file: "model", loaded });
  report({ status: "progress", loaded: 9_000_000 });
  report({ status: "done", file: "model" });
  assert.deepEqual(statuses, ["Preparing speech engine · 2 MB loaded"]);
});

test("a retry starts its own byte count and does not inherit an earlier run", () => {
  const statuses = [];
  const report = createSpeechLoadReporter((text) => statuses.push(text));
  report({ status: "progress", file: "model", loaded: 90_000_000 });
  const retry = createSpeechLoadReporter((text) => statuses.push(text));
  retry({ status: "progress", file: "model", loaded: 1_000_000 });
  assert.deepEqual(statuses, [90, 1].map(
    (mb) => "Preparing speech engine · " + mb + " MB loaded",
  ));
});
