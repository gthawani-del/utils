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

export function parseColorProfileSummary(kind, bytes) {
  const result = { hasProfile:false, profileName:'', wideGamut:false };
  if (!(bytes instanceof Uint8Array)) return result;
  if (kind === 'png') scanPngColor(bytes,result);
  else if (kind === 'jpeg') scanJpegColor(bytes,result);
  else if (kind === 'webp') scanWebpColor(bytes,result);
  else if (kind === 'avif') scanAvifColor(bytes,result);
  return result;
}

function scanPngColor(bytes,result){
  let o=8;
  while(o+12<=bytes.length){
    const length=((bytes[o]<<24)>>>0)+(bytes[o+1]<<16)+(bytes[o+2]<<8)+bytes[o+3];
    if(length>16*1024*1024||o+12+length>bytes.length)break;
    const type=ascii4(bytes,o+4);
    const dataStart=o+8;
    if(type==='sRGB'){result.hasProfile=true;result.profileName='sRGB';return;}
    if(type==='iCCP'){
      result.hasProfile=true;
      let end=dataStart; const limit=Math.min(dataStart+80,dataStart+length);
      while(end<limit&&bytes[end]!==0)end++;
      result.profileName=cleanAscii(bytes.slice(dataStart,end))||recognizedProfile(bytes.slice(dataStart,dataStart+length));
      applyWideGamut(result);
      return;
    }
    o+=12+length;
  }
}
function scanJpegColor(bytes,result){
  let i=2;
  while(i+4<bytes.length){
    if(bytes[i]!==0xff){i++;continue;}
    const marker=bytes[i+1]; if(marker===0xd8||marker===0xd9){i+=2;continue;}
    const len=(bytes[i+2]<<8)|bytes[i+3]; if(len<2||i+2+len>bytes.length)break;
    if(marker===0xe2){
      const start=i+4,end=i+2+len;
      const head=cleanAscii(bytes.slice(start,Math.min(start+12,end)));
      if(head.startsWith('ICC_PROFILE')){
        result.hasProfile=true;
        result.profileName=recognizedProfile(bytes.slice(start,end));
        applyWideGamut(result); return;
      }
    }
    i+=2+len;
  }
}
function scanWebpColor(bytes,result){
  let o=12;
  while(o+8<=bytes.length){
    const type=ascii4(bytes,o);
    const size=bytes[o+4]|(bytes[o+5]<<8)|(bytes[o+6]<<16)|(bytes[o+7]<<24);
    if(size<0||size>16*1024*1024||o+8+size>bytes.length)break;
    if(type==='ICCP'){
      result.hasProfile=true;
      result.profileName=recognizedProfile(bytes.slice(o+8,o+8+size));
      applyWideGamut(result); return;
    }
    o+=8+size+(size%2);
  }
}
function scanAvifColor(bytes,result){
  const limit=Math.min(bytes.length,2*1024*1024);
  for(let i=0;i+11<limit;i++){
    if(ascii4(bytes,i)==='nclx'){
      const primaries=(bytes[i+4]<<8)|bytes[i+5];
      result.hasProfile=true;
      if(primaries===12) result.profileName='Display P3';
      else if(primaries===9) result.profileName='BT.2020';
      else if(primaries===1) result.profileName='BT.709 / sRGB-like';
      applyWideGamut(result); return;
    }
  }
}
function recognizedProfile(bytes){
  const text=cleanAscii(bytes.slice(0,Math.min(bytes.length,8192))).toLowerCase();
  if(text.includes('display p3')||text.includes('displayp3'))return 'Display P3';
  if(text.includes('adobe rgb')||text.includes('adobergb'))return 'Adobe RGB';
  if(text.includes('prophoto'))return 'ProPhoto RGB';
  if(text.includes('bt.2020')||text.includes('rec.2020')||text.includes('rec2020'))return 'BT.2020';
  if(text.includes('srgb'))return 'sRGB';
  return '';
}
function applyWideGamut(result){ result.wideGamut=/display p3|adobe rgb|prophoto|2020/i.test(result.profileName||''); }
function ascii4(bytes,o){ if(o<0||o+4>bytes.length)return ''; return String.fromCharCode(bytes[o],bytes[o+1],bytes[o+2],bytes[o+3]); }
function cleanAscii(bytes){ return Array.from(bytes,(b)=>b>=32&&b<=126?String.fromCharCode(b):' ').join('').replace(/\s+/g,' ').trim(); }
