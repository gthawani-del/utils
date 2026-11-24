const palettes = {
  fern: ['#f4f3e9', '#173e34', '#38745c', '#596418'],
  ink: ['#f4f2ff', '#27244f', '#494295', '#6e3b85'],
  clay: ['#fff3e6', '#53281f', '#8b3e27', '#a65430'],
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function drawAlgorithmicArt(context, width, height, settings) {
  const { pattern, seed, density, palette, transparent } = settings;
  const [paper, ...inks] = palettes[palette] ?? palettes.fern;
  const random = seededRandom(seed);
  const size = Math.min(width, height);
  const count = 8 + Math.round(density * 0.65);
  const phase = random() * Math.PI * 2;
  const frequency = 3 + Math.floor(random() * 5);
  const offsetX = (random() - 0.5) * 0.18;
  const offsetY = (random() - 0.5) * 0.18;

  context.clearRect(0, 0, width, height);
  if (!transparent) {
    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);
  }
  context.lineWidth = Math.max(1, size * 0.0015);

  for (let line = 0; line < count; line++) {
    const band = line / (count - 1);
    context.strokeStyle = inks[Math.floor(line * inks.length / count)];
    context.beginPath();
    for (let point = 0; point <= 240; point++) {
      const t = point / 240;
      const angle = 2 * Math.PI * t;
      let x;
      let y;
      if (pattern === 'waves') {
        x = (t - 0.5) * 0.87;
        y = (band - 0.5) * 0.61 + 0.10 * Math.sin(angle * 1.8 + phase + band * 5)
          + 0.04 * Math.sin(angle * frequency + band * 3);
      } else {
        const radius = pattern === 'contours'
          ? (0.07 + band * 0.34) * (1 + 0.16 * Math.sin(angle * 3 + phase + band * 2))
          : 0.23 + band * 0.08 + 0.12 * Math.sin(angle * frequency + phase + band * 2.5);
        x = radius * Math.cos(angle) + (pattern === 'contours' ? offsetX * band : 0);
        y = radius * Math.sin(angle) + (pattern === 'contours' ? offsetY * band : 0);
      }
      const px = width / 2 + x * size;
      const py = height / 2 + y * size;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    if (pattern !== 'waves') context.closePath();
    context.stroke();
  }
}
