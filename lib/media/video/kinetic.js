import { activeWord, beatPulse, MOTION_TEMPLATES } from './motion.js';
// Deterministic kinetic text cues shared by preview and export.
export const TEXT_EFFECTS = Object.freeze(['fade', 'pop', 'slide', 'pulse']);
export function normalizeTextCue(cue, duration = Infinity) {
  const text = String(cue?.text || '').trim().slice(0, 160);
  const start = Number(cue?.start), end = Number(cue?.end);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration) throw new RangeError('Invalid kinetic text cue');
  const preset = MOTION_TEMPLATES[cue?.template] || MOTION_TEMPLATES.clean;
  const effect = TEXT_EFFECTS.includes(cue?.effect) ? cue.effect : preset.effect;
  const keyframes = Array.isArray(cue?.keyframes) ? cue.keyframes.slice(0, 20).map(frame => ({
    time: Number(frame.time), scale: Number(frame.scale), y: Number(frame.y)
  })).filter(frame => Number.isFinite(frame.time) && frame.time >= start && frame.time <= end && Number.isFinite(frame.scale) && frame.scale >= 0.2 && frame.scale <= 4 && Number.isFinite(frame.y) && Math.abs(frame.y) <= 500).sort((a,b) => a.time-b.time) : [];
  const words = Array.isArray(cue?.words) ? cue.words.slice(0, 100).map(word => ({ text: String(word.text || '').slice(0, 40), start: Number(word.start), end: Number(word.end) })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= start && word.end <= end && word.end > word.start) : [];
  const beats = Array.isArray(cue?.beats) ? cue.beats.slice(0, 3000).filter(beat => Number.isFinite(beat) && beat >= 0).sort((a,b) => a-b) : [];
  return { text, start, end, effect, template: cue?.template in MOTION_TEMPLATES ? cue.template : 'clean', beatReactive: Boolean(cue?.beatReactive ?? preset.beatReactive), keyframes, words, beats };
}
function interpolateKeyframes(frames, time, fallback) {
  if (!frames.length) return fallback;
  if (time <= frames[0].time) return frames[0];
  if (time >= frames.at(-1).time) return frames.at(-1);
  const index = frames.findIndex(frame => frame.time >= time);
  const a = frames[index - 1], b = frames[index];
  const t = (time - a.time) / (b.time - a.time || 1);
  return { scale: a.scale + (b.scale - a.scale) * t, y: a.y + (b.y - a.y) * t };
}
export function kineticTextFrame(cue, time) {
  if (!cue || !Number.isFinite(time) || time < cue.start || time >= cue.end) return null;
  const entrance = Math.min(1, (time - cue.start) / 0.3);
  const exit = Math.min(1, (cue.end - time) / 0.25);
  const alpha = Math.max(0, Math.min(1, entrance, exit));
  const effect = cue.effect;
  const preset = MOTION_TEMPLATES[cue.template] || MOTION_TEMPLATES.clean;
  const progress = (time - cue.start) / (cue.end - cue.start);
  const key = interpolateKeyframes(cue.keyframes || [], time, { scale: preset.scaleStart + (preset.scaleEnd - preset.scaleStart) * progress, y: preset.yStart + (preset.yEnd - preset.yStart) * progress });
  const pulse = cue.beatReactive ? beatPulse(cue.beats, time) : 0;
  return {
    text: cue.text,
    alpha: effect === 'fade' ? alpha : Math.min(1, alpha * 3),
    scale: key.scale * (effect === 'pop' ? 0.72 + 0.28 * entrance : effect === 'pulse' ? 1 + 0.055 * Math.sin(time * 9) : 1) * (1 + pulse * 0.18),
    offsetY: key.y + (effect === 'slide' ? 45 * (1 - entrance) : 0),
    words: cue.words || [], activeWordIndex: activeWord(cue.words, time)
  };
}
export function drawKineticText(ctx, cues, time, width, height) {
  if (!Array.isArray(cues)) return;
  for (const cue of cues) {
    const frame = kineticTextFrame(cue, time);
    if (!frame) continue;
    ctx.save();
    ctx.globalAlpha = frame.alpha;
    ctx.translate(width / 2, height * 0.78 + frame.offsetY);
    ctx.scale(frame.scale, frame.scale);
    const fontSize = Math.max(18, Math.round(width * 0.055));
    ctx.font = '700 ' + fontSize + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, fontSize / 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#ffffff';
    const words = frame.words.length ? frame.words.map(word => word.text) : frame.text.split(/\s+/);
    const lines = []; let line = []; let lineWidth = '';
    for (let i = 0; i < words.length; i++) {
      const next = [...line, { text: words[i], index: i }];
      if (ctx.measureText(next.map(w => w.text).join(' ')).width > width * 0.84 && line.length) { lines.push(line); line = [{ text: words[i], index: i }]; }
      else line = next;
    }
    if (line.length) lines.push(line);
    lines.slice(0, 4).forEach((items, index) => {
      const y = (index - (Math.min(lines.length, 4) - 1) / 2) * fontSize * 1.18;
      const full = items.map(w => w.text).join(' ');
      const totalWidth = ctx.measureText(full).width;
      let x = -totalWidth / 2;
      items.forEach((word, wi) => {
        const token = word.text + (wi < items.length - 1 ? ' ' : '');
        const tokenWidth = ctx.measureText(token).width;
        ctx.textAlign = 'left';
        ctx.strokeText(token, x, y);
        ctx.fillStyle = frame.words.length && word.index === frame.activeWordIndex ? '#facc15' : '#ffffff';
        ctx.fillText(token, x, y);
        x += tokenWidth;
      });
    });
    ctx.restore();
  }
}
