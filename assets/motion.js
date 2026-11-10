import { TEMPLATES, PALETTES, MAX_PROJECT_BYTES, makeProject, validateProject, durationOf, dimensions, fitNarration } from '/lib/motion/project.js';
import { drawFrame } from '/lib/motion/renderer.js';
import { draft } from '/lib/motion/storage.js';
import { decodeNarration, mixAudio } from '/lib/motion/audio.js';
import { probeExport, exportLyrical } from '/lib/lyrical/export.js';
const $ = id => document.getElementById(id);
let project = makeProject(), selected = 0, step = 0, current = 0, playing = false, raf = 0, startTime = 0;
let images = new Map(), narration = null, playbackContext = null, playbackSource = null, busy = false, exportController = null;
let startingPlayback = false, playbackGeneration = 0;
let saveTimer, saveQueue = Promise.resolve(), statusTimer, downloadUrl, recovered, inWorkspace = false;
const canvas = $('preview'), context = canvas.getContext('2d');
function message(text, error = false) { clearTimeout(statusTimer); $('status').textContent = text; $('status').classList.toggle('error', error); if (!error) statusTimer = setTimeout(() => $('status').textContent = '', 6500); }
function clock(t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
function invalidateExport() { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = null; $('download-video').hidden = true; $('export-progress').hidden = true; }
function scheduleSave() {
  clearTimeout(saveTimer); $('save-state').textContent = 'Saving…';
  saveTimer = setTimeout(() => {
    const snapshot = structuredClone(project);
    saveQueue = saveQueue.catch(() => {}).then(() => draft('save', snapshot)).then(() => { $('save-state').textContent = 'Saved on this device'; }).catch(() => { $('save-state').textContent = 'Not saved · download a backup'; message('Device storage is unavailable or full. Save your project file to keep your work.', true); });
  }, 350);
}
function stop() {
  playbackGeneration++;
  playing = false; cancelAnimationFrame(raf); raf = 0;
  if (playbackSource) { try { playbackSource.stop(); } catch {} playbackSource = null; }
  $('play').textContent = 'Play'; $('sample-preview').textContent = 'Play sample';
}
function render() {
  const total = durationOf(project); current = Math.max(0, Math.min(current, total));
  drawFrame(context, project, !playing && current === 0 ? Math.min(.9, total - .02) : Math.min(current, total - .02), images);
  if ($('preview-dialog').open) { const large = $('expanded-canvas'); large.width = canvas.width; large.height = canvas.height; large.getContext('2d').drawImage(canvas, 0, 0); }
  $('seek').max = String(total); $('seek').value = String(current); $('time').textContent = `${clock(current)} / ${clock(total)}`;
  $('preview-meta').textContent = `${project.format === 'wide' ? '16:9' : '9:16'} · ${Math.round(total * 10) / 10}s`;
}
function applyChange(edit) {
  if (busy) return false;
  try { const next = structuredClone(project); edit(next); project = validateProject(next); stop(); pruneImages(); invalidateExport(); render(); scheduleSave(); refreshSummary(); return true; }
  catch (e) { message(e.message, true); return false; }
}
function setStep(next) {
  stop(); step = Math.max(0, Math.min(3, next));
  document.querySelectorAll('[data-panel]').forEach(el => el.hidden = Number(el.dataset.panel) !== step);
  document.querySelectorAll('[data-step]').forEach(el => { if (Number(el.dataset.step) === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
  $('back').textContent = step ? 'Back' : 'Home'; $('next').hidden = step === 3;
  $('next').textContent = ['Continue to scenes →', 'Style & voice →', 'Review & export →'][step] || '';
  $('step-label').textContent = `Step ${step + 1} of 4`;
  if (step === 3) refreshSummary();
}
function pruneImages() { const used = new Set([project.logo, ...project.scenes.map(s => s.image)]); for (const key of images.keys()) if (!used.has(key)) images.delete(key); }
function populate() {
  pruneImages();
  $('project-title').value = project.title; $('project-heading').textContent = project.title; $('format').value = project.format;
  $('language').value = ['en-IN', 'en-US', 'en-GB', 'hi-IN'].includes(project.language) ? project.language : 'other';
  const total = durationOf(project);
  $('duration').querySelector('[data-custom]')?.remove();
  if (!['15','24','40','60'].includes(String(total))) { const option = document.createElement('option'); option.dataset.custom = 'true'; option.value = String(total); option.textContent = `${Math.round(total * 10) / 10} seconds · current`; $('duration').append(option); }
  $('duration').value = String(total);
  $('brand-name').value = project.brand; $('brand-url').value = project.url; $('music').checked = project.music;
  $('logo-state').textContent = project.logo ? 'Logo added · closing card' : 'No logo added'; $('remove-logo').hidden = !project.logo;
  $('audio-state').textContent = narration ? `${project.audioName} · ${narration.duration.toFixed(1)}s` : 'No narration added. You can export without it.';
  $('fit-audio').hidden = !narration; $('remove-audio').hidden = !narration;
  document.querySelectorAll('[data-template]').forEach(el => { const active = el.dataset.template === project.template; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', String(active)); el.querySelector('.template-check').textContent = active ? '✓' : ''; });
  document.querySelectorAll('[data-palette]').forEach(el => { const active = el.dataset.palette === project.palette; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', String(active)); });
  const size = dimensions(project.format, 540); canvas.width = size.width; canvas.height = size.height;
  sceneTabs(); sceneForm(); render(); refreshSummary();
}
function sceneTabs() {
  $('scene-list').replaceChildren();
  project.scenes.forEach((scene, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-tab' + (i === selected ? ' active' : '');
    button.textContent = `${i + 1} · ${Math.round(scene.duration * 10) / 10}s`; button.setAttribute('aria-pressed', String(i === selected));
    const subtitle = document.createElement('span'); subtitle.textContent = scene.title; button.append(subtitle);
    button.addEventListener('click', () => { if (busy) return; stop(); selected = i; current = project.scenes.slice(0, i).reduce((n, s) => n + s.duration, 0) + .9; sceneTabs(); sceneForm(); render(); });
    $('scene-list').append(button);
  });
}
function sceneForm() {
  selected = Math.min(selected, project.scenes.length - 1); const scene = project.scenes[selected];
  $('scene-name').textContent = `Scene ${selected + 1}`; $('scene-title').value = scene.title; $('scene-body').value = scene.body;
  $('scene-duration').value = String(Math.round(scene.duration * 10) / 10); $('layout').value = scene.layout; $('effect').value = scene.effect;
  $('point-fields').hidden = scene.layout !== 'steps'; document.querySelectorAll('[data-point]').forEach(el => el.value = scene.points[Number(el.dataset.point)]);
  $('image-state').textContent = scene.image ? 'Scene image added' : 'No image · uses animated graphics'; $('remove-image').hidden = !scene.image;
  $('move-left').disabled = selected === 0; $('move-right').disabled = selected === project.scenes.length - 1; $('delete-scene').disabled = project.scenes.length === 1; $('add-scene').disabled = project.scenes.length >= 12;
}
function refreshSummary() {
  $('project-heading').textContent = project.title;
  const total = durationOf(project), entries = [
    [`${project.scenes.length} scenes · ${Math.round(total * 10) / 10} seconds · ${project.format === 'wide' ? '16:9' : '9:16'}`, false],
    [narration ? `Narration: ${narration.duration.toFixed(1)} seconds${narration.duration > total + .02 ? ' — too long; fit scenes before exporting.' : ''}` : 'No narration. Export will contain only the instrumental pulse, if selected.', !narration || narration.duration > total + .02],
    [project.music ? 'Instrumental pulse enabled.' : 'Instrumental pulse off.', false],
    [project.scenes.some(s => s.layout === 'closing') ? 'Closing card included. Review your logo and website in the preview.' : 'No closing card. You can add one in Scenes.', false],
  ];
  if (!narration && !project.music) entries.push(['This video will be silent.', true]);
  $('preflight').replaceChildren(); entries.forEach(([text, warn]) => { const li = document.createElement('li'); li.textContent = text; if (warn) li.className = 'warn'; $('preflight').append(li); });
}
async function loadImage(data) {
  const img = new Image(); img.src = data; await img.decode(); if (!img.width || !img.height || img.width * img.height > 16000000) throw new Error('Image dimensions are too large. Resize it before importing.'); return img;
}
async function prepare(next) {
  const decoded = new Map();
  for (const data of new Set([next.logo, ...next.scenes.map(s => s.image)].filter(Boolean))) decoded.set(data, await loadImage(data));
  const audio = await decodeNarration(next.audio); return { decoded, audio };
}
async function openProject(next) {
  const valid = validateProject(next), prepared = await prepare(valid);
  stop(); project = valid; images = prepared.decoded; narration = prepared.audio; selected = 0; current = 0; inWorkspace = true;
  $('welcome').hidden = true; $('workspace').hidden = false; invalidateExport(); populate(); setStep(0); scheduleSave();
}
function defaults(next) {
  try { const d = JSON.parse(localStorage.getItem('utility-os:motion:brand') || 'null'); if (d) return validateProject({ ...next, ...d }); } catch {} return next;
}
async function guarded(action) {
  if (busy) return;
  busy = true;
  try { await action(); } catch (e) { message(e.message || 'This action did not complete. Your project is still available.', true); }
  finally { busy = false; }
}
function readData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsDataURL(file); }); }
async function imageFile(file) {
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PNG, JPG or WebP image up to 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('Image is too large. Resize it below 40 megapixels.');
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const tmp = document.createElement('canvas'); tmp.width = Math.round(bitmap.width * ratio); tmp.height = Math.round(bitmap.height * ratio); tmp.getContext('2d').drawImage(bitmap, 0, 0, tmp.width, tmp.height);
    const data = tmp.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', .88);
    return { data, image: await loadImage(data) };
  } finally { bitmap.close(); }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds 32 MB.');
  let next; try { next = JSON.parse(await file.text()); } catch { throw new Error('This is not a valid project JSON file. Your current project has been kept.'); }
  const valid = validateProject(next); // Check structure before replacing any work.
  if (inWorkspace && !confirm('Replace this draft with the imported project? Save a project file first if you want to keep it.')) return;
  await openProject(valid); message('Project imported. Assets and narration are included.');
}
async function play() {
  if (startingPlayback) return;
  if (playing) { stop(); return; }
  if (busy) return;
  startingPlayback = true; const generation = playbackGeneration;
  try {
    const mixed = mixAudio(project, narration);
    if (!playbackContext || playbackContext.state === 'closed') playbackContext = new AudioContext();
    await playbackContext.resume(); if (generation !== playbackGeneration) return; if (current >= durationOf(project) - .05) current = 0;
    playbackSource = playbackContext.createBufferSource(); playbackSource.buffer = mixed; playbackSource.connect(playbackContext.destination); playbackSource.start(0, current);
    startTime = playbackContext.currentTime - current; playing = true; $('play').textContent = 'Pause';
    const tick = () => {
      if (!playing) return; current = Math.min(durationOf(project), playbackContext.currentTime - startTime); render();
      if (current >= durationOf(project)) stop(); else raf = requestAnimationFrame(tick);
    }; tick();
  } catch (e) { message(e.message, true); } finally { startingPlayback = false; }
}
TEMPLATES.forEach(template => {
  const button = document.createElement('button'); button.className = 'template'; button.dataset.template = template.id; button.type = 'button';
  const icon = document.createElement('span'); icon.className = 'template-icon'; icon.textContent = template.id === 'process' ? '123' : template.id === 'launch' ? '→' : 'Aa'; icon.setAttribute('aria-hidden','true');
  const copy = document.createElement('span'), title = document.createElement('strong'), desc = document.createElement('small'), check = document.createElement('span');
  title.textContent = template.name; desc.textContent = template.description; copy.append(title, desc); check.className = 'template-check'; check.setAttribute('aria-hidden','true'); button.append(icon, copy, check);
  button.addEventListener('click', () => guarded(async () => {
    if (template.id === project.template) return;
    if (!confirm('Replace the current scenes with this template? Your brand and narration will be kept.')) return;
    const next = makeProject(template.id, { title: project.title, format: project.format, language: project.language, duration: Number($('duration').value) || 24 });
    Object.assign(next, { brand: project.brand, url: project.url, logo: project.logo, audio: project.audio, audioName: project.audioName, music: project.music });
    await openProject(next); message('Template applied. Edit the scene text to tell your story.');
  })); $('templates').append(button);
});
Object.entries(PALETTES).forEach(([id, palette]) => {
  const button = document.createElement('button'); button.className = 'palette'; button.dataset.palette = id; button.type = 'button';
  const swatches = document.createElement('span'); swatches.className = 'swatches'; swatches.setAttribute('aria-hidden','true'); swatches.append(document.createElement('i'), document.createElement('i')); button.append(swatches, document.createTextNode(palette.name));
  button.addEventListener('click', () => { if (applyChange(p => p.palette = id)) populate(); }); $('palettes').append(button);
});
$('try-sample').addEventListener('click', () => guarded(async () => { if (recovered && !confirm('Replace the saved draft with the sample? Download the saved project first to keep it.')) return; await openProject(makeProject()); setStep(1); current = 1.2; render(); }));
$('start-new').addEventListener('click', () => guarded(async () => { if (recovered && !confirm('Replace the saved draft with a new video? Download the saved project first to keep it.')) return; await openProject(defaults(makeProject())); }));
$('resume').addEventListener('click', () => guarded(() => openProject(recovered)));
$('new-project').addEventListener('click', () => { if (busy) return; if (!confirm('Start a new video? Download your project file first to keep this draft.')) return; guarded(() => openProject(defaults(makeProject()))); });
$('back').addEventListener('click', () => { if (busy) return; if (step) setStep(step - 1); else { stop(); recovered = structuredClone(project); $('resume').hidden = false; $('workspace').hidden = true; $('welcome').hidden = false; inWorkspace = false; } });
$('next').addEventListener('click', () => { if (!busy) setStep(step + 1); });
document.querySelectorAll('[data-step]').forEach(el => el.addEventListener('click', () => { if (!busy) setStep(Number(el.dataset.step)); }));
for (const [id, key] of [['project-title','title'], ['format','format'], ['language','language'], ['brand-name','brand'], ['brand-url','url']]) {
  $(id).addEventListener('change', () => { applyChange(p => p[key] = $(id).value); populate(); });
}
$('duration').addEventListener('change', () => { applyChange(p => { const ratio = Number($('duration').value) / durationOf(p); p.scenes.forEach(s => s.duration *= ratio); }); populate(); });
for (const [id, key] of [['scene-title','title'], ['scene-body','body'], ['layout','layout'], ['effect','effect'], ['scene-duration','duration']]) {
  $(id).addEventListener('change', () => { applyChange(p => p.scenes[selected][key] = key === 'duration' ? Number($(id).value) : $(id).value); sceneTabs(); sceneForm(); current = project.scenes.slice(0, selected).reduce((n,s)=>n+s.duration,0)+1.3; render(); });
}
document.querySelectorAll('[data-point]').forEach(el => el.addEventListener('change', () => { applyChange(p => p.scenes[selected].points[Number(el.dataset.point)] = el.value); sceneForm(); }));
$('add-scene').addEventListener('click', () => { if (applyChange(p => p.scenes.push({ ...structuredClone(p.scenes[selected]), title: 'Your next idea', duration: 6, image: '' }))) { selected = project.scenes.length - 1; sceneTabs(); sceneForm(); } });
$('delete-scene').addEventListener('click', () => { if (busy || project.scenes.length === 1 || !confirm('Remove this scene?')) return; if (applyChange(p => p.scenes.splice(selected, 1))) { selected = Math.min(selected, project.scenes.length - 1); sceneTabs(); sceneForm(); } });
for (const [id, delta] of [['move-left',-1],['move-right',1]]) $(id).addEventListener('click', () => { const next = selected + delta; if (next < 0 || next >= project.scenes.length) return; if (applyChange(p => [p.scenes[selected], p.scenes[next]] = [p.scenes[next], p.scenes[selected]])) { selected = next; sceneTabs(); sceneForm(); } });
for (const [id, isLogo] of [['scene-image',false],['logo',true]]) $(id).addEventListener('change', () => guarded(async () => {
  const file = $(id).files[0]; if (!file) return; const { data, image } = await imageFile(file), next = structuredClone(project); if (isLogo) next.logo = data; else next.scenes[selected].image = data;
  project = validateProject(next); images.set(data, image); stop(); invalidateExport(); populate(); scheduleSave(); $(id).value = ''; message('Image added.');
}));
$('remove-image').addEventListener('click', () => { if (applyChange(p => p.scenes[selected].image = '')) sceneForm(); });
$('remove-logo').addEventListener('click', () => { if (applyChange(p => p.logo = '')) populate(); });
$('narration').addEventListener('change', () => guarded(async () => {
  const file = $('narration').files[0]; if (!file) return;
  if (file.size > 16 * 1024 * 1024 || !file.type.startsWith('audio/')) throw new Error('Choose an audio file up to 16 MB.');
  message('Reading narration…'); const data = await readData(file), next = validateProject({ ...project, audio: data, audioName: file.name.slice(0,120) }), decoded = await decodeNarration(data);
  stop(); project = next; narration = decoded; invalidateExport(); populate(); scheduleSave(); $('narration').value = ''; message('Narration added. Preview it with your scenes.');
}));
$('remove-audio').addEventListener('click', () => { if (applyChange(p => { p.audio = ''; p.audioName = ''; })) { narration = null; populate(); } });
$('fit-audio').addEventListener('click', () => { if (!narration || busy) return; try { project = fitNarration(project, narration.duration); stop(); invalidateExport(); populate(); scheduleSave(); message('Scene durations now fit your narration.'); } catch(e) { message(e.message + ' Add more scenes or shorten the narration, then try again.', true); } });
$('music').addEventListener('change', () => { applyChange(p => p.music = $('music').checked); });
$('save-brand').addEventListener('click', () => { if (busy) return; try { localStorage.setItem('utility-os:motion:brand', JSON.stringify({ brand: project.brand, url: project.url, logo: project.logo, palette: project.palette })); message('Brand defaults saved on this device.'); } catch { message('Brand defaults could not be saved. Download your project file instead.',true); } });
for (const id of ['import-welcome','import-editor']) $(id).addEventListener('change', () => guarded(async () => { await importFile($(id).files[0]); $(id).value = ''; }));
$('download-project').addEventListener('click', () => { if (busy) return; const json = JSON.stringify(project, null, 2); if (new Blob([json]).size > MAX_PROJECT_BYTES) { message('Project is too large. Remove some images or shorten narration before saving.',true); return; } download(new Blob([json], { type:'application/json' }), 'motion-studio-project.json'); message('Project download prepared, including your images and narration.'); });
$('copy-brief').addEventListener('click', () => guarded(async () => {
  const prompt = `Help me prepare a ${Math.round(durationOf(project))}-second ${project.format === 'wide' ? '16:9' : '9:16'} Motion Studio video called “${project.title}”, language ${project.language}. Ask about my topic and audience first. Propose scene headings (up to 80 characters), descriptions (up to 220 characters), timings, visuals and narration. Use no paid tools or APIs. Generate images only with the native image tool if available. I will enter the approved content into Motion Studio. Do not claim to have connected to the website.`;
  await navigator.clipboard.writeText(prompt); message('Planning prompt copied. Paste it into your existing ChatGPT conversation.');
}));
$('play').addEventListener('click', play);
$('expanded-play').addEventListener('click', play);
$('expand-preview').addEventListener('click', () => { if (busy) return; $('preview-dialog').showModal(); render(); });
$('close-preview').addEventListener('click', () => $('preview-dialog').close());
$('seek').addEventListener('input', () => { if (busy) return; stop(); current = Number($('seek').value); render(); });
$('sample-preview').addEventListener('click', () => {
  if (playing) { stop(); return; }
  stop(); const sample = makeProject(), sampleCanvas = $('welcome-canvas'); let origin = performance.now(); playing = true; $('sample-preview').textContent = 'Pause sample';
  function tick(now) { if (!playing) return; const t = (now - origin) / 1000; drawFrame(sampleCanvas.getContext('2d'), sample, Math.min(t,23.98)); if(t >= 24) stop(); else raf = requestAnimationFrame(tick); } raf = requestAnimationFrame(tick);
});
async function support() { const size = dimensions(project.format, Number($('resolution').value)); const candidates = await probeExport({ ...size, sampleRate:48000, numberOfChannels:2, fps:30 }); $('export-support').textContent = candidates.length ? `Available on this device: ${candidates.map(c=>c.format.toUpperCase()).join(', ')}.` : 'Video encoding is unavailable in this browser. Save your project and try a current desktop browser.'; return candidates; }
$('check-export').addEventListener('click', () => guarded(support));
$('export-video').addEventListener('click', () => guarded(async () => {
  stop(); invalidateExport(); const snapshot = validateProject(structuredClone(project)), audioBuffer = mixAudio(snapshot, narration), candidates = await support();
  const format = $('export-format').value; if (!candidates.some(c => c.format === format)) throw new Error(`${format.toUpperCase()} export is unavailable on this device. Choose an available format or save your project and use another browser.`);
  const size = dimensions(snapshot.format, Number($('resolution').value)), outputCanvas = document.createElement('canvas'); outputCanvas.width = size.width; outputCanvas.height = size.height;
  const outputCtx = outputCanvas.getContext('2d'); exportController = new AbortController(); $('export-progress').hidden = false; $('cancel-export').hidden = false;
  // Disable all project mutations while encoding; cancellation remains available.
  const disabled = [...document.querySelectorAll('#workspace button, #workspace input, #workspace select, #workspace textarea')].filter(el=>el!==$('cancel-export')).map(el=>[el,el.disabled]); disabled.forEach(([el])=>el.disabled=true);
  try {
    message('Rendering on your device. Keep this tab open.'); await document.fonts.ready;
    const blob = await exportLyrical({ canvas:outputCanvas, drawFrame:t=>drawFrame(outputCtx,snapshot,t,images), audioBuffer, duration:audioBuffer.duration, fps:30, format, signal:exportController.signal, onProgress:p=>{ $('export-progress').value=p; $('export-support').textContent = p < 100 ? `Rendering ${p}%` : 'Export complete.'; } });
    downloadUrl = URL.createObjectURL(blob); $('download-video').href = downloadUrl; $('download-video').download = `motion-studio.${format}`; $('download-video').hidden = false; message('Video ready. Download it below.');
  } catch(e) { if (e.name === 'AbortError') { $('export-support').textContent = 'Export cancelled. Your project is unchanged.'; message('Export cancelled.'); } else throw e; }
  finally { exportController=null; $('cancel-export').hidden=true; disabled.forEach(([el,was])=>el.disabled=was); }
}));
$('cancel-export').addEventListener('click', () => exportController?.abort());
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stop(); });
window.addEventListener('beforeunload', e => { if (busy || $('save-state').textContent === 'Saving…') { e.preventDefault(); e.returnValue = ''; } });
drawFrame($('welcome-canvas').getContext('2d'), makeProject(), 1.4);
try { const saved = await draft('read'); if (saved) { recovered=validateProject(saved); $('resume').hidden=false; } } catch { message('Saved drafts are unavailable. You can still create and download project files.',true); }
