const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const minimum = .035;

export function cropFrameSize(width, height, turn = 0) {
  return Math.abs(turn % 2) === 1 ? { width: height, height: width } : { width, height };
}

export function boundedCrop(rect) {
  const width = clamp(number(rect.width, 1), minimum, 1);
  const height = clamp(number(rect.height, 1), minimum, 1);
  return {
    x: clamp(number(rect.x), 0, 1 - width), y: clamp(number(rect.y), 0, 1 - height), width, height,
  };
}

export function ratioCrop(width, height, ratio, focalX = .5, focalY = .5) {
  if (!ratio) return boundedCrop({ width: 1, height: 1 });
  const normalized = ratio * height / width;
  const w = Math.min(1, normalized);
  const h = Math.min(1, 1 / normalized);
  return boundedCrop({ x: focalX - w / 2, y: focalY - h / 2, width: w, height: h });
}

export function scaleCrop(rect, scale, centerX = .5, centerY = .5) {
  const allowable = Math.min(1 / rect.width, 1 / rect.height);
  const lower = Math.min(allowable, Math.max(minimum / rect.width, minimum / rect.height));
  const factor = clamp(scale, lower, allowable);
  return boundedCrop({
    x: rect.x + rect.width * centerX * (1 - factor),
    y: rect.y + rect.height * centerY * (1 - factor),
    width: rect.width * factor, height: rect.height * factor,
  });
}

export function dragCropCorner(rect, direction, dx, dy, lock) {
  if (direction.length === 1) return dragCropEdge(rect, direction, dx, dy, lock);
  const left = direction.includes('w');
  const top = direction.includes('n');
  const anchorX = left ? rect.x + rect.width : rect.x;
  const anchorY = top ? rect.y + rect.height : rect.y;
  const maxWidth = left ? anchorX : 1 - anchorX;
  const maxHeight = top ? anchorY : 1 - anchorY;
  let width = clamp(rect.width + (left ? -dx : dx), minimum, maxWidth);
  let height = clamp(rect.height + (top ? -dy : dy), minimum, maxHeight);
  if (lock) {
    const scale = Math.abs(dx / rect.width) >= Math.abs(dy / rect.height) ? width / rect.width : height / rect.height;
    const maxScale = Math.min(maxWidth / rect.width, maxHeight / rect.height);
    const factor = clamp(scale, Math.min(maxScale, Math.max(minimum / rect.width, minimum / rect.height)), maxScale);
    width = rect.width * factor;
    height = rect.height * factor;
  }
  return boundedCrop({ x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height });
}

function dragCropEdge(rect, direction, dx, dy, lock) {
  const horizontal = direction === 'w' || direction === 'e';
  const fromStart = direction === 'w' || direction === 'n';
  const origin = horizontal ? rect.x : rect.y;
  const length = horizontal ? rect.width : rect.height;
  const crossOrigin = horizontal ? rect.y : rect.x;
  const crossLength = horizontal ? rect.height : rect.width;
  const anchor = fromStart ? origin + length : origin;
  const center = crossOrigin + crossLength / 2;
  const available = fromStart ? anchor : 1 - anchor;
  const maxScale = lock ? Math.min(available / length, 2 * Math.min(center, 1 - center) / crossLength) : available / length;
  const minScale = lock ? Math.max(minimum / length, minimum / crossLength) : minimum / length;
  const change = (horizontal ? dx : dy) * (fromStart ? -1 : 1);
  const scale = clamp(1 + change / length, Math.min(minScale, maxScale), maxScale);
  const size = length * scale;
  const across = lock ? crossLength * scale : crossLength;
  const start = fromStart ? anchor - size : anchor;
  const other = center - across / 2;
  return boundedCrop(horizontal
    ? { x: start, y: other, width: size, height: across }
    : { x: other, y: start, width: across, height: size });
}

export function cropInPixels(width, height, rect) {
  const frame = boundedCrop(rect);
  const x = Math.min(width - 1, Math.round(frame.x * width));
  const y = Math.min(height - 1, Math.round(frame.y * height));
  return {
    x, y, width: Math.min(width - x, Math.max(1, Math.round(frame.width * width))),
    height: Math.min(height - y, Math.max(1, Math.round(frame.height * height))),
  };
}

export function drawCropSource(source, canvas, draft) {
  const { width, height } = canvas;
  if (draft.horizontal || draft.vertical) {
    drawPerspectiveCrop(source, canvas, draft, width, height, { x: 0, y: 0, width, height });
  } else {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    drawAffine(context, source, draft, width, height);
  }
  return canvas;
}

function drawAffine(context, source, draft, width, height, x = 0, y = 0) {
  const swap = Math.abs(draft.turn % 2) === 1;
  const sourceWidth = swap ? height : width;
  const sourceHeight = swap ? width : height;
  const angle = clamp(number(draft.angle), -35, 35) * Math.PI / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const cover = Math.max(c + s * height / width, c + s * width / height);
  context.save();
  context.imageSmoothingQuality = 'high';
  context.translate(width / 2 - x, height / 2 - y);
  context.rotate(angle);
  context.scale(draft.flip ? -cover : cover, cover);
  context.rotate((draft.turn % 4) * Math.PI / 2);
  context.drawImage(source, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  context.restore();
}

// Source tiles cover each output tile's inverse-projected corners. The projective
// denominator stays positive, so each source-coordinate extremum lies at a corner.
export function drawPerspectiveCrop(source, canvas, draft, width, height, crop) {
  const context = canvas.getContext('2d');
  const scratch = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const sample = scratch.getContext('2d', { willReadFrequently: true });
  const horizontal = clamp(number(draft.horizontal), -45, 45) / 90;
  const vertical = clamp(number(draft.vertical), -45, 45) / 90;
  const offset = 1 + Math.abs(horizontal) + Math.abs(vertical);
  const maxX = width - 1;
  const maxY = height - 1;
  const tile = 384;
  const project = (x, y) => {
    const u = (x + .5) * 2 / width - 1;
    const v = (y + .5) * 2 / height - 1;
    const d = offset + vertical * u + horizontal * v;
    return [(u / d + 1) * maxX / 2, (v / d + 1) * maxY / 2];
  };
  for (let y = 0; y < crop.height; y += tile) {
    const h = Math.min(tile, crop.height - y);
    for (let x = 0; x < crop.width; x += tile) {
      const w = Math.min(tile, crop.width - x);
      const left = crop.x + x;
      const top = crop.y + y;
      const corners = [project(left, top), project(left + w - 1, top), project(left, top + h - 1), project(left + w - 1, top + h - 1)];
      const xs = corners.map(point => point[0]);
      const ys = corners.map(point => point[1]);
      const sx = Math.max(0, Math.floor(Math.min(...xs)));
      const sy = Math.max(0, Math.floor(Math.min(...ys)));
      scratch.width = Math.min(width, Math.floor(Math.max(...xs)) + 2) - sx;
      scratch.height = Math.min(height, Math.floor(Math.max(...ys)) + 2) - sy;
      drawAffine(sample, source, draft, width, height, sx, sy);
      const sw = scratch.width;
      const sh = scratch.height;
      const input = sample.getImageData(0, 0, sw, sh).data;
      const out = context.createImageData(w, h);
      for (let row = 0; row < h; row++) {
        const v = (top + row + .5) * 2 / height - 1;
        for (let col = 0; col < w; col++) {
          const u = (left + col + .5) * 2 / width - 1;
          const d = offset + vertical * u + horizontal * v;
          const px = (u / d + 1) * maxX / 2 - sx;
          const py = (v / d + 1) * maxY / 2 - sy;
          const ix = Math.floor(px);
          const iy = Math.floor(py);
          const dx = px - ix;
          const dy = py - iy;
          const a = (iy * sw + ix) * 4;
          const right = ix + 1 < sw ? 4 : 0;
          const bottom = iy + 1 < sh ? sw * 4 : 0;
          const dest = (row * w + col) * 4;
          for (let c = 0; c < 4; c++) {
            const i = a + c;
            const upper = input[i] + (input[i + right] - input[i]) * dx;
            const lower = input[i + bottom] + (input[i + bottom + right] - input[i + bottom]) * dx;
            out.data[dest + c] = upper + (lower - upper) * dy;
          }
        }
      }
      context.putImageData(out, x, y);
    }
  }
  scratch.width = scratch.height = 1;
  return canvas;
}

export function drawCroppedPhoto(source, canvas, draft, width, height, crop) {
  if (draft.horizontal || draft.vertical) return drawPerspectiveCrop(source, canvas, draft, width, height, crop);
  drawAffine(canvas.getContext('2d'), source, draft, width, height, crop.x, crop.y);
  return canvas;
}
