export const palettes = {
  fern: ['#f4f3e9', '#173e34', '#38745c', '#596418'],
  ink: ['#f4f2ff', '#27244f', '#494295', '#6e3b85'],
  clay: ['#fff3e6', '#53281f', '#8b3e27', '#a65430'],
  red: ['#fff5ec', '#7f1531', '#bd203d', '#e53e53'],
  midnight: ['#111e35', '#b1cef5', '#709bbc', '#d8af75'],
  violet: ['#251934', '#ecbadd', '#a68cee', '#f9d798'],
  ocean: ['#edf9f4', '#136f79', '#234e75', '#438778'],
  monochrome: ['#f7f5ef', '#242822', '#49544b', '#667365'],
};

export function seededRandom(seed) {
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
  const composition = settings.composition || 'balanced';
  const zones = {
    balanced: [0, 0, 1, 1], top: [0, .28, 1, .72], bottom: [0, 0, 1, .72],
    left: [.28, 0, .72, 1], right: [0, 0, .72, 1], center: [0, 0, 1, 1],
  };
  const [x, y, w, h] = zones[composition] || zones.balanced;
  const area = { x: width * x, y: height * y, w: width * w, h: height * h };
  if (['flow', 'interference', 'branches', 'flower'].includes(pattern)) {
    context.clearRect(0, 0, width, height);
    if (!transparent) {
      context.fillStyle = paper;
      context.fillRect(0, 0, width, height);
    }
    const pigment = seededRandom(seed ^ 0x9e3779b9);
    const opts = { ...settings, composition };
    if (pattern === 'flow') drawFlow(context, area, opts, random, pigment, inks);
    if (pattern === 'interference') drawInterference(context, area, opts, random, pigment, inks);
    if (pattern === 'branches') drawBranches(context, area, opts, random, pigment, inks);
    if (pattern === 'flower') drawFlower(context, area, opts, random, inks);
    return;
  }
  const size = Math.min(area.w, area.h);
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
      const px = area.x + area.w / 2 + x * size;
      const py = area.y + area.h / 2 + y * size;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    if (pattern !== 'waves') context.closePath();
    context.stroke();
  }
}

function drawFlow(ctx, area, settings, random, pigment, inks) {
  const { x, y, w, h } = area;
  const { direction = 55, turbulence = 55, trail = 62 } = settings.parameters || {};
  const phi = (direction / 100 - .5) * 2.4;
  const phase = random() * Math.PI * 2;
  const bend = .9 + random() * 1.2;
  const twist = random() * Math.PI;
  const length = .36 + trail * .0054;
  const size = Math.min(w, h);
  const count = 38 + Math.round(settings.density * 2.15);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  ctx.lineWidth = Math.max(.38, size * .0012);
  for (let i = 0; i < count; i++) {
    const v = (i / (count - 1) - .5) * 2;
    const span = length * (.80 + random() * .20);
    const jitter = (random() - .5) * .035;
    ctx.strokeStyle = inks[Math.min(2, Math.floor((i / count + pigment() * .17) * 3))];
    ctx.globalAlpha = .20 + pigment() * .30;
    ctx.beginPath();
    for (let n = 0; n <= 110; n++) {
      const t = n / 110;
      const a = (t - .5) * span;
      const wave = Math.sin(t * Math.PI * bend + phase + v * twist * .43);
      const folding = Math.sin(t * 8 + phase * .8 + v * 3) * turbulence * .0012;
      const b = .16 * wave + folding + (v * (.13 + .09 * Math.sin(Math.PI * t)) + jitter) * (.75 + .25 * Math.cos(t * 5 + v * 2));
      const px = x + w * (.5 + a * cos - b * sin);
      const py = y + h * (.5 + a * sin + b * cos);
      if (n === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawInterference(ctx, area, settings, random, pigment, inks) {
  const { x, y, w, h } = area;
  const { frequency = 54, angle = 46, spacing = 58 } = settings.parameters || {};
  const phase = random() * Math.PI * 2;
  const lean = (random() - .5) * 1.12;
  const overlap = .7 + random() * .55;
  const ripple = .60 + random() * .85;
  const offset = (random() - .5) * .15;
  const size = Math.min(w, h);
  const rows = 10 + Math.round(settings.density * .50);
  ctx.lineWidth = Math.max(.45, size * .0013);
  for (let layer = 0; layer < 2; layer++) {
    const turn = lean + (layer ? (angle + 12) * .014 * overlap : 0);
    for (let row = 0; row < rows; row++) {
      const band = row / (rows - 1) - .5;
      ctx.strokeStyle = inks[layer ? 2 : (row / rows > .7 ? 1 : 0)];
      ctx.globalAlpha = .25 + pigment() * .22;
      ctx.beginPath();
      for (let n = 0; n <= 110; n++) {
        const u = n / 110 - .5;
        const a = u * .72;
        const b = band * (.29 + spacing * .0026) + .11 * Math.sin(u * (4 + frequency * .16) * ripple + phase + band * 4 + layer * 1.35) + (layer ? offset : -offset);
        const px = x + w * .5 + (a * Math.cos(turn) - b * Math.sin(turn)) * size;
        const py = y + h * .5 + (a * Math.sin(turn) + b * Math.cos(turn)) * size;
        if (!n) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawBranches(ctx, area, settings, random, pigment, inks) {
  const { x, y, w, h } = area;
  const { angle = 44, spread = 56, depth = 56 } = settings.parameters || {};
  const size = Math.min(w, h);
  const levels = 4 + Math.round(depth * .055);
  const forks = 2 + Math.floor(settings.density / 25);
  const diverge = .28 + spread * .009;
  ctx.lineCap = 'round';
  function branch(px, py, turn, length, level) {
    const bend = (random() - .5) * .75;
    const dx = Math.cos(turn + bend * .32);
    const dy = Math.sin(turn + bend * .32);
    const roomX = dx >= 0 ? x + w * .935 - px : px - x - w * .065;
    const roomY = dy >= 0 ? y + h * .935 - py : py - y - h * .065;
    length = Math.min(length, roomX / Math.max(.0001, Math.abs(dx)), roomY / Math.max(.0001, Math.abs(dy)));
    if (length < size * .003) return;
    const tx = px + dx * length;
    const ty = py + dy * length;
    ctx.strokeStyle = inks[Math.min(2, Math.floor(level * 2.5 / levels + pigment() * .9))];
    ctx.globalAlpha = .49 + pigment() * .46;
    ctx.lineWidth = Math.max(.45, length * .022);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + Math.cos(turn) * length * .56, py + Math.sin(turn) * length * .56, tx, ty);
    ctx.stroke();
    if (level === levels) return;
    branch(tx, ty, turn + bend * .42, length * (.63 + random() * .13), level + 1);
    if (random() > .13) branch(tx, ty, turn + diverge * (random() < .5 ? -1 : 1), length * (.54 + random() * .17), level + 1);
  }
  for (let i = 0; i < forks; i++) {
    const t = i / (forks - 1) - .5;
    branch(x + w * (.5 + t * .30), y + h * .83, -Math.PI / 2 + (angle - 50) * .013 + t * .9,
      size * (.15 + random() * .09), 1);
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

function drawFlower(ctx, area, settings, random, inks) {
  const size = Math.min(area.w, area.h);
  const lean = (random() - .5) * .15;
  const centerX = area.x + area.w / 2 + lean * size;
  const centerY = area.y + area.h / 2 - .13 * size;
  const stemX = centerX - lean * size * 2;
  const stemEnd = centerY + .48 * size;
  const stem = '#355848';

  ctx.strokeStyle = stem;
  ctx.lineWidth = size * .012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.bezierCurveTo(centerX + .05 * size, centerY + .14 * size, stemX + .07 * size, stemEnd - .12 * size, stemX, stemEnd);
  ctx.stroke();
  for (const side of [-1, 1]) {
    const y = stemEnd - (side === 1 ? .21 : .09) * size;
    const tipX = stemX + side * .26 * size;
    const tipY = y - .15 * size;
    ctx.fillStyle = side === 1 ? '#547863' : '#6f9172';
    ctx.beginPath();
    ctx.moveTo(stemX + .025 * size, y);
    ctx.quadraticCurveTo(tipX - side * .035 * size, y + .035 * size, tipX, tipY);
    ctx.quadraticCurveTo(stemX + side * .06 * size, tipY - .025 * size, stemX + .025 * size, y);
    ctx.fill();
  }

  const count = 6 + Math.floor(random() * 3);
  const offset = random() * Math.PI;
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < count; i++) {
      const angle = offset + (i + layer / 2) * Math.PI * 2 / count;
      const length = (.22 + random() * .046) * size * (layer ? .68 : 1);
      const width = (.34 + random() * .12) * length;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle);
      ctx.fillStyle = inks[layer ? 2 : 1];
      ctx.strokeStyle = inks[0];
      ctx.lineWidth = size * .0024;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-width * 1.7, -length * .58, -width, -length * 1.14, 0, -length);
      ctx.bezierCurveTo(width, -length * 1.1, width * 1.7, -length * .58, 0, 0);
      ctx.fill();
      ctx.stroke();
      for (let vein = -1; vein <= 1; vein++) {
        const spread = width * vein * (.32 + settings.density * .003);
        ctx.globalAlpha = .42;
        ctx.beginPath();
        ctx.moveTo(0, -length * .12);
        ctx.quadraticCurveTo(spread, -length * .48, spread * .85, -length * .83);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.fillStyle = inks[0];
  ctx.beginPath();
  ctx.arc(centerX, centerY, .043 * size, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#ffd381';
  for (let i = 0; i < 17; i++) {
    const angle = i * 2.399963;
    const radius = Math.sqrt(i / 17) * size * .033;
    ctx.beginPath();
    ctx.arc(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle), size * .0032, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}
