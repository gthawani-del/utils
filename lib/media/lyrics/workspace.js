import {
  activeWordIndex,
  lyricLineAtTime,
  lyricsToLrc,
  lyricsToTxt,
  normalizeLyrics,
  parseLyricsText,
  stampLyricLine
} from './lyrics.js';

function filenameFor(source, extension) {
  const raw = String(source?.name || 'lyrics').replace(/\.[^.]+$/, '');
  const stem = raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'lyrics';
  return `${stem}.${extension}`;
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatTime(seconds) {
  if (!Number.isFinite(Number(seconds))) return 'Untimed';
  const safe = Math.max(0, Number(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

export function initLyricsWorkspace({
  getProject,
  getPlayer,
  getSource,
  saveLyrics,
  setStatus
}) {
  const panel = document.querySelector('#lyrics-panel');
  const fileInput = document.querySelector('#lyrics-file-input');
  const importButton = document.querySelector('#lyrics-import');
  const addButton = document.querySelector('#lyrics-add-line');
  const stampButton = document.querySelector('#lyrics-stamp-line');
  const list = document.querySelector('#lyrics-list');
  const empty = document.querySelector('#lyrics-empty');
  const styleSelect = document.querySelector('#lyrics-style');
  const effectSelect = document.querySelector('#lyrics-effect');
  const backgroundSelect = document.querySelector('#lyrics-background');
  const preview = document.querySelector('#lyrics-preview');
  const previewText = document.querySelector('#lyrics-preview-text');
  const previewMeta = document.querySelector('#lyrics-preview-meta');
  const status = document.querySelector('#lyrics-status');
  const exportLrc = document.querySelector('#lyrics-export-lrc');
  const exportTxt = document.querySelector('#lyrics-export-txt');
  const playerWrap = document.querySelector('#source-player-wrap');

  let selectedLineId = null;
  let boundPlayer = null;
  let boundTimeHandler = null;

  function currentLyrics() {
    return normalizeLyrics(getProject().lyrics || { lines: [], source: 'manual' });
  }

  function save(next, message = '') {
    const normalized = normalizeLyrics(next);
    saveLyrics(normalized);
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
    render();
    syncPreview(getPlayer()?.currentTime || 0);
  }

  function updateVisibility() {
    const visible = getProject().activeCategory === 'lyrics';
    panel.classList.toggle('hidden', !visible);
    if (visible) render();
    syncPreview(getPlayer()?.currentTime || 0);
  }

  function setSelected(id) {
    selectedLineId = id;
    render();
    syncPreview(getPlayer()?.currentTime || 0);
  }

  function lineRow(line) {
    const row = document.createElement('article');
    row.className = 'lyrics-line';
    if (line.id === selectedLineId) row.classList.add('selected');

    const controls = document.createElement('div');
    controls.className = 'lyrics-line-controls';

    const time = document.createElement('input');
    time.type = 'number';
    time.min = '0';
    time.step = '0.01';
    time.placeholder = 'Untimed';
    time.value = line.start === null ? '' : line.start.toFixed(2);
    time.setAttribute('aria-label', 'Lyric line timestamp');
    time.addEventListener('change', () => {
      const value = time.value === '' ? null : Number(time.value);
      const current = currentLyrics();
      save({
        ...current,
        lines: current.lines.map((item) => item.id === line.id ? { ...item, start: value } : item)
      }, 'Lyric timestamp updated.');
    });

    const seek = document.createElement('button');
    seek.type = 'button';
    seek.textContent = line.start === null ? 'Untimed' : formatTime(line.start);
    seek.disabled = line.start === null;
    seek.addEventListener('click', () => {
      setSelected(line.id);
      const player = getPlayer();
      if (player && line.start !== null) {
        try { player.currentTime = line.start; } catch {}
      }
    });

    const stamp = document.createElement('button');
    stamp.type = 'button';
    stamp.textContent = 'Stamp';
    stamp.addEventListener('click', () => {
      selectedLineId = line.id;
      stampSelectedAtPlayhead();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.className = 'lyrics-delete';
    remove.addEventListener('click', () => {
      const current = currentLyrics();
      save({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }, 'Lyric line removed.');
      if (selectedLineId === line.id) selectedLineId = null;
    });

    controls.append(time, seek, stamp, remove);

    const text = document.createElement('textarea');
    text.rows = 2;
    text.maxLength = 1200;
    text.value = line.text;
    text.placeholder = 'Lyric line';
    text.addEventListener('focus', () => {
      selectedLineId = line.id;
      row.classList.add('selected');
      syncPreview(getPlayer()?.currentTime || line.start || 0);
    });
    text.addEventListener('change', () => {
      const current = currentLyrics();
      save({
        ...current,
        lines: current.lines.map((item) => item.id === line.id ? { ...item, text: text.value, words: [] } : item)
      }, 'Lyric line updated. Word timing was cleared for the edited line.');
    });

    const wordNote = document.createElement('small');
    wordNote.className = 'lyrics-word-note';
    wordNote.textContent = line.words.length
      ? `${line.words.length} explicit enhanced-LRC word markers`
      : 'Line-level timing';

    row.append(controls, text, wordNote);
    row.addEventListener('click', (event) => {
      if (!event.target.closest('button,input,textarea')) setSelected(line.id);
    });
    return row;
  }

  function render() {
    const lyrics = currentLyrics();
    list.replaceChildren();
    empty.classList.toggle('hidden', lyrics.lines.length > 0);

    for (const line of lyrics.lines) list.append(lineRow(line));

    styleSelect.value = lyrics.style;
    effectSelect.value = lyrics.effect;
    backgroundSelect.value = lyrics.background;

    const disabled = lyrics.lines.length === 0;
    exportLrc.disabled = disabled;
    exportTxt.disabled = disabled;
    stampButton.disabled = disabled;
  }

  function overlay() {
    let node = playerWrap.querySelector('.lyrics-player-overlay');
    if (!node) {
      node = document.createElement('div');
      node.className = 'lyrics-player-overlay hidden';
      const text = document.createElement('div');
      text.className = 'lyrics-player-text';
      node.append(text);
      playerWrap.append(node);
    }
    return node;
  }

  function renderWords(container, line, time) {
    container.replaceChildren();
    if (!line) return;

    if (!line.words.length) {
      container.textContent = line.text;
      return;
    }

    const active = activeWordIndex(line, time);
    line.words.forEach((word, index) => {
      const span = document.createElement('span');
      span.textContent = word.text;
      if (index <= active) span.classList.add('karaoke-word-active');
      container.append(span);
    });
  }

  function syncPreview(time) {
    const lyrics = currentLyrics();
    const selected = lyrics.lines.find((line) => line.id === selectedLineId) || null;
    const active = lyricLineAtTime(lyrics, time) || selected || lyrics.lines[0] || null;

    preview.className = `lyrics-preview lyrics-style-${lyrics.style} lyrics-effect-${lyrics.effect} lyrics-background-${lyrics.background}`;
    renderWords(previewText, active, time);
    previewMeta.textContent = active
      ? `${active.start === null ? 'Untimed' : formatTime(active.start)} · ${active.words.length ? 'word-synced' : 'line-synced'}`
      : 'Import or add lyrics to preview';

    const playerOverlay = overlay();
    const canOverlay = getProject().activeCategory === 'lyrics' && getSource()?.kind === 'local-file';
    playerOverlay.className = `lyrics-player-overlay lyrics-style-${lyrics.style} lyrics-effect-${lyrics.effect} lyrics-background-${lyrics.background}`;
    playerOverlay.classList.toggle('hidden', !canOverlay || !active);
    if (canOverlay && active) renderWords(playerOverlay.querySelector('.lyrics-player-text'), active, time);
  }

  function bindPlayer() {
    if (boundPlayer && boundTimeHandler) boundPlayer.removeEventListener('timeupdate', boundTimeHandler);
    boundPlayer = getPlayer();
    boundTimeHandler = () => syncPreview(boundPlayer?.currentTime || 0);
    if (boundPlayer) boundPlayer.addEventListener('timeupdate', boundTimeHandler);
  }

  function stampSelectedAtPlayhead() {
    const lyrics = currentLyrics();
    const line = lyrics.lines.find((item) => item.id === selectedLineId) || lyrics.lines.find((item) => item.start === null) || lyrics.lines[0];
    if (!line) {
      status.textContent = 'Add or import a lyric line first.';
      return;
    }

    const player = getPlayer();
    if (!player || !Number.isFinite(Number(player.currentTime))) {
      status.textContent = 'Load local audio/video to stamp lyrics from the playhead.';
      return;
    }

    selectedLineId = line.id;
    const next = stampLyricLine(lyrics, line.id, player.currentTime);
    save(next, `Stamped line at ${formatTime(player.currentTime)}.`);

    const currentIndex = next.lines.findIndex((item) => item.id === line.id);
    const nextUntimed = next.lines.slice(currentIndex + 1).find((item) => item.start === null);
    if (nextUntimed) selectedLineId = nextUntimed.id;
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      status.textContent = 'Lyrics files are limited to 2 MB.';
      return;
    }

    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.lrc') && !name.endsWith('.txt')) {
      status.textContent = 'Import supports LRC and TXT in this phase.';
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch {
      status.textContent = 'The browser could not read that lyrics file.';
      return;
    }

    const parsed = parseLyricsText(text, name.endsWith('.lrc') ? 'lrc' : 'txt');
    if (!parsed.ok) {
      status.textContent = parsed.reason;
      return;
    }

    selectedLineId = parsed.lyrics.lines[0]?.id || null;
    save(parsed.lyrics, `Imported ${parsed.lyrics.lines.length} lyric lines locally.`);
  }

  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await importFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  addButton.addEventListener('click', () => {
    const lyrics = currentLyrics();
    const line = {
      id: `lyric-${Date.now()}-${lyrics.lines.length + 1}`,
      start: null,
      text: '',
      words: []
    };
    selectedLineId = line.id;
    save({ ...lyrics, source: 'manual', lines: [...lyrics.lines, line] }, 'Added an untimed lyric line.');
  });

  stampButton.addEventListener('click', stampSelectedAtPlayhead);

  for (const [select, key] of [
    [styleSelect, 'style'],
    [effectSelect, 'effect'],
    [backgroundSelect, 'background']
  ]) {
    select.addEventListener('change', () => {
      const lyrics = currentLyrics();
      save({ ...lyrics, [key]: select.value }, 'Lyric preview style updated.');
    });
  }

  exportLrc.addEventListener('click', () => {
    downloadText(lyricsToLrc(currentLyrics()), filenameFor(getSource(), 'lrc'), 'text/plain;charset=utf-8');
  });
  exportTxt.addEventListener('click', () => {
    downloadText(lyricsToTxt(currentLyrics()), filenameFor(getSource(), 'txt'), 'text/plain;charset=utf-8');
  });

  render();

  return {
    updateVisibility,
    onSourceChanged() {
      bindPlayer();
      render();
      syncPreview(getPlayer()?.currentTime || 0);
    },
    resetForNewSource() {
      selectedLineId = null;
      render();
      syncPreview(0);
    }
  };
}
