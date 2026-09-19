const STORAGE_KEY = 'utility-os:media-project:v1';

function projectId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'media-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function createMediaProject() {
  return {
    id: projectId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeCategory: 'video',
    source: null,
    videoEdits: null,
    audioEdits: null
  };
}

export function setProjectCategory(project, activeCategory) {
  project.activeCategory = activeCategory;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectSource(project, source) {
  project.source = source;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectVideoEdits(project, videoEdits) {
  project.videoEdits = videoEdits ? { ...videoEdits } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectAudioEdits(project, audioEdits) {
  project.audioEdits = audioEdits ? { ...audioEdits } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function projectSnapshot(project) {
  const source = project?.source;
  return {
    id: project?.id || projectId(),
    createdAt: project?.createdAt || new Date().toISOString(),
    updatedAt: project?.updatedAt || new Date().toISOString(),
    activeCategory: project?.activeCategory || 'video',
    videoEdits: project?.videoEdits ? { ...project.videoEdits } : null,
    audioEdits: project?.audioEdits ? { ...project.audioEdits } : null,
    source: source ? {
      kind: source.kind,
      name: source.name || '',
      provider: source.provider || '',
      url: source.url || '',
      bytes: Number(source.bytes || 0),
      container: source.container || '',
      detectedMime: source.detectedMime || '',
      mediaType: source.mediaType || '',
      duration: Number.isFinite(source.duration) ? source.duration : null,
      width: Number.isFinite(source.width) ? source.width : null,
      height: Number.isFinite(source.height) ? source.height : null,
      relinkRequired: source.kind === 'local-file'
    } : null
  };
}

export function saveMediaProjectSnapshot(project) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(projectSnapshot(project)));
    return true;
  } catch {
    return false;
  }
}

export function loadMediaProjectSnapshot() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearMediaProjectSnapshot() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage may be unavailable in hardened browser modes.
  }
}
