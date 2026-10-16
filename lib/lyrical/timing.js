import { LIMITS, wordSegments } from "./project.js";

const MAX_TOKENS = 4000;
const normalize = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
const weight = (text) => Math.max(1, Array.from(text).length);
const bounded = (line) =>
  Number.isFinite(line.start) &&
  Number.isFinite(line.end) &&
  line.end > line.start;

// Keep a separate, immutable audio-derived timeline. Editing display text must
// never turn estimated timestamps into new recognition evidence.
export function timingWords(chunks, duration) {
  let previous = 0;
  return chunks.flatMap((chunk) => {
    const start = chunk.timestamp?.[0] ?? chunk.start;
    const end = chunk.timestamp?.[1] ?? chunk.end;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      start >= duration
    )
      return [];
    const text = String(chunk.text || "").trim();
    const from = Math.max(start, previous),
      to = Math.min(end, duration);
    if (!text || to <= from) return [];
    previous = to;
    return [{ text, start: from, end: to }];
  });
}

// Monotonic edit-distance matching preserves chorus order and allows recognition
// substitutions. Inserted words use only their adjacent detected audio window.
// This is transcript matching, not acoustic forced alignment: uncertain spans
// are explicitly estimated and are never used for word highlighting.
export function alignLyrics(texts, chunks, duration) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Choose your song first.");
  if (!texts.length || texts.length > LIMITS.lines)
    throw new Error("Use between 1 and 600 lyric lines.");
  const target = [];
  for (const [line, text] of texts.entries()) {
    const tokens = wordSegments(text);
    if (!tokens.length || text.length > 500)
      throw new Error(
        "Each lyric line needs words and must be under 500 characters.",
      );
    for (const token of tokens)
      target.push({ text: token, key: normalize(token), line });
  }
  const reference = timingWords(chunks, duration).flatMap((word) => {
    const tokens = wordSegments(word.text);
    return tokens.map((text, i) => ({
      text,
      key: normalize(text),
      start: word.start + ((word.end - word.start) * i) / tokens.length,
      end: word.start + ((word.end - word.start) * (i + 1)) / tokens.length,
      exact: tokens.length === 1,
    }));
  });
  if (!reference.length)
    throw new Error(
      "No usable vocal timing was detected. Retry transcription with the song language selected.",
    );
  if (target.length > MAX_TOKENS || reference.length > MAX_TOKENS)
    throw new Error(
      "There are too many words to sync on this device. Use a shorter song or fewer lyrics.",
    );
  const columns = reference.length + 1;
  const trace = new Uint8Array((target.length + 1) * columns);
  let previous = Uint16Array.from({ length: columns }, (_, i) => i);
  let current = new Uint16Array(columns);
  for (let i = 1; i <= target.length; i++) {
    current[0] = i;
    trace[i * columns] = 1;
    for (let j = 1; j < columns; j++) {
      const match =
        previous[j - 1] + (target[i - 1].key === reference[j - 1].key ? 0 : 1);
      const insert = previous[j] + 1,
        remove = current[j - 1] + 1;
      current[j] = Math.min(match, insert, remove);
      trace[i * columns + j] =
        current[j] === match ? 0 : current[j] === insert ? 1 : 2;
    }
    [previous, current] = [current, previous];
  }
  let i = target.length,
    j = reference.length;
  while (i > 0) {
    const op = j ? trace[i * columns + j] : 1;
    if (op === 0) {
      const source = reference[--j],
        token = target[--i];
      Object.assign(token, {
        start: source.start,
        end: source.end,
        exact: source.exact && token.key === source.key,
      });
    } else if (op === 1) i--;
    else j--;
  }
  for (let at = 0; at < target.length;) {
    if (Number.isFinite(target[at].start)) {
      at++;
      continue;
    }
    const first = at;
    while (at < target.length && !Number.isFinite(target[at].start)) at++;
    const left = target[first - 1],
      right = target[at];
    let start = left?.end ?? reference[0].start;
    let end = right?.start ?? reference.at(-1).end;
    // Adjacent detected words can leave no gap. Borrow a bounded portion of the
    // neighbouring word windows rather than stretching across the whole song.
    if (end - start < (at - first) * 0.04) {
      if (left) {
        start = (left.start + left.end) / 2;
        left.end = start;
        left.exact = false;
      }
      if (right) {
        end = (right.start + right.end) / 2;
        right.start = end;
        right.exact = false;
      }
    }
    const total = target
      .slice(first, at)
      .reduce((sum, t) => sum + weight(t.text), 0);
    let cursor = start;
    for (let k = first; k < at; k++) {
      const next =
        k === at - 1
          ? end
          : cursor + ((end - start) * weight(target[k].text)) / total;
      Object.assign(target[k], { start: cursor, end: next, exact: false });
      cursor = next;
    }
  }
  return texts.map((text, line) => {
    const tokens = target.filter((token) => token.line === line);
    const exact = tokens.every((token) => token.exact);
    return {
      id: "aligned-" + line,
      text,
      start: tokens[0].start,
      end: tokens.at(-1).end,
      words: exact
        ? tokens.map(({ text, start, end }) => ({ text, start, end }))
        : [],
      timing: "aligned",
      timingQuality: exact ? "matched" : "estimated",
    };
  });
}

export function splitTimedLine(line, at, id) {
  const left = line.text.slice(0, at).trim(),
    right = line.text.slice(at).trim();
  if (!left || !right || !bounded(line))
    throw new Error("Choose a split between words in a synced line.");
  const count = wordSegments(left).length;
  const canUseWords =
    line.words?.length === wordSegments(line.text).length &&
    count > 0 &&
    count < line.words.length;
  const boundary = canUseWords
    ? line.words[count].start
    : line.start +
      ((line.end - line.start) * weight(left)) / (weight(left) + weight(right));
  return [
    {
      ...line,
      text: left,
      end: canUseWords ? line.words[count - 1].end : boundary,
      words: canUseWords ? line.words.slice(0, count) : [],
      timingQuality: canUseWords ? "matched" : "estimated",
    },
    {
      ...line,
      id,
      text: right,
      start: boundary,
      words: canUseWords ? line.words.slice(count) : [],
      timingQuality: canUseWords ? "matched" : "estimated",
    },
  ];
}

export function mergeTimedLines(line, next) {
  return {
    ...line,
    text: line.text + " " + next.text,
    end: next.end,
    words:
      line.words?.length && next.words?.length
        ? [...line.words, ...next.words]
        : [],
    timingQuality:
      line.timingQuality === "estimated" || next.timingQuality === "estimated"
        ? "estimated"
        : "matched",
  };
}

export function insertTimedLine(lines, time, duration, id) {
  const result = structuredClone(lines);
  const at = Math.max(0, Math.min(duration - 0.05, time || 0));
  let index = result.findIndex((line) => line.end > at);
  if (index < 0) index = result.length;
  let start = at,
    end = Math.min(duration, at + 3);
  const next = result[index],
    prior = result[index - 1];
  if (next && at >= next.start) {
    start =
      at > next.start + 0.1 && at < next.end - 0.1
        ? at
        : (next.start + next.end) / 2;
    end = next.end;
    Object.assign(next, { end: start, words: [], timingQuality: "estimated" });
    index++;
  } else if (next) end = Math.min(end, next.start);
  else if (prior && duration - prior.end < 0.1) {
    start = (prior.start + prior.end) / 2;
    end = prior.end;
    Object.assign(prior, { end: start, words: [], timingQuality: "estimated" });
  } else if (prior) start = Math.max(start, prior.end);
  result.splice(index, 0, {
    id,
    text: "",
    start,
    end,
    words: [],
    timing: "aligned",
    timingQuality: "estimated",
  });
  return { lines: result, index };
}
