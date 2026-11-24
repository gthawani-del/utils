export const modelSize = 512;

export function extensionFrame(width, height, side, amount) {
  const horizontal = side === 'left' || side === 'right';
  const pixels = Math.max(1, Math.round((horizontal ? width : height) * amount));
  return {
    width: width + (horizontal ? pixels : 0),
    height: height + (horizontal ? 0 : pixels),
    x: side === 'left' ? pixels : 0,
    y: side === 'top' ? pixels : 0,
  };
}

export function modelFrame(width, height, side, amount) {
  const frame = extensionFrame(width, height, side, amount);
  const scale = modelSize / Math.max(frame.width, frame.height);
  const spanX = Math.max(side === 'left' || side === 'right' ? 2 : 1, Math.round(frame.width * scale));
  const spanY = Math.max(side === 'top' || side === 'bottom' ? 2 : 1, Math.round(frame.height * scale));
  const padX = Math.floor((modelSize - spanX) / 2);
  const padY = Math.floor((modelSize - spanY) / 2);
  const w = Math.min(spanX - (width < frame.width ? 1 : 0), Math.max(1, Math.round(width * scale)));
  const h = Math.min(spanY - (height < frame.height ? 1 : 0), Math.max(1, Math.round(height * scale)));
  const x = padX + (side === 'left' ? spanX - w : 0);
  const y = padY + (side === 'top' ? spanY - h : 0);
  const result = extensionStrip({ width: spanX, height: spanY }, w, h, side);
  return { x, y, width: w, height: h, result: { ...result, x: result.x + padX, y: result.y + padY } };
}

export function extensionStrip(frame, width, height, side) {
  return { x: side === 'right' ? width : 0, y: side === 'bottom' ? height : 0,
    width: frame.width - width || width, height: frame.height - height || height };
}
