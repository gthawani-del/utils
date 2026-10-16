# Lyrical

Lyrical adds a guided song-to-video workflow at `/lyrical`, linked from the Utility OS homepage. A song's measured audio energy and reviewed lyric timing determine its initial motion direction. Users can accept that direction or adjust it before export.

## First-use flow

1. **Song:** upload MP3, WAV, M4A, FLAC or OGG (browser decoding required), up to 45 MiB / five minutes. A clearly labelled, locally generated sample lets users explore without downloading the transcription model.
2. **Lyrics:** explicitly start local multilingual Whisper transcription. The model downloads on first use and runs in a cancellable worker. Play individual lines; edit, split, merge, remove or add lines. Start/end controls and “Start here / End here” support timing corrections. Pasted lyrics require manual timing; the app never invents word alignment. Confirm both the text and timing before proceeding.
3. **Images & style:** upload up to eight images, search Pixabay, or explicitly choose typography only. Reorder and position crops. Review the system's direction; optional controls expose aspect ratio, style, motion strength, phrase/word presentation, accent and type size.
4. **Video:** preview the entire timeline against the original audio, return to earlier steps, and export a supported MP4 or WebM at 720p or 1080p. Exact frame timestamps drive export independently of playback. Cancellation preserves the editable project. A completed file becomes an explicit Save video download.

## System direction

| Direction | Initial rule | Motion |
|---|---|---|
| Bold rhythm | At least 2.7 words per voiced second, or frequent detected energy rises | Scale/slide entrances, alternating reveals, restrained audio-onset accents |
| Quiet cinema | Below 1.5 words per voiced second, or average phrases longer than 3.8 seconds | Slower phrase reveals, generous spacing, gentle image movement |
| Clear type | Other pacing | Restrained phrase movement and a small accent rule |

These are transparent heuristics, not semantic genre/mood detection or a measured BPM. Audio onsets are simple RMS energy rises, not a beat tracker. The UI explains the choice. Confirming changed lyrics recalculates the suggestion unless the user has customized it. “Use system direction” restores automatic settings. Image scene boundaries are spaced across the whole song and snapped to nearby lyric starts.

The initial system direction is available in lyric review before users are asked to configure visuals. Preview and export call the same deterministic canvas renderer.

## Language and timing

Text remains Unicode in its original language. English and Devanagari can be mixed. Canvas draws complete shaped strings, wraps with `Intl.Segmenter`, and keeps right-to-left text in visual reading order. Noto Sans Devanagari and Anton are bundled with OFL licenses; other scripts use installed system fonts. Verify glyph coverage on the target device for other scripts. The Whisper model supports many languages; singing accuracy and mixed-language recognition vary. The manual correction path remains available after model/network failures.

Changing a line clears its old word timestamps while retaining phrase boundaries for review. Changing timing, splitting or merging also clears word timestamps. Animated phrases remain available. Word highlighting is only applied where reliable original timestamps survive; RTL and ambiguous repeated words fall back to phrase animation. There is no automatic forced realignment after text edits. Overlapping, missing, negative or out-of-song line timings block confirmation.

## Architecture and privacy

- Static page and native browser modules; no new application framework.
- `lib/lyrical/project.js`: timing validation, energy analysis, direction and image scene schedule.
- `workers/lyrical-transcription.worker.js`: local Whisper tiny via the pinned, bundled Transformers.js runtime and same-origin ONNX WASM.
- `renderer.js`: deterministic canvas frame composition, shaping, image motion and lyric animation.
- `export.js` / `export-runtime-entry.js`: lazy MediaBunny/WebCodecs muxing with bounded submission and cancellation. See [export details](LYRICAL_EXPORT.md).
- `storage.js`: one draft's metadata in localStorage; audio and selected image Blobs in IndexedDB. New project and homepage Clear workspace remove this draft. Browser storage is best effort and is not a cloud backup.
- `api/lyrical/photos.js` and `image.js`: Vercel-only Pixabay proxy. The server uses `PIXABAY_API_KEY`; it is never shipped to the browser. See [Pixabay details](LYRICAL_PIXABAY.md).

Songs and lyrics stay on the device. Model files are fetched from Hugging Face on first transcription. Stock search sends only the query, orientation and page to the application server. Selected stock images are downloaded server-side before becoming local project assets. No paid generation/transcription API or Render.com service is required. Vercel hosting/bandwidth remains subject to the existing account plan.

## Build and deployment

```sh
npm ci --ignore-scripts
npm run check
```

The existing Vercel configuration serves `dist/` and discovers the two Node functions from `api/`. `PIXABAY_API_KEY` must be configured in the intended Vercel environment. If it is only present in production, a preview may correctly show the upload fallback. Redeploy after environment changes.

The build copies Lyrical, bundles transcription and export runtimes, and copies matching ONNX WASM. Unmodified MediaBunny source and its MPL-2.0 license are served under `/assets/vendor/mediabunny/`; its notice remains in the bundle. There is no browser-side secret or public key variable.

The integration also fixes existing build gates: a mistyped ONNX asset regex, redundant remote model probe, static Video Editor markup moved to HTML templates to satisfy the existing security lint, and a stale model-name assertion. Video Editor behavior is otherwise retained.

## Verification and limits

Automated tests cover timestamp integrity, edits invalidating word timing, confirmation failures, automatic direction, image scene endings, grapheme-safe wrapping, full-song export scheduling, container header writes, memory bounds, unsupported codecs and the Pixabay proxy's validation/error/cache behavior.

Local browser launch was blocked by this workspace's socket restrictions. Actual encoder output, visual/device QA, real model inference and live Vercel/Pixabay remain release checks until validated in an allowed browser. Do not interpret passing unit tests as proof of end-to-end song export or transcription quality.

Before production release, use a real song to verify:

- Fresh upload → transcription → edit/timing review → confirmation → images → preview → download.
- Full-file audio and lyric synchronization near the beginning, middle and end; inspect the downloaded file in an independent player.
- Mixed-script glyphs, RTL layout and long phrases; narrow mobile layout and keyboard navigation.
- Image upload, stock search and selection on the real Vercel deployment, resolution/crop accuracy and provider failure recovery.
- Refresh/resume, changed-lyrics confirmation, cancellation/retry and unavailable codecs.

Five-minute stereo songs can still exceed the practical memory of a phone. Format support is probed for the exact dimensions and original audio format; some browsers may offer only WebM or neither format. Closing/discarding the tab interrupts export. No mobile-device compatibility claim is made without testing that device.
