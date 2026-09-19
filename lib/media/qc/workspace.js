import { deterministicQcFixes, runQcReport } from './report.js';

function safeStem(source) {
  const raw = String(source?.name || 'media-qc').replace(/\.[^.]+$/, '');
  return raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'media-qc';
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function badgeLabel(status) {
  if (status === 'pass') return 'Pass';
  if (status === 'warning') return 'Warning';
  if (status === 'partial') return 'Partial';
  if (status === 'not-applicable') return 'N/A';
  return 'Not inspected';
}

export function initQcWorkspace({
  getProject,
  getSource,
  saveTranscript,
  saveVideoEdits,
  saveAudioEdits,
  setStatus
}) {
  const panel = document.querySelector('#qc-panel');
  const list = document.querySelector('#qc-check-list');
  const summary = document.querySelector('#qc-summary');
  const runButton = document.querySelector('#qc-run');
  const fixButton = document.querySelector('#qc-fix');
  const exportButton = document.querySelector('#qc-export');
  const issuesOnly = document.querySelector('#qc-issues-only');
  const status = document.querySelector('#qc-status');
  let report = null;

  function checkCard(item) {
    const card = document.createElement('article');
    card.className = 'qc-check-card';
    card.dataset.status = item.status;

    const top = document.createElement('div');
    top.className = 'qc-check-top';

    const title = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = item.label;
    const group = document.createElement('span');
    group.textContent = item.group;
    title.append(label, group);

    const badge = document.createElement('span');
    badge.className = 'qc-badge';
    badge.textContent = badgeLabel(item.status);
    top.append(title, badge);

    const headline = document.createElement('p');
    headline.className = 'qc-check-summary';
    headline.textContent = item.summary;

    const detail = document.createElement('p');
    detail.className = 'qc-check-detail';
    detail.textContent = item.detail;

    card.append(top, headline, detail);
    return card;
  }

  function rerun(message = '') {
    report = runQcReport(getProject());
    render();
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
  }

  function render() {
    if (!report) report = runQcReport(getProject());
    const c = report.counts;
    summary.textContent = `${c.pass} pass · ${c.warning} warnings · ${c.partial} partial · ${c.notInspected} not inspected · ${c.notApplicable} N/A`;

    list.replaceChildren();
    const filtered = issuesOnly.checked
      ? report.checks.filter((item) => item.status === 'warning' || item.status === 'partial')
      : report.checks;

    for (const item of filtered) list.append(checkCard(item));

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'qc-empty';
      empty.textContent = 'No warnings or partial checks in the current report.';
      list.append(empty);
    }

    const fixes = deterministicQcFixes(getProject());
    fixButton.disabled = !fixes.changed;
    exportButton.disabled = !getSource();
  }

  function applyFixes() {
    const fixes = deterministicQcFixes(getProject());
    if (!fixes.changed) {
      status.textContent = 'No deterministic safe fixes are currently applicable.';
      return;
    }

    if (fixes.patch.transcript) saveTranscript(fixes.patch.transcript);
    if (fixes.patch.videoEdits) saveVideoEdits(fixes.patch.videoEdits);
    if (fixes.patch.audioEdits) saveAudioEdits(fixes.patch.audioEdits);

    rerun(`Applied ${fixes.changes.length} deterministic QC fix${fixes.changes.length === 1 ? '' : 'es'}.`);
  }

  runButton.addEventListener('click', () => rerun('QC report refreshed from current local project state.'));
  fixButton.addEventListener('click', applyFixes);
  issuesOnly.addEventListener('change', render);
  exportButton.addEventListener('click', () => {
    if (!report) report = runQcReport(getProject());
    downloadJson(report, `${safeStem(getSource())}-qc-report.json`);
    status.textContent = 'QC report JSON prepared locally.';
  });

  rerun();

  return {
    run(message = 'QC report refreshed from current local project state.') {
      rerun(message);
      return report;
    },
    applySafeFixes() {
      const before = deterministicQcFixes(getProject());
      applyFixes();
      return before;
    },
    updateVisibility() {
      const visible = getProject().activeCategory === 'qc';
      panel.classList.toggle('hidden', !visible);
      if (visible) rerun();
    },
    onSourceChanged() {
      rerun();
    },
    resetForNewSource() {
      report = null;
      rerun();
    }
  };
}
