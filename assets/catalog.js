import { categories, makeToolCard, matchesTool, tools } from '/assets/tool-directory.js';

const id = document.body.dataset.category || new URLSearchParams(location.search).get('category');
const category = categories.find(category => category.id === id);
const selection = category ? tools.filter(tool => tool.category === category.id) : tools;
const filters = document.querySelector('#category-filters');
const search = document.querySelector('#category-search');
const results = document.querySelector('#category-results');
const count = document.querySelector('#category-result-count');
let group = 'All';

if (category && id !== 'images') {
  document.querySelector('#category-heading').textContent = category.label;
  document.querySelector('#category-description').textContent = category.intro;
  document.title = category.label + ' · Utility OS';
}
const groups = [...new Set(selection.map(tool => tool.group))];
if (groups.length > 1) {
  for (const label of ['All', ...groups]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(label === group));
    button.addEventListener('click', () => {
      group = label;
      for (const filter of filters.children) filter.setAttribute('aria-pressed', String(filter === button));
      render();
    });
    filters.append(button);
  }
} else {
  filters.hidden = true;
}

function render() {
  const feature = document.querySelector('#image-studio-feature');
  const showFeature = Boolean(feature) && group === 'All' && !search.value.trim();
  if (feature) feature.hidden = !showFeature;
  const matches = selection.filter(tool => (group === 'All' || tool.group === group)
    && (!showFeature || tool.id !== 'image-studio') && matchesTool(tool, search.value));
  count.textContent = `${matches.length} matching tools`;
  results.replaceChildren(...matches.map(tool => makeToolCard(tool, 'tool')));
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'directory-empty';
    empty.textContent = 'No tools match. Try a different search.';
    results.append(empty);
  }
}
search.addEventListener('input', render);
render();
