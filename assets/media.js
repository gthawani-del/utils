import { ingestLocalMedia, releaseMediaSource, validateMediaUrl } from '/lib/media/ingest.js';
import { createMediaProject, loadMediaProjectSnapshot, setProjectAudioEdits, setProjectAudioVideo, setProjectCategory, setProjectCompiler, setProjectDelivery, setProjectLyrics, setProjectSource, setProjectTranscript, setProjectVersioning, setProjectVideoEdits } from '/lib/media/project.js';
import { initAudioVideoWorkspace } from '/lib/media/audio-video/workspace.js';
import { initCompilerWorkspace } from '/lib/media/compiler/workspace.js';
import { initCommandAssistant } from '/lib/media/command/workspace.js';
import { initQcWorkspace } from '/lib/media/qc/workspace.js';
import { initDeliveryWorkspace } from '/lib/media/delivery/workspace.js';
import { initRecipeWorkspace } from '/lib/media/recipes/workspace.js';
import { initLyricsWorkspace } from '/lib/media/lyrics/workspace.js';
import { initTranscriptWorkspace } from '/lib/media/transcript/workspace.js';
import { initVersionWorkspace } from '/lib/media/versions/workspace.js';
import { createAudioEdits, audioSelectionDuration, normalizeAudioEdits, previewVolumeAt, updateAudioEdits } from '/lib/media/audio/edits.js';
import { createVideoEdits, normalizeVideoEdits, selectionDuration, updateVideoEdits } from '/lib/media/video/edits.js';

const categories = [
  { id: 'video', name: 'Video Editor', short: 'Video Editor', icon: '▣', hint: 'Edit, trim, effects, transitions', copy: 'Upload or open a project to begin editing video in the shared Media Studio workspace.' },
  { id: 'audio', name: 'Audio Studio', short: 'Audio Studio', icon: '◫', hint: 'Clean, enhance, mix, convert', copy: 'Audio tools will use the same project media without requiring a second upload.' },
  { id: 'transcript', name: 'Transcription & Subtitles', short: 'Transcription & Subtitles', icon: 'CC', hint: 'Transcribe, caption, translate', copy: 'Transcription, timestamps and subtitle editing will live here once the transcription phase is approved.' },
  { id: 'lyrics', name: 'Lyrics & Karaoke', short: 'Lyrics & Karaoke', icon: '♫', hint: 'Lyrics, LRC, karaoke videos', copy: 'Lyrics timing, karaoke highlighting and reusable text styles will be added in their own phase.' },
  { id: 'audio-video', name: 'Audio → Video', short: 'Audio → Video', icon: '▧', hint: 'Turn audio into engaging video', copy: 'Visualizers, lyric videos and audiograms will operate on the same shared Media Project.' },
  { id: 'compiler', name: 'Media Compiler', short: 'Media Compiler', icon: '◆', hint: 'Create multiple versions', copy: 'One source will later produce multiple deterministic delivery outputs.' },
  { id: 'qc', name: 'QC & Forensics', short: 'QC & Forensics', icon: '◇', hint: 'Check, fix, analyze media', copy: 'Codec, timing, audio and delivery checks will appear here after the processing foundation exists.' },
  { id: 'delivery', name: 'Pro Workflow & Delivery', short: 'Pro Workflow & Delivery', icon: '⇧', hint: 'Prepare and deliver anywhere', copy: 'Packaging, manifests and professional delivery controls will be introduced later.' }
];

const desktopNav = document.querySelector('#desktop-category-nav');
const mobileRail = document.querySelector('#mobile-category-rail');
const workspaceTitle = document.querySelector('#workspace-title');
const emptyStage = document.querySelector('#empty-stage');
const emptyTitle = document.querySelector('#empty-title');
const emptyCopy = document.querySelector('#empty-copy');
const sourceStage = document.querySelector('#source-stage');
const playerWrap = document.querySelector('#source-player-wrap');
const sourceName = document.querySelector('#source-name');
const sourceSummary = document.querySelector('#source-summary');
const phaseNote = document.querySelector('#phase-note');
const sourceNote = document.querySelector('#source-note');
const commandMessage = document.querySelector('#command-message');
const fileInput = document.querySelector('#media-file-input');
const linkDialog = document.querySelector('#link-dialog');
const linkForm = document.querySelector('#link-form');
const linkInput = document.querySelector('#media-link-input');
const linkError = document.querySelector('#link-error');
const metadataPanel = document.querySelector('#media-info-panel');
const contextEmpty = document.querySelector('#context-empty');
const projectBadge = document.querySelector('#project-badge');
const statusPrimary = document.querySelector('#status-primary');
const videoEditorPanel = document.querySelector('#video-editor-panel');
const trimStartInput = document.querySelector('#video-trim-start');
const trimEndInput = document.querySelector('#video-trim-end');
const playheadInput = document.querySelector('#video-playhead');
const playheadLabel = document.querySelector('#video-playhead-label');
const selectionLabel = document.querySelector('#video-selection-label');
const playbackRateSelect = document.querySelector('#video-playback-rate');
const videoMuteInput = document.querySelector('#video-mute');
const undoButton = document.querySelector('#video-undo');
const redoButton = document.querySelector('#video-redo');
const timelineStatus = document.querySelector('#timeline-status');
const videoTrackPlaceholder = document.querySelector('#video-track-placeholder');
const audioEditorPanel = document.querySelector('#audio-editor-panel');
const audioTrimStartInput = document.querySelector('#audio-trim-start');
const audioTrimEndInput = document.querySelector('#audio-trim-end');
const audioPlayheadInput = document.querySelector('#audio-playhead');
const audioPlayheadLabel = document.querySelector('#audio-playhead-label');
const audioSelectionLabel = document.querySelector('#audio-selection-label');
const audioVolumeInput = document.querySelector('#audio-volume');
const audioVolumeValue = document.querySelector('#audio-volume-value');
const audioFadeInInput = document.querySelector('#audio-fade-in');
const audioFadeOutInput = document.querySelector('#audio-fade-out');
const audioUndoButton = document.querySelector('#audio-undo');
const audioRedoButton = document.querySelector('#audio-redo');
const restored = loadMediaProjectSnapshot();
const project = createMediaProject();
let currentPlayer = null;
let videoHistory = [];
let videoFuture = [];
let playingSelection = false;
let audioHistory = [];
let audioFuture = [];
let playingAudioSelection = false;
let transcriptWorkspace = null;
let lyricsWorkspace = null;
let audioVideoWorkspace = null;
let compilerWorkspace = null;
let qcWorkspace = null;
let deliveryWorkspace = null;
let commandAssistant = null;
let recipeWorkspace = null;
let versionWorkspace = null;

if (restored) {
  project.id = restored.id || project.id;
  project.createdAt = restored.createdAt || project.createdAt;
  project.updatedAt = restored.updatedAt || project.updatedAt;
  project.activeCategory = restored.activeCategory || project.activeCategory;
  project.source = restored.source || null;
  project.videoEdits = restored.videoEdits || null;
  project.audioEdits = restored.audioEdits || null;
  project.transcript = restored.transcript || null;
  project.lyrics = restored.lyrics || null;
  project.audioVideo = restored.audioVideo || null;
  project.compiler = restored.compiler || null;
  project.delivery = restored.delivery || null;
  project.versions = Array.isArray(restored.versions)
    ? restored.versions.map((version) => ({ ...version, sessionAvailable: false }))
    : [];
  project.activeVersionId = restored.activeVersionId || null;
  project.baseVersionId = restored.baseVersionId || 'original';
}

function makeDesktopButton(category, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'desktop-category-button';
  button.dataset.category = category.id;

  const icon = document.createElement('span');
  icon.textContent = category.icon;
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = category.name;
  const hint = document.createElement('small');
  hint.textContent = category.hint;
  copy.append(title, hint);
  button.append(icon, copy);
  button.setAttribute('aria-label', `${index + 1}. ${category.name}`);
  return button;
}

function makeMobileButton(category) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-card';
  button.dataset.category = category.id;
  const icon = document.createElement('span');
  icon.textContent = category.icon;
  const label = document.createElement('small');
  label.textContent = category.short;
  button.append(icon, label);
  return button;
}

for (const [index, category] of categories.entries()) {
  desktopNav.append(makeDesktopButton(category, index));
  mobileRail.append(makeMobileButton(category));
}

function selectCategory(id) {
  const category = categories.find((item) => item.id === id) || categories[0];
  document.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === category.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  workspaceTitle.textContent = category.name;
  setProjectCategory(project, category.id);

  if (!project.source) {
    emptyTitle.textContent = `${category.name} is ready for a project`;
    emptyCopy.textContent = category.copy;
  }
  updateVideoEditorVisibility();
  updateAudioEditorVisibility();
  transcriptWorkspace?.updateVisibility();
  lyricsWorkspace?.updateVisibility();
  audioVideoWorkspace?.updateVisibility();
  compilerWorkspace?.updateVisibility();
  qcWorkspace?.updateVisibility();
  deliveryWorkspace?.updateVisibility();
  versionWorkspace?.refresh();
  commandAssistant?.refresh();
}

function formatEditorTime(seconds) {
  const value = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const minutes = Math.floor(value / 60);
  const remainder = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function hasEditableVideo() {
  return project.activeCategory === 'video'
    && project.source?.kind === 'local-file'
    && project.source?.mediaType === 'video'
    && currentPlayer?.tagName === 'VIDEO';
}

function updateVideoEditorVisibility() {
  const visible = hasEditableVideo();
  videoEditorPanel.classList.toggle('hidden', !visible);
  timelineStatus.textContent = visible ? 'Trim preview active' : 'Source preview';
}

function currentVideoEdits() {
  if (!project.source || project.source.mediaType !== 'video') return null;
  const duration = Number(project.source.duration || 0);
  return normalizeVideoEdits(project.videoEdits || createVideoEdits(duration), duration);
}

function syncVideoControls() {
  const edits = currentVideoEdits();
  const duration = Number(project.source?.duration || 0);
  if (!edits || !Number.isFinite(duration)) return;

  trimStartInput.max = String(duration);
  trimEndInput.max = String(duration);
  trimStartInput.value = edits.trimStart.toFixed(2);
  trimEndInput.value = edits.trimEnd.toFixed(2);
  playheadInput.max = String(duration);
  playbackRateSelect.value = String(edits.playbackRate);
  videoMuteInput.checked = edits.muted;
  selectionLabel.textContent = `Selection ${formatEditorTime(selectionDuration(edits, duration))}`;

  if (currentPlayer) {
    currentPlayer.playbackRate = edits.playbackRate;
    currentPlayer.muted = edits.muted;
  }
  updateUndoRedo();
  updateTimelineSelection(edits, duration);
}

function updateTimelineSelection(edits, duration) {
  const start = duration > 0 ? (edits.trimStart / duration) * 100 : 0;
  const end = duration > 0 ? (edits.trimEnd / duration) * 100 : 100;
  videoTrackPlaceholder.style.setProperty('--trim-start', start.toFixed(3) + '%');
  videoTrackPlaceholder.style.setProperty('--trim-end', end.toFixed(3) + '%');
  videoTrackPlaceholder.classList.toggle('trim-active', edits.trimStart > 0 || edits.trimEnd < duration);
}

function updatePlayhead(time) {
  const duration = Number(project.source?.duration || 0);
  const value = Math.min(duration, Math.max(0, Number(time) || 0));
  playheadInput.value = String(value);
  playheadLabel.textContent = formatEditorTime(value);
}

function recordVideoEdit(next) {
  const current = currentVideoEdits();
  if (!current) return;
  const changed = current.trimStart !== next.trimStart
    || current.trimEnd !== next.trimEnd
    || current.playbackRate !== next.playbackRate
    || current.muted !== next.muted;
  if (!changed) return;

  videoHistory.push(current);
  if (videoHistory.length > 40) videoHistory.shift();
  videoFuture = [];
  setProjectVideoEdits(project, next);
  syncVideoControls();
}

function applyVideoPatch(patch) {
  const current = currentVideoEdits();
  if (!current) return;
  const duration = Number(project.source?.duration || 0);
  recordVideoEdit(updateVideoEdits(current, patch, duration));
}

function restoreVideoEdit(next) {
  setProjectVideoEdits(project, next);
  syncVideoControls();
  const edits = currentVideoEdits();
  if (currentPlayer && edits && currentPlayer.currentTime < edits.trimStart) {
    currentPlayer.currentTime = edits.trimStart;
  }
}

function updateUndoRedo() {
  undoButton.disabled = videoHistory.length === 0;
  redoButton.disabled = videoFuture.length === 0;
}

function resetVideoHistory() {
  videoHistory = [];
  videoFuture = [];
  updateUndoRedo();
}

function hasEditableAudio() {
  return project.activeCategory === 'audio'
    && project.source?.kind === 'local-file'
    && project.source?.mediaType === 'audio'
    && currentPlayer?.tagName === 'AUDIO';
}

function updateAudioEditorVisibility() {
  const visible = hasEditableAudio();
  audioEditorPanel.classList.toggle('hidden', !visible);
  if (visible) timelineStatus.textContent = 'Audio preview active';
  else if (!hasEditableVideo()) timelineStatus.textContent = 'Source preview';
}

function currentAudioEdits() {
  if (!project.source || project.source.mediaType !== 'audio') return null;
  const duration = Number(project.source.duration || 0);
  return normalizeAudioEdits(project.audioEdits || createAudioEdits(duration), duration);
}

function updateAudioUndoRedo() {
  audioUndoButton.disabled = audioHistory.length === 0;
  audioRedoButton.disabled = audioFuture.length === 0;
}

function updateAudioTimelineSelection(edits, duration) {
  const start = duration > 0 ? (edits.trimStart / duration) * 100 : 0;
  const end = duration > 0 ? (edits.trimEnd / duration) * 100 : 100;
  const audioTrack = document.querySelector('.audio-placeholder');
  audioTrack.style.setProperty('--audio-trim-start', start.toFixed(3) + '%');
  audioTrack.style.setProperty('--audio-trim-end', end.toFixed(3) + '%');
  audioTrack.classList.toggle('audio-trim-active', edits.trimStart > 0 || edits.trimEnd < duration);
}

function updateAudioPlayhead(time) {
  const duration = Number(project.source?.duration || 0);
  const value = Math.min(duration, Math.max(0, Number(time) || 0));
  audioPlayheadInput.value = String(value);
  audioPlayheadLabel.textContent = formatEditorTime(value);
}

function syncAudioPreviewVolume(time = currentPlayer?.currentTime || 0) {
  const edits = currentAudioEdits();
  if (!edits || !currentPlayer || currentPlayer.tagName !== 'AUDIO') return;
  currentPlayer.volume = previewVolumeAt(time, edits, Number(project.source?.duration || 0));
}

function syncAudioControls() {
  const edits = currentAudioEdits();
  const duration = Number(project.source?.duration || 0);
  if (!edits || !Number.isFinite(duration)) return;

  audioTrimStartInput.max = String(duration);
  audioTrimEndInput.max = String(duration);
  audioTrimStartInput.value = edits.trimStart.toFixed(2);
  audioTrimEndInput.value = edits.trimEnd.toFixed(2);
  audioFadeInInput.max = String(Math.max(0, edits.trimEnd - edits.trimStart));
  audioFadeOutInput.max = String(Math.max(0, edits.trimEnd - edits.trimStart));
  audioFadeInInput.value = edits.fadeIn.toFixed(1);
  audioFadeOutInput.value = edits.fadeOut.toFixed(1);
  audioPlayheadInput.max = String(duration);
  audioVolumeInput.value = String(Math.round(edits.volume * 100));
  audioVolumeValue.textContent = Math.round(edits.volume * 100) + '%';
  audioSelectionLabel.textContent = `Selection ${formatEditorTime(audioSelectionDuration(edits, duration))}`;

  syncAudioPreviewVolume();
  updateAudioUndoRedo();
  updateAudioTimelineSelection(edits, duration);
}

function recordAudioEdit(next) {
  const current = currentAudioEdits();
  if (!current) return;
  const changed = current.trimStart !== next.trimStart
    || current.trimEnd !== next.trimEnd
    || current.volume !== next.volume
    || current.fadeIn !== next.fadeIn
    || current.fadeOut !== next.fadeOut;
  if (!changed) return;

  audioHistory.push(current);
  if (audioHistory.length > 40) audioHistory.shift();
  audioFuture = [];
  setProjectAudioEdits(project, next);
  syncAudioControls();
}

function applyAudioPatch(patch) {
  const current = currentAudioEdits();
  if (!current) return;
  const duration = Number(project.source?.duration || 0);
  recordAudioEdit(updateAudioEdits(current, patch, duration));
}

function restoreAudioEdit(next) {
  setProjectAudioEdits(project, next);
  syncAudioControls();
  const edits = currentAudioEdits();
  if (currentPlayer && edits && currentPlayer.currentTime < edits.trimStart) currentPlayer.currentTime = edits.trimStart;
}

function resetAudioHistory() {
  audioHistory = [];
  audioFuture = [];
  updateAudioUndoRedo();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function metadataRow(label, value) {
  const row = document.createElement('div');
  const dt = document.createElement('span');
  const dd = document.createElement('strong');
  dt.textContent = label;
  dd.textContent = value || '—';
  row.append(dt, dd);
  return row;
}

function updateMetadataPanel(source) {
  metadataPanel.replaceChildren();
  if (!source) {
    metadataPanel.classList.add('hidden');
    contextEmpty.classList.remove('hidden');
    return;
  }

  contextEmpty.classList.add('hidden');
  metadataPanel.classList.remove('hidden');
  const title = document.createElement('strong');
  title.className = 'media-info-title';
  title.textContent = 'Media Info';
  metadataPanel.append(title);

  if (source.kind === 'local-file') {
    metadataPanel.append(
      metadataRow('Type', source.mediaType === 'video' ? 'Video' : 'Audio'),
      metadataRow('Container', String(source.container || '').toUpperCase()),
      metadataRow('Detected MIME', source.detectedMime),
      metadataRow('Size', formatBytes(source.bytes)),
      metadataRow('Duration', formatDuration(source.duration))
    );
    if (source.mediaType === 'video') metadataPanel.append(metadataRow('Dimensions', `${source.width} × ${source.height}`));
  } else {
    metadataPanel.append(
      metadataRow('Source', source.provider),
      metadataRow('Network', 'Not fetched'),
      metadataRow('Status', 'Reference saved locally')
    );
  }
}

function clearPlayer() {
  if (!currentPlayer) return;
  currentPlayer.pause?.();
  currentPlayer.removeAttribute?.('src');
  currentPlayer.load?.();
  currentPlayer.remove();
  currentPlayer = null;
}

function renderSource(source) {
  emptyStage.classList.add('hidden');
  sourceStage.classList.remove('hidden');
  projectBadge.textContent = 'Project active';
  projectBadge.classList.add('active-project');

  clearPlayer();
  playerWrap.replaceChildren();

  if (source.kind === 'local-file') {
    const media = document.createElement(source.mediaType === 'video' ? 'video' : 'audio');
    media.controls = true;
    media.preload = 'metadata';
    media.src = source.objectUrl;
    media.className = source.mediaType === 'video' ? 'source-video' : 'source-audio';
    media.setAttribute('aria-label', 'Local media preview');
    playerWrap.append(media);
    currentPlayer = media;
    if (source.mediaType === 'video') {
      const duration = Number(source.duration || 0);
      project.videoEdits = normalizeVideoEdits(project.videoEdits || createVideoEdits(duration), duration);
      setProjectVideoEdits(project, project.videoEdits);
      media.addEventListener('timeupdate', () => {
        updatePlayhead(media.currentTime);
        const edits = currentVideoEdits();
        if (playingSelection && edits && media.currentTime >= edits.trimEnd) {
          media.pause();
          media.currentTime = edits.trimStart;
          playingSelection = false;
        }
      });
      media.addEventListener('seeked', () => updatePlayhead(media.currentTime));
    } else {
      project.videoEdits = null;
      setProjectVideoEdits(project, null);
      const duration = Number(source.duration || 0);
      project.audioEdits = normalizeAudioEdits(project.audioEdits || createAudioEdits(duration), duration);
      setProjectAudioEdits(project, project.audioEdits);
      media.addEventListener('timeupdate', () => {
        updateAudioPlayhead(media.currentTime);
        syncAudioPreviewVolume(media.currentTime);
        const edits = currentAudioEdits();
        if (playingAudioSelection && edits && media.currentTime >= edits.trimEnd) {
          media.pause();
          media.currentTime = edits.trimStart;
          syncAudioPreviewVolume(edits.trimStart);
          playingAudioSelection = false;
        }
      });
      media.addEventListener('seeked', () => {
        updateAudioPlayhead(media.currentTime);
        syncAudioPreviewVolume(media.currentTime);
      });
    }
    sourceName.textContent = source.name;
    const detail = [source.mediaType, String(source.container).toUpperCase(), formatBytes(source.bytes), formatDuration(source.duration)];
    if (source.mediaType === 'video') detail.push(`${source.width}×${source.height}`);
    sourceSummary.textContent = detail.join(' · ');
    sourceNote.textContent = source.warning || 'Loaded locally. No file bytes were uploaded or sent to a backend.';
    statusPrimary.textContent = 'Local media loaded · no upload';
  } else {
    const card = document.createElement('div');
    card.className = 'link-source-card';
    const mark = document.createElement('span');
    mark.textContent = '⌁';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = source.provider + ' link';
    const note = document.createElement('span');
    note.textContent = 'Stored as a local project reference only. Retrieval is not enabled in Step 2.';
    copy.append(title, note);
    card.append(mark, copy);
    playerWrap.append(card);
    sourceName.textContent = source.provider + ' source';
    sourceSummary.textContent = source.url;
    sourceNote.textContent = 'URL validated against the provider allowlist. No network request was made.';
    statusPrimary.textContent = 'Validated link reference · not fetched';
  }

  updateMetadataPanel(source);
  updateVideoEditorVisibility();
  updateAudioEditorVisibility();
  transcriptWorkspace?.onSourceChanged();
  lyricsWorkspace?.onSourceChanged();
  audioVideoWorkspace?.onSourceChanged();
  compilerWorkspace?.onSourceChanged();
  qcWorkspace?.onSourceChanged();
  deliveryWorkspace?.onSourceChanged();
  versionWorkspace?.onSourceChanged();
  if (source.kind === 'local-file' && source.mediaType === 'video') {
    syncVideoControls();
    updatePlayhead(currentPlayer?.currentTime || 0);
  }
  if (source.kind === 'local-file' && source.mediaType === 'audio') {
    syncAudioControls();
    updateAudioPlayhead(currentPlayer?.currentTime || 0);
  }
}

async function handleFile(file) {
  if (!file) return;
  phaseNote.textContent = 'Inspecting file signature and browser-readable metadata locally…';
  const previous = project.source;
  const preserveEdits = previous?.relinkRequired
    && previous.name === file.name
    && Number(previous.bytes) === Number(file.size);
  document.body.classList.add('media-busy');

  try {
    const result = await ingestLocalMedia(file);
    if (!result.ok) {
      phaseNote.textContent = result.reason;
      return;
    }

    if (!preserveEdits) audioVideoWorkspace?.resetForNewSource();
    if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
    if (!preserveEdits) {
      project.videoEdits = null;
      project.audioEdits = null;
      project.transcript = null;
      project.lyrics = null;
      project.audioVideo = null;
      project.compiler = null;
      project.delivery = null;
      project.versions = [];
      project.activeVersionId = null;
      project.baseVersionId = 'original';
      setProjectVideoEdits(project, null);
      setProjectAudioEdits(project, null);
      setProjectTranscript(project, null);
      setProjectLyrics(project, null);
      setProjectAudioVideo(project, null);
      setProjectCompiler(project, null);
      setProjectDelivery(project, null);
      setProjectVersioning(project, { versions: [], activeVersionId: null, baseVersionId: 'original' });
      resetVideoHistory();
      resetAudioHistory();
      transcriptWorkspace?.resetForNewSource();
      lyricsWorkspace?.resetForNewSource();
      compilerWorkspace?.resetForNewSource();
      qcWorkspace?.resetForNewSource();
      deliveryWorkspace?.resetForNewSource();
      versionWorkspace?.resetForNewSource();
    }
    setProjectSource(project, result.source);
    renderSource(result.source);
  } finally {
    document.body.classList.remove('media-busy');
    fileInput.value = '';
  }
}

function openLinkDialog() {
  linkError.textContent = '';
  linkInput.value = '';
  if (typeof linkDialog.showModal === 'function') linkDialog.showModal();
  else linkDialog.setAttribute('open', '');
  linkInput.focus();
}

function closeLinkDialog() {
  if (typeof linkDialog.close === 'function') linkDialog.close();
  else linkDialog.removeAttribute('open');
}

linkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const checked = validateMediaUrl(linkInput.value);
  if (!checked.ok) {
    linkError.textContent = checked.reason;
    return;
  }

  audioVideoWorkspace?.resetForNewSource();
  if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
  project.transcript = null;
  project.lyrics = null;
  project.audioVideo = null;
  project.compiler = null;
  project.delivery = null;
  project.versions = [];
  project.activeVersionId = null;
  project.baseVersionId = 'original';
  setProjectTranscript(project, null);
  setProjectLyrics(project, null);
  setProjectAudioVideo(project, null);
  setProjectCompiler(project, null);
  setProjectDelivery(project, null);
  setProjectVersioning(project, { versions: [], activeVersionId: null, baseVersionId: 'original' });
  transcriptWorkspace?.resetForNewSource();
  lyricsWorkspace?.resetForNewSource();
  compilerWorkspace?.resetForNewSource();
  qcWorkspace?.resetForNewSource();
  deliveryWorkspace?.resetForNewSource();
  versionWorkspace?.resetForNewSource();
  const source = {
    kind: 'provider-link',
    provider: checked.provider,
    url: checked.url,
    name: checked.provider + ' link'
  };
  setProjectSource(project, source);
  renderSource(source);
  closeLinkDialog();
});

document.querySelector('#link-cancel').addEventListener('click', closeLinkDialog);

document.addEventListener('click', (event) => {
  const categoryButton = event.target.closest('[data-category]');
  if (categoryButton) {
    selectCategory(categoryButton.dataset.category);
    return;
  }

  const action = event.target.closest('[data-media-action]');
  if (action) {
    const name = action.dataset.mediaAction;
    if (name === 'upload') fileInput.click();
    if (name === 'paste-link') openLinkDialog();
    if (name === 'open-project') {
      const snapshot = loadMediaProjectSnapshot();
      if (!snapshot?.source) {
        phaseNote.textContent = 'No Media Studio project metadata exists in this browser session yet.';
      } else if (snapshot.source.relinkRequired) {
        phaseNote.textContent = `Project metadata found for ${snapshot.source.name || 'local media'}, but browser security requires the original file to be selected again.`;
      } else {
        phaseNote.textContent = 'A validated link reference exists in this session. Use Paste Link to replace it.';
      }
    }
    return;
  }

  const placeholder = event.target.closest('[data-placeholder-action]');
  if (placeholder) {
    const name = placeholder.dataset.placeholderAction;
    if (name === 'Recipes' || name === 'Use a Recipe') {
      recipeWorkspace?.open();
      return;
    }
    phaseNote.textContent = `${name} is planned for a later phase; this control is not enabled yet.`;
  }
});

audioTrimStartInput.addEventListener('change', () => {
  const current = currentAudioEdits();
  if (!current) return;
  applyAudioPatch({ trimStart: Math.min(Number(audioTrimStartInput.value), current.trimEnd) });
});

audioTrimEndInput.addEventListener('change', () => {
  const current = currentAudioEdits();
  if (!current) return;
  applyAudioPatch({ trimEnd: Math.max(Number(audioTrimEndInput.value), current.trimStart) });
});

audioFadeInInput.addEventListener('change', () => applyAudioPatch({ fadeIn: Number(audioFadeInInput.value) }));
audioFadeOutInput.addEventListener('change', () => applyAudioPatch({ fadeOut: Number(audioFadeOutInput.value) }));

audioVolumeInput.addEventListener('input', () => {
  audioVolumeValue.textContent = audioVolumeInput.value + '%';
  const current = currentAudioEdits();
  if (!current || !currentPlayer) return;
  const preview = updateAudioEdits(current, { volume: Number(audioVolumeInput.value) / 100 }, Number(project.source?.duration || 0));
  currentPlayer.volume = previewVolumeAt(currentPlayer.currentTime, preview, Number(project.source?.duration || 0));
});
audioVolumeInput.addEventListener('change', () => applyAudioPatch({ volume: Number(audioVolumeInput.value) / 100 }));

audioPlayheadInput.addEventListener('input', () => {
  if (!currentPlayer || currentPlayer.tagName !== 'AUDIO') return;
  playingAudioSelection = false;
  currentPlayer.currentTime = Number(audioPlayheadInput.value) || 0;
  updateAudioPlayhead(currentPlayer.currentTime);
  syncAudioPreviewVolume(currentPlayer.currentTime);
});

document.querySelector('#audio-set-in').addEventListener('click', () => {
  const current = currentAudioEdits();
  if (!current || !currentPlayer) return;
  applyAudioPatch({ trimStart: Math.min(currentPlayer.currentTime, current.trimEnd) });
});

document.querySelector('#audio-set-out').addEventListener('click', () => {
  const current = currentAudioEdits();
  if (!current || !currentPlayer) return;
  applyAudioPatch({ trimEnd: Math.max(currentPlayer.currentTime, current.trimStart) });
});

document.querySelector('#audio-play-selection').addEventListener('click', async () => {
  const edits = currentAudioEdits();
  if (!edits || !currentPlayer) return;
  currentPlayer.currentTime = edits.trimStart;
  syncAudioPreviewVolume(edits.trimStart);
  playingAudioSelection = true;
  try {
    await currentPlayer.play();
  } catch {
    playingAudioSelection = false;
    sourceNote.textContent = 'The browser blocked playback. Press the native play control once, then retry the selection.';
  }
});

document.querySelector('#audio-reset-edits').addEventListener('click', () => {
  const duration = Number(project.source?.duration || 0);
  recordAudioEdit(createAudioEdits(duration));
});

audioUndoButton.addEventListener('click', () => {
  const current = currentAudioEdits();
  const previous = audioHistory.pop();
  if (!current || !previous) return;
  audioFuture.push(current);
  restoreAudioEdit(previous);
});

audioRedoButton.addEventListener('click', () => {
  const current = currentAudioEdits();
  const next = audioFuture.pop();
  if (!current || !next) return;
  audioHistory.push(current);
  restoreAudioEdit(next);
});

trimStartInput.addEventListener('change', () => {
  const current = currentVideoEdits();
  if (!current) return;
  const requested = Number(trimStartInput.value);
  const safe = Math.min(requested, current.trimEnd);
  applyVideoPatch({ trimStart: safe });
});

trimEndInput.addEventListener('change', () => {
  const current = currentVideoEdits();
  if (!current) return;
  const requested = Number(trimEndInput.value);
  const safe = Math.max(requested, current.trimStart);
  applyVideoPatch({ trimEnd: safe });
});

playbackRateSelect.addEventListener('change', () => {
  applyVideoPatch({ playbackRate: Number(playbackRateSelect.value) });
});

videoMuteInput.addEventListener('change', () => {
  applyVideoPatch({ muted: videoMuteInput.checked });
});

playheadInput.addEventListener('input', () => {
  if (!currentPlayer || currentPlayer.tagName !== 'VIDEO') return;
  playingSelection = false;
  currentPlayer.currentTime = Number(playheadInput.value) || 0;
  updatePlayhead(currentPlayer.currentTime);
});

document.querySelector('#video-set-in').addEventListener('click', () => {
  const current = currentVideoEdits();
  if (!current || !currentPlayer) return;
  applyVideoPatch({ trimStart: Math.min(currentPlayer.currentTime, current.trimEnd) });
});

document.querySelector('#video-set-out').addEventListener('click', () => {
  const current = currentVideoEdits();
  if (!current || !currentPlayer) return;
  applyVideoPatch({ trimEnd: Math.max(currentPlayer.currentTime, current.trimStart) });
});

document.querySelector('#video-play-selection').addEventListener('click', async () => {
  const edits = currentVideoEdits();
  if (!edits || !currentPlayer) return;
  currentPlayer.currentTime = edits.trimStart;
  playingSelection = true;
  try {
    await currentPlayer.play();
  } catch {
    playingSelection = false;
    sourceNote.textContent = 'The browser blocked playback. Press the native play control once, then retry the selection.';
  }
});

document.querySelector('#video-reset-edits').addEventListener('click', () => {
  const duration = Number(project.source?.duration || 0);
  recordVideoEdit(createVideoEdits(duration));
});

undoButton.addEventListener('click', () => {
  const current = currentVideoEdits();
  const previous = videoHistory.pop();
  if (!current || !previous) return;
  videoFuture.push(current);
  restoreVideoEdit(previous);
});

redoButton.addEventListener('click', () => {
  const current = currentVideoEdits();
  const next = videoFuture.pop();
  if (!current || !next) return;
  videoHistory.push(current);
  restoreVideoEdit(next);
});

fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));

sourceStage.addEventListener('dragover', (event) => {
  event.preventDefault();
  sourceStage.classList.add('dragging');
});
sourceStage.addEventListener('dragleave', () => sourceStage.classList.remove('dragging'));
sourceStage.addEventListener('drop', (event) => {
  event.preventDefault();
  sourceStage.classList.remove('dragging');
  handleFile(event.dataTransfer?.files?.[0]);
});
emptyStage.addEventListener('dragover', (event) => {
  event.preventDefault();
  emptyStage.classList.add('dragging');
});
emptyStage.addEventListener('dragleave', () => emptyStage.classList.remove('dragging'));
emptyStage.addEventListener('drop', (event) => {
  event.preventDefault();
  emptyStage.classList.remove('dragging');
  handleFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener('pagehide', () => {
  versionWorkspace?.destroy();
  audioVideoWorkspace?.destroy();
  clearPlayer();
  if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
});

versionWorkspace = initVersionWorkspace({
  getProject: () => project,
  getSource: () => project.source,
  getPlayer: () => currentPlayer,
  getVideoEdits: () => currentVideoEdits(),
  getAudioEdits: () => currentAudioEdits(),
  saveVersioning: (versioning) => {
    project.versions = versioning.versions;
    project.activeVersionId = versioning.activeVersionId;
    project.baseVersionId = versioning.baseVersionId;
    setProjectVersioning(project, versioning);
  },
  setStatus: (message) => {
    commandMessage.textContent = message;
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

deliveryWorkspace = initDeliveryWorkspace({
  getProject: () => project,
  getPlayer: () => currentPlayer,
  getSource: () => project.source,
  saveDelivery: (delivery) => {
    project.delivery = delivery;
    setProjectDelivery(project, delivery);
  },
  saveAudioVideo: (config) => {
    project.audioVideo = config;
    setProjectAudioVideo(project, config);
  },
  openCategory: (id) => selectCategory(id),
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

qcWorkspace = initQcWorkspace({
  getProject: () => project,
  getSource: () => project.source,
  saveTranscript: (transcript) => {
    project.transcript = transcript;
    setProjectTranscript(project, transcript);
  },
  saveVideoEdits: (videoEdits) => {
    project.videoEdits = videoEdits;
    setProjectVideoEdits(project, videoEdits);
    syncVideoControls();
  },
  saveAudioEdits: (audioEdits) => {
    project.audioEdits = audioEdits;
    setProjectAudioEdits(project, audioEdits);
    syncAudioControls();
  },
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

compilerWorkspace = initCompilerWorkspace({
  getProject: () => project,
  getSource: () => project.source,
  saveCompiler: (compiler) => {
    project.compiler = compiler;
    setProjectCompiler(project, compiler);
  },
  saveAudioVideo: (config) => {
    project.audioVideo = config;
    setProjectAudioVideo(project, config);
  },
  openCategory: (id) => selectCategory(id),
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

audioVideoWorkspace = initAudioVideoWorkspace({
  getProject: () => project,
  getPlayer: () => currentPlayer,
  getSource: () => project.source,
  saveConfig: (config) => {
    project.audioVideo = config;
    setProjectAudioVideo(project, config);
  },
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

lyricsWorkspace = initLyricsWorkspace({
  getProject: () => project,
  getPlayer: () => currentPlayer,
  getSource: () => project.source,
  saveLyrics: (lyrics) => {
    project.lyrics = lyrics;
    setProjectLyrics(project, lyrics);
  },
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

transcriptWorkspace = initTranscriptWorkspace({
  getProject: () => project,
  getPlayer: () => currentPlayer,
  getSource: () => project.source,
  saveTranscript: (transcript) => {
    project.transcript = transcript;
    setProjectTranscript(project, transcript);
  },
  setStatus: (message) => {
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

commandAssistant = initCommandAssistant({
  getProject: () => project,
  onSaveRecipe: (actions, context) => recipeWorkspace?.openSave(actions, context),
  executeAction: async (item) => {
    const duration = Number(project.source?.duration || 0);

    if (item.type === 'open-category') {
      selectCategory(item.params.category);
      return { ok: true };
    }

    if (item.type === 'trim') {
      const start = Number(item.params.start);
      const end = Number(item.params.end);
      if (!project.source || project.source.kind !== 'local-file') return { ok: false, reason: 'Trim requires a relinked local source.' };

      if (project.source.mediaType === 'video') {
        const current = currentVideoEdits();
        if (!current) return { ok: false, reason: 'Video trim state is unavailable.' };
        recordVideoEdit(updateVideoEdits(current, { trimStart: start, trimEnd: end }, duration));
        return { ok: true };
      }

      if (project.source.mediaType === 'audio') {
        const current = currentAudioEdits();
        if (!current) return { ok: false, reason: 'Audio trim state is unavailable.' };
        recordAudioEdit(updateAudioEdits(current, { trimStart: start, trimEnd: end }, duration));
        return { ok: true };
      }

      return { ok: false, reason: 'Unsupported media type for trim.' };
    }

    if (item.type === 'volume') {
      const current = currentAudioEdits();
      if (!current) return { ok: false, reason: 'Volume command requires local audio.' };
      recordAudioEdit(updateAudioEdits(current, { volume: Number(item.params.percent) / 100 }, duration));
      return { ok: true };
    }

    if (item.type === 'fade-in' || item.type === 'fade-out') {
      const current = currentAudioEdits();
      if (!current) return { ok: false, reason: 'Fade command requires local audio.' };
      const key = item.type === 'fade-in' ? 'fadeIn' : 'fadeOut';
      recordAudioEdit(updateAudioEdits(current, { [key]: Number(item.params.seconds) }, duration));
      return { ok: true };
    }

    if (item.type === 'set-aspect') {
      if (!audioVideoWorkspace) return { ok: false, reason: 'Audio → Video workspace is unavailable.' };
      audioVideoWorkspace.setAspect(item.params.aspect);
      selectCategory('audio-video');
      return { ok: true };
    }

    if (item.type === 'run-qc') {
      selectCategory('qc');
      qcWorkspace.run('QC report run by Command Assistant.');
      return { ok: true };
    }

    if (item.type === 'apply-qc-fixes') {
      selectCategory('qc');
      qcWorkspace.applySafeFixes();
      return { ok: true };
    }

    return { ok: false, reason: `Unsupported command action: ${item.type}` };
  },
  setStatus: (message) => {
    commandMessage.textContent = message;
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

recipeWorkspace = initRecipeWorkspace({
  loadCommandPlan: (actions, context) => commandAssistant.loadPlan(actions, context),
  setStatus: (message) => {
    commandMessage.textContent = message;
    if (sourceNote && !sourceStage.classList.contains('hidden')) sourceNote.textContent = message;
  }
});

selectCategory(project.activeCategory || 'video');
transcriptWorkspace.onSourceChanged();
lyricsWorkspace.onSourceChanged();
audioVideoWorkspace.onSourceChanged();
compilerWorkspace.onSourceChanged();
qcWorkspace.onSourceChanged();
deliveryWorkspace.onSourceChanged();
versionWorkspace.onSourceChanged();

if (restored?.source?.kind === 'provider-link') {
  renderSource(restored.source);
} else if (restored?.source?.relinkRequired) {
  projectBadge.textContent = 'Relink required';
  phaseNote.textContent = `Previous session metadata found for ${restored.source.name || 'local media'}. Select the original file again to relink it securely.`;
}
