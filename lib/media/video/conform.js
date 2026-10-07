// Deterministic project-wide conform settings for heterogeneous video sources.
export const SMOOTH_MATCH_DEFAULTS = Object.freeze({ aspect: '9:16', fit: 'contain', fps: 30 });
export function normalizeSmoothMatch(input = {}) {
  const aspect = ['9:16','16:9','1:1','4:5','original'].includes(input.aspect) ? input.aspect : '9:16';
  const fit = ['contain','cover'].includes(input.fit) ? input.fit : 'contain';
  const fps = [24,30,60].includes(Number(input.fps)) ? Number(input.fps) : 30;
  return { aspect, fit, fps };
}
export function validateConformSources(segments, sources) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 500) throw new RangeError('No valid segments');
  if (!sources || typeof sources !== 'object') throw new RangeError('Missing media sources');
  let total = 0;
  for (const segment of segments) {
    const source = sources[segment.sourceId];
    if (!source?.objectUrl || !Number.isFinite(source.duration) || source.duration <= 0) throw new RangeError('Missing source media: ' + segment.sourceId);
    if (![segment.start, segment.end].every(Number.isFinite) || segment.start < 0 || segment.end <= segment.start || segment.end > source.duration + .05) throw new RangeError('Invalid segment bounds');
    total += segment.end - segment.start;
  }
  if (total > 1800) throw new RangeError('Maximum 30 minutes per local export');
  return total;
}
export function timelinePositionToSegment(segments, position) {
  if (!Number.isFinite(position) || position < 0) return null;
  let elapsed = 0;
  for (let i=0; i<segments.length; i++) {
    const segment = segments[i], duration = segment.end-segment.start;
    if (position < elapsed+duration || i === segments.length-1 && position <= elapsed+duration) {
      return { index: i, sourceId: segment.sourceId, sourceTime: segment.start + Math.min(duration, position-elapsed) };
    }
    elapsed += duration;
  }
  return null;
}
