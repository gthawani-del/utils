import { sanitizeFilename } from '../security/filename.js';
import { trackObjectUrl, revokeObjectUrl } from '../security/workspace.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MEDIA_BUDGET = Object.freeze({
  maxFileBytes: 2 * GB,
  metadataTimeoutMs: 12_000,
  lowMemoryWarningBytes: 300 * MB,
  standardWarningBytes: 750 * MB
});

const ALLOWED_LINK_HOSTS = new Map([
  ['youtube.com', 'YouTube'],
  ['www.youtube.com', 'YouTube'],
  ['m.youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['vimeo.com', 'Vimeo'],
  ['www.vimeo.com', 'Vimeo']
]);

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function hasPrefix(bytes, values) {
  return values.every((value, index) => bytes[index] === value);
}

export function sniffMediaBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return { supported: false, container: 'unknown', mime: 'application/octet-stream', mediaType: 'unknown' };
  }

  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') {
    return { supported: true, container: 'wav', mime: 'audio/wav', mediaType: 'audio' };
  }

  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'AVI ') {
    return { supported: true, container: 'avi', mime: 'video/x-msvideo', mediaType: 'video' };
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'M4A ' || brand === 'M4B ') {
      return { supported: true, container: 'mp4', mime: 'audio/mp4', mediaType: 'audio' };
    }
    if (brand === 'qt  ') {
      return { supported: true, container: 'mov', mime: 'video/quicktime', mediaType: 'video' };
    }
    return { supported: true, container: 'mp4', mime: 'video/mp4', mediaType: 'video' };
  }

  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { supported: true, container: 'webm', mime: 'video/webm', mediaType: 'video' };
  }

  if (ascii(bytes, 0, 4) === 'OggS') {
    return { supported: true, container: 'ogg', mime: 'application/ogg', mediaType: 'audio' };
  }

  if (ascii(bytes, 0, 4) === 'fLaC') {
    return { supported: true, container: 'flac', mime: 'audio/flac', mediaType: 'audio' };
  }

  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') {
    return { supported: true, container: 'mp3', mime: 'audio/mpeg', mediaType: 'audio' };
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    const layer = (bytes[1] >> 1) & 0x03;
    if (layer !== 0) return { supported: true, container: 'mp3', mime: 'audio/mpeg', mediaType: 'audio' };
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return { supported: true, container: 'aac', mime: 'audio/aac', mediaType: 'audio' };
  }

  return { supported: false, container: 'unknown', mime: 'application/octet-stream', mediaType: 'unknown' };
}

export function validateMediaFileBudget(file, budget = MEDIA_BUDGET) {
  if (!file || typeof file.size !== 'number') return { ok: false, reason: 'Invalid file object.' };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: 'Zero-byte or invalid files are not supported.' };
  if (file.size > budget.maxFileBytes) return { ok: false, reason: 'This file exceeds the 2 GB local-ingestion safety budget.' };

  const memory = Number(globalThis.navigator?.deviceMemory || 0);
  const warningLimit = memory && memory <= 4 ? budget.lowMemoryWarningBytes : budget.standardWarningBytes;
  return {
    ok: true,
    warning: file.size > warningLimit
      ? 'Large media file: preview should remain local, but later processing may require proxies or chunked workflows on this device.'
      : ''
  };
}

export async function inspectMediaFile(file) {
  const budget = validateMediaFileBudget(file);
  if (!budget.ok) return { ok: false, code: 'RESOURCE_BUDGET', reason: budget.reason };

  let head;
  try {
    head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  } catch {
    return { ok: false, code: 'READ_FAILED', reason: 'The browser could not inspect this file safely.' };
  }

  const signature = sniffMediaBytes(head);
  if (!signature.supported) {
    return { ok: false, code: 'UNSUPPORTED_SIGNATURE', reason: 'Unsupported or unrecognized media signature. The filename and browser MIME type were not trusted.' };
  }

  const declaredMime = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const mismatch = declaredMime && !declaredMime.startsWith(signature.mediaType + '/') && declaredMime !== signature.mime;

  return {
    ok: true,
    file,
    safeName: sanitizeFilename(file.name || 'media'),
    size: file.size,
    signature,
    declaredMime,
    warning: budget.warning || (mismatch ? 'The browser-declared MIME type differs from the detected media signature.' : '')
  };
}

function waitForMetadata(element, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
      fn(value);
    };
    const onLoaded = () => finish(resolve);
    const onError = () => finish(reject, new Error('Browser could not read media metadata.'));
    const timer = setTimeout(() => finish(reject, new Error('Media metadata inspection timed out.')), timeoutMs);
    element.addEventListener('loadedmetadata', onLoaded, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

export async function ingestLocalMedia(file, { timeoutMs = MEDIA_BUDGET.metadataTimeoutMs } = {}) {
  const inspected = await inspectMediaFile(file);
  if (!inspected.ok) return inspected;

  const objectUrl = trackObjectUrl(file);
  const element = document.createElement(inspected.signature.mediaType === 'audio' ? 'audio' : 'video');
  element.preload = 'metadata';
  element.src = objectUrl;

  try {
    await waitForMetadata(element, timeoutMs);
    const width = Number(element.videoWidth || 0);
    const height = Number(element.videoHeight || 0);
    const duration = Number(element.duration);
    const mediaType = width > 0 && height > 0 ? 'video' : 'audio';

    return {
      ok: true,
      source: {
        kind: 'local-file',
        file,
        objectUrl,
        name: inspected.safeName,
        bytes: inspected.size,
        container: inspected.signature.container,
        detectedMime: inspected.signature.mime,
        declaredMime: inspected.declaredMime,
        mediaType,
        duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
        width: mediaType === 'video' ? width : null,
        height: mediaType === 'video' ? height : null,
        warning: inspected.warning
      }
    };
  } catch (error) {
    revokeObjectUrl(objectUrl);
    return {
      ok: false,
      code: 'UNSUPPORTED_CODEC',
      reason: error instanceof Error ? error.message : 'Browser could not read this media file.'
    };
  } finally {
    element.removeAttribute('src');
    element.load();
  }
}

export function releaseMediaSource(source) {
  if (source?.objectUrl) revokeObjectUrl(source.objectUrl);
}

export function validateMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'Paste a supported media URL.' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'Only HTTPS media links are accepted.' };
  if (url.username || url.password) return { ok: false, reason: 'URLs containing credentials are not accepted.' };
  if (url.port) return { ok: false, reason: 'Custom URL ports are not accepted.' };

  const host = url.hostname.toLowerCase();
  const provider = ALLOWED_LINK_HOSTS.get(host);
  if (!provider) return { ok: false, reason: 'Phase 2 link input is restricted to YouTube and Vimeo.' };

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }

  if (provider === 'YouTube') {
    const isShort = host === 'youtu.be';
    const videoId = isShort ? url.pathname.split('/').filter(Boolean)[0] : url.searchParams.get('v');
    if (!videoId) return { ok: false, reason: 'A YouTube video URL with a video ID is required.' };
  }

  if (provider === 'Vimeo' && !/\/\d+/.test(url.pathname)) {
    return { ok: false, reason: 'A Vimeo video URL with a numeric video ID is required.' };
  }

  return { ok: true, provider, url: url.toString() };
}
