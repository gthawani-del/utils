import { SECURITY_BUDGET, validateBatchBudget, validateFileBudget } from '/lib/security/budget.js';
import { exportFilename } from '/lib/security/filename.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { trackObjectUrl, revokeObjectUrl, clearWorkspace } from '/lib/security/workspace.js';
import { IMAGE_PRESETS } from '/lib/image/presets.js';

const workerUrl = new URL('/workers/image.worker.js', location.origin);
const runner = new WorkerRunner(workerUrl);
const state = { items: [], selectedId: null, busy: false };
const $ = (selector) => document.querySelector(selector);
const els = {
  input: $('#file-input'), choose: $('#choose-files'), add: $('#add-more'), drop: $('#drop-zone'), workspace: $('#workspace'), list: $('#file-list'), count: $('#file-count'),
  originalPreview: $('#original-preview'), outputPreview: $('#output-preview'), originalStats: $('#original-stats'), outputStats: $('#output-stats'), metadata: $('#metadata-box'),
  compatibility: $('#compatibility'), preset: $('#preset'), resizeMode: $('#resize-mode'), width: $('#width'), height: $('#height'), percentage: $('#percentage'), longest: $('#longest-edge'), shortest: $('#shortest-edge'),
  percentageWrap: $('#percentage-wrap'), longestWrap: $('#longest-wrap'), shortestWrap: $('#shortest-wrap'), preserveAspect: $('#preserve-aspect'), cropMode: $('#crop-mode'), customRatio: $('#custom-ratio'), customRatioWrap: $('#custom-ratio-wrap'), freeCrop: $('#free-crop'),
  cropX: $('#crop-x'), cropY: $('#crop-y'), cropWidth: $('#crop-width'), cropHeight: $('#crop-height'), format: $('#format'), quality: $('#quality'), qualityValue: $('#quality-value'), targetSize: $('#target-size'), background: $('#background'), rotate: $('#rotate'), flipX: $('#flip-x'), flipY: $('#flip-y'),
  prefix: $('#prefix'), suffix: $('#suffix'), preserveName: $('#preserve-name'), reset: $('#reset-settings'), processSelected: $('#process-selected'), processAll: $('#process-all'), downloadSelected: $('#download-selected'), downloadAll: $('#download-all'), clear: $('#clear-workspace'), jpegWarning: $('#jpeg-warning'), upscaleWarning: $('#upscale-warning')
};

initialize();

function initialize() {
  if (!('Worker' in window) || !('OffscreenCanvas' in window) || !('createImageBitmap' in window)) {
    els.compatibility.textContent = 'This browser does not provide the isolated image-processing primitives required by Image Studio. Processing is disabled rather than falling back to unsafe or misleading behavior.';
    els.compatibility.classList.remove('hidden');
    els.choose.disabled = true;
  }
  for (const preset of IMAGE_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id; option.textContent = `${preset.label} · ${preset.width}×${preset.height}`;
    els.preset.append(option);
  }
  wireEvents();
  updateConditionalControls();
}

function wireEvents() {
  els.choose.addEventListener('click', () => els.input.click());
  els.add.addEventListener('click', () => els.input.click());
  els.input.addEventListener('change', () => addFiles([...els.input.files]));
  for (const type of ['dragenter', 'dragover']) els.drop.addEventListener(type, (event) => { event.preventDefault(); els.drop.classList.add('dragging'); });
  for (const type of ['dragleave', 'drop']) els.drop.addEventListener(type, (event) => { event.preventDefault(); els.drop.classList.remove('dragging'); });
  els.drop.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));
  els.preset.addEventListener('change', applyPreset);
  els.resizeMode.addEventListener('change', () => { updateConditionalControls(); updateWarnings(); });
  els.cropMode.addEventListener('change', updateConditionalControls);
  els.format.addEventListener('change', () => { updateWarnings(); els.targetSize.disabled = els.format.value === 'png'; });
  els.quality.addEventListener('input', () => { els.qualityValue.textContent = els.quality.value; });
  for (const el of [els.width, els.height, els.percentage, els.longest, els.shortest]) el.addEventListener('input', updateWarnings);
  els.reset.addEventListener('click', resetToOriginal);
  els.processSelected.addEventListener('click', processSelected);
  els.processAll.addEventListener('click', processAll);
  els.downloadSelected.addEventListener('click', downloadSelected);
  els.downloadAll.addEventListener('click', downloadAll);
  els.clear.addEventListener('click', clearAll);
  window.addEventListener('pagehide', cleanupUrls);
}

async function addFiles(files) {
  if (!files.length || state.busy) return;
  const combined = [...state.items.map((item) => item.file), ...files];
  const batchCheck = validateBatchBudget(combined);
  if (!batchCheck.ok) return showCompatibility(batchCheck.reason);
  for (const file of files) {
    const budget = validateFileBudget(file);
    if (!budget.ok) {
      state.items.push(makeRejectedItem(file, budget.reason));
      continue;
    }
    const item = { id: crypto.randomUUID(), file, status: 'inspecting', inspect: null, error: '', originalUrl: '', outputBlob: null, outputUrl: '', outputName: '' };
    state.items.push(item);
    renderList();
    try {
      const buffer = await file.arrayBuffer();
      const result = await runner.run({ op: 'inspect', buffer }, [buffer]);
      if (result.state === 'completed') {
        item.inspect = result.value;
        item.status = 'ready';
        if (result.value.kind !== 'svg') item.originalUrl = trackObjectUrl(file);
      } else {
        item.status = result.state;
        item.error = result.error?.message || 'Unsupported image.';
      }
    } catch {
      item.status = 'failed'; item.error = 'The file could not be inspected safely.';
    }
  }
  els.input.value = '';
  els.workspace.classList.toggle('hidden', state.items.length === 0);
  if (!state.selectedId) {
    const firstReady = state.items.find((item) => item.status === 'ready');
    if (firstReady) selectItem(firstReady.id, true);
  }
  renderList(); renderSelected();
}

function makeRejectedItem(file, reason) {
  return { id: crypto.randomUUID(), file, status: 'unsupported', inspect: null, error: reason, originalUrl: '', outputBlob: null, outputUrl: '', outputName: '' };
}

function selectItem(id, reset = false) {
  state.selectedId = id;
  if (reset) resetToOriginal();
  renderList(); renderSelected();
}

function selectedItem() { return state.items.find((item) => item.id === state.selectedId) || null; }

function renderList() {
  els.list.replaceChildren();
  els.count.textContent = `${state.items.length} image${state.items.length === 1 ? '' : 's'}`;
  for (const item of state.items) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `file-row${item.id === state.selectedId ? ' selected' : ''}`; button.addEventListener('click', () => selectItem(item.id));
    const copy = document.createElement('span'); copy.className = 'file-copy';
    const name = document.createElement('strong'); name.textContent = item.file.name || 'Unnamed file';
    const detail = document.createElement('span'); detail.textContent = item.inspect ? `${item.inspect.kind.toUpperCase()} · ${item.inspect.dimensions.width}×${item.inspect.dimensions.height} · ${formatBytes(item.file.size)}` : (item.error || formatBytes(item.file.size));
    const status = document.createElement('span'); status.className = `status status-${item.status}`; status.textContent = statusLabel(item.status);
    copy.append(name, detail); button.append(copy, status); els.list.append(button);
  }
}

function renderSelected() {
  const item = selectedItem();
  els.originalPreview.replaceChildren(); els.outputPreview.replaceChildren(); els.originalStats.replaceChildren(); els.outputStats.replaceChildren(); els.metadata.replaceChildren();
  if (!item) { els.originalPreview.textContent = 'Select an image'; els.outputPreview.textContent = 'Process to preview'; updateButtons(); return; }
  if (item.inspect) {
    if (item.originalUrl) addPreviewImage(els.originalPreview, item.originalUrl, `Original ${item.file.name}`);
    else els.originalPreview.textContent = item.inspect.kind === 'svg' ? 'SVG preview withheld until sanitized and rasterized.' : 'Preview unavailable.';
    fillStats(els.originalStats, [
      ['Format', item.inspect.kind.toUpperCase()], ['Dimensions', `${item.inspect.dimensions.width} × ${item.inspect.dimensions.height}`], ['Size', formatBytes(item.file.size)]
    ]);
    renderMetadata(item);
  } else {
    els.originalPreview.textContent = item.error || 'Unable to inspect file.';
  }
  if (item.outputUrl && item.outputBlob) {
    addPreviewImage(els.outputPreview, item.outputUrl, `Processed ${item.file.name}`);
    const reduction = item.file.size ? Math.round((1 - item.outputBlob.size / item.file.size) * 100) : 0;
    fillStats(els.outputStats, [['Format', item.outputBlob.type.replace('image/', '').toUpperCase()], ['Dimensions', `${item.outputWidth} × ${item.outputHeight}`], ['Size', formatBytes(item.outputBlob.size)], ['Change', `${reduction >= 0 ? reduction + '% smaller' : Math.abs(reduction) + '% larger'}`]]);
  } else {
    els.outputPreview.textContent = item.status === 'processing' ? 'Processing…' : (item.error && item.status !== 'ready' ? item.error : 'Process to preview');
  }
  updateWarnings(); updateButtons();
}

function renderMetadata(item) {
  const exif = item.inspect?.exif;
  const lines = [
    ['EXIF', exif?.hasExif ? 'Detected' : 'Not detected'],
    ['GPS', exif?.hasGps ? 'Detected — removed on export' : 'Not detected'],
    ['Orientation', String(exif?.orientation || 1)]
  ];
  if (exif?.make) lines.push(['Camera make', exif.make]);
  if (exif?.model) lines.push(['Camera model', exif.model]);
  if (exif?.dateTimeOriginal) lines.push(['Captured', exif.dateTimeOriginal]);
  for (const [key, value] of lines) { const row = document.createElement('div'); const k = document.createElement('span'); const v = document.createElement('strong'); k.textContent = key; v.textContent = value; row.append(k, v); els.metadata.append(row); }
}

function addPreviewImage(container, src, alt) { const img = document.createElement('img'); img.src = src; img.alt = alt; img.decoding = 'async'; container.append(img); }
function fillStats(dl, entries) { for (const [key, value] of entries) { const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = value; dl.append(dt, dd); } }

function resetToOriginal() {
  const item = selectedItem();
  if (!item?.inspect) return;
  els.preset.value = 'custom'; els.resizeMode.value = 'fit'; els.width.value = item.inspect.dimensions.width; els.height.value = item.inspect.dimensions.height; els.percentage.value = 100; els.longest.value = Math.max(item.inspect.dimensions.width, item.inspect.dimensions.height); els.shortest.value = Math.min(item.inspect.dimensions.width, item.inspect.dimensions.height);
  els.preserveAspect.checked = true; els.cropMode.value = 'none'; els.cropX.value = 0; els.cropY.value = 0; els.cropWidth.value = item.inspect.dimensions.width; els.cropHeight.value = item.inspect.dimensions.height;
  els.format.value = item.inspect.kind === 'svg' ? 'png' : item.inspect.kind; els.quality.value = 82; els.qualityValue.textContent = '82'; els.targetSize.value = ''; els.rotate.value = 0; els.flipX.checked = false; els.flipY.checked = false;
  updateConditionalControls(); updateWarnings();
}

function applyPreset() {
  const preset = IMAGE_PRESETS.find((item) => item.id === els.preset.value);
  if (!preset) return;
  els.resizeMode.value = 'fill'; els.width.value = preset.width; els.height.value = preset.height; updateConditionalControls(); updateWarnings();
}

function updateConditionalControls() {
  const mode = els.resizeMode.value;
  els.percentageWrap.classList.toggle('hidden', mode !== 'percentage');
  els.longestWrap.classList.toggle('hidden', mode !== 'longest');
  els.shortestWrap.classList.toggle('hidden', mode !== 'shortest');
  const crop = els.cropMode.value;
  els.freeCrop.classList.toggle('hidden', crop !== 'free');
  els.customRatioWrap.classList.toggle('hidden', crop !== 'custom');
}

function updateWarnings() {
  els.targetSize.disabled = els.format.value === 'png';
  const item = selectedItem();
  els.jpegWarning.classList.toggle('hidden', els.format.value !== 'jpeg');
  if (!item?.inspect) { els.upscaleWarning.classList.add('hidden'); return; }
  const source = item.inspect.dimensions;
  let upscale = false;
  if (els.resizeMode.value === 'percentage') upscale = Number(els.percentage.value) > 100;
  else if (els.resizeMode.value === 'longest') upscale = Number(els.longest.value) > Math.max(source.width, source.height);
  else if (els.resizeMode.value === 'shortest') upscale = Number(els.shortest.value) > Math.min(source.width, source.height);
  else upscale = Number(els.width.value) > source.width || Number(els.height.value) > source.height;
  els.upscaleWarning.classList.toggle('hidden', !upscale);
}

function collectSettings() {
  let crop = { mode: 'none' };
  const cm = els.cropMode.value;
  if (cm === 'free') crop = { mode: 'free', x: Number(els.cropX.value), y: Number(els.cropY.value), width: Number(els.cropWidth.value), height: Number(els.cropHeight.value) };
  if (cm === 'ratio') crop = { mode: 'ratio', ratio: 1 };
  if (cm === 'ratio-4-5') crop = { mode: 'ratio', ratio: 4 / 5 };
  if (cm === 'ratio-16-9') crop = { mode: 'ratio', ratio: 16 / 9 };
  if (cm === 'ratio-9-16') crop = { mode: 'ratio', ratio: 9 / 16 };
  if (cm === 'custom') crop = { mode: 'ratio', ratio: Number(els.customRatio.value) };
  return {
    resizeMode: els.resizeMode.value, width: Number(els.width.value), height: Number(els.height.value), percentage: Number(els.percentage.value), longestEdge: Number(els.longest.value), shortestEdge: Number(els.shortest.value), preserveAspect: els.preserveAspect.checked,
    crop, format: els.format.value, quality: Number(els.quality.value) / 100, targetBytes: els.targetSize.value ? Number(els.targetSize.value) * 1024 : 0, background: els.background.value, rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked
  };
}

async function processSelected() {
  const item = selectedItem(); if (!item || item.status === 'unsupported' || item.status === 'failed') return;
  setBusy(true); await processItem(item, collectSettings()); setBusy(false); renderList(); renderSelected();
}

async function processAll() {
  const candidates = state.items.filter((item) => item.inspect && !['unsupported', 'failed'].includes(item.status));
  if (!candidates.length) return;
  setBusy(true); const settings = collectSettings();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(SECURITY_BUDGET.batchConcurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) { const item = candidates[cursor++]; await processItem(item, settings); renderList(); if (item.id === state.selectedId) renderSelected(); }
  });
  await Promise.all(workers); setBusy(false); renderList(); renderSelected();
}

async function processItem(item, settings) {
  item.status = 'processing'; item.error = ''; renderList();
  if (item.outputUrl) { revokeObjectUrl(item.outputUrl); item.outputUrl = ''; item.outputBlob = null; }
  try {
    const buffer = await item.file.arrayBuffer();
    const result = await runner.run({ op: 'process', buffer, settings }, [buffer]);
    if (result.state !== 'completed') { item.status = result.state; item.error = result.error?.message || 'Processing failed.'; return; }
    const value = result.value; const blob = new Blob([value.buffer], { type: value.mime });
    item.outputBlob = blob; item.outputUrl = trackObjectUrl(blob); item.outputWidth = value.width; item.outputHeight = value.height; item.status = 'completed';
    const ext = value.kind === 'jpeg' ? 'jpg' : value.kind;
    item.outputName = exportFilename(item.file.name, ext, { prefix: els.prefix.value, suffix: els.suffix.value, preserveOriginal: els.preserveName.checked });
  } catch { item.status = 'failed'; item.error = 'Processing failed safely.'; }
}

function setBusy(value) { state.busy = value; updateButtons(); els.processSelected.textContent = value ? 'Processing…' : 'Process selected'; }

function updateButtons() {
  const item = selectedItem();
  els.processSelected.disabled = state.busy || !item?.inspect;
  els.processAll.disabled = state.busy || !state.items.some((entry) => entry.inspect);
  els.downloadSelected.disabled = state.busy || !item?.outputBlob;
  els.downloadAll.disabled = state.busy || !state.items.some((entry) => entry.outputBlob);
  els.add.disabled = state.busy;
}

function downloadSelected() { const item = selectedItem(); if (item?.outputUrl && item.outputName) triggerDownload(item.outputUrl, item.outputName); }

async function downloadAll() {
  const outputs = state.items.filter((item) => item.outputBlob);
  if (!outputs.length) return;
  setBusy(true);
  try {
    const files = [];
    for (const item of outputs) files.push({ name: item.outputName, buffer: await item.outputBlob.arrayBuffer() });
    const transfers = files.map((file) => file.buffer);
    const result = await runner.run({ op: 'zip', files }, transfers, 45_000);
    if (result.state === 'completed') {
      const blob = new Blob([result.value.buffer], { type: 'application/zip' }); const url = trackObjectUrl(blob); triggerDownload(url, 'utility-os-images.zip'); setTimeout(() => revokeObjectUrl(url), 2000);
    } else showCompatibility(result.error?.message || 'ZIP export failed safely.');
  } finally { setBusy(false); }
}

function triggerDownload(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); }

async function clearAll() {
  runner.terminateAll(); cleanupUrls(); state.items = []; state.selectedId = null; await clearWorkspace(); els.workspace.classList.add('hidden'); els.list.replaceChildren(); els.input.value = ''; els.clear.textContent = 'Workspace cleared'; setTimeout(() => { els.clear.textContent = 'Clear workspace'; }, 1600);
}

function cleanupUrls() { for (const item of state.items) { revokeObjectUrl(item.originalUrl); revokeObjectUrl(item.outputUrl); item.originalUrl = ''; item.outputUrl = ''; } }
function showCompatibility(message) { els.compatibility.textContent = message; els.compatibility.classList.remove('hidden'); }
function statusLabel(status) { return ({ inspecting: 'Inspecting', ready: 'Ready', processing: 'Processing', completed: 'Done', failed: 'Failed', unsupported: 'Unsupported', timed_out: 'Timed out', cancelled: 'Cancelled' })[status] || status; }
function formatBytes(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
