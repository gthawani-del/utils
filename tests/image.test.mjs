import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateResize, calculateCrop, coverRect } from '../lib/image/math.js';
import { parsePngDimensions, parseWebpDimensions, parseSvgDimensions } from '../lib/image/preflight.js';
import { DEFAULT_EDITS, normalizeEdits, hasPixelEdits } from '../lib/image/edits.js';
import { createLayer, normalizeLayer, normalizeLayers } from '../lib/image/layers.js';
import { DEFAULT_WATERMARK, normalizeWatermark, resolveWatermarkPosition } from '../lib/image/watermark.js';
import { normalizeCleanup, cleanupHasMask } from '../lib/image/cleanup.js';
import { normalizeTextSelection, selectionFromPoints, replacementsToCleanup, replacementLayerFromSelection } from '../lib/image/text-replace.js';
import { COMPILER_PRESETS, MAX_COMPILER_OUTPUTS, normalizeCompilerOutput, normalizeCompilerOutputs, compilerSettings } from '../lib/image/compiler.js';
import { PERFORMANCE_FORMATS, normalizePerformanceBudget, performanceCandidateWidths, chooseBudgetCandidate } from '../lib/image/performance.js';
import { shouldUseBrowserProcessor } from '../lib/image/browser-processor.js';
import { buildAssetDoctorReport, plannedOutputDimensions } from '../lib/image/asset-doctor.js';
import { parseColorProfileSummary } from '../lib/image/preflight.js';

test('fit resize preserves aspect ratio', () => {
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'fit', width: 1000, height: 1000, preserveAspect: true }), { width: 1000, height: 500 });
});

test('percentage, longest and shortest edge resize are distinct', () => {
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'percentage', percentage: 50 }), { width: 2000, height: 1000 });
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'longest', longestEdge: 1600 }), { width: 1600, height: 800 });
  assert.deepEqual(calculateResize(4000, 2000, { resizeMode: 'shortest', shortestEdge: 1000 }), { width: 2000, height: 1000 });
});

test('ratio crop is centered and free crop is clamped', () => {
  assert.deepEqual(calculateCrop(1600, 1200, { mode: 'ratio', ratio: 1 }), { x: 200, y: 0, width: 1200, height: 1200 });
  assert.deepEqual(calculateCrop(100, 100, { mode: 'free', x: 90, y: 90, width: 100, height: 100 }), { x: 90, y: 90, width: 10, height: 10 });
});

test('fill cover rectangle preserves aspect ratio', () => {
  const r = coverRect(1600, 900, 1080, 1080);
  assert.equal(Math.round(r.width), 900);
  assert.equal(Math.round(r.height), 900);
});

test('PNG dimensions are preflighted without decode', () => {
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer); view.setUint32(16, 1920, false); view.setUint32(20, 1080, false);
  assert.deepEqual(parsePngDimensions(bytes), { width: 1920, height: 1080 });
});

test('SVG dimensions use safe numeric attributes or viewBox', () => {
  assert.deepEqual(parseSvgDimensions('<svg width="100" height="50"></svg>'), { width: 100, height: 50 });
  assert.deepEqual(parseSvgDimensions('<svg viewBox="0 0 300 200"></svg>'), { width: 300, height: 200 });
});


test('edit settings are normalized and bounded', () => {
  const edits = normalizeEdits({ brightness: 400, exposure: -9, gamma: 0, blur: 99, straighten: -50 });
  assert.equal(edits.brightness, 100);
  assert.equal(edits.exposure, -2);
  assert.equal(edits.gamma, 0.4);
  assert.equal(edits.blur, 20);
  assert.equal(edits.straighten, -15);
});

test('default edits remain non-destructive and pixel-edit detection is precise', () => {
  assert.equal(hasPixelEdits(DEFAULT_EDITS), false);
  assert.equal(hasPixelEdits({ ...DEFAULT_EDITS, saturation: 1 }), true);
  assert.equal(hasPixelEdits({ ...DEFAULT_EDITS, straighten: 2 }), false);
});


test('design layers normalize untrusted values and restrict fonts', () => {
  const layer = normalizeLayer({ type: 'text', text: '<b>plain text</b>', fontFamily: 'url(evil)', x: 999, opacity: 4 });
  assert.equal(layer.type, 'text');
  assert.equal(layer.fontFamily, 'system-ui');
  assert.equal(layer.x, 150);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.text, '<b>plain text</b>');
});

test('layer creation is deterministic in shape and normalization caps layer count', () => {
  const text = createLayer('text', 'layer-1');
  assert.equal(text.type, 'text');
  assert.equal(text.id, 'layer-1');
  const many = Array.from({ length: 80 }, (_, i) => ({ type: 'rectangle', id: String(i) }));
  assert.equal(normalizeLayers(many).length, 50);
});


test('watermark recipes clamp values and restrict types/fonts', () => {
  const recipe = normalizeWatermark({ enabled: true, type: 'script', fontFamily: 'evil()', opacity: 9, position: 'nowhere', x: 500 });
  assert.equal(recipe.type, 'text');
  assert.equal(recipe.fontFamily, 'system-ui');
  assert.equal(recipe.opacity, 1);
  assert.equal(recipe.position, 'bottom-right');
  assert.equal(recipe.x, 100);
});

test('watermark preset positioning respects margins', () => {
  const recipe = normalizeWatermark({ ...DEFAULT_WATERMARK, position: 'bottom-right', margin: 20 });
  assert.deepEqual(resolveWatermarkPosition(1000, 500, 200, 50, recipe), { x: 880, y: 455 });
});


test('cleanup masks normalize bounded local strokes', () => {
  const cleanup = normalizeCleanup({ enabled: true, strokes: [{ radius: 9, points: [{ x: -1, y: 2 }, { x: .4, y: .6 }] }] });
  assert.equal(cleanup.enabled, true);
  assert.equal(cleanup.strokes[0].radius, .12);
  assert.deepEqual(cleanup.strokes[0].points[0], { x: 0, y: 1 });
  assert.equal(cleanupHasMask(cleanup), true);
});

test('cleanup ignores empty masks and caps stroke count', () => {
  assert.equal(cleanupHasMask(normalizeCleanup({ enabled: true, strokes: [] })), false);
  const many = Array.from({ length: 140 }, () => ({ radius: .01, points: [{ x: .5, y: .5 }] }));
  assert.equal(normalizeCleanup({ enabled: true, strokes: many }).strokes.length, 100);
});


test('text replacement selections normalize drag geometry safely', () => {
  assert.deepEqual(selectionFromPoints({ x: .8, y: .7 }, { x: .2, y: .3 }), { x: .2, y: .3, width: .6000000000000001, height: .39999999999999997 });
  assert.deepEqual(normalizeTextSelection({ x: -1, y: .95, width: 3, height: 3 }), { x: 0, y: .95, width: 1, height: .050000000000000044 });
});

test('text replacement builds a bounded cleanup mask and editable layer', () => {
  const selection = { x: .2, y: .3, width: .4, height: .1 };
  const cleanup = replacementsToCleanup([{ id: 'r1', selection }]);
  assert.equal(cleanup.enabled, true);
  assert.ok(cleanup.strokes.length > 0 && cleanup.strokes.length <= 100);
  const layer = replacementLayerFromSelection(selection, { text: 'New copy', fontFamily: 'serif', fontSize: 42, fontWeight: 600, color: '#112233', align: 'left' }, 'l1');
  assert.equal(layer.type, 'text');
  assert.equal(layer.text, 'New copy');
  assert.equal(layer.x, 40);
  assert.equal(layer.y, 35);
  assert.equal(layer.width, 40);
  assert.equal(layer.height, 10);
});


test('compiler includes the required finished-asset presets', () => {
  const ids = new Set(COMPILER_PRESETS.map((item) => item.id));
  for (const id of ['instagram-square','instagram-portrait','story-reel','youtube-thumbnail','linkedin','x','website-hero','website-thumbnail','whatsapp','og-image']) assert.equal(ids.has(id), true);
});

test('compiler normalizes custom outputs, deduplicates and caps the pack', () => {
  const custom = normalizeCompilerOutput({ label: ' Email Banner! ', width: 99999, height: 0 });
  assert.equal(custom.id, 'email-banner');
  assert.equal(custom.width, 12000);
  assert.equal(custom.height, 1);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'out-'+i, label: 'Out '+i, width: 100+i, height: 200+i }));
  assert.equal(normalizeCompilerOutputs(many).length, MAX_COMPILER_OUTPUTS);
});

test('compiler derives each output independently from base settings', () => {
  const base = { resizeMode: 'percentage', width: 4000, height: 3000, crop: { mode: 'ratio', ratio: 1 }, quality: .82 };
  const result = compilerSettings(base, { id: 'hero', label: 'Hero', width: 1920, height: 1080 }, 'fill');
  assert.equal(result.resizeMode, 'fill');
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.deepEqual(result.crop, { mode: 'none' });
  assert.equal(result.quality, .82);
});


test('performance budget clamps limits and tests modern plus fallback formats', () => {
  const budget=normalizePerformanceBudget({maxWidth:99999,maxBytes:1,minQuality:2});
  assert.equal(budget.maxWidth,12000);
  assert.equal(budget.maxBytes,8192);
  assert.equal(budget.minQuality,.95);
  assert.deepEqual(PERFORMANCE_FORMATS,['avif','webp','jpeg']);
});

test('performance width search descends without exceeding the starting width', () => {
  const widths=performanceCandidateWidths(1920);
  assert.equal(widths[0],1920);
  assert.ok(widths.every((width,index)=>index===0||width<widths[index-1]));
  assert.ok(widths.every((width)=>width<=1920&&width>=64));
});

test('performance candidate selection enforces bytes width and quality before ranking', () => {
  const budget={maxWidth:1920,maxBytes:180*1024,minQuality:.5};
  const best=chooseBudgetCandidate([
    {kind:'jpeg',width:1920,size:170*1024,quality:.42},
    {kind:'webp',width:1632,size:175*1024,quality:.82},
    {kind:'avif',width:1632,size:160*1024,quality:.86},
    {kind:'jpeg',width:1920,size:220*1024,quality:.9}
  ],budget);
  assert.equal(best.kind,'avif');
  assert.equal(best.width,1632);
});


test('browser processor is selected for iOS WebKit clients and force-test mode', () => {
  assert.equal(shouldUseBrowserProcessor({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/140 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5, search: '' }), true);
  assert.equal(shouldUseBrowserProcessor({ userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36', platform: 'Linux x86_64', maxTouchPoints: 0, search: '?browserCanvas=1' }), true);
  assert.equal(shouldUseBrowserProcessor({ userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36', platform: 'Linux x86_64', maxTouchPoints: 0, search: '' }), false);
});


test('asset doctor flags measured upscale, metadata, GPS, transparency loss and unsupported output', () => {
  const report=buildAssetDoctorReport({
    fileSize:8*1024*1024,
    inspect:{dimensions:{width:800,height:600},exif:{hasExif:true,hasGps:true,orientation:6},color:{wideGamut:true,profileName:'Display P3'}},
    settings:{resizeMode:'fill',width:1600,height:1200,crop:{mode:'none'},format:'jpeg',rotate:0},
    transparencyDetected:true,
    supportedFormats:['png','webp']
  });
  const codes=new Set(report.issues.map((x)=>x.code));
  for(const code of ['large-file','upscale','transparency-loss','gps','orientation','color-profile','unsupported-format']) assert.equal(codes.has(code),true);
});

test('asset doctor reports a clean measured asset without inventing warnings', () => {
  const report=buildAssetDoctorReport({
    fileSize:300*1024,
    inspect:{dimensions:{width:1600,height:900},exif:{hasExif:false,hasGps:false,orientation:1},color:{wideGamut:false,profileName:'sRGB'}},
    settings:{resizeMode:'fit',width:1600,height:900,preserveAspect:true,crop:{mode:'none'},format:'webp',rotate:0},
    transparencyDetected:false,
    supportedFormats:['jpeg','png','webp']
  });
  assert.equal(report.issues.length,1);
  assert.equal(report.issues[0].code,'ready');
});

test('asset doctor planned dimensions respect rotation and selected preset mismatch', () => {
  assert.deepEqual(plannedOutputDimensions({width:1200,height:800},{resizeMode:'fill',width:1200,height:630,crop:{mode:'none'},rotate:90}),{width:630,height:1200});
  const report=buildAssetDoctorReport({
    fileSize:1000,
    inspect:{dimensions:{width:1200,height:800},exif:{orientation:1},color:{}},
    settings:{resizeMode:'fill',width:1000,height:500,crop:{mode:'none'},format:'png',rotate:0},
    preset:{width:1200,height:630},
    supportedFormats:['png']
  });
  assert.equal(report.issues.some((x)=>x.code==='preset-dimensions'),true);
});

test('color-profile parser identifies PNG sRGB metadata conservatively', () => {
  const bytes=new Uint8Array(8+12);
  bytes.set([137,80,78,71,13,10,26,10],0);
  bytes.set([0,0,0,0,115,82,71,66,0,0,0,0],8);
  const color=parseColorProfileSummary('png',bytes);
  assert.equal(color.hasProfile,true);
  assert.equal(color.profileName,'sRGB');
  assert.equal(color.wideGamut,false);
});
