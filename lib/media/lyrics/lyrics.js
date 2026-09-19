const MAX_LINES = 2000;
const MAX_TEXT_CHARACTERS = 512_000;
const MAX_LINE_CHARACTERS = 1200;
const STYLE_PRESETS = new Set(['classic', 'bold', 'minimal']);
const EFFECT_PRESETS = new Set(['none', 'fade', 'pop']);
const BACKGROUND_PRESETS = new Set(['transparent', 'dark', 'light']);

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

export function parseLrcTimestamp(value) {
  const raw = String(value || '').trim().replace(/^\[|\]$/g, '').replace(/^<|>$/g, '');
  const match = raw.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;

  const hasHours = match[1] !== undefined;
  const hours = hasHours ? Number(match[1]) : 0;
  const minutes = hasHours ? Number(match[2]) : Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = String(match[4] || '');
  const millis = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;

  if (seconds > 59 || millis > 999 || (hasHours && minutes > 59)) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function formatLrcTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function parseEnhancedWords(text) {
  const source = String(text || '');
  const pattern = /<([^>]+)>/g;
  const markers = [];
  let match;

  while ((match = pattern.exec(source))) {
    const start = parseLrcTimestamp(match[1]);
    if (start === null) continue;
    markers.push({ start, markerStart: match.index, contentStart: pattern.lastIndex });
  }

  if (!markers.length) return { text: cleanText(source), words: [] };

  const words = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const segment = source.slice(marker.contentStart, next ? next.markerStart : source.length);
    const cleaned = cleanText(segment).replace(/\s+/g, ' ');
    if (cleaned) words.push({ start: marker.start, text: cleaned.slice(0, 240) });
  }

  const plain = cleanText(source.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  return { text: plain, words };
}

export function normalizeLyrics(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawLines = Array.isArray(source.lines) ? source.lines : [];
  let totalCharacters = 0;

  const lines = rawLines.slice(0, MAX_LINES).map((line, index) => {
    const text = cleanText(line?.text).slice(0, MAX_LINE_CHARACTERS);
    totalCharacters += text.length;
    if (totalCharacters > MAX_TEXT_CHARACTERS) return null;

    const words = Array.isArray(line?.words)
      ? line.words.slice(0, 300).map((word) => ({
          start: finiteOrNull(word?.start),
          text: cleanText(word?.text).slice(0, 240)
        })).filter((word) => word.start !== null && word.text)
      : [];

    return {
      id: String(line?.id || `lyric-${index + 1}`),
      start: finiteOrNull(line?.start),
      text,
      words
    };
  }).filter(Boolean);

  return {
    source: cleanText(source.source || 'manual').slice(0, 32),
    title: cleanText(source.title || '').slice(0, 120),
    artist: cleanText(source.artist || '').slice(0, 120),
    style: STYLE_PRESETS.has(source.style) ? source.style : 'classic',
    effect: EFFECT_PRESETS.has(source.effect) ? source.effect : 'fade',
    background: BACKGROUND_PRESETS.has(source.background) ? source.background : 'transparent',
    lines
  };
}

export function parseLyricsText(text, formatHint = '') {
  const raw = String(text ?? '');
  if (raw.length > MAX_TEXT_CHARACTERS * 2) {
    return { ok: false, reason: 'Lyrics file is too large for this local editor.' };
  }

  const hint = String(formatHint || '').toLowerCase();
  const appearsTimed = hint.includes('lrc') || /^\s*\[\d{1,3}:\d{2}/m.test(raw);
  const metadata = { title: '', artist: '' };
  const lines = [];

  if (appearsTimed) {
    for (const rawLine of raw.replace(/\r\n?/g, '\n').split('\n')) {
      const meta = rawLine.match(/^\[(ti|ar):([^\]]*)\]\s*$/i);
      if (meta) {
        if (meta[1].toLowerCase() === 'ti') metadata.title = cleanText(meta[2]);
        if (meta[1].toLowerCase() === 'ar') metadata.artist = cleanText(meta[2]);
        continue;
      }

      const tags = [...rawLine.matchAll(/\[([^\]]+)\]/g)]
        .map((match) => parseLrcTimestamp(match[1]))
        .filter((value) => value !== null);

      if (!tags.length) continue;

      const content = rawLine.replace(/^(?:\[[^\]]+\])+/, '');
      const enhanced = parseEnhancedWords(content);

      for (const start of tags) {
        lines.push({
          id: `lyric-${lines.length + 1}`,
          start,
          text: enhanced.text,
          words: enhanced.words
        });
      }
    }

    if (!lines.length) return { ok: false, reason: 'No valid timed LRC lyric lines were found.' };
    lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return {
      ok: true,
      lyrics: normalizeLyrics({
        source: 'lrc-import',
        title: metadata.title,
        artist: metadata.artist,
        lines
      })
    };
  }

  const plainLines = raw.replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, MAX_LINES);

  if (!plainLines.length) return { ok: false, reason: 'No lyric lines were found.' };

  return {
    ok: true,
    lyrics: normalizeLyrics({
      source: 'text-import',
      lines: plainLines.map((line, index) => ({
        id: `lyric-${index + 1}`,
        start: null,
        text: line,
        words: []
      }))
    })
  };
}

export function lyricLineAtTime(lyrics, time) {
  const normalized = normalizeLyrics(lyrics);
  const current = Math.max(0, Number(time) || 0);
  const timed = normalized.lines.filter((line) => line.start !== null);
  if (!timed.length) return null;

  let active = null;
  for (const line of timed) {
    if (line.start <= current) active = line;
    else break;
  }
  return active;
}

export function activeWordIndex(line, time) {
  const current = Math.max(0, Number(time) || 0);
  const words = Array.isArray(line?.words) ? line.words : [];
  let index = -1;
  for (let i = 0; i < words.length; i += 1) {
    if (Number(words[i].start) <= current) index = i;
    else break;
  }
  return index;
}

export function stampLyricLine(lyrics, id, time) {
  const normalized = normalizeLyrics(lyrics);
  const stamp = Math.max(0, Number(time) || 0);
  return normalizeLyrics({
    ...normalized,
    source: normalized.source === 'lrc-import' ? normalized.source : 'manual-sync',
    lines: normalized.lines.map((line) => line.id === id ? { ...line, start: stamp } : line)
  });
}

export function lyricsToLrc(lyrics) {
  const normalized = normalizeLyrics(lyrics);
  const metadata = [];
  if (normalized.title) metadata.push(`[ti:${normalized.title}]`);
  if (normalized.artist) metadata.push(`[ar:${normalized.artist}]`);

  const body = normalized.lines.map((line) => {
    const prefix = line.start === null ? '[--:--.--]' : `[${formatLrcTimestamp(line.start)}]`;
    if (!line.words.length) return prefix + line.text;
    const enhanced = line.words.map((word) => `<${formatLrcTimestamp(word.start)}>${word.text}`).join('');
    return prefix + enhanced;
  });

  return [...metadata, ...(metadata.length ? [''] : []), ...body].join('\n');
}

export function lyricsToTxt(lyrics) {
  return normalizeLyrics(lyrics).lines.map((line) => line.text).filter(Boolean).join('\n');
}
