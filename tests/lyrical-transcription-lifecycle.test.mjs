import test from "node:test";
import assert from "node:assert/strict";
import { transcribeSong } from "../lib/lyrical/audio.js";
import { TRANSCRIPTION_RATE, WINDOWS_PER_WORKER, transcriptionWindows } from "../lib/lyrical/transcription-windows.js";

function workerFixture(t) {
  const instances = [];
  const previous = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      assert.equal(instances.filter((worker) => !worker.terminated).length, 0, "model workers must never overlap");
      instances.push(this);
      this.terminated = false;
      this.messages = [];
    }
    postMessage(data, transfer = []) {
      this.data = structuredClone(data, { transfer });
      this.messages.push(this.data);
    }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  });
  return instances;
}

test("cancel terminates recognition immediately and ignores late status/results", async (t) => {
  const instances = workerFixture(t);
  const controller = new AbortController(), statuses = [];
  const audio = new Float32Array(16000);
  const run = transcribeSong(audio, {
    language: "hi", languageName: "Hindi", signal: controller.signal,
    onStatus: (status) => statuses.push(status),
  });
  const worker = instances[0];
  assert.equal(worker.data.language, "hi");
  assert.equal(worker.data.audio, undefined, "model initialization must not copy a full song");
  worker.emit({ type: "status", message: "Loading" });
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  worker.emit({ type: "status", message: "Stale" });
  worker.emit({ type: "chunk", index: 0, chunks: [] });
  assert.equal(worker.terminated, true);
  assert.deepEqual(statuses, ["Loading"]);
  assert.equal(audio.length, 16000);
});

test("cancelling before start does not allocate a worker", async (t) => {
  const instances = workerFixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transcribeSong(new Float32Array(1), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(instances.length, 0);
});

test("worker startup errors release resources and a retry can complete", async (t) => {
  const instances = workerFixture(t);
  const audio = new Float32Array(3 * TRANSCRIPTION_RATE);
  const failed = transcribeSong(audio);
  instances[0].onerror();
  await assert.rejects(failed, /speech engine stopped/);
  assert.equal(instances[0].terminated, true);
  const retry = transcribeSong(audio);
  const chunks = [{ text: "hello", timestamp: [1, 2] }];
  instances[1].emit({ type: "ready" });
  instances[1].emit({ type: "chunk", index: 0, chunks });
  assert.deepEqual(await retry, chunks);
  assert.equal(instances[1].terminated, true);
});

test("a three-minute song transfers bounded sections, recycles workers, and preserves absolute timing", async (t) => {
  const instances = workerFixture(t);
  const audio = new Float32Array(180 * TRANSCRIPTION_RATE);
  const windows = transcriptionWindows(audio.length);
  const checkpoints = [];
  const run = transcribeSong(audio, { language: "hi", onCheckpoint: (value) => checkpoints.push(value) });
  for (const window of windows) {
    if (window.index === 3) instances[0].onerror(); // stale retired-worker event
    const worker = instances.at(-1);
    if (worker.data.type === "init") {
      assert.equal(worker.data.quality, "tiny");
      assert.equal(worker.data.audio, undefined);
      worker.emit({ type: "ready" });
    }
    assert.equal(worker.data.index, window.index);
    assert.ok(worker.data.audio.byteLength <= 19 * TRANSCRIPTION_RATE * 4);
    assert.ok(worker.data.audio.length < audio.length);
    const start = (window.coreStart - window.start) / TRANSCRIPTION_RATE + 1;
    worker.emit({ type: "chunk", index: window.index, chunks: [{ text: "word", timestamp: [start, start + 1] }] });
  }
  const result = await run;
  assert.equal(instances.length, Math.ceil(windows.length / WINDOWS_PER_WORKER));
  assert.ok(instances.every((worker) => worker.terminated));
  assert.equal(result.length, 12);
  assert.deepEqual(result.map((word) => word.timestamp[0]), Array.from({ length: 12 }, (_, i) => i * 15 + 1));
  assert.equal(audio.length, 180 * TRANSCRIPTION_RATE, "song audio must not be detached");
  assert.equal(checkpoints.at(-1).nextWindow, 12);
  assert.equal(checkpoints[0].chunks.length, 1, "saved snapshots must not mutate later");
});

test("cancelled recognition resumes after its last saved section", async (t) => {
  const instances = workerFixture(t);
  const audio = new Float32Array(30 * TRANSCRIPTION_RATE);
  const controller = new AbortController();
  let checkpoint;
  const run = transcribeSong(audio, { language: "en", signal: controller.signal, onCheckpoint: (value) => { checkpoint = value; } });
  instances[0].emit({ type: "ready" });
  instances[0].emit({ type: "chunk", index: 0, chunks: [{ text: "first", timestamp: [1, 2] }] });
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  const retry = transcribeSong(audio, { language: "en", checkpoint });
  instances[1].emit({ type: "ready" });
  assert.equal(instances[1].data.index, 1);
  instances[1].emit({ type: "chunk", index: 1, chunks: [{ text: "second", timestamp: [3, 4] }] });
  assert.deepEqual(await retry, [{ text: "first", timestamp: [1, 2] }, { text: "second", timestamp: [16, 17] }]);
});

test("out-of-order worker results fail safely and release the worker", async (t) => {
  const instances = workerFixture(t);
  const run = transcribeSong(new Float32Array(TRANSCRIPTION_RATE));
  instances[0].emit({ type: "ready" });
  instances[0].emit({ type: "chunk", index: 5, chunks: [] });
  await assert.rejects(run, /unexpected section/);
  assert.equal(instances[0].terminated, true);
});

test("worker construction failures do not leave a run pending", async (t) => {
  workerFixture(t);
  globalThis.Worker = class { constructor() { throw new Error("unavailable"); } };
  await assert.rejects(transcribeSong(new Float32Array(1)), /unavailable/);
});

test("a stalled section times out and releases its worker", async (t) => {
  const instances = workerFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = transcribeSong(new Float32Array(TRANSCRIPTION_RATE));
  instances[0].emit({ type: "ready" });
  const failure = assert.rejects(run, /stopped responding/);
  t.mock.timers.tick(180_001);
  await failure;
  assert.equal(instances[0].terminated, true);
});
