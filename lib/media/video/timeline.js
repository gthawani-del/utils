// Non-destructive timeline operations. Source files are never modified.
const MAX_SEGMENTS = 500;
const EPSILON = 0.001;
function validTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function assertSegments(segments) {
  if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS) throw new RangeError('Invalid segment list');
  for (const segment of segments) {
    if (!segment || typeof segment.sourceId !== 'string' || !segment.sourceId ||
      !validTime(segment.start) || !validTime(segment.end) || segment.end - segment.start <= EPSILON) {
      throw new RangeError('Invalid timeline segment');
    }
  }
}
export function createTimeline(sourceId, duration) {
  if (typeof sourceId !== 'string' || !sourceId || !validTime(duration)) throw new RangeError('Invalid source');
  return duration > EPSILON ? [{ sourceId, start: 0, end: duration }] : [];
}
export function timelineDuration(segments) {
  assertSegments(segments);
  return segments.reduce((sum, item) => sum + item.end - item.start, 0);
}
export function splitTimeline(segments, position) {
  assertSegments(segments);
  if (!validTime(position)) throw new RangeError('Invalid split position');
  const duration = timelineDuration(segments);
  if (position <= EPSILON || position >= duration - EPSILON) return segments.map(s => ({ ...s }));
  let elapsed = 0;
  const output = [];
  for (const segment of segments) {
    const length = segment.end - segment.start;
    const offset = position - elapsed;
    if (offset > EPSILON && offset < length - EPSILON) {
      output.push({ ...segment, end: segment.start + offset }, { ...segment, start: segment.start + offset });
    } else output.push({ ...segment });
    elapsed += length;
  }
  assertSegments(output);
  return output;
}
export function removeTimelineSegment(segments, index) {
  assertSegments(segments);
  if (!Number.isInteger(index) || index < 0 || index >= segments.length) throw new RangeError('Invalid segment index');
  return segments.filter((_, i) => i !== index).map(s => ({ ...s }));
}
export function appendTimeline(segments, sourceId, duration) {
  assertSegments(segments);
  const next = createTimeline(sourceId, duration);
  const output = [...segments.map(s => ({ ...s })), ...next];
  assertSegments(output);
  return output;
}
export function moveTimelineSegment(segments, from, to) {
  assertSegments(segments);
  if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < segments.length)) throw new RangeError('Invalid segment index');
  const output = segments.map(s => ({ ...s }));
  const [item] = output.splice(from, 1);
  output.splice(to, 0, item);
  return output;
}
