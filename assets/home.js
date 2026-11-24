import { clearWorkspace } from '/lib/security/workspace.js';

import { categories, makeToolCard, matchesTool, quickTools, tools } from '/assets/tool-directory.js';

const categoryGrid = document.querySelector('#category-grid');
categoryGrid.append(...categories.map(category => makeToolCard(category, 'category')));
document.querySelector('#quick-tools').append(...quickTools.map(tool => makeToolCard(tool, 'quick')));
const studioIds = ['image-editor', 'video-editor', 'lyrical', 'motion'];
document.querySelector('#studio-tools').append(...studioIds.map(id => makeToolCard(tools.find(tool => tool.id === id), 'tool')));

const search = document.querySelector('#tool-search');
const results = document.querySelector('#search-results');
search.addEventListener('input', () => {
  results.replaceChildren();
  const query = search.value.trim();
  results.hidden = query.length === 0;
  if (!query) { document.querySelector('#search-status').textContent = ''; return; }
  const destinations = new Set();
  const matches = tools.filter(tool => {
    if (!matchesTool(tool, query) || destinations.has(tool.href)) return false;
    destinations.add(tool.href);
    return true;
  }).slice(0, 8);
  document.querySelector('#search-status').textContent = `${matches.length} matching tools`;
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No tools match that search.';
    results.append(empty);
    return;
  }
  for (const tool of matches) {
    const link = document.createElement('a');
    link.href = tool.href;
    link.textContent = tool.label;
    results.append(link);
  }
});
search.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    search.value = '';
    search.dispatchEvent(new Event('input'));
  }
});

document.querySelectorAll('[data-open]').forEach(button => {
  button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
});
document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
document.querySelector('#clear-workspace').addEventListener('click', async event => {
  if (!confirm('Delete saved drafts and local preferences from this browser? Download any work you want to keep first. This cannot be undone.')) return;
  event.currentTarget.disabled = true;
  const status = document.querySelector('#storage-status');
  try {
    await clearWorkspace();
    status.textContent = 'Saved workspace cleared.';
  } catch {
    status.textContent = 'Some saved data could not be cleared. You can try again.';
  } finally {
    document.querySelector('#clear-workspace').disabled = false;
  }
});
