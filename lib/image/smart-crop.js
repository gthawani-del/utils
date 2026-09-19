export function normalizeSmartRegions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0,24).map((r)=>({
    type:['face','text-like','detail'].includes(r?.type)?r.type:'detail',
    x:clamp(r?.x,0,1,0), y:clamp(r?.y,0,1,0),
    width:clamp(r?.width,.005,1,.1), height:clamp(r?.height,.005,1,.1),
    weight:clamp(r?.weight,.1,10,1)
  })).map((r)=>({...r,width:Math.min(r.width,1-r.x),height:Math.min(r.height,1-r.y)}));
}

export function chooseSmartFocus(sourceWidth, sourceHeight, targetRatio, regionsInput) {
  const regions=normalizeSmartRegions(regionsInput);
  if(!regions.length||!Number.isFinite(targetRatio)||targetRatio<=0) return {focusX:.5,focusY:.5,score:0};
  const crop=cropSize(sourceWidth,sourceHeight,targetRatio);
  const weighted=weightedCenter(regions);
  const candidates=[{x:.5,y:.5},{x:weighted.x,y:weighted.y},...regions.map((r)=>({x:r.x+r.width/2,y:r.y+r.height/2}))];
  let best={focusX:.5,focusY:.5,score:-Infinity};
  for(const c of candidates){
    const rect=cropRect(sourceWidth,sourceHeight,crop.width,crop.height,c.x,c.y);
    let score=0;
    for(const r of regions) score+=r.weight*overlapFraction(rect,regionPx(r,sourceWidth,sourceHeight));
    score-=Math.hypot(c.x-.5,c.y-.5)*.05;
    if(score>best.score) best={focusX:clamp(c.x,0,1,.5),focusY:clamp(c.y,0,1,.5),score};
  }
  return best;
}

export function detectInformationRegions(rgba,width,height) {
  if(!rgba||width<8||height<8) return [];
  const gray=new Uint8Array(width*height);
  for(let i=0,p=0;i<rgba.length;i+=4,p++) gray[p]=Math.round(.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2]);
  const regions=[],scores=[];
  const bw=Math.max(24,Math.floor(width/8)), bh=Math.max(16,Math.floor(height/12));
  for(let y=0;y<height;y+=bh){
    for(let x=0;x<width;x+=bw){
      const w=Math.min(bw,width-x),h=Math.min(bh,height-y);
      let edge=0,sum=0,sum2=0,count=0,horiz=0;
      for(let yy=y+1;yy<y+h;yy+=2) for(let xx=x+1;xx<x+w;xx+=2){
        const v=gray[yy*width+xx], left=gray[yy*width+xx-1], up=gray[(yy-1)*width+xx];
        const dx=Math.abs(v-left),dy=Math.abs(v-up); edge+=dx+dy; horiz+=dx; sum+=v;sum2+=v*v;count++;
      }
      if(!count)continue;
      const mean=sum/count, variance=Math.max(0,sum2/count-mean*mean), edgeScore=edge/count;
      scores.push({x,y,w,h,score:edgeScore+Math.sqrt(variance)*.7,horiz:horiz/count});
    }
  }
  const sorted=[...scores].sort((a,b)=>b.score-a.score);
  const detailThreshold=sorted[Math.min(sorted.length-1,Math.max(0,Math.floor(sorted.length*.25)))]?.score||Infinity;
  for(const cell of sorted){
    if(regions.filter((r)=>r.type==='detail').length>=5)break;
    if(cell.score<detailThreshold)break;
    const r=toRegion(cell,width,height,'detail',1+Math.min(2,cell.score/80));
    if(!regions.some((e)=>iou(e,r)>.45)) regions.push(r);
  }
  const textCandidates=scores.filter((c)=>c.horiz>18&&c.score>24).sort((a,b)=>b.horiz-a.horiz);
  for(const cell of textCandidates){
    if(regions.filter((r)=>r.type==='text-like').length>=4)break;
    const x=Math.max(0,cell.x-cell.w*.5), w=Math.min(width-x,cell.w*2);
    const r={type:'text-like',x:x/width,y:cell.y/height,width:w/width,height:cell.h/height,weight:2.2};
    if(!regions.some((e)=>e.type==='text-like'&&iou(e,r)>.35))regions.push(r);
  }
  return regions;
}

export function smartCropSummary(regionsInput,{faceDetectorAvailable=false}={}) {
  const regions=normalizeSmartRegions(regionsInput);
  return {
    faces:regions.filter((r)=>r.type==='face').length,
    textLike:regions.filter((r)=>r.type==='text-like').length,
    detail:regions.filter((r)=>r.type==='detail').length,
    faceDetectorAvailable
  };
}

function cropSize(sw,sh,ratio){let width=sw,height=Math.round(width/ratio);if(height>sh){height=sh;width=Math.round(height*ratio);}return{width,height};}
function cropRect(sw,sh,w,h,fx,fy){const cx=clamp(fx,0,1,.5)*sw,cy=clamp(fy,0,1,.5)*sh;return{x:clamp(cx-w/2,0,sw-w,0),y:clamp(cy-h/2,0,sh-h,0),width:w,height:h};}
function regionPx(r,sw,sh){return{x:r.x*sw,y:r.y*sh,width:r.width*sw,height:r.height*sh};}
function overlapFraction(a,b){const x=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),y=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return b.width*b.height?x*y/(b.width*b.height):0;}
function weightedCenter(regions){let sx=0,sy=0,w=0;for(const r of regions){const rw=r.weight*Math.max(.02,r.width*r.height);sx+=(r.x+r.width/2)*rw;sy+=(r.y+r.height/2)*rw;w+=rw;}return{x:w?sx/w:.5,y:w?sy/w:.5};}
function toRegion(c,w,h,type,weight){return{type,x:c.x/w,y:c.y/h,width:c.w/w,height:c.h/h,weight};}
function iou(a,b){const x=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),y=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)),inter=x*y,union=a.width*a.height+b.width*b.height-inter;return union?inter/union:0;}
function clamp(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
