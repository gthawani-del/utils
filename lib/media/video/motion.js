// Browser-local transient onset detection. Estimates strong rhythmic transients, not musical semantics.
export function detectBeats(samples, sampleRate, { hop = 1024, minimumGap = 0.24 } = {}) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const energies = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const end = Math.min(samples.length, i + hop);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    energies.push(Math.sqrt(sum / (end - i)));
  }
  const beats = [];
  for (let i = 2; i < energies.length - 1; i++) {
    const lo = Math.max(0, i - 24);
    let average = 0;
    for (let j = lo; j < i; j++) average += energies[j];
    average /= Math.max(1, i - lo);
    const energy = energies[i];
    const t = i * hop / sampleRate;
    if (energy > 0.025 && energy > average * 1.65 && energy >= energies[i - 1] && energy > energies[i + 1] && (!beats.length || t - beats.at(-1) >= minimumGap)) beats.push(t);
  }
  return beats.slice(0, 3000);
}
export function beatPulse(beats, time, window = 0.22) {
  if (!Array.isArray(beats) || !Number.isFinite(time)) return 0;
  let pulse = 0;
  for (const beat of beats) {
    if (beat > time) break;
    if (time - beat < window) pulse = Math.max(pulse, 1 - (time - beat) / window);
  }
  return pulse;
}
export function parseWordTimings(text, start, end) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const span = (end - start) / words.length;
  return words.map((word, index) => ({ text: word, start: start + index * span, end: start + (index + 1) * span }));
}
export function activeWord(words, time) {
  return Array.isArray(words) ? words.findIndex(word => time >= word.start && time < word.end) : -1;
}
export const MOTION_TEMPLATES = Object.freeze({
  clean: { effect: 'fade', beatReactive: false, scaleStart: 1, scaleEnd: 1, yStart: 0, yEnd: 0 },
  punch: { effect: 'pop', beatReactive: true, scaleStart: 0.75, scaleEnd: 1, yStart: 0, yEnd: 0 },
  cinematic: { effect: 'slide', beatReactive: false, scaleStart: 1, scaleEnd: 1.06, yStart: 38, yEnd: 0 },
  rhythm: { effect: 'pulse', beatReactive: true, scaleStart: 1, scaleEnd: 1, yStart: 0, yEnd: 0 }
});
