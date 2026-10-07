// Low-cost translational camera motion estimator. Experimental; not optical-flow stabilization.
export function estimateTranslation(previous, current, width, height, radius = 3) {
  if (!previous || !current || previous.length !== width * height * 4 || current.length !== previous.length) throw new RangeError('Invalid frames');
  let best = { dx: 0, dy: 0, error: Infinity };
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    let error = 0, count = 0;
    for (let y = radius + 2; y < height - radius - 2; y += 2) {
      for (let x = radius + 2; x < width - radius - 2; x += 2) {
        const i = (y * width + x) * 4;
        const j = ((y + dy) * width + x + dx) * 4;
        error += Math.abs(previous[i] - current[j]) + Math.abs(previous[i+1] - current[j+1]) + Math.abs(previous[i+2] - current[j+2]);
        count++;
      }
    }
    if (count && error / count < best.error) best = { dx, dy, error: error / count };
  }
  return best;
}
export function smoothCameraOffset(previousOffset, dx, dy, strength = 0.5) {
  const blend = Math.max(0, Math.min(1, strength));
  return {
    x: Math.max(-12, Math.min(12, previousOffset.x * (1 - blend) - dx * blend)),
    y: Math.max(-12, Math.min(12, previousOffset.y * (1 - blend) - dy * blend))
  };
}
