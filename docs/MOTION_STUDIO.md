# Motion Studio — first implementation

Route: `/media/motion-studio`. Entry: Utility OS homepage. No LLM API, paid media API, cloud render job or paid fallback is configured.

## User flow

1. Try an editable sample, start a new video, import a project, or resume the device draft.
2. Set project name, aspect ratio, language and duration. Select Clear explainer, Product reveal or How it works. Switching templates explicitly confirms replacement of scenes.
3. Edit headings, descriptions, scene durations, layouts, step labels and motion. Add, reorder or remove scenes. Optionally upload a scene image.
4. Choose a palette, set a brand and website, upload a logo and narration, and optionally enable the synthesized instrumental pulse. Fit scene durations to narration when needed.
5. Preview, check codec support, export MP4 or WebM and download the self-contained editable project JSON.

The planning prompt can be copied to an existing ChatGPT conversation. This is a manual handoff, not a connection to ChatGPT or its image generator. Free-text fields do not invoke a model. Language records the intended language; it does not translate text or synthesize speech.

## Implementation and boundaries

- Canvas 2D renderer: original template scenes, masked typography, staggered entrances, rises and layered-card depth. These are not photorealistic generated footage or full WebGL 3D scenes.
- Uses the existing pinned Mediabunny browser export bundle through `lib/lyrical/export.js`; no second encoder dependency. It does **not** run the official Lemo renderer. The bespoke Lemo films remain in `gthawani-del/fintra`, `feature/lemo-motion-studio`. Importing arbitrary Lemo code is not supported.
- The free Microsoft voice companion is documented in [MOTION_VOICE.md](MOTION_VOICE.md). It generates an MP3 on a team computer for upload. There is no hosted voice endpoint, voice cloning or singing generation.
- No lip-sync, character rig, open-ended assistant or autonomous learning is claimed in this increment.
- Explicitly saved brand defaults are reused. This is preference storage, not model training.
- Canvas rendering supports text that installed fonts can shape. Full-script, complex-script and pronunciation QA remain project-specific; the language selector alone does not guarantee those.

## Project contract

`lib/motion/project.js` is the authoritative validator. JSON includes `version: 1`, title, `vertical|wide` format, template, palette, language, brand, URL (display text only), logo, music toggle, narration and scenes. Each scene has a heading, description, duration, layout, effect, optional image and three editable step labels.

Project downloads include uploaded images and audio as validated data URLs. Only PNG/JPEG/WebP images and supported audio MIME types are accepted. Remote URLs, SVGs, blob URLs and executable scene code are rejected. Additional fields are discarded. Browser decoding must succeed before replacing the current project.

Limits: 1–12 scenes; 2–30 seconds per scene; 120 seconds total; 8 MB image input (resized to 1280px); 16 MB audio input; 32 MB project JSON; export 720p/1080p at 30fps. Duration fitting can require additional scenes for long narration. Exports fail clearly if narration would be truncated or browser codecs are unavailable. Silent exports are explicitly described in preflight.

Images should be prepared with a transparent logo or matching background before upload; automatic logo background extraction is not implemented.

## Persistence and privacy

A single draft, including assets, is stored in IndexedDB `utility-os-motion`. Brand defaults use the existing `utility-os:` localStorage namespace. Homepage Clear saved workspace clears the Motion draft along with the existing workspaces. Browser storage can be unavailable, full, cleared or evicted; download the project JSON for a durable backup. No account synchronization is provided.

The browser editor uploads no assets. The optional voice companion sends narration text to Microsoft's online Edge service; it is separate from the editor and requires internet access.

## Verification

Run `npm run check` for security lint, syntax checks, unit tests and the production build. Serve `dist` for browser verification. Motion files are emitted through the existing `media`, `assets` and `lib` build entries.

Browser acceptance:
- Sample → edit → narration → preview → supported export; inspect output audio and dimensions.
- Invalid import preserves work; reload restores the draft and media.
- Cancel an export without losing edits; retry export.
- Narrow viewport has no horizontal overflow; controls have labels and keyboard focus.
- Last scene holds the logo/end card.

## Next increments

1. Inspect and adapt selected upstream Lemo scenes into safe, tested reusable presets; preserve provenance and renderer contracts.
2. A free voice companion interface accessible to nontechnical users, with explicit local execution and service availability checks.
3. Prepared-character mouth-shape animation, tested separately from narrated explainers.

These are future work, not enabled controls.
