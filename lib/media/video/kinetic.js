// Deterministic kinetic text cues shared by preview and export.
export const TEXT_EFFECTS = Object.freeze(['fade', 'pop', 'slide', 'pulse']);
export function normalizeTextCue(cue, duration = Infinity) {
  const text = String(cue?.text || '').trim().slice(0, 160);
  const start = Number(cue?.start);
  const end = Number(cue?.end);
  const effect = TEXT_EFFECTS.includes(cue?.effect) ? cue.effect : 'fade';
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration) throw new RangeError('Invalid kinetic text cue');
  return { text, start, end, effect };
}
export function kineticTextFrame(cue, time) {
  if (!cue || !Number.isFinite(time) || time < cue.start || time >= cue.end) return null;
  const progress = (time - cue.start) / (cue.end - cue.start);
  const entrance = Math.min(1, (time - cue.start) / 0.3);
  const exit = Math.min(1, (cue.end - time) / 0.25);
  const alpha = Math.max(0, Math.min(1, entrance, exit));
  const effect = cue.effect;
  return {
    text: cue.text,
    alpha: effect === 'fade' ? alpha : Math.min(1, alpha * 3),
    scale: effect === 'pop' ? 0.72 + 0.28 * Math.min(1, entrance) : effect === 'pulse' ? 1 + 0.055 * Math.sin(time * 9) : 1,
    offsetY: effect === 'slide' ? 45 * (1 - Math.min(1, entrance)) : 0
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, fontSize / 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#ffffff';
    const words = frame.text.split(/\\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > width * 0.84 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    lines.slice(0, 4).forEach((item, index) => {
      const y = (index - (Math.min(lines.length, 4) - 1) / 2) * fontSize * 1.18;
      ctx.strokeText(item, 0, y);
      ctx.fillText(item, 0, y);
    });
    ctx.restore();
  }
}
