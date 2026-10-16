# Optional Vosk transcription

Lyrical offers **Vosk · experimental · English / Hindi** in the transcription engine selector. Standard remains the default. Selecting another song language disables Vosk and returns to Standard. Existing lyric review, automatic timing, images and video generation are unchanged.

## Implementation

- Pinned `vosk-browser` 0.0.8 worker, loaded only when selected. The app controls the actual worker directly, so cancellation, errors and completion terminate its WASM heap immediately. No nested worker or queued terminate command.
- One 4,096-sample chunk (256 ms at 16 kHz, 16 KB) is sent at a time. Each `result` or `partialresult` acknowledges that chunk before the next is sent. Partial text is not committed as final lyrics.
- After the last audio acknowledgment, request `retrieveFinalResult` and wait for its `result` event, including an empty final result, before completing the section. Final words cannot be dropped by returning early.
- `setWords` supplies recognized word timestamps. The shared coordinator keeps the existing 15-second sections with overlap, absolute timing, boundary deduplication, worker recycling after three sections and validated resumable checkpoints. Checkpoints identify the engine, language and song sample count.
- Decoding/resampling reuses Lyrical's existing mono audio; this does not introduce a second full-song decode. The existing full mono and playback audio buffers still consume memory.
- Standard/Enhanced do not download Vosk models. Vosk supports only the two packaged languages; mixed-language songs and singing accuracy are not guaranteed.

## Model delivery and security

Official Alpha Cephei ZIPs are downloaded at build time, SHA-256 checked, and repackaged to tar.gz with explicit readable/searchable directories for the WASM archive reader. Outputs are static same-origin Vercel assets, approximately 40–45 MB each. They are not committed as binary blobs to Git. The build caches verified source ZIPs in `node_modules/.cache/lyrical-vosk`; a fresh build needs access to the official model host. Browser caching uses the engine's IndexedDB filesystem and may be evicted by the browser.

| Model | Source SHA-256 |
| --- | --- |
| `vosk-model-small-en-us-0.15` | `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498` |
| `vosk-model-small-hi-0.22` | `7c50a10866889f0ac21d912c20537a055a597ed09fc1d3e5bcd798f9f0017e48` |

The build verifies the pinned worker source hash before replacing Emscripten's dynamically named function wrapper with an ordinary function and `Object.defineProperty`. This removes its sole `new Function` use without adding `unsafe-eval` or changing the shared site CSP. An upstream worker change fails the build until reviewed. License and modification notices are shipped under `assets/vendor/lyrical-vosk-*`.

No external transcription API or server-side inference is used. Model hosting consumes normal static-hosting bandwidth; this is not a promise of zero hosting cost. Download size is not runtime RAM usage: Vosk documents about 300 MB runtime memory for typical small models, before app/browser overhead. Physical-device verification is required before promoting the engine from experimental.

## Verification

Automated coverage includes language gating, sample normalization, bounded in-flight work, final-flush ordering, final-only words, late/duplicate cleanup events, cancellation, model failures, a simulated three-minute job with four non-overlapping workers, checkpoint identity and resume. The full 203-test suite, security lint, syntax checks and production build pass locally.

Real-model integration and release verification results are recorded in the pull request. A Node worker harness can verify the same WASM model and protocol, but is not a Safari or browser-memory benchmark. No claim is made that the small Vosk models improve song accuracy without a comparative evaluation.

## Upstream references

- https://github.com/ccoreilly/vosk-browser
- https://alphacephei.com/vosk/models
- https://alphacephei.com/vosk/accuracy
