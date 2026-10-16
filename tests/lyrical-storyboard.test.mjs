import test from "node:test";
import assert from "node:assert/strict";
import { visualPlan, compileStoryboard, storyboardSceneAt, sceneTransition, sceneImageIndices, previewWindow } from "../lib/lyrical/storyboard.js";
import { createImageCache } from "../lib/lyrical/images.js";
import { drawLyricalFrame } from "../lib/lyrical/renderer.js";

const project = (overrides = {}) => ({ duration: 180, settings: { scenePacing: "balanced", transition: "dissolve", imageMovement: "still" }, direction: { style: "clean" }, lines: [], analysis: {}, ...overrides });
test("scene counts scale with song length and pace, with editable multilingual visual suggestions", () => {
  assert.equal(visualPlan(project()).count, 15);
  assert.equal(visualPlan(project({ settings: { scenePacing: "slow" } })).count, 10);
  assert.equal(visualPlan(project({ settings: { scenePacing: "energetic" } })).count, 23);
  assert.equal(visualPlan(project({ duration: 300, settings: { scenePacing: "energetic" } })).count, 24);
  assert.equal(visualPlan(project({ duration: 3 })).count, 1);
  for (const text of ["अब तेरा हिसाब है", "game over"]) assert.equal(visualPlan(project({ lines: [{ text }] })).theme, "resolve");
  assert.equal(visualPlan(project({ lines: [{ text: "你好世界" }], settings: { visualTheme: "connection" } })).theme, "connection");
});
test("storyboard spans the complete song, uses all images and repeats smaller sets without changing lyric timing", () => {
  const source = project({ lines: [{ text: "नया दिन", start: 12.4, end: 15 }, { text: "نعود", start: 168, end: 170 }] });
  const original = structuredClone(source);
  const scenes = compileStoryboard(source, 4);
  assert.equal(scenes.length, 15);
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes[1].start, 12.4);
  assert.equal(scenes.at(-1).end, 180);
  assert.equal(storyboardSceneAt(scenes, 180), scenes.at(-1));
  assert.deepEqual(new Set(scenes.map((scene) => scene.imageIndex)), new Set([0, 1, 2, 3]));
  assert.equal(scenes[1].excerpt, "नया दिन");
  assert.deepEqual(source, original);
  const crowded = compileStoryboard(project({ duration: 12 }), 24);
  assert.equal(crowded.length, 24);
  assert.ok(crowded.every((scene, index) => scene.end > scene.start && (!index || scene.start === crowded[index - 1].end)));
});
test("auto transitions cut only on a strong nearby onset; speed remains bounded by scene duration", () => {
  const scene = { start: 5, end: 10 };
  const source = project({ settings: { transition: "auto" }, analysis: { envelope: Array(300).fill(0.8), onsets: [5.1] } });
  assert.equal(sceneTransition(source, scene).type, "cut");
  source.analysis.onsets = [7];
  assert.equal(sceneTransition(source, scene).type, "dissolve");
  source.settings = { transition: "slide", transitionSpeed: "slow" };
  assert.equal(sceneTransition(source, { start: 5, end: 5.5 }).duration, 0.15);
});
test("image scheduling handles transitions, seeks, reuse and the final frame with at most two images", () => {
  const source = project();
  const scenes = compileStoryboard(source, 4);
  for (let time = 0; time <= 180; time += 0.1) {
    const indices = sceneImageIndices(source, scenes, time);
    const scene = storyboardSceneAt(scenes, time);
    assert.ok(indices.length <= 2);
    assert.ok(indices.includes(scene.imageIndex));
    if (scene.index && time < scene.start + sceneTransition(source, scene).duration)
      assert.ok(indices.includes(scenes[scene.index - 1].imageIndex));
  }
  assert.deepEqual(sceneImageIndices(source, scenes, 0), [0, 1]);
  assert.deepEqual(sceneImageIndices(source, scenes, 12.1), [1, 0]);
  assert.deepEqual(sceneImageIndices(source, scenes, 13), [1, 2]);
  assert.deepEqual(sceneImageIndices(source, compileStoryboard(source, 1), 14), [0]);
  const window = previewWindow(scenes, 180);
  assert.ok(window.start < scenes[1].start && window.end > scenes[1].start);
  assert.equal(window.end - window.start, 15);
});
test("decoded-image cache bounds live bitmaps across a complete 24-image sequence and backwards seeking", async () => {
  let active = 0, peak = 0, decodes = 0;
  const cache = createImageCache({ decode: async () => {
    active++; decodes++; peak = Math.max(peak, active);
    return { width: 720, height: 1280, close() { assert.ok(this.width); this.width = 0; active--; } };
  } });
  const images = Array.from({ length: 24 }, () => ({ blob: new Blob(["image"]) }));
  for (let i = 0; i < 23; i++) await cache.prepare(images, [i, i + 1]);
  await cache.prepare(images, [1, 0]);
  assert.equal(peak, 2);
  assert.equal(active, 2);
  assert.equal(decodes, 26);
  cache.clear();
  assert.equal(active, 0);
});
test("cancelled image decoding closes late results and a failed image can be retried", async () => {
  let finish, closed = 0;
  const cache = createImageCache({ decode: () => new Promise((resolve) => { finish = resolve; }) });
  const images = [{ blob: new Blob(["image"]) }];
  const loading = cache.prepare(images, [0]);
  await Promise.resolve();
  cache.clear();
  finish({ width: 1, height: 1, close() { closed++; } });
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(closed, 1);
  assert.equal(images[0].bitmap, undefined);
  let calls = 0;
  const retry = createImageCache({ decode: async () => {
    if (!calls++) throw new Error("bad");
    return { width: 1, height: 1, close() {} };
  } });
  await assert.rejects(retry.prepare(images, [0]), /could not load/);
  await retry.prepare(images, [0]);
  assert.ok(retry.ready(images, [0]));
  retry.clear();
});
function context() {
  const draws = [], stack = [];
  return {
    draws, globalAlpha: 1, x: 0, fillStyle: "",
    clearRect() {}, fillRect() {},
    save() { stack.push([this.globalAlpha, this.x]); },
    restore() { [this.globalAlpha, this.x] = stack.pop(); },
    translate(x) { this.x += x; },
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage(bitmap, x, y, width, height) { draws.push({ bitmap, alpha: this.globalAlpha, x: x + this.x, y, width, height }); },
  };
}
test("each transition actually changes canvas drawing, while still images ignore lyric intensity", () => {
  const images = [{ bitmap: { width: 720, height: 1280 } }, { bitmap: { width: 720, height: 1280 } }];
  const source = project({ duration: 12 });
  const render = (transition, time) => {
    source.settings.transition = transition;
    const ctx = context();
    drawLyricalFrame(ctx, source, images, time, 720, 1280);
    return ctx.draws;
  };
  assert.equal(render("cut", 6.2).length, 1);
  const dissolve = render("dissolve", 6.2);
  assert.equal(dissolve.length, 2);
  assert.ok(dissolve[1].alpha > 0 && dissolve[1].alpha < 1);
  const slide = render("slide", 6.2);
  assert.ok(slide[0].x < 0 && slide[1].x > 0);
  assert.equal(render("fade", 6.1)[0].bitmap, images[0].bitmap);
  assert.equal(render("fade", 6.5)[0].bitmap, images[1].bitmap);
  const still = render("cut", 1);
  source.settings.intensity = "energetic";
  assert.deepEqual(render("cut", 4), still);
});
