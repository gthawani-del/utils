import { validateBatchBudget, validateFileBudget } from '/lib/security/budget.js';
import { WorkerRunner } from '/lib/security/worker-runner.js';
import { processBrowserImage, shouldUseBrowserProcessor } from '/lib/image/browser-processor.js';
import { contactSheetLayout } from '/lib/image/batch.js';

const $ = name => document.getElementById('contact-' + name);
const input = $('files');
const form = $('form');
const preview = $('preview');
const download = $('download');
const status = $('status');
const errors = $('errors');
const runner = new WorkerRunner(new URL('/workers/image.worker.js', location.origin));
const useBrowserProcessor = shouldUseBrowserProcessor();
let files = [];
let previewUrl = '';

function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  preview.hidden = download.hidden = true;
  preview.removeAttribute('src');
  download.removeAttribute('href');
  errors.replaceChildren();
}

input.addEventListener('change', () => {
  const selected = [...input.files];
  const budget = validateBatchBudget(selected);
  if (!budget.ok) { status.textContent = budget.reason; input.value = ''; return; }
  files = selected;
  clearPreview();
  form.hidden = files.length === 0;
  status.textContent = files.length ? `${files.length} ${files.length === 1 ? 'image' : 'images'} selected.` : '';
});
form.addEventListener('input', () => {
  clearPreview();
  status.textContent = '';
});

async function imageThumbnail(file, edge) {
  const budget = validateFileBudget(file);
  if (!budget.ok) throw new Error(budget.reason);
  const settings = { width: edge, height: edge, format: 'png', preserveAspect: true, previewMaxEdge: edge };
  let result;
  if (useBrowserProcessor) {
    const checkBytes = await file.arrayBuffer();
    const inspection = await runner.run({ op: 'inspect', buffer: checkBytes }, [checkBytes], 15_000);
    if (inspection.state !== 'completed') throw new Error(inspection.error?.message || 'Unsupported image.');
    result = await processBrowserImage(file, settings, { preview: true });
  } else {
    const buffer = await file.arrayBuffer();
    result = await runner.run({ op: 'preview', buffer, settings }, [buffer]);
  }
  if (result.state !== 'completed') throw new Error(result.error?.message || 'Preview unavailable.');
  const { mime, buffer } = result.value;
  return new Blob([buffer], { type: mime });
}

async function drawThumbnail(context, blob, x, y, tile) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, x + (tile - image.naturalWidth) / 2, y + (tile - image.naturalHeight) / 2);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitLabel(context, label, width) {
  if (context.measureText(label).width <= width) return label;
  const characters = Array.from(label);
  while (characters.length && context.measureText(characters.join('') + '…').width > width) characters.pop();
  return characters.join('') + '…';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (input.disabled || !files.length) return;
  if (!('Worker' in window) || (!useBrowserProcessor && !('OffscreenCanvas' in window))) {
    status.textContent = 'This browser does not support local image processing.';
    return;
  }
  clearPreview();
  input.disabled = $('generate').disabled = $('columns').disabled = $('labels').disabled = true;
  try {
    const labels = $('labels').value;
    const columns = Number($('columns').value);
    const thumbnails = [];
    for (const [index, file] of files.entries()) {
      status.textContent = `Preparing ${index + 1} of ${files.length} images…`;
      try {
        thumbnails.push({ file, image: await imageThumbnail(file, 240) });
      } catch (error) {
        const row = document.createElement('li');
        row.textContent = `${file.name}: ${error.message}`;
        errors.append(row);
      }
    }
    if (!thumbnails.length) { status.textContent = 'No images could be added.'; return; }

    const layout = contactSheetLayout(thumbnails.length, columns, labels !== 'none');
    const { tile, gap, labelHeight, width, height } = layout;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.font = '16px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [index, entry] of thumbnails.entries()) {
      const x = gap + index % layout.columns * (tile + gap);
      const y = gap + Math.floor(index / layout.columns) * (tile + gap + labelHeight);
      context.fillStyle = '#edf0ed';
      context.fillRect(x, y, tile, tile);
      await drawThumbnail(context, entry.image, x, y, tile);
      if (labels !== 'none') {
        const label = labels === 'numbers' ? String(index + 1).padStart(2, '0') : entry.file.name;
        context.fillStyle = '#17231f';
        context.fillText(fitLabel(context, label, tile - 8), x + tile / 2, y + tile + labelHeight / 2);
      }
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { status.textContent = 'The contact sheet could not be encoded.'; return; }
    previewUrl = URL.createObjectURL(blob);
    preview.src = download.href = previewUrl;
    preview.hidden = download.hidden = false;
    status.textContent = `Contact sheet ready: ${thumbnails.length} of ${files.length} images · ${width} × ${height} px.`;
  } catch {
    status.textContent = 'The contact sheet could not be created.';
  } finally {
    input.disabled = $('generate').disabled = $('columns').disabled = $('labels').disabled = false;
  }
});
