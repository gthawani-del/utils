# Utility OS Security Kernel

All current and future utilities must import shared controls from `/lib/security` instead of creating weaker tool-specific substitutes.

## Threat model

Every uploaded file is hostile. Filenames, extensions, browser MIME values, metadata and compressed size are untrusted. Image Studio verifies signatures from bytes, preflights dimensions before decode where supported, rejects files it cannot safely classify, and applies post-decode dimension checks as a second boundary.

## Isolation

Image parsing, decode, transform, encode and ZIP assembly run in a dedicated module Worker. Each operation gets a disposable Worker instance with a hard timeout and forced termination. Workers receive only the bytes and operation settings they need. There are no application secrets, tokens or authentication state.

The production CSP sets `connect-src 'none'` and `worker-src 'self'`. The image Worker also shadows `fetch` with a rejecting function as defense in depth.

## Resource budgets

Shared budgets currently cap:

- 40 MB per input file
- 50 files per batch
- 250 MB combined compressed batch input
- 60 megapixels / 60 million canvas pixels per decoded image
- 30 seconds per processing operation
- 1 concurrent batch processor
- 60 MB per individual output
- 5 MB per SVG

Compressed bytes are never treated as a memory estimate. Image dimensions are checked separately.

## Executable-content rules

Uploaded JavaScript and HTML are not supported. The codebase security lint rejects `eval`, `new Function`, `innerHTML` assignment, `outerHTML` assignment and `document.write`.

SVG is never inserted into the application DOM. SVG is accepted only after conservative text validation that rejects scripts, event handlers, foreignObject, embedded HTML-capable elements, external/remote resources, data URLs, CSS imports, entities and doctypes. The safe SVG is then decoded/rasterized by the image Worker for export.

## Privacy

Image Studio has no upload endpoint, analytics SDK or network client. Files live in memory for the browser session. Object URLs are revoked on replacement, clear-workspace and page exit. `Clear workspace` also removes Utility OS-namespaced local/session storage and cache entries if future tools create them.

## Exports

Output filenames are normalized, traversal characters/control characters are removed, reserved Windows device names are handled, and the extension/MIME are explicitly selected by the export operation. Source files are never overwritten.

## CSP and browser headers

`vercel.json` configures a restrictive CSP plus no-referrer, nosniff, anti-framing, restrictive permissions policy, COOP and same-origin resource policy. COEP is intentionally not enabled because Phase 1 does not require SharedArrayBuffer or cross-origin isolation; enabling it without need would create avoidable compatibility cost.
