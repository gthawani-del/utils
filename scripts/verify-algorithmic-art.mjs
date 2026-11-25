import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { examples } from '../lib/image/art-examples.js';
import { recipeHash } from '../lib/image/art-recipe.js';

const browserModule = process.env.ART_PLAYWRIGHT;
const { chromium } = await import(browserModule ? pathToFileURL(resolve(browserModule)).href : 'playwright');
const launch = {};
if (process.env.ART_CHROMIUM_RUNTIME) {
  const { default: runtime } = await import(pathToFileURL(resolve(process.env.ART_CHROMIUM_RUNTIME)).href);
  launch.args = runtime.args;
  launch.executablePath = await runtime.executablePath();
}
const output = resolve(process.argv[2] || '/tmp/utility-os-art-review');
await mkdir(output, { recursive: true });
const origin = 'https://art-review.local';
const csp = JSON.parse(await readFile('vercel.json', 'utf8')).headers[0].headers.find(header => header.key === 'Content-Security-Policy').value;
const browser = await chromium.launch(launch);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route(origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const file = resolve('dist', '.' + path + (extname(path) ? '' : (path.endsWith('/') ? 'index.html' : '/index.html')));
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp' }[extname(file)];
    try { await route.fulfill({ body: await readFile(file), contentType: mime, headers: { 'content-security-policy': csp } }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artPath = '/image/algorithmic-drawing';
  const canvas = page.locator('#drawing-preview');
  const rendered = seed => page.waitForFunction(seed => document.querySelector('#drawing-preview')?.getAttribute('aria-label')?.endsWith('seed ' + seed), seed);

  await page.goto(origin + '/');
  const quick = page.locator('#quick-tools');
  const highlighted = quick.locator('a').first();
  assert.equal(await highlighted.getAttribute('href'), artPath);
  assert.equal(await highlighted.evaluate(el => el.classList.contains('directory-quick-featured')), true);
  assert.equal(await page.locator('.directory-art-hero').count(), 0);
  assert.equal(await highlighted.evaluate(el => el.querySelector('img').clientWidth), await quick.locator('a').nth(1).evaluate(el => el.querySelector('img').clientWidth));
  await page.screenshot({ path: resolve(output, 'home-mobile.png') });
  await highlighted.click();
  await rendered(examples[0].settings.seed);
  assert.equal(await page.locator('#art-brief').inputValue(), '');
  const progress = page.getByRole('progressbar', { name: 'Creating artwork' });
  await page.evaluate(() => {
    const scan = document.querySelector('#drawing-scan');
    globalThis.scanSteps = [];
    new MutationObserver(() => {
      if (!scan.hidden) globalThis.scanSteps.push(scan.getAttribute('aria-valuenow'));
    }).observe(scan, { attributes: true, attributeFilter: ['aria-valuenow', 'hidden'] });
  });
  await page.getByRole('button', { name: 'Create artwork' }).tap();
  await progress.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Describe a new idea' }).waitFor();
  assert.equal(await page.locator('#art-brief').inputValue(), examples[0].brief);
  assert.deepEqual(await page.evaluate(() => scanSteps), ['15', '45', '100']);
  assert.notEqual(await canvas.getAttribute('aria-label'), 'Flow Fields, Midnight palette, seed ' + examples[0].settings.seed);
  await page.goto(origin + '/images');
  assert.equal(await page.locator('#images-art-examples a').count(), 3);
  await page.getByRole('link', { name: 'Violet Waves' }).click();
  await rendered(examples[1].settings.seed);
  assert.equal(await page.locator('#pattern').inputValue(), 'interference');

  const durations = [];
  for (const { settings } of examples) {
    for (const size of ['1080x1080', '1080x1350', '1920x1080']) {
      await page.goto(origin + artPath + recipeHash({ ...settings, size }));
      await rendered(settings.seed);
      const first = digest(await canvas.screenshot());
      await page.reload();
      await rendered(settings.seed);
      const bytes = await canvas.screenshot();
      assert.equal(digest(bytes), first, settings.pattern + ' ' + size);
      const check = await canvas.evaluate(el => {
        const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let colored = 0, edge = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) < 32) continue;
          colored++;
          const p = i / 4;
          if (p % el.width === 0 || p % el.width === el.width - 1 || p < el.width || p >= el.width * (el.height - 1)) edge++;
        }
        return { coverage: colored / (el.width * el.height), edge };
      });
      assert.ok(check.coverage > .015 && check.coverage < .92, JSON.stringify({ settings, size, check }));
      assert.ok(check.edge < 15, JSON.stringify({ settings, size, check }));
      await canvas.screenshot({ path: resolve(output, settings.pattern + '-' + size + '.png') });
    }
    const timing = await page.evaluate(async settings => {
      const { drawAlgorithmicArt } = await import('/lib/image/algorithmic-drawing.js');
      const { normalizeRecipe } = await import('/lib/image/art-recipe.js');
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      ctx.canvas.width = 480;
      ctx.canvas.height = 480;
      const times = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        drawAlgorithmicArt(ctx, 480, 480, normalizeRecipe({ ...settings, seed: settings.seed + i }));
        ctx.getImageData(240, 240, 1, 1);
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[Math.ceil(times.length * .95) - 1];
    }, settings);
    durations.push([settings.pattern, timing]);
    await page.locator('#drawing-gallery summary').click();
    await page.locator('#drawing-seeds button').last().waitFor();
    await page.locator('#drawing-seeds').screenshot({ path: resolve(output, settings.pattern + '-curated.png') });
    await page.locator('#drawing-gallery summary').click();
    assert.ok(timing < 125, settings.pattern + ' p95 render exceeded 125 ms in QA (' + timing + ' ms)');
  }

  const openIdea = page.getByRole('button', { name: 'Describe a new idea' });
  if (await openIdea.isVisible()) await openIdea.click();
  await page.locator('#art-brief').fill('A midnight-blue jazz poster with gentle flowing lines and room for a title at the top');
  await page.getByRole('button', { name: 'Create artwork' }).click();
  await page.waitForFunction(() => document.querySelector('#drawing-interpretation')?.textContent.includes('Space at top'));
  await progress.waitFor({ state: 'hidden' });
  await page.locator('#drawing-gallery summary').click();
  await page.locator('#drawing-seeds button').last().waitFor();
  assert.equal(await page.locator('#drawing-seeds button').count(), 6);
  await page.locator('#drawing-gallery summary').click();
  const original = await canvas.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.waitForFunction(original => document.querySelector('#drawing-preview').getAttribute('aria-label') !== original, original);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForFunction(original => document.querySelector('#drawing-preview').getAttribute('aria-label') === original, original);
  await page.getByRole('button', { name: 'Copy recipe link' }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(shared, /#art=/);
  await page.goto(shared);
  assert.equal(await page.locator('#composition').inputValue(), 'top');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  for (const format of ['PNG', 'WebP']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download ' + format }).click()]);
    const bytes = await readFile(await download.path());
    assert.ok(bytes.length > 2048);
    assert.equal(bytes.toString('ascii', format === 'PNG' ? 1 : 8, format === 'PNG' ? 4 : 12), format === 'PNG' ? 'PNG' : 'WEBP');
    assert.ok(download.suggestedFilename().includes('1080x1350'));
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  async function renderBrief(brief) {
    const describe = page.getByRole('button', { name: 'Describe a new idea' });
    if (await describe.isVisible()) await describe.tap();
    await page.locator('#art-brief').fill(brief);
    await page.getByRole('button', { name: 'Create artwork' }).tap();
    await progress.waitFor({ state: 'hidden' });
  }
  const canvasHash = async () => digest(await canvas.evaluate(el => el.toDataURL()));
  await renderBrief('Create a red flower');
  assert.equal(await page.locator('#drawing-interpretation').textContent(), 'Flower · Red');
  const firstFlower = await canvasHash();
  const redPetals = await canvas.evaluate(el => {
    const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 120 && pixels[i + 1] < 90 && pixels[i + 2] < 110) count++;
    }
    return count;
  });
  assert.ok(redPetals > 1000);
  await canvas.screenshot({ path: resolve(output, 'red-flower.png') });
  await renderBrief('Create a red flower');
  const secondFlower = await canvasHash();
  assert.notEqual(secondFlower, firstFlower);
  await renderBrief('A blue bicycle');
  assert.match(await page.locator('#brief-error').textContent(), /Try a subject/);
  assert.equal(await canvasHash(), secondFlower);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'studio-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: resolve(output, 'studio-desktop.png') });
  assert.deepEqual(errors, []);
  console.log('Mobile and desktop workspace, catalog links, recipe round-trip, PNG/WebP downloads and nine repeatable renders passed.');
  console.log('Pinned Chromium p95 canvas draw, including readback: ' + durations.map(([name, ms]) => name + ' ' + ms.toFixed(1) + ' ms').join(', '));
} finally {
  await browser.close();
}
