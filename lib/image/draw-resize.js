import { coverRect } from './math.js';
import { batchCover } from './batch.js';

export function drawResize(context, source, crop, target, settings, basis = crop, output = target) {
  const { width, height } = target;
  const { resizeMode, format, solidBackground, background, blurPadding, batchFocus, smartCrop } = settings;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (format === 'jpeg' || solidBackground || blurPadding) {
    context.fillStyle = background || '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  if (blurPadding) {
    // Blur a bounded background sample so large exports use the same filter as previews.
    const sample = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(96, 96) : document.createElement('canvas');
    sample.width = 96;
    sample.height = 96;
    const blur = sample.getContext('2d');
    const cover = coverRect(basis.width, basis.height, width, height);
    const scaleX = crop.width / basis.width;
    const scaleY = crop.height / basis.height;
    blur.drawImage(source, crop.x + cover.x * scaleX, crop.y + cover.y * scaleY,
      cover.width * scaleX, cover.height * scaleY, 0, 0, 96, 96);
    soften(blur);
    context.drawImage(sample, 0, 0, width, height);
    sample.width = sample.height = 1;
  }
  if (resizeMode === 'fill') {
    const cover = batchFocus
      ? batchCover(basis.width, basis.height, output.width, output.height, batchFocus)
      : coverRect(basis.width, basis.height, width, height, smartCrop?.focusX, smartCrop?.focusY);
    const scaleX = crop.width / basis.width;
    const scaleY = crop.height / basis.height;
    context.drawImage(source, crop.x + cover.x * scaleX, crop.y + cover.y * scaleY,
      cover.width * scaleX, cover.height * scaleY, 0, 0, width, height);
  } else if (resizeMode === 'contain') {
    const scale = Math.min(width / basis.width, height / basis.height);
    const w = Math.max(1, Math.round(basis.width * scale));
    const h = Math.max(1, Math.round(basis.height * scale));
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  } else {
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  }
}

function soften(context) {
  const edge = 96;
  const radius = 6;
  const image = context.getImageData(0, 0, edge, edge);
  const intermediate = new Uint8ClampedArray(image.data.length);
  const passes = [
    { input: image.data, output: intermediate, stride: 4 },
    { input: intermediate, output: image.data, stride: edge * 4 },
  ];
  for (const { input, output, stride } of passes) {
    for (let line = 0; line < edge; line++) {
      const start = line * (stride === 4 ? edge * 4 : 4);
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += input[start + Math.max(0, k) * stride + c];
        for (let i = 0; i < edge; i++) {
          output[start + i * stride + c] = sum / (2 * radius + 1);
          sum += input[start + Math.min(edge - 1, i + radius + 1) * stride + c]
            - input[start + Math.max(0, i - radius) * stride + c];
        }
      }
    }
  }
  context.putImageData(image, 0, 0);
}
