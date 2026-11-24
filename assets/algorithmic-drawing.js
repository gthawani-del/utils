import { drawAlgorithmicArt } from '/lib/image/algorithmic-drawing.js';

const preview = document.querySelector('#drawing-preview');
const status = document.querySelector('#drawing-status');
const controls = Object.fromEntries(
  ['pattern', 'palette', 'density', 'seed', 'size', 'transparent'].map(id => [id, document.getElementById(id)]),
);
const webp = document.querySelector('#download-webp');
const png = document.querySelector('#download-png');

function currentDrawing() {
  const [width, height] = controls.size.value.split('x').map(Number);
  const settings = {
    pattern: controls.pattern.value,
    palette: controls.palette.value,
    density: controls.density.valueAsNumber,
    seed: controls.seed.valueAsNumber,
    transparent: controls.transparent.checked,
  };
  return { width, height, settings };
}

function renderPreview() {
  if (!controls.seed.value || !controls.seed.validity.valid) {
    status.textContent = 'Enter a whole-number seed from 0 to 4,294,967,295.';
    return;
  }
  status.textContent = '';
  const { width, height, settings } = currentDrawing();
  const scale = 640 / Math.max(width, height);
  preview.width = Math.round(width * scale);
  preview.height = Math.round(height * scale);
  drawAlgorithmicArt(preview.getContext('2d'), preview.width, preview.height, settings);
  preview.setAttribute('aria-label', `${controls.pattern.selectedOptions[0].text}, ${controls.palette.selectedOptions[0].text} palette, seed ${settings.seed}`);
}

for (const control of Object.values(controls)) control.addEventListener('input', renderPreview);
document.querySelector('#new-seed').addEventListener('click', () => {
  controls.seed.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
  renderPreview();
});

async function download(format) {
  if (!controls.seed.value || !controls.seed.reportValidity()) {
    controls.seed.focus();
    return;
  }
  const { width, height, settings } = currentDrawing();
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const type = `image/${format}`;
  webp.disabled = png.disabled = true;
  try {
    drawAlgorithmicArt(output.getContext('2d'), width, height, settings);
    const blob = await new Promise(resolve => output.toBlob(resolve, type, 0.94));
    if (!blob || blob.type !== type) {
      status.textContent = format === 'webp' ? 'WebP export is unavailable in this browser. Use PNG.' : 'Could not create the PNG.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${settings.pattern}-${settings.seed}-${width}x${height}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status.textContent = `Downloaded ${width} × ${height} ${format.toUpperCase()}.`;
  } catch {
    status.textContent = 'Could not export this drawing. Try again.';
  } finally {
    webp.disabled = png.disabled = false;
  }
}

webp.addEventListener('click', () => download('webp'));
png.addEventListener('click', () => download('png'));
renderPreview();
