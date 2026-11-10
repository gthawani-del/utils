import { resolveColors, TEMPLATES, sceneAt, durationOf } from './project.js';
const FAMILIES = { sans: 'system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace' };
const contextFonts = new WeakMap();
const familyOf = ctx => contextFonts.get(ctx) || FAMILIES.sans;
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => 1 - Math.pow(1 - clamp(x), 3);
function box(ctx, x, y, w, h, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function lines(ctx, text, width) {
  const words = text.split(/\s+/).filter(Boolean), result = []; let line = '';
  for (const word of words) {
    if (ctx.measureText(line ? line + ' ' + word : word).width > width && line) { result.push(line); line = ''; }
    if (ctx.measureText(word).width > width) {
      for (const char of [...word]) { if (ctx.measureText(line + char).width > width && line) { result.push(line); line = ''; } line += char; }
    } else line += (line ? ' ' : '') + word;
  }
  if (line) result.push(line);
  return result;
}
function paragraph(ctx, text, x, y, width, size, maxLines, color, progress, weight = 600) {
  let rows;
  do { ctx.font = `${weight} ${size}px ${familyOf(ctx)}`; rows = lines(ctx, text, width); if (rows.length <= maxLines || size <= 8) break; size -= 1; } while (true);
  ctx.fillStyle = color; ctx.textBaseline = 'top';
  rows.forEach((line, i) => {
    const p = ease(progress - i * .12);
    ctx.save(); ctx.beginPath(); ctx.rect(x - 2, y + i * size * 1.18, width + 4, size * 1.22); ctx.clip();
    ctx.globalAlpha *= p; ctx.fillText(line, x, y + i * size * 1.18 + (1 - p) * size * 1.4); ctx.restore();
  });
  return rows.length * size * 1.18;
}
function contain(ctx, img, x, y, w, h) { const ratio = Math.min(w / img.width, h / img.height); const iw = img.width * ratio, ih = img.height * ratio; ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
export function drawFrame(ctx, project, time, images = new Map()) {
  contextFonts.set(ctx, FAMILIES[project.font] || FAMILIES.sans);
  const { width, height } = ctx.canvas; const wide = project.format === 'wide';
  const W = wide ? 960 : 540, H = wide ? 540 : 960;
  ctx.save(); ctx.scale(width / W, height / H);
  const active = sceneAt(project, time);
  const palette = resolveColors(project, active.scene), { scene, index, local } = sceneAt(project, time);
  ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, W, H);
  const m = wide ? 48 : 38;
  ctx.fillStyle = palette.ink; ctx.font = `600 13px ${familyOf(ctx)}`; ctx.textBaseline = 'top';
  ctx.fillText(project.brand || 'MOTION STUDIO', m, 34);
  ctx.textAlign = 'right'; ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(project.scenes.length).padStart(2, '0')}`, W - m, 34); ctx.textAlign = 'left';
  const end = index === project.scenes.length - 1 ? 1 : ease((scene.duration - local) / .45); ctx.globalAlpha = end;
  const speed = { subtle: .8, balanced: 1, energetic: 1.35 }[project.intensity] || 1;
  const entry = local * speed / .65, effectShift = scene.effect === 'rise' ? (1 - ease(entry)) * 30 : 0;
  ctx.translate(0, effectShift);
  const tw = wide ? 410 : W - m * 2;
  const titleY = wide ? 125 : 120;
  const titleH = paragraph(ctx, scene.title, m, titleY, tw, wide ? 48 : 51, 4, palette.ink, entry, 700);
  paragraph(ctx, scene.body, m, titleY + titleH + 22, tw, 20, wide ? 5 : 5, palette.body, entry - .4, 400);
  const gx = wide ? 525 : m, gy = wide ? 120 : 545, gw = wide ? 387 : W - m * 2, gh = wide ? 320 : 295;
  const photo = images.get(scene.image);
  const family = scene.layout === 'title' && !TEMPLATES.find(t => t.id === project.template)?.legacy ? project.template : scene.layout;
  if (['problem', 'workflow', 'systems', 'knowledge', 'voice', 'walkthrough', 'comparison', 'checklist'].includes(family)) {
    drawFamily(ctx, family, scene, local / scene.duration, palette, gx, gy, gw, gh, speed, photo);
  } else if (photo) {
    ctx.save(); const p = ease(entry - .3); ctx.beginPath(); ctx.roundRect(gx, gy + (1 - p) * 24, gw, gh, 20); ctx.clip(); ctx.globalAlpha *= p;
    ctx.fillStyle = palette.soft; ctx.fillRect(gx, gy, gw, gh); contain(ctx, photo, gx + 12, gy + 12, gw - 24, gh - 24); ctx.restore();
  } else if (scene.layout === 'steps') {
    const labels = scene.points;
    for (let i = 0; i < 3; i++) {
      const p = ease(entry - (scene.effect === 'stagger' ? i * .4 : i * .15) - .3);
      const y = gy + i * (gh / 3), x = gx + (1 - p) * 45;
      ctx.save(); ctx.globalAlpha *= p; box(ctx, x, y, gw, gh / 3 - 12, 14, palette.soft);
      box(ctx, x + 16, y + 18, 39, 39, 20, palette.accent);
      ctx.fillStyle = palette.bg; ctx.font = `600 18px ${familyOf(ctx)}`; ctx.fillText(String(i + 1), x + 30, y + 27);
      paragraph(ctx, labels[i], x + 75, y + 20, gw - 90, 22, 2, palette.ink, 2); ctx.restore();
    }
  } else if (scene.layout === 'closing') {
    const p = ease(entry - .3); ctx.save(); ctx.globalAlpha *= p;
    const logo = images.get(project.logo);
    if (logo) contain(ctx, logo, gx + 24, gy + 15, gw - 48, gh - 90);
    else {
      box(ctx, gx, gy + 20, gw, gh - 90, 20, palette.soft);
      paragraph(ctx, project.brand || 'Your next chapter', gx + 24, gy + 62, gw - 48, 33, 3, palette.ink, entry - .2);
    }
    paragraph(ctx, project.url, gx, gy + gh - 47, gw, 18, 2, palette.ink, entry - .6, 500); ctx.restore();
  } else {
    // An original layered-card reveal: depth comes from projected offsets and shadows.
    for (let i = 0; i < 3; i++) {
      const p = ease(entry - i * .18 - .2), offset = (2 - i) * 20;
      ctx.save(); ctx.translate(gx + gw / 2, gy + gh / 2); ctx.rotate((i - 1) * .07 * p);
      ctx.translate(-gw / 2 + offset, -gh / 2 + offset - (1 - p) * 50);
      ctx.globalAlpha *= p; ctx.shadowColor = '#00000014'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
      box(ctx, 15, 15, gw - 75, gh - 65, 18, i === 2 ? palette.accent : palette.soft);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (i === 2) {
        ctx.strokeStyle = palette.bg; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let j = 0; j < 3; j++) { const q = ease(entry - .7 - j * .18); ctx.beginPath(); ctx.moveTo(45, 65 + j * 48); ctx.lineTo(45 + (gw - 155 - j * 20) * q, 65 + j * 48); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = palette.line; ctx.fillRect(m, H - 42, W - m * 2, 3);
  ctx.fillStyle = palette.accent; ctx.fillRect(m, H - 42, (W - m * 2) * clamp(time / durationOf(project)), 3);
  ctx.restore();
}


function connector(ctx, ax, ay, bx, by, progress, palette, width = 2) {
  const p = ease(progress); ctx.strokeStyle = palette.line; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * p, ay + (by - ay) * p); ctx.stroke();
}
function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function card(ctx, label, x, y, w, h, palette, progress = 1, active = false) {
  const p = ease(progress); ctx.save(); ctx.globalAlpha *= p; ctx.translate(0, (1 - p) * 20);
  box(ctx,x,y,w,h,12, active ? palette.accent : palette.soft);
  const maxRows = Math.max(1, Math.min(3, Math.floor((h - 24) / 20)));
  paragraph(ctx,label,x+14,y+16,w-28,Math.min(22, (h - 24) / (maxRows * 1.18)),maxRows,active ? palette.bg : palette.ink,2,600);ctx.restore();
}
function check(ctx, x, y, p, color) { ctx.strokeStyle=color;ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x,y);const a=clamp(p*2);ctx.lineTo(x+7*a,y+7*a);if(p>.5)ctx.lineTo(x+7+14*(p-.5)*2,y+7-19*(p-.5)*2);ctx.stroke(); }
function drawFamily(ctx, family, scene, time, palette, x, y, w, h, speed, photo) {
  // Normalized geometry keeps the same staged explanation in portrait and landscape.
  ctx.save();ctx.translate(x,y);ctx.scale(w/464,h/300);
  const t=clamp(time/(speed<1?.94:speed>1?.72:.84)), q=(start,span=.22)=>ease((t-start)/span), labels=scene.points;
  if(family==='workflow') {
    const spread=q(.25), paperW=190-36*spread, paperX=137+18*spread;
    box(ctx,paperX,2,paperW,105,10,palette.soft);
    paragraph(ctx,'Agreement',paperX+16,18,paperW-32,20,2,palette.ink,2);
    for(let i=0;i<3;i++)connector(ctx,paperX+16,57+i*12,paperX+paperW-20-i*16,57+i*12,q(i*.05),palette);
    connector(ctx,232,107,232,146,q(.2),palette);
    connector(ctx,76,146,388,146,q(.3),palette);
    labels.forEach((label,i)=>{const xx=8+i*154;connector(ctx,xx+70,146,xx+70,175,q(.35+i*.06),palette);card(ctx,label,xx,175,140,102,palette,q(.4+i*.08)); if(t>.72+i*.05)check(ctx,xx+110,249,q(.72+i*.05,.1),palette.accent);});
  } else if(family==='systems') {
    const centers=[[74,150],[232,60],[390,150]], routes=[[0,1],[1,2],[2,0]];
    routes.forEach(([a,b],i)=>connector(ctx,...centers[a],...centers[b],q(.16+i*.09,.25),palette,3));
    centers.forEach(([cx,cy],i)=>{dot(ctx,cx,cy,35*q(i*.06),palette.soft);dot(ctx,cx,cy,18*q(.1+i*.06),palette.accent);paragraph(ctx,labels[i],cx-65,cy+44,130,20,3,palette.ink, q(.1+i*.07)*2);});
    routes.forEach(([a,b],i)=>{const p=clamp((t-.4-i*.12)/.2);if(p>0 && p<1)dot(ctx,centers[a][0]+(centers[b][0]-centers[a][0])*p,centers[a][1]+(centers[b][1]-centers[a][1])*p,7,palette.secondary);});
  } else if(family==='knowledge') {
    labels.forEach((label,i)=>{const xx=8+i*154;box(ctx,xx,154,60,18,5,palette.soft);box(ctx,xx,168,140,80,8,palette.soft);paragraph(ctx,label,xx+10,185,120,20,3,palette.ink,2);});
    labels.forEach((_,i)=>{const p=q(.1+i*.13,.3), xx=194+(8+i*154+47-194)*p, yy=8+160*p;ctx.save();ctx.globalAlpha*=1-.65*q(.6+i*.08,.15);box(ctx,xx,yy,48,62,4,palette.accent);for(let j=0;j<3;j++){ctx.fillStyle=palette.bg;ctx.fillRect(xx+9,yy+14+j*10,28-j*5,2);}ctx.restore();});
    connector(ctx,78,272,232,272,q(.65,.18),palette);connector(ctx,232,272,386,272,q(.76,.18),palette);[78,232,386].forEach((xx,i)=>dot(ctx,xx,272,6*q(.6+i*.08),palette.secondary));
  } else if(family==='voice') {
    card(ctx,labels[0],0,0,464,68,palette,q(0));
    box(ctx,0,86,464,61,10,palette.soft);
    for(let i=0;i<45;i++){const voiceGate=1-q(.57,.18), amp=(7+Math.abs(Math.sin(i*.83+t*28))*29)*voiceGate+3;ctx.fillStyle=palette.accent;ctx.fillRect(18+i*9.5,116-amp/2,3,amp);}
    const action=q(.35);card(ctx,labels[1],0,166,220,105,palette,action,t>.56);connector(ctx,220,218,246,218,q(.52),palette,3);card(ctx,labels[2],246,166,218,105,palette,q(.6));if(t>.7)check(ctx,420,245,q(.7),palette.accent);
  } else if(family==='walkthrough') {
    box(ctx,43,0,378,300,18,palette.ink);box(ctx,53,30,358,258,9,palette.bg);
    [65,78,91].forEach(xx=>dot(ctx,xx,16,3,palette.soft));
    if(photo){ctx.save();ctx.beginPath();ctx.roundRect(65,42,334,132,6);ctx.clip();contain(ctx,photo,65,42,334,132);ctx.restore();}
    else {box(ctx,65,43,334,69,8,palette.soft);for(let j=0;j<3;j++)connector(ctx,81,61+j*14,300-j*35,61+j*14,q(j*.06),palette);}
    const start=photo?184:125, rowH=photo?29:45;
    labels.forEach((label,i)=>{const active=Math.min(2,Math.floor(t*3))===i;box(ctx,65,start+i*(rowH+6),334,rowH,6,active?palette.accent:palette.soft);paragraph(ctx,label,78,start+i*(rowH+6)+6,300,photo?16:20,1,active?palette.bg:palette.ink,2,500);});
    const cy=start+Math.min(2,Math.floor(t*3))*(rowH+6)+rowH/2;ctx.strokeStyle=palette.secondary;ctx.lineWidth=3;ctx.beginPath();ctx.arc(383,cy,10+5*Math.sin(t*8)**2,0,Math.PI*2);ctx.stroke();
  } else if(family==='comparison') {
    const p=q(.2,.45);box(ctx,0,0,464,300,14,palette.soft);
    ctx.save();ctx.beginPath();ctx.rect(0,0,464*p,300);ctx.clip();box(ctx,0,0,464,300,14,palette.accent);ctx.restore();
    const divider=464*p;ctx.strokeStyle=palette.secondary;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(divider,20);ctx.lineTo(divider,280);ctx.stroke();
    // Matching blocks move from scattered positions into a consistent stack.
    for(let i=0;i<3;i++){const bx=30+i*125+(70-(30+i*125))*p,by=90+(i%2)*45+(77+i*51-(90+(i%2)*45))*p;box(ctx,bx,by,88+235*p,34,6,p>.65?palette.bg:palette.ink);}
    paragraph(ctx,p>.6?labels[2]:labels[0],22,22,420,23,2,p>.6?palette.bg:palette.ink,2);
    paragraph(ctx,labels[1],22,253,420,18,2,p>.6?palette.bg:palette.ink,2,500);
  } else if(family==='checklist') {
    labels.forEach((label,i)=>{const yy=i*86,done=q(.12+i*.24,.16);box(ctx,0,yy,464,72,12,palette.soft);box(ctx,18,yy+20,31,31,7,done>.8?palette.accent:palette.bg);if(done>0)check(ctx,23,yy+31,done,palette.bg);paragraph(ctx,label,67,yy+21,380,22,2,palette.ink,2);});
    ctx.fillStyle=palette.line;ctx.fillRect(0,282,464,4);ctx.fillStyle=palette.accent;ctx.fillRect(0,282,464*q(.12,.65),4);
  } else if(family==='problem') {
    const p=q(.3,.4); labels.forEach((label,i)=>{const xx=8+i*154;card(ctx,label,xx,32,140,110,palette,q(i*.08),i===1&&p<.75);});
    connector(ctx,78,143,78,200,q(.12),palette,3);connector(ctx,78,200,386,200,q(.23,.4),palette,3);connector(ctx,386,200,386,143,q(.55),palette,3);
    const gateY=178-100*p;ctx.fillStyle=palette.secondary;ctx.fillRect(224,gateY,16,64*(1-p));
    const positions=[80,111,142,173];positions.forEach((xx,i)=>{const xx2=xx+(370-xx)*q(.42+i*.07,.25);dot(ctx,xx2,200,6,palette.accent);});
    if(p>.85)check(ctx,375,254,q(.7),palette.accent);
  }
  ctx.restore();
}
