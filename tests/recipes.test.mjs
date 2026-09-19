import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSpecsFromPlan, planFromActionSpecs } from '../lib/media/command/grammar.js';
import {
  builtInRecipes,
  createCustomRecipe,
  deleteCustomRecipe,
  duplicateRecipe,
  loadCustomRecipes,
  updateCustomRecipe
} from '../lib/media/recipes/store.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const project = { source: { kind: 'local-file', mediaType: 'audio', duration: 60 } };

test('built-in recipes contain deterministic action specs only', () => {
  const recipes = builtInRecipes();
  assert.equal(recipes.length, 9);
  assert.equal(recipes.every((recipe) => recipe.actions.length > 0), true);
  assert.equal(recipes.find((recipe) => recipe.name === 'Instagram Reel').actions[0].params.aspect, '9:16');
});

test('recipe action specs hydrate through the Command Assistant readiness model', () => {
  const recipe = builtInRecipes().find((item) => item.name === 'Podcast Clean');
  const plan = planFromActionSpecs(recipe.actions, project);
  assert.equal(plan.find((item) => item.type === 'normalize-audio').status, 'blocked');
  assert.equal(plan.find((item) => item.type === 'run-qc').status, 'ready');
  assert.deepEqual(actionSpecsFromPlan(plan), recipe.actions);
});

test('custom recipes persist, rename and edit in browser storage', () => {
  const storage = memoryStorage();
  const created = createCustomRecipe({
    name: 'My Reel',
    actions: [{ type: 'set-aspect', params: { aspect: '9:16' } }, { type: 'run-qc', params: {} }]
  }, storage);
  assert.equal(created.ok, true);
  assert.equal(loadCustomRecipes(storage).length, 1);

  const updated = updateCustomRecipe(created.recipe.id, {
    name: 'Client Reel',
    actions: [{ type: 'set-aspect', params: { aspect: '1:1' } }]
  }, storage);
  assert.equal(updated.ok, true);
  assert.equal(loadCustomRecipes(storage)[0].name, 'Client Reel');
  assert.equal(loadCustomRecipes(storage)[0].actions[0].params.aspect, '1:1');
});

test('recipes duplicate and delete without modifying the original', () => {
  const storage = memoryStorage();
  const created = createCustomRecipe({ name: 'Base', actions: [{ type: 'run-qc', params: {} }] }, storage);
  const copy = duplicateRecipe(created.recipe, storage);
  assert.equal(copy.ok, true);
  assert.equal(loadCustomRecipes(storage).length, 2);
  assert.notEqual(copy.recipe.id, created.recipe.id);

  const removed = deleteCustomRecipe(created.recipe.id, storage);
  assert.equal(removed.ok, true);
  assert.equal(loadCustomRecipes(storage).length, 1);
  assert.equal(loadCustomRecipes(storage)[0].id, copy.recipe.id);
});
