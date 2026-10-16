# Lyrical transcription memory incident

Date: 2026-10-16. Scope: Lyrical only.

## Incident and conclusion

A user reported that a three-minute song reached approximately 512 MB on the loading display and the browser crashed. The previous UI work did not correct the transcription engine's memory design. Short-clip checks were insufficient to establish long-song or mobile reliability.

The loading number counts model-file bytes loaded. It is not the audio size or a measurement of RAM. Browser memory pressure is the likely cause of the reported termination, based on the confirmed allocation paths below. No physical iPhone crash log or device peak-RAM measurement was available, so the exact OS termination reason is not proven.

## Confirmed causes and contributors

| Finding | Evidence in the previous implementation | Consequence |
| --- | --- | --- |
| Oversized default | `selectSong` defaulted to `small`; the worker selected `whisper-small_timestamped`, FP32 encoder plus Q8 merged decoder | The encoder file alone is about 353 MB. Initializing model sessions needs memory beyond the downloaded files. A phone hint recommending Faster did not change or restrict this default. |
| Whole-song copy | `transcribeSong` copied the complete 16 kHz mono track into the worker while the main page retained mono and playback/export PCM | A three-minute mono copy adds 11.52 MB; stereo 44.1 kHz playback PCM alone is approximately 63.5 MB. These are buffer calculations, not measured peak RAM. |
| Eager feature preparation | The pinned Transformers.js 3.8.1 `_call_whisper` prepares every overlapping chunk's features before the generation loop | Feature buffers grow with song duration even though inference itself is sequential. |
| Expensive word alignment | `return_timestamps: "word"` enables attention outputs and token alignment | Temporary tensors increase peak memory beyond model-file size. They are necessary for detected word timing, so the fix bounds their input and generation length. |
| Worker lifetime | One model/worker handled the entire recording | The WASM heap and inference allocations could remain resident throughout the song. A worker keeps the UI responsive but is not a browser memory limit. |
| No partial recovery | Only the final transcript was returned; a ten-minute timer covered the whole job | An interrupted song lost completed recognition. A long but progressing run could time out. |
| Verification gap | Earlier live verification used short excerpts and desktop Chrome | It did not reproduce the three-minute workload or establish Safari safety. |

## Corrective design

1. **Compact default:** Standard uses multilingual Whisper Tiny with an FP32 encoder and Q8 decoder. The two selected ONNX files are approximately 32.9 MB and 30.7 MB (about 64 MB combined, excluding tokenizer/runtime files). This is a model-file reduction, not a promised RAM ceiling. Retaining the FP32 encoder avoids introducing the known Whisper encoder-quantization sensitivity.
2. **Device policy:** Enhanced uses Base only on desktop-class devices. Phones, desktop-mode iPads, and devices reporting 4 GB RAM or less are restricted to Standard. Missing/unknown quality and old `small` settings migrate to Standard. Lyrical can no longer select the former large model.
3. **Bounded input:** The main thread transfers one 15-second owned interval with up to two seconds of context on each side: at most 19 seconds / 1.216 MB of mono PCM. The worker never receives the full song. The pipeline's own eager chunking is disabled. Generation is capped at 224 new tokens per section.
4. **Automatic timing:** Word timestamps are offset back to the full song timeline. Midpoint ownership removes overlap-context duplication; overlapping boundary duplicates are removed and timings remain monotonic. No user-entered timestamps are required.
5. **Memory release:** Only one model worker exists at a time. It is terminated and recreated after three sections (45 seconds of song audio), forcing release of that worker's WASM heap. New workers reuse cached model files when available. Cancellation, failures and final completion terminate the active worker.
6. **Recovery:** Each completed section stores a compact transcript checkpoint with language, model, sample count and next section. Retry/refresh resumes only a matching, validated checkpoint. New songs and changed language/quality discard old progress. Completed recognition clears the checkpoint before review validation, so failed review cannot permanently reuse a bad completed result.
7. **Honest progress:** Recognition shows section number and song position. Engine loading shows bytes, without a fabricated overall percentage. A per-stage stall timer replaces the whole-job ten-minute deadline.

The engine remains browser-only and multilingual. No paid transcription API, server renderer, subscription, new dependency, or changes to other Utility OS modules were introduced. Tiny trades some recognition accuracy for lower resource use; singing and mixed-language output still need review. Enhanced does not guarantee correct lyrics either.

## Regression coverage and release verification

Automated tests cover a three-minute buffer, maximum transfer size, worker recycling without overlapping model instances, absolute timestamps, boundary duplicates, cancellation, checkpoint resume, invalid checkpoints, stale worker events, startup failures, stalled sections, legacy setting migration, and phone/iPad device policy. The complete security, syntax, test and production-build gates are required before merging.

Release verification on the public deployment (PR #16, code commit `2f8f70115dacc290496e46cf44d756ff5683a5a6`):

- All 196 tests, security lint, syntax checks, production build, pull-request CI and main CI passed.
- A real three-minute Hindi recording completed in Standard mode and reached editable lyric review. Cancellation partway through followed by a page reload resumed from the saved 1:30 position and completed all 12 sections.
- The same three-minute recording also completed in Enhanced mode in approximately 2:00 of displayed processing time, with no browser crash observed. This is a single desktop Chrome result, not a performance promise.
- Both smaller models produced unreliable Hindi text on this song; the script-mismatch review warning appeared. The memory correction does not resolve singing-transcription accuracy. A native CPU comparison using the same Tiny model and explicit Hindi prompt also returned largely Latin-script output, so the observed accuracy issue was not unique to browser rendering.

Do not equate these desktop passes with physical iPhone/Safari certification, or an MB loading label with a measured RAM profile. A physical-device retest remains necessary to close the exact reported device incident. No claim is made that every supported song/language transcribes accurately.

## Primary references

- Installed pinned runtime: `node_modules/@huggingface/transformers/src/pipelines.js`, `_call_whisper`; `models.js`, Whisper word-timestamp generation and extraction; `utils/hub.js`, model-file loading/cache behavior.
- [Previous Small encoder file size](https://huggingface.co/onnx-community/whisper-small_timestamped/blob/main/onnx/encoder_model.onnx).
- [Tiny ONNX file sizes](https://huggingface.co/onnx-community/whisper-tiny_timestamped/tree/main/onnx).
- [Transformers.js per-module dtype guidance](https://huggingface.co/docs/transformers.js/guides/dtypes).
