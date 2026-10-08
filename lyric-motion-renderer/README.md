# Lyric Motion Renderer — UtilityOS isolated module

An executable deterministic lyric-animation proof in Remotion. This module is **not** included in the UtilityOS root Vercel build and does not change the existing security/CSP or static UI.

## Quick start (GitHub Codespaces / Node >=20)

```sh
cd lyric-motion-renderer
npm install
npm run check
npm run studio
npm run render -- --project examples/project.json --out out/hero-proof.mp4
```

The sample project uses synthetic timing and **no song audio**, allowing a free, rights-safe MP4 smoke render. To use your own song, copy the MP3 to `public/audio/song.mp3` (gitignored), replace the example project's `audio` field with `audio/song.mp3`, and substitute actual approved word-alignment timestamps. Do **not** publish copyrighted audio without rights.

The default output is 1080x1920, 30fps, five seconds. Preview the `LyricHero` composition in Remotion Studio. Render with Node/Chromium (Chrome is downloaded or provided by the Remotion CLI). CPU/memory and storage usage depend on the machine. No Higgsfield credits or AI video API required.

### Design/production contract

- Input: JSON project with `fps`, `width`, `height`, `durationSeconds`, optional local `audio`, `words` [{word,start,end}], optional `title`, `background`, `accent`.
- Source-of-truth: only actual approved word timing from an alignment pass. `examples/project.json` is **demonstration timing**, not measured audio sync.
- Rendering: word-level highlighting and text motion via frame clock; semantic visual sequence demonstrated by a stroke evolving from an underline into an orbit; beat pulses are secondary, never timing authority.
- No transcription, vocal separation, automatic lyric alignment, backend queue or remote plugin link is included yet. These are separate integrations; no false claim of full song automation.
- A production job service should later accept validated project JSON and asset references, execute isolated render jobs, store MP4 and QA frames, return verified artifacts, and enforce queue/concurrency/timeouts.
- For actual multilingual projects: verify Devanagari conjuncts and matras on rendered frames, select script-compatible licensed fonts, and keep complete shaped words together. This sample deliberately animates *whole words*, not individual Unicode codepoints.

### Safety, costs and boundaries

Input audio must be local `public/` assets, not arbitrary URL requests. Validation rejects absolute paths, traversal, remote protocols and large/invalid projects. Do not upload user songs into Git or expose assets in public deployment. Remotion may require commercial licensing depending on organization/use. Heavy alignment model downloads are not part of initial render.
