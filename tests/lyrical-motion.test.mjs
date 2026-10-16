import test from "node:test";
import assert from "node:assert/strict";
import {
  MOTION_PRESETS,
  compileChoreography,
  motionState,
  audioDrive,
  longHoldLines,
} from "../lib/lyrical/motion.js";
import {
  drawLyricalFrame,
  invalidateLyricalRender,
  fitLines,
  measuredWordSpans,
} from "../lib/lyrical/renderer.js";
import { visualSummary, validateVisuals } from "../lib/lyrical/project.js";

const project = (style = "cinematic") => ({
  duration: 150,
  settings: {
    style,
    intensity: "balanced",
    textSize: 1,
    presentation: "phrases",
  },
  lines: Array.from({ length: 30 }, (_, i) => ({
    id: "l" + i,
    text: "तूने गेम खेली।",
    start: i * 5,
    end: i * 5 + 4,
    words: [],
  })),
  analysis: { envelope: Array(3000).fill(0.3), onsets: [1, 3, 7] },
});

test("system choreography varies across phrases and preserves lyric timing", () => {
  const presets = new Set();
  for (const style of ["bold", "cinematic", "clean"]) {
    const source = project(style),
      before = structuredClone(source);
    const plan = compileChoreography(source);
    assert.deepEqual(plan, compileChoreography(source));
    assert.deepEqual(source, before);
    assert.ok(new Set(plan.phrases.map((p) => p.preset)).size >= 6);
    plan.phrases.forEach((p, i) => {
      presets.add(p.preset);
      assert.deepEqual(
        [p.start, p.end],
        [source.lines[i].start, source.lines[i].end],
      );
      if (i) assert.notEqual(p.preset, plan.phrases[i - 1].preset);
    });
  }
  assert.equal(presets.size, 12);
});
test("all twelve presets keep moving after their entrance, even at gentle intensity", () => {
  for (const preset of Object.keys(MOTION_PRESETS)) {
    const phrase = {
      preset,
      start: 2,
      end: 8,
      entry: 0.4,
      exit: 0.3,
      direction: 1,
    };
    const pose = (t) => motionState(phrase, t, 0.6, { energy: 0.4 }, 0, 1);
    const a = pose(3.2),
      b = pose(4.1);
    assert.notDeepEqual(
      [a.x, a.y, a.scaleX, a.scaleY, a.rotation],
      [b.x, b.y, b.scaleX, b.scaleY, b.rotation],
      preset,
    );
    assert.equal(pose(1.99).opacity, 0, preset);
    assert.equal(pose(8).opacity, 0, preset);
    for (const t of [2, 2.1, 4, 7.99]) {
      const p = pose(t);
      assert.ok(
        Object.values(p).every(
          (v) => typeof v === "boolean" || Number.isFinite(v),
        ),
        preset,
      );
      assert.ok(
        p.scaleX > 0 && p.scaleY > 0 && p.opacity >= 0 && p.opacity <= 1,
        preset,
      );
    }
  }
});
test("short multirow phrases reveal all rows within the actual vocal window", () => {
  const phrase = {
    preset: "stagger",
    start: 0,
    end: 0.4,
    entry: 0.1,
    exit: 0.08,
  };
  for (let row = 0; row < 20; row++) {
    assert.ok(motionState(phrase, 0.2, 1, {}, row, 20).opacity > 0.8);
    assert.equal(motionState(phrase, 0.4, 1, {}, row, 20).visible, false);
  }
});
test("audio modulation is continuous and cannot change visibility boundaries", () => {
  const source = project();
  source.analysis.envelope = [0, 0, 1, 0, 0, 1, 0];
  const plan = compileChoreography(source);
  assert.ok(
    Math.abs(
      audioDrive(plan, 0.09999).energy - audioDrive(plan, 0.10001).energy,
    ) < 0.001,
  );
  assert.equal(audioDrive(plan, 1).beat, 0);
  const phrase = plan.phrases[0];
  assert.equal(
    motionState(phrase, 4.1, 1, { energy: 1, beat: 1 }).visible,
    false,
  );
});
test("suspicious long holds are flagged without fabricating replacement timestamps", () => {
  const lines = [
    { text: "जब", start: 2, end: 22 },
    { text: "तूने गेम खेली", start: 23, end: 26 },
  ];
  const before = structuredClone(lines);
  assert.deepEqual(longHoldLines(lines), [0]);
  assert.deepEqual(lines, before);
});
test("image mode is explicit and a missing or closed image cannot silently export", () => {
  const image = { id: "a", bitmap: { width: 720, height: 1280 } };
  assert.match(visualSummary(true, [image]), /will not appear/);
  assert.match(visualSummary(false, [image]), /1 image\(s\) included/);
  assert.match(validateVisuals(false, []), /Add an image/);
  assert.match(
    validateVisuals(false, [{ bitmap: { width: 0, height: 0 } }]),
    /could not load/,
  );
  assert.match(validateVisuals(false, [image], [{ id: "missing" }]), /missing/);
  assert.equal(validateVisuals(false, [image]), "");
  assert.equal(validateVisuals(true, []), "");
});

function context() {
  const text = [],
    poses = [],
    pictures = [];
  return {
    text,
    poses,
    pictures,
    font: "",
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    rotate(v) {
      poses.push(["rotate", v]);
    },
    scale(x, y) {
      poses.push(["scale", x, y]);
    },
    translate(x, y) {
      poses.push(["translate", x, y]);
    },
    beginPath() {},
    rect() {},
    clip() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    measureText(s) {
      return {
        width:
          Array.from(s).length *
          (parseFloat(this.font.split(" ")[1]) || 40) *
          0.4,
      };
    },
    fillText(s) {
      text.push(s);
    },
    drawImage(bitmap) {
      pictures.push(bitmap);
    },
  };
}
test("danda punctuation cannot become a stranded row and timed word builds use exact spans", () => {
  const ctx = context();
  const fitted = fitLines(ctx, "कुछ और चलता रहा।", 140, "sans-serif", 40, 400);
  assert.deepEqual(
    measuredWordSpans({
      text: "क्षि",
      words: [
        { text: "क्ष", start: 0, end: 1 },
        { text: "ि", start: 1, end: 2 },
      ],
    }),
    [],
  );
  assert.ok(fitted.lines.every((row) => row !== "।"));
  const line = {
    text: "come come home",
    words: [
      { text: "come", start: 0, end: 1 },
      { text: "come", start: 1, end: 2 },
      { text: "home", start: 2, end: 3 },
    ],
  };
  assert.deepEqual(
    measuredWordSpans(line).map((w) => [w.from, w.to]),
    [
      [0, 4],
      [5, 9],
      [10, 14],
    ],
  );
  assert.deepEqual(
    measuredWordSpans({ ...line, text: "come wonderful home" }),
    [],
  );
});
test("renderer preserves shaped Hindi/RTL strings, moves actual drawing poses and respects gaps", () => {
  for (const text of [
    "क्षि प्रेम में",
    "مرحبا بالعالم",
    "तूने game खेली",
    "你好世界",
  ]) {
    const source = project();
    source.lines = [{ id: "a", text, start: 1, end: 4, words: [] }];
    const first = context(),
      second = context(),
      gap = context();
    drawLyricalFrame(first, source, [], 1.8, 720, 1280);
    drawLyricalFrame(second, source, [], 2.7, 720, 1280);
    assert.equal(first.text.join(" "), text);
    assert.notDeepEqual(first.poses, second.poses);
    drawLyricalFrame(gap, source, [], 4, 720, 1280);
    assert.deepEqual(gap.text, []);
    source.lines[0].text = "Updated";
    invalidateLyricalRender(source);
    const edited = context();
    drawLyricalFrame(edited, source, [], 2, 720, 1280);
    assert.deepEqual(edited.text, ["Updated"]);
  }
});
test("shared frame renderer paints uploaded images through scene changes", () => {
  const source = project();
  source.duration = 8;
  source.lines = [];
  const a = { bitmap: { width: 400, height: 600 } },
    b = { bitmap: { width: 600, height: 400 } };
  const first = context(),
    transition = context(),
    final = context();
  drawLyricalFrame(first, source, [a, b], 1, 720, 1280);
  drawLyricalFrame(transition, source, [a, b], 4.2, 720, 1280);
  drawLyricalFrame(final, source, [a, b], 7, 720, 1280);
  assert.deepEqual(first.pictures, [a.bitmap]);
  assert.deepEqual(transition.pictures, [a.bitmap, b.bitmap]);
  assert.deepEqual(final.pictures, [b.bitmap]);
});
