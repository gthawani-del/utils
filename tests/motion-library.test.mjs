import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, makeProject, validateProject, resolveColors, contrastRatio } from '../lib/motion/project.js';
import { drawFrame } from '../lib/motion/renderer.js';

const ids = ['problem','workflow','systems','knowledge','voice','walkthrough','comparison','checklist'];
test('eight discoverable families provide their own layout and editable labels', () => {
  assert.deepEqual(TEMPLATES.filter(t => !t.legacy).map(t => t.id), ids);
  for (const id of ids) {
    const template = TEMPLATES.find(t => t.id === id), project = makeProject(id);
    assert.equal(project.scenes[1].layout, id);
    assert.deepEqual(project.scenes[1].points, template.labelHints);
    assert.ok(['explain','demonstrate','compare','process'].includes(template.category));
    assert.equal(project.scenes.at(-1).layout, 'closing');
  }
});
test('old v1 projects receive compatible narration, colour and intensity defaults', () => {
  const old = makeProject('explainer'); delete old.colors; delete old.intensity;
  old.scenes.forEach(s => { delete s.colors; delete s.narration; });
  const imported = validateProject(old);
  assert.equal(imported.template, 'explainer');
  assert.equal(imported.intensity, 'balanced');
  assert.deepEqual(imported.colors, {});
  assert.equal(imported.scenes[0].narration, imported.scenes[0].body);
});
test('custom colours resolve with explicit scene overrides and survive serialization', () => {
  const p = makeProject('systems'); p.colors = { bg:'#FFFFFF', ink:'#222222', accent:'#abcdef', body:'#333333' };
  p.scenes[1].colors = { accent:'#990011' }; p.intensity='energetic'; p.scenes[1].narration='A supplied narration.';
  const q = validateProject(JSON.parse(JSON.stringify(p))), c = resolveColors(q,q.scenes[1]);
  assert.equal(c.bg,'#ffffff'); assert.equal(c.accent,'#990011'); assert.equal(c.body,'#333333');
  assert.equal(q.scenes[1].narration,'A supplied narration.'); assert.equal(q.intensity,'energetic');
  assert.equal(resolveColors(q,q.scenes[0]).accent,'#abcdef');
});
test('colour import rejects executable values and malformed colours', () => {
  for (const value of ['red','#fff','url(remote)',null,15,'#zzzzzz']) {
    const p=makeProject(); p.colors={bg:value}; assert.throws(()=>validateProject(p),/HEX/);
  }
  for (const value of [null,[],1]) { const p=makeProject(); p.colors=value; assert.throws(()=>validateProject(p),/colours/); }
  const p=makeProject(); p.colors={bg:'#ffffff',script:'ignored'}; assert.deepEqual(validateProject(p).colors,{bg:'#ffffff'});
});
test('invalid motion intensity cannot reach animation geometry',()=>{
  const p=makeProject(); p.intensity='unbounded'; assert.throws(()=>validateProject(p),/motion/);
});
test('contrast calculation identifies unreadable same-colour text',()=>{
  assert.equal(contrastRatio('#ffffff','#ffffff'),1);
  assert.equal(contrastRatio('#000000','#ffffff'),21);
});

function context() {
  const calls=[];
  const c={canvas:{width:540,height:960},globalAlpha:1,measureText:s=>({width:String(s).length*10})};
  for(const key of ['save','restore','scale','fillRect','fillText','beginPath','roundRect','fill','rect','clip','translate','rotate','stroke','moveTo','lineTo','arc','drawImage']) c[key]=(...args)=>{for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v),`${key} coordinate must be finite`);calls.push([key,...args]);};
  return { c, calls };
}
test('families produce distinct staged diagrams and all frame coordinates remain finite',()=>{
  const signatures=new Set();
  for(const id of ids){
    const p=makeProject(id), early=context(), late=context();
    drawFrame(early.c,p,8.4); drawFrame(late.c,p,14);
    assert.notDeepEqual(early.calls,late.calls,`${id} should progress`);
    signatures.add(JSON.stringify(late.calls));
    for(const intensity of ['subtle','balanced','energetic']){p.intensity=intensity;const c=context();drawFrame(c.c,p,0);drawFrame(c.c,p,23.99);}
  }
  assert.equal(signatures.size,8);
});
test('walkthrough renders an uploaded image inside its screen geometry',()=>{
  const p=makeProject('walkthrough');p.scenes[1].image='data:image/png;base64,aA==';
  const image={width:100,height:200}, ctx=context();drawFrame(ctx.c,p,12,new Map([[p.scenes[1].image,image]]));
  assert.ok(ctx.calls.some(c=>c[0]==='drawImage'&&c[1]===image));
  assert.ok(ctx.calls.filter(c=>c[0]==='roundRect').length>=5,'screen plus interactive rows stay present');
});


test('font selection is validated, serialized and consistently applied by the renderer', () => {
  for (const [font, family] of [['sans','system-ui'], ['serif','Georgia'], ['mono','ui-monospace']]) {
    const p = makeProject('workflow', { font });
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))).font, font);
    const { c } = context(), fonts = []; let value = '';
    Object.defineProperty(c, 'font', { get: () => value, set: v => { value = v; fonts.push(v); } });
    drawFrame(c, p, 12);
    assert.ok(fonts.length > 3); assert.ok(fonts.every(f => f.includes(family)));
  }
  const legacy = makeProject(); delete legacy.font; assert.equal(validateProject(legacy).font, 'sans');
  const invalid = makeProject(); invalid.font='remote-font'; assert.throws(()=>validateProject(invalid),/typography/);
});

test('template remapping keeps authored content and leaves the original untouched', async () => {
  const { remapTemplate } = await import('../lib/motion/gallery.js');
  const original = makeProject('workflow');
  original.scenes[1].body = 'A supplied claim, unchanged.';
  original.scenes[1].narration = 'My exact narration.';
  original.scenes[1].colors = { accent: '#123456' };
  const next = remapTemplate(original, 'knowledge');
  assert.equal(next.template, 'knowledge');
  assert.equal(next.scenes[1].body, original.scenes[1].body);
  assert.equal(next.scenes[1].narration, original.scenes[1].narration);
  assert.deepEqual(next.scenes[1].points, original.scenes[1].points);
  assert.deepEqual(next.scenes[1].colors, original.scenes[1].colors);
  assert.equal(next.scenes.at(-1).layout, 'closing');
  assert.equal(original.template, 'workflow');
  assert.throws(() => remapTemplate(original, 'unknown'));
});
