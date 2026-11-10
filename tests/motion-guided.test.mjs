import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPatterns, questionsFor, getMissingQuestions, validateAnswers, buildGuidedProject, PATTERNS } from '../lib/motion/guided.js';
import { durationOf } from '../lib/motion/project.js';
const answers = () => ({
  templateId: 'problem', description: 'Our society loses track of repair requests.', audience: 'Committee members',
  consequence: 'Residents cannot see the current status.', solution: 'Residents submit requests in a shared register.',
  points: ['Submit a request', 'Assign a contractor', 'Review completion'], action: 'Submit a request to the committee.',
});

test('unknown descriptions do not force a pattern', () => {
  for (const description of ['', null, 'A quiet evening beside the sea.', 'x'.repeat(221)]) assert.deepEqual(suggestPatterns(description), []);
});
test('ambiguous descriptions expose multiple honest keyword matches', () => {
  const suggested = suggestPatterns('Our society loses track of repair requests.');
  assert.deepEqual(suggested.map(item => item.id), ['problem', 'workflow']);
  assert.ok(suggested.every(item => item.reason && !('confidence' in item)));
});
test('keyword matches use word boundaries instead of accidental substrings', () => {
  assert.deepEqual(suggestPatterns('We have an appetite for history.'), []);
  assert.ok(suggestPatterns('Show the app.').some(item => item.id === 'walkthrough'));
});
test('the same description always yields the same suggestions without a network service', () => {
  assert.deepEqual(suggestPatterns('Connect files and voice tasks.'), suggestPatterns('Connect files and voice tasks.'));
});
test('questions vary by chosen pattern and already supplied answers are skipped', () => {
  assert.notEqual(questionsFor('systems').find(q => q.id === 'solution').prompt, questionsFor('voice').find(q => q.id === 'solution').prompt);
  assert.deepEqual(getMissingQuestions(answers()), []);
  const partial = answers(); delete partial.solution; delete partial.action;
  assert.deepEqual(getMissingQuestions(partial).map(q => q.id), ['solution', 'action']);
});
test('invalid or partial visual labels are asked again', () => {
  for (const points of [null, [], ['one', 'two'], ['one','two',''], ['one','two','x'.repeat(41)]]) {
    assert.ok(getMissingQuestions({...answers(), points}).some(q => q.id === 'points'));
  }
});
test('a chosen pattern is required and no fact is inferred from keywords', () => {
  const unconfirmed = answers(); delete unconfirmed.templateId;
  assert.throws(() => validateAnswers(unconfirmed), /confirm/);
  assert.throws(() => validateAnswers({...answers(), templateId:'__proto__'}), /confirm/);
  assert.throws(() => validateAnswers({...answers(), solution:''}), /your approach/);
});
test('oversized answers fail without silently truncating user content', () => {
  assert.throws(() => validateAnswers({...answers(), description:'x'.repeat(221)}), /character limits/);
  assert.throws(() => validateAnswers({...answers(), audience:'x'.repeat(81)}), /character limits/);
});
test('validation keeps supplied text and strips unknown fields', () => {
  const input = {...answers(), inventedMetric:'80%', maliciousCode:'eval(1)'};
  assert.deepEqual(validateAnswers(input), answers());
});
test('guided story uses only supplied facts in body and narration', () => {
  const input = answers(), project = buildGuidedProject(input, {duration:40});
  assert.equal(project.scenes.length,5);
  const expected = [input.description,input.consequence,input.solution,input.points.join('. ')+'.',input.action];
  assert.deepEqual(project.scenes.map(s=>s.body), expected);
  assert.deepEqual(project.scenes.map(s=>s.narration), expected);
  assert.equal(project.scenes.at(-1).layout,'closing');
  assert.equal(durationOf(project),40);
  assert.ok(!JSON.stringify(project).includes('save 50%'));
});
test('every guided pattern creates a validated, independent project', () => {
  for (const pattern of PATTERNS) {
    const project = buildGuidedProject({...answers(),templateId:pattern.id}, {duration:120,format:'wide'});
    assert.equal(project.template,pattern.id);
    assert.equal(project.scenes[2].layout,pattern.id);
    assert.equal(durationOf(project),120);
    project.scenes[0].points[0]='Edited';
    assert.equal(project.scenes[1].points[0],'Submit a request');
  }
});
test('guided durations respect five-scene minimum and total export limit', () => {
  assert.equal(durationOf(buildGuidedProject(answers(), {duration:10})),10);
  for (const duration of [0,9,121,NaN,Infinity,'40']) assert.throws(()=>buildGuidedProject(answers(),{duration}), /10–120/);
});
