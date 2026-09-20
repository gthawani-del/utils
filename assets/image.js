import { SECURITY_BUDGET, validateBatchBudget, validateFileBudget } from '/lib/security/budget.js';
import { exportFilename } from '/lib/security/filename.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { trackObjectUrl, revokeObjectUrl, clearWorkspace } from '/lib/security/workspace.js';
import { IMAGE_PRESETS } from '/lib/image/presets.js';
import { DEFAULT_EDITS, normalizeEdits, editsEqual } from '/lib/image/edits.js';
import { createLayer, normalizeLayer } from '/lib/image/layers.js';
import { DEFAULT_WATERMARK, normalizeWatermark } from '/lib/image/watermark.js';
import { normalizeCleanup } from '/lib/image/cleanup.js';
import { normalizeTextSelection, selectionFromPoints, replacementLayerFromSelection } from '/lib/image/text-replace.js';
import { COMPILER_PRESETS, MAX_COMPILER_OUTPUTS, MAX_COMPILER_PACK_BYTES, normalizeCompilerOutput, normalizeCompilerOutputs, compilerSettings } from '/lib/image/compiler.js';
import { normalizePerformanceBudget } from '/lib/image/performance.js';
import { buildAssetDoctorReport } from '/lib/image/asset-doctor.js';
import { detectInformationRegions, chooseSmartFocus, smartCropSummary } from '/lib/image/smart-crop.js';
import { calculateCrop } from '/lib/image/math.js';
import { buildResponsiveVariants, buildPictureMarkup } from '/lib/image/web-pack.js';
import { detectWatermarkRegions, boxesToCleanupStrokes } from '/lib/image/watermark-detect.js';
import { shouldUseBrowserProcessor, processBrowserImage, optimizeBrowserImage } from '/lib/image/browser-processor.js';

const workerUrl = new URL('/workers/image.worker.js', location.origin);
const runner = new WorkerRunner(workerUrl);
const state = { items: [], selectedId: null, busy: false, useBrowserProcessor: shouldUseBrowserProcessor(), mobileStartOpen: true, editHistory: [], lastCommittedEdits: normalizeEdits(DEFAULT_EDITS), lastCommittedGeometry: { rotate: 0, flipX: false, flipY: false }, layers: [], selectedLayerId: null, watermarkLogoFile: null, cleanupPointerId: null, mobileMode: 'adjust', mobileAdjustKey: 'brightness', mobileShowOriginal: false, layerDrag: null, replaceDrag: null, mobilePrecision: false, compilerCustomOutputs: [], compilerSelectedIds: new Set(), redoHistory: [], previewTimer: 0, previewAbort: null };
const $ = (selector) => document.querySelector(selector);
const EDIT_KEYS = ['brightness','exposure','contrast','saturation','vibrance','highlights','shadows','temperature','tint','gamma','sharpen','blur','grayscale','sepia','straighten'];
const MOBILE_ADJUST_LABELS = { brightness:'Brightness', exposure:'Exposure', contrast:'Contrast', saturation:'Saturation', vibrance:'Vibrance', highlights:'Highlights', shadows:'Shadows', temperature:'Warmth', tint:'Tint', gamma:'Gamma', sharpen:'Sharpen', blur:'Blur', grayscale:'Black & White', sepia:'Sepia', straighten:'Straighten', rotate:'Rotate', flipX:'Flip Horizontal', flipY:'Flip Vertical' };
const els = {
  input: $('#file-input'), choose: $('#choose-files'), uploadIcon: $('#upload-icon-button'), add: $('#add-more'), desktopAdd: $('#desktop-add-image'), desktopCurrentFile: $('#desktop-current-file'), drop: $('#drop-zone'), workspace: $('#workspace'), list: $('#file-list'), count: $('#file-count'), mobileContinue: $('#mobile-continue'), mobileStartCount: $('#mobile-start-count'),
  originalPreview: $('#original-preview'), outputPreview: $('#output-preview'), originalStats: $('#original-stats'), outputStats: $('#output-stats'), metadata: $('#metadata-box'),
  compatibility: $('#compatibility'), preset: $('#preset'), resizeMode: $('#resize-mode'), width: $('#width'), height: $('#height'), percentage: $('#percentage'), longest: $('#longest-edge'), shortest: $('#shortest-edge'),
  percentageWrap: $('#percentage-wrap'), longestWrap: $('#longest-wrap'), shortestWrap: $('#shortest-wrap'), preserveAspect: $('#preserve-aspect'), cropMode: $('#crop-mode'), customRatio: $('#custom-ratio'), customRatioWrap: $('#custom-ratio-wrap'), freeCrop: $('#free-crop'),
  cropX: $('#crop-x'), cropY: $('#crop-y'), cropWidth: $('#crop-width'), cropHeight: $('#crop-height'), smartCropEnabled: $('#smart-crop-enabled'), smartCropAnalyze: $('#smart-crop-analyze'), smartCropStatus: $('#smart-crop-status'), smartCropX: $('#smart-crop-x'), smartCropY: $('#smart-crop-y'), smartCropXValue: $('#smart-crop-x-value'), smartCropYValue: $('#smart-crop-y-value'), format: $('#format'), quality: $('#quality'), qualityValue: $('#quality-value'), targetSize: $('#target-size'), background: $('#background'), rotate: $('#rotate'), flipX: $('#flip-x'), flipY: $('#flip-y'),
  prefix: $('#prefix'), suffix: $('#suffix'), preserveName: $('#preserve-name'), reset: $('#reset-settings'), processSelected: $('#process-selected'), processAll: $('#process-all'), downloadSelected: $('#download-selected'), downloadAll: $('#download-all'), clear: $('#clear-workspace'), jpegWarning: $('#jpeg-warning'), upscaleWarning: $('#upscale-warning'),
  editComparison: $('#edit-comparison'), comparisonOriginal: $('#comparison-original'), comparisonEdited: $('#comparison-edited'), comparisonOverlay: $('#comparison-overlay'), comparisonDivider: $('#comparison-divider'), comparisonRange: $('#comparison-range'), comparisonValue: $('#comparison-value'), previewStatus: $('#preview-status'),
  undoEdit: $('#undo-edit'), resetEdits: $('#reset-edits'), brightness: $('#brightness'), exposure: $('#exposure'), contrast: $('#contrast'), saturation: $('#saturation'), vibrance: $('#vibrance'), highlights: $('#highlights'), shadows: $('#shadows'), temperature: $('#temperature'), tint: $('#tint'), gamma: $('#gamma'), sharpen: $('#sharpen'), blur: $('#blur'), grayscale: $('#grayscale'), sepia: $('#sepia'), straighten: $('#straighten'),
  layerList: $('#layer-list'), layerProperties: $('#layer-properties'), layerTitle: $('#layer-title'), textLayerFields: $('#text-layer-fields'), shapeLayerFields: $('#shape-layer-fields'), addTextLayer: $('#add-text-layer'), addRectLayer: $('#add-rect-layer'), addCircleLayer: $('#add-circle-layer'), addLineLayer: $('#add-line-layer'), addArrowLayer: $('#add-arrow-layer'), addBackgroundLayer: $('#add-background-layer'), duplicateLayer: $('#duplicate-layer'), deleteLayer: $('#delete-layer'), layerUp: $('#layer-up'), layerDown: $('#layer-down'),
  layerText: $('#layer-text'), layerFont: $('#layer-font'), layerFontSize: $('#layer-font-size'), layerFontWeight: $('#layer-font-weight'), layerAlign: $('#layer-align'), layerColor: $('#layer-color'), layerLetterSpacing: $('#layer-letter-spacing'), layerLineSpacing: $('#layer-line-spacing'), layerStrokeWidth: $('#layer-stroke-width'), layerStrokeColor: $('#layer-stroke-color'), layerShadowEnabled: $('#layer-shadow-enabled'), layerShadowColor: $('#layer-shadow-color'), layerShadowBlur: $('#layer-shadow-blur'), layerShadowX: $('#layer-shadow-x'), layerShadowY: $('#layer-shadow-y'), layerBgEnabled: $('#layer-bg-enabled'), layerBgColor: $('#layer-bg-color'),
  layerFill: $('#layer-fill'), layerFill2: $('#layer-fill-2'), layerGradient: $('#layer-gradient'), layerGradientAngle: $('#layer-gradient-angle'), shapeStrokeColor: $('#shape-stroke-color'), shapeStrokeWidth: $('#shape-stroke-width'), layerX: $('#layer-x'), layerY: $('#layer-y'), layerWidth: $('#layer-width'), layerHeight: $('#layer-height'), layerRotation: $('#layer-rotation'), layerOpacity: $('#layer-opacity'),
  watermarkEnabled: $('#watermark-enabled'), watermarkControls: $('#watermark-controls'), watermarkType: $('#watermark-type'), watermarkPosition: $('#watermark-position'), watermarkOpacity: $('#watermark-opacity'), watermarkRotation: $('#watermark-rotation'), watermarkMargin: $('#watermark-margin'), watermarkTiled: $('#watermark-tiled'), watermarkTileGap: $('#watermark-tile-gap'), watermarkCustomPosition: $('#watermark-custom-position'), watermarkX: $('#watermark-x'), watermarkY: $('#watermark-y'), watermarkTextFields: $('#watermark-text-fields'), watermarkImageFields: $('#watermark-image-fields'), watermarkText: $('#watermark-text'), watermarkFont: $('#watermark-font'), watermarkFontSize: $('#watermark-font-size'), watermarkColor: $('#watermark-color'), watermarkLogoInput: $('#watermark-logo-input'), chooseWatermarkLogo: $('#choose-watermark-logo'), watermarkLogoName: $('#watermark-logo-name'), watermarkLogoWidth: $('#watermark-logo-width'),
  cleanupCanvas: $('#cleanup-canvas'), cleanupEmpty: $('#cleanup-empty'), cleanupState: $('#cleanup-state'), cleanupBrush: $('#cleanup-brush'), cleanupBrushValue: $('#cleanup-brush-value'), cleanupUndoStroke: $('#cleanup-undo-stroke'), cleanupClearMask: $('#cleanup-clear-mask'), cleanupApply: $('#cleanup-apply'), cleanupUndo: $('#cleanup-undo'), cleanupModeHint: $('#cleanup-mode-hint'), watermarkDetectBar: $('#watermark-detect-bar'), watermarkDetect: $('#watermark-detect'), watermarkDetectStatus: $('#watermark-detect-status'),
  replaceSelector: $('#replace-selector'), replaceSelectorImage: $('#replace-selector-image'), replaceSelectorEmpty: $('#replace-selector-empty'), replaceSelectionBox: $('#replace-selection-box'), mobileReplaceSelection: $('#mobile-replace-selection'), replaceStatus: $('#replace-status'), replaceText: $('#replace-text'), replaceFont: $('#replace-font'), replaceFontSize: $('#replace-font-size'), replaceFontWeight: $('#replace-font-weight'), replaceColor: $('#replace-color'), replaceAlign: $('#replace-align'), replaceClearSelection: $('#replace-clear-selection'), replaceApply: $('#replace-apply'), replaceUndo: $('#replace-undo'),
  mobileExit: $('#mobile-exit-editor'), mobileUndo: $('#mobile-undo-edit'), mobileRedo: $('#mobile-redo-edit'), mobileCompare: $('#mobile-compare'), mobileExportTop: $('#mobile-export-top'), mobileSheetBack: $('#mobile-sheet-back'), mobileMoreButtons: [...document.querySelectorAll('[data-mobile-more-target]')], mobileMoreRevert: $('#mobile-more-revert'), mobileMoreFiles: $('#mobile-more-files'), mobileCanvasImage: $('#mobile-canvas-image'), mobileCanvasEmpty: $('#mobile-canvas-empty'), mobileCanvasStatus: $('#mobile-canvas-status'), mobileLayerHint: $('#mobile-layer-hint'), mobileBatchChip: $('#mobile-batch-chip'), mobileSheetTitle: $('#mobile-sheet-title'), mobileToolButtons: [...document.querySelectorAll('[data-mobile-tool]')], mobileAdjustButtons: [...document.querySelectorAll('[data-adjust-key]')], mobileAdjustName: $('#mobile-adjust-name'), mobileAdjustValue: $('#mobile-adjust-value'), mobileCropButtons: [...document.querySelectorAll('[data-crop-choice]')], mobilePrecisionToggle: $('#mobile-precision-toggle'), mobileFilesBackdrop: $('#mobile-files-backdrop'), mobileFilesClose: $('#mobile-files-close'), mobileExportSelected: $('#mobile-export-selected'), mobileExportAll: $('#mobile-export-all'), mobileExportStatus: $('#mobile-export-status'),
  compilerPresetGrid: $('#compiler-preset-grid'), compilerCount: $('#compiler-count'), compilerFit: $('#compiler-fit'), compilerCustomName: $('#compiler-custom-name'), compilerCustomWidth: $('#compiler-custom-width'), compilerCustomHeight: $('#compiler-custom-height'), compilerAddCustom: $('#compiler-add-custom'), compilerCustomList: $('#compiler-custom-list'), compilerGenerate: $('#compiler-generate'), compilerStatus: $('#compiler-status'),
  assetDoctorRun: $('#asset-doctor-run'), assetDoctorList: $('#asset-doctor-list'), assetDoctorBadge: $('#asset-doctor-badge'), assetDoctorStatus: $('#asset-doctor-status'),
  webPackWidths: [...document.querySelectorAll('[data-web-width]')], webPackFormats: [...document.querySelectorAll('[data-web-format]')], webPackNoUpscale: $('#web-pack-no-upscale'), webPackGenerate: $('#web-pack-generate'), webPackCopy: $('#web-pack-copy'), webPackMarkup: $('#web-pack-markup'), webPackResult: $('#web-pack-result'), webPackStatus: $('#web-pack-status'),
  performanceMaxWidth: $('#performance-max-width'), performanceMaxSize: $('#performance-max-size'), performanceMinQuality: $('#performance-min-quality'), performanceMinQualityValue: $('#performance-min-quality-value'), performanceRun: $('#performance-run'), performanceDownload: $('#performance-download'), performanceResult: $('#performance-result'), performanceResultTitle: $('#performance-result-title'), performanceResultDetail: $('#performance-result-detail'), performanceStatus: $('#performance-status')
};

initialize();

function initialize() {
  if (!state.useBrowserProcessor && (!('Worker' in window) || !('OffscreenCanvas' in window) || !('createImageBitmap' in window))) {
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
  renderLayerList(); renderLayerProperties(); updateWatermarkConditional(); renderCompiler(); renderAssetDoctor(selectedItem()); setMobileMode('adjust'); setMobileAdjust('brightness'); syncMobileEditingState();
  if (state.useBrowserProcessor) showCompatibility('iPhone/iPad compatibility renderer active. Processing remains local in this browser.');
}

function wireEvents() {
  els.choose.addEventListener('click', openImagePicker);
  els.uploadIcon?.addEventListener('click', openImagePicker);
  els.desktopAdd?.addEventListener('click', () => els.input.click());
  els.add.addEventListener('click', openImagePicker);
  els.mobileContinue.addEventListener('click', enterMobileEditor);
  els.input.addEventListener('change', () => addFiles([...els.input.files]));
  for (const type of ['dragenter', 'dragover']) els.drop.addEventListener(type, (event) => { event.preventDefault(); els.drop.classList.add('dragging'); });
  for (const type of ['dragleave', 'drop']) els.drop.addEventListener(type, (event) => { event.preventDefault(); els.drop.classList.remove('dragging'); });
  els.drop.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));
  els.preset.addEventListener('change', applyPreset);
  els.resizeMode.addEventListener('change', () => { updateConditionalControls(); updateWarnings(); });
  els.cropMode.addEventListener('change', () => { updateConditionalControls(); syncMobileCropButtons(); syncSmartCropFocus(); scheduleEditPreview(80); });
  els.smartCropEnabled.addEventListener('change', async () => { if (els.smartCropEnabled.checked && !selectedItem()?.smartCrop?.analyzed) await runSmartCropAnalysis(); else { syncSmartCropFocus(); scheduleEditPreview(40); } });
  els.smartCropAnalyze.addEventListener('click', async () => { await runSmartCropAnalysis(); if (selectedItem()?.smartCrop?.analyzed) { els.smartCropEnabled.checked = true; syncSmartCropFocus(); scheduleEditPreview(20); } });
  for (const control of [els.smartCropX, els.smartCropY]) control.addEventListener('input', () => { const item=selectedItem(); if(!item)return; item.smartCrop.manual=true; item.smartCrop.focusX=Number(els.smartCropX.value)/100; item.smartCrop.focusY=Number(els.smartCropY.value)/100; updateSmartCropUi(item); scheduleEditPreview(40); });
  els.format.addEventListener('change', () => { updateWarnings(); els.targetSize.disabled = els.format.value === 'png'; });
  els.quality.addEventListener('input', () => { els.qualityValue.textContent = els.quality.value; });
  for (const el of [els.width, els.height, els.percentage, els.longest, els.shortest]) el.addEventListener('input', () => { updateWarnings(); invalidatePerformanceResult(); });
  for (const el of [els.customRatio, els.cropX, els.cropY, els.cropWidth, els.cropHeight]) el.addEventListener('input', () => scheduleEditPreview(100));
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
  for (const control of [els.rotate, els.flipX, els.flipY]) control.addEventListener('change', () => { updateMobileAdjustValue(); commitEditChange(); });
  els.undoEdit.addEventListener('click', undoEdit);
  els.resetEdits.addEventListener('click', resetEdits);
  els.comparisonRange.addEventListener('input', updateComparisonPosition);
  for (const button of document.querySelectorAll('.image-sidebar-nav-button')) button.addEventListener('click', () => setDesktopInspectorTool(button.dataset.sidebarTool));
  const addLayerButtons = [[els.addTextLayer,'text'],[els.addRectLayer,'rectangle'],[els.addCircleLayer,'circle'],[els.addLineLayer,'line'],[els.addArrowLayer,'arrow'],[els.addBackgroundLayer,'background']];
  for (const [button,type] of addLayerButtons) button.addEventListener('click', () => addDesignLayer(type));
  els.duplicateLayer.addEventListener('click', duplicateSelectedLayer); els.deleteLayer.addEventListener('click', deleteSelectedLayer); els.layerUp.addEventListener('click', () => moveSelectedLayer(1)); els.layerDown.addEventListener('click', () => moveSelectedLayer(-1));
  for (const control of layerControls()) { control.addEventListener('input', updateSelectedLayerFromControls); control.addEventListener('change', updateSelectedLayerFromControls); }
  for (const control of watermarkControls()) { control.addEventListener('input', () => { updateWatermarkConditional(); scheduleEditPreview(); }); control.addEventListener('change', () => { updateWatermarkConditional(); scheduleEditPreview(40); }); }
  els.chooseWatermarkLogo.addEventListener('click', () => els.watermarkLogoInput.click());
  els.watermarkLogoInput.addEventListener('change', () => setWatermarkLogo(els.watermarkLogoInput.files?.[0]));
  els.cleanupBrush.addEventListener('input', () => { els.cleanupBrushValue.textContent = els.cleanupBrush.value; });
  els.watermarkDetect.addEventListener('click', detectWatermarkMask);
    els.cleanupCanvas.addEventListener('pointerdown', beginCleanupStroke); els.cleanupCanvas.addEventListener('pointermove', continueCleanupStroke); els.cleanupCanvas.addEventListener('pointerup', endCleanupStroke); els.cleanupCanvas.addEventListener('pointercancel', endCleanupStroke);
  els.cleanupUndoStroke.addEventListener('click', undoCleanupStroke); els.cleanupClearMask.addEventListener('click', clearCleanupMask); els.cleanupApply.addEventListener('click', applyCleanupMask); els.cleanupUndo.addEventListener('click', undoCleanupApplication);
  for (const target of [els.replaceSelectorImage, els.mobileCanvasImage]) { target.addEventListener('pointerdown', beginReplaceSelection); target.addEventListener('pointermove', continueReplaceSelection); target.addEventListener('pointerup', endReplaceSelection); target.addEventListener('pointercancel', endReplaceSelection); }
  els.replaceClearSelection.addEventListener('click', clearReplaceSelection); els.replaceApply.addEventListener('click', applyTextReplacement); els.replaceUndo.addEventListener('click', undoTextReplacement);
  els.replaceText.addEventListener('input', () => updateReplaceButtons(selectedItem()));
  for (const button of els.mobileToolButtons) button.addEventListener('click', () => setMobileMode(button.dataset.mobileTool));
  for (const button of els.mobileAdjustButtons) button.addEventListener('click', () => setMobileAdjust(button.dataset.adjustKey));
  for (const button of els.mobileCropButtons) button.addEventListener('click', () => setMobileCrop(button.dataset.cropChoice));
  els.mobileExit.addEventListener('click', exitMobileEditor);
  els.mobileUndo.addEventListener('click', undoEdit);
  els.mobileRedo.addEventListener('click', redoEdit);
  els.mobileExportTop.addEventListener('click', () => setMobileMode('export'));
  els.mobileSheetBack.addEventListener('click', () => setMobileMode('more'));
  for (const button of els.mobileMoreButtons) button.addEventListener('click', () => setMobileMode(button.dataset.mobileMoreTarget));
  els.mobileMoreRevert.addEventListener('click', () => { resetToOriginal(); renderSelectedSafely(); setMobileMode('adjust'); });
  els.mobileMoreFiles.addEventListener('click', toggleMobileFiles);
  for (const type of ['pointerdown','keydown']) els.mobileCompare.addEventListener(type, (event) => { if (type === 'keydown' && ![' ','Enter'].includes(event.key)) return; state.mobileShowOriginal = true; renderMobileCanvas(selectedItem()); });
  for (const type of ['pointerup','pointercancel','pointerleave','keyup']) els.mobileCompare.addEventListener(type, () => { state.mobileShowOriginal = false; renderMobileCanvas(selectedItem()); });
  els.mobileBatchChip.addEventListener('click', toggleMobileFiles);
  els.mobileFilesBackdrop.addEventListener('click', closeMobileFiles); els.mobileFilesClose.addEventListener('click', closeMobileFiles);
  els.mobileExportSelected.addEventListener('click', mobileExportSelected); els.mobileExportAll.addEventListener('click', mobileExportAll);
  els.compilerAddCustom.addEventListener('click', addCompilerCustomOutput); els.compilerGenerate.addEventListener('click', generateCompilerPack);
  els.performanceMinQuality.addEventListener('input', () => { els.performanceMinQualityValue.textContent = els.performanceMinQuality.value; invalidatePerformanceResult(); });
  for (const control of [els.performanceMaxWidth, els.performanceMaxSize]) control.addEventListener('input', invalidatePerformanceResult);
  els.assetDoctorRun.addEventListener('click', () => runAssetDoctor());
  els.webPackGenerate.addEventListener('click', generateWebPack);
  els.webPackCopy.addEventListener('click', copyWebPackMarkup);
  els.performanceRun.addEventListener('click', runPerformanceBudget); els.performanceDownload.addEventListener('click', downloadPerformanceResult);
  els.mobilePrecisionToggle.addEventListener('click', toggleMobilePrecision);
  els.mobileCanvasImage.addEventListener('pointerdown', beginLayerDrag); els.mobileCanvasImage.addEventListener('pointermove', continueLayerDrag); els.mobileCanvasImage.addEventListener('pointerup', endLayerDrag); els.mobileCanvasImage.addEventListener('pointercancel', endLayerDrag);
  window.addEventListener('resize', () => { syncMobileEditingState(); if (['cleanup','watermarkremove'].includes(state.mobileMode)) requestAnimationFrame(() => renderCleanupEditor(selectedItem())); });
  window.addEventListener('pagehide', () => { state.previewAbort?.abort(); cleanupUrls(); });
}

function openImagePicker() {
  if (state.busy) return;
  els.input.value = '';
  try {
    if (typeof els.input.showPicker === 'function') els.input.showPicker();
    else els.input.click();
  } catch {
    els.input.click();
  }
}

function safeUiCall(fn) {
  try { return fn(); } catch { return undefined; }
}

function renderSelectedSafely() {
  try { renderSelected(); }
  catch {
    const item = selectedItem();
    if (item?.originalUrl) {
      els.originalPreview.replaceChildren();
      addPreviewImage(els.originalPreview, item.originalUrl, `Original ${item.file.name}`);
      renderMobileCanvas(item);
    }
    safeUiCall(updateButtons);
  }
}

async function addFiles(files) {
  if (!files.length || state.busy) return;
  const combined = [...state.items.map((item) => item.file), ...files];
  const batchCheck = validateBatchBudget(combined);
  if (!batchCheck.ok) { els.input.value = ''; return showCompatibility(batchCheck.reason); }
  try {
  for (const file of files) {
    const budget = validateFileBudget(file);
    if (!budget.ok) {
      state.items.push(makeRejectedItem(file, budget.reason));
      continue;
    }
    const item = { id: crypto.randomUUID(), file, status: 'inspecting', inspect: null, error: '', originalUrl: '', outputBlob: null, outputUrl: '', outputName: '', editPreviewUrl: '', editPreviewBlob: null, cleanupStrokes: [], cleanupApplied: false, cleanupImage: null, replaceSelection: null, textReplacements: [], replaceHistory: [], performanceResult: null, performanceResultUrl: '', transparencyDetected: null, assetDoctorReport: null, smartCrop: { analyzed:false, regions:[], manual:false, focusX:.5, focusY:.5, summary:null } };
    state.items.push(item);
    renderList();
    try {
      const buffer = await file.arrayBuffer();
      const result = await runner.run({ op: 'inspect', buffer }, [buffer]);
      if (result.state === 'completed') {
        item.inspect = result.value;
        item.status = 'ready';
        if (result.value.kind !== 'svg') item.originalUrl = trackObjectUrl(file);
        if (!state.selectedId) {
          state.selectedId = item.id;
          state.mobileStartOpen = false;
          syncMobileEditingState();
          try { resetToOriginal(); } catch { showCompatibility('The image loaded, but some editor controls could not be initialized. The original image remains available.'); }
        }
        renderList();
        renderSelectedSafely();
        syncMobileEditingState();
      } else {
        item.status = result.state;
        item.error = result.error?.message || 'Unsupported image.';
      }
    } catch {
      item.status = 'failed'; item.error = 'The file could not be inspected safely.';
    }
  }
  } finally {
    els.input.value = '';
    els.workspace.classList.toggle('hidden', state.items.length === 0);
    document.body.classList.toggle('has-image-workspace', state.items.length > 0);
    if (!state.selectedId) {
      const firstReady = state.items.find((item) => item.status === 'ready');
      if (firstReady) {
        state.selectedId = firstReady.id;
        state.mobileStartOpen = false;
        syncMobileEditingState();
        try { resetToOriginal(); } catch {}
      }
    }
    renderList(); renderSelectedSafely(); syncMobileEditingState();
  }
}

function makeRejectedItem(file, reason) {
  return { id: crypto.randomUUID(), file, status: 'unsupported', inspect: null, error: reason, originalUrl: '', outputBlob: null, outputUrl: '', outputName: '', editPreviewUrl: '', editPreviewBlob: null, cleanupStrokes: [], cleanupApplied: false, cleanupImage: null, replaceSelection: null, textReplacements: [], replaceHistory: [], performanceResult: null, performanceResultUrl: '', transparencyDetected: null, assetDoctorReport: null, smartCrop: { analyzed:false, regions:[], manual:false, focusX:.5, focusY:.5, summary:null } };
}

function selectItem(id, reset = false) {
  state.selectedId = id;
  state.mobileStartOpen = false;
  syncMobileEditingState();
  if (state.selectedLayerId && !layersForItem().some((layer) => layer.id === state.selectedLayerId)) state.selectedLayerId = null;
  if (reset) {
    try { resetToOriginal(); }
    catch { showCompatibility('The image is selected, but some editor controls could not be initialized.'); }
  }
  renderList(); renderSelectedSafely(); syncMobileEditingState();
  if (window.matchMedia('(max-width: 700px)').matches) closeMobileFiles();
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
  renderMobileCanvas(item);
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
  if (item.editPreviewUrl) {
    addPreviewImage(els.outputPreview, item.editPreviewUrl, `Edit preview ${item.file.name}`);
  } else if (item.outputUrl && item.outputBlob) {
    addPreviewImage(els.outputPreview, item.outputUrl, `Processed ${item.file.name}`);
    const reduction = item.file.size ? Math.round((1 - item.outputBlob.size / item.file.size) * 100) : 0;
    fillStats(els.outputStats, [['Format', item.outputBlob.type.replace('image/', '').toUpperCase()], ['Dimensions', `${item.outputWidth} × ${item.outputHeight}`], ['Size', formatBytes(item.outputBlob.size)], ['Change', `${reduction >= 0 ? reduction + '% smaller' : Math.abs(reduction) + '% larger'}`]]);
  } else if (item.originalUrl) {
    addPreviewImage(els.outputPreview, item.originalUrl, `Edit preview ${item.file.name}`);
  } else {
    els.outputPreview.textContent = item.status === 'processing' ? 'Processing…' : (item.error && item.status !== 'ready' ? item.error : 'Preview unavailable');
  }
  safeUiCall(() => renderComparison(item));
  safeUiCall(() => renderCleanupEditor(item));
  safeUiCall(() => renderReplaceSelector(item));
  safeUiCall(() => renderPerformanceResult(item));
  safeUiCall(() => renderAssetDoctor(item));
  safeUiCall(() => updateSmartCropUi(item));
  safeUiCall(updateWarnings); safeUiCall(updateButtons);
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
  item.cleanupStrokes = []; item.cleanupApplied = false; item.replaceSelection = null; item.textReplacements = []; item.replaceHistory = []; item.assetDoctorReport = null; item.smartCrop={analyzed:false,regions:[],manual:false,focusX:.5,focusY:.5,summary:null}; els.smartCropEnabled.checked=false; invalidatePerformanceResult(item); renderCleanupEditor(item); renderReplaceSelector(item);
  if (item.editPreviewUrl) { revokeObjectUrl(item.editPreviewUrl); item.editPreviewUrl = ''; item.editPreviewBlob = null; }
  els.editComparison.classList.add('hidden');
  updateConditionalControls(); syncMobileCropButtons(); updateWarnings();
}

function applyPreset() {
  const preset = IMAGE_PRESETS.find((item) => item.id === els.preset.value);
  if (!preset) return;
  els.resizeMode.value = 'fill'; els.width.value = preset.width; els.height.value = preset.height; updateConditionalControls(); updateWarnings(); scheduleEditPreview(80);
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
  const item=selectedItem();
  const smartFocus = els.smartCropEnabled.checked ? smartFocusForCurrentSettings(item, crop) : { focusX:.5, focusY:.5 };
  if (crop.mode === 'ratio' && els.smartCropEnabled.checked) crop = { ...crop, focusX:smartFocus.focusX, focusY:smartFocus.focusY };
  return {
    resizeMode: els.resizeMode.value, width: Number(els.width.value), height: Number(els.height.value), percentage: Number(els.percentage.value), longestEdge: Number(els.longest.value), shortestEdge: Number(els.shortest.value), preserveAspect: els.preserveAspect.checked,
    crop, smartCrop: { enabled:els.smartCropEnabled.checked, focusX:smartFocus.focusX, focusY:smartFocus.focusY }, format: els.format.value, quality: Number(els.quality.value) / 100, targetBytes: els.targetSize.value ? Number(els.targetSize.value) * 1024 : 0, background: els.background.value, rotate: Number(els.rotate.value), flipX: els.flipX.checked, flipY: els.flipY.checked, edits: collectEdits(), layers: state.layers.map((layer) => ({ ...layer })), watermark: collectWatermark()
  };
}

async function processSelected() {
  const item = selectedItem(); if (!item || item.status === 'unsupported' || item.status === 'failed') return;
  await runAssetDoctor({ quiet:true });
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
    const effectiveSettings = { ...settings, layers: layersForItem(item), cleanup: cleanupForItem(item), textReplacements: item.textReplacements || [] };
    const result = await runImageOperation('process', item, effectiveSettings);
    if (result.state !== 'completed') { item.status = result.state; item.error = result.error?.message || 'Processing failed.'; return; }
    const value = result.value; const blob = new Blob([value.buffer], { type: value.mime });
    item.outputBlob = blob; item.outputUrl = trackObjectUrl(blob); item.outputWidth = value.width; item.outputHeight = value.height; item.status = 'completed';
    const ext = value.kind === 'jpeg' ? 'jpg' : value.kind;
    item.outputName = exportFilename(item.file.name, ext, { prefix: els.prefix.value, suffix: els.suffix.value, preserveOriginal: els.preserveName.checked });
  } catch { item.status = 'failed'; item.error = 'Processing failed safely.'; }
}

function setBusy(value) { state.busy = value; updateButtons(); updateCompilerState(); els.processSelected.textContent = value ? 'Processing…' : 'Process selected'; }

function updateButtons() {
  const item = selectedItem();
  els.processSelected.disabled = state.busy || !item?.inspect;
  els.processAll.disabled = state.busy || !state.items.some((entry) => entry.inspect);
  els.downloadSelected.disabled = state.busy || !item?.outputBlob;
  els.downloadAll.disabled = state.busy || !state.items.some((entry) => entry.outputBlob);
  els.add.disabled = state.busy;
  if (els.mobileExportSelected) els.mobileExportSelected.disabled = state.busy || !item?.inspect;
  if (els.mobileExportAll) els.mobileExportAll.disabled = state.busy || !state.items.some((entry) => entry.inspect);
  if (els.performanceRun) els.performanceRun.disabled = state.busy || !item?.inspect;
  if (els.performanceDownload) els.performanceDownload.disabled = state.busy || !item?.performanceResult;
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
  closeMobileFiles(); state.mobileStartOpen = true; state.previewAbort?.abort(); clearTimeout(state.previewTimer); runner.terminateAll(); cleanupUrls(); state.items = []; state.selectedId = null; state.editHistory = []; state.lastCommittedEdits = normalizeEdits(DEFAULT_EDITS); state.layers = []; state.selectedLayerId = null; state.watermarkLogoFile = null; state.compilerCustomOutputs = []; state.compilerSelectedIds = new Set(); state.redoHistory = []; renderCompiler(); renderLayerList(); renderLayerProperties(); resetWatermarkControls(); await clearWorkspace(); els.workspace.classList.add('hidden'); document.body.classList.remove('has-image-workspace'); els.list.replaceChildren(); els.input.value = ''; syncMobileEditingState(); els.clear.textContent = 'Workspace cleared'; setTimeout(() => { els.clear.textContent = 'Clear workspace'; }, 1600);
}

function cleanupUrls() { for (const item of state.items) { revokeObjectUrl(item.originalUrl); revokeObjectUrl(item.outputUrl); revokeObjectUrl(item.editPreviewUrl); revokeObjectUrl(item.performanceResultUrl); item.originalUrl = ''; item.outputUrl = ''; item.editPreviewUrl = ''; item.performanceResultUrl = ''; } }
function renderReplaceSelector(item) {
  const src = item?.editPreviewUrl || item?.outputUrl || item?.originalUrl || '';
  if (src) { els.replaceSelectorImage.src = src; els.replaceSelectorImage.classList.remove('hidden'); els.replaceSelectorEmpty.classList.add('hidden'); }
  else { els.replaceSelectorImage.removeAttribute('src'); els.replaceSelectorImage.classList.add('hidden'); els.replaceSelectorEmpty.classList.remove('hidden'); }
  renderReplaceSelectionBox(els.replaceSelectionBox, els.replaceSelectorImage, item?.replaceSelection);
  renderReplaceSelectionBox(els.mobileReplaceSelection, els.mobileCanvasImage, item?.replaceSelection);
  updateReplaceButtons(item);
}

function replacePoint(event, image) {
  const rect = image.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) };
}

function beginReplaceSelection(event) {
  const item = selectedItem(); const image = event.currentTarget;
  const isMobileCanvas = image === els.mobileCanvasImage;
  if (!item?.inspect || item.inspect.kind === 'svg' || !image.getAttribute('src')) return;
  if (isMobileCanvas && state.mobileMode !== 'replace') return;
  if (!isMobileCanvas && window.matchMedia('(max-width: 700px)').matches) return;
  event.preventDefault(); image.setPointerCapture?.(event.pointerId);
  const start = replacePoint(event, image); state.replaceDrag = { pointerId: event.pointerId, image, start };
  item.replaceSelection = normalizeTextSelection({ x: start.x, y: start.y, width: .005, height: .005 });
  renderReplaceSelector(item); els.replaceStatus.textContent = 'Selecting…';
}

function continueReplaceSelection(event) {
  const drag = state.replaceDrag; if (!drag || drag.pointerId !== event.pointerId || drag.image !== event.currentTarget) return;
  const item = selectedItem(); if (!item) return;
  item.replaceSelection = selectionFromPoints(drag.start, replacePoint(event, drag.image)); renderReplaceSelector(item); event.preventDefault();
}

function endReplaceSelection(event) {
  const drag = state.replaceDrag; if (!drag || drag.pointerId !== event.pointerId) return;
  state.replaceDrag = null; const item = selectedItem(); updateReplaceButtons(item);
  els.replaceStatus.textContent = item?.replaceSelection ? 'Area selected' : 'Select an area';
}

function renderReplaceSelectionBox(box, image, selection) {
  if (!box || !image || !selection || !image.getAttribute('src')) { box?.classList.add('hidden'); return; }
  const imageRect = image.getBoundingClientRect(); const parentRect = box.parentElement.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) { box.classList.add('hidden'); return; }
  box.style.left = (imageRect.left - parentRect.left + selection.x * imageRect.width) + 'px';
  box.style.top = (imageRect.top - parentRect.top + selection.y * imageRect.height) + 'px';
  box.style.width = (selection.width * imageRect.width) + 'px'; box.style.height = (selection.height * imageRect.height) + 'px';
  box.classList.remove('hidden');
}

function clearReplaceSelection() { const item = selectedItem(); if (!item) return; item.replaceSelection = null; renderReplaceSelector(item); els.replaceStatus.textContent = 'Select an area'; }

function updateReplaceButtons(item) {
  const hasSelection = Boolean(item?.replaceSelection);
  els.replaceClearSelection.disabled = !hasSelection; els.replaceApply.disabled = !hasSelection || !els.replaceText.value.trim(); els.replaceUndo.disabled = !(item?.replaceHistory?.length);
}
function replacementStyle() { return { text: els.replaceText.value.trim(), fontFamily: els.replaceFont.value, fontSize: Number(els.replaceFontSize.value), fontWeight: Number(els.replaceFontWeight.value), color: els.replaceColor.value, align: els.replaceAlign.value }; }

function applyTextReplacement() {
  const item = selectedItem(); if (!item?.replaceSelection || !els.replaceText.value.trim()) return;
  const regionId = crypto.randomUUID(), layerId = crypto.randomUUID(), selection = normalizeTextSelection(item.replaceSelection);
  item.textReplacements.push({ id: regionId, selection });
  const layer = replacementLayerFromSelection(selection, replacementStyle(), layerId); layer.scopeItemId = item.id;
  state.layers.push(layer); state.selectedLayerId = layerId; item.replaceHistory.push({ regionId, layerId }); item.replaceSelection = null;
  renderLayerList(); renderLayerProperties(); renderReplaceSelector(item); els.replaceStatus.textContent = 'Replacement added · editable under Text'; scheduleEditPreview(20);
}

function undoTextReplacement() {
  const item = selectedItem(); const last = item?.replaceHistory?.pop(); if (!item || !last) return;
  item.textReplacements = item.textReplacements.filter((entry) => entry.id !== last.regionId);
  state.layers = state.layers.filter((layer) => layer.id !== last.layerId);
  if (state.selectedLayerId === last.layerId) state.selectedLayerId = null;
  renderLayerList(); renderLayerProperties(); renderReplaceSelector(item); els.replaceStatus.textContent = 'Replacement undone'; scheduleEditPreview(20);
}

async function detectWatermarkMask() {
  const item=selectedItem(); if(!item?.originalUrl||item.inspect?.kind==='svg'||state.busy)return;
  els.watermarkDetect.disabled=true;els.watermarkDetectStatus.textContent='Scanning locally…';
  try{
    const img=els.mobileCanvasImage;
    if(!(img.complete&&img.naturalWidth>0)) throw new Error('Main preview unavailable');
    const edge=600,scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=c.getContext('2d',{alpha:false,willReadFrequently:true});ctx.drawImage(img,0,0,c.width,c.height);
    const data=ctx.getImageData(0,0,c.width,c.height);
    let boxes=detectWatermarkRegions(data.data,c.width,c.height,{maxRegions:3});
    if('TextDetector' in window){
      try{
        const detected=await new TextDetector().detect(img);
        for(const entry of detected||[]){const b=entry.boundingBox;if(b?.width>4&&b?.height>4)boxes.push({x:b.x/img.naturalWidth,y:b.y/img.naturalHeight,width:b.width/img.naturalWidth,height:b.height/img.naturalHeight,score:2});}
      }catch{}
    }
    boxes=boxes.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3);
    if(!boxes.length){els.watermarkDetectStatus.textContent='No likely watermark found · brush manually';return;}
    item.cleanupStrokes=boxesToCleanupStrokes(boxes,{maxStrokes:80});item.cleanupApplied=false;paintCleanupCanvas(item);updateCleanupButtons(item);
    els.cleanupState.textContent='Detected mask ready';
    els.watermarkDetectStatus.textContent=`${boxes.length} likely watermark area${boxes.length===1?'':'s'} · adjust mask if needed`;
  }catch{els.watermarkDetectStatus.textContent='Detection unavailable · brush manually';}
  finally{els.watermarkDetect.disabled=false;}
}

function cleanupForItem(item) { return normalizeCleanup({ enabled:Boolean(item?.cleanupApplied), strokes:item?.cleanupStrokes || [] }); }
function cleanupPointFromEvent(event) { const rect=els.cleanupCanvas.getBoundingClientRect(); return { x:Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))), y:Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height))) }; }
function beginCleanupStroke(event) { const item=selectedItem(); if(!item?.originalUrl||item.inspect?.kind==='svg'||!els.mobileCanvasImage.complete||!els.mobileCanvasImage.naturalWidth) return; event.preventDefault(); els.cleanupCanvas.setPointerCapture?.(event.pointerId); state.cleanupPointerId=event.pointerId; const rect=els.cleanupCanvas.getBoundingClientRect(); const radius=(Number(els.cleanupBrush.value)/2)/Math.max(1,Math.min(rect.width,rect.height)); item.cleanupStrokes.push({radius,points:[cleanupPointFromEvent(event)]}); item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); }
function continueCleanupStroke(event) { if(state.cleanupPointerId!==event.pointerId) return; const item=selectedItem(); const stroke=item?.cleanupStrokes?.[item.cleanupStrokes.length-1]; if(!stroke)return; const point=cleanupPointFromEvent(event); const last=stroke.points[stroke.points.length-1]; if(Math.hypot(point.x-last.x,point.y-last.y)<.002)return; stroke.points.push(point); paintCleanupCanvas(item); }
function endCleanupStroke(event) { if(state.cleanupPointerId!==event.pointerId)return; state.cleanupPointerId=null; const item=selectedItem(); if(item){ item.cleanupApplied=false; updateCleanupButtons(item); els.cleanupState.textContent=state.mobileMode==='watermarkremove'?'Watermark mask ready':'Mask ready'; scheduleEditPreview(80); } }
function undoCleanupStroke() { const item=selectedItem(); if(!item?.cleanupStrokes?.length)return; item.cleanupStrokes.pop(); item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); scheduleEditPreview(60); }
function clearCleanupMask() { const item=selectedItem(); if(!item)return; const wasApplied=item.cleanupApplied; item.cleanupStrokes=[]; item.cleanupApplied=false; paintCleanupCanvas(item); updateCleanupButtons(item); if(wasApplied)scheduleEditPreview(40); }
function applyCleanupMask() { const item=selectedItem(); if(!item?.cleanupStrokes?.length)return; item.cleanupApplied=true; updateCleanupButtons(item); els.cleanupState.textContent=state.mobileMode==='watermarkremove'?'Watermark removal active':'Cleanup active'; scheduleEditPreview(20); }
function undoCleanupApplication() { const item=selectedItem(); if(!item?.cleanupApplied)return; item.cleanupApplied=false; updateCleanupButtons(item); els.cleanupState.textContent='Mask kept · cleanup undone'; scheduleEditPreview(20); }
function updateCleanupButtons(item) { const count=item?.cleanupStrokes?.length||0; const watermarkMode=state.mobileMode==='watermarkremove'; els.cleanupUndoStroke.disabled=count===0; els.cleanupClearMask.disabled=count===0; els.cleanupApply.disabled=count===0||Boolean(item?.cleanupApplied); els.cleanupUndo.disabled=!item?.cleanupApplied; if(!count)els.cleanupState.textContent=watermarkMode?'Brush over watermark':'No mask'; else if(item.cleanupApplied)els.cleanupState.textContent=watermarkMode?'Watermark removal active':'Cleanup active'; else els.cleanupState.textContent=`${count} stroke${count===1?'':'s'} ready`; }
function cleanupRenderedImageRect() {
  const img=els.mobileCanvasImage;
  const frame=img.getBoundingClientRect();
  const nw=img.naturalWidth||1, nh=img.naturalHeight||1;
  const scale=Math.min(frame.width/nw, frame.height/nh);
  const width=nw*scale, height=nh*scale;
  return { left:frame.left+(frame.width-width)/2, top:frame.top+(frame.height-height)/2, width, height };
}

function positionCleanupOverlay() {
  const item=selectedItem(); if(!item?.inspect||item.inspect.kind==='svg'||!els.mobileCanvasImage.complete||!els.mobileCanvasImage.naturalWidth)return false;
  const rect=cleanupRenderedImageRect();
  const shell=els.cleanupCanvas.closest('.cleanup-canvas-shell');
  shell.style.left=`${rect.left}px`;
  shell.style.top=`${rect.top}px`;
  shell.style.width=`${rect.width}px`;
  shell.style.height=`${rect.height}px`;
  shell.style.right='auto'; shell.style.bottom='auto';
  const scale=Math.min(1,900/els.mobileCanvasImage.naturalWidth,520/els.mobileCanvasImage.naturalHeight);
  els.cleanupCanvas.width=Math.max(1,Math.round(els.mobileCanvasImage.naturalWidth*scale));
  els.cleanupCanvas.height=Math.max(1,Math.round(els.mobileCanvasImage.naturalHeight*scale));
  return true;
}

function renderCleanupEditor(item) {
  const ctx=els.cleanupCanvas.getContext('2d');
  if(!item?.originalUrl||item.inspect?.kind==='svg'){
    ctx.clearRect(0,0,els.cleanupCanvas.width,els.cleanupCanvas.height);
    els.cleanupEmpty.classList.remove('hidden'); updateCleanupButtons(item); return;
  }
  els.cleanupEmpty.classList.add('hidden');
  if(!positionCleanupOverlay()){
    requestAnimationFrame(()=>renderCleanupEditor(item));
    return;
  }
  paintCleanupCanvas(item); updateCleanupButtons(item);
}
function paintCleanupCanvas(item) {
  const canvas=els.cleanupCanvas,ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.strokeStyle='rgba(220,38,38,.62)';ctx.fillStyle='rgba(220,38,38,.62)';ctx.lineCap='round';ctx.lineJoin='round';
  for(const stroke of item?.cleanupStrokes||[]){const radius=stroke.radius*Math.min(canvas.width,canvas.height),pts=stroke.points||[];if(!pts.length)continue;ctx.lineWidth=Math.max(2,radius*2);if(pts.length===1){ctx.beginPath();ctx.arc(pts[0].x*canvas.width,pts[0].y*canvas.height,radius,0,Math.PI*2);ctx.fill();continue;}ctx.beginPath();ctx.moveTo(pts[0].x*canvas.width,pts[0].y*canvas.height);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x*canvas.width,pts[i].y*canvas.height);ctx.stroke();}ctx.restore();
}

function watermarkControls() { return [els.watermarkEnabled,els.watermarkType,els.watermarkPosition,els.watermarkOpacity,els.watermarkRotation,els.watermarkMargin,els.watermarkTiled,els.watermarkTileGap,els.watermarkX,els.watermarkY,els.watermarkText,els.watermarkFont,els.watermarkFontSize,els.watermarkColor,els.watermarkLogoWidth]; }
function collectWatermark() { return normalizeWatermark({ enabled:els.watermarkEnabled.checked,type:els.watermarkType.value,position:els.watermarkPosition.value,opacity:Number(els.watermarkOpacity.value)/100,rotation:Number(els.watermarkRotation.value),margin:Number(els.watermarkMargin.value),tiled:els.watermarkTiled.checked,tileGap:Number(els.watermarkTileGap.value),x:Number(els.watermarkX.value),y:Number(els.watermarkY.value),text:els.watermarkText.value,fontFamily:els.watermarkFont.value,fontSize:Number(els.watermarkFontSize.value),color:els.watermarkColor.value,logoWidth:Number(els.watermarkLogoWidth.value) }); }
function updateWatermarkConditional() { const enabled=els.watermarkEnabled.checked; els.watermarkControls.classList.toggle('hidden',!enabled); const image=els.watermarkType.value==='image'; els.watermarkTextFields.classList.toggle('hidden',image); els.watermarkImageFields.classList.toggle('hidden',!image); els.watermarkCustomPosition.classList.toggle('hidden',els.watermarkPosition.value!=='custom'||!enabled); }
function resetWatermarkControls() { const r=DEFAULT_WATERMARK; els.watermarkEnabled.checked=false; els.watermarkType.value=r.type; els.watermarkPosition.value=r.position; els.watermarkOpacity.value=Math.round(r.opacity*100); els.watermarkRotation.value=r.rotation; els.watermarkMargin.value=r.margin; els.watermarkTiled.checked=r.tiled; els.watermarkTileGap.value=r.tileGap; els.watermarkX.value=r.x; els.watermarkY.value=r.y; els.watermarkText.value=r.text; els.watermarkFont.value=r.fontFamily; els.watermarkFontSize.value=r.fontSize; els.watermarkColor.value=r.color; els.watermarkLogoWidth.value=r.logoWidth; els.watermarkLogoInput.value=''; els.watermarkLogoName.textContent='No logo selected'; state.watermarkLogoFile=null; updateWatermarkConditional(); }
async function setWatermarkLogo(file) { if(!file) return; const budget=validateFileBudget(file); if(!budget.ok){ showCompatibility(budget.reason); return; } try { const buffer=await file.arrayBuffer(); const result=await runner.run({op:'inspect',buffer},[buffer],15_000); if(result.state!=='completed'||!['jpeg','png','webp','avif'].includes(result.value.kind)){ showCompatibility('Watermark logos must be a valid JPEG, PNG, WebP, or AVIF image.'); els.watermarkLogoInput.value=''; return; } state.watermarkLogoFile=file; els.watermarkLogoName.textContent=file.name; els.watermarkEnabled.checked=true; els.watermarkType.value='image'; updateWatermarkConditional(); scheduleEditPreview(40); } catch { showCompatibility('The watermark image could not be inspected safely.'); } }
async function runImageOperation(op, item, settings, timeoutMs = 30_000, signal) {
  if (state.useBrowserProcessor && ['preview','process','performance-budget'].includes(op)) {
    const options = { preview: op === 'preview', watermarkLogoFile: state.watermarkLogoFile, signal };
    return op === 'performance-budget'
      ? optimizeBrowserImage(item.file, settings, options)
      : processBrowserImage(item.file, settings, options);
  }
  const payload = await createProcessingPayload(op, item, settings);
  return runner.run(payload.message, payload.transfers, timeoutMs, signal);
}

async function createProcessingPayload(op,item,settings) { const buffer=await item.file.arrayBuffer(); const message={op,buffer,settings}; const transfers=[buffer]; if(settings.watermark?.enabled&&settings.watermark.type==='image'&&state.watermarkLogoFile){ const watermarkLogoBuffer=await state.watermarkLogoFile.arrayBuffer(); message.watermarkLogoBuffer=watermarkLogoBuffer; transfers.push(watermarkLogoBuffer); } return {message,transfers}; }

function toggleMobilePrecision() {
  state.mobilePrecision = !state.mobilePrecision;
  document.body.classList.toggle('mobile-show-precision', state.mobilePrecision);
  els.mobilePrecisionToggle.textContent = state.mobilePrecision ? 'Hide precision' : 'Precision';
}

function updateMobileLayerHint() {
  if (!els.mobileLayerHint) return;
  const visible = ['text','design'].includes(state.mobileMode) && Boolean(selectedDesignLayer());
  els.mobileLayerHint.classList.toggle('hidden', !visible);
}

function beginLayerDrag(event) {
  if (!['text','design'].includes(state.mobileMode)) return;
  const layer = selectedDesignLayer(); if (!layer) return;
  const rect = els.mobileCanvasImage.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const currentX = rect.left + rect.width * layer.x / 100; const currentY = rect.top + rect.height * layer.y / 100;
  state.layerDrag = { pointerId:event.pointerId, offsetX:event.clientX-currentX, offsetY:event.clientY-currentY };
  els.mobileCanvasImage.setPointerCapture?.(event.pointerId); event.preventDefault();
}

function continueLayerDrag(event) {
  const drag = state.layerDrag; if (!drag || drag.pointerId !== event.pointerId) return;
  const layer = selectedDesignLayer(); if (!layer) return;
  const rect = els.mobileCanvasImage.getBoundingClientRect();
  const x = ((event.clientX-drag.offsetX-rect.left)/Math.max(1,rect.width))*100; const y = ((event.clientY-drag.offsetY-rect.top)/Math.max(1,rect.height))*100;
  const next = normalizeLayer({ ...layer, x, y }); const index = state.layers.findIndex((entry)=>entry.id===layer.id); state.layers[index]=next;
  els.layerX.value = next.x; els.layerY.value = next.y; renderLayerList(); scheduleEditPreview(70); event.preventDefault();
}

function endLayerDrag(event) { if (!state.layerDrag || state.layerDrag.pointerId !== event.pointerId) return; state.layerDrag = null; scheduleEditPreview(20); }

function layerControls() {
  return [els.layerText,els.layerFont,els.layerFontSize,els.layerFontWeight,els.layerAlign,els.layerColor,els.layerLetterSpacing,els.layerLineSpacing,els.layerStrokeWidth,els.layerStrokeColor,els.layerShadowEnabled,els.layerShadowColor,els.layerShadowBlur,els.layerShadowX,els.layerShadowY,els.layerBgEnabled,els.layerBgColor,els.layerFill,els.layerFill2,els.layerGradient,els.layerGradientAngle,els.shapeStrokeColor,els.shapeStrokeWidth,els.layerX,els.layerY,els.layerWidth,els.layerHeight,els.layerRotation,els.layerOpacity];
}

function addDesignLayer(type) {
  const layer = createLayer(type, crypto.randomUUID());
  state.layers.push(layer); state.selectedLayerId = layer.id; renderLayerList(); renderLayerProperties(); updateMobileLayerHint(); scheduleEditPreview(40);
}

function layersForItem(item = selectedItem()) { return state.layers.filter((layer) => !layer.scopeItemId || layer.scopeItemId === item?.id); }
function selectedDesignLayer() { return layersForItem().find((layer) => layer.id === state.selectedLayerId) || null; }

function renderLayerList() {
  els.layerList.replaceChildren();
  if (!state.layers.length) { const empty = document.createElement('p'); empty.className = 'microcopy'; empty.textContent = 'No design layers yet.'; els.layerList.append(empty); return; }
  [...layersForItem()].reverse().forEach((layer) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-item' + (layer.id === state.selectedLayerId ? ' selected' : '');
    const name = document.createElement('span'); name.textContent = layer.type === 'text' ? (layer.text.trim().slice(0,28) || 'Text') : layer.name;
    const type = document.createElement('small'); type.textContent = layer.type; button.append(name,type); button.addEventListener('click', () => { state.selectedLayerId = layer.id; renderLayerList(); renderLayerProperties(); updateMobileLayerHint(); }); els.layerList.append(button);
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
  const visible = layersForItem(); const index = visible.findIndex((entry) => entry.id === layer.id); els.layerDown.disabled = index <= 0; els.layerUp.disabled = index >= visible.length - 1;
}

function updateSelectedLayerFromControls() {
  const layer = selectedDesignLayer(); if (!layer) return;
  const next = { ...layer, x:Number(els.layerX.value), y:Number(els.layerY.value), width:Number(els.layerWidth.value), height:Number(els.layerHeight.value), rotation:Number(els.layerRotation.value), opacity:Number(els.layerOpacity.value)/100 };
  if (layer.type === 'text') Object.assign(next,{ text:els.layerText.value,fontFamily:els.layerFont.value,fontSize:Number(els.layerFontSize.value),fontWeight:Number(els.layerFontWeight.value),align:els.layerAlign.value,color:els.layerColor.value,letterSpacing:Number(els.layerLetterSpacing.value),lineSpacing:Number(els.layerLineSpacing.value),strokeWidth:Number(els.layerStrokeWidth.value),strokeColor:els.layerStrokeColor.value,shadowEnabled:els.layerShadowEnabled.checked,shadowColor:els.layerShadowColor.value,shadowBlur:Number(els.layerShadowBlur.value),shadowX:Number(els.layerShadowX.value),shadowY:Number(els.layerShadowY.value),backgroundEnabled:els.layerBgEnabled.checked,backgroundColor:els.layerBgColor.value });
  else Object.assign(next,{ fill:els.layerFill.value,fill2:els.layerFill2.value,gradient:els.layerGradient.checked,gradientAngle:Number(els.layerGradientAngle.value),strokeColor:els.shapeStrokeColor.value,strokeWidth:Number(els.shapeStrokeWidth.value) });
  const normalized = normalizeLayer(next); const index = state.layers.findIndex((entry) => entry.id === layer.id); state.layers[index] = normalized; renderLayerList(); scheduleEditPreview();
}

function duplicateSelectedLayer() {
  const layer = selectedDesignLayer(); if (!layer) return; const copy = normalizeLayer({ ...layer, id: crypto.randomUUID(), name: layer.name + ' copy', x: layer.x + 2, y: layer.y + 2 }); state.layers.push(copy); state.selectedLayerId = copy.id; renderLayerList(); renderLayerProperties(); updateMobileLayerHint(); scheduleEditPreview(40);
}
function deleteSelectedLayer() { const index = state.layers.findIndex((layer) => layer.id === state.selectedLayerId); if (index < 0) return; state.layers.splice(index,1); state.selectedLayerId = state.layers[Math.min(index,state.layers.length-1)]?.id || null; renderLayerList(); renderLayerProperties(); updateMobileLayerHint(); scheduleEditPreview(40); }
function moveSelectedLayer(direction) { const index = state.layers.findIndex((layer) => layer.id === state.selectedLayerId); const next = index + direction; if (index < 0 || next < 0 || next >= state.layers.length) return; [state.layers[index],state.layers[next]]=[state.layers[next],state.layers[index]]; renderLayerList(); renderLayerProperties(); scheduleEditPreview(40); }

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
  updateMobileAdjustValue();
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
  invalidatePerformanceResult();
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
    const settings = collectSettings(); settings.targetBytes = 0; settings.format = 'png'; settings.previewMaxEdge = 1400; settings.cleanup = cleanupForItem(item); settings.layers = layersForItem(item); settings.textReplacements = item.textReplacements || [];
    const result = await runImageOperation('preview', item, settings, 20_000, controller.signal);
    if (controller.signal.aborted || result.state === 'cancelled') return;
    if (result.state !== 'completed') { els.previewStatus.textContent = result.error?.message || 'Preview unavailable'; return; }
    if (item.editPreviewUrl) revokeObjectUrl(item.editPreviewUrl);
    item.editPreviewBlob = new Blob([result.value.buffer], { type: result.value.mime });
    item.editPreviewUrl = trackObjectUrl(item.editPreviewBlob);
    renderSelectedSafely(); renderMobileCanvas(item); renderReplaceSelector(item); els.previewStatus.textContent = 'Preview ready'; if (els.mobileCanvasStatus) els.mobileCanvasStatus.classList.add('hidden');
  } catch { if (!controller.signal.aborted) els.previewStatus.textContent = 'Preview unavailable'; if (els.mobileCanvasStatus) els.mobileCanvasStatus.classList.add('hidden'); }
}

function renderComparison(item) {
  if (!item?.originalUrl || !item.editPreviewUrl) { els.editComparison.classList.add('hidden'); return; }
  els.comparisonOriginal.src = item.originalUrl; els.comparisonEdited.src = item.editPreviewUrl;
  els.editComparison.classList.remove('hidden'); updateComparisonPosition();
}

function setDesktopInspectorTool(tool) {
  const card = document.querySelector('.control-card');
  if (!card || !['adjust','crop','cleanup','text','watermark','more'].includes(tool)) return;
  card.dataset.inspectorTool = tool;
  document.querySelectorAll('.image-sidebar-nav-button').forEach((button) => button.classList.toggle('active', button.dataset.sidebarTool === tool));
}

function updateComparisonPosition() {
  const value = Number(els.comparisonRange.value);
  els.comparisonValue.textContent = String(value);
  els.comparisonOverlay.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  els.comparisonDivider.style.left = value + '%';
}

async function runSmartCropAnalysis(item = selectedItem(), { quiet = false } = {}) {
  if (!item?.inspect || !item.originalUrl || item.inspect.kind === 'svg') return null;
  if (!quiet) { els.smartCropStatus.textContent='Analyzing locally…'; els.smartCropAnalyze.disabled=true; }
  try {
    const img=new Image(); img.decoding='async';
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=item.originalUrl;});
    const sourceW=img.naturalWidth||img.width,sourceH=img.naturalHeight||img.height,edge=480,scale=Math.min(1,edge/Math.max(sourceW,sourceH));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sourceW*scale));canvas.height=Math.max(1,Math.round(sourceH*scale));
    const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);
    const regions=detectInformationRegions(image.data,canvas.width,canvas.height);
    let faceDetectorAvailable=false;
    if ('FaceDetector' in window) {
      try {
        faceDetectorAvailable=true;
        const detector=new FaceDetector({fastMode:true,maxDetectedFaces:10});
        const faces=await detector.detect(img);
        for(const face of faces||[]){
          const b=face.boundingBox;
          if(b?.width>0&&b?.height>0) regions.push({type:'face',x:b.x/sourceW,y:b.y/sourceH,width:b.width/sourceW,height:b.height/sourceH,weight:6});
        }
      } catch { faceDetectorAvailable=false; }
    }
    item.smartCrop={...item.smartCrop,analyzed:true,regions,manual:false,summary:smartCropSummary(regions,{faceDetectorAvailable})};
    syncSmartCropFocus();
    updateSmartCropUi(item);
    scheduleEditPreview(20);
    return item.smartCrop;
  } catch {
    if (!quiet) els.smartCropStatus.textContent='Local analysis unavailable for this image.';
    return null;
  } finally { if (!quiet) els.smartCropAnalyze.disabled=false; }
}

function ratioForCurrentCrop(crop) {
  if (crop?.mode === 'ratio') return Number(crop.ratio)||1;
  if (els.resizeMode.value === 'fill') return Math.max(1,Number(els.width.value))/Math.max(1,Number(els.height.value));
  return null;
}

function smartFocusForCurrentSettings(item, crop) {
  if (!item?.smartCrop || !els.smartCropEnabled.checked) return {focusX:.5,focusY:.5};
  if (item.smartCrop.manual) return {focusX:item.smartCrop.focusX,focusY:item.smartCrop.focusY};
  const ratio=ratioForCurrentCrop(crop);
  if (!ratio || !item.smartCrop.analyzed) return {focusX:.5,focusY:.5};
  return chooseSmartFocus(item.inspect.dimensions.width,item.inspect.dimensions.height,ratio,item.smartCrop.regions);
}

function syncSmartCropFocus() {
  const item=selectedItem(); if(!item?.smartCrop)return;
  let crop={mode:'none'};
  const cm=els.cropMode.value;
  if(cm==='ratio')crop={mode:'ratio',ratio:1}; else if(cm==='ratio-4-5')crop={mode:'ratio',ratio:4/5}; else if(cm==='ratio-16-9')crop={mode:'ratio',ratio:16/9}; else if(cm==='ratio-9-16')crop={mode:'ratio',ratio:9/16}; else if(cm==='custom')crop={mode:'ratio',ratio:Number(els.customRatio.value)};
  const focus=smartFocusForCurrentSettings(item,crop);
  if(!item.smartCrop.manual){item.smartCrop.focusX=focus.focusX;item.smartCrop.focusY=focus.focusY;}
  updateSmartCropUi(item);
}

function updateSmartCropUi(item) {
  if(!els.smartCropStatus)return;
  const smart=item?.smartCrop;
  const enabled=els.smartCropEnabled.checked;
  els.smartCropX.disabled=!enabled;els.smartCropY.disabled=!enabled;
  const fx=Math.round((smart?.focusX??.5)*100),fy=Math.round((smart?.focusY??.5)*100);
  els.smartCropX.value=String(fx);els.smartCropY.value=String(fy);els.smartCropXValue.textContent=String(fx);els.smartCropYValue.textContent=String(fy);
  if(!enabled){els.smartCropStatus.textContent='Centered crop';return;}
  if(!smart?.analyzed){els.smartCropStatus.textContent='Analyze to find a safer focus';return;}
  if(smart.manual){els.smartCropStatus.textContent='Manual focus';return;}
  const s=smart.summary||{};
  const parts=[];if(s.faces)parts.push(`${s.faces} face${s.faces===1?'':'s'}`);if(s.textLike)parts.push(`${s.textLike} text-like`);if(s.detail)parts.push(`${s.detail} detail`);
  els.smartCropStatus.textContent=parts.length?`Focus found: ${parts.join(' · ')}`:(s.faceDetectorAvailable?'No strong focus found':'Local detail focus');
}

function setMobileCrop(mode) {
  const allowed = ['none','free','ratio','ratio-4-5','ratio-16-9','ratio-9-16','custom'];
  els.cropMode.value = allowed.includes(mode) ? mode : 'none';
  updateConditionalControls(); syncMobileCropButtons(); syncSmartCropFocus(); scheduleEditPreview(40);
}

function syncMobileCropButtons() {
  for (const button of els.mobileCropButtons || []) button.classList.toggle('active', button.dataset.cropChoice === els.cropMode.value);
}

function setMobileAdjust(key) {
  if (!MOBILE_ADJUST_LABELS[key]) key = 'brightness';
  state.mobileAdjustKey = key;
  document.body.dataset.mobileAdjust = key;
  for (const button of els.mobileAdjustButtons || []) button.classList.toggle('active', button.dataset.adjustKey === key);
  for (const control of [...editControls(), els.rotate, els.flipX, els.flipY]) control?.closest('label')?.classList.toggle('mobile-active-adjust', control === mobileAdjustControl(key));
  if (els.mobileAdjustName) els.mobileAdjustName.textContent = MOBILE_ADJUST_LABELS[key];
  updateMobileAdjustValue();
}

function mobileAdjustControl(key) { return key === 'flipX' ? els.flipX : key === 'flipY' ? els.flipY : key === 'rotate' ? els.rotate : els[key]; }

function updateMobileAdjustValue() {
  if (!els.mobileAdjustValue) return;
  const key = state.mobileAdjustKey; const control = mobileAdjustControl(key);
  if (!control) return;
  if (key === 'flipX' || key === 'flipY') els.mobileAdjustValue.textContent = control.checked ? 'On' : 'Off';
  else if (key === 'rotate') els.mobileAdjustValue.textContent = control.value + '°';
  else { const output = document.querySelector('#' + key + '-value'); els.mobileAdjustValue.textContent = output?.textContent ?? control.value; }
}

const ENCODER_SUPPORT = new Map();

async function runAssetDoctor({ quiet = false } = {}) {
  const item = selectedItem();
  if (!item?.inspect) return null;
  if (!quiet) {
    els.assetDoctorStatus.textContent = 'Checking asset…';
    els.assetDoctorRun.disabled = true;
    els.assetDoctorRun.textContent = 'Checking…';
    els.assetDoctorBadge.textContent = 'Checking';
    els.assetDoctorBadge.dataset.level = 'neutral';
  }
  try {
    if (item.transparencyDetected === null) item.transparencyDetected = await detectTransparency(item);
    const supportedFormats = [];
    for (const kind of ['jpeg','png','webp','avif']) if (await supportsOutputKind(kind)) supportedFormats.push(kind);
    const preset = IMAGE_PRESETS.find((entry) => entry.id === els.preset.value) || null;
    item.assetDoctorReport = buildAssetDoctorReport({
      fileSize: item.file.size,
      inspect: item.inspect,
      settings: collectSettings(),
      preset,
      transparencyDetected: item.transparencyDetected === true,
      supportedFormats
    });
    renderAssetDoctor(item);
    return item.assetDoctorReport;
  } catch {
    if (!quiet) els.assetDoctorStatus.textContent = 'Check unavailable for this asset.';
    return null;
  } finally {
    if (!quiet) {
      els.assetDoctorRun.disabled = false;
      els.assetDoctorRun.textContent = item?.assetDoctorReport ? 'Check again' : 'Check asset';
    }
  }
}

function renderAssetDoctor(item) {
  if (!els.assetDoctorList || !els.assetDoctorBadge) return;
  els.assetDoctorList.replaceChildren();
  const report = item?.assetDoctorReport;
  if (!report) {
    const p=document.createElement('p'); p.className='microcopy'; p.textContent='Run Asset Doctor to inspect the selected image against the current export settings.';
    els.assetDoctorList.append(p); els.assetDoctorBadge.textContent='Not checked'; els.assetDoctorBadge.dataset.level='neutral'; els.assetDoctorStatus.textContent=''; if (els.assetDoctorRun) els.assetDoctorRun.textContent='Check asset'; return;
  }
  const { errors,warnings,info } = report.counts;
  els.assetDoctorBadge.textContent = errors ? `${errors} error${errors===1?'':'s'}` : warnings ? `${warnings} warning${warnings===1?'':'s'}` : info ? `${info} note${info===1?'':'s'}` : 'Ready';
  els.assetDoctorBadge.dataset.level = errors ? 'error' : warnings ? 'warning' : 'good';
  for (const finding of report.issues) {
    const card=document.createElement('article'); card.className=`asset-doctor-item doctor-${finding.severity}`;
    const head=document.createElement('div'); head.className='asset-doctor-item-head';
    const dot=document.createElement('span'); dot.className='asset-doctor-dot'; dot.setAttribute('aria-hidden','true');
    const title=document.createElement('strong'); title.textContent=finding.title; head.append(dot,title);
    const detail=document.createElement('p'); detail.textContent=finding.detail;
    const fix=document.createElement('p'); fix.className='asset-doctor-fix'; fix.textContent=`Fix: ${finding.fix}`;
    card.append(head,detail,fix); els.assetDoctorList.append(card);
  }
  els.assetDoctorStatus.textContent = `Planned output: ${report.target.width}×${report.target.height}`;
}

async function detectTransparency(item) {
  if (!item?.originalUrl || item.inspect?.kind === 'jpeg' || item.inspect?.kind === 'svg') return false;
  const img = new Image(); img.decoding='async';
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=item.originalUrl;});
  const sourceW=img.naturalWidth||img.width, sourceH=img.naturalHeight||img.height;
  const edge=1024, scale=Math.min(1,edge/Math.max(sourceW,sourceH));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(sourceW*scale)); canvas.height=Math.max(1,Math.round(sourceH*scale));
  const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true}); ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  for(let i=3;i<data.length;i+=4) if(data[i]<255) return true;
  return false;
}

async function supportsOutputKind(kind) {
  if (ENCODER_SUPPORT.has(kind)) return ENCODER_SUPPORT.get(kind);
  const mime=({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'})[kind];
  const canvas=document.createElement('canvas'); canvas.width=1; canvas.height=1;
  const supported=await new Promise((resolve)=>canvas.toBlob((blob)=>resolve(Boolean(blob&&blob.type===mime)),mime,.8));
  ENCODER_SUPPORT.set(kind,supported); return supported;
}

async function generateWebPack() {
  const item=selectedItem(); if(!item?.inspect||state.busy)return;
  const selectedWidths=els.webPackWidths.filter((input)=>input.checked).map((input)=>Number(input.dataset.webWidth));
  const requestedFormats=els.webPackFormats.filter((input)=>input.checked).map((input)=>input.dataset.webFormat);
  if(!selectedWidths.length){els.webPackStatus.textContent='Choose at least one width.';return;}
  if(!requestedFormats.length){els.webPackStatus.textContent='Choose at least one format.';return;}
  const base=collectSettings();
  const crop=calculateCrop(item.inspect.dimensions.width,item.inspect.dimensions.height,base.crop);
  let aspect=crop.width/Math.max(1,crop.height);
  const rotation=((Number(base.rotate)||0)%360+360)%360;
  if(rotation===90||rotation===270) aspect=1/aspect;
  const sourceWidth=rotation===90||rotation===270?crop.height:crop.width;
  const supportedFormats=[];
  for(const format of requestedFormats) if(await supportsOutputKind(format)) supportedFormats.push(format);
  const skippedFormats=requestedFormats.filter((format)=>!supportedFormats.includes(format));
  if(!supportedFormats.length){els.webPackStatus.textContent='None of the selected formats can be encoded by this browser.';return;}
  const plan=buildResponsiveVariants({aspect,widths:selectedWidths,formats:supportedFormats,sourceWidth,allowUpscale:!els.webPackNoUpscale.checked});
  if(!plan.length){els.webPackStatus.textContent='All selected widths exceed the current source crop. Uncheck “Skip widths larger…” to allow upscaling.';return;}
  setBusy(true); els.webPackGenerate.disabled=true; els.webPackCopy.disabled=true; els.webPackResult.classList.add('hidden');
  const files=[],variants=[],failures=[]; let totalBytes=0;
  try {
    for(let i=0;i<plan.length;i++){
      const spec=plan[i]; els.webPackStatus.textContent=`Rendering ${i+1}/${plan.length}: ${spec.width}px ${spec.format.toUpperCase()}…`;
      const settings={...base,resizeMode:'fit',width:spec.width,height:spec.height,preserveAspect:true,format:spec.format,targetBytes:0};
      const result=await runImageOperation('process',item,settings);
      if(result.state!=='completed'){failures.push(`${spec.width}px ${spec.format.toUpperCase()}`);continue;}
      const ext=spec.format==='jpeg'?'jpg':spec.format;
      const name=exportFilename(item.file.name,ext,{suffix:`-${spec.width}w`,preserveOriginal:true});
      totalBytes+=result.value.buffer.byteLength;
      if(totalBytes>MAX_COMPILER_PACK_BYTES){els.webPackStatus.textContent='Web pack exceeded the 200 MB safe in-memory limit. Choose fewer widths/formats.';return;}
      variants.push({name,width:result.value.width,height:result.value.height,format:spec.format,size:result.value.buffer.byteLength});
      files.push({name,buffer:result.value.buffer});
    }
    if(!variants.length){els.webPackStatus.textContent='No responsive variants could be generated.';return;}
    const markup=buildPictureMarkup(variants,{alt:''});
    const manifest=JSON.stringify({generatedBy:'Utility OS Image Studio',variants:variants.map(({name,width,height,format,size})=>({filename:name,width,height,format,bytes:size}))},null,2);
    files.push({name:'picture.html',buffer:new TextEncoder().encode(markup).buffer});
    files.push({name:'manifest.json',buffer:new TextEncoder().encode(manifest).buffer});
    const transfers=files.map((file)=>file.buffer);
    els.webPackStatus.textContent='Packing responsive assets…';
    const zip=await runner.run({op:'zip',files},transfers,45_000);
    if(zip.state!=='completed'){els.webPackStatus.textContent=zip.error?.message||'Web pack ZIP failed safely.';return;}
    const blob=new Blob([zip.value.buffer],{type:'application/zip'}),url=trackObjectUrl(blob);
    triggerDownload(url,'utility-os-web-pack.zip'); setTimeout(()=>revokeObjectUrl(url),2000);
    els.webPackMarkup.value=markup; els.webPackResult.classList.remove('hidden'); els.webPackCopy.disabled=false;
    const notes=[]; if(skippedFormats.length)notes.push(`${skippedFormats.map((f)=>f.toUpperCase()).join(', ')} unavailable`); if(failures.length)notes.push(`${failures.length} render${failures.length===1?'':'s'} skipped`);
    els.webPackStatus.textContent=`${variants.length} image variants exported${notes.length?` · ${notes.join(' · ')}`:''}.`;
  } finally { setBusy(false); els.webPackGenerate.disabled=false; }
}

async function copyWebPackMarkup() {
  const text=els.webPackMarkup.value; if(!text)return;
  try {
    if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else { els.webPackMarkup.focus();els.webPackMarkup.select();document.execCommand('copy'); }
    els.webPackStatus.textContent='Picture markup copied.';
  } catch { els.webPackStatus.textContent='Copy was blocked by the browser. Select the markup manually.'; }
}

function performanceBudgetInput() {
  return normalizePerformanceBudget({ maxWidth:Number(els.performanceMaxWidth.value), maxBytes:Number(els.performanceMaxSize.value)*1024, minQuality:Number(els.performanceMinQuality.value)/100 });
}

function invalidatePerformanceResult(item = selectedItem()) {
  if (!item?.performanceResult && !item?.performanceResultUrl) return;
  if (item.performanceResultUrl) revokeObjectUrl(item.performanceResultUrl);
  item.performanceResult = null; item.performanceResultUrl = '';
  if (item === selectedItem()) renderPerformanceResult(item);
}

function renderPerformanceResult(item) {
  const result=item?.performanceResult;
  els.performanceResult.classList.toggle('hidden', !result);
  els.performanceDownload.disabled=state.busy||!result;
  if(!result){ if(!state.busy) els.performanceStatus.textContent='Uses the current crop, edits, text/design, cleanup and watermark.'; return; }
  els.performanceResultTitle.textContent=`${result.kind.toUpperCase()} · ${result.width}×${result.height} · ${formatBytes(result.size)}`;
  els.performanceResultDetail.textContent=`Quality ${Math.round(result.quality*100)}% · ${result.performance.attempts} candidate${result.performance.attempts===1?'':'s'} tested · budget ${formatBytes(result.performance.maxBytes)}`;
}

async function runPerformanceBudget() {
  const item=selectedItem(); if(!item?.inspect||state.busy)return;
  invalidatePerformanceResult(item); setBusy(true);
  const budget=performanceBudgetInput(); els.performanceStatus.textContent='Testing formats and compression levels…';
  try {
    const settings=collectSettings(); settings.layers=layersForItem(item); settings.cleanup=cleanupForItem(item); settings.textReplacements=item.textReplacements||[]; settings.performanceBudget=budget;
    const result=await runImageOperation('performance-budget',item,settings,45_000);
    if(result.state!=='completed'){els.performanceStatus.textContent=result.error?.message||'No valid output met the performance budget.';return;}
    const value=result.value, blob=new Blob([value.buffer],{type:value.mime}); item.performanceResult={...value,blob:null};
    item.performanceResultUrl=trackObjectUrl(blob); item.performanceResult.blob=blob;
    const ext=value.kind==='jpeg'?'jpg':value.kind; item.performanceResult.name=exportFilename(item.file.name,ext,{suffix:'-budget',preserveOriginal:true});
    els.performanceStatus.textContent='Budget met. Optimized copy is ready.'; renderPerformanceResult(item);
  } catch { els.performanceStatus.textContent='Performance optimization failed safely.'; }
  finally { setBusy(false); renderPerformanceResult(item); }
}

function downloadPerformanceResult() {
  const item=selectedItem(); if(item?.performanceResultUrl&&item.performanceResult?.name) triggerDownload(item.performanceResultUrl,item.performanceResult.name);
}

function compilerOutputs() { return normalizeCompilerOutputs([...COMPILER_PRESETS, ...state.compilerCustomOutputs]); }
function selectedCompilerOutputs() { return compilerOutputs().filter((output) => state.compilerSelectedIds.has(output.id)); }

function renderCompiler() {
  if (!els.compilerPresetGrid) return;
  els.compilerPresetGrid.replaceChildren();
  for (const spec of COMPILER_PRESETS) {
    const label = document.createElement('label'); label.className = 'compiler-preset-card';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.compilerSelectedIds.has(spec.id);
    input.addEventListener('change', () => { if (input.checked) state.compilerSelectedIds.add(spec.id); else state.compilerSelectedIds.delete(spec.id); updateCompilerState(); });
    const copy = document.createElement('span'); const name = document.createElement('strong'); name.textContent = spec.label; const dims = document.createElement('small'); dims.textContent = `${spec.width}×${spec.height}`; copy.append(name,dims); label.append(input,copy); els.compilerPresetGrid.append(label);
  }
  els.compilerCustomList.replaceChildren();
  for (const spec of state.compilerCustomOutputs) {
    const row = document.createElement('div'); row.className = 'compiler-custom-row';
    const check = document.createElement('input'); check.type='checkbox'; check.checked=state.compilerSelectedIds.has(spec.id); check.setAttribute('aria-label', `Include ${spec.label}`);
    check.addEventListener('change',()=>{if(check.checked)state.compilerSelectedIds.add(spec.id);else state.compilerSelectedIds.delete(spec.id);updateCompilerState();});
    const copy=document.createElement('span'); copy.textContent=`${spec.label} · ${spec.width}×${spec.height}`;
    const remove=document.createElement('button'); remove.type='button'; remove.className='text-button danger-text'; remove.textContent='Remove'; remove.addEventListener('click',()=>removeCompilerCustomOutput(spec.id));
    row.append(check,copy,remove); els.compilerCustomList.append(row);
  }
  updateCompilerState();
}

function updateCompilerState() {
  const count=selectedCompilerOutputs().length;
  els.compilerCount.textContent=`${count} selected`; els.compilerGenerate.disabled=state.busy||!selectedItem()?.inspect||count===0;
  if (!state.busy) els.compilerStatus.textContent=count?`Ready to generate ${count} asset${count===1?'':'s'}.`:'Choose at least one output.';
}

function addCompilerCustomOutput() {
  if (state.compilerCustomOutputs.length >= MAX_COMPILER_OUTPUTS - COMPILER_PRESETS.length) { els.compilerStatus.textContent='Custom output limit reached.'; return; }
  const raw={label:els.compilerCustomName.value||`Custom ${state.compilerCustomOutputs.length+1}`,width:Number(els.compilerCustomWidth.value),height:Number(els.compilerCustomHeight.value)};
  const spec=normalizeCompilerOutput({...raw,id:`custom-${crypto.randomUUID().slice(0,8)}`},state.compilerCustomOutputs.length);
  state.compilerCustomOutputs.push(spec); state.compilerSelectedIds.add(spec.id); els.compilerCustomName.value=''; renderCompiler();
}
function removeCompilerCustomOutput(id) { state.compilerCustomOutputs=state.compilerCustomOutputs.filter((item)=>item.id!==id); state.compilerSelectedIds.delete(id); renderCompiler(); }

async function generateCompilerPack() {
  const item=selectedItem(), outputs=selectedCompilerOutputs(); if(!item?.inspect||!outputs.length||state.busy)return;
  if(els.compilerFit.value==='smart'&&!item.smartCrop?.analyzed) await runSmartCropAnalysis(item,{quiet:true});
  setBusy(true); updateCompilerState(); let totalBytes=0;
  const files=[]; const failures=[]; const base=collectSettings(); base.layers=layersForItem(item); base.cleanup=cleanupForItem(item); base.textReplacements=item.textReplacements||[];
  try {
    for(let index=0;index<outputs.length;index++){
      const spec=outputs[index]; els.compilerStatus.textContent=`Rendering ${index+1}/${outputs.length}: ${spec.label}…`;
      const settings=compilerSettings(base,spec,els.compilerFit.value);
      if(els.compilerFit.value==='smart'&&item.smartCrop?.analyzed){
        const focus=item.smartCrop.manual?{focusX:item.smartCrop.focusX,focusY:item.smartCrop.focusY}:chooseSmartFocus(item.inspect.dimensions.width,item.inspect.dimensions.height,spec.width/spec.height,item.smartCrop.regions);
        settings.smartCrop={enabled:true,focusX:focus.focusX,focusY:focus.focusY};
      } else settings.smartCrop={enabled:false,focusX:.5,focusY:.5};
      const result=await runImageOperation('process',item,settings);
      if(result.state!=='completed'){failures.push(`${spec.label}: ${result.error?.message||result.state}`);continue;}
      totalBytes+=result.value.buffer.byteLength;
      if(totalBytes>MAX_COMPILER_PACK_BYTES){showCompatibility('Compiler pack exceeded the 200 MB safe in-memory output limit. Choose fewer or smaller outputs.');return;}
      const ext=result.value.kind==='jpeg'?'jpg':result.value.kind;
      const name=exportFilename(item.file.name,ext,{suffix:`-${spec.id}`,preserveOriginal:true});
      files.push({name,buffer:result.value.buffer});
    }
    if(!files.length){els.compilerStatus.textContent=failures[0]||'No compiler outputs completed.';return;}
    els.compilerStatus.textContent=`Packing ${files.length} asset${files.length===1?'':'s'}…`;
    const transfers=files.map((file)=>file.buffer); const zip=await runner.run({op:'zip',files},transfers,45_000);
    if(zip.state!=='completed'){els.compilerStatus.textContent=zip.error?.message||'Asset pack ZIP failed safely.';return;}
    const blob=new Blob([zip.value.buffer],{type:'application/zip'}); const url=trackObjectUrl(blob); triggerDownload(url,'utility-os-asset-pack.zip'); setTimeout(()=>revokeObjectUrl(url),2000);
    els.compilerStatus.textContent=`${files.length} asset${files.length===1?'':'s'} exported${failures.length?` · ${failures.length} skipped`:''}.`;
  } finally { setBusy(false); updateCompilerState(); }
}

function toggleMobileFiles() { document.body.classList.toggle('mobile-files-open'); }
function closeMobileFiles() { document.body.classList.remove('mobile-files-open'); }

async function mobileExportSelected() {
  const item = selectedItem(); if (!item?.inspect || state.busy) return;
  await runAssetDoctor({ quiet:true });
  setBusy(true); els.mobileExportStatus.textContent = 'Preparing export…';
  try {
    await processItem(item, collectSettings()); renderList(); renderSelected();
    if (item.outputUrl && item.outputName && item.status === 'completed') { els.mobileExportStatus.textContent = `${formatBytes(item.outputBlob.size)} · ready`; triggerDownload(item.outputUrl, item.outputName); }
    else els.mobileExportStatus.textContent = item.error || 'Export could not be completed.';
  } finally { setBusy(false); }
}

async function mobileExportAll() {
  if (state.busy || !state.items.some((item)=>item.inspect)) return;
  els.mobileExportStatus.textContent = 'Processing batch…';
  await processAll();
  const completed = state.items.filter((item)=>item.outputBlob).length;
  if (!completed) { els.mobileExportStatus.textContent = 'No files were ready to export.'; return; }
  els.mobileExportStatus.textContent = `Packing ${completed} files…`;
  await downloadAll(); els.mobileExportStatus.textContent = `${completed} files exported as ZIP`;
}

function setMobileMode(mode) {
  const labels = { adjust:'Adjust', crop:'Crop', cleanup:'Clean', text:'Text', more:'More', replace:'Replace Text', design:'Design', watermark:'Add Watermark', watermarkremove:'Remove Watermark', compiler:'Compiler', assetdoctor:'Asset Doctor', webpack:'Web Pack', performance:'Performance', export:'Export' };
  const advanced = new Set(['replace','design','watermark','watermarkremove','compiler','assetdoctor','webpack','performance','export']);
  state.mobileMode = labels[mode] ? mode : 'adjust';
  document.body.dataset.mobileTool = state.mobileMode;
  if (els.mobileSheetTitle) els.mobileSheetTitle.textContent = labels[state.mobileMode];
  if (els.mobileSheetBack) els.mobileSheetBack.classList.toggle('hidden', !advanced.has(state.mobileMode));
  for (const button of els.mobileToolButtons || []) {
    const active = button.dataset.mobileTool === state.mobileMode || (button.dataset.mobileTool === 'more' && advanced.has(state.mobileMode));
    button.classList.toggle('active', active);
  }
  if (state.mobileMode === 'cleanup' || state.mobileMode === 'watermarkremove') requestAnimationFrame(() => requestAnimationFrame(() => renderCleanupEditor(selectedItem())));
  if (state.mobileMode === 'replace') requestAnimationFrame(() => renderReplaceSelector(selectedItem()));
  if (state.mobileMode === 'crop') syncMobileCropButtons();
  const removingWatermark = state.mobileMode === 'watermarkremove';
  if (els.cleanupModeHint) els.cleanupModeHint.classList.toggle('hidden', !removingWatermark);
  if (els.watermarkDetectBar) els.watermarkDetectBar.classList.toggle('hidden', !removingWatermark);
  if (els.watermarkDetectStatus && removingWatermark) els.watermarkDetectStatus.textContent = 'Best-effort local detection';
  if (els.cleanupApply) els.cleanupApply.textContent = removingWatermark ? 'Remove watermark' : 'Remove selected area';
  if (els.cleanupState && removingWatermark && !(selectedItem()?.cleanupStrokes?.length)) els.cleanupState.textContent = 'Brush over watermark';
  if (state.mobileMode === 'text' || state.mobileMode === 'design') { renderLayerList(); renderLayerProperties(); updateMobileLayerHint(); } else if (els.mobileLayerHint) els.mobileLayerHint.classList.add('hidden');
  if (state.mobileMode === 'export' && els.mobileExportStatus) els.mobileExportStatus.textContent = 'Local export · metadata stripped';
}

function syncMobileEditingState() {
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const readyItems = state.items.filter((item) => item.inspect);
  if (!state.selectedId && readyItems.length) state.selectedId = readyItems[0].id;
  const hasReady = readyItems.length > 0;
  const editing = mobile && hasReady && !state.mobileStartOpen;
  document.body.classList.toggle('mobile-editing', editing);
  document.body.classList.toggle('mobile-start', mobile && !editing);
  const count = readyItems.length;
  if (els.mobileBatchChip) {
    els.mobileBatchChip.textContent = `${count} image${count === 1 ? '' : 's'}`;
    els.mobileBatchChip.classList.toggle('hidden', count < 2 || state.mobileMode === 'watermarkremove');
  }
  if (els.mobileExportAll) { els.mobileExportAll.textContent = `Export all ${count} as ZIP`; els.mobileExportAll.classList.toggle('hidden', count < 2); }
  if (els.mobileContinue) els.mobileContinue.classList.toggle('hidden', !hasReady);
  if (els.mobileStartCount) {
    els.mobileStartCount.textContent = hasReady ? `${count} image${count === 1 ? '' : 's'} ready locally` : '';
    els.mobileStartCount.classList.toggle('hidden', !hasReady);
  }
}

function enterMobileEditor() {
  const firstReady = state.items.find((item) => item.inspect);
  if (!firstReady) return openImagePicker();
  if (!selectedItem()?.inspect) state.selectedId = firstReady.id;
  state.mobileStartOpen = false;
  syncMobileEditingState();
  renderSelectedSafely();
}

function exitMobileEditor() {
  closeMobileFiles();
  state.mobileStartOpen = true;
  syncMobileEditingState();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderMobileCanvas(item) {
  if (!els.mobileCanvasImage || !els.mobileCanvasEmpty) return;
  const src = state.mobileShowOriginal ? item?.originalUrl : (item?.editPreviewUrl || item?.outputUrl || item?.originalUrl);
  if (!src) { els.mobileCanvasImage.removeAttribute('src'); els.mobileCanvasImage.classList.add('hidden'); els.mobileCanvasEmpty.classList.remove('hidden'); return; }
  els.mobileCanvasImage.src = src; els.mobileCanvasImage.classList.remove('hidden'); els.mobileCanvasEmpty.classList.add('hidden'); updateMobileLayerHint(); if (state.mobileMode === 'replace') requestAnimationFrame(() => renderReplaceSelector(item));
}

function showCompatibility(message) { els.compatibility.textContent = message; els.compatibility.classList.remove('hidden'); }
function statusLabel(status) { return ({ inspecting: 'Inspecting', ready: 'Ready', processing: 'Processing', completed: 'Done', failed: 'Failed', unsupported: 'Unsupported', timed_out: 'Timed out', cancelled: 'Cancelled' })[status] || status; }
function formatBytes(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
