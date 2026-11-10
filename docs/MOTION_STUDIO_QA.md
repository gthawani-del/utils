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
