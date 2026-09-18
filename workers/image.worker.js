import { SECURITY_BUDGET, validateDimensions } from '../lib/security/budget.js';
import { sniffBytes } from '../lib/security/sniff.js';
import { sanitizeSvgText } from '../lib/security/svg.js';
import { ok, fail, unsupported } from '../lib/security/result.js';
import { preflightDimensions, parseExifSummary } from '../lib/image/preflight.js';
import { calculateResize, calculateCrop, coverRect } from '../lib/image/math.js';

try { Object.defineProperty(self, 'fetch', { value: () => Promise.reject(new Error('Network disabled in Utility OS workers.')), writable: false }); } catch {}

self.onmessage = async (event) => {
  const { op } = event.data || {};
  try {
    if (op === 'inspect') return send(await inspect(event.data));
    if (op === 'process') return send(await processImage(event.data));
    if (op === 'zip') return send(await createZip(event.data));
    return send(unsupported('Unsupported worker operation.'));
  } catch {
    return send(fail('The file could not be processed safely.'));
  }
};

function send(result) {
  const transfers = [];
  if (result?.value?.buffer instanceof ArrayBuffer) transfers.push(result.value.buffer);
  self.postMessage(result, transfers);
}

async function inspect({ buffer }) {
  const bytes = new Uint8Array(buffer);
  const kind = sniffBytes(bytes).kind;
  if (!['jpeg', 'png', 'webp', 'avif', 'svg'].includes(kind)) return unsupported('File signature is not a supported image format.', 'BAD_SIGNATURE');
  let svgText = '';
  if (kind === 'svg') {
    if (bytes.byteLength > SECURITY_BUDGET.maxSvgBytes) return unsupported('SVG exceeds the safe size limit.');
    svgText = new TextDecoder().decode(bytes);
    sanitizeSvgText(svgText);
  }
  const rawDimensions = preflightDimensions(kind, bytes, svgText);
  if (!rawDimensions) return unsupported('Image dimensions could not be safely verified before decoding.');
  const dimensionCheck = validateDimensions(rawDimensions.width, rawDimensions.height);
  if (!dimensionCheck.ok) return unsupported(dimensionCheck.reason, 'RESOURCE_LIMIT');
  const exif = kind === 'jpeg' ? parseExifSummary(bytes) : { orientation: 1, hasExif: false, hasGps: false, make: '', model: '', dateTimeOriginal: '' };
  const swapped = kind === 'jpeg' && [5, 6, 7, 8].includes(exif.orientation);
  const dimensions = swapped ? { width: rawDimensions.height, height: rawDimensions.width } : rawDimensions;
  return ok({ kind, mime: mimeFor(kind), dimensions, exif });
}

async function processImage({ buffer, settings = {} }) {
  const bytes = new Uint8Array(buffer);
  const inspected = await inspect({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  if (inspected.state !== 'completed') return inspected;
  const { kind, dimensions, exif } = inspected.value;

  let blob;
  if (kind === 'svg') {
    const safe = sanitizeSvgText(new TextDecoder().decode(bytes));
    blob = new Blob([safe], { type: 'image/svg+xml' });
  } else {
    blob = new Blob([bytes], { type: mimeFor(kind) });
  }

  let bitmap;
  let applyExif = kind === 'jpeg';
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'none', colorSpaceConversion: 'default', premultiplyAlpha: 'default' });
  } catch {
    bitmap = await createImageBitmap(blob);
    applyExif = false;
  }

  const preDecoded = validateDimensions(bitmap.width, bitmap.height);
  if (!preDecoded.ok) { bitmap.close(); return unsupported(preDecoded.reason, 'RESOURCE_LIMIT'); }

  const orientation = applyExif ? exif.orientation : 1;
  const source = orientation === 1 ? bitmap : drawOriented(bitmap, orientation);
  if (orientation !== 1) bitmap.close();
  const sourceCheck = validateDimensions(source.width, source.height);
  if (!sourceCheck.ok) { if ('close' in source) source.close(); return unsupported(sourceCheck.reason, 'RESOURCE_LIMIT'); }

  const crop = calculateCrop(source.width, source.height, settings.crop);
  const mode = settings.resizeMode || 'fit';
  let target;
  if (mode === 'fill' || mode === 'contain') {
    target = { width: positiveInt(settings.width, crop.width), height: positiveInt(settings.height, crop.height) };
  } else {
    target = calculateResize(crop.width, crop.height, settings);
  }
  const targetCheck = validateDimensions(target.width, target.height);
  if (!targetCheck.ok) return unsupported(targetCheck.reason, 'RESOURCE_LIMIT');

  let canvas = render(source, crop, target, settings);
  if ('close' in source) source.close(); else { source.width = 1; source.height = 1; }
  canvas = transformCanvas(canvas, Number(settings.rotate) || 0, Boolean(settings.flipX), Boolean(settings.flipY));
  const finalCheck = validateDimensions(canvas.width, canvas.height);
  if (!finalCheck.ok) return unsupported(finalCheck.reason, 'RESOURCE_LIMIT');

  const outputKind = settings.format || kind;
  if (!['jpeg', 'png', 'webp', 'avif'].includes(outputKind)) return unsupported('That output format is not available.');
  const mime = mimeFor(outputKind);
  const targetBytes = Math.max(0, Number(settings.targetBytes) || 0);
  let encoded;
  let usedQuality = normalizeQuality(settings.quality);
  if (targetBytes > 0) {
    if (outputKind === 'png') return unsupported('Target-size compression is not reliable for PNG. Choose JPEG, WebP, or AVIF.');
    ({ blob: encoded, quality: usedQuality } = await encodeToTarget(canvas, mime, targetBytes));
  } else {
    encoded = await encode(canvas, mime, usedQuality);
  }
  if (encoded.type !== mime) return unsupported(`${outputKind.toUpperCase()} encoding is not supported by this browser.`, 'ENCODER_UNAVAILABLE');
  if (encoded.size > SECURITY_BUDGET.maxOutputBytes) return unsupported('Output exceeds the safe output-size limit.', 'RESOURCE_LIMIT');

  const outputBuffer = await encoded.arrayBuffer();
  return ok({
    buffer: outputBuffer,
    mime,
    kind: outputKind,
    width: canvas.width,
    height: canvas.height,
    size: outputBuffer.byteLength,
    quality: usedQuality,
    metadataStripped: true
  });
}

function drawOriented(bitmap, orientation) {
  const swap = [5,6,7,8].includes(orientation);
  const canvas = new OffscreenCanvas(swap ? bitmap.height : bitmap.width, swap ? bitmap.width : bitmap.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
    case 5: ctx.rotate(Math.PI / 2); ctx.scale(1, -1); break;
    case 6: ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); break;
    case 7: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
    case 8: ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); break;
    default: break;
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return canvas;
}

function render(source, crop, target, settings) {
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const mode = settings.resizeMode || 'fit';
  const outputKind = settings.format || 'png';
  if (outputKind === 'jpeg' || settings.background) {
    ctx.fillStyle = settings.background || '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
  }
  if (mode === 'fill') {
    const cover = coverRect(crop.width, crop.height, target.width, target.height);
    ctx.drawImage(source, crop.x + cover.x, crop.y + cover.y, cover.width, cover.height, 0, 0, target.width, target.height);
  } else if (mode === 'contain') {
    const scale = Math.min(target.width / crop.width, target.height / crop.height);
    const w = Math.max(1, Math.round(crop.width * scale));
    const h = Math.max(1, Math.round(crop.height * scale));
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, Math.round((target.width - w) / 2), Math.round((target.height - h) / 2), w, h);
  } else {
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
  }
  return canvas;
}

function transformCanvas(source, rotate, flipX, flipY) {
  const normalized = ((rotate % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(normalized)) rotate = 0; else rotate = normalized;
  if (rotate === 0 && !flipX && !flipY) return source;
  const swap = rotate === 90 || rotate === 270;
  const canvas = new OffscreenCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rotate * Math.PI / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function encode(canvas, mime, quality) {
  try {
    return await canvas.convertToBlob({ type: mime, quality });
  } catch {
    return new Blob([], { type: 'application/octet-stream' });
  }
}

async function encodeToTarget(canvas, mime, targetBytes) {
  let low = 0.05, high = 0.98, best = null, bestQuality = low;
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2;
    const blob = await encode(canvas, mime, quality);
    if (blob.type !== mime) return { blob, quality };
    if (!best || Math.abs(blob.size - targetBytes) < Math.abs(best.size - targetBytes)) { best = blob; bestQuality = quality; }
    if (blob.size > targetBytes) high = quality; else low = quality;
  }
  return { blob: best, quality: bestQuality };
}

async function createZip({ files = [] }) {
  if (!Array.isArray(files) || files.length === 0) return unsupported('No files to archive.');
  if (files.length > SECURITY_BUDGET.maxBatchFiles) return unsupported('Too many files for one archive.');
  const entries = files.map((file) => ({ name: String(file.name || 'output.bin'), data: new Uint8Array(file.buffer) }));
  let estimated = entries.reduce((n, e) => n + e.data.byteLength + e.name.length + 120, 0);
  if (estimated > SECURITY_BUDGET.maxOutputBytes * 4) return unsupported('Archive exceeds the safe output budget.');
  const zip = zipStore(entries);
  return ok({ buffer: zip.buffer, mime: 'application/zip', kind: 'zip', size: zip.byteLength });
}

function zipStore(entries) {
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true); lv.setUint32(14, crc, true); lv.setUint32(18, entry.data.length, true); lv.setUint32(22, entry.data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30); local.set(entry.data, 30 + name.length); localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46); centralParts.push(central);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, centralOffset, true); ev.setUint16(20, 0, true);
  const total = localParts.reduce((n,p)=>n+p.length,0) + centralSize + end.length;
  const out = new Uint8Array(total); let cursor = 0;
  for (const p of localParts) { out.set(p, cursor); cursor += p.length; }
  for (const p of centralParts) { out.set(p, cursor); cursor += p.length; }
  out.set(end, cursor); return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mimeFor(kind) { return ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' })[kind] || 'application/octet-stream'; }
function normalizeQuality(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0.05, Math.min(1, n)) : 0.82; }
function positiveInt(value, fallback) { const n = Math.round(Number(value)); return Number.isFinite(n) && n > 0 ? n : fallback; }
