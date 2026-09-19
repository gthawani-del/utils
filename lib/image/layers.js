const TYPES = new Set(['text','rectangle','circle','line','arrow','background']);
export const SAFE_FONTS = Object.freeze(['system-ui','sans-serif','serif','monospace']);

export function createLayer(type, id = '') {
  const safeType = TYPES.has(type) ? type : 'rectangle';
  const base = { id: String(id), type: safeType, name: labelFor(safeType), x: 50, y: 50, width: safeType === 'background' ? 100 : 50, height: safeType === 'background' ? 100 : 20, rotation: 0, opacity: 1 };
  if (safeType === 'text') return { ...base, text: 'Your text', fontFamily: 'system-ui', fontSize: 64, fontWeight: 700, color: '#ffffff', align: 'center', letterSpacing: 0, lineSpacing: 1.2, strokeWidth: 0, strokeColor: '#000000', shadowEnabled: false, shadowColor: '#000000', shadowBlur: 12, shadowX: 4, shadowY: 4, backgroundEnabled: false, backgroundColor: '#000000' };
  if (safeType === 'line' || safeType === 'arrow') return { ...base, width: 50, height: 0, fill: '#111827', fill2: '#7c3aed', gradient: false, gradientAngle: 0, strokeColor: '#ffffff', strokeWidth: 8 };
  return { ...base, fill: safeType === 'background' ? '#111827' : '#111827', fill2: '#7c3aed', gradient: false, gradientAngle: 0, strokeColor: '#ffffff', strokeWidth: 0 };
}

export function normalizeLayers(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map(normalizeLayer);
}

export function normalizeLayer(input = {}) {
  const type = TYPES.has(input.type) ? input.type : 'rectangle';
  const base = createLayer(type, String(input.id || ''));
  const layer = { ...base, ...input, type, id: String(input.id || base.id).slice(0, 80), name: String(input.name || base.name).slice(0, 80) };
  layer.x = clampNum(layer.x, -50, 150, base.x); layer.y = clampNum(layer.y, -50, 150, base.y);
  layer.width = clampNum(layer.width, 1, 200, base.width || 50); layer.height = clampNum(layer.height, 0, 200, base.height || 20);
  layer.rotation = clampNum(layer.rotation, -180, 180, 0); layer.opacity = clampNum(layer.opacity, 0, 1, 1);
  if (type === 'text') {
    layer.text = String(layer.text ?? '').slice(0, 500);
    layer.fontFamily = SAFE_FONTS.includes(layer.fontFamily) ? layer.fontFamily : 'system-ui';
    layer.fontSize = clampNum(layer.fontSize, 6, 600, 64); layer.fontWeight = [400,600,700,800].includes(Number(layer.fontWeight)) ? Number(layer.fontWeight) : 700;
    layer.color = safeColor(layer.color, '#ffffff'); layer.align = ['left','center','right'].includes(layer.align) ? layer.align : 'center';
    layer.letterSpacing = clampNum(layer.letterSpacing, -10, 50, 0); layer.lineSpacing = clampNum(layer.lineSpacing, .7, 3, 1.2);
    layer.strokeWidth = clampNum(layer.strokeWidth, 0, 30, 0); layer.strokeColor = safeColor(layer.strokeColor, '#000000');
    layer.shadowEnabled = Boolean(layer.shadowEnabled); layer.shadowColor = safeColor(layer.shadowColor, '#000000'); layer.shadowBlur = clampNum(layer.shadowBlur, 0, 100, 12); layer.shadowX = clampNum(layer.shadowX, -100, 100, 4); layer.shadowY = clampNum(layer.shadowY, -100, 100, 4);
    layer.backgroundEnabled = Boolean(layer.backgroundEnabled); layer.backgroundColor = safeColor(layer.backgroundColor, '#000000');
  } else {
    layer.fill = safeColor(layer.fill, '#111827'); layer.fill2 = safeColor(layer.fill2, '#7c3aed'); layer.gradient = Boolean(layer.gradient); layer.gradientAngle = clampNum(layer.gradientAngle, -180, 180, 0);
    layer.strokeColor = safeColor(layer.strokeColor, '#ffffff'); layer.strokeWidth = clampNum(layer.strokeWidth, 0, 40, type === 'line' || type === 'arrow' ? 8 : 0);
  }
  return layer;
}

function safeColor(value, fallback) { const text = String(value || ''); return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback; }
function clampNum(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function labelFor(type) { return ({ text: 'Text', rectangle: 'Rectangle', circle: 'Circle', line: 'Line', arrow: 'Arrow', background: 'Background' })[type] || 'Layer'; }
