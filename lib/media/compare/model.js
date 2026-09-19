function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function gcd(a, b) {
  let left = Math.max(1, Math.round(Math.abs(a)));
  let right = Math.max(1, Math.round(Math.abs(b)));
  while (right) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

export function measuredAspect(width, height) {
  const w = finiteOrNull(width);
  const h = finiteOrNull(height);
  if (!w || !h) return '—';
  const ratio = w / h;
  if (Math.abs(ratio - 16 / 9) <= 0.015) return '16:9';
  if (Math.abs(ratio - 9 / 16) <= 0.015) return '9:16';
  if (Math.abs(ratio - 1) <= 0.015) return '1:1';
  const divisor = gcd(w, h);
  const rw = Math.round(w / divisor);
  const rh = Math.round(h / divisor);
  return rw <= 100 && rh <= 100 ? `${rw}:${rh}` : ratio.toFixed(2) + ':1';
}

export function durationSyncMode(durationA, durationB) {
  const a = finiteOrNull(durationA);
  const b = finiteOrNull(durationB);
  if (a === null || b === null || a === 0 || b === 0) return 'unavailable';
  const tolerance = Math.max(0.35, Math.min(a, b) * 0.005);
  return Math.abs(a - b) <= tolerance ? 'absolute' : 'relative';
}

export function equivalentCompareTime(time, fromDuration, toDuration) {
  const current = Math.max(0, Number(time) || 0);
  const from = finiteOrNull(fromDuration);
  const to = finiteOrNull(toDuration);
  const mode = durationSyncMode(from, to);
  if (mode === 'unavailable') return 0;
  if (mode === 'absolute') return Math.min(to, current);
  const fraction = from > 0 ? Math.max(0, Math.min(1, current / from)) : 0;
  return Math.min(to, fraction * to);
}

export function compareReference(active, versions, preference = 'original') {
  if (preference !== 'parent' || !active || active.parentVersionId === 'original') {
    return { type: 'original', id: 'original', version: null };
  }
  const parent = (Array.isArray(versions) ? versions : []).find((version) => version.id === active.parentVersionId) || null;
  return parent
    ? { type: 'parent', id: parent.id, version: parent }
    : { type: 'original', id: 'original', version: null };
}

export function measuredComparison(source, version) {
  if (!source || !version) return null;
  const original = {
    duration: finiteOrNull(source.duration),
    bytes: finiteOrNull(source.bytes),
    width: finiteOrNull(source.width),
    height: finiteOrNull(source.height),
    aspect: measuredAspect(source.width, source.height),
    format: String(source.container || source.detectedMime || '').toUpperCase()
  };
  const result = {
    duration: finiteOrNull(version.outputDuration),
    bytes: finiteOrNull(version.outputBytes),
    width: finiteOrNull(version.outputWidth),
    height: finiteOrNull(version.outputHeight),
    aspect: measuredAspect(version.outputWidth, version.outputHeight),
    format: String(version.outputFormat || '').toUpperCase()
  };
  return {
    original,
    result,
    durationDelta: original.duration !== null && result.duration !== null ? result.duration - original.duration : null,
    bytesDelta: original.bytes !== null && result.bytes !== null ? result.bytes - original.bytes : null,
    operations: (Array.isArray(version.operations) ? version.operations : []).map((operation) => ({
      type: String(operation.type || ''),
      label: String(operation.label || operation.type || 'Operation')
    }))
  };
}
