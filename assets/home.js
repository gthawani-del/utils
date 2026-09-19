import { clearWorkspace } from '/lib/security/workspace.js';

const tools = [
  ['Image Studio', 'Resize, crop, convert, compress, rotate, strip metadata, and batch export images.', '/image', true, 'IMG'],
  ['Media Editor + Transcriber', 'Local media editing and transcription workflows.', '/media', true, 'MED'],
  ['Docs Reader', 'Inspect and work with documents locally.', '#', false, 'DOC'],
  ['Decision Room', 'Structured decision analysis without unnecessary services.', '#', false, 'DEC'],
  ['Data Analyst', 'Explore and transform datasets in-browser.', '#', false, 'DAT'],
  ['Data Room Inspector', 'Inspect folders and document sets with local-first controls.', '#', false, 'DRI'],
  ['OCR + Scanner', 'Scan, clean, and extract text locally where supported.', '#', false, 'OCR'],
  ['Offline Research', 'Organize research material without cloud dependency.', '#', false, 'RES'],
  ['Workflow Builder', 'Compose repeatable utility workflows.', '#', false, 'FLW'],
  ['Game / Simulation Lab', 'Small simulations, probability tools, and interactive experiments.', '#', false, 'LAB']
];

const grid = document.querySelector('#tool-grid');
for (const [name, description, href, active, code] of tools) {
  const article = document.createElement('article');
  article.className = `tool-card${active ? ' active-card' : ''}`;
  const icon = document.createElement('div'); icon.className = 'tool-icon'; icon.textContent = code;
  const meta = document.createElement('div'); meta.className = 'tool-meta';
  const title = document.createElement('h3'); title.textContent = name;
  const copy = document.createElement('p'); copy.textContent = description;
  const badge = document.createElement(active ? 'a' : 'span');
  badge.className = active ? 'tool-action' : 'coming-badge';
  badge.textContent = active ? 'Open tool →' : 'Coming Soon';
  if (active) { badge.href = href; badge.setAttribute('aria-label', `Open ${name}`); }
  meta.append(title, copy, badge); article.append(icon, meta); grid.append(article);
}

document.querySelector('#clear-workspace').addEventListener('click', async () => {
  await clearWorkspace();
  const button = document.querySelector('#clear-workspace');
  button.textContent = 'Workspace cleared';
  setTimeout(() => { button.textContent = 'Clear workspace'; }, 1600);
});
