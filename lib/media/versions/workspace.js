import { MediaRenderRunner } from '../render/runner.js';
import {
  compareReference,
  durationSyncMode,
  equivalentCompareTime,
  measuredComparison
} from '../compare/model.js';
import {
  deleteVersionState,
  duplicateVersionState,
  renameVersionState,
  setActiveVersionState,
  setBranchBaseState
} from './actions.js';
import {
  ORIGINAL_VERSION_ID,
  activeVersion,
  editingBaseLabel,
  normalizeVersionState,
  originalSourceNode,
  sourceMetadataFingerprint
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
  getPlayer,
  getVideoEdits,
  getAudioEdits,
  resetEditsForBase,
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
  const compareLeftRole = document.querySelector('#compare-left-role');
  const compareLeftState = document.querySelector('#compare-left-state');
  const referencePlaceholder = document.querySelector('#compare-reference-placeholder');
  const referencePlaceholderTitle = document.querySelector('#compare-reference-placeholder-title');
  const referencePlaceholderCopy = document.querySelector('#compare-reference-placeholder-copy');
  const compareReferenceSelect = document.querySelector('#compare-reference-select');
  const compareParentOption = compareReferenceSelect.querySelector('option[value="parent"]');
  const compareSyncNote = document.querySelector('#compare-sync-note');
  const measuredPanel = document.querySelector('#compare-measured-panel');
  const measuredGrid = document.querySelector('#compare-measured-grid');
  const compareChangeList = document.querySelector('#compare-change-list');
  const resultTitle = document.querySelector('#compare-result-title');
  const resultStatus = document.querySelector('#compare-result-status');
  const resultMetrics = document.querySelector('#compare-result-metrics');
  const originalPlayer = document.querySelector('#compare-original-player');
  const resultPlayer = document.querySelector('#compare-result-player');
  const exportButton = document.querySelector('#version-export');
  const resultEmpty = document.querySelector('#compare-result-empty');
  const compareShell = document.querySelector('#version-compare-shell');
  const renderProofButton = document.querySelector('#render-proof-start');
  const renderCancelButton = document.querySelector('#render-proof-cancel');
  const renderProgress = document.querySelector('#render-proof-progress');
  const renderState = document.querySelector('#render-proof-state');
  const renderElapsed = document.querySelector('#render-proof-elapsed');
  const modeButtons = [...document.querySelectorAll('[data-compare-mode]')];
  const mobileButtons = [...document.querySelectorAll('[data-mobile-compare]')];
  const abButtons = [...document.querySelectorAll('[data-ab-side]')];

  let compareMode = 'side-by-side';
  let mobileView = 'original';
  let compareReferencePreference = 'original';
  let abSide = 'a';
  let syncLock = false;
  const syncedSeeks = new WeakSet();
  let compareDisposers = [];
  const renderRunner = new MediaRenderRunner();
  let renderAbort = null;
  let elapsedTimer = 0;
  let renderStartedAt = 0;
  const versionUrls = new Map();
  const versionBlobs = new Map();

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

  function newVersionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `version-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function renderSourceForBase() {
    const source = getSource();
    const current = state();
    if (!source || current.baseVersionId === ORIGINAL_VERSION_ID) return source;

    const base = current.versions.find((version) => version.id === current.baseVersionId);
    const blob = versionBlobs.get(current.baseVersionId);
    const url = versionUrls.get(current.baseVersionId);
    if (!base || !blob || !url || base.status !== 'ready') return null;

    return {
      ...source,
      kind: 'local-file',
      name: base.name,
      file: blob,
      objectUrl: url,
      bytes: blob.size,
      detectedMime: blob.type,
      container: base.outputFormat,
      duration: base.outputDuration,
      width: base.outputWidth || source.width || null,
      height: base.outputHeight || source.height || null
    };
  }

  function mutationAllowed() {
    if (!renderRunner.activeJob) return true;
    setStatus('Finish or cancel the current render before changing Version lineage.');
    return false;
  }

  function button(label, handler, { disabled = false, title = '' } = {}) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.disabled = disabled;
    if (title) node.title = title;
    node.addEventListener('click', handler);
    return node;
  }

  function applyPlayerBase(url, duration) {
    const player = getPlayer();
    if (player && url) {
      try { player.pause(); } catch {}
      player.src = url;
      try { player.load(); } catch {}
      player.currentTime = 0;
    }
    resetEditsForBase?.(duration);
  }

  function branchFrom(id) {
    if (!mutationAllowed()) return;
    const current = state();
    if (id !== ORIGINAL_VERSION_ID && !versionBlobs.has(id)) {
      setStatus('This Version output is not available in the current browser session. Re-render it before branching.');
      return;
    }

    const result = setBranchBaseState(current, id);
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }

    saveVersioning(result.state);
    if (id === ORIGINAL_VERSION_ID) {
      const source = getSource();
      applyPlayerBase(source?.objectUrl || '', Number(source?.duration || 0));
      setStatus('Editing base changed to Original. New Versions will branch from the immutable source.');
    } else {
      const version = result.state.versions.find((item) => item.id === id);
      applyPlayerBase(versionUrls.get(id), Number(version?.outputDuration || 0));
      setStatus(`Editing base changed to ${version?.name || 'Version'}. New renders will use that real Version as their parent.`);
    }
    render();
  }

  function setActive(id) {
    if (!mutationAllowed()) return;
    const result = setActiveVersionState(state(), id);
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }
    saveVersioning(result.state);
    mobileView = id === ORIGINAL_VERSION_ID ? 'original' : 'result';
    setStatus(id === ORIGINAL_VERSION_ID ? 'Original is now active.' : 'Selected Version is now active.');
    render();
  }

  function renameVersion(version) {
    if (!mutationAllowed()) return;
    const next = typeof globalThis.prompt === 'function'
      ? globalThis.prompt('Rename Version', version.name)
      : null;
    if (next === null) return;
    const result = renameVersionState(state(), version.id, next);
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }
    saveVersioning(result.state);
    setStatus('Version renamed.');
    render();
  }

  function duplicateVersion(version) {
    if (!mutationAllowed()) return;
    const blob = versionBlobs.get(version.id);
    if (!blob) {
      setStatus('This Version output is not available in the current browser session, so it cannot be duplicated safely.');
      return;
    }

    const id = newVersionId();
    const url = URL.createObjectURL(blob);
    const result = duplicateVersionState(state(), version.id, {
      newId: id,
      createdAt: new Date().toISOString(),
      blobRef: { kind: 'session-blob-url', url, storageKey: '', sessionOnly: true },
      sessionAvailable: true
    });
    if (!result.ok) {
      URL.revokeObjectURL(url);
      setStatus(result.reason);
      return;
    }

    versionBlobs.set(id, blob);
    versionUrls.set(id, url);
    saveVersioning(result.state);
    setStatus(`${result.version.name} duplicated as a separate Version artifact.`);
    render();
  }

  function deleteVersion(version) {
    if (!mutationAllowed()) return;
    const approved = typeof globalThis.confirm === 'function'
      ? globalThis.confirm(`Delete “${version.name}”? Original media will not be deleted.`)
      : true;
    if (!approved) return;

    const result = deleteVersionState(state(), version.id);
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }

    const url = versionUrls.get(version.id);
    if (url) URL.revokeObjectURL(url);
    versionUrls.delete(version.id);
    versionBlobs.delete(version.id);
    saveVersioning(result.state);
    setStatus(`${version.name} deleted. Original remains safe.`);
    render();
  }

  function versionUrl(version) {
    if (!version) return '';
    return versionUrls.get(version.id) || (version.sessionAvailable ? version.blobRef?.url : '') || '';
  }

  function referenceDescriptor(active) {
    const current = state();
    const reference = compareReference(active, current.versions, compareReferencePreference);
    if (reference.type === 'parent' && reference.version) {
      const version = reference.version;
      return {
        type: 'parent',
        id: version.id,
        name: version.name,
        duration: version.outputDuration,
        bytes: version.outputBytes,
        format: version.outputFormat,
        width: version.outputWidth,
        height: version.outputHeight,
        url: versionUrl(version),
        status: version.status
      };
    }

    const original = originalSourceNode(getSource());
    return {
      type: 'original',
      id: ORIGINAL_VERSION_ID,
      name: getSource()?.name || 'Original source',
      duration: original?.duration,
      bytes: original?.bytes,
      format: original?.format,
      width: original?.width,
      height: original?.height,
      url: getSource()?.kind === 'local-file' ? getSource()?.objectUrl || '' : '',
      status: 'original'
    };
  }

  function renderReference(active) {
    originalMetrics.replaceChildren();
    originalPlayer.replaceChildren();
    const reference = referenceDescriptor(active);
    const isParent = reference.type === 'parent';

    compareLeftRole.textContent = isParent ? 'A · PARENT' : 'A · ORIGINAL';
    compareLeftState.textContent = isParent ? 'Parent Version' : 'Immutable';
    compareLeftState.dataset.reference = reference.type;
    originalName.textContent = reference.name;
    referencePlaceholder.classList.remove('hidden');

    if (reference.url && ['video', 'audio'].includes(getSource()?.mediaType)) {
      const element = document.createElement(getSource().mediaType === 'video' ? 'video' : 'audio');
      element.controls = true;
      element.preload = 'metadata';
      element.src = reference.url;
      element.setAttribute('aria-label', isParent ? reference.name + ' parent comparison' : 'Original media');
      originalPlayer.append(element);
      referencePlaceholder.classList.add('hidden');
    } else {
      referencePlaceholderTitle.textContent = isParent ? 'Parent metadata available' : 'Original source';
      referencePlaceholderCopy.textContent = isParent
        ? 'This parent Version is session-only and its rendered media is unavailable for playback. Measured metadata remains visible.'
        : 'The immutable source is not currently linked for playback.';
    }

    originalMetrics.append(
      metric('Role', isParent ? 'Parent Version' : 'Immutable source'),
      metric('Duration', formatDuration(reference.duration)),
      metric('Size', formatBytes(reference.bytes)),
      metric('Format', String(reference.format || '—').toUpperCase())
    );
    if (getSource()?.mediaType === 'video') {
      originalMetrics.append(metric(
        'Dimensions',
        reference.width && reference.height ? `${reference.width} × ${reference.height}` : '—'
      ));
    }
  }

  function versionHistoryRow(version) {
    const current = state();
    const row = document.createElement('article');
    row.className = 'version-history-row';

    const identity = document.createElement('div');
    identity.className = 'version-history-identity';
    const name = document.createElement('strong');
    name.textContent = version.name;
    const parent = document.createElement('span');
    const parentName = version.parentVersionId === ORIGINAL_VERSION_ID
      ? 'Original'
      : current.versions.find((item) => item.id === version.parentVersionId)?.name || version.parentVersionId;
    parent.textContent = `Parent: ${parentName}`;
    identity.append(name, parent);

    const flags = document.createElement('div');
    flags.className = 'version-history-flags';
    const status = document.createElement('span');
    status.className = 'version-history-status';
    status.dataset.status = version.status;
    status.textContent = version.status === 'ready' ? 'Ready'
      : version.status === 'rendering' ? 'Rendering'
      : 'Failed';
    flags.append(status);
    if (current.activeVersionId === version.id) {
      const active = document.createElement('span');
      active.className = 'version-history-flag';
      active.textContent = 'Active';
      flags.append(active);
    }
    if (current.baseVersionId === version.id) {
      const base = document.createElement('span');
      base.className = 'version-history-flag base';
      base.textContent = 'Editing base';
      flags.append(base);
    }

    const available = version.status === 'ready' && versionBlobs.has(version.id);
    const hasChildren = current.versions.some((item) => item.parentVersionId === version.id);
    const actions = document.createElement('div');
    actions.className = 'version-history-actions';
    actions.append(
      button('Set active', () => setActive(version.id), { disabled: version.status !== 'ready' }),
      button('Compare parent', () => {
        const selected = setActiveVersionState(state(), version.id);
        if (!selected.ok) {
          setStatus(selected.reason);
          return;
        }
        saveVersioning(selected.state);
        compareReferencePreference = 'parent';
        compareMode = 'side-by-side';
        abSide = 'a';
        closeDialog(historyDialog);
        render();
        setStatus(`Comparing ${version.name} with its parent.`);
      }, { disabled: version.status !== 'ready' }),
      button('Branch from here', () => branchFrom(version.id), {
        disabled: !available,
        title: available ? '' : 'Current-session output required before branching.'
      }),
      button('Rename', () => renameVersion(version)),
      button('Duplicate', () => duplicateVersion(version), {
        disabled: !available,
        title: available ? '' : 'Current-session output required before duplication.'
      }),
      button('Delete', () => deleteVersion(version), {
        disabled: hasChildren || current.baseVersionId === version.id,
        title: hasChildren
          ? 'Delete child Versions first.'
          : current.baseVersionId === version.id
            ? 'Choose another editing base first.'
            : ''
      })
    );

    row.append(identity, flags, actions);
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
    const actions = document.createElement('div');
    actions.className = 'version-history-actions';
    actions.append(
      button('Set active', () => setActive(ORIGINAL_VERSION_ID), { disabled: current.activeVersionId === null }),
      button('Branch from Original', () => branchFrom(ORIGINAL_VERSION_ID), { disabled: current.baseVersionId === ORIGINAL_VERSION_ID })
    );
    original.append(copy, badge, actions);
    historyList.append(original);

    for (const version of current.versions) historyList.append(versionHistoryRow(version));
    historyEmpty.classList.toggle('hidden', current.versions.length > 0);
  }

  function renderResult() {
    const current = state();
    const active = activeVersion(current);
    resultMetrics.replaceChildren();
    resultPlayer.replaceChildren();
    exportButton.disabled = true;

    if (!active) {
      resultTitle.textContent = 'No rendered result';
      const emptyTitle = resultEmpty.querySelector('strong');
      const emptyCopy = resultEmpty.querySelector('small');
      if (emptyTitle) emptyTitle.textContent = 'No Rendered Version yet';
      if (emptyCopy) emptyCopy.textContent = 'Create a real Version or set a Ready Version active to compare it with Original.';
      resultStatus.textContent = 'Not rendered';
      resultStatus.dataset.status = 'empty';
      resultEmpty.classList.remove('hidden');
      resultMetrics.classList.add('hidden');
      resultPlayer.classList.add('hidden');
      return;
    }

    resultTitle.textContent = active.name;
    resultStatus.textContent = active.status === 'ready' ? 'Ready' : active.status === 'rendering' ? 'Rendering' : 'Failed';
    resultStatus.dataset.status = active.status;
    resultEmpty.classList.add('hidden');
    resultMetrics.classList.remove('hidden');
    const url = versionUrls.get(active.id) || (active.sessionAvailable ? active.blobRef?.url : '');
    if (active.status === 'ready' && url) {
      const element = document.createElement(getSource()?.mediaType === 'audio' ? 'audio' : 'video');
      element.controls = true;
      element.preload = 'metadata';
      element.src = url;
      element.setAttribute('aria-label', active.name + ' rendered result');
      resultPlayer.append(element);
      resultPlayer.classList.remove('hidden');
      exportButton.disabled = false;
    } else {
      resultPlayer.classList.add('hidden');
      const emptyTitle = resultEmpty.querySelector('strong');
      const emptyCopy = resultEmpty.querySelector('small');
      if (active.status === 'ready' && !url) {
        resultEmpty.classList.remove('hidden');
        if (emptyTitle) emptyTitle.textContent = 'Version metadata available';
        if (emptyCopy) emptyCopy.textContent = 'The rendered Blob was session-only and is unavailable after reload. Re-render before export, duplication or branching.';
      }
    }
    resultMetrics.append(
      metric('Status', active.status),
      metric('Duration', formatDuration(active.outputDuration)),
      metric('Size', formatBytes(active.outputBytes)),
      metric('Format', String(active.outputFormat || '—').toUpperCase())
    );
    if (active.outputWidth && active.outputHeight) {
      resultMetrics.append(metric('Dimensions', `${active.outputWidth} × ${active.outputHeight}`));
    }
    const originalDuration = Number(getSource()?.duration);
    if (Number.isFinite(originalDuration) && Number.isFinite(active.outputDuration)) {
      const removed = Math.max(0, originalDuration - active.outputDuration);
      resultMetrics.append(metric('Duration change', removed > 0 ? `−${formatDuration(removed)}` : 'No change'));
    }
  }

  function comparisonMetric(label, before, after, delta = '') {
    const card = document.createElement('div');
    const title = document.createElement('span');
    const values = document.createElement('strong');
    const change = document.createElement('small');
    title.textContent = label;
    values.textContent = `${before || '—'} → ${after || '—'}`;
    change.textContent = delta || 'Measured metadata';
    card.append(title, values, change);
    return card;
  }

  function signedDuration(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) return '';
    const value = Number(delta);
    if (Math.abs(value) < 0.35) return 'No measured change';
    return `${value > 0 ? '+' : '−'}${formatDuration(Math.abs(value))}`;
  }

  function signedBytes(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) return '';
    const value = Number(delta);
    if (Math.abs(value) < 1) return 'No measured change';
    return `${value > 0 ? '+' : '−'}${formatBytes(Math.abs(value))}`;
  }

  function renderMeasured(active) {
    measuredGrid.replaceChildren();
    compareChangeList.replaceChildren();
    if (!active || active.status !== 'ready') {
      measuredPanel.classList.add('hidden');
      return;
    }

    const comparison = measuredComparison(getSource(), active);
    if (!comparison) {
      measuredPanel.classList.add('hidden');
      return;
    }

    measuredPanel.classList.remove('hidden');
    const originalDimensions = comparison.original.width && comparison.original.height
      ? `${comparison.original.width} × ${comparison.original.height}`
      : '—';
    const resultDimensions = comparison.result.width && comparison.result.height
      ? `${comparison.result.width} × ${comparison.result.height}`
      : '—';

    measuredGrid.append(
      comparisonMetric('Duration', formatDuration(comparison.original.duration), formatDuration(comparison.result.duration), signedDuration(comparison.durationDelta)),
      comparisonMetric('File size', formatBytes(comparison.original.bytes), formatBytes(comparison.result.bytes), signedBytes(comparison.bytesDelta)),
      comparisonMetric('Dimensions', originalDimensions, resultDimensions),
      comparisonMetric('Aspect', comparison.original.aspect, comparison.result.aspect),
      comparisonMetric('Format', comparison.original.format || '—', comparison.result.format || '—')
    );

    if (!comparison.operations.length) {
      const none = document.createElement('span');
      none.textContent = 'No transform operations are recorded on this Version.';
      compareChangeList.append(none);
      return;
    }
    for (const operation of comparison.operations) {
      const chip = document.createElement('span');
      chip.textContent = operation.label;
      compareChangeList.append(chip);
    }
  }

  function clearCompareSync() {
    for (const dispose of compareDisposers) dispose();
    compareDisposers = [];
    syncLock = false;
  }

  function comparePlayers() {
    return {
      a: originalPlayer.querySelector('video, audio'),
      b: resultPlayer.querySelector('video, audio')
    };
  }

  function compareDurations(active) {
    const reference = referenceDescriptor(active);
    return {
      a: Number(reference.duration || 0),
      b: Number(active?.outputDuration || 0)
    };
  }

  function bindCompareEvent(element, type, handler) {
    element.addEventListener(type, handler);
    compareDisposers.push(() => element.removeEventListener(type, handler));
  }

  function moveEquivalent(from, to, fromDuration, toDuration) {
    if (!from || !to || syncLock) return;
    syncLock = true;
    try {
      syncedSeeks.add(to);
      to.currentTime = equivalentCompareTime(from.currentTime, fromDuration, toDuration);
    } catch {
      syncedSeeks.delete(to);
    }
    syncLock = false;
  }

  function setupComparisonPlayback(active) {
    clearCompareSync();
    const players = comparePlayers();
    const durations = compareDurations(active);
    if (!players.a || !players.b || !active || active.status !== 'ready') {
      compareSyncNote.textContent = active?.status === 'ready'
        ? 'Playback sync unavailable because one comparison file is not present in this session.'
        : 'Create or select a Ready Version to enable synchronized comparison.';
      return;
    }

    const syncMode = durationSyncMode(durations.a, durations.b);
    compareSyncNote.textContent = syncMode === 'absolute'
      ? 'Synchronized playback: matching timestamps.'
      : syncMode === 'relative'
        ? 'Durations differ: seeks and A/B switches map by relative position; playback is not force-locked.'
        : 'Duration metadata is insufficient for synchronized comparison.';

    const pair = [
      [players.a, players.b, durations.a, durations.b],
      [players.b, players.a, durations.b, durations.a]
    ];
    for (const [from, to, fromDuration, toDuration] of pair) {
      bindCompareEvent(from, 'play', () => {
        if (syncLock) return;
        moveEquivalent(from, to, fromDuration, toDuration);
        if (to.paused) to.play().catch(() => {});
      });
      bindCompareEvent(from, 'pause', () => {
        if (syncLock || to.paused || from.ended) return;
        syncLock = true;
        try { to.pause(); } catch {}
        syncLock = false;
      });
      bindCompareEvent(from, 'seeked', () => {
        if (syncedSeeks.has(from)) {
          syncedSeeks.delete(from);
          return;
        }
        moveEquivalent(from, to, fromDuration, toDuration);
      });
    }
  }

  function switchAB(nextSide) {
    const active = activeVersion(state());
    const players = comparePlayers();
    if (!active || active.status !== 'ready' || !players.a || !players.b) return;
    const durations = compareDurations(active);
    const from = abSide === 'a' ? players.a : players.b;
    const to = nextSide === 'a' ? players.a : players.b;
    if (from === to) return;

    const fromDuration = abSide === 'a' ? durations.a : durations.b;
    const toDuration = nextSide === 'a' ? durations.a : durations.b;
    const wasPlaying = !from.paused && !from.ended;
    try { from.pause(); } catch {}
    try {
      syncedSeeks.add(to);
      to.currentTime = equivalentCompareTime(from.currentTime, fromDuration, toDuration);
    } catch {
      syncedSeeks.delete(to);
    }
    abSide = nextSide;
    renderCompareControls();
    if (wasPlaying) to.play().catch(() => {});
  }

  function switchMobile(nextView) {
    const nextSide = nextView === 'result' ? 'b' : 'a';
    switchAB(nextSide);
    mobileView = nextView;
    renderCompareControls();
  }


  function renderCompareControls() {
    const current = state();
    const active = activeVersion(current);
    const hasResult = Boolean(active && active.status === 'ready');
    const hasResultMedia = Boolean(hasResult && versionUrl(active));
    const parent = active?.parentVersionId && active.parentVersionId !== ORIGINAL_VERSION_ID
      ? current.versions.find((version) => version.id === active.parentVersionId) || null
      : null;

    compareParentOption.disabled = !parent;
    compareParentOption.textContent = parent ? `Parent — ${parent.name}` : 'Parent Version';
    if (compareReferencePreference === 'parent' && !parent) compareReferencePreference = 'original';
    compareReferenceSelect.value = compareReferencePreference;

    compareShell.dataset.mode = compareMode;
    compareShell.dataset.mobileView = hasResult ? mobileView : 'original';
    compareShell.dataset.abSide = abSide;

    const reference = referenceDescriptor(active);
    const hasReferenceMedia = Boolean(reference.url);
    const canAB = hasResultMedia && hasReferenceMedia;

    for (const button of modeButtons) {
      const mode = button.dataset.compareMode;
      button.classList.toggle('active', mode === compareMode);
      button.disabled = mode === 'ab' && !canAB;
    }

    for (const button of abButtons) {
      const side = button.dataset.abSide;
      button.classList.toggle('active', side === abSide);
      button.disabled = !canAB;
    }

    for (const button of mobileButtons) {
      const view = button.dataset.mobileCompare;
      button.classList.toggle('active', view === (hasResult ? mobileView : 'original'));
      button.disabled = view === 'result' && !hasResultMedia;
    }
  }

  function stopElapsedTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = 0;
  }

  function updateElapsed() {
    if (!renderStartedAt) {
      renderElapsed.textContent = 'Elapsed —';
      return;
    }
    renderElapsed.textContent = `Elapsed ${((Date.now() - renderStartedAt) / 1000).toFixed(1)}s`;
  }

  function setRenderUi(status, progress = 0, stage = '') {
    const running = ['queued', 'running', 'validating'].includes(status);
    renderProgress.value = Math.max(0, Math.min(100, Number(progress) || 0));
    renderState.dataset.status = status;
    renderState.textContent = stage || (status === 'idle' ? 'Idle' : status);
    renderProofButton.disabled = running || !sourceIsLinked() || getSource()?.kind !== 'local-file';
    renderCancelButton.disabled = !running;
  }

  async function verifyRenderPipeline() {
    const source = getSource();
    if (!source || source.kind !== 'local-file' || !(source.file instanceof Blob)) {
      setStatus('Relink the local source before verifying the render worker.');
      return;
    }

    renderAbort?.abort();
    renderAbort = new AbortController();
    renderStartedAt = Date.now();
    stopElapsedTimer();
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 250);
    setRenderUi('queued', 0, 'Queued');
    setStatus('Verifying isolated media-processing worker. This proof does not create a Version.');

    const result = await renderRunner.runProof(source, {
      signal: renderAbort.signal,
      onState: (job) => setRenderUi(job.status, job.progress, job.stage),
      onProgress: (job) => setRenderUi('running', job.progress, job.stage)
    });

    stopElapsedTimer();
    updateElapsed();
    renderAbort = null;

    if (result.ok) {
      setRenderUi('completed', 100, 'Validated');
      setStatus(`Render-worker proof completed and output validated locally (${formatBytes(result.validation.bytes)}). No Version was created.`);
      return;
    }

    const label = result.state === 'cancelled' ? 'Cancelled'
      : result.state === 'timed_out' ? 'Timed out'
      : 'Failed';
    setRenderUi(result.state || 'failed', renderProgress.value, label);
    setStatus(`${label}: ${result.error?.message || 'Media-processing proof did not complete.'} Original and edit state are safe.`);
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
    createButton.disabled = getSource()?.kind !== 'local-file' || !['video', 'audio'].includes(getSource()?.mediaType);
    if (!renderRunner.activeJob) {
      const canProof = getSource()?.kind === 'local-file' && getSource()?.file instanceof Blob;
      renderProofButton.disabled = !canProof;
      renderCancelButton.disabled = true;
    }

    clearCompareSync();
    renderReference(active);
    renderResult();
    renderMeasured(active);
    renderHistory();
    renderCompareControls();
    setupComparisonPlayback(active);
  }

  function versionName(index, start, end, operations, isAudio) {
    if (!isAudio) {
      const labels = operations.map((operation) => {
        if (operation.type === 'video-trim') return 'Trim';
        if (operation.type === 'resize-aspect') return operation.params?.aspect === '9:16'
          ? 'Reel 9:16'
          : operation.params?.aspect === '1:1'
            ? 'Square 1:1'
            : `${operation.params?.aspect || 'Aspect'} Fit`;
        if (operation.type === 'playback-speed') return `${operation.params?.rate || 1}× Speed`;
        if (operation.type === 'mute') return 'Muted';
        return operation.label;
      });
      return `V${index} — ${labels.join(' + ') || 'Video'}`;
    }
    const labels = operations.map((operation) => {
      if (operation.type === 'audio-trim') return 'Trim';
      if (operation.type === 'volume') return 'Volume';
      if (operation.type === 'fade-in') return 'Fade in';
      if (operation.type === 'fade-out') return 'Fade out';
      return operation.label;
    });
    return `V${index} — ${labels.join(' + ') || 'Audio'}`;
  }

  function replaceVersion(nextVersion) {
    const current = state();
    const versions = current.versions.map((version) => version.id === nextVersion.id ? nextVersion : version);
    saveVersioning({
      versions,
      activeVersionId: nextVersion.status === 'ready' ? nextVersion.id : current.activeVersionId,
      baseVersionId: current.baseVersionId
    });
  }

  async function createTrimVersion() {
    const source = renderSourceForBase();
    if (!source || source.kind !== 'local-file' || !['video', 'audio'].includes(source.mediaType) || !(source.file instanceof Blob)) {
      setStatus(state().baseVersionId === ORIGINAL_VERSION_ID
        ? 'Create Version currently requires a relinked local audio or video source.'
        : 'The selected branch base is not available in this browser session. Re-render it or branch from Original.');
      return;
    }

    const isAudio = source.mediaType === 'audio';
    const edits = isAudio ? getAudioEdits?.() : getVideoEdits?.();
    const start = Number(edits?.trimStart || 0);
    const end = Number(edits?.trimEnd ?? source.duration ?? 0);
    const duration = Number(source.duration || 0);
    if (!Number.isFinite(end) || end <= start) {
      setStatus('Set a valid In/Out range before creating a Version.');
      return;
    }

    const trimChanged = start > 0.001 || (duration > 0 && Math.abs(end - duration) > 0.05);
    const volume = isAudio ? Number(edits?.volume ?? 1) : 1;
    const fadeIn = isAudio ? Number(edits?.fadeIn ?? 0) : 0;
    const fadeOut = isAudio ? Number(edits?.fadeOut ?? 0) : 0;
    const muted = !isAudio && Boolean(edits?.muted);
    const playbackRate = !isAudio ? Number(edits?.playbackRate ?? 1) : 1;
    const speedChanged = !isAudio && Math.abs(playbackRate - 1) >= 0.0001;
    const outputAspect = !isAudio ? String(edits?.outputAspect || 'original') : 'original';
    const aspectChanged = !isAudio && outputAspect !== 'original';

    if (!isAudio && !trimChanged && !muted && !speedChanged && !aspectChanged) {
      setStatus('Adjust trim, playback speed, output aspect or Mute output before creating a video Version.');
      return;
    }
    if (isAudio && !trimChanged && Math.abs(volume - 1) < 0.0001 && fadeIn <= 0 && fadeOut <= 0) {
      setStatus('Adjust trim, volume, fade-in or fade-out before creating an audio Version.');
      return;
    }

    const operations = [];
    if (trimChanged) {
      operations.push({
        id: `trim-${Date.now().toString(36)}`,
        type: isAudio ? 'audio-trim' : 'video-trim',
        label: isAudio ? 'Audio trim' : 'Video trim',
        params: { start, end }
      });
    }
    if (!isAudio && aspectChanged) {
      operations.push({
        id: `aspect-${Date.now().toString(36)}`,
        type: 'resize-aspect',
        label: `Fit to ${outputAspect}`,
        params: { aspect: outputAspect, mode: 'contain', background: 'black' }
      });
    }
    if (!isAudio && speedChanged) {
      operations.push({
        id: `speed-${Date.now().toString(36)}`,
        type: 'playback-speed',
        label: `Playback speed ${playbackRate}×`,
        params: { rate: playbackRate }
      });
    }
    if (!isAudio && muted) {
      operations.push({
        id: `mute-${Date.now().toString(36)}`,
        type: 'mute',
        label: 'Mute output',
        params: { muted: true }
      });
    }
    if (isAudio && Math.abs(volume - 1) >= 0.0001) {
      operations.push({
        id: `volume-${Date.now().toString(36)}`,
        type: 'volume',
        label: `Volume ${Math.round(volume * 100)}%`,
        params: { volume }
      });
    }
    if (isAudio && fadeIn > 0) {
      operations.push({
        id: `fade-in-${Date.now().toString(36)}`,
        type: 'fade-in',
        label: `Fade in ${fadeIn}s`,
        params: { seconds: fadeIn }
      });
    }
    if (isAudio && fadeOut > 0) {
      operations.push({
        id: `fade-out-${Date.now().toString(36)}`,
        type: 'fade-out',
        label: `Fade out ${fadeOut}s`,
        params: { seconds: fadeOut }
      });
    }

    getPlayer()?.pause?.();

    const current = state();
    const index = current.versions.length + 1;
    const id = newVersionId();
    const pending = {
      id,
      parentVersionId: current.baseVersionId || ORIGINAL_VERSION_ID,
      createdAt: new Date().toISOString(),
      operations,
      sourceFingerprint: sourceMetadataFingerprint(source),
      outputFormat: '',
      outputDuration: null,
      outputWidth: null,
      outputHeight: null,
      outputBytes: null,
      status: 'rendering',
      blobRef: null,
      name: versionName(index, start, end, operations, isAudio),
      sessionAvailable: false
    };

    saveVersioning({
      versions: [...current.versions, pending],
      activeVersionId: current.activeVersionId,
      baseVersionId: current.baseVersionId
    });
    render();

    renderAbort?.abort();
    renderAbort = new AbortController();
    renderStartedAt = Date.now();
    stopElapsedTimer();
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 250);
    setRenderUi('queued', 0, 'Queued');
    createButton.disabled = true;
    setStatus(isAudio
      ? `Rendering ${pending.name} locally with chained trim, volume and fade settings.`
      : `Rendering ${pending.name} locally with trim, playback-speed, mute and safe aspect-fit settings.`);

    const runner = isAudio ? renderRunner.runAudioEdits.bind(renderRunner) : renderRunner.runVideoEdits.bind(renderRunner);
    const renderSettings = isAudio
      ? { start, end, volume, fadeIn, fadeOut }
      : { start, end, muted, playbackRate, outputAspect };
    const result = await runner(source, renderSettings, {
      signal: renderAbort.signal,
      onState: (job) => setRenderUi(job.status, job.progress, job.stage),
      onProgress: (job) => setRenderUi('running', job.progress, job.stage)
    });

    stopElapsedTimer();
    updateElapsed();
    renderAbort = null;

    if (!result.ok) {
      replaceVersion({ ...pending, status: 'failed' });
      setRenderUi(result.state || 'failed', renderProgress.value, result.state === 'cancelled' ? 'Cancelled' : 'Failed');
      setStatus(`${pending.name} failed safely: ${result.error?.message || 'Render did not complete.'} Original and Preview state are unchanged.`);
      render();
      return;
    }

    const url = URL.createObjectURL(result.blob);
    versionBlobs.set(id, result.blob);
    versionUrls.set(id, url);
    const mime = String(result.blob.type || '');
    const outputFormat = mime.includes('webm') ? 'webm'
      : mime.includes('mp4') ? 'mp4'
      : mime.includes('ogg') ? 'ogg'
      : mime.includes('wav') ? 'wav'
      : mime || (isAudio ? 'audio' : 'video');

    const ready = {
      ...pending,
      outputFormat,
      outputDuration: result.validation.duration,
      outputWidth: result.validation.width,
      outputHeight: result.validation.height,
      outputBytes: result.validation.bytes,
      status: 'ready',
      blobRef: { kind: 'session-blob-url', url, storageKey: '', sessionOnly: true },
      sessionAvailable: true
    };
    replaceVersion(ready);
    setRenderUi('completed', 100, 'Version ready');
    previewBadge.textContent = 'Rendered Version ready';
    previewBadge.dataset.status = 'ready';
    mobileView = 'result';
    setStatus(`${ready.name} is Ready. Result can now be played, compared and exported.`);
    render();
  }

  function exportActiveVersion() {
    const active = activeVersion(state());
    if (!active || active.status !== 'ready') return;
    const url = versionUrls.get(active.id) || (active.sessionAvailable ? active.blobRef?.url : '');
    if (!url) {
      setStatus('This Version output is no longer available in this browser session. Re-render it to export.');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${active.name.replace(/[^a-z0-9 _.-]/gi, '-').slice(0, 80)}.${active.outputFormat || 'webm'}`;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatus(`Export prepared from exact Version: ${active.name}.`);
  }

  createButton.addEventListener('click', createTrimVersion);
  exportButton.addEventListener('click', exportActiveVersion);
  renderProofButton.addEventListener('click', verifyRenderPipeline);
  renderCancelButton.addEventListener('click', () => {
    renderAbort?.abort();
    renderRunner.cancel();
  });
  historyButton.addEventListener('click', () => {
    renderHistory();
    showDialog(historyDialog);
  });
  historyClose.addEventListener('click', () => closeDialog(historyDialog));
  historyDialog.addEventListener('click', (event) => {
    if (event.target === historyDialog) closeDialog(historyDialog);
  });

  compareReferenceSelect.addEventListener('change', () => {
    compareReferencePreference = compareReferenceSelect.value === 'parent' ? 'parent' : 'original';
    abSide = 'a';
    render();
  });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      compareMode = button.dataset.compareMode;
      if (compareMode === 'ab') abSide = mobileView === 'result' ? 'b' : 'a';
      renderCompareControls();
    });
  }

  for (const button of abButtons) {
    button.addEventListener('click', () => {
      if (!button.disabled) switchAB(button.dataset.abSide);
    });
  }

  for (const button of mobileButtons) {
    button.addEventListener('click', () => {
      if (!button.disabled) switchMobile(button.dataset.mobileCompare);
    });
  }

  const normalized = state();
  if (normalized.baseVersionId !== ORIGINAL_VERSION_ID) normalized.baseVersionId = ORIGINAL_VERSION_ID;
  saveVersioning(normalized);
  render();

  return {
    refresh: render,
    onSourceChanged() {
      render();
    },
    resetForNewSource() {
      renderAbort?.abort();
      renderRunner.terminate();
      stopElapsedTimer();
      renderAbort = null;
      renderStartedAt = 0;
      for (const url of versionUrls.values()) URL.revokeObjectURL(url);
      versionUrls.clear();
      versionBlobs.clear();
      setRenderUi('idle', 0, 'Idle');
      saveVersioning({ versions: [], activeVersionId: null, baseVersionId: ORIGINAL_VERSION_ID });
      compareMode = 'side-by-side';
      mobileView = 'original';
      compareReferencePreference = 'original';
      abSide = 'a';
      render();
    },
    destroy() {
      renderAbort?.abort();
      renderRunner.terminate();
      stopElapsedTimer();
      clearCompareSync();
      for (const url of versionUrls.values()) URL.revokeObjectURL(url);
      versionUrls.clear();
      versionBlobs.clear();
    }
  };
}
