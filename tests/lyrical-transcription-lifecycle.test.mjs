import test from "node:test";
import assert from "node:assert/strict";
import { transcribeSong } from "../lib/lyrical/audio.js";

function workerFixture(t) {
  const instances = [];
  const previous = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      instances.push(this);
      this.terminated = false;
    }
    postMessage(data) {
      this.data = data;
    }
    terminate() {
      this.terminated = true;
    }
    emit(data) {
      this.onmessage({ data });
    }
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  });
  return instances;
}

test("cancel terminates recognition immediately and ignores late status/results", async (t) => {
  const instances = workerFixture(t);
  const controller = new AbortController(),
    statuses = [];
  const audio = new Float32Array([0.1, 0.2]);
  const run = transcribeSong(audio, {
    language: "hi",
    languageName: "Hindi",
    signal: controller.signal,
    onStatus: (status) => statuses.push(status),
  });
  const worker = instances[0];
  assert.equal(worker.data.languageName, "Hindi");
  assert.notEqual(worker.data.audio, audio);
  worker.emit({ type: "status", message: "Loading" });
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  worker.emit({ type: "status", message: "Stale" });
  worker.emit({ type: "complete", chunks: [{ text: "stale" }] });
  assert.equal(worker.terminated, true);
  assert.deepEqual(statuses, ["Loading"]);
  assert.equal(audio.length, 2);
});
test("cancelling before start does not allocate a worker", async (t) => {
  const instances = workerFixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeSong(new Float32Array(1), { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(instances.length, 0);
});
test("worker startup errors release resources and a retry can complete", async (t) => {
  const instances = workerFixture(t);
  const failed = transcribeSong(new Float32Array(1));
  instances[0].onerror();
  await assert.rejects(failed, /could not start/);
  assert.equal(instances[0].terminated, true);
  const retry = transcribeSong(new Float32Array(1));
  const chunks = [{ text: "hello", timestamp: [1, 2] }];
  instances[1].emit({ type: "complete", chunks, language: "en" });
  assert.deepEqual(await retry, chunks);
  assert.equal(instances[1].terminated, true);
});
