import { STYLES } from "./project.js";
import { storyboardFor, storyboardSceneAt, sceneTransition, invalidateStoryboard } from "./storyboard.js";
import {
  compileChoreography,
  motionState,
  audioDrive,
  MOTION_PRESETS,
} from "./motion.js";
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prepared = new WeakMap();
export function invalidateLyricalRender(project) {
  prepared.delete(project);
  invalidateStoryboard(project);
}
function preparation(project, width, height) {
  const key = [
    width,
    height,
    project.settings.style,
    project.settings.intensity,
    project.settings.textSize,
  ].join(":");
  let value = prepared.get(project);
  if (!value || value.key !== key || value.lines !== project.lines) {
    value = {
      key,
      lines: project.lines,
      motion: compileChoreography(project),
      layouts: new Map(),
    };
    prepared.set(project, value);
  }
  return value;
}
export function lyricalMotionLabel(project, time) {
  const plan = prepared.get(project)?.motion;
  const phrase = plan?.phrases.find((p) => time >= p.start && time < p.end);
  return phrase
    ? MOTION_PRESETS[phrase.preset]
    : "Instrumental · lyrics return with vocals";
}
const rtl = (text) => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text);

export function fitLines(ctx, text, width, font, maxSize, maxHeight) {
  const rawSegments =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
            text,
          ),
        ].map((s) => s.segment)
      : text.split(/(\s+)/);
  // Keep closing punctuation (including the Devanagari danda) with its word.
  const segments = [];
  for (const segment of rawSegments) {
    if (/^[\p{Pe}\p{Pf}.,!?;:।॥。！？、]+$/u.test(segment) && segments.length)
      segments[segments.length - 1] += segment;
    else segments.push(segment);
  }
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

// Map measured words to the exact display string in order. Edited/mismatched
// text falls back to phrase motion; no synthetic word timings are generated.
export function measuredWordSpans(line) {
  if (!line.words?.length || rtl(line.text)) return [];
  const boundaries =
    typeof Intl.Segmenter === "function"
      ? new Set([
          0,
          ...Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
              line.text,
            ),
            (s) => s.index + s.segment.length,
          ),
        ])
      : null;
  let cursor = 0;
  const spans = [];
  for (const word of line.words) {
    const at = line.text.indexOf(word.text, cursor);
    if (
      at < 0 ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.end <= word.start ||
      (boundaries &&
        (!boundaries.has(at) || !boundaries.has(at + word.text.length)))
    )
      return [];
    if (/[\p{L}\p{M}\p{N}]/u.test(line.text.slice(cursor, at))) return [];
    spans.push({ ...word, from: at, to: at + word.text.length });
    cursor = at + word.text.length;
  }
  if (/[\p{L}\p{M}\p{N}]/u.test(line.text.slice(cursor))) return [];
  return spans;
}
function imageLayer(
  ctx,
  image,
  time,
  start,
  end,
  width,
  height,
  movement,
  index,
  alpha = 1,
) {
  if (!image?.bitmap) return;
  const bitmap = image.bitmap,
    progress = clamp((time - start) / Math.max(0.1, end - start));
  const base = Math.max(width / bitmap.width, height / bitmap.height);
  const zoom = movement === "still" ? 1 : movement === "pan" ? 1.08 : 1.01 + progress * 0.08;
  const w = bitmap.width * base * zoom,
    h = bitmap.height * base * zoom;
  const cx = clamp(Number(image.cropX ?? 50) / 100),
    cy = clamp(Number(image.cropY ?? 50) / 100);
  const drift = movement === "pan" ? (index % 2 ? 1 : -1) * (progress - 0.5) * 0.06 : 0;
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
  const scenes = storyboardFor(project, images.length);
  const scene = images.length ? storyboardSceneAt(scenes, time) : null;
  if (scene) {
    const previous = scenes[scene.index - 1];
    const transition = sceneTransition(project, scene);
    const mix = transition.duration ? clamp((time - scene.start) / transition.duration) : 1;
    const movement = ["still", "pan", "zoom"].includes(settings.imageMovement)
      ? settings.imageMovement : settings.style === "cinematic" ? "pan" : "zoom";
    const paint = (entry, alpha = 1, offset = 0) => {
      ctx.save();
      if (offset) ctx.translate(offset, 0);
      imageLayer(ctx, images[entry.imageIndex], time,
        images.length === 1 ? 0 : entry.start,
        images.length === 1 ? project.duration : entry.end,
        width, height, movement, images.length === 1 ? 0 : entry.index, alpha);
      ctx.restore();
    };
    if (!previous || mix >= 1 || previous.imageIndex === scene.imageIndex) {
      paint(scene);
    } else if (transition.type === "fade") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (mix < 0.5) paint(previous, 1 - mix * 2);
      else paint(scene, mix * 2 - 1);
    } else if (transition.type === "slide") {
      const eased = mix * mix * (3 - 2 * mix);
      paint(previous, 1, -width * eased);
      paint(scene, 1, width * (1 - eased));
    } else {
      paint(previous);
      paint(scene, mix);
    }
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
  const ready = preparation(project, width, height);
  const phrase = ready.motion.phrases[index];
  const drive = audioDrive(ready.motion, time);
  const font =
    settings.style === "cinematic"
      ? 'Georgia, "Lyrical Devanagari", serif'
      : settings.style === "bold"
        ? '"Lyrical Display", "Lyrical Devanagari", system-ui, sans-serif'
        : 'system-ui, "Lyrical Devanagari", sans-serif';
  const regionWidth = width * 0.76,
    regionHeight = height * 0.46;
  const short = Array.from(line.text).length < 12;
  const maxSize =
    Math.min(
      width * (short ? 0.17 : settings.style === "bold" ? 0.125 : 0.105),
      height * 0.14,
    ) * (Number(settings.textSize) || 1);
  let layout = ready.layouts.get(index);
  if (!layout) {
    layout = fitLines(ctx, line.text, regionWidth, font, maxSize, regionHeight);
    layout.wordSpans = measuredWordSpans(line);
    ready.layouts.set(index, layout);
  }
  const lineHeight = layout.size * 1.5;
  const isRtl = rtl(line.text);
  let textCursor = 0;
  const baseMotion = motionState(
    phrase,
    time,
    ready.motion.intensity,
    drive,
    0,
    layout.lines.length,
  );
  for (let i = 0; i < layout.lines.length; i++) {
    const row = layout.lines[i];
    const rowStart = line.text.indexOf(row, textCursor);
    textCursor = rowStart + row.length;
    const rowWords = layout.wordSpans.filter(
      (w) => w.from >= rowStart && w.to <= textCursor,
    );
    const buildWords =
      settings.presentation === "words" &&
      rowWords.length &&
      !layout.wordSpans.some(
        (w) =>
          (w.from < rowStart && w.to > rowStart) ||
          (w.from < textCursor && w.to > textCursor),
      );
    const lastStarted = buildWords
      ? rowWords.findLast((w) => time >= w.start)
      : null;
    if (buildWords && !lastStarted) continue;
    const movement = motionState(
      phrase,
      time,
      ready.motion.intensity,
      drive,
      i,
      layout.lines.length,
    );
    ctx.save();
    ctx.font = `700 ${layout.size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = isRtl ? "rtl" : "ltr";
    const textWidth = ctx.measureText(row).width;
    // Bound the entire transformed row, including rotation, inside safe margins.
    const sx = movement.scaleX,
      sy = movement.scaleY,
      angle = movement.rotation;
    const boundWidth =
      Math.abs(Math.cos(angle)) * textWidth * sx +
      Math.abs(Math.sin(angle)) * lineHeight * sy;
    const boundHeight =
      Math.abs(Math.sin(angle)) * textWidth * sx +
      Math.abs(Math.cos(angle)) * lineHeight * sy;
    const roomX = Math.max(0, (width * 0.88 - boundWidth) / 2);
    const baseY =
      height * 0.5 + (i - (layout.lines.length - 1) / 2) * lineHeight;
    const x = width / 2 + clamp(movement.x * width, -roomX, roomX);
    const rowDelta = clamp(
      (movement.y - baseMotion.y) * height,
      -lineHeight * 0.08,
      lineHeight * 0.08,
    );
    const y = clamp(
      baseY + baseMotion.y * height + rowDelta,
      height * 0.08 + boundHeight / 2,
      height * 0.92 - boundHeight / 2,
    );
    ctx.globalAlpha = movement.opacity;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    if (buildWords && lastStarted !== rowWords.at(-1)) {
      const shown = ctx.measureText(
        row.slice(0, lastStarted.to - rowStart),
      ).width;
      ctx.beginPath();
      ctx.rect(-textWidth / 2 - 2, -lineHeight / 2, shown + 4, lineHeight);
      ctx.clip();
    }
    if (movement.reveal < 1) {
      ctx.beginPath();
      const left = -textWidth / 2 - layout.size * 0.15;
      const span = textWidth + layout.size * 0.3;
      ctx.rect(
        isRtl ? left + span * (1 - movement.reveal) : left,
        -lineHeight / 2,
        span * movement.reveal,
        lineHeight,
      );
      ctx.clip();
    }
    ctx.fillStyle =
      i === layout.lines.length - 1 && settings.style === "bold"
        ? accent
        : style.ink;
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = layout.size * 0.2;
    ctx.fillText(row, 0, 0);
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
        ctx.rect(x - 2, -layout.size, w + 4, layout.size * 2);
        ctx.clip();
        ctx.fillStyle = accent;
        ctx.fillText(row, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

export async function loadLyricalFonts() {
  await Promise.all([
    document.fonts.load('700 48px "Lyrical Devanagari"'),
    document.fonts.load('700 48px "Lyrical Display"'),
  ]);
  await document.fonts.ready;
}
