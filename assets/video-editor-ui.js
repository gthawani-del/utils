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
        </div>
      </div>
      <section class="studio-v2-timeline" aria-label="Video timeline"></section>
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
      <div class="studio-v2-inspector-head"><strong id="studio-v2-inspector-title">Edit clip</strong><button type="button" id="studio-v2-close" aria-label="Close editing controls">×</button></div>
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
  <div class="studio-v2-track"><span>Audio</span><div class="studio-v2-track-content studio-v2-audio-track" id="studio-v2-audio-track"></div></div>`;
timeline.append(timelineDisplay);

const showPanel = (tab, title, focusSelector) => {
  document.querySelector('[data-video-tool="' + tab + '"]')?.click();
  $('#studio-v2-inspector-title').textContent = title;
  shell.classList.add('studio-v2-inspector-open');
  document.querySelectorAll('[data-studio-tool]').forEach(button => button.classList.toggle('active', button.dataset.studioTool === currentTool));
  if (focusSelector) requestAnimationFrame(() => $(focusSelector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
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
  const ready = !!video;
  const play = $('#studio-v2-play');
  play.textContent = ready && !video.paused ? 'Ⅱ' : '▶';
  $('#studio-v2-time').textContent = ready ? clock(video.currentTime) + ' / ' + clock(video.duration) : '00:00 / 00:00';
  const source = ready ? video.currentSrc || video.src : '';
  if (source !== lastSource) {
    lastSource = source;
    if (source) buildThumbnails(source);
    else $('#studio-v2-video-track').textContent = 'Import clips to populate timeline';
  }
  const list = $('#video-segment-list');
  const library = $('#studio-v2-library-list');
  if (list && library && library.dataset.lastMarkup !== list.textContent) {
    library.dataset.lastMarkup = list.textContent;
    library.textContent = list.textContent || 'Import a video to begin.';
  }
  const captions = $('#studio-v2-text-track');
  if (captions) {
    const labels = [...document.querySelectorAll('.video-kinetic-row span')].map(node => node.textContent);
    const key = labels.join(' | ');
    if (captions.dataset.key !== key) {
      captions.dataset.key = key;
      captions.replaceChildren();
      for (const label of labels.slice(0, 8)) {
        const span = document.createElement('span'); span.className = 'studio-v2-caption-chip'; span.textContent = label; captions.append(span);
      }
    }
  }
}
const observer = new MutationObserver(update);
observer.observe($('#source-player-wrap'), { childList: true });
observer.observe($('#video-segment-list'), { childList: true });
document.addEventListener('timeupdate', event => { if (event.target === player()) update(); }, true);
document.addEventListener('play', event => { if (event.target === player()) update(); }, true);
document.addEventListener('pause', event => { if (event.target === player()) update(); }, true);
update();
