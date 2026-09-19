import { MediaRenderRunner } from '../render/runner.js';
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

  let compareMode = 'side-by-side';
  let mobileView = 'original';
  const renderRunner = new MediaRenderRunner();
  let renderAbort = null;
  let elapsedTimer = 0;
  let renderStartedAt = 0;
  const versionUrls = new Map();

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
    originalPlayer.replaceChildren();
    const original = originalSourceNode(getSource());
    if (!original) {
      originalName.textContent = 'Original source';
      return;
    }

    originalName.textContent = getSource()?.name || 'Original source';
    if (getSource()?.kind === 'local-file' && getSource()?.objectUrl && ['video', 'audio'].includes(getSource()?.mediaType)) {
      const element = document.createElement(getSource().mediaType === 'video' ? 'video' : 'audio');
      element.controls = true;
      element.preload = 'metadata';
      element.src = getSource().objectUrl;
      element.setAttribute('aria-label', getSource().mediaType === 'video' ? 'Original video' : 'Original audio');
      originalPlayer.append(element);
    }
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
    resultPlayer.replaceChildren();
    exportButton.disabled = true;

    if (!active) {
      resultTitle.textContent = 'No rendered result';
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

    renderOriginal();
    renderResult();
    renderHistory();
    renderCompareControls();
  }

  function versionName(index, start, end, operations, isAudio) {
    if (!isAudio) {
      const label = `${formatDuration(start)}–${formatDuration(end)}`;
      return `V${index} — Trimmed ${label}`;
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
    const source = getSource();
    if (!source || source.kind !== 'local-file' || !['video', 'audio'].includes(source.mediaType) || !(source.file instanceof Blob)) {
      setStatus('Create Version currently requires a relinked local audio or video source.');
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

    if (!isAudio && !trimChanged) {
      setStatus('Adjust the In or Out point first. Step 3 creates real trimmed video Versions only.');
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
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `version-${Date.now().toString(36)}`;
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
      : `Rendering ${pending.name} locally. Preview speed is not included; Step 3 applies trim only.`);

    const runner = isAudio ? renderRunner.runAudioEdits.bind(renderRunner) : renderRunner.runVideoTrim.bind(renderRunner);
    const renderSettings = isAudio
      ? { start, end, volume, fadeIn, fadeOut }
      : { start, end };
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
      renderAbort?.abort();
      renderRunner.terminate();
      stopElapsedTimer();
      renderAbort = null;
      renderStartedAt = 0;
      for (const url of versionUrls.values()) URL.revokeObjectURL(url);
      versionUrls.clear();
      setRenderUi('idle', 0, 'Idle');
      saveVersioning({ versions: [], activeVersionId: null, baseVersionId: ORIGINAL_VERSION_ID });
      compareMode = 'side-by-side';
      mobileView = 'original';
      render();
    },
    destroy() {
      renderAbort?.abort();
      renderRunner.terminate();
      stopElapsedTimer();
      for (const url of versionUrls.values()) URL.revokeObjectURL(url);
      versionUrls.clear();
    }
  };
}
