import { cropFrameSize, cropInPixels, drawCroppedPhoto } from '/lib/image/interactive-crop.js';
import { extensionFrame, extensionStrip, modelFrame, modelSize } from '/lib/image/extend-photo.js';
import { SECURITY_BUDGET, validateDimensions } from '/lib/security/budget.js';

export function createExtendPhoto({ addCopy, onError }) {
  const dialog = document.getElementById('extend-workspace');
  const preview = dialog.querySelector('canvas');
  const direction = dialog.querySelector('[name="extend-side"]');
  const amount = dialog.querySelector('[name="extend-amount"]');
  const status = dialog.querySelector('[role="status"]');
  const generate = dialog.querySelector('[data-extend-generate]');
  const compare = dialog.querySelector('[data-extend-compare]');
  const download = dialog.querySelector('[data-extend-download]');
  const add = dialog.querySelector('[data-extend-add]');
  const parameters = dialog.querySelector('fieldset');
  let source, draft, rect, full, name, bounds, strip, output, worker, timer;
  let opening = 0;

  function setBusy(busy) {
    parameters.disabled = busy;
    generate.disabled = busy;
    generate.textContent = busy ? 'Working…' : 'Generate preview';
  }

  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    setBusy(false);
  }

  function clearOutput() {
    strip = null;
    output = null;
    for (const control of [compare, download, add]) control.hidden = true;
    compare.setAttribute('aria-pressed', 'false');
    compare.textContent = 'Show original';
  }

  function paintCropped(target) {
    if (draft) drawCroppedPhoto(source, target, draft, full.width, full.height, rect);
    else target.getContext('2d').drawImage(source, 0, 0);
  }

  function paintPreview() {
    const scale = Math.min(1, 860 / Math.max(bounds.width, bounds.height));
    preview.width = Math.max(1, Math.round(bounds.width * scale));
    preview.height = Math.max(1, Math.round(bounds.height * scale));
    const context = preview.getContext('2d');
    const x = bounds.x * scale;
    const y = bounds.y * scale;
    const width = rect.width * scale;
    const height = rect.height * scale;
    if (draft) {
      const sample = document.createElement('canvas');
      sample.width = Math.max(1, Math.round(width));
      sample.height = Math.max(1, Math.round(height));
      const orientedWidth = Math.max(1, Math.round(full.width * scale));
      const orientedHeight = Math.max(1, Math.round(full.height * scale));
      const x = Math.min(orientedWidth - sample.width, Math.round(rect.x * scale));
      const y = Math.min(orientedHeight - sample.height, Math.round(rect.y * scale));
      drawCroppedPhoto(source, sample, draft, orientedWidth, orientedHeight, { x, y, width: sample.width, height: sample.height });
      context.drawImage(sample, Math.round(x), Math.round(y), sample.width, sample.height);
    } else {
      context.drawImage(source, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    }
    if (strip && compare.getAttribute('aria-pressed') === 'false') {
      const area = extensionStrip(bounds, rect.width, rect.height, direction.value);
      context.drawImage(strip, Math.round(area.x * scale), Math.round(area.y * scale),
        Math.round((area.x + area.width) * scale) - Math.round(area.x * scale),
        Math.round((area.y + area.height) * scale) - Math.round(area.y * scale));
    }
  }

  function update() {
    clearOutput();
    bounds = extensionFrame(rect.width, rect.height, direction.value, Number(amount.value));
    const limit = validateDimensions(bounds.width, bounds.height);
    generate.disabled = !limit.ok;
    status.textContent = limit.ok ? `${bounds.width} × ${bounds.height} px · The first run may download a 62 MB model.` : limit.reason;
    paintPreview();
  }

  async function open(image, crop, filename) {
    const current = ++opening;
    try {
      if (typeof image === 'string') {
        const decoded = new Image();
        decoded.src = image;
        await decoded.decode();
        image = decoded;
      }
      if (current !== opening) return;
      source = image;
      draft = crop;
      name = filename.replace(/\.[^.]+$/, '') + '-extended.png';
      full = cropFrameSize(source.naturalWidth, source.naturalHeight, draft?.turn);
      rect = cropInPixels(full.width, full.height, draft?.rect || {});
      direction.value = 'right';
      amount.value = '.2';
      if (!dialog.open) dialog.showModal();
      update();
    } catch {
      onError('This image could not be opened in Extend Photo.');
    }
  }

  function generatePreview() {
    clearOutput();
    paintPreview();
    const side = direction.value;
    const known = modelFrame(rect.width, rect.height, side, Number(amount.value));
    const sample = document.createElement('canvas');
    sample.width = sample.height = modelSize;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, modelSize, modelSize);
    if (draft) {
      const scaled = document.createElement('canvas');
      scaled.width = known.width;
      scaled.height = known.height;
      const scaleX = known.width / rect.width;
      const scaleY = known.height / rect.height;
      const x = Math.round(rect.x * scaleX);
      const y = Math.round(rect.y * scaleY);
      drawCroppedPhoto(source, scaled, draft, Math.max(x + known.width, Math.round(full.width * scaleX)),
        Math.max(y + known.height, Math.round(full.height * scaleY)),
        { x, y, width: known.width, height: known.height });
      context.drawImage(scaled, known.x, known.y);
    } else context.drawImage(source, known.x, known.y, known.width, known.height);
    const { data: pixels } = context.getImageData(0, 0, modelSize, modelSize);
    const fail = message => { stop(); status.textContent = message; };
    setBusy(true);
    status.textContent = 'Starting local processing…';
    try {
      worker = new Worker('/workers/extend-photo.worker.js', { type: 'module' });
      timer = setTimeout(() => fail('Photo extension timed out. Try again on a faster connection or device.'), 180_000);
      worker.onerror = () => fail('The local photo extension runtime could not start.');
      worker.onmessage = ({ data }) => {
        if (data.message) { status.textContent = data.message; return; }
        if (data.error) return fail(data.error);
        stop();
        strip = document.createElement('canvas');
        strip.width = data.width;
        strip.height = data.height;
        strip.getContext('2d').putImageData(new ImageData(data.output, data.width, data.height), 0, 0);
        paintPreview();
        for (const control of [compare, download, add]) control.hidden = false;
        status.textContent = `${bounds.width} × ${bounds.height} px · Review the generated edge before saving.`;
      };
      worker.postMessage({ pixels, known, side }, [pixels.buffer]);
    } catch {
      fail('The local photo extension runtime could not start.');
    }
  }

  async function outputBlob() {
    if (output) return output;
    const canvas = document.createElement('canvas');
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    const area = extensionStrip(bounds, rect.width, rect.height, direction.value);
    context.drawImage(strip, area.x, area.y, area.width, area.height);
    if (draft) {
      const original = document.createElement('canvas');
      original.width = rect.width;
      original.height = rect.height;
      paintCropped(original);
      context.drawImage(original, bounds.x, bounds.y);
      original.width = original.height = 1;
    } else context.drawImage(source, bounds.x, bounds.y);
    try {
      output = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!output || output.size > SECURITY_BUDGET.maxOutputBytes) throw new Error('PNG not available');
      return output;
    } finally { canvas.width = canvas.height = 1; }
  }

  async function save(asCopy) {
    setBusy(true);
    download.disabled = add.disabled = true;
    try {
      const blob = await outputBlob();
      if (!dialog.open) return;
      if (asCopy) {
        if (blob.size > SECURITY_BUDGET.maxFileBytes) {
          status.textContent = 'This PNG exceeds the Studio import limit. Use Download PNG to save it.';
          return;
        }
        await addCopy(new File([blob], name, { type: 'image/png' }));
        dialog.close();
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      status.textContent = asCopy && output ? error.message : 'This browser could not save the image at these dimensions. Try a smaller extension.';
    } finally {
      setBusy(false);
      download.disabled = add.disabled = false;
    }
  }

  dialog.querySelector('[data-extend-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    ++opening;
    stop();
    clearOutput();
    source = draft = null;
    preview.width = preview.height = 1;
  });
  for (const control of [direction, amount]) control.addEventListener('change', update);
  generate.onclick = generatePreview;
  compare.onclick = () => {
    const original = compare.getAttribute('aria-pressed') === 'false';
    compare.setAttribute('aria-pressed', String(original));
    compare.textContent = original ? 'Show extension' : 'Show original';
    paintPreview();
  };
  download.onclick = () => save(false);
  add.onclick = () => save(true);
  return { open };
}
