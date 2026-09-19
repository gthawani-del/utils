import {
  createCueAt,
  normalizeTranscript,
  parseSubtitleText,
  runSubtitleQa,
  transcriptToSrt,
  transcriptToTxt,
  transcriptToVtt
} from './subtitles.js';

function filenameFor(source, extension) {
  const raw = String(source?.name || 'subtitles').replace(/\.[^.]+$/, '');
  const stem = raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'subtitles';
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

function cueAtTime(cues, time) {
  return cues.find((cue) => time >= cue.start && time <= cue.end) || null;
}

export function initTranscriptWorkspace({
  getProject,
  getPlayer,
  getSource,
  saveTranscript,
  setStatus
}) {
  const panel = document.querySelector('#transcript-panel');
  const fileInput = document.querySelector('#transcript-file-input');
  const importButton = document.querySelector('#transcript-import');
  const addButton = document.querySelector('#transcript-add-cue');
  const searchInput = document.querySelector('#transcript-search');
  const list = document.querySelector('#transcript-list');
  const empty = document.querySelector('#transcript-empty');
  const qaSummary = document.querySelector('#transcript-qa-summary');
  const qaList = document.querySelector('#transcript-qa-list');
  const safeToggle = document.querySelector('#transcript-safe-toggle');
  const status = document.querySelector('#transcript-status');
  const exportSrt = document.querySelector('#transcript-export-srt');
  const exportVtt = document.querySelector('#transcript-export-vtt');
  const exportTxt = document.querySelector('#transcript-export-txt');
  const playerWrap = document.querySelector('#source-player-wrap');

  let selectedCueId = null;
  let boundPlayer = null;
  let boundTimeHandler = null;

  function transcript() {
    return normalizeTranscript(getProject().transcript || { cues: [], source: 'manual' });
  }

  function duration() {
    const value = Number(getSource()?.duration);
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }

  function save(next, message = '') {
    const normalized = normalizeTranscript(next);
    saveTranscript(normalized);
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
    render();
    syncOverlay(getPlayer()?.currentTime || 0);
  }

  function updateVisibility() {
    const visible = getProject().activeCategory === 'transcript';
    panel.classList.toggle('hidden', !visible);
    if (visible) render();
    syncSafeToggle();
  }

  function seekTo(cue) {
    selectedCueId = cue.id;
    const player = getPlayer();
    if (player && Number.isFinite(Number(cue.start))) {
      try {
        player.currentTime = cue.start;
      } catch {
        // Some browser media elements may not be seekable yet.
      }
    }
    render();
    syncOverlay(cue.start);
  }

  function commitCue(id, patch) {
    const current = transcript();
    const cues = current.cues.map((cue, index) => {
      if (cue.id !== id) return cue;
      const next = { ...cue, ...patch };
      const start = Math.max(0, Number.isFinite(Number(next.start)) ? Number(next.start) : cue.start);
      const end = Math.max(start, Number.isFinite(Number(next.end)) ? Number(next.end) : cue.end);
      return {
        id: cue.id,
        start,
        end,
        text: String(next.text ?? '').replace(/\u0000/g, '').slice(0, 1200)
      };
    });
    save({ ...current, cues }, 'Subtitle cue updated locally.');
  }

  function deleteCue(id) {
    const current = transcript();
    save({ ...current, cues: current.cues.filter((cue) => cue.id !== id) }, 'Subtitle cue removed.');
    if (selectedCueId === id) selectedCueId = null;
  }

  function renderQa(current) {
    const report = runSubtitleQa(current, { duration: duration() });
    qaSummary.textContent = report.totalCues
      ? `${report.totalCues} cues · ${report.overlaps} overlaps · ${report.timing} timing · ${report.safeArea} safe-area · ${report.blanks} blank`
      : 'No cues to check.';

    qaList.replaceChildren();
    for (const issue of report.issues.slice(0, 8)) {
      const item = document.createElement('li');
      item.textContent = issue.message;
      qaList.append(item);
    }
    if (report.issues.length > 8) {
      const item = document.createElement('li');
      item.textContent = `+${report.issues.length - 8} more issues`;
      qaList.append(item);
    }
  }

  function cueRow(cue) {
    const row = document.createElement('article');
    row.className = 'transcript-cue';
    row.dataset.cueId = cue.id;
    if (cue.id === selectedCueId) row.classList.add('selected');

    const top = document.createElement('div');
    top.className = 'transcript-cue-top';

    const seek = document.createElement('button');
    seek.type = 'button';
    seek.className = 'transcript-time-button';
    seek.textContent = new Date(cue.start * 1000).toISOString().slice(14, 22);
    seek.addEventListener('click', () => seekTo(cue));

    const timing = document.createElement('div');
    timing.className = 'transcript-time-inputs';

    const start = document.createElement('input');
    start.type = 'number';
    start.min = '0';
    start.step = '0.01';
    start.value = cue.start.toFixed(2);
    start.setAttribute('aria-label', 'Subtitle start time');
    start.addEventListener('change', () => commitCue(cue.id, { start: Number(start.value) }));

    const arrow = document.createElement('span');
    arrow.textContent = '→';

    const end = document.createElement('input');
    end.type = 'number';
    end.min = '0';
    end.step = '0.01';
    end.value = cue.end.toFixed(2);
    end.setAttribute('aria-label', 'Subtitle end time');
    end.addEventListener('change', () => commitCue(cue.id, { end: Number(end.value) }));

    timing.append(start, arrow, end);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'transcript-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteCue(cue.id));

    top.append(seek, timing, remove);

    const text = document.createElement('textarea');
    text.rows = 2;
    text.maxLength = 1200;
    text.value = cue.text;
    text.placeholder = 'Subtitle text';
    text.addEventListener('focus', () => {
      selectedCueId = cue.id;
      syncOverlay(getPlayer()?.currentTime || cue.start);
      row.classList.add('selected');
    });
    text.addEventListener('change', () => commitCue(cue.id, { text: text.value }));

    row.append(top, text);
    return row;
  }

  function render() {
    const current = transcript();
    const query = searchInput.value.trim().toLowerCase();
    const cues = query
      ? current.cues.filter((cue) => cue.text.toLowerCase().includes(query))
      : current.cues;

    list.replaceChildren();
    empty.classList.toggle('hidden', current.cues.length > 0);

    for (const cue of cues) list.append(cueRow(cue));
    if (query && !cues.length) {
      const noResults = document.createElement('p');
      noResults.className = 'transcript-no-results';
      noResults.textContent = 'No subtitle text matches this search.';
      list.append(noResults);
    }

    const disabled = current.cues.length === 0;
    exportSrt.disabled = disabled;
    exportVtt.disabled = disabled;
    exportTxt.disabled = disabled;
    renderQa(current);
  }

  function ensureOverlay() {
    let overlay = playerWrap.querySelector('.caption-safe-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'caption-safe-overlay hidden';
      const frame = document.createElement('div');
      frame.className = 'caption-safe-frame';
      const caption = document.createElement('div');
      caption.className = 'caption-safe-text';
      overlay.append(frame, caption);
      playerWrap.append(overlay);
    }
    return overlay;
  }

  function syncOverlay(time) {
    const overlay = ensureOverlay();
    const source = getSource();
    const canShow = getProject().activeCategory === 'transcript'
      && safeToggle.checked
      && source?.kind === 'local-file'
      && source.mediaType === 'video';
    overlay.classList.toggle('hidden', !canShow);
    if (!canShow) return;

    const current = transcript();
    const active = cueAtTime(current.cues, Number(time) || 0)
      || current.cues.find((cue) => cue.id === selectedCueId)
      || null;
    const caption = overlay.querySelector('.caption-safe-text');
    caption.textContent = active?.text || 'Subtitle safe area';
  }

  function syncSafeToggle() {
    const source = getSource();
    const enabled = source?.kind === 'local-file' && source.mediaType === 'video';
    safeToggle.disabled = !enabled;
    if (!enabled) safeToggle.checked = false;
    syncOverlay(getPlayer()?.currentTime || 0);
  }

  function bindPlayer() {
    if (boundPlayer && boundTimeHandler) boundPlayer.removeEventListener('timeupdate', boundTimeHandler);
    boundPlayer = getPlayer();
    boundTimeHandler = () => syncOverlay(boundPlayer?.currentTime || 0);
    if (boundPlayer) boundPlayer.addEventListener('timeupdate', boundTimeHandler);
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      status.textContent = 'Subtitle files are limited to 2 MB.';
      return;
    }

    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.srt') && !name.endsWith('.vtt')) {
      status.textContent = 'Import supports SRT and VTT in this phase.';
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch {
      status.textContent = 'The browser could not read that subtitle file.';
      return;
    }

    const parsed = parseSubtitleText(text, name.endsWith('.vtt') ? 'vtt' : 'srt');
    if (!parsed.ok) {
      status.textContent = parsed.reason;
      return;
    }

    selectedCueId = parsed.transcript.cues[0]?.id || null;
    save(parsed.transcript, `Imported ${parsed.transcript.cues.length} subtitle cues locally.`);
  }

  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await importFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  addButton.addEventListener('click', () => {
    const current = transcript();
    const player = getPlayer();
    const mediaDuration = duration();
    const base = Number.isFinite(Number(player?.currentTime))
      ? Number(player.currentTime)
      : current.cues.length
        ? current.cues[current.cues.length - 1].end
        : 0;
    const cue = createCueAt(base, mediaDuration, current.cues.length);
    selectedCueId = cue.id;
    save({ ...current, source: 'manual', cues: [...current.cues, cue] }, 'Added a subtitle cue.');
  });

  searchInput.addEventListener('input', render);
  safeToggle.addEventListener('change', () => syncOverlay(getPlayer()?.currentTime || 0));

  exportSrt.addEventListener('click', () => {
    const current = transcript();
    downloadText(transcriptToSrt(current), filenameFor(getSource(), 'srt'), 'application/x-subrip;charset=utf-8');
  });
  exportVtt.addEventListener('click', () => {
    const current = transcript();
    downloadText(transcriptToVtt(current), filenameFor(getSource(), 'vtt'), 'text/vtt;charset=utf-8');
  });
  exportTxt.addEventListener('click', () => {
    const current = transcript();
    downloadText(transcriptToTxt(current), filenameFor(getSource(), 'txt'), 'text/plain;charset=utf-8');
  });

  render();

  return {
    updateVisibility,
    onSourceChanged() {
      bindPlayer();
      syncSafeToggle();
      render();
    },
    resetForNewSource() {
      selectedCueId = null;
      searchInput.value = '';
      render();
      syncSafeToggle();
    }
  };
}
