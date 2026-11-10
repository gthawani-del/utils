import { TEMPLATES, makeProject, validateProject } from './project.js';
import { drawFrame } from './renderer.js';
export function remapTemplate(project, id) {
  const template = TEMPLATES.find(t => t.id === id && !t.legacy);
  if (!template) throw new Error('Choose a supported animation template.');
  const next = structuredClone(project); next.template = id;
  next.scenes.forEach((s, i) => { s.layout = i === next.scenes.length - 1 && s.layout === 'closing' ? 'closing' : id; });
  return validateProject(next);
}
export function mountGallery(container, { getProject, getImages = () => new Map(), onUse, onError = () => {} }) {
  let raf = 0, activeButton = null;
  const filters = document.createElement('div'); filters.className = 'gallery-filters'; filters.setAttribute('aria-label', 'Filter templates');
  const grid = document.createElement('div'); grid.className = 'gallery-grid';
  function stop() { cancelAnimationFrame(raf); raf = 0; if (activeButton) { activeButton.textContent = activeButton.dataset.own === 'true' ? 'Preview my content' : 'Play preview'; activeButton = null; } }
  for (const [id, label] of [['all','All'],['explain','Explain'],['demonstrate','Demonstrate'],['compare','Compare'],['process','Show a process']]) {
    const button = document.createElement('button'); button.textContent = label; button.className = 'filter-button'; button.setAttribute('aria-pressed', String(id === 'all'));
    button.addEventListener('click', () => { stop(); filters.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); grid.querySelectorAll('[data-category]').forEach(card => card.hidden = id !== 'all' && card.dataset.category !== id); }); filters.append(button);
  }
  for (const template of TEMPLATES.filter(t => !t.legacy)) {
    const card = document.createElement('article'); card.className = 'gallery-card'; card.dataset.template = template.id; card.dataset.category = template.category;
    const canvas = document.createElement('canvas'); canvas.width = 540; canvas.height = 960; canvas.setAttribute('aria-label', `${template.name} animation preview`);
    const sample = makeProject(template.id); const sceneStart = sample.scenes[0].duration;
    drawFrame(canvas.getContext('2d'), sample, sceneStart + 3);
    const title = document.createElement('h3'); title.textContent = template.name;
    const desc = document.createElement('p'); desc.textContent = template.description;
    const check = document.createElement('span'); check.className = 'template-check'; check.setAttribute('aria-hidden','true'); title.append(check);
    const actions = document.createElement('div'); actions.className = 'gallery-actions';
    for (const own of [false, true]) {
      const b = document.createElement('button'); b.className = 'secondary small'; b.textContent = own ? 'Preview my content' : 'Play preview'; b.dataset.own = String(own);
      b.addEventListener('click', () => {
        if (activeButton === b) { stop(); return; } stop();
        try {
          const current = getProject(); if (own && !current) throw new Error('Create or import a project first. You can play the sample now.');
          const p = own ? remapTemplate(current, template.id) : sample;
          const index = p.scenes.length > 1 ? 1 : 0, start = p.scenes.slice(0,index).reduce((n,s)=>n+s.duration,0), duration = p.scenes[index].duration;
          const size = p.format === 'wide' ? [960,540] : [540,960]; [canvas.width, canvas.height] = size;
          activeButton = b; b.textContent = 'Pause preview'; const origin = performance.now();
          const tick = now => { if (!activeButton || container.closest('[hidden]') || card.hidden) { stop(); return; } const elapsed = (now-origin)/1000; drawFrame(canvas.getContext('2d'), p, start + Math.min(duration - .02, elapsed), own ? getImages() : new Map()); if (elapsed < duration) raf = requestAnimationFrame(tick); else stop(); }; raf=requestAnimationFrame(tick);
        } catch(e) { onError(e.message); }
      }); actions.append(b);
    }
    const use = document.createElement('button'); use.className = 'primary small'; use.textContent = 'Use template'; use.addEventListener('click',()=>{stop();onUse(template.id);}); actions.append(use);
    card.append(canvas,title,desc,actions); grid.append(card);
  }
  container.replaceChildren(filters,grid);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return { stop };
}
