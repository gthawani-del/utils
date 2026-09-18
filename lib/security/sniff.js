const decoder = new TextDecoder('utf-8', { fatal: false });

function ascii(bytes, start, end) {
  return decoder.decode(bytes.slice(start, end));
}

export function sniffBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return { kind: 'unknown', mime: 'application/octet-stream' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'jpeg', mime: 'image/jpeg' };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { kind: 'png', mime: 'image/png' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { kind: 'webp', mime: 'image/webp' };
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    const compatible = ascii(bytes, 8, Math.min(bytes.length, 64));
    if (brand === 'avif' || brand === 'avis' || compatible.includes('avif') || compatible.includes('avis')) return { kind: 'avif', mime: 'image/avif' };
  }
  const text = decoder.decode(bytes.slice(0, Math.min(bytes.length, 4096))).replace(/^\uFEFF/, '').trimStart();
  const normalized = text.replace(/^<\?xml[^>]*>\s*/i, '').trimStart();
  if (/^<svg(?:\s|>)/i.test(normalized)) return { kind: 'svg', mime: 'image/svg+xml' };
  return { kind: 'unknown', mime: 'application/octet-stream' };
}

export async function sniffFile(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  return sniffBytes(head);
}
