import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, planCapabilities, reevaluateAction } from '../lib/media/command/grammar.js';

const audioProject = {
  source: { kind: 'local-file', mediaType: 'audio', duration: 60 }
};

test('command grammar extracts multiple actions in source order', () => {
  const plan = parseCommand('trim from 5s to 20s, volume 80%, fade in 2s, make a 9:16 reel and run QC', audioProject);
  assert.deepEqual(plan.actions.map((item) => item.type), ['trim', 'volume', 'fade-in', 'set-aspect', 'run-qc']);
  assert.equal(plan.actions.every((item) => item.status === 'ready'), true);
  assert.deepEqual(plan.actions[0].params, { start: 5, end: 20 });
  assert.equal(plan.actions[1].params.percent, 80);
  assert.equal(plan.actions[3].params.aspect, '9:16');
});

test('example command recognizes unsupported operations instead of pretending they work', () => {
  const plan = parseCommand('Remove silence, normalize the voice, add captions and make a reel under 25 MB', audioProject);
  assert.deepEqual(plan.actions.map((item) => item.type), [
    'remove-silence',
    'normalize-audio',
    'generate-captions',
    'set-aspect',
    'target-size'
  ]);
  assert.equal(plan.actions.find((item) => item.type === 'remove-silence').status, 'blocked');
  assert.equal(plan.actions.find((item) => item.type === 'set-aspect').status, 'ready');
  assert.equal(plan.actions.find((item) => item.type === 'target-size').params.megabytes, 25);
});

test('trim and audio commands block without a compatible local source', () => {
  const plan = parseCommand('trim from 1s to 4s and volume 50%', { source: null });
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions.every((item) => item.status === 'blocked'), true);
});

test('editable parameters are revalidated deterministically', () => {
  const plan = parseCommand('volume 80%', audioProject);
  const invalid = reevaluateAction({ ...plan.actions[0], params: { percent: 140 } }, audioProject);
  assert.equal(invalid.status, 'blocked');
  const valid = reevaluateAction({ ...plan.actions[0], params: { percent: 35 } }, audioProject);
  assert.equal(valid.status, 'ready');
});

test('explicit navigation aliases route to known workspaces', () => {
  const plan = parseCommand('open Audio Studio then show QC', audioProject);
  assert.deepEqual(plan.actions.map((item) => item.params.category), ['audio', 'qc']);
  assert.equal(plan.actions.every((item) => item.status === 'ready'), true);
});


test('supported Planned Actions distinguish renderable Version edits from working workflow actions', () => {
  const audio = parseCommand('trim from 5s to 20s, volume 80%, fade in 2s and run QC', audioProject);
  assert.deepEqual(audio.actions.map((item) => item.execution), ['renderable', 'renderable', 'renderable', 'workflow']);
  assert.deepEqual(planCapabilities(audio.actions), {
    total: 4,
    renderable: 3,
    workflow: 1,
    blocked: 0,
    canPreview: true,
    canCreateVersion: true
  });

  const videoProject = { source: { kind: 'local-file', mediaType: 'video', duration: 60 } };
  const video = parseCommand('trim from 2s to 12s and make 9:16', videoProject);
  assert.deepEqual(video.actions.map((item) => item.execution), ['renderable', 'renderable']);
  assert.equal(video.actions.find((item) => item.type === 'set-aspect').status, 'ready');
});

test('working non-Version actions remain Preview-capable but do not falsely enable Create Version', () => {
  const plan = parseCommand('make 9:16 and open Audio Studio', audioProject);
  assert.equal(plan.actions.every((item) => item.status === 'ready'), true);
  assert.equal(plan.actions.every((item) => item.execution === 'workflow'), true);
  const capabilities = planCapabilities(plan.actions);
  assert.equal(capabilities.canPreview, true);
  assert.equal(capabilities.canCreateVersion, false);
});

test('blocked actions prevent both Preview and Create Version until resolved or removed', () => {
  const plan = parseCommand('trim from 1s to 10s and normalize audio', audioProject);
  const capabilities = planCapabilities(plan.actions);
  assert.equal(capabilities.renderable, 1);
  assert.equal(capabilities.blocked, 1);
  assert.equal(capabilities.canPreview, false);
  assert.equal(capabilities.canCreateVersion, false);
});
