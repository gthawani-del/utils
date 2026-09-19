export function detectWatermarkRegions(rgba,width,height,{maxRegions=3}={}) {
  if(!rgba||width<24||height<24)return [];
  const gray=new Uint8Array(width*height),chroma=new Uint8Array(width*height);
  for(let i=0,p=0;i<rgba.length;i+=4,p++){
    const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    gray[p]=Math.round(.2126*r+.7152*g+.0722*b);
    chroma[p]=Math.max(r,g,b)-Math.min(r,g,b);
  }

  const cols=28,rows=Math.max(14,Math.round(cols*height/width));
  const cw=Math.max(8,Math.ceil(width/cols)),ch=Math.max(8,Math.ceil(height/rows));
  const cells=[];
  for(let gy=0,y=0;y<height;gy++,y+=ch){
    for(let gx=0,x=0;x<width;gx++,x+=cw){
      const w=Math.min(cw,width-x),h=Math.min(ch,height-y);
      let edges=0,achro=0,count=0,gradSum=0;
      for(let yy=y+1;yy<y+h;yy+=2){
        for(let xx=x+1;xx<x+w;xx+=2){
          const p=yy*width+xx,v=gray[p],dx=Math.abs(v-gray[p-1]),dy=Math.abs(v-gray[p-width]),grad=dx+dy;
          if(grad>46)edges++;
          if(chroma[p]<30)achro++;
          gradSum+=grad;count++;
        }
      }
      if(!count)continue;
      const edgeDensity=edges/count,achroRatio=achro/count,meanGrad=gradSum/count;
      // Watermark/logo glyphs tend to be relatively achromatic and edge-dense.
      const localScore=edgeDensity*(.45+.95*achroRatio)+Math.min(.05,meanGrad/1600);
      cells.push({gx,gy,x,y,w,h,localScore,edgeDensity,achroRatio});
    }
  }
  if(!cells.length)return [];

  const sorted=[...cells].sort((a,b)=>b.localScore-a.localScore);
  const cutoff=Math.max(.115,sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.07))]?.localScore||.115);
  const picked=new Map(
    cells
      .filter((c)=>c.localScore>=cutoff&&c.edgeDensity>.06&&c.achroRatio>.42)
      .map((c)=>[key(c.gx,c.gy),c])
  );

  const groups=[];
  while(picked.size){
    const first=picked.values().next().value;
    const stack=[first];picked.delete(key(first.gx,first.gy));
    const group=[];
    while(stack.length){
      const c=stack.pop();group.push(c);
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
        if(!xx&&!yy)continue;
        const k=key(c.gx+xx,c.gy+yy),n=picked.get(k);
        if(n){picked.delete(k);stack.push(n);}
      }
    }
    groups.push(group);
  }

  let boxes=groups.map((group)=>{
    const x=Math.min(...group.map((c)=>c.x)),y=Math.min(...group.map((c)=>c.y));
    const x2=Math.max(...group.map((c)=>c.x+c.w)),y2=Math.max(...group.map((c)=>c.y+c.h));
    const score=group.reduce((s,c)=>s+c.localScore,0)/group.length;
    const achro=group.reduce((s,c)=>s+c.achroRatio,0)/group.length;
    const edge=group.reduce((s,c)=>s+c.edgeDensity,0)/group.length;
    const box={x:x/width,y:y/height,width:(x2-x)/width,height:(y2-y)/height,score,achro,edge,cells:group.length};
    return {...box,confidence:watermarkConfidence(box)};
  }).filter((b)=>{
    const area=b.width*b.height,aspect=b.width/Math.max(.001,b.height);
    return area>=.001&&area<=.16&&aspect>=.22&&aspect<=12&&b.cells>=1&&b.achro>.45;
  });

  boxes=mergeNearby(boxes)
    .map((b)=>({...b,confidence:watermarkConfidence(b)}))
    .sort((a,b)=>b.confidence-a.confidence);

  if(!boxes.length)return [];

  // Precision-first pruning: one strong candidate is preferable to masking unrelated detail.
  const top=boxes[0];
  const kept=[top];
  for(let i=1;i<boxes.length&&kept.length<maxRegions;i++){
    const candidate=boxes[i];
    const comparable=candidate.confidence>=top.confidence*.90;
    const bothVeryStrong=top.confidence>=.24&&candidate.confidence>=.24;
    if(comparable&&bothVeryStrong)kept.push(candidate);
  }

  return kept.map(({x,y,width:boxWidth,height:boxHeight,confidence})=>({
    x:clamp(x-.006,0,1),y:clamp(y-.006,0,1),
    width:clamp(boxWidth+.012,.01,1-x),height:clamp(boxHeight+.012,.01,1-y),
    score:confidence
  }));
}

export function boxesToCleanupStrokes(boxes,{maxStrokes=80}={}) {
  const out=[];
  for(const box of Array.isArray(boxes)?boxes:[]){
    const x=clamp(box.x,0,1),y=clamp(box.y,0,1),w=clamp(box.width,.005,1-x),h=clamp(box.height,.005,1-y);
    const radius=clamp(Math.min(.035,Math.max(.007,h/8)),.005,.05);
    const step=Math.max(radius*1.45,.008);
    const inset=Math.min(radius*.5,w*.1);
    for(let cy=y+radius;cy<=y+h-radius/2&&out.length<maxStrokes;cy+=step){
      out.push({radius,points:[{x:clamp(x+inset,0,1),y:clamp(cy,0,1)},{x:clamp(x+w-inset,0,1),y:clamp(cy,0,1)}]});
    }
    if(out.length>=maxStrokes)break;
  }
  return out;
}

function watermarkConfidence(box){
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  const cornerDistance=Math.min(
    Math.hypot(cx,cy),Math.hypot(1-cx,cy),
    Math.hypot(cx,1-cy),Math.hypot(1-cx,1-cy)
  );
  const cornerBoost=1+Math.max(0,.34-cornerDistance)*2.6;
  const area=box.width*box.height;
  const compactBoost=area<.035?1.18:area<.08?1:Math.max(.55,1-(area-.08)*4);
  const achroBoost=.65+Math.min(1,box.achro||0)*.75;
  const edgeBoost=.78+Math.min(.55,(box.edge||0)*1.8);
  return box.score*cornerBoost*compactBoost*achroBoost*edgeBoost;
}

function mergeNearby(boxes){
  const list=[...boxes];let changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      if(near(list[i],list[j])){
        const a=list[i],b=list[j],x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),x2=Math.max(a.x+a.width,b.x+b.width),y2=Math.max(a.y+a.height,b.y+b.height);
        const cells=(a.cells||1)+(b.cells||1);
        list.splice(j,1);
        list[i]={
          x,y,width:x2-x,height:y2-y,
          score:(a.score*(a.cells||1)+b.score*(b.cells||1))/cells,
          achro:(a.achro*(a.cells||1)+b.achro*(b.cells||1))/cells,
          edge:(a.edge*(a.cells||1)+b.edge*(b.cells||1))/cells,
          cells
        };
        changed=true;break outer;
      }
    }
  }
  return list;
}
function near(a,b){
  const gapX=Math.max(0,Math.max(a.x,b.x)-Math.min(a.x+a.width,b.x+b.width));
  const gapY=Math.max(0,Math.max(a.y,b.y)-Math.min(a.y+a.height,b.y+b.height));
  const overlapY=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const overlapX=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  return (gapX<.026&&overlapY>Math.min(a.height,b.height)*.3)||(gapY<.020&&overlapX>Math.min(a.width,b.width)*.35);
}
function key(x,y){return x+','+y;}
function clamp(v,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
