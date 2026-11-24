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
  const swap = Math.abs(draft.turn % 2) === 1;
  const sourceWidth = swap ? height : width;
  const sourceHeight = swap ? width : height;
  const angle = clamp(number(draft.angle), -35, 35) * Math.PI / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const cover = Math.max(c + s * height / width, c + s * width / height);
  const horizontal = clamp(number(draft.horizontal), -45, 45) / 90;
  const vertical = clamp(number(draft.vertical), -45, 45) / 90;
  const context = canvas.getContext('2d', { willReadFrequently: Boolean(horizontal || vertical) });
  context.clearRect(0, 0, width, height);
  context.save();
  context.imageSmoothingQuality = 'high';
  context.translate(width / 2, height / 2);
  context.rotate(angle);
  context.scale(draft.flip ? -cover : cover, cover);
  context.rotate((draft.turn % 4) * Math.PI / 2);
  context.drawImage(source, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  context.restore();
  if (horizontal || vertical) warpPerspective(context, width, height, horizontal, vertical);
  return canvas;
}

// Inverse projective sampling. The denominator stays positive and the zoom
// keeps the sample inside the photo even at the strongest supported correction.
function warpPerspective(context, width, height, horizontal, vertical) {
  const input = context.getImageData(0, 0, width, height).data;
  const output = context.createImageData(width, height);
  const allowance = Math.abs(horizontal) + Math.abs(vertical);
  const maxX = width - 1;
  const maxY = height - 1;
  for (let y = 0; y < height; y++) {
    const v = (y + .5) * 2 / height - 1;
    for (let x = 0; x < width; x++) {
      const u = (x + .5) * 2 / width - 1;
      const denominator = 1 + allowance + vertical * u + horizontal * v;
      const sx = (u / denominator + 1) * maxX / 2;
      const sy = (v / denominator + 1) * maxY / 2;
      const left = Math.floor(sx);
      const top = Math.floor(sy);
      const dx = sx - left;
      const dy = sy - top;
      const right = Math.min(maxX, left + 1);
      const bottom = Math.min(maxY, top + 1);
      const dest = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = input[(top * width + left) * 4 + c] * (1 - dx) + input[(top * width + right) * 4 + c] * dx;
        const b = input[(bottom * width + left) * 4 + c] * (1 - dx) + input[(bottom * width + right) * 4 + c] * dx;
        output.data[dest + c] = a * (1 - dy) + b * dy;
      }
    }
  }
  context.putImageData(output, 0, 0);
}
