import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const productionEntries = ['index.html', 'image', 'media', 'assets', 'lib', 'workers'];
const required = [
  'index.html', 'image/index.html', 'media/index.html',
  'assets/app.css', 'assets/home.js', 'assets/image.js', 'assets/media.css', 'assets/media.js',
  'workers/image.worker.js', 'lib/security/index.js', 'lib/media/ingest.js', 'lib/media/project.js', 'lib/media/audio/edits.js', 'lib/media/lyrics/lyrics.js', 'lib/media/lyrics/workspace.js', 'lib/media/transcript/subtitles.js', 'lib/media/transcript/workspace.js', 'lib/media/video/edits.js', 'lib/image/edits.js', 'lib/image/layers.js', 'lib/image/watermark.js', 'lib/image/cleanup.js', 'lib/image/text-replace.js', 'lib/image/compiler.js', 'lib/image/performance.js', 'lib/image/asset-doctor.js', 'lib/image/smart-crop.js', 'lib/image/web-pack.js', 'lib/image/watermark-detect.js', 'lib/image/browser-processor.js', 'vercel.json'
];

for (const file of required) await access(resolve(root, file));

const vercel = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const csp = vercel.headers?.[0]?.headers?.find((item) => item.key === 'Content-Security-Policy')?.value || '';
for (const directive of ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-ancestors 'none'"]) {
  if (!csp.includes(directive)) throw new Error(`Missing required CSP directive: ${directive}`);
}
if (vercel.outputDirectory !== 'dist') throw new Error('Vercel outputDirectory must be dist.');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of productionEntries) {
  await cp(resolve(root, entry), resolve(dist, entry), { recursive: true });
}

console.log('Production build emitted dist/ with local-processing application assets and verified security headers.');
