import { access, cp, mkdir, readFile, rm, readdir } from 'node:fs/promises';
import { build as bundle } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLyricalVosk } from './build-lyrical-vosk.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const productionEntries = ['index.html', 'image', 'media', 'lyrical', 'assets', 'lib', 'workers'];
const required = [
  'index.html', 'image/index.html', 'media/index.html', 'lyrical/index.html', 'assets/lyrical.js', 'assets/lyrical.css', 'workers/lyrical-transcription.worker.js',
  'assets/app.css', 'assets/home.js', 'assets/image.js', 'assets/media.css', 'assets/media.js',
  'workers/image.worker.js', 'lib/security/index.js', 'lib/media/ingest.js', 'lib/media/project.js', 'lib/media/audio/edits.js', 'lib/media/audio-video/visualizer.js', 'lib/media/audio-video/workspace.js', 'lib/media/command/grammar.js', 'lib/media/command/workspace.js', 'lib/media/recipes/store.js', 'lib/media/recipes/workspace.js', 'lib/media/compiler/plan.js', 'lib/media/compiler/tar.js', 'lib/media/compiler/workspace.js', 'lib/media/delivery/plan.js', 'lib/media/delivery/workspace.js', 'lib/media/qc/report.js', 'lib/media/qc/workspace.js', 'lib/media/lyrics/lyrics.js', 'lib/media/lyrics/workspace.js', 'lib/media/transcript/subtitles.js', 'lib/media/transcript/workspace.js', 'lib/media/video/edits.js', 'lib/image/edits.js', 'lib/image/layers.js', 'lib/image/watermark.js', 'lib/image/cleanup.js', 'lib/image/text-replace.js', 'lib/image/compiler.js', 'lib/image/performance.js', 'lib/image/asset-doctor.js', 'lib/image/smart-crop.js', 'lib/image/web-pack.js', 'lib/image/watermark-detect.js', 'lib/image/browser-processor.js', 'vercel.json'
];

for (const file of required) await access(resolve(root, file));

const vercel = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const csp = vercel.headers?.[0]?.headers?.find((item) => item.key === 'Content-Security-Policy')?.value || '';
for (const directive of ["default-src 'self'", "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co", "object-src 'none'", "frame-ancestors 'none'"]) {
  if (!csp.includes(directive)) throw new Error(`Missing required CSP directive: ${directive}`);
}
if (vercel.outputDirectory !== 'dist') throw new Error('Vercel outputDirectory must be dist.');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of productionEntries) {
  await cp(resolve(root, entry), resolve(dist, entry), { recursive: true });
}

// Build a pinned same-origin runtime, avoiding cross-origin JavaScript module imports.
await bundle({
  entryPoints: [resolve(root, 'lib/media/video/recognition-runtime-entry.js')],
  outfile: resolve(dist, 'assets/recognition-runtime.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  logLevel: 'warning'
});
// Load video encoders only when the user reaches preview/export.
await bundle({
  entryPoints: [resolve(root, 'lib/lyrical/export-runtime-entry.js')],
  outfile: resolve(dist, 'assets/lyrical-export-runtime.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  logLevel: 'warning', legalComments: 'eof',
  banner: { js: '/*! Mediabunny 1.61.5 (MPL-2.0). Corresponding source and license: /assets/vendor/mediabunny/ */' }
});
// Publish the unchanged source and license for the MPL-covered encoder dependency.
await mkdir(resolve(dist, 'assets/vendor/mediabunny'), { recursive: true });
for (const entry of ['src', 'LICENSE', 'package.json']) {
  await cp(resolve(root, 'node_modules/mediabunny', entry), resolve(dist, 'assets/vendor/mediabunny', entry), { recursive: true });
}
// Copy the exact ONNX WASM binaries belonging to the installed runtime.
const ortDir = resolve(root, 'node_modules/onnxruntime-web/dist');
const ortAssets = (await readdir(ortDir)).filter(name => /^ort-.*\.(wasm|mjs)$/.test(name));
if (!ortAssets.some(name => name.endsWith('.wasm'))) throw new Error('ONNX WASM assets missing');
await mkdir(resolve(dist, 'assets/ort'), { recursive: true });
for (const name of ortAssets) await cp(resolve(ortDir, name), resolve(dist, 'assets/ort', name));
await buildLyricalVosk(root, dist);
console.log('Production build emitted dist/ with bundled recognition runtime and local ONNX WASM assets.');
