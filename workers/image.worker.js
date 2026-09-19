import { SECURITY_BUDGET, validateDimensions } from '../lib/security/budget.js';
import { sniffBytes } from '../lib/security/sniff.js';
import { sanitizeSvgText } from '../lib/security/svg.js';
import { ok, fail, unsupported } from '../lib/security/result.js';
import { preflightDimensions, parseExifSummary } from '../lib/image/preflight.js';
import { calculateResize, calculateCrop, coverRect } from '../lib/image/math.js';
import { normalizeEdits, hasPixelEdits } from '../lib/image/edits.js';
import { normalizeLayers } from '../lib/image/layers.js';
import { normalizeWatermark, resolveWatermarkPosition } from '../lib/image/watermark.js';
import { normalizeCleanup, cleanupHasMask } from '../lib/image/cleanup.js';

try { Object.defineProperty(self, 'fetch', { value: () => Promise.reject(new Error('Network disabled in Utility OS workers.')), writable: false }); } catch {}

self.onmessage = async (event) => {
  const { op } = event.data || {};
  try {
    if (op === 'inspect') return send(await inspect(event.data));
    if (op === 'process') return send(await processImage(event.data));
    if (op === 'preview') return send(await processImage({ ...event.data, preview: true }));
    if (op === 'zip') return send(await createZip(event.data));
    return send(unsupported('Unsupported worker operation.'));
  } catch {
    return send(fail('The file could not be processed safely.'));
  }
};

function send(result) {
  const transfers = [];
  if (result?.value?.buffer instanceof ArrayBuffer) transfers.push(result.value.buffer);
  self.postMessage(result, transfers);
}

async function inspect({ buffer }) {
  const bytes = new Uint8Array(buffer);
  const kind = sniffBytes(bytes).kind;
  if (!['jpeg', 'png', 'webp', 'avif', 'svg'].includes(kind)) return unsupported('File signature is not a supported image format.', 'BAD_SIGNATURE');
  let svgText = '';
  if (kind === 'svg') {
    if (bytes.byteLength > SECURITY_BUDGET.maxSvgBytes) return unsupported('SVG exceeds the safe size limit.');
    svgText = new TextDecoder().decode(bytes);
    sanitizeSvgText(svgText);
  }
  const rawDimensions = preflightDimensions(kind, bytes, svgText);
  if (!rawDimensions) return unsupported('Image dimensions could not be safely verified before decoding.');
  const dimensionCheck = validateDimensions(rawDimensions.width, rawDimensions.height);
  if (!dimensionCheck.ok) return unsupported(dimensionCheck.reason, 'RESOURCE_LIMIT');
  const exif = kind === 'jpeg' ? parseExifSummary(bytes) : { orientation: 1, hasExif: false, hasGps: false, make: '', model: '', dateTimeOriginal: '' };
  const swapped = kind === 'jpeg' && [5, 6, 7, 8].includes(exif.orientation);
  const dimensions = swapped ? { width: rawDimensions.height, height: rawDimensions.width } : rawDimensions;
  return ok({ kind, mime: mimeFor(kind), dimensions, exif });
}

async function processImage({ buffer, settings = {}, preview = false, watermarkLogoBuffer = null }) {
  const bytes = new Uint8Array(buffer);
  const inspected = await inspect({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  if (inspected.state !== 'completed') return inspected;
  const { kind, dimensions, exif } = inspected.value;

  let blob;
  if (kind === 'svg') {
    const safe = sanitizeSvgText(new TextDecoder().decode(bytes));
    blob = new Blob([safe], { type: 'image/svg+xml' });
  } else {
    blob = new Blob([bytes], { type: mimeFor(kind) });
  }

  let bitmap;
  let applyExif = kind === 'jpeg';
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'none', colorSpaceConversion: 'default', premultiplyAlpha: 'default' });
  } catch {
    bitmap = await createImageBitmap(blob);
    applyExif = false;
  }

  const preDecoded = validateDimensions(bitmap.width, bitmap.height);
  if (!preDecoded.ok) { bitmap.close(); return unsupported(preDecoded.reason, 'RESOURCE_LIMIT'); }

  const orientation = applyExif ? exif.orientation : 1;
  let source = orientation === 1 ? bitmap : drawOriented(bitmap, orientation);
  if (orientation !== 1) bitmap.close();
  const sourceCheck = validateDimensions(source.width, source.height);
  if (!sourceCheck.ok) { if ('close' in source) source.close(); return unsupported(sourceCheck.reason, 'RESOURCE_LIMIT'); }

  const cleanup = normalizeCleanup(settings.cleanup);
  if (cleanupHasMask(cleanup)) {
    if (source.width * source.height > 30_000_000) { if ('close' in source) source.close(); return unsupported('Cleanup is limited to 30 megapixels. Resize the image first for reliable local reconstruction.', 'CLEANUP_RESOURCE_LIMIT'); }
    const cleaned = applyCleanup(source, cleanup);
    if (cleaned.error) { if ('close' in source) source.close(); return unsupported(cleaned.error, 'CLEANUP_LIMIT'); }
    if ('close' in source) source.close(); else { source.width = 1; source.height = 1; }
    source = cleaned.canvas;
  }

  const crop = calculateCrop(source.width, source.height, settings.crop);
  const mode = settings.resizeMode || 'fit';
  let target;
  if (mode === 'fill' || mode === 'contain') {
    target = { width: positiveInt(settings.width, crop.width), height: positiveInt(settings.height, crop.height) };
  } else {
    target = calculateResize(crop.width, crop.height, settings);
  }
  if (preview && Number(settings.previewMaxEdge) > 0) {
    const edge = Number(settings.previewMaxEdge);
    const scale = Math.min(1, edge / Math.max(target.width, target.height));
    target = { width: Math.max(1, Math.round(target.width * scale)), height: Math.max(1, Math.round(target.height * scale)) };
  }
  const targetCheck = validateDimensions(target.width, target.height);
  if (!targetCheck.ok) return unsupported(targetCheck.reason, 'RESOURCE_LIMIT');

  const edits = normalizeEdits(settings.edits);
  if (hasPixelEdits(edits) && target.width * target.height > 24_000_000) {
    if ('close' in source) source.close();
    return unsupported('Detailed edits are limited to 24 megapixels per operation. Resize first, then apply edits.', 'EDIT_RESOURCE_LIMIT');
  }

  let canvas = render(source, crop, target, settings);
  if ('close' in source) source.close(); else { source.width = 1; source.height = 1; }
  if (hasPixelEdits(edits)) canvas = applyAdjustments(canvas, edits);
  canvas = transformCanvas(canvas, (Number(settings.rotate) || 0) + edits.straighten, Boolean(settings.flipX), Boolean(settings.flipY));
  canvas = renderDesignLayers(canvas, settings.layers);
  const watermarkRecipe = normalizeWatermark(settings.watermark);
  if (watermarkRecipe.enabled && watermarkRecipe.type === 'image' && !watermarkLogoBuffer) return unsupported('Select a watermark logo/image before processing.', 'WATERMARK_IMAGE_REQUIRED');
  canvas = await renderWatermark(canvas, watermarkRecipe, watermarkLogoBuffer);
  const finalCheck = validateDimensions(canvas.width, canvas.height);
  if (!finalCheck.ok) return unsupported(finalCheck.reason, 'RESOURCE_LIMIT');

  const outputKind = preview ? 'png' : (settings.format || kind);
  if (!['jpeg', 'png', 'webp', 'avif'].includes(outputKind)) return unsupported('That output format is not available.');
  const mime = mimeFor(outputKind);
  const targetBytes = preview ? 0 : Math.max(0, Number(settings.targetBytes) || 0);
  let encoded;
  let usedQuality = normalizeQuality(settings.quality);
  if (targetBytes > 0) {
    if (outputKind === 'png') return unsupported('Target-size compression is not reliable for PNG. Choose JPEG, WebP, or AVIF.');
    ({ blob: encoded, quality: usedQuality } = await encodeToTarget(canvas, mime, targetBytes));
  } else {
    encoded = await encode(canvas, mime, usedQuality);
  }
  if (encoded.type !== mime) return unsupported(`${outputKind.toUpperCase()} encoding is not supported by this browser.`, 'ENCODER_UNAVAILABLE');
  if (encoded.size > SECURITY_BUDGET.maxOutputBytes) return unsupported('Output exceeds the safe output-size limit.', 'RESOURCE_LIMIT');

  const outputBuffer = await encoded.arrayBuffer();
  return ok({
    buffer: outputBuffer,
    mime,
    kind: outputKind,
    width: canvas.width,
    height: canvas.height,
    size: outputBuffer.byteLength,
    quality: usedQuality,
    metadataStripped: true
  });
}

function drawOriented(bitmap, orientation) {
  const swap = [5,6,7,8].includes(orientation);
  const canvas = new OffscreenCanvas(swap ? bitmap.height : bitmap.width, swap ? bitmap.width : bitmap.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
    case 5: ctx.rotate(Math.PI / 2); ctx.scale(1, -1); break;
    case 6: ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); break;
    case 7: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
    case 8: ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); break;
    default: break;
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return canvas;
}

function applyCleanup(source, cleanup) {
  const canvas = new OffscreenCanvas(source.width, source.height); const ctx = canvas.getContext('2d', { alpha:true, willReadFrequently:true }); ctx.drawImage(source,0,0);
  let selected=0;
  for (const stroke of cleanup.strokes) { const result=inpaintStroke(ctx,canvas.width,canvas.height,stroke); if(result.error)return {error:result.error}; selected+=result.masked; if(selected>canvas.width*canvas.height*.2)return {error:'Cleanup mask is too large. Use Cleanup for small areas and split large removals into separate operations.'}; }
  return {canvas};
}
function inpaintStroke(ctx,canvasWidth,canvasHeight,stroke) {
  const radius=Math.max(1,stroke.radius*Math.min(canvasWidth,canvasHeight)); const points=stroke.points.map((p)=>({x:p.x*canvasWidth,y:p.y*canvasHeight})); if(!points.length)return {masked:0};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);} const pad=radius+4;
  const x0=Math.max(0,Math.floor(minX-pad)),y0=Math.max(0,Math.floor(minY-pad)),x1=Math.min(canvasWidth,Math.ceil(maxX+pad)),y1=Math.min(canvasHeight,Math.ceil(maxY+pad)); const width=x1-x0,height=y1-y0;
  if(width<=0||height<=0)return {masked:0}; if(width*height>4_000_000)return {error:'One cleanup stroke covers too large an area. Use a smaller brush region.'};
  const image=ctx.getImageData(x0,y0,width,height); const data=image.data; const maskCanvas=new OffscreenCanvas(width,height); const mctx=maskCanvas.getContext('2d',{alpha:true}); mctx.strokeStyle='#ffffff';mctx.fillStyle='#ffffff';mctx.lineCap='round';mctx.lineJoin='round';mctx.lineWidth=radius*2;
  if(points.length===1){mctx.beginPath();mctx.arc(points[0].x-x0,points[0].y-y0,radius,0,Math.PI*2);mctx.fill();} else {mctx.beginPath();mctx.moveTo(points[0].x-x0,points[0].y-y0);for(let i=1;i<points.length;i++)mctx.lineTo(points[i].x-x0,points[i].y-y0);mctx.stroke();}
  const mask=mctx.getImageData(0,0,width,height).data; const area=width*height; const known=new Uint8Array(area); const queued=new Uint8Array(area); const queue=new Int32Array(area); let head=0,tail=0,masked=0;
  for(let i=0;i<area;i++){const isMasked=mask[i*4+3]>24;if(!isMasked)known[i]=1;else masked++;}
  if(!masked)return {masked:0};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const idx=y*width+x;if(known[idx])continue;if(hasKnownNeighbor(known,width,height,x,y)){queued[idx]=1;queue[tail++]=idx;}}
  while(head<tail){const idx=queue[head++],x=idx%width,y=Math.floor(idx/width);let rr=0,gg=0,bb=0,aa=0,count=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx<0||ny<0||nx>=width||ny>=height)continue;const ni=ny*width+nx;if(!known[ni])continue;const di=ni*4;rr+=data[di];gg+=data[di+1];bb+=data[di+2];aa+=data[di+3];count++;}if(!count)continue;const di=idx*4;data[di]=rr/count;data[di+1]=gg/count;data[di+2]=bb/count;data[di+3]=aa/count;known[idx]=1;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx<0||ny<0||nx>=width||ny>=height)continue;const ni=ny*width+nx;if(!known[ni]&&!queued[ni]){queued[ni]=1;queue[tail++]=ni;}}}
  const filled=new Uint8ClampedArray(data); for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const idx=y*width+x;if(mask[idx*4+3]<=24)continue;let rr=0,gg=0,bb=0,count=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const ni=((y+oy)*width+x+ox)*4;rr+=filled[ni];gg+=filled[ni+1];bb+=filled[ni+2];count++;}const di=idx*4;data[di]=mix(filled[di],rr/count,.28);data[di+1]=mix(filled[di+1],gg/count,.28);data[di+2]=mix(filled[di+2],bb/count,.28);}
  ctx.putImageData(image,x0,y0); return {masked};
}
function hasKnownNeighbor(known,width,height,x,y){for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx>=0&&ny>=0&&nx<width&&ny<height&&known[ny*width+nx])return true;}return false;}

function render(source, crop, target, settings) {
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const mode = settings.resizeMode || 'fit';
  const outputKind = settings.format || 'png';
  if (outputKind === 'jpeg' || settings.background) {
    ctx.fillStyle = settings.background || '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
  }
  if (mode === 'fill') {
    const cover = coverRect(crop.width, crop.height, target.width, target.height);
    ctx.drawImage(source, crop.x + cover.x, crop.y + cover.y, cover.width, cover.height, 0, 0, target.width, target.height);
  } else if (mode === 'contain') {
    const scale = Math.min(target.width / crop.width, target.height / crop.height);
    const w = Math.max(1, Math.round(crop.width * scale));
    const h = Math.max(1, Math.round(crop.height * scale));
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, Math.round((target.width - w) / 2), Math.round((target.height - h) / 2), w, h);
  } else {
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
  }
  return canvas;
}

function transformCanvas(source, rotate, flipX, flipY) {
  const normalized = Number.isFinite(Number(rotate)) ? Number(rotate) : 0;
  if (normalized === 0 && !flipX && !flipY) return source;
  const radians = normalized * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians)); const sin = Math.abs(Math.sin(radians));
  const width = Math.max(1, Math.ceil(source.width * cos + source.height * sin));
  const height = Math.max(1, Math.ceil(source.width * sin + source.height * cos));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function applyAdjustments(source, edits) {
  let canvas = source;
  if (edits.blur > 0) canvas = blurCanvas(canvas, edits.blur);
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const exposure = Math.pow(2, edits.exposure);
  const brightness = 1 + edits.brightness / 100;
  const contrast = 1 + edits.contrast / 100;
  const saturation = 1 + edits.saturation / 100;
  const vibrance = edits.vibrance / 100;
  const gammaInv = 1 / edits.gamma;
  const grayMix = edits.grayscale / 100;
  const sepiaMix = edits.sepia / 100;
  const temp = edits.temperature * 0.45;
  const tint = edits.tint * 0.32;
  const shadowAmount = edits.shadows * 0.8;
  const highlightAmount = edits.highlights * 0.8;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * exposure * brightness;
    let g = data[i + 1] * exposure * brightness;
    let b = data[i + 2] * exposure * brightness;

    r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128;
    let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const shadowWeight = Math.pow(1 - clamp01(luma / 255), 2);
    const highlightWeight = Math.pow(clamp01(luma / 255), 2);
    const tone = shadowAmount * shadowWeight + highlightAmount * highlightWeight;
    r += tone; g += tone; b += tone;

    r += temp + tint * 0.35; g -= tint; b -= temp - tint * 0.35;
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * saturation; g = luma + (g - luma) * saturation; b = luma + (b - luma) * saturation;

    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const chroma = max > 0 ? (max - min) / max : 0;
    const vibFactor = 1 + vibrance * (1 - clamp01(chroma));
    r = luma + (r - luma) * vibFactor; g = luma + (g - luma) * vibFactor; b = luma + (b - luma) * vibFactor;

    r = 255 * Math.pow(clamp01(r / 255), gammaInv); g = 255 * Math.pow(clamp01(g / 255), gammaInv); b = 255 * Math.pow(clamp01(b / 255), gammaInv);
    if (grayMix > 0) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = mix(r, gray, grayMix); g = mix(g, gray, grayMix); b = mix(b, gray, grayMix);
    }
    if (sepiaMix > 0) {
      const sr = clamp255(r * .393 + g * .769 + b * .189);
      const sg = clamp255(r * .349 + g * .686 + b * .168);
      const sb = clamp255(r * .272 + g * .534 + b * .131);
      r = mix(r, sr, sepiaMix); g = mix(g, sg, sepiaMix); b = mix(b, sb, sepiaMix);
    }
    data[i] = clamp255(r); data[i + 1] = clamp255(g); data[i + 2] = clamp255(b);
  }
  if (edits.sharpen > 0) sharpenPixels(data, canvas.width, canvas.height, edits.sharpen / 100);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function blurCanvas(source, amount) {
  const scale = Math.max(0.18, 1 / (1 + amount * 0.18));
  const small = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const smallCtx = small.getContext('2d', { alpha: true }); smallCtx.imageSmoothingEnabled = true; smallCtx.imageSmoothingQuality = 'high'; smallCtx.drawImage(source, 0, 0, small.width, small.height);
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d', { alpha: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(small, 0, 0, source.width, source.height);
  return canvas;
}

function sharpenPixels(data, width, height, strength) {
  if (width < 3 || height < 3 || strength <= 0) return;
  const source = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const up = i - width * 4, down = i + width * 4, left = i - 4, right = i + 4;
      for (let c = 0; c < 3; c++) {
        const average = (source[up + c] + source[down + c] + source[left + c] + source[right + c]) / 4;
        data[i + c] = clamp255(source[i + c] + (source[i + c] - average) * strength * 1.4);
      }
    }
  }
}

function clamp255(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function mix(a, b, t) { return a + (b - a) * t; }

function renderDesignLayers(source, inputLayers) {
  const layers = normalizeLayers(inputLayers);
  if (!layers.length) return source;
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.drawImage(source, 0, 0);
  for (const layer of layers) drawLayer(ctx, canvas, layer);
  return canvas;
}

function drawLayer(ctx, canvas, layer) {
  const x = canvas.width * layer.x / 100; const y = canvas.height * layer.y / 100;
  const width = canvas.width * layer.width / 100; const height = canvas.height * layer.height / 100;
  ctx.save(); ctx.globalAlpha = layer.opacity; ctx.translate(x, y); ctx.rotate(layer.rotation * Math.PI / 180);
  if (layer.type === 'text') drawTextLayer(ctx, layer, width, height);
  else if (layer.type === 'rectangle' || layer.type === 'background') drawRectLayer(ctx, layer, width, height);
  else if (layer.type === 'circle') drawCircleLayer(ctx, layer, width, height);
  else if (layer.type === 'line' || layer.type === 'arrow') drawLineLayer(ctx, layer, width, height, layer.type === 'arrow');
  ctx.restore();
}

function layerFill(ctx, layer, width, height) {
  if (!layer.gradient) return layer.fill;
  const radians = layer.gradientAngle * Math.PI / 180; const dx = Math.cos(radians) * width / 2; const dy = Math.sin(radians) * height / 2;
  const gradient = ctx.createLinearGradient(-dx, -dy, dx, dy); gradient.addColorStop(0, layer.fill); gradient.addColorStop(1, layer.fill2); return gradient;
}

function drawRectLayer(ctx, layer, width, height) {
  ctx.fillStyle = layerFill(ctx, layer, width, height); ctx.fillRect(-width/2, -height/2, width, height);
  if (layer.strokeWidth > 0) { ctx.strokeStyle = layer.strokeColor; ctx.lineWidth = layer.strokeWidth; ctx.strokeRect(-width/2, -height/2, width, height); }
}
function drawCircleLayer(ctx, layer, width, height) {
  ctx.beginPath(); ctx.ellipse(0, 0, width/2, height/2, 0, 0, Math.PI*2); ctx.fillStyle = layerFill(ctx, layer, width, height); ctx.fill();
  if (layer.strokeWidth > 0) { ctx.strokeStyle = layer.strokeColor; ctx.lineWidth = layer.strokeWidth; ctx.stroke(); }
}
function drawLineLayer(ctx, layer, width, height, arrow) {
  const x1=-width/2, y1=-height/2, x2=width/2, y2=height/2; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.strokeStyle=layer.strokeColor; ctx.lineWidth=Math.max(1,layer.strokeWidth); ctx.lineCap='round'; ctx.stroke();
  if (arrow) { const angle=Math.atan2(y2-y1,x2-x1); const size=Math.max(8,layer.strokeWidth*3); ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x2-size*Math.cos(angle-Math.PI/6),y2-size*Math.sin(angle-Math.PI/6)); ctx.lineTo(x2-size*Math.cos(angle+Math.PI/6),y2-size*Math.sin(angle+Math.PI/6)); ctx.closePath(); ctx.fillStyle=layer.strokeColor; ctx.fill(); }
}
function drawTextLayer(ctx, layer, width, height) {
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.shadowColor = layer.shadowEnabled ? layer.shadowColor : 'rgba(0,0,0,0)'; ctx.shadowBlur = layer.shadowEnabled ? layer.shadowBlur : 0; ctx.shadowOffsetX = layer.shadowEnabled ? layer.shadowX : 0; ctx.shadowOffsetY = layer.shadowEnabled ? layer.shadowY : 0;
  const lines=String(layer.text).split(/\r?\n/); const lineHeight=layer.fontSize*layer.lineSpacing; const totalHeight=Math.max(lineHeight,lines.length*lineHeight); const top=-totalHeight/2;
  if (layer.backgroundEnabled) { ctx.save(); ctx.shadowColor='rgba(0,0,0,0)'; ctx.fillStyle=layer.backgroundColor; ctx.fillRect(-width/2-12,top-10,width+24,totalHeight+20); ctx.restore(); }
  ctx.fillStyle=layer.color; ctx.strokeStyle=layer.strokeColor; ctx.lineWidth=layer.strokeWidth*2; ctx.lineJoin='round';
  lines.forEach((line,index)=>{ const lineWidth=measureSpacedText(ctx,line,layer.letterSpacing); let start=-width/2; if(layer.align==='center') start=-lineWidth/2; if(layer.align==='right') start=width/2-lineWidth; const yy=top+index*lineHeight; if(layer.strokeWidth>0) drawSpacedText(ctx,line,start,yy,layer.letterSpacing,true); drawSpacedText(ctx,line,start,yy,layer.letterSpacing,false); });
}
function measureSpacedText(ctx,text,spacing) { if(!text) return 0; let width=0; for(let i=0;i<text.length;i++) width+=ctx.measureText(text[i]).width+(i<text.length-1?spacing:0); return width; }
function drawSpacedText(ctx,text,x,y,spacing,stroke) { let cursor=x; for(let i=0;i<text.length;i++){ const char=text[i]; if(stroke) ctx.strokeText(char,cursor,y); else ctx.fillText(char,cursor,y); cursor+=ctx.measureText(char).width+(i<text.length-1?spacing:0); } }

async function renderWatermark(source, recipe, logoBuffer) {
  if (!recipe.enabled) return source;
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d', { alpha: true }); ctx.drawImage(source,0,0);
  if (recipe.type === 'text') {
    ctx.font = `700 ${recipe.fontSize}px ${recipe.fontFamily}`; const metrics=ctx.measureText(recipe.text||''); const width=Math.max(1,metrics.width); const height=Math.max(1,recipe.fontSize*1.25);
    if(recipe.tiled) drawTiledWatermark(ctx,canvas,recipe,width,height,(x,y)=>drawTextWatermark(ctx,recipe,x,y));
    else { const p=resolveWatermarkPosition(canvas.width,canvas.height,width,height,recipe); drawTextWatermark(ctx,recipe,p.x,p.y); }
    return canvas;
  }
  const info=await inspect({buffer:logoBuffer.slice(0)}); if(info.state!=='completed'||!['jpeg','png','webp','avif'].includes(info.value.kind)) throw new Error('Invalid watermark image');
  const blob=new Blob([logoBuffer],{type:mimeFor(info.value.kind)}); const bitmap=await createImageBitmap(blob); const width=Math.max(1,canvas.width*recipe.logoWidth/100); const height=Math.max(1,width*bitmap.height/bitmap.width);
  if(recipe.tiled) drawTiledWatermark(ctx,canvas,recipe,width,height,(x,y)=>drawImageWatermark(ctx,recipe,bitmap,x,y,width,height));
  else { const p=resolveWatermarkPosition(canvas.width,canvas.height,width,height,recipe); drawImageWatermark(ctx,recipe,bitmap,p.x,p.y,width,height); }
  bitmap.close(); return canvas;
}
function drawTextWatermark(ctx,recipe,x,y){ ctx.save(); ctx.globalAlpha=recipe.opacity; ctx.translate(x,y); ctx.rotate(recipe.rotation*Math.PI/180); ctx.font=`700 ${recipe.fontSize}px ${recipe.fontFamily}`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=recipe.color; ctx.fillText(recipe.text,0,0); ctx.restore(); }
function drawImageWatermark(ctx,recipe,bitmap,x,y,width,height){ ctx.save(); ctx.globalAlpha=recipe.opacity; ctx.translate(x,y); ctx.rotate(recipe.rotation*Math.PI/180); ctx.drawImage(bitmap,-width/2,-height/2,width,height); ctx.restore(); }
function drawTiledWatermark(ctx,canvas,recipe,markWidth,markHeight,draw){ const stepX=Math.max(1,markWidth+recipe.tileGap); const stepY=Math.max(1,markHeight+recipe.tileGap); let count=0; for(let y=recipe.margin+markHeight/2;y<canvas.height-recipe.margin+markHeight/2;y+=stepY){ for(let x=recipe.margin+markWidth/2;x<canvas.width-recipe.margin+markWidth/2;x+=stepX){ draw(x,y); if(++count>=500)return; } } }

async function encode(canvas, mime, quality) {
  try {
    return await canvas.convertToBlob({ type: mime, quality });
  } catch {
    return new Blob([], { type: 'application/octet-stream' });
  }
}

async function encodeToTarget(canvas, mime, targetBytes) {
  let low = 0.05, high = 0.98, best = null, bestQuality = low;
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2;
    const blob = await encode(canvas, mime, quality);
    if (blob.type !== mime) return { blob, quality };
    if (!best || Math.abs(blob.size - targetBytes) < Math.abs(best.size - targetBytes)) { best = blob; bestQuality = quality; }
    if (blob.size > targetBytes) high = quality; else low = quality;
  }
  return { blob: best, quality: bestQuality };
}

async function createZip({ files = [] }) {
  if (!Array.isArray(files) || files.length === 0) return unsupported('No files to archive.');
  if (files.length > SECURITY_BUDGET.maxBatchFiles) return unsupported('Too many files for one archive.');
  const entries = files.map((file) => ({ name: String(file.name || 'output.bin'), data: new Uint8Array(file.buffer) }));
  let estimated = entries.reduce((n, e) => n + e.data.byteLength + e.name.length + 120, 0);
  if (estimated > SECURITY_BUDGET.maxOutputBytes * 4) return unsupported('Archive exceeds the safe output budget.');
  const zip = zipStore(entries);
  return ok({ buffer: zip.buffer, mime: 'application/zip', kind: 'zip', size: zip.byteLength });
}

function zipStore(entries) {
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true); lv.setUint32(14, crc, true); lv.setUint32(18, entry.data.length, true); lv.setUint32(22, entry.data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30); local.set(entry.data, 30 + name.length); localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46); centralParts.push(central);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, centralOffset, true); ev.setUint16(20, 0, true);
  const total = localParts.reduce((n,p)=>n+p.length,0) + centralSize + end.length;
  const out = new Uint8Array(total); let cursor = 0;
  for (const p of localParts) { out.set(p, cursor); cursor += p.length; }
  for (const p of centralParts) { out.set(p, cursor); cursor += p.length; }
  out.set(end, cursor); return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mimeFor(kind) { return ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' })[kind] || 'application/octet-stream'; }
function normalizeQuality(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0.05, Math.min(1, n)) : 0.82; }
function positiveInt(value, fallback) { const n = Math.round(Number(value)); return Number.isFinite(n) && n > 0 ? n : fallback; }
