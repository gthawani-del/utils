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
    audioEdits: null,
    transcript: null,
    lyrics: null,
    audioVideo: null,
    compiler: null,
    delivery: null,
    versions: [],
    activeVersionId: null,
    baseVersionId: 'original'
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

function versionSnapshot(version, index = 0) {
  const input = version && typeof version === 'object' ? version : {};
  return {
    id: String(input.id || `version-${index + 1}`).slice(0, 100),
    parentVersionId: String(input.parentVersionId || 'original').slice(0, 100),
    createdAt: String(input.createdAt || '').slice(0, 64),
    operations: Array.isArray(input.operations) ? input.operations.slice(0, 40).map((operation, opIndex) => ({
      id: String(operation?.id || `op-${opIndex + 1}`).slice(0, 100),
      type: String(operation?.type || 'operation').slice(0, 80),
      label: String(operation?.label || operation?.type || 'Operation').slice(0, 160),
      params: operation?.params && typeof operation.params === 'object' && !Array.isArray(operation.params)
        ? { ...operation.params }
        : {}
    })) : [],
    sourceFingerprint: String(input.sourceFingerprint || '').slice(0, 160),
    outputFormat: String(input.outputFormat || '').slice(0, 80),
    outputDuration: Number.isFinite(Number(input.outputDuration)) ? Math.max(0, Number(input.outputDuration)) : null,
    outputWidth: Number.isFinite(Number(input.outputWidth)) ? Math.max(0, Number(input.outputWidth)) : null,
    outputHeight: Number.isFinite(Number(input.outputHeight)) ? Math.max(0, Number(input.outputHeight)) : null,
    outputBytes: Number.isFinite(Number(input.outputBytes)) ? Math.max(0, Number(input.outputBytes)) : null,
    status: ['rendering', 'ready', 'failed'].includes(input.status) ? input.status : 'failed',
    blobRef: input.blobRef && typeof input.blobRef === 'object' ? {
      kind: String(input.blobRef.kind || 'session-blob').slice(0, 40),
      url: String(input.blobRef.url || '').slice(0, 2048),
      storageKey: String(input.blobRef.storageKey || '').slice(0, 240),
      sessionOnly: input.blobRef.sessionOnly !== false
    } : null,
    name: String(input.name || `V${index + 1}`).slice(0, 120),
    sessionAvailable: Boolean(input.sessionAvailable)
  };
}

export function setProjectVersioning(project, versioning) {
  const versions = Array.isArray(versioning?.versions)
    ? versioning.versions.slice(0, 100).map(versionSnapshot)
    : [];
  const ids = new Set(versions.map((version) => version.id));
  const activeVersionId = String(versioning?.activeVersionId || '');
  const baseVersionId = String(versioning?.baseVersionId || 'original');

  project.versions = versions;
  project.activeVersionId = ids.has(activeVersionId) ? activeVersionId : null;
  project.baseVersionId = baseVersionId === 'original' || ids.has(baseVersionId) ? baseVersionId : 'original';
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectDelivery(project, delivery) {
  project.delivery = delivery ? {
    preset: String(delivery.preset || 'archive-handoff'),
    markers: Array.isArray(delivery.markers) ? delivery.markers.slice(0, 500).map((marker) => ({
      id: String(marker.id || ''),
      time: Number.isFinite(Number(marker.time)) ? Math.max(0, Number(marker.time)) : 0,
      label: String(marker.label || ''),
      chapter: Boolean(marker.chapter)
    })) : []
  } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectCompiler(project, compiler) {
  project.compiler = compiler ? {
    selected: Array.isArray(compiler.selected) ? [...new Set(compiler.selected.map(String))].slice(0, 32) : []
  } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectAudioVideo(project, audioVideo) {
  project.audioVideo = audioVideo ? {
    mode: String(audioVideo.mode || 'bars'),
    aspect: String(audioVideo.aspect || '16:9'),
    theme: String(audioVideo.theme || 'midnight'),
    title: String(audioVideo.title || ''),
    artist: String(audioVideo.artist || ''),
    showLyrics: Boolean(audioVideo.showLyrics)
  } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectLyrics(project, lyrics) {
  project.lyrics = lyrics ? {
    source: String(lyrics.source || 'manual'),
    title: String(lyrics.title || ''),
    artist: String(lyrics.artist || ''),
    style: String(lyrics.style || 'classic'),
    effect: String(lyrics.effect || 'fade'),
    background: String(lyrics.background || 'transparent'),
    lines: Array.isArray(lyrics.lines) ? lyrics.lines.map((line) => ({
      id: String(line.id || ''),
      start: Number.isFinite(Number(line.start)) ? Number(line.start) : null,
      text: String(line.text || ''),
      words: Array.isArray(line.words) ? line.words.map((word) => ({
        start: Number.isFinite(Number(word.start)) ? Number(word.start) : null,
        text: String(word.text || '')
      })).filter((word) => word.start !== null && word.text) : []
    })) : []
  } : null;
  project.updatedAt = new Date().toISOString();
  saveMediaProjectSnapshot(project);
  return project;
}

export function setProjectTranscript(project, transcript) {
  project.transcript = transcript ? {
    language: String(transcript.language || ''),
    source: String(transcript.source || 'manual'),
    cues: Array.isArray(transcript.cues) ? transcript.cues.map((cue) => ({
      id: String(cue.id || ''),
      start: Number(cue.start || 0),
      end: Number(cue.end || 0),
      text: String(cue.text || '')
    })) : []
  } : null;
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
    versions: Array.isArray(project?.versions) ? project.versions.slice(0, 100).map(versionSnapshot) : [],
    activeVersionId: project?.activeVersionId || null,
    baseVersionId: project?.baseVersionId || 'original',
    videoEdits: project?.videoEdits ? { ...project.videoEdits } : null,
    audioEdits: project?.audioEdits ? { ...project.audioEdits } : null,
    delivery: project?.delivery ? {
      preset: String(project.delivery.preset || 'archive-handoff'),
      markers: Array.isArray(project.delivery.markers) ? project.delivery.markers.slice(0, 500).map((marker) => ({
        id: String(marker.id || ''),
        time: Number.isFinite(Number(marker.time)) ? Math.max(0, Number(marker.time)) : 0,
        label: String(marker.label || ''),
        chapter: Boolean(marker.chapter)
      })) : []
    } : null,
    compiler: project?.compiler ? {
      selected: Array.isArray(project.compiler.selected) ? [...new Set(project.compiler.selected.map(String))].slice(0, 32) : []
    } : null,
    audioVideo: project?.audioVideo ? {
      mode: String(project.audioVideo.mode || 'bars'),
      aspect: String(project.audioVideo.aspect || '16:9'),
      theme: String(project.audioVideo.theme || 'midnight'),
      title: String(project.audioVideo.title || ''),
      artist: String(project.audioVideo.artist || ''),
      showLyrics: Boolean(project.audioVideo.showLyrics)
    } : null,
    lyrics: project?.lyrics ? {
      source: String(project.lyrics.source || 'manual'),
      title: String(project.lyrics.title || ''),
      artist: String(project.lyrics.artist || ''),
      style: String(project.lyrics.style || 'classic'),
      effect: String(project.lyrics.effect || 'fade'),
      background: String(project.lyrics.background || 'transparent'),
      lines: Array.isArray(project.lyrics.lines) ? project.lyrics.lines.map((line) => ({
        id: String(line.id || ''),
        start: Number.isFinite(Number(line.start)) ? Number(line.start) : null,
        text: String(line.text || ''),
        words: Array.isArray(line.words) ? line.words.map((word) => ({
          start: Number.isFinite(Number(word.start)) ? Number(word.start) : null,
          text: String(word.text || '')
        })).filter((word) => word.start !== null && word.text) : []
      })) : []
    } : null,
    transcript: project?.transcript ? {
      language: String(project.transcript.language || ''),
      source: String(project.transcript.source || 'manual'),
      cues: Array.isArray(project.transcript.cues) ? project.transcript.cues.map((cue) => ({
        id: String(cue.id || ''),
        start: Number(cue.start || 0),
        end: Number(cue.end || 0),
        text: String(cue.text || '')
      })) : []
    } : null,
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
