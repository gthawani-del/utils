import { createTar } from '../compiler/tar.js';
import { lyricsToLrc } from '../lyrics/lyrics.js';
import { projectSnapshot, saveMediaProjectSnapshot } from '../project.js';
import { transcriptToSrt, transcriptToTxt, transcriptToVtt } from '../transcript/subtitles.js';
import {
  addDeliveryMarker,
  buildRebuildManifest,
  deliveryPresets,
  normalizeDeliveryState,
  removeDeliveryMarker,
  selectedPreset
} from './plan.js';

function safeStem(source) {
  const raw = String(source?.name || 'media-project').replace(/\.[^.]+$/, '');
  return raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'media-project';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function jsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
}

function markerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`
    : `${minutes}:${secs.toFixed(2).padStart(5, '0')}`;
}

export function initDeliveryWorkspace({
  getProject,
  getPlayer,
  getSource,
  saveDelivery,
  saveAudioVideo,
  openCategory,
  setStatus
}) {
  const panel = document.querySelector('#delivery-panel');
  const recovery = document.querySelector('#delivery-recovery');
  const presetSelect = document.querySelector('#delivery-preset');
  const presetNote = document.querySelector('#delivery-preset-note');
  const prepareButton = document.querySelector('#delivery-prepare-preset');
  const markerLabel = document.querySelector('#delivery-marker-label');
  const chapterToggle = document.querySelector('#delivery-marker-chapter');
  const addMarkerButton = document.querySelector('#delivery-add-marker');
  const markerList = document.querySelector('#delivery-marker-list');
  const emptyMarkers = document.querySelector('#delivery-marker-empty');
  const manifestButton = document.querySelector('#delivery-export-manifest');
  const projectButton = document.querySelector('#delivery-export-project');
  const packButton = document.querySelector('#delivery-build-pack');
  const status = document.querySelector('#delivery-status');

  function currentState() {
    return normalizeDeliveryState(getProject().delivery);
  }

  function persist(next, message = '') {
    const normalized = normalizeDeliveryState(next);
    saveDelivery(normalized);
    render();
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
  }

  function sourceAvailable() {
    return Boolean(getSource());
  }

  function renderRecovery() {
    const project = getProject();
    const saved = saveMediaProjectSnapshot(project);
    const source = getSource();
    const sourceState = source?.kind === 'local-file'
      ? (source.objectUrl ? 'local source linked' : 'local source needs relink after recovery')
      : source ? 'provider reference retained' : 'no source';

    recovery.textContent = saved
      ? `Session autosave active · project ${String(project.id || '').slice(0, 12)} · ${sourceState}`
      : `Session autosave unavailable (storage blocked or quota exceeded) · ${sourceState}`;
    recovery.dataset.state = saved ? 'ok' : 'warning';
  }

  function renderPreset() {
    const state = currentState();
    const preset = selectedPreset(state);
    presetSelect.value = state.preset;
    presetNote.textContent = `${preset.intent}. ${preset.note}`;
    prepareButton.disabled = !(preset.readiness === 'prepare' && getSource()?.kind === 'local-file' && getSource()?.mediaType === 'audio');
    prepareButton.textContent = preset.readiness === 'prepare' ? 'Prepare in renderer' : preset.readiness === 'ready' ? 'No render needed' : 'Encoder required';
  }

  function markerRow(marker) {
    const row = document.createElement('article');
    row.className = 'delivery-marker-row';

    const time = document.createElement('button');
    time.type = 'button';
    time.className = 'delivery-marker-time';
    time.textContent = formatTime(marker.time);
    time.addEventListener('click', () => {
      const player = getPlayer();
      if (!player) return;
      try { player.currentTime = marker.time; } catch {}
    });

    const copy = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = marker.label || (marker.chapter ? 'Chapter' : 'Marker');
    const kind = document.createElement('span');
    kind.textContent = marker.chapter ? 'Chapter marker' : 'Marker';
    copy.append(label, kind);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delivery-marker-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      persist(removeDeliveryMarker(currentState(), marker.id), 'Marker removed.');
    });

    row.append(time, copy, remove);
    return row;
  }

  function renderMarkers() {
    const state = currentState();
    markerList.replaceChildren();
    emptyMarkers.classList.toggle('hidden', state.markers.length > 0);
    for (const marker of state.markers) markerList.append(markerRow(marker));
  }

  function render() {
    renderRecovery();
    renderPreset();
    renderMarkers();
    const enabled = sourceAvailable();
    manifestButton.disabled = !enabled;
    projectButton.disabled = !enabled;
    packButton.disabled = !enabled;
    addMarkerButton.disabled = !getPlayer();
  }

  function addMarker() {
    const player = getPlayer();
    if (!player || !Number.isFinite(Number(player.currentTime))) {
      status.textContent = 'Load local playable media before adding a marker.';
      return;
    }

    const next = addDeliveryMarker(currentState(), {
      id: markerId(),
      time: player.currentTime,
      label: markerLabel.value,
      chapter: chapterToggle.checked
    });
    markerLabel.value = '';
    chapterToggle.checked = false;
    persist(next, 'Marker added at the current playhead.');
  }

  function preparePreset() {
    const state = currentState();
    const preset = selectedPreset(state);
    if (preset.readiness !== 'prepare') return;
    const source = getSource();
    if (source?.kind !== 'local-file' || source.mediaType !== 'audio') {
      status.textContent = 'Current browser renderer prepares delivery aspect presets from local audio projects.';
      return;
    }

    const current = getProject().audioVideo || {};
    saveAudioVideo({ ...current, aspect: preset.aspect });
    setStatus(`${preset.label} prepared in Audio → Video.`);
    openCategory('audio-video');
  }

  function exportManifest() {
    const manifest = buildRebuildManifest(getProject());
    downloadBlob(jsonBlob(manifest), `${safeStem(getSource())}-rebuild-manifest.json`);
    status.textContent = `Rebuild manifest exported · ${manifest.fingerprint}`;
  }

  function exportProject() {
    const snapshot = projectSnapshot(getProject());
    downloadBlob(jsonBlob(snapshot), `${safeStem(getSource())}-project.json`);
    status.textContent = 'Portable project metadata exported. Local media bytes are intentionally excluded.';
  }

  async function buildPack() {
    const project = getProject();
    const snapshot = projectSnapshot(project);
    const manifest = buildRebuildManifest(project);
    const files = [
      { name: 'project.json', data: JSON.stringify(snapshot, null, 2) },
      { name: 'rebuild-manifest.json', data: JSON.stringify(manifest, null, 2) }
    ];

    if (project.transcript?.cues?.length) {
      files.push(
        { name: 'transcript.txt', data: transcriptToTxt(project.transcript) },
        { name: 'subtitles.srt', data: transcriptToSrt(project.transcript) },
        { name: 'subtitles.vtt', data: transcriptToVtt(project.transcript) }
      );
    }
    if (project.lyrics?.lines?.length) files.push({ name: 'lyrics.lrc', data: lyricsToLrc(project.lyrics) });

    const chapterLines = currentState().markers
      .filter((marker) => marker.chapter)
      .map((marker) => `${formatTime(marker.time)}\t${marker.label || 'Chapter'}`);
    if (chapterLines.length) files.push({ name: 'chapters.txt', data: chapterLines.join('\n') });

    packButton.disabled = true;
    status.textContent = 'Building project delivery pack locally…';
    try {
      const tar = await createTar(files);
      downloadBlob(tar, `${safeStem(getSource())}-delivery-pack.tar`);
      status.textContent = `Delivery pack created with ${files.length} files · ${manifest.fingerprint}`;
      setStatus('Pro delivery pack completed locally.');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not create the project delivery pack.';
    } finally {
      render();
    }
  }

  presetSelect.addEventListener('change', () => persist({ ...currentState(), preset: presetSelect.value }, 'Professional delivery preset updated.'));
  prepareButton.addEventListener('click', preparePreset);
  addMarkerButton.addEventListener('click', addMarker);
  manifestButton.addEventListener('click', exportManifest);
  projectButton.addEventListener('click', exportProject);
  packButton.addEventListener('click', buildPack);

  render();

  return {
    updateVisibility() {
      const visible = getProject().activeCategory === 'delivery';
      panel.classList.toggle('hidden', !visible);
      if (visible) render();
    },
    onSourceChanged() {
      render();
    },
    resetForNewSource() {
      render();
    }
  };
}
