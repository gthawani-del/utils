const MAX_CUES = 1000;
const MAX_TEXT_CHARACTERS = 512_000;
const MAX_CUE_CHARACTERS = 1200;
const SAFE_LINE_CHARACTERS = 42;
const SAFE_LINES = 2;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

export function parseSubtitleTimestamp(value) {
  const raw = String(value || '').trim().replace(',', '.');
  const match = raw.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const millis = Number(String(match[4] || '').padEnd(3, '0') || 0);
  if (minutes > 59 || seconds > 59 || millis > 999) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function formatSubtitleTimestamp(seconds, separator = ',') {
  const safe = Math.max(0, finite(seconds));
  const wholeMillis = Math.round(safe * 1000);
  const hours = Math.floor(wholeMillis / 3_600_000);
  const minutes = Math.floor((wholeMillis % 3_600_000) / 60_000);
  const secs = Math.floor((wholeMillis % 60_000) / 1000);
  const millis = wholeMillis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

export function normalizeCue(cue, index = 0) {
  const start = Math.max(0, finite(cue?.start));
  const end = Math.max(start, finite(cue?.end, start));
  return {
    id: String(cue?.id || `cue-${index + 1}`),
    start,
    end,
    text: cleanText(cue?.text).slice(0, MAX_CUE_CHARACTERS)
  };
}

export function normalizeTranscript(input) {
  const source = Array.isArray(input?.cues) ? input.cues : Array.isArray(input) ? input : [];
  const cues = source.slice(0, MAX_CUES).map((cue, index) => normalizeCue(cue, index));
  let characters = 0;
  const limited = [];
  for (const cue of cues) {
    if (characters + cue.text.length > MAX_TEXT_CHARACTERS) break;
    characters += cue.text.length;
    limited.push(cue);
  }
  return {
    cues: limited,
    language: cleanText(input?.language || '').slice(0, 32),
    source: cleanText(input?.source || 'manual').slice(0, 32)
  };
}

function splitBlocks(text) {
  return cleanText(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
}

function parseTimedBlock(block, index) {
  const lines = block.split('\n').map((line) => line.trimEnd());
  if (lines.length < 2) return null;

  let timingIndex = lines.findIndex((line) => line.includes('-->'));
  if (timingIndex < 0) return null;

  const timing = lines[timingIndex].split('-->');
  if (timing.length !== 2) return null;
  const start = parseSubtitleTimestamp(timing[0].trim().split(/\s+/)[0]);
  const end = parseSubtitleTimestamp(timing[1].trim().split(/\s+/)[0]);
  if (start === null || end === null) return null;

  const text = cleanText(lines.slice(timingIndex + 1).join('\n'));
  return normalizeCue({ id: `cue-${index + 1}`, start, end, text }, index);
}

export function parseSubtitleText(text, formatHint = '') {
  const raw = String(text ?? '');
  if (raw.length > MAX_TEXT_CHARACTERS * 2) {
    return { ok: false, reason: 'Subtitle file is too large for this browser-local editor.' };
  }

  const hint = String(formatHint || '').toLowerCase();
  const isVtt = hint.includes('vtt') || /^\uFEFF?WEBVTT(?:\s|$)/i.test(raw.trimStart());
  const prepared = isVtt
    ? raw.replace(/^\uFEFF?WEBVTT[^\n]*\n?/i, '').replace(/^NOTE[^\n]*(?:\n(?!\n).*)*\n?/gim, '')
    : raw;

  const cues = splitBlocks(prepared)
    .map((block, index) => parseTimedBlock(block, index))
    .filter(Boolean);

  if (!cues.length) {
    return { ok: false, reason: 'No valid timed subtitle cues were found. Import SRT or VTT with timestamps.' };
  }

  return { ok: true, transcript: normalizeTranscript({ cues, source: isVtt ? 'vtt-import' : 'srt-import' }) };
}

export function transcriptToSrt(transcript) {
  const normalized = normalizeTranscript(transcript);
  return normalized.cues.map((cue, index) => [
    String(index + 1),
    `${formatSubtitleTimestamp(cue.start, ',')} --> ${formatSubtitleTimestamp(cue.end, ',')}`,
    cue.text,
    ''
  ].join('\n')).join('\n');
}

export function transcriptToVtt(transcript) {
  const normalized = normalizeTranscript(transcript);
  const body = normalized.cues.map((cue) => [
    `${formatSubtitleTimestamp(cue.start, '.')} --> ${formatSubtitleTimestamp(cue.end, '.')}`,
    cue.text,
    ''
  ].join('\n')).join('\n');
  return `WEBVTT\n\n${body}`;
}

export function transcriptToTxt(transcript) {
  return normalizeTranscript(transcript).cues.map((cue) => cue.text).filter(Boolean).join('\n');
}

export function createCueAt(time, duration, index = 0) {
  const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : null;
  const start = Math.max(0, finite(time));
  const end = safeDuration === null ? start + 2 : Math.min(safeDuration, start + 2);
  return normalizeCue({ id: `cue-${Date.now()}-${index + 1}`, start, end: Math.max(start, end), text: '' }, index);
}

export function runSubtitleQa(transcript, { duration = null } = {}) {
  const cues = normalizeTranscript(transcript).cues;
  const issues = [];
  let overlaps = 0;
  let timing = 0;
  let safeArea = 0;
  let blanks = 0;

  cues.forEach((cue, index) => {
    if (cue.end <= cue.start) {
      timing += 1;
      issues.push({ cueId: cue.id, type: 'timing', message: 'End time must be later than start time.' });
    }
    if (Number.isFinite(Number(duration)) && cue.end > Number(duration) + 0.05) {
      timing += 1;
      issues.push({ cueId: cue.id, type: 'timing', message: 'Cue extends beyond the media duration.' });
    }
    if (index > 0 && cue.start < cues[index - 1].end) {
      overlaps += 1;
      issues.push({ cueId: cue.id, type: 'overlap', message: 'Cue overlaps the previous subtitle.' });
    }
    if (!cue.text.trim()) {
      blanks += 1;
      issues.push({ cueId: cue.id, type: 'blank', message: 'Cue has no subtitle text.' });
    }

    const lines = cue.text.split('\n');
    const tooManyLines = lines.length > SAFE_LINES;
    const longLine = lines.some((line) => line.length > SAFE_LINE_CHARACTERS);
    if (tooManyLines || longLine) {
      safeArea += 1;
      issues.push({
        cueId: cue.id,
        type: 'safe-area',
        message: tooManyLines
          ? `More than ${SAFE_LINES} subtitle lines may crowd the safe area.`
          : `A subtitle line exceeds ${SAFE_LINE_CHARACTERS} characters.`
      });
    }
  });

  return {
    totalCues: cues.length,
    overlaps,
    timing,
    safeArea,
    blanks,
    issues
  };
}
