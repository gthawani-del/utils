import { validateBatchBudget, validateDimensions, validateFileBudget } from '/lib/security/budget.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { processBrowserImage } from '/lib/image/browser-processor.js';
import { batchCover, batchDimensions, batchFilenames, batchSettings } from '/lib/image/batch.js';
import { drawResize } from '/lib/image/draw-resize.js';
import { exportBatch } from '/assets/batch-archive.js';

const $ = id => document.getElementById('batch-' + id);
const workspace = $('workspace');
const form = $('form');
const input = $('input');
const cards = $('files');
const status = $('status');
const gallery = workspace.querySelector('.batch-gallery');
const workerUrl = '/workers/batch-export.worker.js';
const runner = new WorkerRunner(new URL('/workers/image.worker.js', location.origin));
const tool = new URLSearchParams(location.search).get('tool');
const resizeTool = tool !== 'compress' && tool !== 'convert';
const presets = { portrait: [1080, 1350], square: [1080, 1080], story: [1080, 1920], banner: [1920, 1080], hero: [1600, 900], product: [2000, 2000] };
const help = {
  contain: 'Keep the whole photo and fill the extra space.',
  fill: 'Fill the frame. Reposition individual photos if needed.',
  fit: 'Keep proportions within the selected dimensions.',
  original: 'Keep each image at its original size.',
  stretch: 'Fill the frame by changing the photo’s proportions.',
};
let items = [];
let importing = false;
let job;
let ratio = 1080 / 1350;
let archive;
let archiveUrl;
let cropEdit;
let dragStart;
let gridOpen = false;
let stripPosition = 0;
let estimateTimer;
let estimateVersion = 0;

if (!resizeTool) {
  const compress = tool === 'compress';
  const title = compress ? 'Compress Image' : 'Convert Image';
  $('heading').textContent = title;
  document.title = title + ' · Utility OS';
  $('intro').textContent = compress ? 'Reduce file size without changing image dimensions.' : 'Change image formats while keeping original dimensions.';
  $('resize').hidden = $('advanced').hidden = true;
}

function currentOptions() {
  const framing = !resizeTool || $('original').checked ? 'original'
    : $('stretch').checked ? 'stretch' : form.elements.framing.value;
  const format = $('format').value;
  return {
    preset: $('preset').value, framing, format,
    width: $('width').valueAsNumber, height: $('height').valueAsNumber,
    padding: form.elements.padding.value, padColor: $('color').value,
    quality: $('quality').valueAsNumber / 100,
    targetBytes: format !== 'png' && $('compression').value === 'target' ? $('target').valueAsNumber * 1024 : 0,
    keepCamera: $('camera').checked, pattern: $('pattern').value.trim(), prefix: $('prefix').value.trim(),
  };
}

function syncControls() {
  const options = currentOptions();
  const active = items.length > 0;
  const busy = Boolean(job) || importing;
  const relative = ['half', 'max-width'].includes(options.preset);
  const framingVisible = options.framing !== 'original' && !relative;
  const target = options.format !== 'png' && $('compression').value === 'target';
  workspace.classList.toggle('has-files', active);
  $('sheet').hidden = !active;
  $('dropzone').hidden = active;
  $('active').hidden = !active;
  if (items.length < 2 && gridOpen) showGrid(false);
  updateQueueSummary();
  $('dimensions').hidden = !framingVisible;
  $('framing').hidden = !framingVisible || options.framing === 'stretch';
  $('padding-field').hidden = !framingVisible || options.framing !== 'contain';
  $('transparent').hidden = options.format === 'jpeg';
  $('color').hidden = options.padding !== 'custom' || $('padding-field').hidden;
  $('frame-help').textContent = options.framing !== 'original' && relative
    ? options.preset === 'half' ? 'Halve both dimensions for each image.' : 'Shrink wider images. Keep smaller images at their current size.'
    : help[options.framing];
  $('compression-field').hidden = options.format === 'png';
  $('quality-field').hidden = target || options.format === 'png';
  $('target-field').hidden = !target;
  $('camera-field').hidden = options.format !== 'jpeg';
  $('camera-help').hidden = options.format !== 'jpeg';
  $('quality-value').textContent = $('quality').value + '%';
  const count = items.filter(item => item.inspect).length;
  const geometry = options.framing === 'original' ? 'Original dimensions' : relative
    ? options.preset === 'half' ? '50% size' : 'Max width 1200 px' : `${$('width').value} × ${$('height').value}`;
  const layout = { contain: 'Pad', fill: 'Crop', fit: 'Fit', stretch: 'Stretch' }[options.framing];
  $('quick').textContent = [geometry, framingVisible ? layout : '', options.format.toUpperCase(), options.format === 'png' ? '' : target
    ? `≤ ${$('target').value} KB` : `${$('quality').value}%`].filter(Boolean).join(' · ');
  for (const control of form.querySelectorAll('button, input, select')) {
    control.disabled = busy || Boolean(control.closest('[hidden]')) || (relative && control === $('stretch'));
  }
  for (const control of [input, $('pick'), $('add'), $('clear')]) control.disabled = busy;
  $('zip').disabled = busy || !count;
  if (!job) $('zip').textContent = `Download ZIP (${count})`;
  $('cancel').hidden = !job;
  $('retry').hidden = busy || !items.some(item => item.error && item.inspect);
  $('save').hidden = busy || !archive;
}

function updateQueueSummary() {
  const count = items.filter(item => item.error || item.rejection).length;
  const label = count ? count + ' failed' : '';
  const failures = $('failures');
  if (failures.textContent !== label) failures.textContent = label;
  failures.hidden = !count;
  const view = $('view');
  view.hidden = items.length < 2;
  view.textContent = gridOpen ? 'Show filmstrip' : 'View all';
  view.setAttribute('aria-label', gridOpen ? 'Show filmstrip' : `View all ${items.length} images`);
  view.setAttribute('aria-expanded', String(gridOpen));
}

function showGrid(open) {
  if (open) stripPosition = cards.scrollLeft;
  gridOpen = open;
  workspace.classList.toggle('show-all', open);
  if (!open) cards.scrollLeft = stripPosition;
  updateQueueSummary();
}

const iconPaths = {
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  remove: 'M6 6l12 12M18 6 6 18',
};

function cardAction(action, label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const ns = 'http' + '://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', iconPaths[action]);
  icon.append(path);
  button.append(icon);
  button.addEventListener('click', handler);
  return button;
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function preview(item, canvas, maxEdge = 250, focus = item.focus) {
  if (!item.image) return;
  const basis = item.inspect.dimensions;
  const settings = batchSettings(basis, currentOptions());
  const target = batchDimensions(basis, settings);
  if (!validateDimensions(target.width, target.height).ok) return;
  const scale = Math.min(1, maxEdge / Math.max(target.width, target.height));
  canvas.width = Math.max(1, Math.round(target.width * scale));
  canvas.height = Math.max(1, Math.round(target.height * scale));
  drawResize(canvas.getContext('2d'), item.image, { x: 0, y: 0, width: item.image.naturalWidth, height: item.image.naturalHeight },
    { width: canvas.width, height: canvas.height }, { ...settings, batchFocus: focus || {} }, basis, target);
}

const visibility = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const item = items.find(value => value.tile === entry.target);
    if (!item) continue;
    item.visible = entry.isIntersecting;
    if (item.visible) paintItem(item);
  }
}, { rootMargin: '60px' });

async function paintItem(item) {
  if (!item.proxyUrl) return;
  if (!item.image) {
    if (!item.decoding) {
      const image = new Image();
      image.src = item.proxyUrl;
      item.decoding = image.decode().then(() => image, () => null);
    }
    item.image = await item.decoding;
    if (!item.image || !items.includes(item)) return;
  }
  if (item.visible) preview(item, item.canvas);
}

function addCard(item) {
  const row = document.createElement('li');
  const tile = document.createElement('div');
  tile.className = 'batch-thumbnail';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  canvas.setAttribute('aria-label', 'Output framing preview');
  tile.append(canvas);
  const actions = document.createElement('div');
  actions.className = 'batch-card-actions';
  const crop = cardAction('crop', 'Reposition ' + item.file.name, () => openCrop(item));
  const remove = cardAction('remove', 'Remove ' + item.file.name, () => removeItem(item));
  actions.append(crop, remove);
  const info = document.createElement('div');
  info.className = 'batch-card-info';
  const name = document.createElement('strong');
  name.textContent = item.file.name;
  name.title = item.file.name;
  const details = document.createElement('small');
  const error = document.createElement('small');
  error.className = 'batch-error';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'text-button';
  download.textContent = 'Download';
  download.setAttribute('aria-label', 'Download ' + item.file.name);
  download.onclick = () => {
    if (item.output && archive) {
      const { start, size, mime, name } = item.output;
      downloadBlob(archive.slice(start, start + size, mime), name);
    }
  };
  info.append(name, details, error, download);
  row.append(tile, actions, info);
  cards.append(row);
  Object.assign(item, { row, tile, canvas, crop, remove, details, errorLabel: error, download });
  visibility.observe(tile);
}

let paintFrame;
function repaint() {
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = null;
    for (const item of items) if (item.visible) paintItem(item);
  });
}

function refresh() {
  const options = currentOptions();
  const ready = items.filter(item => item.inspect);
  const planned = ready.map(item => batchDimensions(item.inspect.dimensions, batchSettings(item.inspect.dimensions, options)));
  const names = batchFilenames(ready.map(item => item.file), options.format, options.prefix, options.pattern, planned);
  const busy = Boolean(job) || importing;
  let index = 0;
  for (const item of items) {
    const dimensions = item.inspect && planned[index];
    item.details.textContent = item.inspect
      ? item.output ? `${formatSize(item.file.size)} → ${formatSize(item.output.size)} · ${item.output.width} × ${item.output.height}`
        : `${dimensions.width} × ${dimensions.height} · ${names[index]} · ${formatSize(item.file.size)} source`
      : item.rejection ? '' : 'Checking image…';
    item.errorLabel.textContent = item.error || item.rejection || '';
    item.errorLabel.hidden = !item.errorLabel.textContent;
    item.crop.hidden = !item.inspect || !item.proxyUrl || options.framing !== 'fill' || ['half', 'max-width'].includes(options.preset);
    item.crop.disabled = item.remove.disabled = busy;
    item.crop.classList.toggle('is-custom-crop', Boolean(item.focus));
    item.crop.setAttribute('aria-label', (item.focus ? 'Edit saved crop for ' : 'Reposition ') + item.file.name);
    item.download.hidden = busy || !item.output || !archive;
    if (item.inspect) index++;
  }
  $('file-count').textContent = `${items.length} ${items.length === 1 ? 'image' : 'images'}`;
  syncControls();
  repaint();
  estimateSize();
}

function estimateSize() {
  clearTimeout(estimateTimer);
  const version = ++estimateVersion;
  const ready = items.filter(item => item.inspect);
  const total = ready.reduce((sum, item) => sum + item.file.size, 0);
  $('total').textContent = archive ? `${formatSize(archive.size)} ZIP` : total ? `${formatSize(total)} source` : '';
  if (archive || !ready.length || job || importing) return;
  estimateTimer = setTimeout(async () => {
    const options = currentOptions();
    if (options.targetBytes || !['jpeg','webp'].includes(options.format)) return;
    const sample = ready.filter(item => item.image).slice(0, 4);
    if (!sample.length) return;
    const canvas = document.createElement('canvas');
    let bytes = 0, pixels = 0;
    for (const item of sample) {
      if (version !== estimateVersion) break;
      canvas.width = canvas.height = 1;
      preview(item, canvas);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/' + options.format, options.quality));
      if (blob?.type !== 'image/' + options.format || Math.min(canvas.width, canvas.height) < 50) continue;
      bytes += Math.max(0, blob.size - 512);
      pixels += canvas.width * canvas.height;
    }
    canvas.width = canvas.height = 1;
    if (version !== estimateVersion || !pixels || !bytes) return;
    const outputPixels = ready.reduce((sum, item) => {
      const dims = item.inspect.dimensions;
      const target = batchDimensions(dims, batchSettings(dims, options));
      return sum + target.width * target.height;
    }, 0);
    const projected = bytes / pixels * outputPixels + 512 * ready.length;
    if (Number.isFinite(projected) && projected >= 1024) {
      const rounded = Number(projected.toPrecision(1));
      $('total').textContent = `Approx. ${formatSize(rounded)} output · ${formatSize(total)} source`;
    }
  }, 300);
}

function clearArchive(clearErrors = true) {
  if (archiveUrl) URL.revokeObjectURL(archiveUrl);
  archive = archiveUrl = null;
  $('save').removeAttribute('href');
  for (const item of items) {
    item.output = null;
    if (clearErrors) item.error = '';
  }
}

function removeItem(item) {
  if (job || importing) return;
  visibility.unobserve(item.tile);
  item.row.remove();
  item.canvas.width = item.canvas.height = 1;
  if (item.proxyUrl) URL.revokeObjectURL(item.proxyUrl);
  items = items.filter(value => value !== item);
  if (!items.length) {
    workspace.classList.remove('settings-open');
    $('sheet').setAttribute('aria-expanded', 'false');
  }
  clearArchive();
  status.textContent = items.length ? '' : 'Select images to export.';
  refresh();
}

async function chooseFiles(files) {
  if (!files.length || job || importing) return;
  const batch = validateBatchBudget([...items.map(item => item.file), ...files]);
  if (!batch.ok) { status.textContent = batch.reason; return; }
  clearArchive();
  importing = true;
  status.textContent = 'Checking images…';
  const added = files.map(file => ({ file, id: crypto.randomUUID() }));
  items.push(...added);
  for (const item of added) addCard(item);
  refresh();
  try {
    for (const item of added) {
      try {
        const check = validateFileBudget(item.file);
        if (!check.ok) throw new Error(check.reason);
        const inspected = await runner.run({ op: 'batch-proxy', file: item.file }, [], 30_000);
        if (inspected.state !== 'completed') throw new Error(inspected.error?.message || 'The file could not be checked.');
        const { proxy, displayFile, ...info } = inspected.value;
        item.inspect = info;
        item.displayFile = displayFile;
        if (proxy || displayFile) item.proxyUrl = URL.createObjectURL(proxy || displayFile);
      } catch (error) {
        item.rejection = error.message || 'The file could not be checked.';
      }
      refresh();
    }
    const ready = items.filter(item => item.inspect).length;
    status.textContent = ready === items.length ? 'Ready to export.' : `${ready} of ${items.length} images can be exported.`;
  } finally {
    importing = false;
    refresh();
  }
}

function workerRun(message, signal, report) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const worker = new Worker(workerUrl, { type: 'module' });
    let settled = false;
    let timer;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      callback(result);
    };
    const abort = () => finish(reject, signal.reason);
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error('The image worker timed out. Try a smaller batch.')), message.type === 'probe' ? 5000 : 120_000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(reject, new Error('The image worker could not start.'));
    worker.onmessageerror = () => finish(reject, new Error('The image worker returned unreadable data.'));
    worker.onmessage = ({ data }) => {
      if (message.type === 'probe' || data.type === 'complete') finish(resolve, data);
      else if (data.type === 'error') finish(reject, new Error(data.message));
      else { armTimeout(); report?.(data); }
    };
    armTimeout();
    try { worker.postMessage(message); } catch (error) { finish(reject, error); }
  });
}

const workerCapabilities = new URLSearchParams(location.search).has('browserCanvas') ? Promise.resolve(null)
  : workerRun({ type: 'probe' }).then(result => result.supported ? result : null, () => null);

function archiveName() {
  return resizeTool ? 'resized-images.zip' : tool === 'compress' ? 'compressed-images.zip' : 'converted-images.zip';
}

function downloadBlob(blob, name, existingUrl = '') {
  const link = document.createElement('a');
  link.href = existingUrl || URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  if (!existingUrl) setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}

async function runExport(retry = false) {
  if (job || importing) return;
  const options = currentOptions();
  if ([...form.querySelectorAll('input')].some(control => !control.disabled && !control.checkValidity())) {
    status.textContent = 'Enter valid dimensions and file size before exporting.';
    return;
  }
  const count = items.filter(item => item.inspect && (!retry || item.error)).length;
  if (!count) return;
  const candidates = items.filter(item => item.inspect);
  const queue = candidates.map(item => ({ id: item.id, file: item.file, inspect: item.inspect, focus: item.focus, skip: retry && !item.error }));
  const totalSelected = items.length;
  clearArchive(!retry);
  const controller = new AbortController();
  job = controller;
  const { signal } = controller;
  status.textContent = 'Preparing export…';
  $('zip').textContent = 'Preparing export…';
  refresh();
  const report = message => {
    if (signal.aborted) return;
    if (message.type === 'progress') {
      const progress = `Processing ${message.current} of ${message.total}…`;
      $('zip').textContent = progress;
      status.textContent = message.name;
    } else if (message.type === 'item-error') {
      const failed = items.find(item => item.id === message.id);
      if (failed) {
        failed.error = failed.errorLabel.textContent = message.message;
        failed.errorLabel.hidden = false;
        updateQueueSummary();
      }
    }
  };
  try {
    const supported = await workerCapabilities;
    signal.throwIfAborted();
    const result = supported ? await workerRun({ type: 'export', items: queue, options }, signal, report)
      : await exportBatch(queue, options, {
        signal, report,
        async process(item, settings) {
          await new Promise(resolve => setTimeout(resolve, 0));
          signal.throwIfAborted();
          const original = items.find(value => value.id === item.id);
          return processBrowserImage(original?.displayFile || item.file, settings, { signal, batchOutput: true });
        },
      });
    signal.throwIfAborted();
    for (const output of result.outputs) {
      const item = items.find(value => value.id === output.id);
      item.output = output;
      item.error = '';
    }
    if (result.blob) {
      archive = result.blob;
      archiveUrl = URL.createObjectURL(archive);
      $('save').href = archiveUrl;
      $('save').download = archiveName();
      downloadBlob(archive, archiveName(), archiveUrl);
    }
    const expected = retry ? count : totalSelected;
    status.textContent = result.outputs.length
      ? `${result.outputs.length} of ${expected} images exported.`
      : 'No images were exported. Check the errors on the cards.';
  } catch (error) {
    status.textContent = signal.aborted ? 'Export cancelled. Your images and settings are ready to retry.' : error.message || 'The export failed.';
  } finally {
    job = null;
    refresh();
  }
}

const cropAxes = { x: 'width', y: 'height' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function paintCrop() {
  const { item, source, target, focus } = cropEdit;
  const cover = batchCover(source.width, source.height, target.width, target.height, focus);
  for (const [axis, dimension] of Object.entries(cropAxes)) {
    const travel = source[dimension] - cover[dimension];
    const percent = travel > .01 ? Math.round(100 * cover[axis] / travel) : 50;
    $('focus-' + axis).value = percent;
    for (const button of $('pan-' + axis).querySelectorAll('button')) {
      button.disabled = Number(button.dataset.step) < 0 ? percent === 0 : percent === 100;
    }
  }
  $('crop-reset').disabled = focus.x === .5 && focus.y === .5;
  preview(item, $('crop-image'), 640, focus);
}

async function openCrop(item) {
  if (job || importing || $('crop').open) return;
  await paintItem(item);
  if (!item.image || !items.includes(item) || item.crop.hidden || job || importing || $('crop').open) return;
  const source = item.inspect.dimensions;
  const target = batchDimensions(source, batchSettings(source, currentOptions()));
  if (!validateDimensions(target.width, target.height).ok) {
    status.textContent = 'Enter valid output dimensions before adjusting the crop.';
    return;
  }
  const cover = batchCover(source.width, source.height, target.width, target.height);
  const active = Object.entries(cropAxes).filter(([, dimension]) => source[dimension] - cover[dimension] > .01);
  cropEdit = { item, source, target, cover, active, focus: { ...(item.focus || { x: .5, y: .5 }) } };
  for (const axis of Object.keys(cropAxes)) $('pan-' + axis).hidden = !active.some(([key]) => key === axis);
  const stage = $('crop-stage');
  stage.style.setProperty('--frame-ratio', target.width / target.height);
  stage.classList.toggle('can-pan', active.length > 0);
  $('crop-help').textContent = active.length ? 'Drag the photo or use the position controls.' : 'This photo already matches the output frame.';
  $('crop').showModal();
  paintCrop();
}

function setCropPosition(axis, fraction) {
  const { source, cover, focus } = cropEdit;
  const dimension = cropAxes[axis];
  const travel = source[dimension] - cover[dimension];
  focus[axis] = (travel * fraction + cover[dimension] / 2) / source[dimension];
}

function stopCropDrag(pointerId) {
  if (!dragStart || (pointerId !== undefined && pointerId !== dragStart.id)) return;
  dragStart = null;
  $('crop-stage').classList.remove('is-panning');
}

$('crop-close').onclick = () => $('crop').close();
$('crop-reset').onclick = () => {
  if (!cropEdit) return;
  cropEdit.focus = { x: .5, y: .5 };
  paintCrop();
};
$('crop-done').onclick = () => {
  if (!cropEdit) return;
  const { item, focus } = cropEdit;
  const previous = item.focus || { x: .5, y: .5 };
  $('crop').close();
  if (focus.x === previous.x && focus.y === previous.y) return;
  item.focus = focus.x === .5 && focus.y === .5 ? undefined : focus;
  clearArchive();
  status.textContent = 'Crop updated.';
  refresh();
};
$('crop').addEventListener('close', () => {
  stopCropDrag();
  cropEdit = null;
});
for (const axis of Object.keys(cropAxes)) {
  const control = $('focus-' + axis);
  control.oninput = () => {
    setCropPosition(axis, control.valueAsNumber / 100);
    paintCrop();
  };
  for (const button of $('pan-' + axis).querySelectorAll('button')) {
    button.onclick = () => {
      setCropPosition(axis, clamp(control.valueAsNumber + Number(button.dataset.step), 0, 100) / 100);
      paintCrop();
    };
  }
}
$('crop-image').addEventListener('pointerdown', event => {
  if (!cropEdit?.active.length || dragStart || !event.isPrimary || event.button !== 0) return;
  const canvas = event.currentTarget;
  const { source, target, focus } = cropEdit;
  const bounds = canvas.getBoundingClientRect();
  const cover = batchCover(source.width, source.height, target.width, target.height, focus);
  canvas.setPointerCapture(event.pointerId);
  dragStart = { id: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, cover };
  $('crop-stage').classList.add('is-panning');
});
$('crop-image').addEventListener('pointermove', event => {
  if (!dragStart || event.pointerId !== dragStart.id || !cropEdit) return;
  const { source, active } = cropEdit;
  const { cover } = dragStart;
  for (const [axis, dimension] of active) {
    const coord = axis === 'x' ? event.clientX : event.clientY;
    const movement = (coord - dragStart[axis]) / dragStart[dimension] * cover[dimension];
    const travel = source[dimension] - cover[dimension];
    setCropPosition(axis, clamp((cover[axis] - movement) / travel, 0, 1));
  }
  paintCrop();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) {
  $('crop-image').addEventListener(type, event => stopCropDrag(event.pointerId));
}

form.noValidate = true;
form.addEventListener('submit', event => { event.preventDefault(); runExport(); });
form.addEventListener('input', event => {
  const field = event.target;
  if (field === $('preset')) {
    const size = presets[field.value];
    $('original').checked = $('stretch').checked = false;
    if (size) {
      [$('width').value, $('height').value] = size;
      ratio = size[0] / size[1];
      $('lock').setAttribute('aria-pressed', 'true');
    }
  }
  if (field === $('width') || field === $('height')) {
    $('preset').value = 'custom';
    if ($('lock').getAttribute('aria-pressed') === 'true' && field.valueAsNumber > 0) {
      const other = field === $('width') ? $('height') : $('width');
      other.value = Math.max(1, Math.round(field.valueAsNumber * (field === $('width') ? 1 / ratio : ratio)));
    }
  }
  if (field === $('original') && field.checked) $('stretch').checked = false;
  if (field === $('stretch') && field.checked) $('original').checked = false;
  if (field === $('format') && field.value === 'jpeg' && form.elements.padding.value === 'transparent') form.elements.padding.value = 'white';
  clearArchive();
  status.textContent = items.length ? 'Ready to export.' : 'Select images to export.';
  refresh();
});
$('lock').onclick = () => {
  const lock = $('lock').getAttribute('aria-pressed') === 'false';
  if (lock && $('width').valueAsNumber > 0 && $('height').valueAsNumber > 0) ratio = $('width').valueAsNumber / $('height').valueAsNumber;
  $('lock').setAttribute('aria-pressed', String(lock));
};
$('sheet').onclick = () => {
  const open = workspace.classList.toggle('settings-open');
  $('sheet').setAttribute('aria-expanded', String(open));
};
$('view').onclick = () => showGrid(!gridOpen);
$('cancel').onclick = () => job?.abort();
$('retry').onclick = () => runExport(true);
$('clear').onclick = () => { for (const item of [...items]) removeItem(item); };
for (const id of ['pick', 'add']) $(id).onclick = () => input.click();
input.addEventListener('change', () => {
  const selected = [...input.files];
  input.value = '';
  chooseFiles(selected);
});
gallery.addEventListener('dragover', event => {
  event.preventDefault();
  if (!job && !importing) gallery.classList.add('is-dragging');
});
gallery.addEventListener('dragleave', event => {
  if (!gallery.contains(event.relatedTarget)) gallery.classList.remove('is-dragging');
});
gallery.addEventListener('drop', event => {
  event.preventDefault();
  gallery.classList.remove('is-dragging');
  chooseFiles([...event.dataTransfer.files]);
});
new ResizeObserver(entries => {
  document.documentElement.style.setProperty('--batch-dock-height', entries[0].target.offsetHeight + 'px');
}).observe(workspace.querySelector('.batch-dock'));

workerCapabilities.then(capabilities => {
  const avifOption = $('format').querySelector('[value="avif"]');
  if (capabilities) {
    avifOption.hidden = !capabilities.avif;
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  canvas.toBlob(blob => { avifOption.hidden = blob?.type !== 'image/avif'; }, 'image/avif');
});
refresh();
