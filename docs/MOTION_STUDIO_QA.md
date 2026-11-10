# Motion Studio verification — 2026-11-11

Scope: first template-based browser implementation. No production deployment verification is implied.

## Automated checks

- `npm run check`: PASS — security lint, JavaScript syntax checks, 226 unit tests, production build.
- 13 new project-contract tests cover timing, duration limits, unsafe asset imports, unknown fields, prototype-name palettes, independent project state and narration fitting.
- Voice helper: live Microsoft voice listing and a 6.816s `en-IN-NeerjaNeural` MP3 generated; FFprobe confirmed 24kHz mono MP3. See MOTION_VOICE.md.

## Interactive browser checks

Browser: Chrome Headless Shell 157.0.8103.50 via Playwright. Desktop 1440×1000 and mobile 390×844. The second pass served the application's actual Vercel security headers.

PASS:
- Sample → edit heading → narration upload → fit durations → music → export.
- Reload → resume draft, preserving edits, brand and uploaded narration.
- Invalid project import reports the error and keeps the current draft.
- Template replacement confirmation; add/reorder/delete scenes.
- Scene image decode, resize and removal.
- Audio preview under the production CSP without a data-URL network request.
- Export cancellation returns to editing without exposing a partial download.
- Saved brand defaults apply to a new project.
- Homepage workspace clearing removes the Motion draft.
- Expanded preview plays and closes with Escape.
- No horizontal overflow at 390px; no uncaught page errors in the exercised flows.

## Export evidence

Actual 8-second 720×1280, 30fps WebM exported by the app. FFprobe found VP9 video and Opus audio. FFmpeg decoded all 240 video frames. Audio mean volume -22.5dB and maximum -4.6dB; audio was present, not silent. The held final brand/URL frame was visually inspected. Narration duration fitting includes a short tail and pads audio to the video duration.

This headless browser reported WebM encoding support but not MP4/AAC. MP4 remains capability-gated through the existing exporter and was not verified in this environment. No converted FFmpeg file is presented as proof of native browser MP4 export.

## Visual review and limits

Desktop welcome and editor, narrow layout and exported closing frame were inspected. Text was readable in the current browser; a faulty obsolete-browser test was discarded and rerun in the current browser. Full-screen mobile preview is available for a larger view of portrait scenes.

Not claimed: user research, screen-reader certification, all-language typography/voice QA, full upstream Lemo rendering, photorealistic animation, lip-sync or hosted voice generation. This increment uses original Canvas templates and the existing browser encoder. No paid API or paid render job was submitted.

## Guided creation and motion library increment

- Eight animation families: problem/solution, document/workflow, connected systems, files/knowledge, voice/action, product walkthrough, before/after, checklist/outcome. Sample previews and previews using authored content are available, with category filters.
- Guided creation matches explicit keywords, requires users to confirm a pattern, asks for missing facts and assembles five editable scenes from their answers. Unknown descriptions offer all patterns. This is not general-purpose AI writing or self-learning.
- Brief answers persist in local storage; scene projects use the existing draft store. Users can edit earlier answers and resume an interrupted brief.
- Custom HEX/color pickers support full-video and individual-scene colors, contrast warnings, three font families and three motion intensities. Old project files remain supported.
- Existing images are preserved during template changes; only Product walkthrough embeds scene images in its new diagram. Diagram labels should be reviewed after a template change.
- Full check passed with 247 tests; an additional template-remapping preservation test passed separately (248 total). Build and security checks passed.
- Browser checks: guided repair-request story, five-scene review, custom colors and scene overrides, font selection, project download, eight gallery previews, safe content-preserving remapping, mobile category filtering. No page errors in these flows.
- All eight families visually inspected in vertical and widescreen layouts with long labels. Very long diagram labels shrink; concise labels are preferable.
- No paid services or LLM API calls added. Existing optional local voice helper is unchanged; hosted voice generation and lip-sync are not included.
- Final browser pass additionally verified unknown-topic fallback, brief resume before and after reload, and a real 15.02-second 720×1280 WebM export with VP9/Opus. FFmpeg decoded the whole file without errors; an exported animation frame was inspected. Native MP4 remains unverified in this browser.
