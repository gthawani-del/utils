import { SECURITY_BUDGET, validateDimensions } from '../security/budget.js';
import { ok, fail, unsupported, cancelled } from '../security/result.js';
import { calculateResize, calculateCrop, coverRect } from './math.js';
import { normalizeEdits, hasPixelEdits } from './edits.js';
import { normalizeLayers } from './layers.js';
import { normalizeWatermark, resolveWatermarkPosition } from './watermark.js';
import { normalizeCleanup, cleanupHasMask } from './cleanup.js';
import { replacementsToCleanup } from './text-replace.js';
import { PERFORMANCE_FORMATS, normalizePerformanceBudget, performanceCandidateWidths, chooseBudgetCandidate } from './performance.js';

export function shouldUseBrowserProcessor({
  userAgent = globalThis.navigator?.userAgent || '',
  platform = globalThis.navigator?.platform || '',
  maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0,
  search = globalThis.location?.search || ''
} = {}) {
  const forced = new URLSearchParams(search).has('browserCanvas');
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && Number(maxTouchPoints) > 1);
  return forced || ios;
}

export async function processBrowserImage(file, settings = {}, { preview = false, watermarkLogoFile = null, signal } = {}) {
  if (signal?.aborted) return cancelled();
  try {
    const image = await decodeFile(file, signal);
    if (!image) return fail('The image could not be decoded in compatibility mode.');
    let source = imageToCanvas(image);
    const sourceCheck = validateDimensions(source.width, source.height);
    if (!sourceCheck.ok) return unsupported(sourceCheck.reason, 'RESOURCE_LIMIT');

    const cleanup = normalizeCleanup(settings.cleanup);
    if (cleanupHasMask(cleanup)) {
      if (source.width * source.height > 30_000_000) return unsupported('Cleanup is limited to 30 megapixels. Resize first.', 'CLEANUP_RESOURCE_LIMIT');
      const cleaned = applyCleanup(source, cleanup);
      if (cleaned.error) return unsupported(cleaned.error, 'CLEANUP_LIMIT');
      source = cleaned.canvas;
    }

    const crop = calculateCrop(source.width, source.height, settings.crop);
    const mode = settings.resizeMode || 'fit';
    let target = (mode === 'fill' || mode === 'contain')
      ? { width: positiveInt(settings.width, crop.width), height: positiveInt(settings.height, crop.height) }
      : calculateResize(crop.width, crop.height, settings);
    if (preview && Number(settings.previewMaxEdge) > 0) {
      const edge = Number(settings.previewMaxEdge);
      const scale = Math.min(1, edge / Math.max(target.width, target.height));
      target = { width: Math.max(1, Math.round(target.width * scale)), height: Math.max(1, Math.round(target.height * scale)) };
    }
    const targetCheck = validateDimensions(target.width, target.height);
    if (!targetCheck.ok) return unsupported(targetCheck.reason, 'RESOURCE_LIMIT');

    const edits = normalizeEdits(settings.edits);
    if (hasPixelEdits(edits) && target.width * target.height > 24_000_000) return unsupported('Detailed edits are limited to 24 megapixels. Resize first.', 'EDIT_RESOURCE_LIMIT');

    let canvas = render(source, crop, target, settings);
    if (hasPixelEdits(edits)) canvas = applyAdjustments(canvas, edits);
    canvas = transformCanvas(canvas, (Number(settings.rotate) || 0) + edits.straighten, Boolean(settings.flipX), Boolean(settings.flipY));

    const replacementCleanup = normalizeCleanup(replacementsToCleanup(settings.textReplacements));
    if (cleanupHasMask(replacementCleanup)) {
      const replaced = applyCleanup(canvas, replacementCleanup);
      if (replaced.error) return unsupported(replaced.error, 'TEXT_REPLACE_LIMIT');
      canvas = replaced.canvas;
    }

    canvas = renderDesignLayers(canvas, settings.layers);
    const watermark = normalizeWatermark(settings.watermark);
    if (watermark.enabled) {
      if (watermark.type === 'image' && !watermarkLogoFile) return unsupported('Select a watermark logo/image before processing.', 'WATERMARK_IMAGE_REQUIRED');
      canvas = await renderWatermark(canvas, watermark, watermarkLogoFile, signal);
    }

    const outputKind = preview ? 'png' : (settings.format || kindFromMime(file.type));
    if (!['jpeg','png','webp','avif'].includes(outputKind)) return unsupported('That output format is not available.');
    const mime = mimeFor(outputKind);
    const targetBytes = preview ? 0 : Math.max(0, Number(settings.targetBytes) || 0);
    let encoded, usedQuality = normalizeQuality(settings.quality);
    if (targetBytes > 0) {
      if (outputKind === 'png') return unsupported('Target-size compression is not reliable for PNG. Choose JPEG, WebP, or AVIF.');
      ({ blob: encoded, quality: usedQuality } = await encodeToTarget(canvas, mime, targetBytes));
    } else encoded = await encode(canvas, mime, usedQuality);
    if (!encoded || encoded.type !== mime) return unsupported(`${outputKind.toUpperCase()} encoding is not supported by this browser.`, 'ENCODER_UNAVAILABLE');
    if (encoded.size > SECURITY_BUDGET.maxOutputBytes) return unsupported('Output exceeds the safe output-size limit.', 'RESOURCE_LIMIT');
    const buffer = await encoded.arrayBuffer();
    return ok({ buffer, mime, kind: outputKind, width: canvas.width, height: canvas.height, size: buffer.byteLength, quality: usedQuality, metadataStripped: true });
  } catch (error) {
    if (signal?.aborted) return cancelled();
    return fail('Compatibility renderer could not process this image safely.');
  }
}

export async function optimizeBrowserImage(file, settings = {}, options = {}) {
  const budget = normalizePerformanceBudget(settings.performanceBudget);
  const image = await decodeFile(file, options.signal);
  if (!image) return fail('The image could not be decoded in compatibility mode.');
  const crop = calculateCrop(image.naturalWidth || image.width, image.naturalHeight || image.height, settings.crop);
  const mode = settings.resizeMode || 'fit';
  const intended = (mode === 'fill' || mode === 'contain')
    ? { width: positiveInt(settings.width, crop.width), height: positiveInt(settings.height, crop.height) }
    : calculateResize(crop.width, crop.height, settings);
  const startWidth = Math.min(intended.width, crop.width, budget.maxWidth);
  const aspect = Math.max(.0001, intended.width / Math.max(1, intended.height));
  let attempts = 0;
  for (const width of performanceCandidateWidths(startWidth)) {
    const height = Math.max(1, Math.round(width / aspect));
    const candidates = [];
    for (const format of PERFORMANCE_FORMATS) {
      attempts++;
      const candidateSettings = { ...settings, resizeMode: mode === 'contain' ? 'contain' : mode === 'fill' ? 'fill' : 'fit', width, height, preserveAspect: true, format, targetBytes: budget.maxBytes, quality: .98, performanceBudget: undefined };
      const result = await processBrowserImage(file, candidateSettings, options);
      if (result.state === 'completed') candidates.push(result.value);
    }
    const best = chooseBudgetCandidate(candidates, budget);
    if (best) return ok({ ...best, performance: { maxWidth: budget.maxWidth, maxBytes: budget.maxBytes, minQuality: budget.minQuality, attempts, testedFormats: [...PERFORMANCE_FORMATS] } });
  }
  return unsupported(`No AVIF, WebP or JPEG candidate met ${budget.maxWidth}px / ${Math.round(budget.maxBytes/1024)} KB above ${Math.round(budget.minQuality*100)}% quality.`, 'PERFORMANCE_BUDGET_UNMET');
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function decodeFile(file, signal) {
  if (signal?.aborted) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      img.onload = () => { signal?.removeEventListener('abort', abort); resolve(); };
      img.onerror = () => { signal?.removeEventListener('abort', abort); reject(new Error('decode')); };
      img.src = url;
    });
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function imageToCanvas(image) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const canvas = makeCanvas(width, height); canvas.getContext('2d', { alpha: true }).drawImage(image, 0, 0, width, height); return canvas;
}

function render(source, crop, target, settings) {
  const canvas = makeCanvas(target.width, target.height), ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const mode = settings.resizeMode || 'fit';
  if ((settings.format || 'png') === 'jpeg') { ctx.fillStyle = settings.background || '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
  if (mode === 'fill') {
    const cover = coverRect(crop.width, crop.height, target.width, target.height, settings.smartCrop?.focusX, settings.smartCrop?.focusY);
    ctx.drawImage(source, crop.x + cover.x, crop.y + cover.y, cover.width, cover.height, 0, 0, target.width, target.height);
  } else if (mode === 'contain') {
    const scale = Math.min(target.width/crop.width, target.height/crop.height), w=Math.max(1,Math.round(crop.width*scale)), h=Math.max(1,Math.round(crop.height*scale));
    ctx.drawImage(source,crop.x,crop.y,crop.width,crop.height,Math.round((target.width-w)/2),Math.round((target.height-h)/2),w,h);
  } else ctx.drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,target.width,target.height);
  return canvas;
}

function transformCanvas(source, rotate, flipX, flipY) {
  const degrees = Number.isFinite(Number(rotate)) ? Number(rotate) : 0;
  if (!degrees && !flipX && !flipY) return source;
  const radians=degrees*Math.PI/180, cos=Math.abs(Math.cos(radians)), sin=Math.abs(Math.sin(radians));
  const width=Math.max(1,Math.ceil(source.width*cos+source.height*sin)), height=Math.max(1,Math.ceil(source.width*sin+source.height*cos));
  const canvas=makeCanvas(width,height),ctx=canvas.getContext('2d',{alpha:true});
  ctx.translate(width/2,height/2);ctx.rotate(radians);ctx.scale(flipX?-1:1,flipY?-1:1);ctx.drawImage(source,-source.width/2,-source.height/2);return canvas;
}

function applyAdjustments(source, edits) {
  let canvas=source;
  if(edits.blur>0) canvas=blurCanvas(canvas,edits.blur);
  const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true}), image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data;
  const exposure=Math.pow(2,edits.exposure),brightness=1+edits.brightness/100,contrast=1+edits.contrast/100,saturation=1+edits.saturation/100,vibrance=edits.vibrance/100,gammaInv=1/edits.gamma,grayMix=edits.grayscale/100,sepiaMix=edits.sepia/100,temp=edits.temperature*.45,tint=edits.tint*.32,shadowAmount=edits.shadows*.8,highlightAmount=edits.highlights*.8;
  for(let i=0;i<data.length;i+=4){
    let r=data[i]*exposure*brightness,g=data[i+1]*exposure*brightness,b=data[i+2]*exposure*brightness;
    r=(r-128)*contrast+128;g=(g-128)*contrast+128;b=(b-128)*contrast+128;
    let l=.2126*r+.7152*g+.0722*b, sw=Math.pow(1-clamp01(l/255),2), hw=Math.pow(clamp01(l/255),2), tone=shadowAmount*sw+highlightAmount*hw;
    r+=tone+temp+tint*.35;g+=tone-tint;b+=tone-temp+tint*.35;l=.2126*r+.7152*g+.0722*b;
    r=l+(r-l)*saturation;g=l+(g-l)*saturation;b=l+(b-l)*saturation;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max>0?(max-min)/max:0,vf=1+vibrance*(1-clamp01(chroma));
    r=l+(r-l)*vf;g=l+(g-l)*vf;b=l+(b-l)*vf;
    r=255*Math.pow(clamp01(r/255),gammaInv);g=255*Math.pow(clamp01(g/255),gammaInv);b=255*Math.pow(clamp01(b/255),gammaInv);
    if(grayMix>0){const gray=.2126*r+.7152*g+.0722*b;r=mix(r,gray,grayMix);g=mix(g,gray,grayMix);b=mix(b,gray,grayMix);}
    if(sepiaMix>0){const sr=clamp255(r*.393+g*.769+b*.189),sg=clamp255(r*.349+g*.686+b*.168),sb=clamp255(r*.272+g*.534+b*.131);r=mix(r,sr,sepiaMix);g=mix(g,sg,sepiaMix);b=mix(b,sb,sepiaMix);}
    data[i]=clamp255(r);data[i+1]=clamp255(g);data[i+2]=clamp255(b);
  }
  if(edits.sharpen>0) sharpenPixels(data,canvas.width,canvas.height,edits.sharpen/100);
  ctx.putImageData(image,0,0);return canvas;
}

function blurCanvas(source, amount){const scale=Math.max(.18,1/(1+amount*.18)),small=makeCanvas(source.width*scale,source.height*scale),sctx=small.getContext('2d',{alpha:true});sctx.imageSmoothingEnabled=true;sctx.imageSmoothingQuality='high';sctx.drawImage(source,0,0,small.width,small.height);const canvas=makeCanvas(source.width,source.height),ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(small,0,0,canvas.width,canvas.height);return canvas;}
function sharpenPixels(data,width,height,strength){if(width<3||height<3||strength<=0)return;const source=new Uint8ClampedArray(data);for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=(y*width+x)*4,up=i-width*4,down=i+width*4,left=i-4,right=i+4;for(let c=0;c<3;c++){const avg=(source[up+c]+source[down+c]+source[left+c]+source[right+c])/4;data[i+c]=clamp255(source[i+c]+(source[i+c]-avg)*strength*1.4);}}}

function applyCleanup(source, cleanup){
  const canvas=makeCanvas(source.width,source.height),ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true});ctx.drawImage(source,0,0);let selected=0;
  for(const stroke of cleanup.strokes){const result=inpaintStroke(ctx,canvas.width,canvas.height,stroke);if(result.error)return{error:result.error};selected+=result.masked;if(selected>canvas.width*canvas.height*.2)return{error:'Cleanup mask is too large. Use smaller areas.'};}
  return{canvas};
}
function inpaintStroke(ctx,cw,ch,stroke){
  const radius=Math.max(1,stroke.radius*Math.min(cw,ch)),pts=stroke.points.map(p=>({x:p.x*cw,y:p.y*ch}));if(!pts.length)return{masked:0};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const pad=radius+4,x0=Math.max(0,Math.floor(minX-pad)),y0=Math.max(0,Math.floor(minY-pad)),x1=Math.min(cw,Math.ceil(maxX+pad)),y1=Math.min(ch,Math.ceil(maxY+pad)),w=x1-x0,h=y1-y0;
  if(w<=0||h<=0)return{masked:0};if(w*h>4_000_000)return{error:'One cleanup stroke covers too large an area.'};
  const image=ctx.getImageData(x0,y0,w,h),data=image.data,maskCanvas=makeCanvas(w,h),mctx=maskCanvas.getContext('2d',{alpha:true});mctx.strokeStyle='#fff';mctx.fillStyle='#fff';mctx.lineCap='round';mctx.lineJoin='round';mctx.lineWidth=radius*2;
  if(pts.length===1){mctx.beginPath();mctx.arc(pts[0].x-x0,pts[0].y-y0,radius,0,Math.PI*2);mctx.fill();}else{mctx.beginPath();mctx.moveTo(pts[0].x-x0,pts[0].y-y0);for(let i=1;i<pts.length;i++)mctx.lineTo(pts[i].x-x0,pts[i].y-y0);mctx.stroke();}
  const mask=mctx.getImageData(0,0,w,h).data,area=w*h,known=new Uint8Array(area),queued=new Uint8Array(area),queue=new Int32Array(area);let head=0,tail=0,masked=0;
  for(let i=0;i<area;i++){const m=mask[i*4+3]>24;if(!m)known[i]=1;else masked++;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const idx=y*w+x;if(!known[idx]&&hasKnownNeighbor(known,w,h,x,y)){queued[idx]=1;queue[tail++]=idx;}}
  while(head<tail){const idx=queue[head++],x=idx%w,y=Math.floor(idx/w);let r=0,g=0,b=0,a=0,count=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(!known[ni])continue;const di=ni*4;r+=data[di];g+=data[di+1];b+=data[di+2];a+=data[di+3];count++;}if(!count)continue;const di=idx*4;data[di]=r/count;data[di+1]=g/count;data[di+2]=b/count;data[di+3]=a/count;known[idx]=1;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx>=0&&ny>=0&&nx<w&&ny<h){const ni=ny*w+nx;if(!known[ni]&&!queued[ni]){queued[ni]=1;queue[tail++]=ni;}}}}
  ctx.putImageData(image,x0,y0);return{masked};
}
function hasKnownNeighbor(known,w,h,x,y){for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx>=0&&ny>=0&&nx<w&&ny<h&&known[ny*w+nx])return true;}return false;}

function renderDesignLayers(source,input){
  const layers=normalizeLayers(input);if(!layers.length)return source;const canvas=makeCanvas(source.width,source.height),ctx=canvas.getContext('2d',{alpha:true});ctx.drawImage(source,0,0);
  for(const layer of layers) drawLayer(ctx,canvas,layer);return canvas;
}
function drawLayer(ctx,canvas,layer){const x=canvas.width*layer.x/100,y=canvas.height*layer.y/100,w=canvas.width*layer.width/100,h=canvas.height*layer.height/100;ctx.save();ctx.globalAlpha=layer.opacity;ctx.translate(x,y);ctx.rotate(layer.rotation*Math.PI/180);if(layer.type==='text')drawTextLayer(ctx,layer,w,h);else if(layer.type==='rectangle'||layer.type==='background')drawRectLayer(ctx,layer,w,h);else if(layer.type==='circle')drawCircleLayer(ctx,layer,w,h);else drawLineLayer(ctx,layer,w,h,layer.type==='arrow');ctx.restore();}
function layerFill(ctx,layer,w,h){if(!layer.gradient)return layer.fill;const rad=layer.gradientAngle*Math.PI/180,dx=Math.cos(rad)*w/2,dy=Math.sin(rad)*h/2,g=ctx.createLinearGradient(-dx,-dy,dx,dy);g.addColorStop(0,layer.fill);g.addColorStop(1,layer.fill2);return g;}
function drawRectLayer(ctx,l,w,h){ctx.fillStyle=layerFill(ctx,l,w,h);ctx.fillRect(-w/2,-h/2,w,h);if(l.strokeWidth>0){ctx.strokeStyle=l.strokeColor;ctx.lineWidth=l.strokeWidth;ctx.strokeRect(-w/2,-h/2,w,h);}}
function drawCircleLayer(ctx,l,w,h){ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fillStyle=layerFill(ctx,l,w,h);ctx.fill();if(l.strokeWidth>0){ctx.strokeStyle=l.strokeColor;ctx.lineWidth=l.strokeWidth;ctx.stroke();}}
function drawLineLayer(ctx,l,w,h,arrow){const x1=-w/2,y1=-h/2,x2=w/2,y2=h/2;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=l.strokeColor;ctx.lineWidth=Math.max(1,l.strokeWidth);ctx.stroke();if(arrow){const angle=Math.atan2(y2-y1,x2-x1),size=Math.max(8,l.strokeWidth*3);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-size*Math.cos(angle-Math.PI/6),y2-size*Math.sin(angle-Math.PI/6));ctx.lineTo(x2-size*Math.cos(angle+Math.PI/6),y2-size*Math.sin(angle+Math.PI/6));ctx.closePath();ctx.fillStyle=l.strokeColor;ctx.fill();}}
function drawTextLayer(ctx,l,w,h){ctx.font=`${l.fontWeight} ${l.fontSize}px ${l.fontFamily}`;ctx.textBaseline='top';ctx.shadowColor=l.shadowEnabled?l.shadowColor:'rgba(0,0,0,0)';ctx.shadowBlur=l.shadowEnabled?l.shadowBlur:0;ctx.shadowOffsetX=l.shadowEnabled?l.shadowX:0;ctx.shadowOffsetY=l.shadowEnabled?l.shadowY:0;const lines=String(l.text).split(/\r?\n/),lh=l.fontSize*l.lineSpacing,total=Math.max(lh,lines.length*lh),top=-total/2;if(l.backgroundEnabled){ctx.save();ctx.shadowColor='rgba(0,0,0,0)';ctx.fillStyle=l.backgroundColor;ctx.fillRect(-w/2-12,top-10,w+24,total+20);ctx.restore();}ctx.fillStyle=l.color;ctx.strokeStyle=l.strokeColor;ctx.lineWidth=l.strokeWidth*2;lines.forEach((line,index)=>{const tw=measureText(ctx,line,l.letterSpacing);let start=-w/2;if(l.align==='center')start=-tw/2;if(l.align==='right')start=w/2-tw;const yy=top+index*lh;if(l.strokeWidth>0)drawSpaced(ctx,line,start,yy,l.letterSpacing,true);drawSpaced(ctx,line,start,yy,l.letterSpacing,false);});}
function measureText(ctx,text,spacing){let w=0;for(let i=0;i<text.length;i++)w+=ctx.measureText(text[i]).width+(i<text.length-1?spacing:0);return w;}
function drawSpaced(ctx,text,x,y,spacing,stroke){let cursor=x;for(let i=0;i<text.length;i++){const ch=text[i];if(stroke)ctx.strokeText(ch,cursor,y);else ctx.fillText(ch,cursor,y);cursor+=ctx.measureText(ch).width+(i<text.length-1?spacing:0);}}

async function renderWatermark(source,recipe,logoFile,signal){
  const canvas=makeCanvas(source.width,source.height),ctx=canvas.getContext('2d',{alpha:true});ctx.drawImage(source,0,0);
  if(recipe.type==='text'){ctx.font=`700 ${recipe.fontSize}px ${recipe.fontFamily}`;const w=Math.max(1,ctx.measureText(recipe.text||'').width),h=Math.max(1,recipe.fontSize*1.25);if(recipe.tiled)drawTiled(ctx,canvas,recipe,w,h,(x,y)=>drawTextMark(ctx,recipe,x,y));else{const p=resolveWatermarkPosition(canvas.width,canvas.height,w,h,recipe);drawTextMark(ctx,recipe,p.x,p.y);}return canvas;}
  const logo=await decodeFile(logoFile,signal),w=Math.max(1,canvas.width*recipe.logoWidth/100),h=Math.max(1,w*(logo.naturalHeight||logo.height)/(logo.naturalWidth||logo.width));if(recipe.tiled)drawTiled(ctx,canvas,recipe,w,h,(x,y)=>drawImageMark(ctx,recipe,logo,x,y,w,h));else{const p=resolveWatermarkPosition(canvas.width,canvas.height,w,h,recipe);drawImageMark(ctx,recipe,logo,p.x,p.y,w,h);}return canvas;
}
function drawTextMark(ctx,r,x,y){ctx.save();ctx.globalAlpha=r.opacity;ctx.translate(x,y);ctx.rotate(r.rotation*Math.PI/180);ctx.font=`700 ${r.fontSize}px ${r.fontFamily}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=r.color;ctx.fillText(r.text,0,0);ctx.restore();}
function drawImageMark(ctx,r,img,x,y,w,h){ctx.save();ctx.globalAlpha=r.opacity;ctx.translate(x,y);ctx.rotate(r.rotation*Math.PI/180);ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();}
function drawTiled(ctx,canvas,r,w,h,draw){const sx=Math.max(1,w+r.tileGap),sy=Math.max(1,h+r.tileGap);let count=0;for(let y=r.margin+h/2;y<canvas.height-r.margin+h/2;y+=sy)for(let x=r.margin+w/2;x<canvas.width-r.margin+w/2;x+=sx){draw(x,y);if(++count>=500)return;}}

function encode(canvas,mime,quality){return new Promise(resolve=>canvas.toBlob(resolve,mime,quality));}
async function encodeToTarget(canvas,mime,targetBytes){let low=.05,high=.98,best=null,bq=0,nearest=null,nq=low;for(let i=0;i<8;i++){const q=(low+high)/2,blob=await encode(canvas,mime,q);if(!blob)return{blob:null,quality:q};if(blob.type!==mime)return{blob,quality:q};if(!nearest||Math.abs(blob.size-targetBytes)<Math.abs(nearest.size-targetBytes)){nearest=blob;nq=q;}if(blob.size<=targetBytes){if(!best||q>bq){best=blob;bq=q;}low=q;}else high=q;}return best?{blob:best,quality:bq}:{blob:nearest,quality:nq};}
function mimeFor(kind){return({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'})[kind]||'application/octet-stream';}
function kindFromMime(mime){return mime==='image/jpeg'?'jpeg':mime==='image/webp'?'webp':mime==='image/avif'?'avif':'png';}
function normalizeQuality(v){const n=Number(v);return Number.isFinite(n)?Math.max(.05,Math.min(1,n)):.82;}
function positiveInt(v,f){const n=Math.round(Number(v));return Number.isFinite(n)&&n>0?n:f;}
function clamp255(v){return Math.max(0,Math.min(255,Math.round(v)));}
function clamp01(v){return Math.max(0,Math.min(1,v));}
function mix(a,b,t){return a+(b-a)*t;}
