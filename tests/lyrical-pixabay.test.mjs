import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  parsePhotoSearch, parseImageId, safePixabayImageUrl, safePixabaySourceUrl,
  normalizePhoto, createPixabayService, createPixabayHandler,
} from '../api/lyrical/_pixabay.js';

const SECRET = 'test-only-secret-that-must-stay-on-server';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOioAAAAASUVORK5CYII=', 'base64');
function photo(id = 123) {
  return {
    id, type: 'photo', pageURL: `https://pixabay.com/photos/city-night-${id}/`,
    previewURL: `https://cdn.pixabay.com/photo/2026/01/01/city-${id}_150.jpg`, previewWidth: 150, previewHeight: 100,
    webformatURL: `https://pixabay.com/get/city-${id}_640.jpg`, webformatWidth: 640, webformatHeight: 427,
    largeImageURL: `https://pixabay.com/get/city-${id}_1280.jpg`,
    imageWidth: 6000, imageHeight: 4000, imageSize: 4000000, user: 'Photographer',
  };
}
function jsonResponse(hits = [photo()]) { return Response.json({ hits, totalHits: hits.length, total: 900 }); }
function mockResponse() {
  const response = new EventEmitter();
  response.headers = {}; response.statusCode = 200; response.body = []; response.headersSent = false;
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
  response.write = chunk => { response.headersSent = true; response.body.push(Buffer.from(chunk)); return true; };
  response.end = body => { if (body) response.body.push(Buffer.from(body)); response.headersSent = true; };
  response.json = () => JSON.parse(Buffer.concat(response.body).toString());
  return response;
}

test('search parameters are bounded, normalized, and reject URL injection and duplicates', () => {
  assert.deepEqual(parsePhotoSearch('/api/lyrical/photos?q=night++city&orientation=vertical&page=2'), { q: 'night city', orientation: 'vertical', page: 2 });
  assert.deepEqual(parsePhotoSearch('/?q=東京'), { q: '東京', orientation: 'all', page: 1 });
  for (const path of ['/?q=', '/?q=hello&q=other', '/?q=hi&key=x', '/?q=hi&page=26', '/?q=hi&page=1.5', '/?q=hi&orientation=square', '/?q=%00hello', `/?q=${'x'.repeat(101)}`]) {
    assert.throws(() => parsePhotoSearch(path), error => error.status === 400, path);
  }
  assert.equal(parseImageId('/?id=123'), 123);
  for (const path of ['/?id=123&url=https://example.com', '/?id=1&id=2', '/?id=-1', '/?id=1.2', '/?id=0123', '/?id=999999999999']) {
    assert.throws(() => parseImageId(path), error => error.status === 400, path);
  }
});

test('only HTTPS Pixabay raster paths and corresponding source pages are accepted', () => {
  assert.equal(safePixabayImageUrl(photo().largeImageURL), photo().largeImageURL);
  assert.equal(safePixabaySourceUrl(photo().pageURL, 123), photo().pageURL);
  assert.equal(safePixabaySourceUrl('https://pixabay.com/en/city-123/', 123), 'https://pixabay.com/en/city-123/');
  for (const value of ['http://pixabay.com/get/a.jpg', 'https://cdn.pixabay.com.evil.test/photo/a.jpg', 'https://pixabay.com@evil.test/get/a.jpg', 'https://pixabay.com:444/get/a.jpg', 'https://pixabay.com/api/a.jpg', 'https://cdn.pixabay.com/photo/a.svg', 'https://cdn.pixabay.com/photo/%2f..%2f/a.jpg', 'https://pixabay.com/get/a.jpg?key=secret', 'https://127.0.0.1/get/a.jpg', 'file:///etc/passwd']) {
    assert.equal(safePixabayImageUrl(value), null, value);
  }
  for (const value of ['javascript:alert(1)', 'https://example.com/photos/city-123/', 'https://pixabay.com/photos/city-124/', 'https://pixabay.com/photos/city-123/?key=secret']) assert.equal(safePixabaySourceUrl(value, 123), null);
});

test('resized photos advertise their size limit rather than original dimensions', () => {
  const normal = normalizePhoto(photo());
  assert.equal(normal.width, null); assert.equal(normal.height, null); assert.equal(normal.maxDimension, 1280);
  assert.equal(normal.originalWidth, 6000); assert.equal(normal.fullResolution, false); assert.equal(normal.previewWidth, 640);
  const full = normalizePhoto({ ...photo(), fullHDURL: 'https://pixabay.com/get/full_1920.jpg' });
  assert.equal(full.maxDimension, 1920); assert.equal(full.width, null); assert.equal(full.fullResolution, false);
  const original = normalizePhoto({ ...photo(), imageURL: 'https://pixabay.com/get/full.jpg' });
  assert.equal(original.width, 6000); assert.equal(original.fullResolution, true);
  const oversized = normalizePhoto({ ...photo(), imageURL: 'https://pixabay.com/get/full.jpg', imageSize: 13 * 1024 * 1024 });
  assert.equal(oversized.maxDimension, 1280); assert.equal(oversized.fullResolution, false);
  assert.equal(normalizePhoto({ ...photo(), type: 'vector' }), null);
  assert.equal(normalizePhoto({ ...photo(), pageURL: 'https://evil.test/' }), null);
});

test('search coalesces concurrent requests and retains successful results for 24 hours', async () => {
  let clock = 1000; let calls = 0;
  const service = createPixabayService({ now: () => clock, getKey: () => SECRET, fetchImpl: async value => {
    calls++;
    const url = new URL(value);
    assert.equal(url.searchParams.get('key'), SECRET);
    assert.equal(url.searchParams.get('image_type'), 'photo'); assert.equal(url.searchParams.get('safesearch'), 'true');
    assert.equal(url.searchParams.get('per_page'), '20');
    return jsonResponse();
  } });
  const query = { q: 'night', orientation: 'vertical', page: 1 };
  const [first, second] = await Promise.all([service.search(query), service.search(query)]);
  assert.equal(calls, 1); assert.deepEqual(first, second); assert.equal(JSON.stringify(first).includes(SECRET), false);
  clock += 24 * 60 * 60 * 1000 - 1;
  await service.search(query); assert.equal(calls, 1);
  clock += 1;
  await service.search(query); assert.equal(calls, 2);
});

test('search cache is bounded and API key rotation does not reuse old in-process results', async () => {
  let calls = 0; let key = SECRET;
  const service = createPixabayService({ getKey: () => key, fetchImpl: async () => { calls++; return jsonResponse(); } });
  for (let i = 0; i < 101; i++) await service.search({ q: `city ${i}`, orientation: 'all', page: 1 });
  await service.search({ q: 'city 0', orientation: 'all', page: 1 });
  assert.equal(calls, 102);
  key = 'rotated-test-secret';
  await service.search({ q: 'city 0', orientation: 'all', page: 1 });
  assert.equal(calls, 103);
});

test('selected image is downloaded once on the server, with metadata reused from search', async () => {
  let calls = 0;
  const service = createPixabayService({ getKey: () => SECRET, fetchImpl: async value => {
    calls++;
    if (new URL(value).pathname === '/api/') return jsonResponse();
    assert.equal(value, photo().largeImageURL);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  } });
  await service.search({ q: 'city', orientation: 'all', page: 1 });
  const [first, second] = await Promise.all([service.download(123), service.download(123)]);
  assert.equal(calls, 2); assert.equal(first.contentType, 'image/png'); assert.deepEqual(first.bytes, png); assert.equal(first, second);
  await service.download(123); assert.equal(calls, 2);
});

test('download resolves an image ID on cold start and follows only validated redirects', async () => {
  const requested = [];
  const service = createPixabayService({ getKey: () => SECRET, fetchImpl: async value => {
    requested.push(value);
    if (new URL(value).pathname === '/api/') { assert.equal(new URL(value).searchParams.get('id'), '123'); return jsonResponse(); }
    if (value === photo().largeImageURL) return new Response(null, { status: 302, headers: { location: 'https://cdn.pixabay.com/photo/2026/01/city.jpg' } });
    return new Response(png);
  } });
  await service.download(123); assert.equal(requested.length, 3);
  let dangerousRequests = 0;
  const malicious = createPixabayService({ getKey: () => SECRET, fetchImpl: async value => {
    if (new URL(value).pathname === '/api/') return jsonResponse();
    dangerousRequests++;
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/metadata' } });
  } });
  await assert.rejects(malicious.download(123), error => error.code === 'INVALID_IMAGE_REDIRECT');
  assert.equal(dangerousRequests, 1);
});

test('download rejects oversized and non-raster responses', async () => {
  for (const [response, code] of [
    [() => new Response(png, { headers: { 'content-length': String(13 * 1024 * 1024) } }), 'ASSET_TOO_LARGE'],
    [() => new Response('<svg><script>alert(1)</script></svg>', { headers: { 'content-type': 'image/png' } }), 'INVALID_IMAGE'],
    [() => new Response(new Uint8Array(12 * 1024 * 1024 + 1)), 'ASSET_TOO_LARGE'],
  ]) {
    const service = createPixabayService({ getKey: () => SECRET, fetchImpl: async value => new URL(value).pathname === '/api/' ? jsonResponse() : response() });
    await assert.rejects(service.download(123), error => error.code === code);
  }
});

test('provider errors, thrown URLs, and missing keys are safe and never cached', async () => {
  for (const status of [403, 429, 500]) {
    let calls = 0;
    const service = createPixabayService({ getKey: () => SECRET, fetchImpl: async () => {
      calls++; return new Response(`Upstream error at https://pixabay.com/api/?key=${SECRET}`, { status, headers: { 'x-ratelimit-reset': '30' } });
    } });
    const handler = createPixabayHandler('photos', service);
    for (let retry = 0; retry < 2; retry++) {
      const response = mockResponse();
      await handler({ method: 'GET', url: '/?q=city' }, response);
      assert.equal(response.statusCode, status === 429 ? 429 : 502);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(JSON.stringify(response.json()).includes(SECRET), false);
      if (status === 429) assert.equal(response.headers['retry-after'], '30');
    }
    assert.equal(calls, 2);
  }
  const missing = createPixabayHandler('photos', createPixabayService({ getKey: () => '', fetchImpl: () => { throw new Error('must not fetch'); } }));
  const missingResponse = mockResponse();
  await missing({ method: 'GET', url: '/?q=city' }, missingResponse);
  assert.equal(missingResponse.statusCode, 503); assert.match(missingResponse.json().error.message, /upload your own/);
  const throws = createPixabayHandler('photos', createPixabayService({ getKey: () => SECRET, fetchImpl: () => { throw new Error(`request failed https://pixabay.com/api/?key=${SECRET}`); } }));
  const thrownResponse = mockResponse();
  await throws({ method: 'GET', url: '/?q=city' }, thrownResponse);
  assert.equal(thrownResponse.statusCode, 502); assert.equal(JSON.stringify(thrownResponse.json()).includes(SECRET), false);
});

test('upstream timeout is bounded and produces a friendly retry message', async () => {
  const service = createPixabayService({ timeoutMs: 5, getKey: () => SECRET, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(service.search({ q: 'city', orientation: 'all', page: 1 }), error => error.status === 504 && error.code === 'PHOTO_PROVIDER_TIMEOUT');
});

test('handlers set cache and security headers, reject non-GET, and stream selected bytes', async () => {
  let reads = 0;
  const service = { search: async () => { reads++; return { photos: [normalizePhoto(photo())], page: 1, total: 1 }; }, download: async () => { reads++; return { bytes: png, contentType: 'image/png' }; } };
  const handler = createPixabayHandler('photos', service);
  for (const method of ['POST', 'HEAD', 'OPTIONS']) {
    const response = mockResponse(); await handler({ method, url: '/?q=city' }, response);
    assert.equal(response.statusCode, 405); assert.equal(response.headers.allow, 'GET');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(reads, 0);
  const response = mockResponse(); await handler({ method: 'GET', url: '/?q=city' }, response);
  assert.equal(response.statusCode, 200); assert.match(response.headers['vercel-cdn-cache-control'], /86400/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  const imageResponse = mockResponse();
  await createPixabayHandler('image', service)({ method: 'GET', url: '/?id=123' }, imageResponse);
  assert.equal(imageResponse.headers['content-type'], 'image/png');
  assert.equal(imageResponse.headers['cross-origin-resource-policy'], 'same-origin');
  assert.deepEqual(Buffer.concat(imageResponse.body), png);
});
