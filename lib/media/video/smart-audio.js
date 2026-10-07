// Local deterministic silence analysis. Never infers speech or transcribes.
export function detectSilentRanges(samples, sampleRate, { thresholdDb = -38, minSeconds = 0.65, hopSeconds = 0.05 } = {}) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const hop = Math.max(1, Math.floor(sampleRate * hopSeconds));
  const threshold = 10 ** (thresholdDb / 20);
  const ranges = [];
  let start = -1;
  for (let i = 0; i < samples.length; i += hop) {
    let power = 0;
    const end = Math.min(samples.length, i + hop);
    for (let j = i; j < end; j++) power += samples[j] * samples[j];
    const silent = Math.sqrt(power / (end - i)) < threshold;
    if (silent && start < 0) start = i / sampleRate;
    if (!silent && start >= 0) {
      const finish = i / sampleRate;
      if (finish - start >= minSeconds) ranges.push({ start, end: finish });
      start = -1;
    }
  }
  if (start >= 0) {
    const finish = samples.length / sampleRate;
    if (finish - start >= minSeconds) ranges.push({ start, end: finish });
  }
  return ranges;
}
export function keepRangesWithoutSilence(duration, silentRanges, padding = 0.12) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const keep = [];
  let cursor = 0;
  for (const range of silentRanges) {
    const a = Math.max(cursor, Math.max(0, range.start + padding));
    const b = Math.min(duration, range.end - padding);
    if (a > cursor + 0.01) keep.push({ start: cursor, end: a });
    cursor = Math.max(cursor, b);
  }
  if (duration > cursor + 0.01) keep.push({ start: cursor, end: duration });
  return keep;
}
