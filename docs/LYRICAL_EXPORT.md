# Lyrical browser export

## Public contract

`lib/lyrical/export.js` exposes:

- `probeExport({ width, height, sampleRate = 48000, numberOfChannels = 2, fps = 30 })`: returns supported `{ format, mimeType, videoCodec, audioCodec }` entries. Both video and audio must be supported. The caller must re-probe after changing output size or loading the actual song.
- `exportLyrical({ canvas, drawFrame, audioBuffer, duration, fps = 30, format = 'mp4', signal, onProgress })`: returns a completed `Blob`. `drawFrame(seconds)` paints the specified time to the supplied canvas; it may return a promise. It must use the same composition logic as preview, have its fonts/images loaded, and must not change canvas dimensions during export.
- `onProgress(percent, details)` receives integer progress and `{ stage, completedFrames, totalFrames }`. Stages are `encoding`, `finalizing` and `complete`. Only a complete, nonempty file produces 100%. Cancellation rejects with `AbortError`.

The lightweight module lazily imports `/assets/lyrical-export-runtime.js`. The normal build must bundle `lib/lyrical/export-runtime-entry.js` as browser ESM to that path. It imports pinned `mediabunny@1.61.5`; runtime APIs have been checked against that installed version. The generated bundle should retain the package's MPL-2.0 notice and make its corresponding source/license available in the project's third-party notices.

## Timing and audio

This is offline frame export, not a recording of live playback. Frame `i` is drawn at `i / fps`; the last frame is clipped to the original decoded audio duration. Browser scheduling and encoding speed do not alter timestamps. Preview playback must be paused or must use a separate canvas while this exporter owns its canvas.

Original decoded audio channels are fed from sample zero through the last sample. No gain, speed change, normalization or trimming is applied. AAC/Opus encoding is lossy: preserving the song content and timing does not mean preserving its original compressed bytes. The supplied `AudioBuffer` should be the full-quality song buffer, not the downsampled mono buffer used for transcription.

MP4 uses AVC plus AAC. WebM uses VP9 plus Opus, falling back to VP8 plus Opus if the exact VP9 configuration is unsupported. A device without supported audio **and** video encoding receives a clear error; editing remains possible. There is no silent-audio export or realtime MediaRecorder fallback.

## Memory and cancellation

- Maximum song length: five minutes.
- Maximum output dimensions: 1920 pixels on either edge, at most 1920 × 1080 pixels total, with even dimensions.
- Frame rates: 24, 25 or 30.
- Audio: one or two channels, 8–96 kHz; decoded PCM limited to 128 MiB.
- Encoded file size: capped at 256 MiB before adding any write beyond the cap.
- Target video bitrate: 3 Mbit/s up to 720p, 5 Mbit/s above; target audio bitrate 128 kbit/s mono / 192 kbit/s stereo. Encoder output may vary.

Video frames and small audio blocks are submitted in timestamp order, with every source `add` awaited. Mediabunny's native encoder backpressure threshold is four queued items. No full-song frame array or unbounded audio/video submission queue is created. A seekable output store in fixed 1 MiB blocks supports MP4/WebM header patches and avoids repeatedly growing a contiguous buffer. The final Blob and input assets still consume memory; these limits do not guarantee success on every phone.

Abort signals call `Output.cancel()` and release native encoders. Working file blocks are cleared on success, cancellation and error. If cancellation arrives during container finalization, finalization finishes cleanup and the result is discarded rather than downloaded. A new export is needed after cancellation; there is no partial-file resume.

The rendering loop yields periodically so controls can respond. It does not depend on animation frames or wall-clock elapsed time. Background throttling may slow or pause it without changing the timeline. A discarded tab, device lock or browser process termination can stop the export; the UI should advise keeping the page open and save the editable draft independently.

## Verification

`tests/lyrical-export.test.mjs` checks full-song frame continuity, final frame clipping, duration consistency, input/byte limits, header patching across output blocks, and unsupported-browser probing. These are correctness checks for the pure scheduling/storage layer, not proof of device encoder support.

Release QA must actually export and decode a file with sound, check its start/middle/end synchronization, verify cancellation and repeat export, and test chosen desktop/mobile browsers. Use this existing song's approved timing as a comparison fixture. MP4 has ordinary container metadata at the end (`fastStart: false`) to avoid an extra whole-file buffering stage; it is a downloadable file, not an adaptive streaming format.

### Browser verification (2026-10-16)

On the Vercel preview, a 12-second composition with an uploaded image and Hindi/English edits exported successfully to WebM twice. The downloaded file decoded independently with ffmpeg: VP9, 720×1280, 360 frames at 30 fps, Opus mono audio with non-zero amplitude. The container duration was 12.020 seconds, including audio packet padding. A frame extracted at 1.2 seconds matched the edited Hindi text. Cancellation and another export succeeded; reload recovered the draft. A separate 20-second real Hindi song excerpt completed transcription, manual corrections, confirmation, preview and WebM export. The downloaded file independently decoded as 600 VP9 frames at 30 fps with Opus audio and a 20.020-second container. MP4 was not offered by this browser. These results do not establish physical-phone or maximum-duration compatibility.
