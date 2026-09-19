export const RESPONSIVE_WIDTHS = Object.freeze([320,640,960,1280,1920]);
export const RESPONSIVE_FORMATS = Object.freeze(['avif','webp','jpeg']);

export function normalizeResponsiveWidths(input, sourceWidth = Infinity, allowUpscale = false) {
  const max = Number.isFinite(Number(sourceWidth)) && Number(sourceWidth) > 0 ? Math.round(Number(sourceWidth)) : Infinity;
  const values = (Array.isArray(input) ? input : []).map(Number).filter((n)=>Number.isFinite(n)&&n>=64&&n<=12000).map(Math.round);
  const unique=[...new Set(values)].sort((a,b)=>a-b);
  return allowUpscale ? unique : unique.filter((w)=>w<=max);
}

export function buildResponsiveVariants({ aspect = 1, widths = RESPONSIVE_WIDTHS, formats = RESPONSIVE_FORMATS, sourceWidth = Infinity, allowUpscale = false } = {}) {
  const safeAspect=Number.isFinite(Number(aspect))&&Number(aspect)>0?Number(aspect):1;
  const safeWidths=normalizeResponsiveWidths(widths,sourceWidth,allowUpscale);
  const safeFormats=[...new Set((Array.isArray(formats)?formats:[]).filter((f)=>RESPONSIVE_FORMATS.includes(f)))];
  return safeWidths.flatMap((width)=>safeFormats.map((format)=>({width,height:Math.max(1,Math.round(width/safeAspect)),format})));
}

export function buildSrcset(variants, format) {
  return variants.filter((v)=>v.format===format&&v.name).sort((a,b)=>a.width-b.width).map((v)=>`${v.name} ${v.width}w`).join(', ');
}

export function buildPictureMarkup(variantsInput,{alt='',sizes='100vw'}={}) {
  const variants=Array.isArray(variantsInput)?variantsInput.filter((v)=>v?.name&&v?.width&&v?.height):[];
  if(!variants.length)return '';
  const lines=['<picture>'];
  for(const format of ['avif','webp']){
    const srcset=buildSrcset(variants,format);
    if(srcset) lines.push(`  <source type="image/${format}" srcset="${escapeAttr(srcset)}" sizes="${escapeAttr(sizes)}">`);
  }
  const fallbackFormat=variants.some((v)=>v.format==='jpeg')?'jpeg':variants.some((v)=>v.format==='webp')?'webp':'avif';
  const fallback=variants.filter((v)=>v.format===fallbackFormat).sort((a,b)=>b.width-a.width)[0];
  const srcset=buildSrcset(variants,fallbackFormat);
  const type=fallbackFormat==='jpeg'?'jpg':fallbackFormat;
  lines.push(`  <img src="${escapeAttr(fallback.name)}" srcset="${escapeAttr(srcset)}" sizes="${escapeAttr(sizes)}" width="${fallback.width}" height="${fallback.height}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`);
  lines.push('</picture>');
  return lines.join('\n');
}

function escapeAttr(value){return String(value??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
