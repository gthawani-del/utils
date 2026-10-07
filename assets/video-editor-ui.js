// Dedicated Video Editor presentation. Existing Media Studio processing modules remain unchanged.
const $ = selector => document.querySelector(selector);
const root = $('.workspace-main');
const stage = $('#source-stage');
const empty = $('#video-empty-workspace');
const timeline = $('.timeline-shell');
const inspector = $('#video-editor-panel');
if (!root || !stage || !timeline || !inspector) throw new Error('Video Editor workspace is incomplete');

const shell = document.createElement('div');
shell.className = 'studio-v2-root';
shell.innerHTML = `
  <header class="studio-v2-header">
    <a href="/media" class="studio-v2-back" aria-label="Back to Media Studio">‹</a>
    <div class="studio-v2-heading"><strong>Video Editor</strong><span>Local editing workspace</span></div>
    <button type="button" class="studio-v2-header-button" id="studio-v2-import">+ Add</button>
    <button type="button" class="studio-v2-export" id="studio-v2-export">Export</button>
  </header>
  <p class="studio-v2-preview-error" id="studio-v2-preview-error" role="status"></p>
  <div class="studio-v2-layout">
    <aside class="studio-v2-library">
      <h3>Project media</h3><p>Imported clips and source media</p>
      <button type="button" id="studio-v2-add-clips">+ Add video clips</button>
      <div id="studio-v2-library-list" aria-live="polite">Import a video to begin.</div>
    </aside>
    <div class="studio-v2-main">
      <section class="studio-v2-preview" aria-label="Video preview"></section>
      <div class="studio-v2-transport">
        <span id="studio-v2-time">00:00 / 00:00</span>
        <div class="studio-v2-transport-buttons">
          <button type="button" id="studio-v2-backward" aria-label="Back five seconds">|◀</button>
          <button type="button" id="studio-v2-play" aria-label="Play or pause">▶</button>
          <button type="button" id="studio-v2-forward" aria-label="Forward five seconds">▶|</button>
          <button type="button" id="studio-v3-fullscreen" aria-label="Fullscreen preview">⛶</button>
        </div>
      </div>
      <section class="studio-v2-timeline" aria-label="Video timeline"></section>
      <div class="studio-v3-edit-actions"><button type="button" id="studio-v3-undo" aria-label="Undo edit">↶ Undo</button><button type="button" id="studio-v3-redo" aria-label="Redo edit">↷ Redo</button><button type="button" id="studio-v3-split">Split</button><button type="button" id="studio-v3-delete">Delete</button></div>
      <section class="studio-v2-tools" aria-label="Editing tools">
        <h3>Editing tools</h3>
        <div class="studio-v2-tool-grid">
          <button type="button" data-studio-tool="edit"><span aria-hidden="true">✂</span>Edit</button>
          <button type="button" data-studio-tool="kinetic"><span aria-hidden="true">T</span>Kinetic Text</button>
          <button type="button" data-studio-tool="captions"><span aria-hidden="true">▤</span>Captions</button>
          <button type="button" data-studio-tool="audio"><span aria-hidden="true">♫</span>Audio</button>
          <button type="button" data-studio-tool="effects"><span aria-hidden="true">✧</span>Effects</button>
          <button type="button" data-studio-tool="adjust"><span aria-hidden="true">☷</span>Adjust</button>
          <button type="button" data-studio-tool="reframe"><span aria-hidden="true">⛶</span>Reframe</button>
          <button type="button" data-studio-tool="more"><span aria-hidden="true">•••</span>More</button>
        </div>
      </section>
    </div>
    <aside class="studio-v2-inspector" id="studio-v2-inspector" aria-label="Editing controls">
      <div class="studio-v2-inspector-head"><strong id="studio-v2-inspector-title">Edit clip</strong><div class="studio-v3-sheet-actions"><button type="button" id="studio-v3-cancel">Close</button><button type="button" id="studio-v3-apply">Done</button><button type="button" id="studio-v2-close" aria-label="Close editing controls">×</button></div></div>
    </aside>
  </div>`;
root.append(shell);
const preview = $('.studio-v2-preview');
preview.append(empty, stage);
$('.studio-v2-timeline').append(timeline);
$('.studio-v2-inspector').append(inspector);
const timelineDisplay = document.createElement('div');
timelineDisplay.className = 'studio-v2-track-system';
timelineDisplay.innerHTML = `
  <div class="studio-v2-track"><span>Text</span><div class="studio-v2-track-content" id="studio-v2-text-track"></div></div>
  <div class="studio-v2-track"><span>Video</span><div class="studio-v2-track-content studio-v2-video-track" id="studio-v2-video-track"><span>Import clips to populate timeline</span></div></div>
  <div class="studio-v2-track"><span>Audio</span><div class="studio-v2-track-content studio-v2-audio-track" id="studio-v2-audio-track"><span>Audio waveform available after import</span></div></div>
  <div class="studio-v3-timeline-control"><label class="studio-v2-seek-label"><span class="studio-v2-visually-hidden">Timeline playhead</span><input id="studio-v2-seek" type="range" min="0" max="1000" value="0" aria-label="Scrub video timeline"></label><div class="studio-v3-zoom"><button type="button" id="studio-v3-zoom-out" aria-label="Zoom out timeline">−</button><span id="studio-v3-zoom-label">100%</span><button type="button" id="studio-v3-zoom-in" aria-label="Zoom in timeline">+</button></div></div>
  <div class="studio-v2-segments" id="studio-v2-segments" aria-label="Clip sequence"></div>`;
timeline.append(timelineDisplay);

const showPanel = (tab, title, focusSelector) => {
  document.querySelector('[data-video-tool="' + tab + '"]')?.click();
  $('#studio-v2-inspector-title').textContent = title;
  shell.dataset.activeTool = currentTool;
  shell.classList.add('studio-v2-inspector-open');
  const inspectorBody = $('#studio-v2-inspector');
  inspectorBody.scrollTop = 0;
  document.querySelectorAll('[data-studio-tool]').forEach(button => button.classList.toggle('active', button.dataset.studioTool === currentTool));
  // A single contextual tool remains visible; never scroll the whole editor.
};
let currentTool = 'edit';
const toolTargets = {
  edit: ['edit', 'Edit clip', '.video-segments'],
  kinetic: ['text', 'Kinetic typography', '.video-kinetic-panel'],
  captions: ['text', 'Captions & word timing', '.video-word-editor'],
  audio: ['edit', 'Audio & silence', '.video-smart-panel'],
  effects: ['export', 'Motion effects', '.video-repair-controls'],
  adjust: ['export', 'Color & audio adjustment', '.video-repair-controls'],
  reframe: ['export', 'Smooth & Match', '.video-export-grid'],
  more: ['edit', 'Quick fixes', '.video-smart-panel']
};
document.querySelectorAll('[data-studio-tool]').forEach(button => button.addEventListener('click', () => {
  currentTool = button.dataset.studioTool;
  const [tab, title, focus] = toolTargets[currentTool];
  showPanel(tab, title, focus);
}));
$('#studio-v2-close').addEventListener('click', () => shell.classList.remove('studio-v2-inspector-open'));
const closeTool = () => shell.classList.remove('studio-v2-inspector-open');
$('#studio-v3-apply').addEventListener('click', closeTool);
$('#studio-v3-cancel').addEventListener('click', closeTool);
for (const [id, source] of [['studio-v3-undo','#video-undo'],['studio-v3-redo','#video-redo'],['studio-v3-split','#video-split'],['studio-v3-delete','#video-delete-segment']]) {
  $('#' + id).addEventListener('click', () => {
    const target = $(source);
    if (target && !target.disabled) target.click();
  });
}

document.addEventListener('keydown', event => { if (event.key === 'Escape') shell.classList.remove('studio-v2-inspector-open'); });
$('#studio-v2-export').addEventListener('click', () => {
  currentTool = 'reframe';
  showPanel('export', 'Export video', '.video-export-panel');
});
$('#studio-v2-import').addEventListener('click', () => $('#media-file-input')?.click());
$('#studio-v2-add-clips').addEventListener('click', () => {
  const target = $('#video-add-clips-input');
  if (target) target.click();
});
const player = () => $('#source-player-wrap video');
$('#studio-v3-fullscreen').addEventListener('click', async () => {
  const video = player();
  if (!video) return;
  try { if (typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen(); else if (video.requestFullscreen) await video.requestFullscreen(); } catch { /* unsupported on this device */ }
});
function syncPreview() {
  const video = player();
  if (!video) return;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'auto';
  video.style.display = 'block';
  video.style.visibility = 'visible';
  video.style.opacity = '1';
  if (video.readyState === 0) video.load();
  const revealFirstFrame = () => {
    if (video.paused && video.readyState >= 2 && video.currentTime === 0 && video.duration > .1) {
      try { video.currentTime = Math.min(.05, video.duration / 2); } catch { /* preserve native playback */ }
    }
    update();
  };
  video.addEventListener('loadeddata', revealFirstFrame, { once: true });
  video.addEventListener('loadedmetadata', update, { once: true });
  video.addEventListener('loadeddata', () => { const status = $('#studio-v2-preview-error'); if (status) status.textContent = ''; }, { once: true });
  video.addEventListener('error', () => {
    const status = $('#studio-v2-preview-error');
    if (status) status.textContent = 'Preview cannot decode this file. Try an H.264 MP4 or WebM.';
  }, { once: true });
  if (video.readyState >= 2) revealFirstFrame();
}

let timelineZoom = 1;
function setTimelineZoom(value) {
  timelineZoom = Math.max(1, Math.min(4, value));
  $('#studio-v3-zoom-label').textContent = Math.round(timelineZoom * 100) + '%';
  $('#studio-v2-video-track').style.setProperty('--timeline-zoom', String(timelineZoom));
  $('#studio-v2-audio-track').style.setProperty('--timeline-zoom', String(timelineZoom));
}
$('#studio-v2-audio-track').addEventListener('click', () => { currentTool = 'audio'; showPanel('edit', 'Audio & silence', '.video-smart-panel'); });
$('#studio-v3-zoom-in').addEventListener('click', () => setTimelineZoom(timelineZoom + .5));
$('#studio-v3-zoom-out').addEventListener('click', () => setTimelineZoom(timelineZoom - .5));
let touchDistance = null;
$('#studio-v2-video-track').addEventListener('touchstart', event => {
  if (event.touches.length === 2) touchDistance = Math.abs(event.touches[0].clientX - event.touches[1].clientX);
}, { passive: true });
$('#studio-v2-video-track').addEventListener('touchend', event => {
  if (event.touches.length < 2) touchDistance = null;
}, { passive: true });
$('#studio-v2-video-track').addEventListener('touchmove', event => {
  if (event.touches.length !== 2 || touchDistance === null) return;
  const distance = Math.abs(event.touches[0].clientX - event.touches[1].clientX);
  if (Math.abs(distance - touchDistance) > 24) {
    setTimelineZoom(timelineZoom + (distance > touchDistance ? .25 : -.25));
    touchDistance = distance;
  }
}, { passive: true });
$('#studio-v2-seek').addEventListener('input', event => {
  const video = player();
  if (video && Number.isFinite(video.duration)) video.currentTime = Number(event.target.value) / 1000 * video.duration;
});
$('#studio-v2-play').addEventListener('click', () => {
  const video = player();
  if (!video) { $('#media-file-input')?.click(); return; }
  if (video.paused) video.play().catch(() => {}); else video.pause();
});
for (const [id, delta] of [['studio-v2-backward', -5], ['studio-v2-forward', 5]]) {
  $('#' + id).addEventListener('click', () => {
    const video = player();
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  });
}
function clock(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}
let lastSource = '';
let thumbGeneration = 0;
async function buildThumbnails(url) {
  const generation = ++thumbGeneration;
  const target = $('#studio-v2-video-track');
  target.replaceChildren();
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true; video.src = url;
  const loaded = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 8000);
    video.onloadedmetadata = () => { clearTimeout(timer); resolve(true); };
    video.onerror = () => { clearTimeout(timer); resolve(false); };
    video.load();
  });
  if (!loaded || !Number.isFinite(video.duration) || generation !== thumbGeneration) {
    target.textContent = 'Video timeline'; video.removeAttribute('src'); video.load(); return;
  }
  const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 56;
  const ctx = canvas.getContext('2d');
  const count = Math.min(8, Math.max(1, Math.ceil(video.duration / 4)));
  for (let i = 0; i < count && generation === thumbGeneration; i++) {
    const time = Math.min(Math.max(0, video.duration - 0.08), video.duration * (i + .5) / count);
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1800);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = time;
    });
    const image = document.createElement('button');
    image.type = 'button'; image.className = 'studio-v2-thumb';
    image.setAttribute('aria-label', 'Seek to ' + clock(time));
    if (ctx && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const picture = document.createElement('img'); picture.alt = ''; picture.src = canvas.toDataURL('image/jpeg', .65); image.append(picture);
    } else image.textContent = clock(time);
    image.addEventListener('click', () => { if (player()) player().currentTime = time; });
    target.append(image);
  }
  video.pause(); video.removeAttribute('src'); video.load();
}
function update() {
  const video = player();
  const ready = !!video && video.readyState >= 1;
  const play = $('#studio-v2-play');
  play.textContent = ready && !video.paused ? 'Ⅱ' : '▶';
  $('#studio-v2-time').textContent = ready ? clock(video.currentTime) + ' / ' + clock(video.duration) : '00:00 / 00:00';
  $('#studio-v2-seek').value = ready && video.duration ? String(Math.round(video.currentTime / video.duration * 1000)) : '0';
  for (const [id, source] of [['studio-v3-undo','#video-undo'],['studio-v3-redo','#video-redo'],['studio-v3-split','#video-split'],['studio-v3-delete','#video-delete-segment']]) { const button = $('#' + id), target = $(source); if (button && target) button.disabled = target.disabled; }
  const source = ready ? video.currentSrc || video.src : '';
  if (source !== lastSource) {
    lastSource = source;
    if (source) { syncPreview(); buildThumbnails(source); }
    else $('#studio-v2-video-track').textContent = 'Import clips to populate timeline';
  }
  const list = $('#video-segment-list');
  const library = $('#studio-v2-library-list');
  if (list && library && library.dataset.lastMarkup !== list.textContent) {
    library.dataset.lastMarkup = list.textContent;
    library.textContent = list.textContent || 'Import a video to begin.';
    const strip = $('#studio-v2-segments');
    strip.replaceChildren();
    for (const sourceButton of list.querySelectorAll('.video-segment-item')) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = sourceButton.textContent;
      button.addEventListener('click', () => { sourceButton.click(); currentTool = 'edit'; showPanel('edit', 'Edit clip', '.video-segments'); });
      button.setAttribute('draggable', 'true');
      button.addEventListener('dragstart', event => { event.dataTransfer?.setData('text/plain', String([...strip.children].indexOf(button))); });
      button.addEventListener('dragover', event => event.preventDefault());
      button.addEventListener('drop', event => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData('text/plain'));
        const to = [...strip.children].indexOf(button);
        if (!Number.isInteger(from) || from === to) return;
        const original = [...list.querySelectorAll('.video-segment-item')];
        original[from]?.click();
        const direction = from < to ? '#video-move-right' : '#video-move-left';
        const steps = Math.abs(to - from);
        for (let n = 0; n < steps; n++) { const move = $(direction); if (!move || move.disabled) break; move.click(); }
      });
      strip.append(button);
    }
  }
  const captions = $('#studio-v2-text-track');
  if (captions) {
    const labels = [...document.querySelectorAll('.video-kinetic-row span')].map(node => node.textContent);
    const key = labels.join(' | ');
    if (captions.dataset.key !== key) {
      captions.dataset.key = key;
      captions.replaceChildren();
      for (const label of labels.slice(0, 8)) {
        const span = document.createElement('button'); span.type = 'button'; span.className = 'studio-v2-caption-chip'; span.textContent = label;
        span.addEventListener('click', () => { currentTool = 'kinetic'; showPanel('text', 'Edit text & motion', '.video-kinetic-panel'); });
        captions.append(span);
      }
    }
  }
}
const observer = new MutationObserver(() => { syncPreview(); update(); });
observer.observe($('#source-player-wrap'), { childList: true });
observer.observe($('#video-segment-list'), { childList: true });
document.addEventListener('timeupdate', event => { if (event.target === player()) update(); }, true);
document.addEventListener('play', event => { if (event.target === player()) update(); }, true);
document.addEventListener('pause', event => { if (event.target === player()) update(); }, true);
update();

const input = $('#media-file-input');
input?.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file || file.size > 20 * 1024 * 1024 || !file.type.startsWith('video/')) return;
  let context;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    context = new Context();
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    const samples = audio.getChannelData(0);
    const count = 72;
    const values = [];
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * samples.length / count);
      const end = Math.floor((i + 1) * samples.length / count);
      let sum = 0;
      for (let j = start; j < end; j += 12) sum += samples[j] * samples[j];
      values.push(Math.min(1, Math.sqrt(sum / Math.max(1, Math.ceil((end - start) / 12))) * 3));
    }
    const track = $('#studio-v2-audio-track');
    track.replaceChildren();
    for (const value of values) {
      const bar = document.createElement('span');
      bar.className = 'studio-v2-wave-bar';
      bar.style.height = Math.max(3, Math.round(value * 28)) + 'px';
      track.append(bar);
    }
  } catch {
    $('#studio-v2-audio-track').textContent = 'Audio track · waveform preview unavailable on this device';
  } finally { await context?.close().catch(() => {}); }
});
