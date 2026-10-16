import { STYLES, imageSceneAt } from "./project.js";
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const rtl = (text) => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text);

export function fitLines(ctx, text, width, font, maxSize, maxHeight) {
  const segments =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
            text,
          ),
        ].map((s) => s.segment)
      : text.split(/(\s+)/);
  let size = maxSize,
    lines = [];
  while (size >= 18) {
    ctx.font = `700 ${size}px ${font}`;
    lines = [];
    let line = "";
    const tokens = segments.flatMap((segment) =>
      ctx.measureText(segment).width <= width
        ? [segment]
        : typeof Intl.Segmenter === "function"
          ? [
              ...new Intl.Segmenter(undefined, {
                granularity: "grapheme",
              }).segment(segment),
            ].map((item) => item.segment)
          : [segment],
    );
    for (const segment of tokens) {
      if (line && ctx.measureText(line + segment).width > width) {
        lines.push(line.trim());
        line = segment.trimStart();
      } else line += segment;
    }
    if (line.trim()) lines.push(line.trim());
    if (
      lines.length * size * 1.5 <= maxHeight &&
      lines.every((l) => ctx.measureText(l).width <= width)
    )
      break;
    size -= 2;
  }
  return { lines, size };
}
function imageLayer(
  ctx,
  image,
  time,
  start,
  end,
  width,
  height,
  strength,
  index,
  alpha = 1,
) {
  if (!image?.bitmap) return;
  const bitmap = image.bitmap,
    progress = clamp((time - start) / Math.max(0.1, end - start));
  const base = Math.max(width / bitmap.width, height / bitmap.height);
  const zoom = 1.02 + progress * 0.07 * strength;
  const w = bitmap.width * base * zoom,
    h = bitmap.height * base * zoom;
  const cx = clamp(Number(image.cropX ?? 50) / 100),
    cy = clamp(Number(image.cropY ?? 50) / 100);
  const drift = (index % 2 ? 1 : -1) * (progress - 0.5) * 0.015 * strength;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    bitmap,
    Math.min(0, Math.max(width - w, (width - w) * cx + width * drift)),
    Math.min(0, Math.max(height - h, (height - h) * cy)),
    w,
    h,
  );
  ctx.restore();
}
export function drawLyricalFrame(ctx, project, images, time, width, height) {
  const settings = project.settings,
    style = STYLES[settings.style] || STYLES.clean;
  const accent = /^#[a-f\d]{6}$/i.test(settings.accent || "")
    ? settings.accent
    : style.accent;
  const strength =
    { subtle: 0.45, balanced: 1, energetic: 1.5 }[settings.intensity] ?? 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  const scene = imageSceneAt(
    time,
    project.duration,
    images.length,
    project.lines,
  );
  if (scene) {
    const fade = clamp((time - scene.start) / 0.65);
    if (scene.index > 0 && fade < 1)
      imageLayer(
        ctx,
        images[scene.index - 1],
        time,
        scene.start - 5,
        scene.start,
        width,
        height,
        strength,
        scene.index - 1,
      );
    imageLayer(
      ctx,
      images[scene.index],
      time,
      scene.start,
      scene.end,
      width,
      height,
      strength,
      scene.index,
      scene.index === 0 ? 1 : fade,
    );
    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, "rgba(0,0,0,.24)");
    shade.addColorStop(0.5, "rgba(0,0,0,.45)");
    shade.addColorStop(1, "rgba(0,0,0,.72)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
  } else {
    // A quiet, deterministic light field keeps typography-only projects intentional.
    const glow = ctx.createRadialGradient(
      width * 0.7,
      height * 0.3,
      width * 0.02,
      width * 0.7,
      height * 0.3,
      width * 0.9,
    );
    glow.addColorStop(0, accent + "1c");
    glow.addColorStop(1, accent + "00");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  const index = project.lines.findIndex((l) => time >= l.start && time < l.end);
  const line = project.lines[index];
  if (!line) return;
  const entrance = ease(
    (time - line.start) / (settings.style === "cinematic" ? 0.65 : 0.25),
  );
  const exit = clamp((line.end - time) / 0.18);
  const font =
    settings.style === "cinematic"
      ? 'Georgia, "Lyrical Devanagari", serif'
      : settings.style === "bold"
        ? '"Lyrical Display", "Lyrical Devanagari", system-ui, sans-serif'
        : 'system-ui, "Lyrical Devanagari", sans-serif';
  const regionWidth = width * 0.8,
    regionHeight = height * 0.55;
  const maxSize =
    Math.min(
      width * (settings.style === "bold" ? 0.105 : 0.078),
      height * 0.13,
    ) * (Number(settings.textSize) || 1);
  const layout = fitLines(
    ctx,
    line.text,
    regionWidth,
    font,
    maxSize,
    regionHeight,
  );
  const opacity = Math.min(entrance * 1.8, exit);
  const beats = project.analysis?.onsets || [];
  const onset = beats.find((b) => time >= b && time < b + 0.18);
  const pulse =
    settings.style === "bold" && onset !== undefined
      ? Math.sin(((time - onset) / 0.18) * Math.PI) * 0.02 * strength
      : 0;
  ctx.save();
  ctx.globalAlpha = opacity;
  const translate =
    (1 - entrance) *
    (settings.style === "bold" ? height * 0.035 : height * 0.012) *
    strength;
  ctx.translate(width / 2, height * 0.51 + translate);
  const scale =
    settings.style === "bold"
      ? 1 - (1 - entrance) * 0.13 * strength + pulse
      : 1;
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = rtl(line.text) ? "rtl" : "ltr";
  ctx.font = `700 ${layout.size}px ${font}`;
  ctx.fillStyle = style.ink;
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = layout.size * 0.28;
  const lineHeight = layout.size * 1.5;
  if (settings.style === "bold" && index % 3 === 1) {
    ctx.beginPath();
    ctx.rect(-width / 2, -height / 2, width * entrance, height);
    ctx.clip();
  }
  for (let i = 0; i < layout.lines.length; i++) {
    const row = layout.lines[i],
      y = (i - (layout.lines.length - 1) / 2) * lineHeight;
    ctx.fillStyle =
      i === layout.lines.length - 1 && settings.style === "bold"
        ? accent
        : style.ink;
    ctx.fillText(row, 0, y);
    // Draw complete shaped strings; never split a grapheme or reorder RTL words.
    if (settings.presentation === "words" && !rtl(row) && line.words?.length) {
      const active = line.words.find((w) => time >= w.start && time < w.end);
      const location = active ? row.indexOf(active.text) : -1;
      const occurrences = active
        ? line.words.filter((w) => w.text === active.text).length
        : 0;
      if (location >= 0 && occurrences === 1) {
        const total = ctx.measureText(row).width;
        const x = -total / 2 + ctx.measureText(row.slice(0, location)).width;
        const w = ctx.measureText(active.text).width;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 2, y - layout.size, w + 4, layout.size * 2);
        ctx.clip();
        ctx.fillStyle = accent;
        ctx.fillText(row, 0, y);
        ctx.restore();
      }
    }
  }
  if (settings.style === "clean") {
    ctx.fillStyle = accent;
    ctx.fillRect(
      -width * 0.035,
      (layout.lines.length * lineHeight) / 2 + layout.size * 0.5,
      width * 0.07 * entrance,
      Math.max(2, width * 0.003),
    );
  }
  ctx.restore();
}
export async function loadLyricalFonts() {
  await Promise.all([
    document.fonts.load('700 48px "Lyrical Devanagari"'),
    document.fonts.load('700 48px "Lyrical Display"'),
  ]);
  await document.fonts.ready;
}
