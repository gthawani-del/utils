import {
  ORIGINAL_VERSION_ID,
  activeVersion,
  editingBaseLabel,
  normalizeVersionState,
  originalSourceNode
} from './model.js';

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  const whole = Math.max(0, Math.round(value));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function metric(label, value) {
  const item = document.createElement('div');
  const term = document.createElement('span');
  const data = document.createElement('strong');
  term.textContent = label;
  data.textContent = value || '—';
  item.append(term, data);
  return item;
}

function showDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function initVersionWorkspace({
  getProject,
  getSource,
  saveVersioning,
  setStatus
}) {
  const shell = document.querySelector('#version-shell');
  const baseLabel = document.querySelector('#version-editing-base');
  const activeLabel = document.querySelector('#version-active-label');
  const previewBadge = document.querySelector('#version-preview-badge');
  const createButton = document.querySelector('#version-create');
  const historyButton = document.querySelector('#version-history-open');
  const historyDialog = document.querySelector('#version-history-dialog');
  const historyClose = document.querySelector('#version-history-close');
  const historyList = document.querySelector('#version-history-list');
  const historyEmpty = document.querySelector('#version-history-empty');
  const originalMetrics = document.querySelector('#compare-original-metrics');
  const originalName = document.querySelector('#compare-original-name');
  const resultTitle = document.querySelector('#compare-result-title');
  const resultMetrics = document.querySelector('#compare-result-metrics');
  const resultEmpty = document.querySelector('#compare-result-empty');
  const compareShell = document.querySelector('#version-compare-shell');
  const modeButtons = [...document.querySelectorAll('[data-compare-mode]')];
  const mobileButtons = [...document.querySelectorAll('[data-mobile-compare]')];

  let compareMode = 'side-by-side';
  let mobileView = 'original';

  function state() {
    return normalizeVersionState({
      versions: getProject().versions,
      activeVersionId: getProject().activeVersionId,
      baseVersionId: getProject().baseVersionId
    });
  }

  function sourceIsLinked() {
    const source = getSource();
    return Boolean(source && (source.kind !== 'local-file' || source.objectUrl));
  }

  function renderOriginal() {
    originalMetrics.replaceChildren();
    const original = originalSourceNode(getSource());
    if (!original) {
      originalName.textContent = 'Original source';
      return;
    }

    originalName.textContent = getSource()?.name || 'Original source';
    originalMetrics.append(
      metric('Role', 'Immutable source'),
      metric('Duration', formatDuration(original.duration)),
      metric('Size', formatBytes(original.bytes)),
      metric('Format', String(original.format || '—').toUpperCase())
    );
    if (original.mediaType === 'video') {
      originalMetrics.append(metric(
        'Dimensions',
        original.width && original.height ? `${original.width} × ${original.height}` : '—'
      ));
    }
  }

  function versionHistoryRow(version) {
    const row = document.createElement('article');
    row.className = 'version-history-row';

    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = version.name;
    const parent = document.createElement('span');
    const parentName = version.parentVersionId === ORIGINAL_VERSION_ID
      ? 'Original'
      : state().versions.find((item) => item.id === version.parentVersionId)?.name || version.parentVersionId;
    parent.textContent = `Parent: ${parentName}`;
    identity.append(name, parent);

    const status = document.createElement('span');
    status.className = 'version-history-status';
    status.dataset.status = version.status;
    status.textContent = version.status === 'ready' ? 'Ready'
      : version.status === 'rendering' ? 'Rendering'
      : 'Failed';

    row.append(identity, status);
    return row;
  }

  function renderHistory() {
    const current = state();
    historyList.replaceChildren();

    const original = document.createElement('article');
    original.className = 'version-history-row original-version';
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = 'Original';
    const note = document.createElement('span');
    note.textContent = 'Immutable source · never overwritten';
    copy.append(name, note);
    const badge = document.createElement('span');
    badge.className = 'version-history-status';
    badge.dataset.status = 'original';
    badge.textContent = 'Source';
    original.append(copy, badge);
    historyList.append(original);

    for (const version of current.versions) historyList.append(versionHistoryRow(version));
    historyEmpty.classList.toggle('hidden', current.versions.length > 0);
  }

  function renderResult() {
    const current = state();
    const active = activeVersion(current);
    resultMetrics.replaceChildren();

    if (!active) {
      resultTitle.textContent = 'No rendered result';
      resultEmpty.classList.remove('hidden');
      resultMetrics.classList.add('hidden');
      return;
    }

    resultTitle.textContent = active.name;
    resultEmpty.classList.add('hidden');
    resultMetrics.classList.remove('hidden');
    resultMetrics.append(
      metric('Status', active.status),
      metric('Duration', formatDuration(active.outputDuration)),
      metric('Size', formatBytes(active.outputBytes)),
      metric('Format', String(active.outputFormat || '—').toUpperCase())
    );
    if (active.outputWidth && active.outputHeight) {
      resultMetrics.append(metric('Dimensions', `${active.outputWidth} × ${active.outputHeight}`));
    }
  }

  function renderCompareControls() {
    const hasResult = Boolean(activeVersion(state()));
    compareShell.dataset.mode = compareMode;
    compareShell.dataset.mobileView = hasResult ? mobileView : 'original';

    for (const button of modeButtons) {
      const mode = button.dataset.compareMode;
      button.classList.toggle('active', mode === compareMode);
      button.disabled = mode === 'ab' && !hasResult;
    }

    for (const button of mobileButtons) {
      const view = button.dataset.mobileCompare;
      button.classList.toggle('active', view === (hasResult ? mobileView : 'original'));
      button.disabled = view === 'result' && !hasResult;
    }
  }

  function render() {
    const current = state();
    const linked = sourceIsLinked();
    shell.classList.toggle('hidden', !linked);
    if (!linked) return;

    baseLabel.textContent = `Editing from: ${editingBaseLabel(current)}`;
    const active = activeVersion(current);
    activeLabel.textContent = active ? `Active version: ${active.name}` : 'Active version: Original';
    previewBadge.textContent = 'Preview';
    previewBadge.dataset.status = 'preview';
    createButton.disabled = getSource()?.kind !== 'local-file';

    renderOriginal();
    renderResult();
    renderHistory();
    renderCompareControls();
  }

  function createVersionPlaceholder() {
    if (getSource()?.kind !== 'local-file') {
      setStatus('Create Version requires a relinked local media source.');
      return;
    }

    setStatus('Preview only: no rendered version was created. Real Create Version processing starts after the render-worker foundation is implemented.');
    previewBadge.textContent = 'Preview · not rendered';
  }

  createButton.addEventListener('click', createVersionPlaceholder);
  historyButton.addEventListener('click', () => {
    renderHistory();
    showDialog(historyDialog);
  });
  historyClose.addEventListener('click', () => closeDialog(historyDialog));
  historyDialog.addEventListener('click', (event) => {
    if (event.target === historyDialog) closeDialog(historyDialog);
  });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      compareMode = button.dataset.compareMode;
      renderCompareControls();
    });
  }

  for (const button of mobileButtons) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      mobileView = button.dataset.mobileCompare;
      renderCompareControls();
    });
  }

  const normalized = state();
  saveVersioning(normalized);
  render();

  return {
    refresh: render,
    onSourceChanged() {
      render();
    },
    resetForNewSource() {
      saveVersioning({ versions: [], activeVersionId: null, baseVersionId: ORIGINAL_VERSION_ID });
      compareMode = 'side-by-side';
      mobileView = 'original';
      render();
    }
  };
}
