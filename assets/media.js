import { ingestLocalMedia, releaseMediaSource, validateMediaUrl } from '/lib/media/ingest.js';
import { createMediaProject, loadMediaProjectSnapshot, setProjectCategory, setProjectSource } from '/lib/media/project.js';

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
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
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
const restored = loadMediaProjectSnapshot();
const project = createMediaProject();
let currentPlayer = null;

if (restored) {
  project.id = restored.id || project.id;
  project.createdAt = restored.createdAt || project.createdAt;
  project.updatedAt = restored.updatedAt || project.updatedAt;
  project.activeCategory = restored.activeCategory || project.activeCategory;
  project.source = restored.source || null;
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
}

async function handleFile(file) {
  if (!file) return;
  phaseNote.textContent = 'Inspecting file signature and browser-readable metadata locally…';
  document.body.classList.add('media-busy');

  try {
    const result = await ingestLocalMedia(file);
    if (!result.ok) {
      phaseNote.textContent = result.reason;
      return;
    }

    if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
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

  if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
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
    phaseNote.textContent = `${name} is planned for a later phase; Step 2 only adds secure source ingestion and shared project state.`;
  }
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

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!commandInput.value.trim()) {
    commandMessage.textContent = 'Enter an outcome first. No command has been executed.';
    return;
  }
  commandMessage.textContent = 'Command planning is a later phase. Nothing was processed.';
});

window.addEventListener('pagehide', () => {
  clearPlayer();
  if (project.source?.kind === 'local-file') releaseMediaSource(project.source);
});

selectCategory(project.activeCategory || 'video');

if (restored?.source?.kind === 'provider-link') {
  renderSource(restored.source);
} else if (restored?.source?.relinkRequired) {
  projectBadge.textContent = 'Relink required';
  phaseNote.textContent = `Previous session metadata found for ${restored.source.name || 'local media'}. Select the original file again to relink it securely.`;
}
