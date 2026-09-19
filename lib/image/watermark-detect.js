export function detectWatermarkRegions(rgba,width,height,{maxRegions=5}={}) {
  if(!rgba||width<24||height<24)return [];
  const gray=new Uint8Array(width*height), chroma=new Uint8Array(width*height);
  for(let i=0,p=0;i<rgba.length;i+=4,p++){
    const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    gray[p]=Math.round(.2126*r+.7152*g+.0722*b);
    chroma[p]=Math.max(r,g,b)-Math.min(r,g,b);
  }
  const cols=24, rows=Math.max(12,Math.round(cols*height/width));
  const cw=Math.max(8,Math.ceil(width/cols)), ch=Math.max(8,Math.ceil(height/rows));
  const cells=[];
  for(let gy=0,y=0;y<height;gy++,y+=ch){
    for(let gx=0,x=0;x<width;gx++,x+=cw){
      const w=Math.min(cw,width-x),h=Math.min(ch,height-y);
      let edges=0,achro=0,count=0,gradSum=0;
      for(let yy=y+1;yy<y+h;yy+=2){
        for(let xx=x+1;xx<x+w;xx+=2){
          const p=yy*width+xx,v=gray[p],dx=Math.abs(v-gray[p-1]),dy=Math.abs(v-gray[p-width]),grad=dx+dy;
          if(grad>42)edges++;
          if(chroma[p]<34)achro++;
          gradSum+=grad;count++;
        }
      }
      if(!count)continue;
      const edgeDensity=edges/count, achroRatio=achro/count, meanGrad=gradSum/count;
      const nx=(x+w/2)/width,ny=(y+h/2)/height;
      const border=Math.min(nx,1-nx,ny,1-ny);
      const borderBoost=border<.18?1.15:1;
      const score=edgeDensity*(.62+.62*achroRatio)*borderBoost + Math.min(.08,meanGrad/1200);
      cells.push({gx,gy,x,y,w,h,score,edgeDensity,achroRatio});
    }
  }
  if(!cells.length)return [];
  const sorted=[...cells].sort((a,b)=>b.score-a.score);
  const cutoff=Math.max(.12,sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.10))]?.score||.12);
  const picked=new Map(cells.filter((c)=>c.score>=cutoff&&c.edgeDensity>.055).map((c)=>[key(c.gx,c.gy),c]));
  const groups=[];
  while(picked.size){
    const first=picked.values().next().value,stack=[first];picked.delete(key(first.gx,first.gy));
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
    const score=group.reduce((s,c)=>s+c.score,0)/group.length;
    return {x:x/width,y:y/height,width:(x2-x)/width,height:(y2-y)/height,score,cells:group.length};
  }).filter((b)=>{
    const area=b.width*b.height,aspect=b.width/Math.max(.001,b.height);
    return area>=.0015&&area<=.30&&aspect>=.25&&aspect<=14&&b.cells>=2;
  });
  boxes=mergeNearby(boxes).sort((a,b)=>b.score-a.score).slice(0,maxRegions);
  return boxes.map(({x,y,width:boxWidth,height:boxHeight,score})=>({
    x:clamp(x-.008,0,1),y:clamp(y-.008,0,1),
    width:clamp(boxWidth+.016,.01,1-x),height:clamp(boxHeight+.016,.01,1-y),
    score
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

function mergeNearby(boxes){
  const list=[...boxes];let changed=true;
  while(changed){changed=false;outer:for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    if(near(list[i],list[j])){
      const a=list[i],b=list[j],x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),x2=Math.max(a.x+a.width,b.x+b.width),y2=Math.max(a.y+a.height,b.y+b.height);
      list.splice(j,1);list[i]={x,y,width:x2-x,height:y2-y,score:Math.max(a.score,b.score),cells:(a.cells||1)+(b.cells||1)};changed=true;break outer;
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
  return (gapX<.035&&overlapY>Math.min(a.height,b.height)*.2)||(gapY<.025&&overlapX>Math.min(a.width,b.width)*.25);
}
function key(x,y){return x+','+y;}
function clamp(v,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
