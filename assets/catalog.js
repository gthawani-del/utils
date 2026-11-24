import { examples } from '/lib/image/art-examples.js';
import { recipeHash } from '/lib/image/art-recipe.js';
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

const artFeature = document.querySelector('#images-art-feature');
if (artFeature) {
  const examplesList = document.querySelector('#images-art-examples');
  for (const example of examples) {
    const link = document.createElement('a');
    link.href = '/image/algorithmic-drawing' + recipeHash(example.settings);
    const art = document.createElement('img');
    art.src = '/assets/art/' + example.image + '-example.webp';
    art.alt = '';
    art.loading = 'lazy';
    const name = document.createElement('strong');
    name.textContent = example.name;
    link.append(art, name);
    examplesList.append(link);
  }
}

function render() {
  const showFeature = Boolean(artFeature) && group === 'All' && !search.value.trim();
  if (artFeature) artFeature.hidden = !showFeature;
  const matches = selection.filter(tool => (group === 'All' || tool.group === group)
    && (!showFeature || tool.id !== 'drawing') && matchesTool(tool, search.value));
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
