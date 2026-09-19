const BLOCK = 512;

function cleanPath(value) {
  const safe = String(value || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .replace(/[^a-z0-9 _./-]/gi, '-')
    .slice(0, 100);
  return safe || 'file';
}

function writeAscii(target, offset, length, value) {
  const encoded = new TextEncoder().encode(String(value));
  target.set(encoded.slice(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const number = Math.max(0, Number(value) || 0);
  const body = Math.floor(number).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeAscii(target, offset, length - 1, body);
  target[offset + length - 1] = 0;
}

function headerFor(name, size) {
  const header = new Uint8Array(BLOCK);
  writeAscii(header, 0, 100, cleanPath(name));
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  for (let i = 148; i < 156; i += 1) header[i] = 32;
  header[156] = '0'.charCodeAt(0);
  writeAscii(header, 257, 6, 'ustar');
  header[262] = 0;
  writeAscii(header, 263, 2, '00');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0').slice(-6);
  writeAscii(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 32;
  return header;
}

async function bytesFor(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new TextEncoder().encode(String(value ?? ''));
}

export async function createTar(files) {
  const chunks = [];
  let total = 0;

  for (const file of files || []) {
    const bytes = await bytesFor(file.data);
    const header = headerFor(file.name, bytes.length);
    const padding = (BLOCK - (bytes.length % BLOCK)) % BLOCK;

    chunks.push(header, bytes);
    total += header.length + bytes.length;
    if (padding) {
      const pad = new Uint8Array(padding);
      chunks.push(pad);
      total += pad.length;
    }
  }

  const end = new Uint8Array(BLOCK * 2);
  chunks.push(end);
  total += end.length;

  return new Blob(chunks, { type: 'application/x-tar' });
}

export function tarBlockAligned(size) {
  return Number(size) > 0 && Number(size) % BLOCK === 0;
}
