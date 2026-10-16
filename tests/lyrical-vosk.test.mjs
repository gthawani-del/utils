import test from "node:test";
import assert from "node:assert/strict";
import { createVoskWorker, VOSK_CHUNK_SAMPLES } from "../lib/lyrical/vosk-worker-client.js";
import { transcribeSong } from "../lib/lyrical/audio.js";
import { transcriptionQuality } from "../lib/lyrical/transcription-policy.js";

function fixture(t) {
  const previous = globalThis.Worker, instances = [];
  globalThis.Worker = class {
    constructor(url) {
      assert.equal(instances.filter(w => !w.stopped).length, 0);
      assert.equal(url, "/assets/lyrical-vosk-engine.js");
      this.messages = [];
      this.stopped = false;
      instances.push(this);
    }
    postMessage(data, transfer = []) { this.messages.push(structuredClone(data, { transfer })); }
    terminate() { this.stopped = true; }
    emit(data) { this.onmessage?.({ data }); }
  };
  t.after(() => { if (previous === undefined) delete globalThis.Worker; else globalThis.Worker = previous; });
  return instances;
}
function readyClient(t) {
  const instances = fixture(t), client = createVoskWorker(), output = [];
  client.onmessage = ({ data }) => output.push(data);
  client.postMessage({ type: "init", language: "hi" });
  const worker = instances[0];
  assert.match(worker.messages.at(-1).modelUrl, /\/assets\/models\/vosk-model-small-hi-0\.22\.tar\.gz$/);
  worker.emit({ event: "load", result: true });
  assert.equal(output.at(-1).type, "ready");
  t.after(() => client.terminate());
  return { worker, client, output };
}

test("Vosk is opt-in, English/Hindi only, and never silently replaces the standard default", () => {
  assert.equal(transcriptionQuality(undefined, {}, "hi"), "tiny");
  assert.equal(transcriptionQuality("vosk", { mobile: true }, "hi"), "vosk");
  assert.equal(transcriptionQuality("vosk", {}, "en"), "vosk");
  for (const language of ["", "fr", "ar"]) assert.equal(transcriptionQuality("vosk", {}, language), "tiny");
});

test("Vosk waits for each chunk response and the final flush; empty final results still complete", t => {
  const { worker, client, output } = readyClient(t);
  const audio = new Float32Array(2 * VOSK_CHUNK_SAMPLES + 17).fill(0.5);
  client.postMessage({ type: "transcribe", index: 2, audio });
  let message = worker.messages.at(-1);
  assert.equal(message.data.length, VOSK_CHUNK_SAMPLES);
  assert.equal(message.data[0], 16384, "Kaldi float samples use the int16 amplitude range");
  assert.equal(worker.messages.filter(m => m.action === "audioChunk").length, 1);
  assert.equal(audio[0], 0.5, "source samples remain intact");
  const id = message.recognizerId;
  worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "unfinished" } });
  assert.equal(worker.messages.filter(m => m.action === "audioChunk").length, 2);
  worker.emit({ event: "result", recognizerId: id, result: { text: "hello", result: [{ word: "hello", start: 0.1, end: 0.3 }] } });
  message = worker.messages.at(-1);
  assert.equal(message.data.length, 17);
  worker.emit({ event: "partialresult", recognizerId: id, result: { partial: "" } });
  assert.equal(worker.messages.at(-1).action, "retrieveFinalResult");
  assert.equal(output.filter(m => m.type === "chunk").length, 0, "must not resolve at last audio acknowledgment");
  worker.emit({ event: "result", recognizerId: id, result: { text: "" } });
  assert.deepEqual(output.at(-1), { type: "chunk", index: 2, chunks: [{ text: "hello", timestamp: [0.1, 0.3] }] });
  assert.equal(worker.messages.at(-1).action, "remove");
  worker.emit({ event: "result", recognizerId: id, result: { result: [{ word: "duplicate", start: 0.3, end: 0.4 }] } });
  assert.equal(output.filter(m => m.type === "chunk").length, 1);
});

test("Vosk retains last words delivered only by the final flush", t => {
  const { worker, client, output } = readyClient(t);
  client.postMessage({ type: "transcribe", index: 0, audio: new Float32Array(16000) });
  while (worker.messages.at(-1).action === "audioChunk") {
    worker.emit({ event: "partialresult", recognizerId: worker.messages.at(-1).recognizerId, result: { partial: "" } });
  }
  const id = worker.messages.at(-1).recognizerId;
  worker.emit({ event: "result", recognizerId: id, result: { result: [{ word: "नमस्ते", start: 0.1, end: 0.9 }] } });
  assert.equal(output.at(-1).chunks[0].text, "नमस्ते");
});

test("Vosk cancellation directly terminates the only worker and suppresses late events", t => {
  const { worker, client, output } = readyClient(t);
  client.postMessage({ type: "transcribe", index: 0, audio: new Float32Array(16000) });
  const late = worker.onmessage, count = output.length;
  client.terminate();
  late({ data: { event: "load", result: true } });
  assert.equal(worker.stopped, true);
  assert.equal(output.length, count);
});

test("Vosk load/inference errors terminate the model rather than hanging", t => {
  const { worker, output } = readyClient(t);
  worker.emit({ event: "error", error: "allocation failed" });
  assert.equal(output.at(-1).type, "error");
  assert.equal(worker.stopped, true);
});

test("three-minute Vosk run has bounded transfers, recycling, checkpoints and word timing", async t => {
  const instances = fixture(t), checkpoints = [];
  const mono = new Float32Array(180 * 16000);
  const run = transcribeSong(mono, { language: "hi", quality: "vosk", onCheckpoint: value => checkpoints.push(value) });
  let section = 0;
  for (let iteration = 0; iteration < 2000; iteration++) {
    const worker = instances.at(-1);
    if (worker.stopped) break;
    const data = worker.messages.at(-1);
    if (data.action === "load") worker.emit({ event: "load", result: true });
    else if (data.action === "audioChunk") {
      assert.ok(data.data.length <= VOSK_CHUNK_SAMPLES);
      worker.emit({ event: "partialresult", recognizerId: data.recognizerId, result: { partial: "" } });
    } else if (data.action === "retrieveFinalResult") {
      const start = section++ === 0 ? 1 : 3;
      worker.emit({ event: "result", recognizerId: data.recognizerId, result: { result: [{ word: "शब्द", start, end: start + 0.5 }] } });
    } else assert.fail("unexpected worker message " + data.action);
  }
  const chunks = await run;
  assert.equal(instances.length, 4);
  assert.ok(instances.every(worker => worker.stopped));
  assert.equal(chunks.length, 12);
  assert.deepEqual(chunks.map(c => c.timestamp[0]), Array.from({ length: 12 }, (_, i) => i * 15 + 1));
  assert.equal(checkpoints.at(-1).quality, "vosk");
  assert.equal(checkpoints.at(-1).nextWindow, 12);
  assert.equal(mono.length, 180 * 16000);
});

test("Vosk cancellation preserves a checkpoint and resumes without retranscribing completed windows", async t => {
  const instances = fixture(t), signal = new AbortController();
  let checkpoint;
  const mono = new Float32Array(30 * 16000);
  const run = transcribeSong(mono, { language: "en", quality: "vosk", signal: signal.signal,
    onCheckpoint(value) { checkpoint = value; signal.abort(); } });
  const worker = instances[0];
  worker.emit({ event: "load", result: true });
  while (worker.messages.at(-1).action === "audioChunk")
    worker.emit({ event: "partialresult", recognizerId: worker.messages.at(-1).recognizerId, result: { partial: "" } });
  worker.emit({ event: "result", recognizerId: worker.messages.at(-1).recognizerId,
    result: { result: [{ word: "first", start: 1, end: 2 }] } });
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(checkpoint.nextWindow, 1);
  const retrySignal = new AbortController(), statuses = [];
  const retry = transcribeSong(mono, { language: "en", quality: "vosk", checkpoint,
    signal: retrySignal.signal, onStatus: value => statuses.push(value) });
  assert.match(statuses[0], /Resuming from 0:15/);
  retrySignal.abort();
  await assert.rejects(retry, { name: "AbortError" });
  assert.ok(instances.every(w => w.stopped));
});
