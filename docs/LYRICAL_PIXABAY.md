# Lyrical: Pixabay integration

## Deployment

Set `PIXABAY_API_KEY` as a **server-only** environment variable on the Vercel project and redeploy. Do not use a public/browser environment prefix. Neither function returns or logs the key. No live credential test is part of the test suite.

Routes are Node serverless functions in `api/lyrical/`. The private shared implementation is `_pixabay.js`; Vercel excludes underscore-prefixed utility files from function routing. Do not copy API source into the static `dist/` output. The frontend and local video export do not need a Pixabay key.

The site's content security policy must permit same-origin API connections. Temporary search previews use `https://pixabay.com` and `https://cdn.pixabay.com`; allow those exact origins in `img-src`. Selected images become same-origin response Blobs, then local project assets.

## Search

`GET /api/lyrical/photos?q=city%20night&orientation=vertical&page=1`

- `q`: required, 1–100 Unicode characters after trimming. Control characters are rejected.
- `orientation`: `vertical`, `horizontal`, or `all` (default).
- `page`: 1–25 (default 1). Page size is fixed at 20.
- Unexpected or repeated parameters are rejected.
- Upstream requests always use `image_type=photo` and `safesearch=true`.

Successful response:

```json
{
  "photos": [{
    "id": 123,
    "width": null,
    "height": null,
    "maxDimension": 1280,
    "originalWidth": 6000,
    "originalHeight": 4000,
    "previewWidth": 640,
    "previewHeight": 427,
    "previewUrl": "https://pixabay.com/get/example_640.jpg",
    "sourceUrl": "https://pixabay.com/photos/city-night-123/",
    "author": "Photographer",
    "fullResolution": false
  }],
  "total": 1,
  "page": 1
}
```

URLs above are illustrative schema values, not sample assets to download. `total` is the number of accessible results, capped at 500. Malformed, non-photo or unsafe hits are removed. Display a “Photos from Pixabay” link whenever search results appear, plus contributor/source details on selected assets. Use text nodes for provider-supplied strings.

**Quality:** `width`/`height` describe original metadata only when the original download is selected. For resized downloads they are `null`; `maxDimension` supplies the documented upper bound (1280 or 1920). Do not present `originalWidth`/`originalHeight` as the exported asset dimensions. Decode the selected Blob to determine its actual dimensions. Full-resolution API access depends on the account; `fullResolution: false` is expected with standard access.

## Select and download

`GET /api/lyrical/image?id=123`

Call on explicit image selection, not for every search result. The route resolves the ID through previously cached metadata or an ID lookup; callers cannot supply a download URL. It chooses an eligible original, then full-HD, then 1280px asset. Known originals above 4 MiB are skipped. The entire selected image is fetched and validated server-side before bytes are streamed to the browser. Only JPEG, PNG and WebP signatures are accepted, with a 4 MiB response ceiling. Redirects must remain on approved Pixabay image host/path combinations; at most three are followed.

The browser receives image bytes with a raster `Content-Type`; save this Blob in the project rather than permanently referencing Pixabay image URLs. Use local decoded dimensions for crop/quality controls. There is no image download on a search request. Concurrent selections of the same ID share one download within a running function instance.

## Failures

Errors use `{ "error": { "code": "...", "message": "..." } }` and `Cache-Control: no-store`.

| HTTP | Meaning | UI response |
|---|---|---|
| 400 | Invalid query or image ID | Correct the input |
| 404 | Image unavailable | Choose another image |
| 405 | Method other than GET | Fix caller; `Allow: GET` |
| 413 | Image exceeds size ceiling | Choose another image or upload a smaller copy |
| 429 | Upstream limit or local concurrency limit | Honor `Retry-After` |
| 502 | Upstream rejection, malformed response or unsafe image | Preserve selection/lyrics and offer retry/upload |
| 503 | Server key absent | Offer uploads; deployment configuration required |
| 504 | Provider timeout | Retry without discarding project edits |

Upstream response text and exception messages are never forwarded. POST, HEAD and OPTIONS are intentionally not supported. No cross-origin access headers are added; this API is intended for the same site.

## Caching and operational limits

Successful responses carry Vercel CDN cache headers for 24 hours. Each warm instance also caches up to 100 searches, 500 metadata entries and 16 selected images (48 MiB total image storage). Entries expire after 24 hours; eviction can occur earlier when bounds are reached. In-flight requests are coalesced with a 24-operation cap. Cache scopes change when the server key changes.

CDN caching and bounded memory reduce duplicate traffic; they do **not** provide a durable global request cache across all regions, cold starts and evictions. If production traffic requires strict retention of every distinct upstream query for the full 24 hours, add an existing shared KV/object cache. Do not bulk warm the provider or download search results automatically.

Selected stock image responses are capped at 4 MiB, below the documented buffered function response limit. User-uploaded images remain local and can be up to 12 MiB. No Vercel deployment test has been performed by the unit tests.

Vercel references: [utility-file routing](https://vercel.com/docs/functions/configuring-functions/advanced-configuration), [response-size guidance and streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

## Checks

Run `node --test tests/lyrical-pixabay.test.mjs`. Tests use fake fetch responses and a nonfunctional test key. Coverage includes parameter validation, URL allowlists/redirects, honest resolution metadata, 24-hour expiry and bounded eviction, concurrent download deduplication, secret-safe errors, size/signature checks, timeout behavior, HTTP methods and response headers.

Before release, verify a real keyword search, one selected image, attribution links, crop dimensions, a provider failure and a refresh after deployment. Confirm the environment variable exists in the intended production/preview environment. API access from this development environment has not established whether the account has full-resolution approval.

Provider reference: [Pixabay API documentation](https://pixabay.com/api/docs/). Pixabay requests 24-hour request caching, forbids permanent image hotlinking, and asks applications to identify the source in search results. Images remain subject to the [Pixabay Content License](https://pixabay.com/service/license-summary/).
