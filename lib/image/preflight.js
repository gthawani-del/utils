function be32(v, o) { return v.getUint32(o, false); }
function le32(v, o) { return v.getUint32(o, true); }

export function parsePngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: be32(v, 16), height: be32(v, 20) };
}

export function parseJpegDimensions(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    if (i + 4 > bytes.length) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    i += 2 + length;
  }
  return null;
}

export function parseWebpDimensions(bytes) {
  if (bytes.length < 30) return null;
  const type = String.fromCharCode(...bytes.slice(12, 16));
  if (type === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return { width, height };
  }
  if (type === 'VP8 ' && bytes.length >= 30) {
    const start = 20;
    if (bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      const width = (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3fff;
      const height = (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3fff;
      return { width, height };
    }
  }
  return null;
}

export function parseAvifDimensions(bytes) {
  const limit = Math.min(bytes.length, 1024 * 1024);
  for (let i = 0; i + 12 <= limit; i++) {
    if (bytes[i] === 0x69 && bytes[i+1] === 0x73 && bytes[i+2] === 0x70 && bytes[i+3] === 0x65) {
      const start = i + 8;
      if (start + 8 <= limit) {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = v.getUint32(start, false);
        const height = v.getUint32(start + 4, false);
        if (width > 0 && height > 0) return { width, height };
      }
    }
  }
  return null;
}

export function parseSvgDimensions(text) {
  const open = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = numberAttr(open, 'width');
  const height = numberAttr(open, 'height');
  if (width && height) return { width, height };
  const viewBox = open.match(/\bviewBox\s*=\s*["']\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*["']/i);
  if (viewBox) return { width: Math.round(Number(viewBox[3])), height: Math.round(Number(viewBox[4])) };
  return null;
}

function numberAttr(open, name) {
  const match = open.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i'));
  const value = match ? Number(match[1]) : 0;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function parseExifSummary(bytes) {
  const result = { orientation: 1, hasExif: false, hasGps: false, make: '', model: '', dateTimeOriginal: '' };
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return result;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) break;
    if (marker === 0xe1 && len >= 10) {
      const start = i + 4;
      if (String.fromCharCode(...bytes.slice(start, start + 6)) === 'Exif\0\0') {
        result.hasExif = true;
        try { parseTiff(bytes, start + 6, result); } catch { /* bounded parser: ignore malformed EXIF */ }
        break;
      }
    }
    i += 2 + len;
  }
  return result;
}

function parseTiff(bytes, tiff, result) {
  if (tiff + 8 > bytes.length) return;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => v.getUint16(o, little);
  const u32 = (o) => v.getUint32(o, little);
  if (u16(tiff + 2) !== 42) return;
  const ifd0 = tiff + u32(tiff + 4);
  const pointers = parseIfd(bytes, v, tiff, ifd0, little, result, true);
  if (pointers.exif) parseIfd(bytes, v, tiff, tiff + pointers.exif, little, result, false);
  if (pointers.gps) result.hasGps = true;
}

function parseIfd(bytes, v, tiff, offset, little, result, root) {
  const pointers = { exif: 0, gps: 0 };
  if (offset < tiff || offset + 2 > bytes.length) return pointers;
  const count = Math.min(v.getUint16(offset, little), 256);
  for (let n = 0; n < count; n++) {
    const e = offset + 2 + n * 12;
    if (e + 12 > bytes.length) break;
    const tag = v.getUint16(e, little);
    const type = v.getUint16(e + 2, little);
    const countValue = v.getUint32(e + 4, little);
    const valueOffset = e + 8;
    if (tag === 0x0112 && type === 3) result.orientation = v.getUint16(valueOffset, little) || 1;
    if (root && tag === 0x8769) pointers.exif = v.getUint32(valueOffset, little);
    if (root && tag === 0x8825) pointers.gps = v.getUint32(valueOffset, little);
    if (tag === 0x010f) result.make = readAscii(bytes, v, tiff, valueOffset, type, countValue, little);
    if (tag === 0x0110) result.model = readAscii(bytes, v, tiff, valueOffset, type, countValue, little);
    if (tag === 0x9003) result.dateTimeOriginal = readAscii(bytes, v, tiff, valueOffset, type, countValue, little);
  }
  return pointers;
}

function readAscii(bytes, v, tiff, valueOffset, type, count, little) {
  if (type !== 2 || count <= 0 || count > 512) return '';
  const start = count <= 4 ? valueOffset : tiff + v.getUint32(valueOffset, little);
  if (start < 0 || start + count > bytes.length) return '';
  return new TextDecoder().decode(bytes.slice(start, start + count)).replace(/\0/g, '').trim();
}

export function preflightDimensions(kind, bytes, svgText = '') {
  if (kind === 'jpeg') return parseJpegDimensions(bytes);
  if (kind === 'png') return parsePngDimensions(bytes);
  if (kind === 'webp') return parseWebpDimensions(bytes);
  if (kind === 'avif') return parseAvifDimensions(bytes);
  if (kind === 'svg') return parseSvgDimensions(svgText);
  return null;
}
