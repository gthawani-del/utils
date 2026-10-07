import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, splitTimeline, removeTimelineSegment, appendTimeline, moveTimelineSegment, timelineDuration } from '../lib/media/video/timeline.js';

test('split preserves total duration and source offsets', () => {
  const original = createTimeline('clip-a', 10);
  const split = splitTimeline(original, 4);
  assert.deepEqual(split, [{ sourceId: 'clip-a', start: 0, end: 4 }, { sourceId: 'clip-a', start: 4, end: 10 }]);
  assert.equal(timelineDuration(split), 10);
  assert.equal(original.length, 1);
});
test('delete closes gap without changing original', () => {
  const clips = splitTimeline(createTimeline('a', 10), 4);
  assert.deepEqual(removeTimelineSegment(clips, 0), [{ sourceId: 'a', start: 4, end: 10 }]);
  assert.equal(clips.length, 2);
});
test('append and reorder clips', () => {
  const clips = appendTimeline(createTimeline('a', 3), 'b', 5);
  assert.deepEqual(moveTimelineSegment(clips, 1, 0).map(x => x.sourceId), ['b', 'a']);
  assert.equal(timelineDuration(clips), 8);
});
test('reject invalid values and boundaries', () => {
  assert.throws(() => createTimeline('a', -1), RangeError);
  assert.throws(() => splitTimeline(createTimeline('a', 5), NaN), RangeError);
  assert.throws(() => removeTimelineSegment(createTimeline('a', 5), 9), RangeError);
  assert.equal(splitTimeline(createTimeline('a', 5), 0).length, 1);
  assert.equal(splitTimeline(createTimeline('a', 5), 5).length, 1);
});
