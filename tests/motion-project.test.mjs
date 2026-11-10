import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProject, validateProject, durationOf, sceneAt, dimensions,
  fitNarration, TEMPLATES,
} from '../lib/motion/project.js';

test('all shipped templates provide editable scenes for every advertised starting duration', () => {
  for (const template of TEMPLATES) {
    for (const duration of [15, 24, 40, 60]) {
      const project = makeProject(template.id, { duration });
      assert.equal(project.template, template.id);
      assert.ok(Math.abs(durationOf(project) - duration) < 1e-9);
      assert.equal(project.scenes[0].layout, 'title');
      assert.equal(project.scenes.at(-1).layout, 'closing');
      assert.ok(project.scenes.every(scene => scene.title.trim() && scene.duration >= 2));
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
    }
  }
});

test('templates do not share editable scene state between projects', () => {
  const first = makeProject('process');
  first.scenes[1].points[0] = 'Changed by first editor';
  first.scenes[0].title = 'A new title';
  const second = makeProject('process');
  assert.equal(second.scenes[1].points[0], 'Prepare');
  assert.notEqual(second.scenes[0].title, first.scenes[0].title);
});

test('timeline switches scenes at the exact boundary without skipping the final card', () => {
  const project = makeProject('explainer', { duration: 24 });
  assert.equal(sceneAt(project, 0).index, 0);
  assert.equal(sceneAt(project, 7.999).index, 0);
  assert.equal(sceneAt(project, 8).index, 1);
  assert.equal(sceneAt(project, 8).local, 0);
  assert.equal(sceneAt(project, 16).index, 2);
  assert.equal(sceneAt(project, 24).scene.layout, 'closing');
  assert.equal(sceneAt(project, 24).local, 8);
  assert.equal(sceneAt(project, 1000).local, 8);
  assert.equal(sceneAt(project, -10).local, 0);
});

test('two-minute limit accepts the boundary and rejects excess without changing input', () => {
  const project = makeProject();
  project.scenes = Array.from({ length: 5 }, () => ({ ...structuredClone(project.scenes[0]), duration: 24 }));
  assert.equal(durationOf(validateProject(project)), 120);
  project.scenes[4].duration = 24.001;
  const before = JSON.stringify(project);
  assert.throws(() => validateProject(project), /two minutes/);
  assert.equal(JSON.stringify(project), before);
});

test('scene timing must be finite numbers within 2–30 seconds', () => {
  for (const value of [2, 30]) {
    const project = makeProject(); project.scenes[0].duration = value;
    assert.equal(validateProject(project).scenes[0].duration, value);
  }
  for (const value of [0, 1.999, 30.001, NaN, Infinity, '8', null]) {
    const project = makeProject(); project.scenes[0].duration = value;
    assert.throws(() => validateProject(project), /2–30 seconds/);
  }
});

test('imports reject remote URLs, blob references and SVG payloads in every asset slot', () => {
  const rejected = [
    'https://example.com/file.png', '//example.com/file.png',
    'blob:temporary-session-reference', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ];
  for (const value of rejected) {
    for (const slot of ['logo', 'audio', 'scene']) {
      const project = makeProject();
      if (slot === 'scene') project.scenes[0].image = value;
      else project[slot] = value;
      assert.throws(() => validateProject(project), /Invalid (image|audio)/);
    }
  }
});

test('local media survives project serialization while executable or unknown fields are discarded', () => {
  const project = makeProject();
  project.logo = 'data:image/png;base64,aGVsbG8=';
  project.audio = 'data:audio/mpeg;base64,aGVsbG8=';
  project.audioName = 'narration.mp3';
  project.scenes[0].image = 'data:image/webp;base64,aGVsbG8=';
  project.script = 'remote script';
  project.scenes[0].onload = 'untrusted command';
  const imported = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(imported.logo, project.logo);
  assert.equal(imported.audio, project.audio);
  assert.equal(imported.scenes[0].image, project.scenes[0].image);
  assert.equal(Object.hasOwn(imported, 'script'), false);
  assert.equal(Object.hasOwn(imported.scenes[0], 'onload'), false);
  // Byte decoding is a separate browser validation step; this checks the schema only.
});

test('imported prototype-key palette names do not bypass the supported-palette check', () => {
  for (const palette of ['__proto__', 'constructor', 'toString']) {
    const project = makeProject(); project.palette = palette;
    assert.throws(() => validateProject(project), /Unsupported/);
  }
});

test('unsupported version, empty scenes and excessive scene count fail before use', () => {
  assert.throws(() => validateProject(null), /version 1/);
  assert.throws(() => validateProject({ ...makeProject(), version: 2 }), /version 1/);
  assert.throws(() => validateProject({ ...makeProject(), scenes: [] }), /1–12 scenes/);
  const project = makeProject();
  project.scenes = Array.from({ length: 13 }, () => ({ ...structuredClone(project.scenes[0]), duration: 2 }));
  assert.throws(() => validateProject(project), /1–12 scenes/);
});

test('invalid edited text and unsupported animation cannot enter an imported project', () => {
  const blank = makeProject(); blank.scenes[0].title = '   ';
  assert.throws(() => validateProject(blank), /heading/);
  const huge = makeProject(); huge.scenes[0].body = 'x'.repeat(221);
  assert.throws(() => validateProject(huge), /description/);
  const effect = makeProject(); effect.scenes[0].effect = 'run-script';
  assert.throws(() => validateProject(effect), /animation/);
});

test('fit narration preserves relative scene pacing and leaves the original untouched', () => {
  const project = makeProject();
  project.scenes[0].duration = 12;
  project.scenes[1].duration = 6;
  project.scenes[2].duration = 6;
  const before = structuredClone(project);
  const fitted = fitNarration(project, 31.1);
  assert.ok(durationOf(fitted) > 31.1);
  assert.ok(durationOf(fitted) <= 32.6);
  assert.equal(fitted.scenes[0].duration / fitted.scenes[1].duration, 2);
  assert.deepEqual(project, before);
  assert.deepEqual(fitted.scenes.map(s => s.title), project.scenes.map(s => s.title));
});

test('narration fitting fails safely when the duration cannot fit the scene limits', () => {
  for (const seconds of [0, -20, NaN, Infinity, 121]) {
    const project = makeProject(), before = structuredClone(project);
    assert.throws(() => fitNarration(project, seconds));
    assert.deepEqual(project, before);
  }
});

test('export dimensions retain the selected orientation and even codec dimensions', () => {
  for (const size of [540, 720, 1080]) {
    const vertical = dimensions('vertical', size), wide = dimensions('wide', size);
    assert.ok(vertical.height > vertical.width);
    assert.equal(vertical.width, wide.height);
    assert.equal(vertical.height, wide.width);
    assert.equal(vertical.width % 2, 0);
    assert.equal(vertical.height % 2, 0);
    assert.ok(vertical.width * vertical.height <= 1920 * 1080);
  }
});
