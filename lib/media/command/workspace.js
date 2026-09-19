import { parseCommand, reevaluateAction } from './grammar.js';

function actionStatusLabel(status) {
  return status === 'ready' ? 'Ready' : 'Blocked';
}

export function initCommandAssistant({
  getProject,
  executeAction,
  setStatus
}) {
  const form = document.querySelector('#command-form');
  const input = document.querySelector('#command-input');
  const message = document.querySelector('#command-message');
  const panel = document.querySelector('#command-plan');
  const list = document.querySelector('#command-plan-list');
  const runButton = document.querySelector('#command-run-plan');
  const clearButton = document.querySelector('#command-clear-plan');
  const summary = document.querySelector('#command-plan-summary');

  let plan = null;

  function reevaluate() {
    if (!plan) return;
    plan.actions = plan.actions.map((item) => reevaluateAction(item, getProject()));
  }

  function move(index, direction) {
    const target = index + direction;
    if (!plan || target < 0 || target >= plan.actions.length) return;
    const next = [...plan.actions];
    [next[index], next[target]] = [next[target], next[index]];
    plan.actions = next;
    render();
  }

  function remove(index) {
    if (!plan) return;
    plan.actions.splice(index, 1);
    render();
  }

  function updateParam(index, key, value, type) {
    if (!plan?.actions[index]) return;
    const parsed = type === 'number' ? Number(value) : value;
    plan.actions[index].params = { ...plan.actions[index].params, [key]: parsed };
    plan.actions[index] = reevaluateAction(plan.actions[index], getProject());
    render();
  }

  function parameterControl(item, index, definition) {
    const label = document.createElement('label');
    label.className = 'command-param';
    const text = document.createElement('span');
    text.textContent = definition.label;
    label.append(text);

    let control;
    if (definition.type === 'select') {
      control = document.createElement('select');
      for (const option of definition.options || []) {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        control.append(node);
      }
      control.value = String(item.params[definition.key] ?? '');
    } else {
      control = document.createElement('input');
      control.type = 'number';
      if (definition.min !== undefined) control.min = String(definition.min);
      if (definition.max !== undefined) control.max = String(definition.max);
      if (definition.step !== undefined) control.step = String(definition.step);
      control.value = String(item.params[definition.key] ?? '');
    }

    control.addEventListener('change', () => updateParam(index, definition.key, control.value, definition.type));
    label.append(control);
    return label;
  }

  function actionRow(item, index) {
    const row = document.createElement('article');
    row.className = 'command-plan-item';
    row.dataset.status = item.status;

    const order = document.createElement('div');
    order.className = 'command-plan-order';
    order.textContent = String(index + 1);

    const body = document.createElement('div');
    body.className = 'command-plan-body';

    const heading = document.createElement('div');
    heading.className = 'command-plan-heading';
    const title = document.createElement('strong');
    title.textContent = item.label;
    const badge = document.createElement('span');
    badge.className = 'command-plan-badge';
    badge.textContent = actionStatusLabel(item.status);
    heading.append(title, badge);

    const reason = document.createElement('p');
    reason.textContent = item.reason;

    body.append(heading, reason);

    if (item.adjustable?.length) {
      const parameters = document.createElement('div');
      parameters.className = 'command-params';
      for (const definition of item.adjustable) parameters.append(parameterControl(item, index, definition));
      body.append(parameters);
    }

    const controls = document.createElement('div');
    controls.className = 'command-plan-controls';

    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.setAttribute('aria-label', 'Move action up');
    up.disabled = index === 0;
    up.addEventListener('click', () => move(index, -1));

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.setAttribute('aria-label', 'Move action down');
    down.disabled = index === plan.actions.length - 1;
    down.addEventListener('click', () => move(index, 1));

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => remove(index));

    controls.append(up, down, removeButton);
    row.append(order, body, controls);
    return row;
  }

  function render() {
    if (!plan) {
      panel.classList.add('hidden');
      list.replaceChildren();
      return;
    }

    reevaluate();
    panel.classList.remove('hidden');
    list.replaceChildren();

    for (const [index, item] of plan.actions.entries()) list.append(actionRow(item, index));

    if (!plan.actions.length) {
      const empty = document.createElement('p');
      empty.className = 'command-plan-empty';
      empty.textContent = 'No actions remain in this plan.';
      list.append(empty);
    }

    const ready = plan.actions.filter((item) => item.status === 'ready').length;
    const blocked = plan.actions.filter((item) => item.status === 'blocked').length;
    summary.textContent = `${plan.actions.length} planned · ${ready} ready · ${blocked} blocked`;
    runButton.disabled = !plan.actions.length || blocked > 0;
    runButton.title = blocked ? 'Remove or resolve blocked actions before running the plan.' : '';
  }

  async function runPlan() {
    if (!plan?.actions.length) return;
    reevaluate();
    if (plan.actions.some((item) => item.status !== 'ready')) {
      message.textContent = 'Resolve or remove blocked actions before running the plan.';
      render();
      return;
    }

    runButton.disabled = true;
    const completed = [];

    try {
      for (const item of plan.actions) {
        const result = await executeAction(item);
        if (!result?.ok) {
          throw new Error(result?.reason || `Could not execute: ${item.label}`);
        }
        completed.push(item.label);
      }

      const text = `Completed ${completed.length} deterministic action${completed.length === 1 ? '' : 's'}.`;
      message.textContent = text;
      setStatus(text);
      plan = null;
      render();
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Command execution stopped before completion.';
      message.textContent = `${text} Completed before stop: ${completed.length}.`;
      setStatus(message.textContent);
      render();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      message.textContent = 'Enter an outcome first. No command has been executed.';
      return;
    }

    plan = parseCommand(value, getProject());
    if (plan.unrecognized) {
      message.textContent = 'No supported deterministic actions were recognized. Try a specific command such as “trim from 5s to 20s”, “volume 80%”, “make 9:16”, or “run QC”.';
    } else {
      const blocked = plan.actions.filter((item) => item.status === 'blocked').length;
      message.textContent = blocked
        ? 'Planned Actions created. Review the blocked items before running.'
        : 'Planned Actions created. Inspect, reorder or adjust them before running.';
    }
    render();
  });

  runButton.addEventListener('click', runPlan);
  clearButton.addEventListener('click', () => {
    plan = null;
    message.textContent = 'Command plan cleared. Nothing was executed.';
    render();
  });

  return {
    refresh() {
      if (plan) render();
    }
  };
}
