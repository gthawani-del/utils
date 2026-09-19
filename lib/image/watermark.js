const POSITIONS = new Set(['top-left','top-center','top-right','center','bottom-left','bottom-center','bottom-right','custom']);
const FONTS = new Set(['system-ui','sans-serif','serif','monospace']);
export const DEFAULT_WATERMARK = Object.freeze({ enabled:false,type:'text',text:'© Utility OS',fontFamily:'system-ui',fontSize:48,color:'#ffffff',logoWidth:18,position:'bottom-right',x:50,y:50,opacity:.35,rotation:0,tiled:false,margin:32,tileGap:140 });

export function normalizeWatermark(input={}) {
  return {
    enabled:Boolean(input.enabled), type:input.type==='image'?'image':'text', text:String(input.text ?? DEFAULT_WATERMARK.text).slice(0,160),
    fontFamily:FONTS.has(input.fontFamily)?input.fontFamily:'system-ui', fontSize:clamp(input.fontSize,8,400,48), color:safeColor(input.color,'#ffffff'), logoWidth:clamp(input.logoWidth,1,90,18),
    position:POSITIONS.has(input.position)?input.position:'bottom-right', x:clamp(input.x,0,100,50), y:clamp(input.y,0,100,50), opacity:clamp(input.opacity,0.01,1,.35), rotation:clamp(input.rotation,-180,180,0),
    tiled:Boolean(input.tiled), margin:clamp(input.margin,0,500,32), tileGap:clamp(input.tileGap,10,1000,140)
  };
}

export function resolveWatermarkPosition(canvasWidth,canvasHeight,markWidth,markHeight,input={}) {
  const r=normalizeWatermark(input); if(r.position==='custom') return {x:canvasWidth*r.x/100,y:canvasHeight*r.y/100};
  const left=r.margin+markWidth/2, right=canvasWidth-r.margin-markWidth/2, top=r.margin+markHeight/2, bottom=canvasHeight-r.margin-markHeight/2, cx=canvasWidth/2, cy=canvasHeight/2;
  return ({'top-left':{x:left,y:top},'top-center':{x:cx,y:top},'top-right':{x:right,y:top},center:{x:cx,y:cy},'bottom-left':{x:left,y:bottom},'bottom-center':{x:cx,y:bottom},'bottom-right':{x:right,y:bottom}})[r.position];
}
function safeColor(value,fallback){const text=String(value||'');return /^#[0-9a-f]{6}$/i.test(text)?text:fallback;}
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
