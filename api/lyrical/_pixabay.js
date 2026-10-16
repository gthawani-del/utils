// Server-only module. Never include this file in the static application output.
import { createHash } from 'node:crypto';

const API_URL = 'https://pixabay.com/api/';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const PAGE_SIZE = 20;
const MAX_PENDING = 24;

export class PixabayError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function invalid(message) { throw new PixabayError(400, 'INVALID_REQUEST', message); }

function parameters(url, allowed) {
  let params;
  try { params = new URL(url || '/', 'https://utility.invalid').searchParams; }
  catch { invalid('Check the search parameters and try again.'); }
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid('Unsupported or repeated search parameter.');
  }
  return params;
}

export function parsePhotoSearch(url) {
  const params = parameters(url, ['q', 'orientation', 'page']);
  const q = (params.get('q') || '').trim().replace(/\s+/gu, ' ');
  if (!q || [...q].length > 100 || /[\u0000-\u001f\u007f]/u.test(params.get('q') || '')) invalid('Enter a search containing 1–100 characters.');
  const orientation = params.get('orientation') || 'all';
  if (!['vertical', 'horizontal', 'all'].includes(orientation)) invalid('Choose vertical, horizontal, or all orientations.');
  const page = params.get('page') || '1';
  if (!/^[1-9]\d?$/.test(page) || Number(page) > 25) invalid('Choose a results page from 1 to 25.');
  return { q, orientation, page: Number(page) };
}

export function parseImageId(url) {
  const id = parameters(url, ['id']).get('id') || '';
  if (!/^[1-9]\d{0,9}$/.test(id)) invalid('Choose a valid Pixabay image.');
  return Number(id);
}

export function safePixabayImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if ([...url.searchParams.keys()].some(key => /^(key|api_?key|token)$/i.test(key))) return null;
    const path = url.pathname;
    if (/%|\\/.test(path) || !/\.(?:jpe?g|png|webp)$/i.test(path)) return null;
    const allowed = (url.hostname === 'cdn.pixabay.com' && /^\/photo\/[\w/.-]+$/.test(path)) ||
      (url.hostname === 'pixabay.com' && /^\/get\/[\w.-]+$/.test(path));
    return allowed ? url.href : null;
  } catch { return null; }
}

export function safePixabaySourceUrl(value, id) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pixabay.com' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!new RegExp(`^/(?:[a-z]{2}/)?(?:photos/)?[a-zA-Z0-9_-]+-${id}/?$`).test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function positiveInteger(value, max = 100000) {
  return Number.isInteger(value) && value > 0 && value <= max ? value : null;
}

function selectedAsset(hit) {
  const original = safePixabayImageUrl(hit.imageURL);
  if (original && (!Number.isFinite(hit.imageSize) || hit.imageSize <= MAX_IMAGE_BYTES)) {
    return { url: original, fullResolution: true, maxDimension: null };
  }
  const fullHD = safePixabayImageUrl(hit.fullHDURL);
  if (fullHD) return { url: fullHD, fullResolution: false, maxDimension: 1920 };
  const large = safePixabayImageUrl(hit.largeImageURL);
  return large ? { url: large, fullResolution: false, maxDimension: 1280 } : null;
}

export function normalizePhoto(hit) {
  if (!hit || hit.type !== 'photo' || !positiveInteger(hit.id, 9999999999)) return null;
  const sourceUrl = safePixabaySourceUrl(hit.pageURL, hit.id);
  const webPreview = safePixabayImageUrl(hit.webformatURL);
  const previewUrl = webPreview || safePixabayImageUrl(hit.previewURL);
  const asset = selectedAsset(hit);
  if (!sourceUrl || !previewUrl || !asset) return null;
  const originalWidth = positiveInteger(hit.imageWidth);
  const originalHeight = positiveInteger(hit.imageHeight);
  return {
    id: hit.id,
    width: asset.fullResolution ? originalWidth : null,
    height: asset.fullResolution ? originalHeight : null,
    originalWidth,
    originalHeight,
    maxDimension: asset.maxDimension,
    previewWidth: positiveInteger(webPreview ? hit.webformatWidth : hit.previewWidth),
    previewHeight: positiveInteger(webPreview ? hit.webformatHeight : hit.previewHeight),
    previewUrl,
    sourceUrl,
    author: typeof hit.user === 'string' ? hit.user.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100) : 'Pixabay contributor',
    fullResolution: asset.fullResolution,
  };
}

class BoundedCache {
  constructor(maxEntries, maxBytes = Infinity, now = Date.now) {
    this.entries = new Map(); this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.bytes = 0; this.now = now;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  set(key, value, bytes = 1) {
    if (bytes > this.maxBytes) return;
    this.delete(key);
    this.entries.set(key, { value, bytes, expires: this.now() + DAY_MS }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
  }
}

async function readLimited(response, limit, signal) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw new PixabayError(413, 'ASSET_TOO_LARGE', 'This image is too large. Choose another image or upload a smaller copy.');
  }
  if (!response.body) throw new PixabayError(502, 'EMPTY_PROVIDER_RESPONSE', 'The image provider returned an empty response. Try again.');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new PixabayError(413, 'ASSET_TOO_LARGE', 'This image is too large. Choose another image or upload a smaller copy.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

function providerError(response) {
  if (response.status === 429) {
    const supplied = Number(response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after'));
    return new PixabayError(429, 'PHOTO_SEARCH_BUSY', 'Photo search is busy. Please try again shortly.', Number.isFinite(supplied) && supplied > 0 ? Math.min(300, Math.ceil(supplied)) : 60);
  }
  if ([401, 403].includes(response.status)) return new PixabayError(502, 'PHOTO_PROVIDER_UNAVAILABLE', 'The photo provider is unavailable. You can still upload your own images.');
  if (response.status === 404) return new PixabayError(404, 'PHOTO_NOT_FOUND', 'This image is no longer available. Choose another image.');
  return new PixabayError(502, 'PHOTO_PROVIDER_UNAVAILABLE', 'The photo provider could not complete this request. Please try again.');
}

function rasterType(bytes) {
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 20 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new PixabayError(502, 'INVALID_IMAGE', 'The provider returned an unsupported image. Choose another image.');
}

export function createPixabayService({ fetchImpl = globalThis.fetch, getKey = () => process.env.PIXABAY_API_KEY, now = Date.now, timeoutMs = 15000 } = {}) {
  const searches = new BoundedCache(100, Infinity, now);
  const hits = new BoundedCache(500, Infinity, now);
  const images = new BoundedCache(16, 48 * 1024 * 1024, now);
  const pending = new Map();

  function credentials() {
    const key = getKey()?.trim();
    if (!key) throw new PixabayError(503, 'PHOTO_SEARCH_NOT_CONFIGURED', 'Free photo search is not available yet. You can upload your own images.');
    return { key, scope: createHash('sha256').update(key).digest('hex').slice(0, 16) };
  }

  function coalesce(key, run) {
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= MAX_PENDING) throw new PixabayError(429, 'PHOTO_SEARCH_BUSY', 'Photo search is busy. Please try again shortly.', 5);
    const promise = Promise.resolve().then(run).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  async function fetchApi(key, params) {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({ key, image_type: 'photo', safesearch: 'true', ...params });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) { await response.body?.cancel(); throw providerError(response); }
      const bytes = await readLimited(response, MAX_JSON_BYTES, controller.signal);
      let result;
      try { result = JSON.parse(bytes.toString('utf8')); } catch { throw new PixabayError(502, 'INVALID_PROVIDER_RESPONSE', 'The photo provider returned an invalid response. Try again.'); }
      if (!result || !Array.isArray(result.hits)) throw new PixabayError(502, 'INVALID_PROVIDER_RESPONSE', 'The photo provider returned an invalid response. Try again.');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new PixabayError(504, 'PHOTO_PROVIDER_TIMEOUT', 'Photo search took too long. Please try again.');
      if (error instanceof PixabayError && error.status === 413) throw new PixabayError(502, 'INVALID_PROVIDER_RESPONSE', 'The photo provider returned an unexpectedly large response. Try another search.');
      if (error instanceof PixabayError) throw error;
      throw new PixabayError(502, 'PHOTO_PROVIDER_UNAVAILABLE', 'The photo provider could not be reached. Please try again.');
    } finally { clearTimeout(timer); }
  }

  async function search(params) {
    const { key, scope } = credentials();
    const cacheKey = `${scope}:search:${JSON.stringify(params)}`;
    const cached = searches.get(cacheKey);
    if (cached) return cached;
    return coalesce(cacheKey, async () => {
      const result = await fetchApi(key, { ...params, per_page: String(PAGE_SIZE), page: String(params.page) });
      const photos = [];
      for (const hit of result.hits.slice(0, PAGE_SIZE)) {
        const photo = normalizePhoto(hit);
        if (photo) { photos.push(photo); hits.set(`${scope}:${hit.id}`, hit); }
      }
      const accessible = Number.isFinite(result.totalHits) ? result.totalHits : photos.length;
      const payload = { photos, total: Math.min(500, Math.max(0, Math.floor(accessible))), page: params.page };
      searches.set(cacheKey, payload);
      return payload;
    });
  }

  async function download(id) {
    const { key, scope } = credentials();
    const cacheKey = `${scope}:image:${id}`;
    const cached = images.get(cacheKey);
    if (cached) return cached;
    return coalesce(cacheKey, async () => {
      let hit = hits.get(`${scope}:${id}`);
      if (!hit) {
        const result = await fetchApi(key, { id: String(id) });
        hit = result.hits.find(item => item.id === id && normalizePhoto(item));
        if (!hit) throw new PixabayError(404, 'PHOTO_NOT_FOUND', 'This image is no longer available. Choose another image.');
        hits.set(`${scope}:${id}`, hit);
      }
      let url = selectedAsset(hit)?.url;
      if (!url) throw new PixabayError(502, 'INVALID_IMAGE', 'This image is unavailable. Choose another image.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        for (let redirects = 0; redirects <= 3; redirects++) {
          response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'image/jpeg,image/png,image/webp' } });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          let nextUrl;
          try { nextUrl = new URL(location || '', url).href; } catch { nextUrl = ''; }
          if (!location || redirects === 3 || !safePixabayImageUrl(nextUrl)) throw new PixabayError(502, 'INVALID_IMAGE_REDIRECT', 'This image could not be downloaded safely. Choose another image.');
          url = nextUrl;
        }
        if (!response.ok) { await response.body?.cancel(); throw providerError(response); }
        const bytes = await readLimited(response, MAX_IMAGE_BYTES, controller.signal);
        const contentType = rasterType(bytes);
        const image = { bytes, contentType };
        images.set(cacheKey, image, bytes.length);
        return image;
      } catch (error) {
        if (controller.signal.aborted) throw new PixabayError(504, 'PHOTO_PROVIDER_TIMEOUT', 'The image download took too long. Please try again.');
        if (error instanceof PixabayError) throw error;
        throw new PixabayError(502, 'PHOTO_PROVIDER_UNAVAILABLE', 'The image could not be downloaded. Please try again.');
      } finally { clearTimeout(timer); }
    });
  }

  return { search, download };
}

export const pixabayService = createPixabayService();

function setHeaders(res, successful = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', successful ? 'public, max-age=0, s-maxage=86400' : 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', successful ? 'public, max-age=86400' : 'no-store');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createPixabayHandler(kind, service = pixabayService) {
  return async function handler(req, res) {
    setHeaders(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for photo requests.' } });
    }
    try {
      if (kind === 'photos') {
        const body = await service.search(parsePhotoSearch(req.url));
        setHeaders(res, true);
        return sendJson(res, 200, body);
      }
      const id = parseImageId(req.url);
      const image = await service.download(id);
      setHeaders(res, true);
      res.statusCode = 200;
      res.setHeader('Content-Type', image.contentType);
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.contentType];
      res.setHeader('Content-Disposition', `inline; filename="pixabay-${id}.${extension}"`);
      // Emit chunks so the Vercel Node runtime can stream larger images.
      // The complete asset has already been downloaded and validated server-side.
      for (let offset = 0; offset < image.bytes.length; offset += 64 * 1024) {
        if (!res.write(image.bytes.subarray(offset, offset + 64 * 1024))) {
          await new Promise((resolve, reject) => {
            const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); res.off('error', onError); };
            const onDrain = () => { cleanup(); resolve(); };
            const onClose = () => { cleanup(); reject(new Error('Response closed')); };
            const onError = () => { cleanup(); reject(new Error('Response failed')); };
            res.once('drain', onDrain); res.once('close', onClose); res.once('error', onError);
          });
        }
      }
      res.end();
    } catch (error) {
      if (res.headersSent) { res.destroy?.(); return; }
      setHeaders(res);
      const safe = error instanceof PixabayError ? error : new PixabayError(500, 'PHOTO_REQUEST_FAILED', 'This photo request could not be completed. Please try again.');
      if (safe.retryAfter) res.setHeader('Retry-After', String(safe.retryAfter));
      sendJson(res, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  };
}
