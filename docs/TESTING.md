# Phase 1 test matrix

## Automated in repository

`npm run check` covers security lint, JavaScript module syntax/contracts, security-kernel unit tests, image-math/preflight unit tests, and production CSP structure.

Automated cases include zero-byte input, falsely renamed/signature mismatch, cumulative batch budgets, extreme decoded dimensions, generic HEIF rejected as AVIF, malicious SVG constructs, safe filename export, controlled operation states, resize math, crop math and dimension preflight.

## Browser verification checklist

The following requires a real browser session and representative fixture files. Do not mark these verified merely because unit tests pass:

- normal JPEG
- normal PNG
- transparent PNG
- EXIF-rotated phone photo
- malformed image
- falsely renamed file
- extremely large-resolution image
- zero-byte file
- batch containing one corrupt image
- JPEG → WebP
- PNG transparency preserved in PNG/WebP output
- metadata/GPS removed from generated export
- target-size compression converges near requested size
- timeout and forced Worker termination
- repeated processing without retained object URLs / obvious memory growth
- ZIP export
- Chrome current
- Edge current
- Safari current with graceful AVIF/codec degradation
- iOS/Android mobile browser layout and processing behavior
- DevTools network panel shows no file upload or unexpected request during processing
- production CSP reports no avoidable violations
- uploaded SVG content cannot execute script
- Worker scope contains no app secrets/auth tokens

Phase 1 is intentionally designed so unsupported browser primitives disable processing rather than silently moving work to a server or unsafe main-thread fallback.
