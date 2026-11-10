import { PALETTES, sceneAt, durationOf } from './project.js';
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => 1 - Math.pow(1 - clamp(x), 3);
function box(ctx, x, y, w, h, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function lines(ctx, text, width) {
  const words = text.split(/\s+/).filter(Boolean), result = []; let line = '';
  for (const word of words) {
    if (ctx.measureText(line ? line + ' ' + word : word).width > width && line) { result.push(line); line = ''; }
    if (ctx.measureText(word).width > width) {
      for (const char of [...word]) { if (ctx.measureText(line + char).width > width && line) { result.push(line); line = ''; } line += char; }
    } else line += (line ? ' ' : '') + word;
  }
  if (line) result.push(line);
  return result;
}
function paragraph(ctx, text, x, y, width, size, maxLines, color, progress, weight = 600) {
  let rows;
  do { ctx.font = `${weight} ${size}px system-ui, sans-serif`; rows = lines(ctx, text, width); if (rows.length <= maxLines || size <= 12) break; size -= 1; } while (true);
  ctx.fillStyle = color; ctx.textBaseline = 'top';
  rows.forEach((line, i) => {
    const p = ease(progress - i * .12);
    ctx.save(); ctx.beginPath(); ctx.rect(x - 2, y + i * size * 1.18, width + 4, size * 1.22); ctx.clip();
    ctx.globalAlpha *= p; ctx.fillText(line, x, y + i * size * 1.18 + (1 - p) * size * 1.4); ctx.restore();
  });
  return rows.length * size * 1.18;
}
function contain(ctx, img, x, y, w, h) { const ratio = Math.min(w / img.width, h / img.height); const iw = img.width * ratio, ih = img.height * ratio; ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
export function drawFrame(ctx, project, time, images = new Map()) {
  const { width, height } = ctx.canvas; const wide = project.format === 'wide';
  const W = wide ? 960 : 540, H = wide ? 540 : 960;
  ctx.save(); ctx.scale(width / W, height / H);
  const palette = PALETTES[project.palette], { scene, index, local } = sceneAt(project, time);
  ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, W, H);
  const m = wide ? 48 : 38;
  ctx.fillStyle = palette.ink; ctx.font = '600 13px system-ui'; ctx.textBaseline = 'top';
  ctx.fillText(project.brand || 'MOTION STUDIO', m, 34);
  ctx.textAlign = 'right'; ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(project.scenes.length).padStart(2, '0')}`, W - m, 34); ctx.textAlign = 'left';
  const end = index === project.scenes.length - 1 ? 1 : ease((scene.duration - local) / .45); ctx.globalAlpha = end;
  const entry = local / .65, effectShift = scene.effect === 'rise' ? (1 - ease(entry)) * 30 : 0;
  ctx.translate(0, effectShift);
  const tw = wide ? 410 : W - m * 2;
  const titleY = wide ? 125 : 120;
  const titleH = paragraph(ctx, scene.title, m, titleY, tw, wide ? 48 : 51, 4, palette.ink, entry, 700);
  paragraph(ctx, scene.body, m, titleY + titleH + 22, tw, 20, wide ? 5 : 5, palette.ink, entry - .4, 400);
  const gx = wide ? 525 : m, gy = wide ? 120 : 545, gw = wide ? 387 : W - m * 2, gh = wide ? 320 : 295;
  const photo = images.get(scene.image);
  if (photo) {
    ctx.save(); const p = ease(entry - .3); ctx.beginPath(); ctx.roundRect(gx, gy + (1 - p) * 24, gw, gh, 20); ctx.clip(); ctx.globalAlpha *= p;
    ctx.fillStyle = palette.soft; ctx.fillRect(gx, gy, gw, gh); contain(ctx, photo, gx + 12, gy + 12, gw - 24, gh - 24); ctx.restore();
  } else if (scene.layout === 'steps') {
    const labels = scene.points;
    for (let i = 0; i < 3; i++) {
      const p = ease(entry - (scene.effect === 'stagger' ? i * .4 : i * .15) - .3);
      const y = gy + i * (gh / 3), x = gx + (1 - p) * 45;
      ctx.save(); ctx.globalAlpha *= p; box(ctx, x, y, gw, gh / 3 - 12, 14, palette.soft);
      box(ctx, x + 16, y + 18, 39, 39, 20, palette.accent);
      ctx.fillStyle = palette.bg; ctx.font = '600 18px system-ui'; ctx.fillText(String(i + 1), x + 30, y + 27);
      paragraph(ctx, labels[i], x + 75, y + 20, gw - 90, 22, 2, palette.ink, 2); ctx.restore();
    }
  } else if (scene.layout === 'closing') {
    const p = ease(entry - .3); ctx.save(); ctx.globalAlpha *= p;
    const logo = images.get(project.logo);
    if (logo) contain(ctx, logo, gx + 24, gy + 15, gw - 48, gh - 90);
    else {
      box(ctx, gx, gy + 20, gw, gh - 90, 20, palette.soft);
      paragraph(ctx, project.brand || 'Your next chapter', gx + 24, gy + 62, gw - 48, 33, 3, palette.ink, entry - .2);
    }
    paragraph(ctx, project.url, gx, gy + gh - 47, gw, 18, 2, palette.ink, entry - .6, 500); ctx.restore();
  } else {
    // An original layered-card reveal: depth comes from projected offsets and shadows.
    for (let i = 0; i < 3; i++) {
      const p = ease(entry - i * .18 - .2), offset = (2 - i) * 20;
      ctx.save(); ctx.translate(gx + gw / 2, gy + gh / 2); ctx.rotate((i - 1) * .07 * p);
      ctx.translate(-gw / 2 + offset, -gh / 2 + offset - (1 - p) * 50);
      ctx.globalAlpha *= p; ctx.shadowColor = '#00000014'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
      box(ctx, 15, 15, gw - 75, gh - 65, 18, i === 2 ? palette.accent : palette.soft);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (i === 2) {
        ctx.strokeStyle = palette.bg; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let j = 0; j < 3; j++) { const q = ease(entry - .7 - j * .18); ctx.beginPath(); ctx.moveTo(45, 65 + j * 48); ctx.lineTo(45 + (gw - 155 - j * 20) * q, 65 + j * 48); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = palette.soft; ctx.fillRect(m, H - 42, W - m * 2, 3);
  ctx.fillStyle = palette.accent; ctx.fillRect(m, H - 42, (W - m * 2) * clamp(time / durationOf(project)), 3);
  ctx.restore();
}
