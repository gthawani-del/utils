# Utility OS

Browser-native utilities designed to keep user files on-device wherever technically possible.

## Phase 1

- Utility OS homepage
- Image Studio at `/image`
- Modular placeholders for future utilities
- Reusable security kernel under `/lib/security`
- Dedicated image-processing worker under `/workers`
- Strict Vercel security headers and zero network access for local processing

## Architecture

This repository deliberately uses static ES modules instead of a server framework for Phase 1. There are no runtime dependencies, no backend routes, no authentication, no analytics, no LLMs, and no external processing APIs.

Image processing runs in a dedicated module Worker. Files are signature-checked before decode, decoded dimensions are budgeted, SVG is sanitized and rasterized without DOM injection, batch concurrency is controlled, and workers are forcibly terminated on timeout.

## Local development

Any static server works. Example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Verification

```bash
npm run check
```

The check suite runs static security linting, module syntax checks, Node unit tests for the security kernel, and a production-structure build check.

## Privacy statement

For Image Studio, file bytes are processed locally in the browser and are not uploaded. The production CSP sets `connect-src 'none'`, and the processing Worker does not contain network code. No file data, metadata, filenames, or extracted content is sent to analytics because no analytics system is present.

## Limitations

- AVIF input/output is enabled only when the browser can actually decode/encode it. Unsupported AVIF operations fail cleanly.
- Image Studio uses browser-native codecs. It does not pretend to support codecs the browser cannot process.
- PNG target-file-size compression is not offered because browser-native PNG encoding does not provide a reliable quality parameter.
- SVG is accepted only after conservative sanitization. SVGs requiring scripts, remote assets, embedded HTML, external CSS, or data URLs are rejected.
- No source file is overwritten. All exports are newly generated files with sanitized names.

See `docs/SECURITY.md` and `docs/TESTING.md`.
