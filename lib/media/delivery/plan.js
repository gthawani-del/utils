const PRESETS = Object.freeze([
  {
    id: 'youtube-master',
    label: 'YouTube Master',
    aspect: '16:9',
    intent: 'High-quality landscape delivery',
    readiness: 'prepare',
    note: 'Uses the existing browser renderer where compatible; codec/profile compliance still requires the future encoder layer.'
  },
  {
    id: 'vertical-social',
    label: 'Vertical Social',
    aspect: '9:16',
    intent: 'Reel / Short / Story delivery',
    readiness: 'prepare',
    note: 'Aspect can be prepared now; platform-specific bitrate and codec constraints remain unverified.'
  },
  {
    id: 'square-social',
    label: 'Square Social',
    aspect: '1:1',
    intent: 'Square social delivery',
    readiness: 'prepare',
    note: 'Aspect can be prepared now; platform-specific bitrate and codec constraints remain unverified.'
  },
  {
    id: 'podcast-audio',
    label: 'Podcast Audio',
    aspect: '',
    intent: 'Audio-only distribution',
    readiness: 'blocked',
    note: 'Requires deterministic local audio encoding before a delivery master can be produced.'
  },
  {
    id: 'archive-handoff',
    label: 'Archive / Handoff',
    aspect: '',
    intent: 'Project metadata and rebuild instructions',
    readiness: 'ready',
    note: 'Project package can be exported now without duplicating source media bytes.'
  }
]);

function finiteTime(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback) || 0);
}

export function deliveryPresets() {
  return PRESETS.map((preset) => ({ ...preset }));
}

export function normalizeDeliveryState(input) {
  const state = input && typeof input === 'object' ? input : {};
  const validPreset = PRESETS.some((preset) => preset.id === state.preset) ? state.preset : 'archive-handoff';
  const seen = new Set();
  const markers = Array.isArray(state.markers) ? state.markers : [];

  return {
    preset: validPreset,
    markers: markers.slice(0, 500).map((marker, index) => {
      let id = String(marker?.id || `marker-${index + 1}`).slice(0, 80);
      if (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      return {
        id,
        time: finiteTime(marker?.time),
        label: String(marker?.label || '').replace(/\u0000/g, '').trim().slice(0, 160),
        chapter: Boolean(marker?.chapter)
      };
    }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
  };
}

export function addDeliveryMarker(state, marker) {
  const normalized = normalizeDeliveryState(state);
  return normalizeDeliveryState({
    ...normalized,
    markers: [...normalized.markers, marker]
  });
}

export function removeDeliveryMarker(state, id) {
  const normalized = normalizeDeliveryState(state);
  return {
    ...normalized,
    markers: normalized.markers.filter((marker) => marker.id !== String(id))
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function fnv1a32(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sourceDescriptor(source) {
  if (!source) return null;
  return {
    kind: String(source.kind || ''),
    name: String(source.name || ''),
    provider: String(source.provider || ''),
    url: String(source.url || ''),
    bytes: Number(source.bytes || 0),
    container: String(source.container || ''),
    detectedMime: String(source.detectedMime || ''),
    mediaType: String(source.mediaType || ''),
    duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : null,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    relinkRequired: source.kind === 'local-file'
  };
}

export function rebuildState(project) {
  return {
    source: sourceDescriptor(project?.source),
    videoEdits: project?.videoEdits || null,
    audioEdits: project?.audioEdits || null,
    transcript: project?.transcript || null,
    lyrics: project?.lyrics || null,
    audioVideo: project?.audioVideo || null,
    compiler: project?.compiler || null,
    delivery: normalizeDeliveryState(project?.delivery)
  };
}

export function buildRebuildManifest(project) {
  const state = rebuildState(project);
  const canonical = stableStringify(state);
  return {
    format: 'utility-os-media-rebuild-manifest',
    version: 1,
    projectId: String(project?.id || ''),
    fingerprint: `fnv1a32:${fnv1a32(canonical)}`,
    state
  };
}

export function selectedPreset(state) {
  const normalized = normalizeDeliveryState(state);
  return deliveryPresets().find((preset) => preset.id === normalized.preset);
}
