import { activeWordIndex, lyricLineAtTime, normalizeLyrics } from '../lyrics/lyrics.js';

const MODES = new Set(['static', 'bars', 'waveform', 'pulse']);
const ASPECTS = new Set(['16:9', '9:16', '1:1']);
const THEMES = new Set(['midnight', 'ember', 'aurora']);

const THEME_COLORS = Object.freeze({
  midnight: { top: '#101827', bottom: '#273858', accent: '#8fb4ff', soft: '#dfe9ff', text: '#ffffff' },
  ember: { top: '#2a1514', bottom: '#7a3528', accent: '#ffb38a', soft: '#ffe5d6', text: '#fff8f3' },
  aurora: { top: '#102321', bottom: '#155d58', accent: '#7cebd7', soft: '#d9fff7', text: '#f6fffd' }
});

export function createAudioVideoConfig(source = null, lyrics = null) {
  const normalizedLyrics = normalizeLyrics(lyrics || { lines: [] });
  const sourceName = String(source?.name || '').replace(/\.[^.]+$/, '');
  return {
    mode: 'bars',
    aspect: '16:9',
    theme: 'midnight',
    title: normalizedLyrics.title || sourceName || 'Untitled',
    artist: normalizedLyrics.artist || '',
    showLyrics: normalizedLyrics.lines.length > 0
  };
}

export function normalizeAudioVideoConfig(config, source = null, lyrics = null) {
  const defaults = createAudioVideoConfig(source, lyrics);
  const input = config && typeof config === 'object' ? config : {};
  return {
    mode: MODES.has(input.mode) ? input.mode : defaults.mode,
    aspect: ASPECTS.has(input.aspect) ? input.aspect : defaults.aspect,
    theme: THEMES.has(input.theme) ? input.theme : defaults.theme,
    title: String(input.title ?? defaults.title).replace(/\u0000/g, '').trim().slice(0, 120),
    artist: String(input.artist ?? defaults.artist).replace(/\u0000/g, '').trim().slice(0, 120),
    showLyrics: input.showLyrics === undefined ? defaults.showLyrics : Boolean(input.showLyrics)
  };
}

export function outputDimensions(aspect, { compact = false } = {}) {
  const short = compact ? 540 : 720;
  if (aspect === '9:16') return { width: short, height: compact ? 960 : 1280 };
  if (aspect === '1:1') return { width: short, height: short };
  return { width: compact ? 960 : 1280, height: short };
}

export function lyricFrame(lyrics, time) {
  const normalized = normalizeLyrics(lyrics || { lines: [] });
  const line = lyricLineAtTime(normalized, time);
  if (!line) return null;

  const activeIndex = activeWordIndex(line, time);
  return {
    id: line.id,
    text: line.text,
    words: line.words.map((word, index) => ({ text: word.text, active: index <= activeIndex }))
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, initialSize, minSize, weight = 700) {
  let size = initialSize;
  const safe = String(text || '');
  while (size > minSize) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    if (ctx.measureText(safe).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawBars(ctx, data, width, height, theme) {
  const bins = data?.length ? data : new Uint8Array(64);
  const count = Math.min(64, bins.length);
  const gap = Math.max(2, width * 0.004);
  const totalWidth = width * 0.72;
  const barWidth = Math.max(2, (totalWidth - gap * (count - 1)) / count);
  const startX = (width - totalWidth) / 2;
  const baseline = height * 0.71;
  const maxHeight = height * 0.18;

  ctx.fillStyle = theme.accent;
  for (let i = 0; i < count; i += 1) {
    const sourceIndex = Math.floor((i / count) * bins.length);
    const value = Math.max(0.08, Number(bins[sourceIndex] || 0) / 255);
    const barHeight = maxHeight * value;
    const x = startX + i * (barWidth + gap);
    roundedRect(ctx, x, baseline - barHeight, barWidth, barHeight, barWidth / 2);
    ctx.fill();
  }
}

function drawWaveform(ctx, data, width, height, theme) {
  const values = data?.length ? data : new Uint8Array(128).fill(128);
  const left = width * 0.12;
  const right = width * 0.88;
  const center = height * 0.65;
  const amplitude = height * 0.11;

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(2, width * 0.003);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let i = 0; i < values.length; i += 1) {
    const x = left + (i / Math.max(1, values.length - 1)) * (right - left);
    const normalized = (Number(values[i]) - 128) / 128;
    const y = center + normalized * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawPulse(ctx, data, width, height, theme) {
  const values = data?.length ? data : new Uint8Array(64);
  const average = values.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, values.length) / 255;
  const cx = width / 2;
  const cy = height * 0.64;
  const base = Math.min(width, height) * 0.065;
  const radius = base * (1 + average * 1.8);

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(3, width * 0.004);
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.globalAlpha = Math.max(0.16, 0.8 - ring * 0.24);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + ring * 0.48), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawProgress(ctx, width, height, progress, theme) {
  const x = width * 0.12;
  const y = height * 0.91;
  const w = width * 0.76;
  const h = Math.max(3, height * 0.006);

  ctx.fillStyle = 'rgba(255,255,255,.2)';
  roundedRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  ctx.fillStyle = theme.accent;
  roundedRect(ctx, x, y, w * Math.max(0, Math.min(1, progress || 0)), h, h / 2);
  ctx.fill();
}

function drawLyrics(ctx, lyric, width, height, theme) {
  if (!lyric) return;

  const maxWidth = width * 0.78;
  const size = fitText(ctx, lyric.text, maxWidth, Math.round(Math.min(width, height) * 0.045), 20, 760);
  const y = height * 0.82;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!lyric.words.length) {
    ctx.font = `760 ${size}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.fillText(lyric.text, width / 2, y, maxWidth);
    return;
  }

  const gap = Math.max(6, size * 0.22);
  ctx.font = `760 ${size}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  const widths = lyric.words.map((word) => ctx.measureText(word.text).width);
  const total = widths.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, lyric.words.length - 1);
  let cursor = width / 2 - total / 2;
  ctx.textAlign = 'left';

  lyric.words.forEach((word, index) => {
    ctx.fillStyle = word.active ? theme.accent : 'rgba(255,255,255,.45)';
    ctx.fillText(word.text, cursor, y);
    cursor += widths[index] + gap;
  });

  ctx.textAlign = 'center';
}

export function drawAudioVideoFrame(ctx, {
  width,
  height,
  config,
  frequencyData = null,
  timeData = null,
  time = 0,
  duration = 0,
  lyrics = null
}) {
  const safe = normalizeAudioVideoConfig(config);
  const theme = THEME_COLORS[safe.theme] || THEME_COLORS.midnight;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.top);
  gradient.addColorStop(1, theme.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * .5, height * .48, 0, width * .5, height * .48, Math.max(width, height) * .55);
  glow.addColorStop(0, 'rgba(255,255,255,.08)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const titleSize = fitText(ctx, safe.title || 'Untitled', width * 0.76, Math.round(Math.min(width, height) * 0.075), 24, 820);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.text;
  ctx.font = `820 ${titleSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(safe.title || 'Untitled', width / 2, height * 0.30, width * 0.78);

  if (safe.artist) {
    const artistSize = Math.max(15, Math.round(titleSize * .34));
    ctx.font = `600 ${artistSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = theme.soft;
    ctx.fillText(safe.artist, width / 2, height * 0.38, width * 0.72);
  }

  if (safe.mode === 'bars') drawBars(ctx, frequencyData, width, height, theme);
  if (safe.mode === 'waveform') drawWaveform(ctx, timeData, width, height, theme);
  if (safe.mode === 'pulse') drawPulse(ctx, frequencyData, width, height, theme);

  if (safe.showLyrics) drawLyrics(ctx, lyricFrame(lyrics, time), width, height, theme);

  drawProgress(ctx, width, height, duration > 0 ? time / duration : 0, theme);
}

export function recorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];
  return candidates.find((type) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)) || '';
}
