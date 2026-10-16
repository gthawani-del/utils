# Lyrical images and transitions

Lyrical proposes a visual direction after lyric review. Uploads and the existing Pixabay search remain the image sources; there is no paid image-generation service or automatic stock download.

## User flow

1. Confirm the lyrics and keep their existing timing.
2. Review the suggested theme, palette and scene count. Choose vertical, landscape or square before choosing images. Photo idea buttons open the existing stock search.
3. Upload or select up to 24 images. The image strip supports reordering, replacement, removal and optional cropping. A separate storyboard shows image assignments, lyric excerpts and automatic scene windows.
4. Preview a 15-second window around the first image change; full-song playback and seeking remain available.
5. Export using the same scene planner and frame renderer as preview.

## Suggestions and timing

The default pace comes from the existing lyric-pace/audio-energy direction. A three-minute song suggests 10 scenes at unhurried pace, 15 at balanced pace or 23 at energetic pace. Suggestions scale with duration and are capped at 24. If the user supplies more images than suggested, every image is used. If fewer are supplied, images cycle in their chosen order. One image remains continuous throughout.

Boundaries start evenly spaced and snap to nearby lyric starts, with minimum spacing and complete song coverage. They never modify lyric/word timings. Returning exact phrases are labeled, but the system does not claim to identify verses, bridges, genre or musical beats. Theme suggestions use a few explicit lyric cues, then fall back to pacing; every language can use any user-selected theme. There is no full multilingual semantic analysis.

## Independent controls

- **Image transition:** Auto, Soft dissolve, Clean cut, Gentle slide, Fade through black.
- **Transition speed:** Slow, Normal or Quick. Durations shrink for short scenes. Cuts are instant.
- **Image movement:** Auto, Slow pan, Slow zoom or Still images.
- **Scene pace:** Auto, Unhurried, Balanced or Energetic.
- **Lyric animation:** existing style, strength, presentation, colour and size controls, independent of image movement.

Auto uses clean cuts only when a strong audio envelope coincides with a nearby detected onset; otherwise it uses a dissolve. These are energy cues, not beat tracking. Settings are saved in the existing draft, and older drafts receive default values.

## Image memory and failures

Images are prepared sequentially, normalized to a maximum 1920-pixel edge / two megapixels and stored as compressed blobs. The editor displays thumbnails with a maximum 360-pixel edge, rather than keeping each full-size image decoded. Original image decoding is still browser-dependent; uploads retain the existing 12 MB / 40-megapixel limit.

A serial cache retains at most two full-size bitmaps: outgoing/current during a transition and current/next afterwards. Evicted and late cancelled bitmaps are closed. Export awaits required images before encoding each frame. Preview pauses for an unprepared scene and resumes after loading. Missing/failed images produce a recoverable error rather than an image-free export. Audio, browser internals and video encoder buffers still use memory; this does not establish a total browser RAM bound or guarantee iOS stability.

## Verification

Automated regression coverage checks full-song scene coverage, multilingual excerpts, counts and overrides, transition draw operations, stable still images, timestamp preservation, all-image use, cyclic reuse, seeks, final frame, two-bitmap lifetime, cancellation and retry.

Run `npm run check`. Release browser verification is recorded in the pull request.
