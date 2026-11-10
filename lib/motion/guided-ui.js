import { suggestPatterns, questionsFor, getMissingQuestions, buildGuidedProject } from './guided.js';
import { TEMPLATES } from './project.js';
const KEY='utility-os:motion:guided';
function node(tag, text, cls) { const el=document.createElement(tag); if(text)el.textContent=text; if(cls)el.className=cls; return el; }
export function setupGuided({onOpen,onExit,onError}) {
  const host=document.getElementById('guided'), content=document.getElementById('guided-content'), history=document.getElementById('guided-history');
  let answers={}, editing=null, returnFocus=null;
  function save() { try { localStorage.setItem(KEY,JSON.stringify(answers)); document.getElementById('guided-storage').textContent='Answers saved on this device.'; } catch {document.getElementById('guided-storage').textContent='Answers cannot be saved on this device. Keep this page open.';} }
  function field(label, value='', max=220) { const wrap=node('label',label), input=node('textarea');input.rows=3;input.maxLength=max;input.value=value;input.required=true;wrap.append(input); return {wrap,input}; }
  function button(text,fn,cls='secondary') { const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b; }
  function begin(description, resume=false) {
    returnFocus=document.activeElement; editing=null;
    if(resume) {try { const stored=JSON.parse(localStorage.getItem(KEY)); answers=stored&&typeof stored==='object'&&!Array.isArray(stored)?stored:{}; }catch {answers={};} } else answers={description:description.trim()};
    save();host.hidden=false; document.getElementById('welcome').hidden=true; document.getElementById('workspace').hidden=true; document.getElementById('template-browser').hidden=true; render();
  }
  function exit() {host.hidden=true;onExit();returnFocus?.focus();}
  document.getElementById('guided-exit').addEventListener('click',exit);
  function renderHistory() {
    history.replaceChildren();
    const entries=[{id:'description',label:'Your brief'}, {id:'templateId',label:'Story pattern'}, ...questionsFor(answers.templateId).filter(q=>q.id!=='description')];
    for(const q of entries) {
      const value=answers[q.id];if(!value)continue;
      const row=node('div',null,'answer-row'), copy=node('div');copy.append(node('strong',q.label));
      const display=q.id==='templateId'?TEMPLATES.find(t=>t.id===value)?.name:Array.isArray(value)?value.join(' · '):value;
      copy.append(node('p',display));row.append(copy,button('Edit',()=>{editing=q.id;render();},'text-button small'));history.append(row);
    }
  }
  function render() {
    renderHistory();content.replaceChildren();
    const form=node('form');form.addEventListener('submit',e=>e.preventDefault());content.append(form);
    if(!answers.description || editing==='description') {
      form.append(node('h2','What do you want to explain?'));const f=field('Describe the problem or idea',answers.description);form.append(f.wrap);
      form.append(button('Continue',()=>{if(!f.input.reportValidity())return;answers.description=f.input.value.trim();if(!answers.description)return;delete answers.templateId;editing=null;save();render();},'primary'));return;
    }
    if(!answers.templateId || editing==='templateId') {
      const matches=suggestPatterns(answers.description);form.append(node('h2',matches.length?'Choose the closest story pattern':'Choose a story pattern'));
      form.append(node('p',matches.length?'These are keyword-based suggestions. Confirm the best fit or choose another pattern.':'There is no clear keyword match. Choose how you want to tell the story; your description will be kept.','hint'));
      const candidates=[...matches,...TEMPLATES.filter(t=>!t.legacy&&!matches.some(m=>m.id===t.id)).map(t=>({id:t.id,label:t.name,reason:t.description}))];
      const choices=node('div',null,'guided-patterns');
      for(const option of candidates) {const b=button(option.label,()=>{const changed=answers.templateId&&answers.templateId!==option.id;answers.templateId=option.id;editing=changed?'solution':null;if(changed)delete answers.points;save();render();},'pattern-choice');b.append(node('small',option.reason));b.dataset.pattern=option.id;choices.append(b);}form.append(choices);return;
    }
    const all=questionsFor(answers.templateId), q=editing?all.find(q=>q.id===editing):getMissingQuestions(answers,answers.templateId)[0];
    if(q) {
      form.append(node('p',`FOR ${TEMPLATES.find(t=>t.id===answers.templateId)?.name.toUpperCase()}`,'eyebrow'),node('h2',q.prompt));
      const fields=[];
      if(q.id==='points') {
        for(let i=0;i<3;i++){const label=q.fields?.[i]||q.labels?.[i]||`Label ${i+1}`;const f=field(label,answers.points?.[i]||'',40);f.input.rows=1;fields.push(f.input);form.append(f.wrap);}
      } else { const f=field(q.label,answers[q.id]||'',q.maxLength||220);fields.push(f.input);form.append(f.wrap);
        if(q.choices?.length) {const choices=node('div',null,'answer-choices');for(const choice of q.choices)choices.append(button(choice,()=>{f.input.value=choice;f.input.focus();},'secondary small'));form.append(choices);}
      }
      form.append(button('Continue',()=>{if(fields.some(f=>!f.reportValidity()||!f.value.trim()))return;answers[q.id]=q.id==='points'?fields.map(f=>f.value.trim()):fields[0].value.trim();editing=null;save();render();},'primary'));
      const supplied=all.filter(x=>answers[x.id]);if(supplied.length)form.append(button('Back',()=>{editing=supplied[supplied.length-1].id;render();}));
      form.querySelector('textarea')?.focus();return;
    }
    form.append(node('h2','Review your story'),node('p','This draft uses your answers. Check the wording and claims before continuing.','hint'));
    const options=node('div',null,'field-row');const durationLabel=node('label','Video length'),duration=node('select');for(const seconds of [15,24,40,60]){const op=node('option',`${seconds} seconds`);op.value=seconds;op.selected=seconds===40;duration.append(op);}durationLabel.append(duration);
    const formatLabel=node('label','Screen format'),format=node('select');for(const [id,label] of [['vertical','Vertical · 9:16'],['wide','Widescreen · 16:9']]){const op=node('option',label);op.value=id;format.append(op);}formatLabel.append(format);options.append(durationLabel,formatLabel);form.append(options);
    let draft;
    try {draft=buildGuidedProject(answers,{duration:40});}catch(e){onError(e.message);return;}
    const cards=node('div',null,'story-review');draft.scenes.forEach((s,i)=>{const card=node('article');card.append(node('small',`SCENE ${i+1}`),node('h3',s.title),node('p',s.body),node('small',`Visual: ${s.layout==='closing'?'Brand closing card':TEMPLATES.find(t=>t.id===answers.templateId)?.name}`));cards.append(card);});form.append(cards);
    form.append(node('p','Narration is assembled from your supplied wording. Edit each scene and download the narration script in the studio.','hint'));
    form.append(button('Open animated storyboard',async()=>{try {const p=buildGuidedProject(answers,{duration:Number(duration.value),format:format.value});await onOpen(p);host.hidden=true;}catch(e){onError(e.message);}},'primary'));
  }
  return {begin,get available(){try{return !!JSON.parse(localStorage.getItem(KEY))?.description;}catch{return false;}}};
}
