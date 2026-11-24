# Algorithmic art generator workflow

Start with a short description of the composition. Define what changes between seeds, which regions remain quiet, and which parameters affect geometry, pigment, or both. Use a real creator brief and a target format to judge the output.

The runnable reference is the Algorithmic Drawing page. Its recipe schema lives in `lib/image/art-recipe.js`. The same field definitions drive controls, defaults, reset, and imported-link normalization. Keep the generator local. In a standalone viewer, use an original theme and pin any dependency that the viewer loads locally.

Each recipe includes its version, generator, seed, palette, output size, composition, transparency, and mode parameters. A change to the interpretation of text must never change a resolved recipe. Keep the geometry random stream independent of the pigment stream. Static modes draw on demand. If motion is added, derive each frame from its index and a fixed time step and make playback opt-in with reduced-motion support.

## Verify and curate

1. Add tests for brief interpretation, seed repeatability, palette changes, and recipe round-trip. Run `npm run check`.
2. Install Playwright and its matching Chromium in the QA environment. Run `node scripts/verify-algorithmic-art.mjs /tmp/utility-os-art-review` against the built site. Set `ART_PLAYWRIGHT` to the absolute Playwright entry point when it lives outside the repository. For an environment with a bundled Chromium runtime, set `ART_CHROMIUM_RUNTIME` to that module’s absolute entry point.
3. The browser pass verifies nonblank artwork, repeatable canvas screenshots in one pinned browser, basic edge clearance, local downloads, links, and the mobile flow. Review the captures visually for contrast, balance, and intentional negative space. The 125 ms QA render ceiling is a regression threshold in the test runner, not a claim about phone latency.
4. Before changing curated examples, render 100 candidate thumbnails per mode. Compare coverage and spatial density to find near-duplicates and outliers. Review the candidates and select six starting points that show distinct compositions. Test the chosen examples at square, portrait, and landscape sizes.
5. Test a physical phone and a second browser before a public rollout. Evaluate framing across engines and keep raw pixel hashes scoped to the pinned comparison environment.

PNG and WebP export from the main Utility OS page. A restrictive embedded viewer can link to that page with the versioned recipe. Print metadata, real vector paths for plotters, and deterministic video frames are separate output paths.
