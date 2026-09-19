export const ORIGINAL_VERSION_ID = 'original';

const VERSION_STATUSES = new Set(['rendering', 'ready', 'failed']);
const MAX_VERSIONS = 100;
const MAX_OPERATIONS = 40;

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanText(value, max = 160) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function cleanOperation(operation, index) {
  if (typeof operation === 'string') {
    const label = cleanText(operation);
    return label ? { id: `op-${index + 1}`, type: 'operation', label, params: {} } : null;
  }

  if (!operation || typeof operation !== 'object') return null;
  const type = cleanText(operation.type, 80) || 'operation';
  const label = cleanText(operation.label, 160) || type;
  const params = operation.params && typeof operation.params === 'object' && !Array.isArray(operation.params)
    ? Object.fromEntries(Object.entries(operation.params).slice(0, 20).map(([key, value]) => [cleanText(key, 48), value]))
    : {};
  return {
    id: cleanText(operation.id, 100) || `op-${index + 1}`,
    type,
    label,
    params
  };
}

function cleanBlobRef(blobRef) {
  if (!blobRef || typeof blobRef !== 'object') return null;
  const kind = cleanText(blobRef.kind, 40);
  const url = cleanText(blobRef.url, 2048);
  const storageKey = cleanText(blobRef.storageKey, 240);
  if (!kind && !url && !storageKey) return null;
  return {
    kind: kind || 'session-blob',
    url: url || '',
    storageKey: storageKey || '',
    sessionOnly: blobRef.sessionOnly !== false
  };
}

export function normalizeMediaVersion(version, index = 0) {
  const input = version && typeof version === 'object' ? version : {};
  const status = VERSION_STATUSES.has(input.status) ? input.status : 'failed';
  const operations = (Array.isArray(input.operations) ? input.operations : [])
    .slice(0, MAX_OPERATIONS)
    .map(cleanOperation)
    .filter(Boolean);

  return {
    id: cleanText(input.id, 100) || `version-${index + 1}`,
    parentVersionId: cleanText(input.parentVersionId, 100) || ORIGINAL_VERSION_ID,
    createdAt: cleanText(input.createdAt, 64),
    operations,
    sourceFingerprint: cleanText(input.sourceFingerprint, 160),
    outputFormat: cleanText(input.outputFormat, 80),
    outputDuration: finiteOrNull(input.outputDuration),
    outputWidth: finiteOrNull(input.outputWidth),
    outputHeight: finiteOrNull(input.outputHeight),
    outputBytes: finiteOrNull(input.outputBytes),
    status,
    blobRef: cleanBlobRef(input.blobRef),
    name: cleanText(input.name, 120) || `V${index + 1}`,
    sessionAvailable: Boolean(input.sessionAvailable)
  };
}

export function normalizeVersionState(input = {}) {
  const seen = new Set();
  const versions = (Array.isArray(input.versions) ? input.versions : [])
    .slice(0, MAX_VERSIONS)
    .map(normalizeMediaVersion)
    .filter((version) => {
      if (version.id === ORIGINAL_VERSION_ID || seen.has(version.id)) return false;
      seen.add(version.id);
      return true;
    });

  const ids = new Set(versions.map((version) => version.id));
  const requestedActive = cleanText(input.activeVersionId, 100);
  const requestedBase = cleanText(input.baseVersionId, 100);

  return {
    versions,
    activeVersionId: ids.has(requestedActive) ? requestedActive : null,
    baseVersionId: requestedBase === ORIGINAL_VERSION_ID || ids.has(requestedBase)
      ? requestedBase
      : ORIGINAL_VERSION_ID
  };
}

function stableSourceDescriptor(source) {
  if (!source) return null;
  return {
    kind: cleanText(source.kind, 40),
    name: cleanText(source.name, 240),
    provider: cleanText(source.provider, 80),
    url: cleanText(source.url, 2048),
    bytes: finiteOrNull(source.bytes) || 0,
    container: cleanText(source.container, 80),
    detectedMime: cleanText(source.detectedMime, 120),
    mediaType: cleanText(source.mediaType, 40),
    duration: finiteOrNull(source.duration),
    width: finiteOrNull(source.width),
    height: finiteOrNull(source.height)
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function sourceMetadataFingerprint(source) {
  const descriptor = stableSourceDescriptor(source);
  if (!descriptor) return '';
  return `metadata-v1:${fnv1a32(stableStringify(descriptor))}`;
}

export function originalSourceNode(source) {
  const descriptor = stableSourceDescriptor(source);
  if (!descriptor) return null;
  return Object.freeze({
    id: ORIGINAL_VERSION_ID,
    role: 'source',
    immutable: true,
    name: 'Original',
    sourceFingerprint: sourceMetadataFingerprint(source),
    mediaType: descriptor.mediaType,
    format: descriptor.container || descriptor.detectedMime,
    duration: descriptor.duration,
    width: descriptor.width,
    height: descriptor.height,
    bytes: descriptor.bytes
  });
}

export function activeVersion(state) {
  const normalized = normalizeVersionState(state);
  return normalized.activeVersionId
    ? normalized.versions.find((version) => version.id === normalized.activeVersionId) || null
    : null;
}

export function editingBaseLabel(state) {
  const normalized = normalizeVersionState(state);
  if (normalized.baseVersionId === ORIGINAL_VERSION_ID) return 'Original';
  return normalized.versions.find((version) => version.id === normalized.baseVersionId)?.name || 'Original';
}
