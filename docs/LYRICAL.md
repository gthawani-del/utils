# Lyrical

Lyrical adds a guided song-to-video workflow at `/lyrical`, linked from the Utility OS homepage. A song's measured audio energy and reviewed lyric timing determine its initial motion direction. Users can accept that direction or adjust it before export.

## First-use flow

1. **Song:** upload MP3, WAV, M4A, FLAC or OGG (browser decoding required), up to 45 MiB / five minutes. A clearly labelled, locally generated sample lets users explore without downloading the transcription model.
2. **Lyrics:** choose the song language and explicitly start local multilingual Whisper transcription. Higher accuracy uses the Small model; Faster uses Base. The model downloads on first use and runs in a cancellable worker. Play individual lines; edit, split, merge, remove or add lines. Timing is automatic. Pasted lyrics run local transcription and match the entered text against its word timeline; words stay as entered. Corrections retain phrase timing, and split/merge/add operations allocate boundaries automatically. Optional “Fine-tune timing” reveals advanced controls. Confirm the lyrics before proceeding.
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

The language picker offers the model’s 99 languages. Language selection is required because the pinned runtime does not implement automatic detection. The decoder receives explicit language/task prompt tokens. Text remains Unicode; recognition quality still varies by song and language. English and Devanagari can be mixed. Canvas draws complete shaped strings, wraps with `Intl.Segmenter`, and keeps right-to-left text in visual reading order. Noto Sans Devanagari and Anton are bundled with OFL licenses; other scripts use installed system fonts. Verify glyph coverage on the target device for other scripts. Singing accuracy and mixed-language recognition vary. A selected-language script check flags suspicious drafts (for example, Arabic-script output for a Hindi selection); this is a warning for manual review, not automatic translation. The manual correction path remains available after model/network failures.

Changing wording clears stale word timestamps while retaining the line’s automatic phrase boundaries. Splits use available detected word boundaries, otherwise estimate within the existing phrase; merges retain the combined span. Added lines receive a bounded window near the playhead. “Auto-sync lyrics” matches the current text against a separately saved audio-derived word timeline; it reuses that timeline for the same language/model instead of repeatedly running inference. Legacy untimed drafts can use the same action.

Pasted-text matching uses monotonic edit-distance alignment, with uncertain words assigned within nearby detected audio windows. This is not acoustic forced alignment. Estimated lines are labelled for a quick listen and use phrase animation, not invented word highlighting. No usable vocal timestamps or no matching words means a retry message, not uniform timing across the song. Matching is bounded to 4,000 tokens per side to limit memory. Normal edits never require entered timestamps. Manual controls remain optional; invalid manual overrides still block export and can be reset through Auto-sync. RTL and ambiguous repeated words use phrase animation.

## Architecture and privacy

- Static page and native browser modules; no new application framework.
- `lib/lyrical/project.js`: timing validation, energy analysis, direction and image scene schedule.
- `workers/lyrical-transcription.worker.js`: local timestamp-capable Whisper Small/Base via the pinned, bundled Transformers.js runtime and same-origin ONNX WASM.
- `timing.js`: transcript matching, automatic split/merge/add timing, and explicit estimated-span handling.
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

All 167 automated tests pass. They cover timestamp integrity, edits retaining phrase timing, automatic pasted/split/merge/add timing, repeated choruses, instrumental gaps, estimated spans, confirmation failures, automatic direction, image scene endings, grapheme-safe wrapping, full-song export scheduling, container header writes, memory bounds, unsupported codecs and the Pixabay proxy's validation/error/cache behavior.

Local browser launch was blocked by workspace socket restrictions, so browser QA ran on the actual Vercel preview instead.

Verified in that browser:

- Sample creation, image upload, mixed Hindi/English editing, confirmation, preview, cancellation and draft recovery.
- Two real 12-second WebM exports. An independent ffprobe/ffmpeg check confirmed VP9 at 720×1280, 30 fps, 360 frames, Opus audio, and non-silent decoded audio. The 12.020-second container includes normal audio packet padding. A decoded frame visibly matches the edited Hindi text.
- Real 20-second Hindi song upload, local speech-model loading and word-timestamp output. The default Small model produced Devanagari and usable draft timing, with several word errors that required editing. Corrected lines successfully passed confirmation into Images & style and a typography-only preview. The complete 20-second excerpt then exported and independently decoded as VP9/Opus, 600 frames at 30 fps (20.020-second container). Base used Urdu script in this test; the UI flags a script mismatch. Tiny was rejected for poor accuracy. This is a draft transcription workflow, not a claim of accurate sung-lyric recognition across all 99 languages.
- The live Pixabay route returns the intended upload fallback because `PIXABAY_API_KEY` is absent from the **Preview** environment. This does not verify the Production variable or a successful provider search. Configure the existing key for Preview and redeploy to finish that check.
- Vercel preview deployment succeeds; automated lint, syntax, unit and production-build checks pass.

MP4 encoding is not offered by the tested cloud Linux browser; its supported WebM path was tested. Physical phone browsers, MP4-capable browsers and maximum-length exports remain separate device checks.

Before production release, use a real song to verify:

- Fresh upload → transcription → edit/timing review → confirmation → images → preview → download.
- Full-file audio and lyric synchronization near the beginning, middle and end; inspect the downloaded file in an independent player.
- Mixed-script glyphs, RTL layout and long phrases; narrow mobile layout and keyboard navigation.
- Image upload, stock search and selection on the real Vercel deployment, resolution/crop accuracy and provider failure recovery.
- Refresh/resume, changed-lyrics confirmation, cancellation/retry and unavailable codecs.

Five-minute stereo songs can still exceed the practical memory of a phone. Format support is probed for the exact dimensions and original audio format; some browsers may offer only WebM or neither format. Closing/discarding the tab interrupts export. No mobile-device compatibility claim is made without testing that device.

## Automatic-timing correction (2026-10-16)

Removed the requirement to enter start/end times for pasted, split or added lines. Timing controls are hidden behind an optional fine-tuning switch. No new dependency, paid API or server worker was introduced. Existing song transcription accuracy limits still apply.

Live preview verification: a real 20-second Hindi excerpt plus seven pasted lyric lines completed local transcription and automatic matching. Splitting and merging a line, editing text, cached re-sync and confirmation all succeeded without entering any timestamps. The optional timing switch remained off. Six lines were correctly labelled estimated because recognition differed from the supplied text; the final line matched detected words.
