// Deterministic editing helpers; no external models or services.
export function normalizeRepairSettings(value = {}) {
  const clamp = (x, lo, hi, fallback) => Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : fallback;
  return {
    brightness: clamp(value.brightness, 0.5, 1.5, 1),
    contrast: clamp(value.contrast, 0.5, 1.5, 1),
    gain: clamp(value.gain, 0, 2, 1),
    stabilization: clamp(value.stabilization, 0, 1, 0),
    interpolation: value.interpolation === 'blend' ? 'blend' : 'hold'
  };
}
export function calculateFrameSchedule(duration, fps) {
  if (!Number.isFinite(duration) || duration < 0 || !Number.isInteger(fps) || fps < 1 || fps > 60) throw new RangeError('Invalid frame schedule');
  if (duration * fps > 108000) throw new RangeError('Too many output frames');
  return Array.from({ length: Math.ceil(duration * fps) }, (_, index) => index / fps);
}
export function frameBlendWeight(time, previousTime, nextTime) {
  if (!(nextTime > previousTime)) return 0;
  return Math.max(0, Math.min(1, (time - previousTime) / (nextTime - previousTime)));
}
export function frameDifference(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) throw new RangeError('Invalid image buffers');
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]);
  }
  return sum / (a.length / 4 * 3 * 255);
}
export function detectSceneCuts(frames, threshold = 0.23) {
  const cuts = [];
  for (let i = 1; i < frames.length; i++) {
    if (frameDifference(frames[i].pixels, frames[i-1].pixels) >= threshold) cuts.push(frames[i].time);
  }
  return cuts;
}
export function normalizeCaptionCues(cues, duration) {
  if (!Array.isArray(cues)) return [];
  return cues.slice(0, 500).map(cue => ({
    start: Number(cue.start), end: Number(cue.end), text: String(cue.text || '').trim().slice(0, 200)
  })).filter(cue => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.end <= duration);
}

export function meanLuminance(pixels) {
  if (!pixels?.length) return 0;
  let total = 0;
  for (let i=0; i<pixels.length; i+=4) total += .2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
  return total / (pixels.length / 4);
}
export function matchBrightness(reference, target) {
  if (!(reference > 0) || !(target > 0)) return 1;
  return Math.max(.7, Math.min(1.3, reference / target));
}
export function rmsLevel(samples) {
  if (!samples?.length) return 0;
  let total = 0;
  for (let i=0; i<samples.length; i++) total += samples[i] * samples[i];
  return Math.sqrt(total / samples.length);
}
export function matchAudioGain(reference, target) {
  if (!(reference > 0) || !(target > 0)) return 1;
  return Math.max(.5, Math.min(2, reference / target));
}

export function mapCaptionsToTimeline(cues, segments, sourceId = 'active-video') {
  if (!Array.isArray(cues) || !Array.isArray(segments)) return [];
  let offset = 0;
  const mapped = [];
  for (const segment of segments) {
    if (segment.sourceId === sourceId) {
      for (const cue of cues) {
        const start = Math.max(Number(cue.start), segment.start);
        const end = Math.min(Number(cue.end), segment.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          mapped.push({ text: cue.text, start: offset + start - segment.start, end: offset + end - segment.start });
        }
      }
    }
    offset += segment.end - segment.start;
  }
  return normalizeCaptionCues(mapped, offset);
}
