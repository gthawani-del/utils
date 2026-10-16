export const LIMITS = Object.freeze({
  audioBytes: 45 * 1024 * 1024,
  duration: 300,
  images: 8,
  imageBytes: 12 * 1024 * 1024,
  lines: 600,
});
export const STYLES = Object.freeze({
  bold: {
    name: "Bold rhythm",
    description: "Impact zooms, elastic settles and directional reveals.",
    accent: "#ffc06b",
    background: "#17191f",
    ink: "#fffaf2",
  },
  cinematic: {
    name: "Quiet cinema",
    description: "Flowing phrases, masked reveals and slow breathing motion.",
    accent: "#d8c0a0",
    background: "#171b20",
    ink: "#fffaf3",
  },
  clean: {
    name: "Clear type",
    description: "Rising phrases, staggered reveals and flowing accents.",
    accent: "#a4dacd",
    background: "#162623",
    ink: "#f6faf7",
  },
});
export function wordSegments(text) {
  if (typeof Intl.Segmenter === "function")
    return [
      ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
    ]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
  return String(text).trim().split(/\s+/u).filter(Boolean);
}
export function joinWords(words) {
  return words
    .map((w) => w.text)
    .join(" ")
    .replace(
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      "$1",
    );
}
export function linesFromWords(chunks, duration) {
  const words = chunks
    .map((c) => ({
      text: String(c.text || "").trim(),
      start: c.timestamp?.[0] ?? c.start,
      end: c.timestamp?.[1] ?? c.end,
    }))
    .filter(
      (w) =>
        w.text &&
        typeof w.start === "number" &&
        typeof w.end === "number" &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.start >= 0 &&
        w.end > w.start &&
        w.start < duration,
    )
    .map((w) => ({ ...w, end: Math.min(duration, w.end) }))
    .sort((a, b) => a.start - b.start);
  const groups = [];
  let group = [];
  for (const word of words) {
    if (
      group.length &&
      (word.start - group.at(-1).end > 0.65 ||
        word.end - group[0].start > 4.5 ||
        joinWords([...group, word]).length > 48 ||
        /[.!?।。！？]$/u.test(group.at(-1).text))
    ) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);
  return groups.slice(0, LIMITS.lines).map((words, i) => ({
    id: "line-" + i,
    text: joinWords(words),
    start: words[0].start,
    end: words.at(-1).end,
    words,
    timing: "detected",
  }));
}
export function reviseLine(line, text) {
  const value = String(text).trim().slice(0, 500);
  return value === line.text
    ? line
    : { ...line, text: value, words: [], timing: "edited" };
}
export function validateLines(lines, duration) {
  if (!lines.length) return "Add lyrics before continuing.";
  if (lines.length > LIMITS.lines)
    return "Please use fewer than 600 lyric lines.";
  let previous = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text?.trim())
      return "Line " + (i + 1) + " is empty. Add words or remove it.";
    if (
      typeof line.start !== "number" ||
      typeof line.end !== "number" ||
      !Number.isFinite(line.start) ||
      !Number.isFinite(line.end) ||
      line.start < 0 ||
      line.end <= line.start ||
      line.end > duration + 0.001
    )
      return "Check the start and end time of line " + (i + 1) + ".";
    if (line.start < previous - 0.04)
      return (
        "Line " + (i + 1) + " overlaps the previous line. Adjust its timing."
      );
    previous = line.end;
  }
  return "";
}
export function analyzeAudio(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * 0.05));
  const envelope = [];
  for (let i = 0; i < samples.length; i += hop) {
    let square = 0;
    const end = Math.min(i + hop, samples.length);
    for (let j = i; j < end; j++) square += samples[j] * samples[j];
    envelope.push(Math.sqrt(square / Math.max(1, end - i)));
  }
  const peak = Math.max(0.0001, ...envelope);
  const average =
    envelope.reduce((a, b) => a + b, 0) / Math.max(1, envelope.length);
  const onsets = [];
  for (let i = 2; i < envelope.length - 1; i++) {
    if (
      envelope[i] > average * 1.2 &&
      envelope[i] > envelope[i - 1] * 1.35 &&
      envelope[i] >= envelope[i + 1] &&
      i * 0.05 - (onsets.at(-1) ?? -1) > 0.18
    )
      onsets.push(i * 0.05);
  }
  return {
    duration: samples.length / sampleRate,
    envelope: envelope.map((v) => v / peak),
    onsets,
    contrast: average > 0 ? peak / average : 0,
  };
}
export function chooseDirection(lines, analysis = {}) {
  const spoken = lines.reduce((n, l) => n + Math.max(0.1, l.end - l.start), 0);
  const count = lines.reduce((n, l) => n + wordSegments(l.text).length, 0);
  const pace = count / Math.max(1, spoken);
  const averagePhrase = spoken / Math.max(1, lines.length);
  const onsetRate =
    (analysis.onsets?.length || 0) / Math.max(1, analysis.duration || 1);
  const style =
    pace >= 2.7 || onsetRate >= 2.2
      ? "bold"
      : pace < 1.5 || averagePhrase > 3.8
        ? "cinematic"
        : "clean";
  const reason =
    style === "bold"
      ? "Quick phrases or frequent energy changes suit crisp entrances. Pauses stay quiet."
      : style === "cinematic"
        ? "Slower phrasing gives the words room. Gentle reveals and camera movement keep the focus on your song."
        : "An even lyric pace suits clear phrasing and restrained movement.";
  return {
    style,
    reason,
    basis: "Audio energy and lyric timing",
    pace: Math.round(pace * 10) / 10,
    intensity: "balanced",
    presentation:
      lines.length &&
      lines.filter((line) => line.words?.length).length >= lines.length * 0.7
        ? "words"
        : "phrases",
  };
}

export function visualSummary(textOnly, images) {
  if (textOnly)
    return images.length
      ? "Typography only · your " +
          images.length +
          " selected image(s) will not appear."
      : "Typography only · no images in this video.";
  return images.length
    ? "Image sequence · " + images.length + " image(s) included."
    : "No images selected. Add images before creating your video.";
}
export function validateVisuals(textOnly, images, expected = []) {
  if (textOnly) return "";
  if (!images.length)
    return "Add an image, or explicitly choose typography only.";
  if (
    expected.length &&
    expected.some((meta) => !images.some((image) => image.id === meta.id))
  )
    return "Some saved images are missing. Return to Images & style and add them again.";
  if (
    images.some(
      (image) =>
        !image.bitmap || image.bitmap.width <= 0 || image.bitmap.height <= 0,
    )
  )
    return "An image could not load. Return to Images & style and add it again.";
  return "";
}
export function imageSceneAt(time, duration, count, lines = []) {
  if (!count) return null;
  const boundaries = [0];
  for (let i = 1; i < count; i++) {
    const ideal = (duration * i) / count;
    const nearest = lines.reduce(
      (best, l) =>
        Math.abs(l.start - ideal) < Math.abs(best - ideal) ? l.start : best,
      ideal + duration,
    );
    const chosen =
      Math.abs(nearest - ideal) < duration / (count * 3) ? nearest : ideal;
    boundaries.push(
      Math.max(boundaries.at(-1) + 0.01, Math.min(duration, chosen)),
    );
  }
  boundaries.push(duration);
  const index =
    time >= duration
      ? count - 1
      : Math.min(
          count - 1,
          Math.max(0, boundaries.findIndex((v, i) => i > 0 && time < v) - 1),
        );
  return { index, start: boundaries[index], end: boundaries[index + 1] };
}
export function dimensions(aspect = "9:16", quality = "720") {
  const size = quality === "1080" ? 1080 : 720;
  return aspect === "16:9"
    ? { width: Math.round((size * 16) / 9), height: size }
    : aspect === "1:1"
      ? { width: size, height: size }
      : { width: size, height: Math.round((size * 16) / 9) };
}
export function timeLabel(value) {
  const t = Math.max(0, Number(value) || 0);
  return Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
}

export function scriptReviewNote(language, lines) {
  const scripts = {
    hi: /\p{Script=Devanagari}/u,
    mr: /\p{Script=Devanagari}/u,
    ne: /\p{Script=Devanagari}/u,
    ar: /\p{Script=Arabic}/u,
    ur: /\p{Script=Arabic}/u,
    fa: /\p{Script=Arabic}/u,
    he: /\p{Script=Hebrew}/u,
    ta: /\p{Script=Tamil}/u,
    te: /\p{Script=Telugu}/u,
    bn: /\p{Script=Bengali}/u,
    gu: /\p{Script=Gujarati}/u,
    pa: /\p{Script=Gurmukhi}/u,
    kn: /\p{Script=Kannada}/u,
    ml: /\p{Script=Malayalam}/u,
    zh: /\p{Script=Han}/u,
    ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
    ko: /\p{Script=Hangul}/u,
  };
  const expected = scripts[language];
  return expected && !expected.test(lines.map((line) => line.text).join(" "))
    ? "This draft uses a different script from the selected language. Check the words carefully or paste your original lyrics."
    : "";
}
