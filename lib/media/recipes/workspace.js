import {
  builtInRecipes,
  createCustomRecipe,
  deleteCustomRecipe,
  duplicateRecipe,
  loadCustomRecipes,
  updateCustomRecipe
} from './store.js';

export function initRecipeWorkspace({
  loadCommandPlan,
  setStatus
}) {
  const dialog = document.querySelector('#recipe-dialog');
  const closeButton = document.querySelector('#recipe-close');
  const saveBox = document.querySelector('#recipe-save-box');
  const saveTitle = document.querySelector('#recipe-save-title');
  const saveName = document.querySelector('#recipe-save-name');
  const saveButton = document.querySelector('#recipe-save-confirm');
  const saveCancel = document.querySelector('#recipe-save-cancel');
  const builtInList = document.querySelector('#recipe-builtins');
  const customList = document.querySelector('#recipe-customs');
  const customEmpty = document.querySelector('#recipe-custom-empty');
  const status = document.querySelector('#recipe-status');

  let pendingActions = [];
  let pendingRecipeId = null;

  function openDialog() {
    render();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function clearSaveBox() {
    pendingActions = [];
    pendingRecipeId = null;
    saveName.value = '';
    saveBox.classList.add('hidden');
  }

  function report(message) {
    status.textContent = message;
    setStatus(message);
  }

  function applyRecipe(recipe, editing = false) {
    loadCommandPlan(recipe.actions, {
      recipeId: editing && recipe.origin === 'custom' ? recipe.id : null,
      recipeName: recipe.name,
      source: 'recipe'
    });
    closeDialog();
    report(`${recipe.name} loaded as Planned Actions. Review, then choose Preview or Create Version.`);
  }

  function recipeCard(recipe) {
    const card = document.createElement('article');
    card.className = 'recipe-card';
    card.dataset.origin = recipe.origin;

    const heading = document.createElement('div');
    heading.className = 'recipe-card-heading';

    const copy = document.createElement('div');
    if (recipe.origin === 'custom') {
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.value = recipe.name;
      name.setAttribute('aria-label', 'Recipe name');
      copy.append(name);

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = 'Rename';
      rename.addEventListener('click', () => {
        const result = updateCustomRecipe(recipe.id, { name: name.value });
        report(result.ok ? 'Recipe renamed locally.' : result.reason);
        render();
      });
      heading.append(copy, rename);
    } else {
      const name = document.createElement('strong');
      name.textContent = recipe.name;
      copy.append(name);
      heading.append(copy);
    }

    const description = document.createElement('p');
    description.textContent = recipe.description;

    const count = document.createElement('span');
    count.className = 'recipe-action-count';
    count.textContent = `${recipe.actions.length} deterministic action${recipe.actions.length === 1 ? '' : 's'}`;

    const actions = document.createElement('div');
    actions.className = 'recipe-card-actions';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'media-button empty-primary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => applyRecipe(recipe, false));
    actions.append(apply);

    const duplicate = document.createElement('button');
    duplicate.type = 'button';
    duplicate.className = 'media-button';
    duplicate.textContent = 'Duplicate';
    duplicate.addEventListener('click', () => {
      const result = duplicateRecipe(recipe);
      report(result.ok ? 'Recipe duplicated into My Recipes.' : result.reason);
      render();
    });
    actions.append(duplicate);

    if (recipe.origin === 'custom') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'media-button';
      edit.textContent = 'Edit actions';
      edit.addEventListener('click', () => applyRecipe(recipe, true));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'media-button recipe-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        const approved = typeof globalThis.confirm === 'function'
          ? globalThis.confirm(`Delete recipe “${recipe.name}”?`)
          : true;
        if (!approved) return;
        const result = deleteCustomRecipe(recipe.id);
        report(result.ok ? 'Recipe deleted from this browser.' : result.reason);
        render();
      });
      actions.append(edit, remove);
    }

    card.append(heading, description, count, actions);
    return card;
  }

  function render() {
    builtInList.replaceChildren();
    customList.replaceChildren();

    for (const recipe of builtInRecipes()) builtInList.append(recipeCard(recipe));

    const custom = loadCustomRecipes();
    customEmpty.classList.toggle('hidden', custom.length > 0);
    for (const recipe of custom) customList.append(recipeCard(recipe));
  }

  function openSave(actions, context = {}) {
    pendingActions = Array.isArray(actions) ? actions : [];
    pendingRecipeId = context?.recipeId || null;
    saveTitle.textContent = pendingRecipeId ? 'Update recipe from Planned Actions' : 'Save Planned Actions as recipe';
    saveName.value = context?.recipeName || '';
    saveButton.textContent = pendingRecipeId ? 'Update recipe' : 'Save recipe';
    saveBox.classList.remove('hidden');
    openDialog();
    saveName.focus();
  }

  saveButton.addEventListener('click', () => {
    if (!pendingActions.length) {
      report('There are no deterministic actions to save.');
      return;
    }

    const result = pendingRecipeId
      ? updateCustomRecipe(pendingRecipeId, { name: saveName.value, actions: pendingActions })
      : createCustomRecipe({ name: saveName.value, actions: pendingActions });

    if (!result.ok) {
      report(result.reason);
      return;
    }

    report(pendingRecipeId ? 'Recipe updated locally.' : 'Recipe saved locally.');
    clearSaveBox();
    render();
  });

  saveCancel.addEventListener('click', clearSaveBox);
  closeButton.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  render();

  return {
    open: openDialog,
    openSave,
    refresh: render
  };
}
