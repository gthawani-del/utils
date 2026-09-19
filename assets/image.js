import { SECURITY_BUDGET, validateBatchBudget, validateFileBudget } from '/lib/security/budget.js';
import { exportFilename } from '/lib/security/filename.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { trackObjectUrl, revokeObjectUrl, clearWorkspace } from '/lib/security/workspace.js';
import { IMAGE_PRESETS } from '/lib/image/presets.js';
import { DEFAULT_EDITS, normalizeEdits, editsEqual } from '/lib/image/edits.js';
import { createLayer, normalizeLayer } from '/lib/image/layers.js';
import { DEFAULT_WATERMARK, normalizeWatermark } from '/lib/image/watermark.js';
import { normalizeCleanup } from '/lib/image/cleanup.js';

const workerUrl = new URL('/workers/image.worker.js', location.origin);
const runner = new WorkerRunner(workerUrl);
const state = { items: [], selectedId: null, busy: false, editHistory: [], lastCommittedEdits: normalizeEdits(DEFAULT_EDITS), lastCommittedGeometry: { rotate: 0, flipX: false, flipY: false }, layers: [], selectedLayerId: null, watermarkLogoFile: null, cleanupPointerId: null, mobileMode: 'adjust', mobileShowOriginal: false, redoHistory: [], previewTimer: 0, previewAbort: null };
const $ = (selector) => document.querySelector(selector);
const els = {
  input: $('#file-input'), choose: $('#choose-files'), add: $('#add-more'), drop: $('#drop-zone'), workspace: $('#workspace'), list: $('#file-list'), count: $('#file-count'),
  originalPreview: $('#original-preview'), outputPreview: $('#output-preview'), originalStats: $('#original-stats'), outputStats: $('#output-stats'), metadata: $('#metadata-box'),
  compatibility: $('#compatibility'), preset: $('#preset'), resizeMode: $('#resize-mode'), width: $('#width'), height: $('#height'), percentage: $('#percentage'), longest: $('#longest-edge'), shortest: $('#shortest-edge'),
  percentageWrap: $('#percentage-wrap'), longestWrap: $('#longest-wrap'), shortestWrap: $('#shortest-wrap'), preserveAspect: $('#preserve-aspect'), cropMode: $('#crop-mode'), customRatio: $('#custom-ratio'), customRatioWrap: $('#custom-ratio-wrap'), freeCrop: $('#free-crop'),
  cropX: $('#crop-x'), cropY: $('#crop-y'), cropWidth: $('#crop-width'), cropHeight: $('#crop-height'), format: $('#format'), quality: $('#quality'), qualityValue: $('#quality-value'), targetSize: $('#target-size'), background: $('#background'), rotate: $('#rotate'), flipX: $('#flip-x'), flipY: $('#flip-y'),
  prefix: $('#prefix'), suffix: $('#suffix'), preserveName: $('#preserve-name'), reset: $('#reset-settings'), processSelected: $('#process-selected'), processAll: $('#process-all'), downloadSelected: $('#download-selected'), downloadAll: $('#download-all'), clear: $('#clear-workspace'), jpegWarning: $('#jpeg-warning'), upscaleWarning: $('#upscale-warning'),
  editComparison: $('#edit-comparison'), comparisonOriginal: $('#comparison-original'), comparisonEdited: $('#comparison-edited'), comparisonOverlay: $('#comparison-overlay'), comparisonDivider: $('#comparison-divider'), comparisonRange: $('#comparison-range'), comparisonValue: $('#comparison-value'), previewStatus: $('#preview-status'),
  undoEdit: $('#undo-edit'), resetEdits: $('#reset-edits'), brightness: $('#brightness'), exposure: $('#exposure'), contrast: $('#contrast'), saturation: $('#saturation'), vibrance: $('#vibrance'), highlights: $('#highlights'), shadows: $('#shadows'), temperature: $('#temperature'), tint: $('#tint'), gamma: $('#gamma'), sharpen: $('#sharpen'), blur: $('#blur'), grayscale: $('#grayscale'), sepia: $('#sepia'), straighten: $('#straighten'),
  layerList: $('#layer-list'), layerProperties: $('#layer-properties'), layerTitle: $('#layer-title'), textLayerFields: $('#text-layer-fields'), shapeLayerFields: $('#shape-layer-fields'), addTextLayer: $('#add-text-layer'), addRectLayer: $('#add-rect-layer'), addCircleLayer: $('#add-circle-layer'), addLineLayer: $('#add-line-layer'), addArrowLayer: $('#add-arrow-layer'), addBackgroundLayer: $('#add-background-layer'), duplicateLayer: $('#duplicate-layer'), deleteLayer: $('#delete-layer'), layerUp: $('#layer-up'), layerDown: $('#layer-down'),
  layerText: $('#layer-text'), layerFont: $('#layer-font'), layerFontSize: $('#layer-font-size'), layerFontWeight: $('#layer-font-weight'), layerAlign: $('#layer-align'), layerColor: $('#layer-color'), layerLetterSpacing: $('#layer-letter-spacing'), layerLineSpacing: $('#layer-line-spacing'), layerStrokeWidth: $('#layer-stroke-width'), layerStrokeColor: $('#layer-stroke-color'), layerShadowEnabled: $('#layer-shadow-enabled'), layerShadowColor: $('#layer-shadow-color'), layerShadowBlur: $('#layer-shadow-blur'), layerShadowX: $('#layer-shadow-x'), layerShadowY: $('#layer-shadow-y'), layerBgEnabled: $('#layer-bg-enabled'), layerBgColor: $('#layer-bg-color'),
  layerFill: $('#layer-fill'), layerFill2: $('#layer-fill-2'), layerGradient: $('#layer-gradient'), layerGradientAngle: $('#layer-gradient-angle'), shapeStrokeColor: $('#shape-stroke-color'), shapeStrokeWidth: $('#shape-stroke-width'), layerX: $('#layer-x'), layerY: $('#layer-y'), layerWidth: $('#layer-width'), layerHeight: $('#layer-height'), layerRotation: $('#layer-rotation'), layerOpacity: $('#layer-opacity'),
  watermarkEnabled: $('#watermark-enabled'), watermarkControls: $('#watermark-controls'), watermarkType: $('#watermark-type'), watermarkPosition: $('#watermark-position'), watermarkOpacity: $('#watermark-opacity'), watermarkRotation: $('#watermark-rotation'), watermarkMargin: $('#watermark-margin'), watermarkTiled: $('#watermark-tiled'), watermarkTileGap: $('#watermark-tile-gap'), watermarkCustomPosition: $('#watermark-custom-position'), watermarkX: $('#watermark-x'), watermarkY: $('#watermark-y'), watermarkTextFields: $('#watermark-text-fields'), watermarkImageFields: $('#watermark-image-fields'), watermarkText: $('#watermark-text'), watermarkFont: $('#watermark-font'), watermarkFontSize: $('#watermark-font-size'), watermarkColor: $('#watermark-color'), watermarkLogoInput: $('#watermark-logo-input'), chooseWatermarkLogo: $('#choose-watermark-logo'), watermarkLogoName: $('#watermark-logo-name'), watermarkLogoWidth: $('#watermark-logo-width'),
  cleanupCanvas: $('#cleanup-canvas'), cleanupEmpty: $('#cleanup-empty'), cleanupState: $('#cleanup-state'), cleanupBrush: $('#cleanup-brush'), cleanupBrushValue: $('#cleanup-brush-value'), cleanupUndoStroke: $('#cleanup-undo-stroke'), cleanupClearMask: $('#cleanup-clear-mask'), cleanupApply: $('#cleanup-apply'), cleanupUndo: $('#cleanup-undo'),
  mobileExit: $('#mobile-exit-editor'), mobileUndo: $('#mobile-undo-edit'), mobileRedo: $('#mobile-redo-edit'), mobileCompare: $('#mobile-compare'), mobileRevert: $('#mobile-revert'), mobileCanvasImage: $('#mobile-canvas-image'), mobileCanvasEmpty: $('#mobile-canvas-empty'), mobileCanvasStatus: $('#mobile-canvas-status'), mobileBatchChip: $('#mobile-batch-chip'), mobileSheetTitle: $('#mobile-sheet-title'), mobileToolButtons: [...document.querySelectorAll('[data-mobile-tool]')]
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
  renderLayerList(); renderLayerProperties(); updateWatermarkConditional(); setMobileMode('adjust'); syncMobileEditingState();
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
  for (const control of editControls()) {
    control.addEventListener('input', () => { updateEditReadouts(); scheduleEditPreview(); });
    control.addEventListener('change', commitEditChange);
  }
  for (const control of [els.rotate, els.flipX, els.flipY]) control.addEventListener('change', commitEditChange);
  els.undoEdit.addEventListener('click', undoEdit);
  els.resetEdits.addEventListener('click', resetEdits);
  els.comparisonRange.addEventListener('input', updateComparisonPosition);
  const addLayerButtons = [[els.addTextLayer,'text'],[els.addRectLayer,'rectangle'],[els.addCircleLayer,'circle'],[els.addLineLayer,'line'],[els.addArrowLayer,'arrow'],[els.addBackgroundLayer,'background']];
  for (const [button,type] of addLayerButtons) button.addEventListener('click', () => addDesignLayer(type));
  els.duplicateLayer.addEventListener('click', duplicateSelectedLayer); els.deleteLayer.addEventListener('click', deleteSelectedLayer); els.layerUp.addEventListener('click', () => moveSelectedLayer(1)); els.layerDown.addEventListener('click', () => moveSelectedLayer(-1));
  for (const control of layerControls()) { control.addEventListener('input', updateSelectedLayerFromControls); control.addEventListener('change', updateSelectedLayerFromControls); }
  for (const control of watermarkControls()) { control.addEventListener('input', () => { updateWatermarkConditional(); scheduleEditPreview(); }); control.addEventListener('change', () => { updateWatermarkConditional(); scheduleEditPreview(40); }); }
  els.chooseWatermarkLogo.addEventListener('click', () => els.watermarkLogoInput.click());
  els.watermarkLogoInput.addEventListener('change', () => setWatermarkLogo(els.watermarkLogoInput.files?.[0]));
  els.cleanupBrush.addEventListener('input', () => { els.cleanupBrushValue.textContent = els.cleanupBrush.value; });
  els.cleanupCanvas.addEventListener('pointerdown', beginCleanupStroke); els.cleanupCanvas.addEventListener('pointermove', continueCleanupStroke); els.cleanupCanvas.addEventListener('pointerup', endCleanupStroke); els.cleanupCanvas.addEventListener('pointercancel', endCleanupStroke);
  els.cleanupUndoStroke.addEventListener('click', undoCleanupStroke); els.cleanupClearMask.addEventListener('click', clearCleanupMask); els.cleanupApply.addEventListener('click', applyCleanupMask); els.cleanupUndo.addEventListener('click', undoCleanupApplication);
  for (const button of els.mobileToolButtons) button.addEventListener('click', () => setMobileMode(button.dataset.mobileTool));
  els.mobileExit.addEventListener('click', exitMobileEditor);
  els.mobileUndo.addEventListener('click', undoEdit);
  els.mobileRedo.addEventListener('click', redoEdit);
  els.mobileRevert.addEventListener('click', () => { resetToOriginal(); renderSelected(); });
  for (const type of ['pointerdown','keydown']) els.mobileCompare.addEventListener(type, (event) => { if (type === 'keydown' && ![' ','Enter'].includes(event.key)) return; state.mobileShowOriginal = true; renderMobileCanvas(selectedItem()); });
  for (const type of ['pointerup','pointercancel','pointerleave','keyup']) els.mobileCompare.addEventListener(type, () => { state.mobileShowOriginal = false; renderMobileCanvas(selectedItem()); });
  els.mobileBatchChip.addEventListener('click', () => document.querySelector('.file-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  window.addEventListener('resize', syncMobileEditingState);
  window.addEventListener('pagehide', () => { state.previewAbort?.abort(); cleanupUrls(); });
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
    const item = { id: crypto.randomUUID(), file, status: 'inspecting', inspect: null, error: '', originalUrl: '', outputBlob: null, outputUrl: '', outputName: '', editPreviewUrl: '', editPreviewBlob: null, cleanupStrokes: [], cleanupApplied: false, cleanupImage: null };
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
  renderList(); renderSelected(); syncMobileEditingState();
}

function makeRejectedItem(file, reason) {
  return { id: crypto.randomUUID(), file, status: 'unsupported', inspect: null, error: reason, originalUrl: '', outputBlob: null, outputUrl: '', outputName: '', editPreviewUrl: '', editPreviewBlob: null, cleanupStrokes: [], cleanupApplied: false, cleanupImage: null };
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
  renderComparison(item);
  renderMobileCanvas(item);
  renderCleanupEditor(item);
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
  applyEditsToControls(DEFAULT_EDITS); state.editHistory = []; state.redoHistory = []; state.lastCommittedEdits = normalizeEdits(DEFAULT_EDITS); state.lastCommittedGeometry = { rotate: 0, flipX: false, flipY: false }; updateUndoButton();
  state.layers = []; state.selectedLayerId = null; renderLayerList(); renderLayerProperties(); resetWatermarkControls();
  item.cleanupStrokes = []; item.cleanupApplied = false; renderCleanupEditor(item);
  if (item.editPreviewUrl) { revokeObjectUrl(item.editPreviewUrl); item.editPreviewUrl = ''; item.editPreviewBlob = null; }
  els.editComparison.classList.add('hidden');
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
    crop, format: els.format.value, quality: Number(els.quality.value) / 100, targetBytes: els.targetSize.value ? Number(els.targetSize.value) * 1024 : 0, background: els.background.value, rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked, edits: collectEdits(), layers: state.layers.map((layer) => ({ ...layer })), watermark: collectWatermark()
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
    const effectiveSettings = { ...settings, cleanup: cleanupForItem(item) };
    const payload = await createProcessingPayload('process', item, effectiveSettings);
    const result = await runner.run(payload.message, payload.transfers);
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
  state.previewAbort?.abort(); clearTimeout(state.previewTimer); runner.terminateAll(); cleanupUrls(); state.items = []; state.selectedId = null; state.editHistory = []; state.lastCommittedEdits = normalizeEdits(DEFAULT_EDITS); state.layers = []; state.selectedLayerId = null; state.watermarkLogoFile = null; state.redoHistory = []; renderLayerList(); renderLayerProperties(); resetWatermarkControls(); await clearWorkspace(); els.workspace.classList.add('hidden'); els.list.replaceChildren(); els.input.value = ''; syncMobileEditingState(); els.clear.textContent = 'Workspace cleared'; setTimeout(() => { els.clear.textContent = 'Clear workspace'; }, 1600);
}

function cleanupUrls() { for (const item of state.items) { revokeObjectUrl(item.originalUrl); revokeObjectUrl(item.outputUrl); revokeObjectUrl(item.editPreviewUrl); item.originalUrl = ''; item.outputUrl = ''; item.editPreviewUrl = ''; } }
function cleanupForItem(item) { return normalizeCleanup({ enabled:Boolean(item?.cleanupApplied), strokes:item?.cleanupStrokes || [] }); }
function cleanupPointFromEvent(event) { const rect=els.cleanupCanvas.getBoundingClientRect(); return { x:Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))), y:Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height))) }; }
function beginCleanupStroke(event) { const item=selectedItem(); if(!item?.originalUrl||item.inspect?.kind==='svg'||!item.cleanupImage?.complete) return; event.preventDefault(); els.cleanupCanvas.setPointerCapture?.(event.pointerId); state.cleanupPointerId=event.pointerId; const rect=els.cleanupCanvas.getBoundingClientRect(); const radius=(Number(els.cleanupBrush.value)/2)/Math.max(1,Math.min(rect.width,rect.height)); item.cleanupStrokes.push({radius,points:[cleanupPointFromEvent(event)]}); item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); }
function continueCleanupStroke(event) { if(state.cleanupPointerId!==event.pointerId) return; const item=selectedItem(); const stroke=item?.cleanupStrokes?.[item.cleanupStrokes.length-1]; if(!stroke)return; const point=cleanupPointFromEvent(event); const last=stroke.points[stroke.points.length-1]; if(Math.hypot(point.x-last.x,point.y-last.y)<.002)return; stroke.points.push(point); paintCleanupCanvas(item); }
function endCleanupStroke(event) { if(state.cleanupPointerId!==event.pointerId)return; state.cleanupPointerId=null; const item=selectedItem(); if(item){ item.cleanupApplied=false; updateCleanupButtons(item); els.cleanupState.textContent='Mask ready'; scheduleEditPreview(80); } }
function undoCleanupStroke() { const item=selectedItem(); if(!item?.cleanupStrokes?.length)return; item.cleanupStrokes.pop(); item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); scheduleEditPreview(60); }
function clearCleanupMask() { const item=selectedItem(); if(!item)return; const wasApplied=item.cleanupApplied; item.cleanupStrokes=[]; item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); if(wasApplied)scheduleEditPreview(40); }
function applyCleanupMask() { const item=selectedItem(); if(!item?.cleanupStrokes?.length)return; item.cleanupApplied=true; updateCleanupButtons(item); els.cleanupState.textContent='Cleanup active'; scheduleEditPreview(20); }
function undoCleanupApplication() { const item=selectedItem(); if(!item?.cleanupApplied)return; item.cleanupApplied=false; updateCleanupButtons(item); els.cleanupState.textContent='Mask kept · cleanup undone'; scheduleEditPreview(20); }
function updateCleanupButtons(item) { const count=item?.cleanupStrokes?.length||0; els.cleanupUndoStroke.disabled=count===0; els.cleanupClearMask.disabled=count===0; els.cleanupApply.disabled=count===0||Boolean(item?.cleanupApplied); els.cleanupUndo.disabled=!item?.cleanupApplied; if(!count)els.cleanupState.textContent='No mask'; else if(item.cleanupApplied)els.cleanupState.textContent='Cleanup active'; else els.cleanupState.textContent=`${count} stroke${count===1?'':'s'} ready`; }
function renderCleanupEditor(item) { const ctx=els.cleanupCanvas.getContext('2d'); if(!item?.originalUrl||item.inspect?.kind==='svg'){ ctx.clearRect(0,0,els.cleanupCanvas.width,els.cleanupCanvas.height); els.cleanupEmpty.classList.remove('hidden'); updateCleanupButtons(item); return; } els.cleanupEmpty.classList.add('hidden'); if(item.cleanupImage?.complete){ paintCleanupCanvas(item); return; } const img=new Image(); item.cleanupImage=img; img.onload=()=>{ const scale=Math.min(1,900/img.naturalWidth,520/img.naturalHeight); els.cleanupCanvas.width=Math.max(1,Math.round(img.naturalWidth*scale)); els.cleanupCanvas.height=Math.max(1,Math.round(img.naturalHeight*scale)); paintCleanupCanvas(item); }; img.src=item.originalUrl; updateCleanupButtons(item); }
function paintCleanupCanvas(item) { const img=item?.cleanupImage; if(!img?.complete)return; const canvas=els.cleanupCanvas,ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); ctx.save(); ctx.strokeStyle='rgba(220,38,38,.58)'; ctx.fillStyle='rgba(220,38,38,.58)'; ctx.lineCap='round'; ctx.lineJoin='round'; for(const stroke of item.cleanupStrokes||[]){ const radius=stroke.radius*Math.min(canvas.width,canvas.height); const pts=stroke.points||[]; if(!pts.length)continue; ctx.lineWidth=Math.max(2,radius*2); if(pts.length===1){ctx.beginPath();ctx.arc(pts[0].x*canvas.width,pts[0].y*canvas.height,radius,0,Math.PI*2);ctx.fill();continue;} ctx.beginPath();ctx.moveTo(pts[0].x*canvas.width,pts[0].y*canvas.height);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x*canvas.width,pts[i].y*canvas.height);ctx.stroke(); } ctx.restore(); }

function watermarkControls() { return [els.watermarkEnabled,els.watermarkType,els.watermarkPosition,els.watermarkOpacity,els.watermarkRotation,els.watermarkMargin,els.watermarkTiled,els.watermarkTileGap,els.watermarkX,els.watermarkY,els.watermarkText,els.watermarkFont,els.watermarkFontSize,els.watermarkColor,els.watermarkLogoWidth]; }
function collectWatermark() { return normalizeWatermark({ enabled:els.watermarkEnabled.checked,type:els.watermarkType.value,position:els.watermarkPosition.value,opacity:Number(els.watermarkOpacity.value)/100,rotation:Number(els.watermarkRotation.value),margin:Number(els.watermarkMargin.value),tiled:els.watermarkTiled.checked,tileGap:Number(els.watermarkTileGap.value),x:Number(els.watermarkX.value),y:Number(els.watermarkY.value),text:els.watermarkText.value,fontFamily:els.watermarkFont.value,fontSize:Number(els.watermarkFontSize.value),color:els.watermarkColor.value,logoWidth:Number(els.watermarkLogoWidth.value) }); }
function updateWatermarkConditional() { const enabled=els.watermarkEnabled.checked; els.watermarkControls.classList.toggle('hidden',!enabled); const image=els.watermarkType.value==='image'; els.watermarkTextFields.classList.toggle('hidden',image); els.watermarkImageFields.classList.toggle('hidden',!image); els.watermarkCustomPosition.classList.toggle('hidden',els.watermarkPosition.value!=='custom'||!enabled); }
function resetWatermarkControls() { const r=DEFAULT_WATERMARK; els.watermarkEnabled.checked=false; els.watermarkType.value=r.type; els.watermarkPosition.value=r.position; els.watermarkOpacity.value=Math.round(r.opacity*100); els.watermarkRotation.value=r.rotation; els.watermarkMargin.value=r.margin; els.watermarkTiled.checked=r.tiled; els.watermarkTileGap.value=r.tileGap; els.watermarkX.value=r.x; els.watermarkY.value=r.y; els.watermarkText.value=r.text; els.watermarkFont.value=r.fontFamily; els.watermarkFontSize.value=r.fontSize; els.watermarkColor.value=r.color; els.watermarkLogoWidth.value=r.logoWidth; els.watermarkLogoInput.value=''; els.watermarkLogoName.textContent='No logo selected'; state.watermarkLogoFile=null; updateWatermarkConditional(); }
async function setWatermarkLogo(file) { if(!file) return; const budget=validateFileBudget(file); if(!budget.ok){ showCompatibility(budget.reason); return; } try { const buffer=await file.arrayBuffer(); const result=await runner.run({op:'inspect',buffer},[buffer],15_000); if(result.state!=='completed'||!['jpeg','png','webp','avif'].includes(result.value.kind)){ showCompatibility('Watermark logos must be a valid JPEG, PNG, WebP, or AVIF image.'); els.watermarkLogoInput.value=''; return; } state.watermarkLogoFile=file; els.watermarkLogoName.textContent=file.name; els.watermarkEnabled.checked=true; els.watermarkType.value='image'; updateWatermarkConditional(); scheduleEditPreview(40); } catch { showCompatibility('The watermark image could not be inspected safely.'); } }
async function createProcessingPayload(op,item,settings) { const buffer=await item.file.arrayBuffer(); const message={op,buffer,settings}; const transfers=[buffer]; if(settings.watermark?.enabled&&settings.watermark.type==='image'&&state.watermarkLogoFile){ const watermarkLogoBuffer=await state.watermarkLogoFile.arrayBuffer(); message.watermarkLogoBuffer=watermarkLogoBuffer; transfers.push(watermarkLogoBuffer); } return {message,transfers}; }

function layerControls() {
  return [els.layerText,els.layerFont,els.layerFontSize,els.layerFontWeight,els.layerAlign,els.layerColor,els.layerLetterSpacing,els.layerLineSpacing,els.layerStrokeWidth,els.layerStrokeColor,els.layerShadowEnabled,els.layerShadowColor,els.layerShadowBlur,els.layerShadowX,els.layerShadowY,els.layerBgEnabled,els.layerBgColor,els.layerFill,els.layerFill2,els.layerGradient,els.layerGradientAngle,els.shapeStrokeColor,els.shapeStrokeWidth,els.layerX,els.layerY,els.layerWidth,els.layerHeight,els.layerRotation,els.layerOpacity];
}

function addDesignLayer(type) {
  const layer = createLayer(type, crypto.randomUUID());
  state.layers.push(layer); state.selectedLayerId = layer.id; renderLayerList(); renderLayerProperties(); scheduleEditPreview(40);
}

function selectedDesignLayer() { return state.layers.find((layer) => layer.id === state.selectedLayerId) || null; }

function renderLayerList() {
  els.layerList.replaceChildren();
  if (!state.layers.length) { const empty = document.createElement('p'); empty.className = 'microcopy'; empty.textContent = 'No design layers yet.'; els.layerList.append(empty); return; }
  [...state.layers].reverse().forEach((layer) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-item' + (layer.id === state.selectedLayerId ? ' selected' : '');
    const name = document.createElement('span'); name.textContent = layer.type === 'text' ? (layer.text.trim().slice(0,28) || 'Text') : layer.name;
    const type = document.createElement('small'); type.textContent = layer.type; button.append(name,type); button.addEventListener('click', () => { state.selectedLayerId = layer.id; renderLayerList(); renderLayerProperties(); }); els.layerList.append(button);
  });
}

function renderLayerProperties() {
  const layer = selectedDesignLayer();
  els.layerProperties.classList.toggle('hidden', !layer); if (!layer) return;
  els.layerTitle.textContent = layer.name || layer.type; const isText = layer.type === 'text';
  els.textLayerFields.classList.toggle('hidden', !isText); els.shapeLayerFields.classList.toggle('hidden', isText);
  els.layerX.value = layer.x; els.layerY.value = layer.y; els.layerWidth.value = layer.width; els.layerHeight.value = layer.height; els.layerRotation.value = layer.rotation; els.layerOpacity.value = Math.round(layer.opacity * 100);
  if (isText) {
    els.layerText.value = layer.text; els.layerFont.value = layer.fontFamily; els.layerFontSize.value = layer.fontSize; els.layerFontWeight.value = layer.fontWeight; els.layerAlign.value = layer.align; els.layerColor.value = layer.color; els.layerLetterSpacing.value = layer.letterSpacing; els.layerLineSpacing.value = layer.lineSpacing; els.layerStrokeWidth.value = layer.strokeWidth; els.layerStrokeColor.value = layer.strokeColor; els.layerShadowEnabled.checked = layer.shadowEnabled; els.layerShadowColor.value = layer.shadowColor; els.layerShadowBlur.value = layer.shadowBlur; els.layerShadowX.value = layer.shadowX; els.layerShadowY.value = layer.shadowY; els.layerBgEnabled.checked = layer.backgroundEnabled; els.layerBgColor.value = layer.backgroundColor;
  } else {
    els.layerFill.value = layer.fill; els.layerFill2.value = layer.fill2; els.layerGradient.checked = layer.gradient; els.layerGradientAngle.value = layer.gradientAngle; els.shapeStrokeColor.value = layer.strokeColor; els.shapeStrokeWidth.value = layer.strokeWidth;
  }
  const index = state.layers.findIndex((entry) => entry.id === layer.id); els.layerDown.disabled = index <= 0; els.layerUp.disabled = index >= state.layers.length - 1;
}

function updateSelectedLayerFromControls() {
  const layer = selectedDesignLayer(); if (!layer) return;
  const next = { ...layer, x:Number(els.layerX.value), y:Number(els.layerY.value), width:Number(els.layerWidth.value), height:Number(els.layerHeight.value), rotation:Number(els.layerRotation.value), opacity:Number(els.layerOpacity.value)/100 };
  if (layer.type === 'text') Object.assign(next,{ text:els.layerText.value,fontFamily:els.layerFont.value,fontSize:Number(els.layerFontSize.value),fontWeight:Number(els.layerFontWeight.value),align:els.layerAlign.value,color:els.layerColor.value,letterSpacing:Number(els.layerLetterSpacing.value),lineSpacing:Number(els.layerLineSpacing.value),strokeWidth:Number(els.layerStrokeWidth.value),strokeColor:els.layerStrokeColor.value,shadowEnabled:els.layerShadowEnabled.checked,shadowColor:els.layerShadowColor.value,shadowBlur:Number(els.layerShadowBlur.value),shadowX:Number(els.layerShadowX.value),shadowY:Number(els.layerShadowY.value),backgroundEnabled:els.layerBgEnabled.checked,backgroundColor:els.layerBgColor.value });
  else Object.assign(next,{ fill:els.layerFill.value,fill2:els.layerFill2.value,gradient:els.layerGradient.checked,gradientAngle:Number(els.layerGradientAngle.value),strokeColor:els.shapeStrokeColor.value,strokeWidth:Number(els.shapeStrokeWidth.value) });
  const normalized = normalizeLayer(next); const index = state.layers.findIndex((entry) => entry.id === layer.id); state.layers[index] = normalized; renderLayerList(); scheduleEditPreview();
}

function duplicateSelectedLayer() {
  const layer = selectedDesignLayer(); if (!layer) return; const copy = normalizeLayer({ ...layer, id: crypto.randomUUID(), name: layer.name + ' copy', x: layer.x + 2, y: layer.y + 2 }); state.layers.push(copy); state.selectedLayerId = copy.id; renderLayerList(); renderLayerProperties(); scheduleEditPreview(40);
}
function deleteSelectedLayer() { const index = state.layers.findIndex((layer) => layer.id === state.selectedLayerId); if (index < 0) return; state.layers.splice(index,1); state.selectedLayerId = state.layers[Math.min(index,state.layers.length-1)]?.id || null; renderLayerList(); renderLayerProperties(); scheduleEditPreview(40); }
function moveSelectedLayer(direction) { const index = state.layers.findIndex((layer) => layer.id === state.selectedLayerId); const next = index + direction; if (index < 0 || next < 0 || next >= state.layers.length) return; [state.layers[index],state.layers[next]]=[state.layers[next],state.layers[index]]; renderLayerList(); renderLayerProperties(); scheduleEditPreview(40); }

const EDIT_KEYS = ['brightness','exposure','contrast','saturation','vibrance','highlights','shadows','temperature','tint','gamma','sharpen','blur','grayscale','sepia','straighten'];

function editControls() { return EDIT_KEYS.map((key) => els[key]); }

function collectEdits() {
  return normalizeEdits(Object.fromEntries(EDIT_KEYS.map((key) => [key, Number(els[key].value)])));
}

function applyEditsToControls(input) {
  const edits = normalizeEdits(input);
  for (const key of EDIT_KEYS) els[key].value = edits[key];
  updateEditReadouts();
}

function updateEditReadouts() {
  const edits = collectEdits();
  for (const key of EDIT_KEYS) {
    const output = document.querySelector('#' + key + '-value');
    if (!output) continue;
    output.textContent = ['exposure','gamma','straighten'].includes(key) ? edits[key].toFixed(key === 'gamma' ? 2 : 1) : String(Math.round(edits[key]));
  }
}

function commitEditChange() {
  const current = collectEdits();
  const geometry = { rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked };
  const lastGeometry = state.lastCommittedGeometry || { rotate: 0, flipX: false, flipY: false };
  if (!editsEqual(current, state.lastCommittedEdits) || JSON.stringify(geometry) !== JSON.stringify(lastGeometry)) {
    state.editHistory.push({ edits: state.lastCommittedEdits, geometry: lastGeometry });
    state.redoHistory = [];
    if (state.editHistory.length > 30) state.editHistory.shift();
    state.lastCommittedEdits = current; state.lastCommittedGeometry = geometry;
  }
  updateUndoButton(); scheduleEditPreview(40);
}

function undoEdit() {
  const previous = state.editHistory.pop();
  if (!previous) return;
  state.redoHistory.push({ edits: collectEdits(), geometry: { rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked } });
  applyEditsToControls(previous.edits);
  els.rotate.value = previous.geometry.rotate; els.flipX.checked = previous.geometry.flipX; els.flipY.checked = previous.geometry.flipY;
  state.lastCommittedEdits = normalizeEdits(previous.edits); state.lastCommittedGeometry = { ...previous.geometry };
  updateUndoButton(); scheduleEditPreview(20);
}

function redoEdit() {
  const next = state.redoHistory.pop();
  if (!next) return;
  state.editHistory.push({ edits: collectEdits(), geometry: { rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked } });
  applyEditsToControls(next.edits); els.rotate.value = next.geometry.rotate; els.flipX.checked = next.geometry.flipX; els.flipY.checked = next.geometry.flipY;
  state.lastCommittedEdits = normalizeEdits(next.edits); state.lastCommittedGeometry = { ...next.geometry };
  updateUndoButton(); scheduleEditPreview(20);
}

function resetEdits() {
  const current = collectEdits();
  const geometry = { rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked };
  if (!editsEqual(current, DEFAULT_EDITS) || geometry.rotate || geometry.flipX || geometry.flipY) {
    state.editHistory.push({ edits: current, geometry });
    if (state.editHistory.length > 30) state.editHistory.shift();
  }
  applyEditsToControls(DEFAULT_EDITS); els.rotate.value = 0; els.flipX.checked = false; els.flipY.checked = false;
  state.lastCommittedEdits = normalizeEdits(DEFAULT_EDITS); state.lastCommittedGeometry = { rotate: 0, flipX: false, flipY: false };
  updateUndoButton(); scheduleEditPreview(20);
}

function updateUndoButton() { const noUndo = state.editHistory.length === 0; els.undoEdit.disabled = noUndo; if (els.mobileUndo) els.mobileUndo.disabled = noUndo; if (els.mobileRedo) els.mobileRedo.disabled = state.redoHistory.length === 0; }

function scheduleEditPreview(delay = 260) {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(previewSelectedEdits, delay);
}

async function previewSelectedEdits() {
  const item = selectedItem();
  if (!item?.inspect || state.busy || !item.originalUrl) { els.editComparison.classList.add('hidden'); return; }
  state.previewAbort?.abort();
  const controller = new AbortController(); state.previewAbort = controller;
  els.previewStatus.textContent = 'Rendering preview…'; if (els.mobileCanvasStatus) els.mobileCanvasStatus.classList.remove('hidden');
  try {
    const settings = collectSettings(); settings.targetBytes = 0; settings.format = 'png'; settings.previewMaxEdge = 1400; settings.cleanup = cleanupForItem(item);
    const payload = await createProcessingPayload('preview', item, settings);
    const result = await runner.run(payload.message, payload.transfers, 20_000, controller.signal);
    if (controller.signal.aborted || result.state === 'cancelled') return;
    if (result.state !== 'completed') { els.previewStatus.textContent = result.error?.message || 'Preview unavailable'; return; }
    if (item.editPreviewUrl) revokeObjectUrl(item.editPreviewUrl);
    item.editPreviewBlob = new Blob([result.value.buffer], { type: result.value.mime });
    item.editPreviewUrl = trackObjectUrl(item.editPreviewBlob);
    renderComparison(item); renderMobileCanvas(item); els.previewStatus.textContent = 'Preview ready'; if (els.mobileCanvasStatus) els.mobileCanvasStatus.classList.add('hidden');
  } catch { if (!controller.signal.aborted) els.previewStatus.textContent = 'Preview unavailable'; if (els.mobileCanvasStatus) els.mobileCanvasStatus.classList.add('hidden'); }
}

function renderComparison(item) {
  if (!item?.originalUrl || !item.editPreviewUrl) { els.editComparison.classList.add('hidden'); return; }
  els.comparisonOriginal.src = item.originalUrl; els.comparisonEdited.src = item.editPreviewUrl;
  els.editComparison.classList.remove('hidden'); updateComparisonPosition();
}

function updateComparisonPosition() {
  const value = Number(els.comparisonRange.value);
  els.comparisonValue.textContent = String(value);
  els.comparisonOverlay.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  els.comparisonDivider.style.left = value + '%';
}

function setMobileMode(mode) {
  const labels = { adjust:'Adjust', crop:'Crop', cleanup:'Clean Up', design:'Text & Design', watermark:'Watermark', export:'Export' };
  state.mobileMode = labels[mode] ? mode : 'adjust';
  document.body.dataset.mobileTool = state.mobileMode;
  if (els.mobileSheetTitle) els.mobileSheetTitle.textContent = labels[state.mobileMode];
  for (const button of els.mobileToolButtons || []) button.classList.toggle('active', button.dataset.mobileTool === state.mobileMode);
}

function syncMobileEditingState() {
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  document.body.classList.toggle('mobile-editing', mobile && state.items.some((item) => item.inspect));
  const count = state.items.filter((item) => item.inspect).length;
  if (els.mobileBatchChip) { els.mobileBatchChip.textContent = `${count} image${count === 1 ? '' : 's'}`; els.mobileBatchChip.classList.toggle('hidden', count < 2); }
}

function exitMobileEditor() {
  document.body.classList.remove('mobile-editing');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMobileCanvas(item) {
  if (!els.mobileCanvasImage || !els.mobileCanvasEmpty) return;
  const src = state.mobileShowOriginal ? item?.originalUrl : (item?.editPreviewUrl || item?.outputUrl || item?.originalUrl);
  if (!src) { els.mobileCanvasImage.removeAttribute('src'); els.mobileCanvasImage.classList.add('hidden'); els.mobileCanvasEmpty.classList.remove('hidden'); return; }
  els.mobileCanvasImage.src = src; els.mobileCanvasImage.classList.remove('hidden'); els.mobileCanvasEmpty.classList.add('hidden');
}

function showCompatibility(message) { els.compatibility.textContent = message; els.compatibility.classList.remove('hidden'); }
function statusLabel(status) { return ({ inspecting: 'Inspecting', ready: 'Ready', processing: 'Processing', completed: 'Done', failed: 'Failed', unsupported: 'Unsupported', timed_out: 'Timed out', cancelled: 'Cancelled' })[status] || status; }
function formatBytes(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
