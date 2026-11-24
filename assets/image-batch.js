import { SECURITY_BUDGET, validateBatchBudget, validateDimensions, validateFileBudget } from '/lib/security/budget.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { processBrowserImage, shouldUseBrowserProcessor } from '/lib/image/browser-processor.js';
import { batchDimensions, batchFilenames, batchSettings } from '/lib/image/batch.js';

const $ = id => document.getElementById('batch-' + id);
const input = $('input');
const form = $('form');
const fileList = $('files');
const status = $('status');
const framing = $('framing');
const format = $('format');
const compression = $('compression');
const generate = $('generate');
const zip = $('zip');
const runner = new WorkerRunner(new URL('/workers/image.worker.js', location.origin));
const useBrowserProcessor = shouldUseBrowserProcessor();
const tool = new URLSearchParams(location.search).get('tool');
const resizePresets = { product: [2000, 2000], square: [1080, 1080], portrait: [1080, 1350] };
const zipByteBudget = SECURITY_BUDGET.maxOutputBytes * 4;
let items = [];
let busy = false;

if (tool === 'convert' || tool === 'compress') {
  const title = tool === 'convert' ? 'Convert Image' : 'Compress Image';
  $('heading').textContent = title;
  document.title = title + ' · Utility OS';
  $('intro').textContent = tool === 'convert'
    ? 'Change format while keeping the original image dimensions. Files stay on this device.'
    : 'Reduce file size without changing image dimensions. Files stay on this device.';
  framing.value = 'original';
  $('preset-field').hidden = true;
  $('framing-field').hidden = true;
  if (tool === 'compress') $('options').open = true;
}

function readOptions() {
  return {
    framing: framing.value,
    width: $('width').valueAsNumber,
    height: $('height').valueAsNumber,
    padding: $('padding').value,
    format: format.value,
    quality: $('quality').valueAsNumber / 100,
    targetBytes: format.value !== 'png' && compression.value === 'target' ? $('target').valueAsNumber * 1024 : 0,
  };
}

function updateControls() {
  const original = framing.value === 'original';
  const useQuality = format.value !== 'png';
  const target = useQuality && compression.value === 'target';
  $('dimensions').hidden = original;
  $('frame-help').hidden = tool === 'convert' || tool === 'compress';
  $('frame-help').textContent = {
    contain: 'Keep the whole image and pad the extra space.',
    fit: 'Keep the proportions. Output dimensions may differ between files.',
    fill: 'Cover the full frame. Edges may be cropped.',
    original: 'Keep each image at its original width and height.',
  }[framing.value];
  $('padding-field').hidden = framing.value !== 'contain' || format.value === 'jpeg';
  $('compression-field').hidden = !useQuality;
  $('quality-field').hidden = !useQuality || target;
  $('target-field').hidden = !target;
  $('quality-value').textContent = $('quality').value + '%';
  for (const control of form.querySelectorAll('input, select')) control.disabled = busy || Boolean(control.closest('[hidden]'));
  input.disabled = busy;
  generate.disabled = busy || !items.some(item => item.inspect);
  zip.disabled = busy;
  zip.hidden = items.filter(item => item.output).length < 2;
}

function releaseOutput(item) {
  if (item.output) URL.revokeObjectURL(item.output.url);
  item.output = null;
  item.error = '';
}

function namesForReady(options) {
  return batchFilenames(items.filter(item => item.inspect).map(item => item.file), options.format, $('prefix').value.trim());
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFiles() {
  fileList.replaceChildren();
  $('file-count').textContent = items.length === 1 ? '1 image' : `${items.length} images`;
  const options = readOptions();
  let index = 0;
  const names = namesForReady(options);
  for (const item of items) {
    const row = document.createElement('li');
    const previewUrl = item.output?.url || item.sourceUrl;
    if (previewUrl) {
      const image = document.createElement('img');
      image.src = previewUrl;
      image.alt = item.output ? 'Output preview' : 'Original preview';
      image.loading = 'lazy';
      row.append(image);
    }
    const info = document.createElement('div');
    info.className = 'batch-file-info';
    const name = document.createElement('strong');
    const detail = document.createElement('span');
    name.textContent = item.file.name;
    if (item.inspect) {
      const dimensions = item.inspect.dimensions;
      const plannedName = names[index++];
      const planned = batchDimensions(dimensions, batchSettings(dimensions, options));
      detail.textContent = item.error || (item.output
        ? `${item.output.name} · ${item.output.width} × ${item.output.height} · ${formatSize(item.output.blob.size)}`
        : `${dimensions.width} × ${dimensions.height} → ${planned.width} × ${planned.height} · ${plannedName}`);
    } else {
      detail.textContent = item.rejection;
    }
    info.append(name, detail);
    row.append(info);
    if (item.output && !busy) {
      const download = document.createElement('a');
      download.href = item.output.url;
      download.download = item.output.name;
      download.textContent = 'Download';
      download.setAttribute('aria-label', `Download ${item.output.name}`);
      row.append(download);
    }
    fileList.append(row);
  }
  updateControls();
}

async function chooseFiles(files) {
  if (!files.length || busy) return;
  const budget = validateBatchBudget(files);
  if (!budget.ok) { status.textContent = budget.reason; return; }
  if (!('Worker' in window) || (!useBrowserProcessor && !('OffscreenCanvas' in window))) {
    status.textContent = 'This browser does not support local image processing.';
    return;
  }
  for (const item of items) {
    releaseOutput(item);
    if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
  }
  items = [];
  busy = true;
  updateControls();
  status.textContent = 'Checking images…';
  try {
    for (const file of files) {
      const limit = validateFileBudget(file);
      if (!limit.ok) { items.push({ file, rejection: limit.reason }); continue; }
      const buffer = await file.arrayBuffer();
      const result = await runner.run({ op: 'inspect', buffer }, [buffer], 15_000);
      if (result.state === 'completed') {
        const { kind, mime } = result.value;
        const sourceUrl = kind === 'svg' ? '' : URL.createObjectURL(new Blob([file], { type: mime }));
        items.push({ file, inspect: result.value, sourceUrl });
      } else {
        items.push({ file, rejection: result.error?.message || 'This image could not be checked.' });
      }
    }
    const ready = items.filter(item => item.inspect).length;
    status.textContent = ready === items.length ? '' : `${ready} of ${items.length} images can be processed.`;
  } catch {
    status.textContent = 'Some files could not be checked. You can choose them again.';
  } finally {
    busy = false;
    input.value = '';
    form.hidden = items.length === 0;
    renderFiles();
  }
}

async function previewExports(event) {
  event.preventDefault();
  if (busy) return;
  const options = readOptions();
  if (options.framing !== 'original') {
    const check = validateDimensions(options.width, options.height);
    if (!check.ok) { status.textContent = check.reason; return; }
  }
  const candidates = items.filter(item => item.inspect);
  const names = namesForReady(options);
  busy = true;
  let totalBytes = 0;
  let ready = 0;
  for (const item of items) releaseOutput(item);
  renderFiles();
  try {
    for (const [index, item] of candidates.entries()) {
      status.textContent = `Preparing ${index + 1} of ${candidates.length} images…`;
      const settings = batchSettings(item.inspect.dimensions, options);
      try {
        const result = useBrowserProcessor
          ? await processBrowserImage(item.file, settings)
          : await processWithWorker(item.file, settings);
        if (result.state !== 'completed') {
          item.error = result.error?.message || 'Unable to prepare this image.';
          continue;
        }
        const { mime, buffer, width, height } = result.value;
        if (options.targetBytes && buffer.byteLength > options.targetBytes) {
          item.error = `Limit could not be met. Result at the closest available quality: ${formatSize(buffer.byteLength)}.`;
          continue;
        }
        if (totalBytes + buffer.byteLength + 512 > zipByteBudget) {
          item.error = 'Batch output limit reached. Try a smaller batch or lower output sizes.';
          continue;
        }
        totalBytes += buffer.byteLength + 512;
        const blob = new Blob([buffer], { type: mime });
        item.output = { blob, width, height, name: names[index], url: URL.createObjectURL(blob) };
        ready++;
      } catch {
        item.error = 'Unable to prepare this image.';
      }
    }
    status.textContent = ready === candidates.length
      ? `${ready} ${ready === 1 ? 'image' : 'images'} ready to download.`
      : `${ready} of ${candidates.length} images ready. Check the file list for details.`;
  } finally {
    busy = false;
    renderFiles();
  }
}

async function processWithWorker(file, settings) {
  const buffer = await file.arrayBuffer();
  return runner.run({ op: 'process', buffer, settings }, [buffer]);
}

async function downloadZip() {
  if (busy) return;
  const outputs = items.flatMap(item => item.output ? [item.output] : []);
  if (outputs.length < 2) return;
  busy = true;
  updateControls();
  status.textContent = 'Packing ZIP…';
  try {
    const files = await Promise.all(outputs.map(async output => ({
      name: output.name, buffer: await output.blob.arrayBuffer(),
    })));
    const result = await runner.run({ op: 'zip', files }, files.map(file => file.buffer), 45_000);
    if (result.state !== 'completed') {
      status.textContent = result.error?.message || 'ZIP export failed. You can download files individually.';
      return;
    }
    const url = URL.createObjectURL(new Blob([result.value.buffer], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'utility-os-images.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status.textContent = `${outputs.length} images exported as ZIP.`;
  } catch {
    status.textContent = 'ZIP export failed. You can download files individually.';
  } finally {
    busy = false;
    updateControls();
  }
}

input.addEventListener('change', () => chooseFiles([...input.files]));
const picker = input.closest('.batch-picker');
picker.addEventListener('dragover', event => event.preventDefault());
picker.addEventListener('drop', event => {
  event.preventDefault();
  chooseFiles([...event.dataTransfer.files]);
});
$('preset').addEventListener('input', () => {
  const key = $('preset').value;
  if (!(key in resizePresets)) return;
  [$('width').value, $('height').value] = resizePresets[key];
  framing.value = 'contain';
  if (key === 'product') {
    format.value = 'jpeg';
    $('padding').value = 'white';
  }
});
form.addEventListener('input', event => {
  if (event.target === $('width') || event.target === $('height') || event.target === framing) $('preset').value = 'custom';
  for (const item of items) releaseOutput(item);
  status.textContent = '';
  renderFiles();
});
form.addEventListener('submit', previewExports);
zip.addEventListener('click', downloadZip);
updateControls();
