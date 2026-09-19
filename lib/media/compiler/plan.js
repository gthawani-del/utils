const OUTPUTS = Object.freeze([
  { id: 'youtube-16x9', label: 'YouTube 16:9', group: 'Video', kind: 'renderer', aspect: '16:9', extension: 'webm' },
  { id: 'reel-9x16', label: 'Reel / Short 9:16', group: 'Video', kind: 'renderer', aspect: '9:16', extension: 'webm' },
  { id: 'social-1x1', label: 'Social 1:1', group: 'Video', kind: 'renderer', aspect: '1:1', extension: 'webm' },
  { id: 'podcast-mp3', label: 'Podcast MP3', group: 'Audio', kind: 'encoder', extension: 'mp3' },
  { id: 'transcript-txt', label: 'Transcript TXT', group: 'Text', kind: 'generated', extension: 'txt' },
  { id: 'subtitles-srt', label: 'Subtitles SRT', group: 'Text', kind: 'generated', extension: 'srt' },
  { id: 'subtitles-vtt', label: 'Subtitles VTT', group: 'Text', kind: 'generated', extension: 'vtt' },
  { id: 'lyrics-lrc', label: 'Lyrics LRC', group: 'Text', kind: 'generated', extension: 'lrc' },
  { id: 'thumbnail-png', label: 'Thumbnail PNG', group: 'Image', kind: 'generated', extension: 'png' },
  { id: 'source-metadata', label: 'Source metadata JSON', group: 'Data', kind: 'generated', extension: 'json' },
  { id: 'whatsapp-compressed', label: 'WhatsApp compressed', group: 'Delivery', kind: 'encoder', extension: 'mp4' },
  { id: 'web-version', label: 'Web version', group: 'Delivery', kind: 'encoder', extension: 'mp4' },
  { id: 'archive-master', label: 'Archive master', group: 'Delivery', kind: 'archive', extension: '' }
]);

function hasTranscript(project) {
  return Array.isArray(project?.transcript?.cues) && project.transcript.cues.length > 0;
}

function hasLyrics(project) {
  return Array.isArray(project?.lyrics?.lines) && project.lyrics.lines.length > 0;
}

function hasLocalAudio(project) {
  return project?.source?.kind === 'local-file' && project.source.mediaType === 'audio' && Boolean(project.source.objectUrl);
}

export function compilerOutputDefinitions() {
  return OUTPUTS.map((item) => ({ ...item }));
}

export function deriveCompilerOutputs(project, capabilities = {}) {
  const source = project?.source;
  const hasSource = Boolean(source);
  const mediaRecorder = capabilities.mediaRecorder !== false;
  const canvasCapture = capabilities.canvasCapture !== false;

  return OUTPUTS.map((output) => {
    let status = 'unavailable';
    let reason = 'No compatible source is loaded.';

    if (output.kind === 'renderer') {
      if (hasLocalAudio(project) && mediaRecorder && canvasCapture) {
        status = 'prepare';
        reason = 'Ready to configure in Audio → Video. Rendering remains real-time.';
      } else if (hasLocalAudio(project)) {
        reason = 'This browser does not expose the required local recording APIs.';
      } else if (hasSource) {
        reason = 'Video variants currently require a local audio source for the browser visualizer renderer.';
      }
    }

    if (output.id === 'podcast-mp3') {
      reason = hasSource
        ? 'MP3 encoding is not enabled without a dedicated local encoder.'
        : reason;
    }

    if (output.id === 'transcript-txt' || output.id === 'subtitles-srt' || output.id === 'subtitles-vtt') {
      if (hasTranscript(project)) {
        status = 'ready';
        reason = 'Generated deterministically from the current transcript.';
      } else if (hasSource) {
        reason = 'Add or import transcript cues first.';
      }
    }

    if (output.id === 'lyrics-lrc') {
      if (hasLyrics(project)) {
        status = 'ready';
        reason = 'Generated from the current synced lyrics.';
      } else if (hasSource) {
        reason = 'Add or import lyrics first.';
      }
    }

    if (output.id === 'thumbnail-png') {
      if (hasLocalAudio(project)) {
        status = 'ready';
        reason = 'Generated locally from the current Audio → Video visual style.';
      } else if (hasSource) {
        reason = 'Thumbnail generation in this phase uses a local audio visualizer project.';
      }
    }

    if (output.id === 'source-metadata') {
      if (hasSource) {
        status = 'ready';
        reason = 'Small JSON record; no source bytes are copied.';
      }
    }

    if (output.id === 'whatsapp-compressed' || output.id === 'web-version') {
      reason = hasSource
        ? 'A deterministic media encoder is required before this output can be produced safely.'
        : reason;
    }

    if (output.id === 'archive-master') {
      reason = hasSource
        ? 'The compiler will not duplicate large source bytes into memory; archive packaging belongs with the delivery engine.'
        : reason;
    }

    return { ...output, status, reason };
  });
}

export function normalizeCompilerConfig(config, outputs) {
  const readyIds = new Set((outputs || []).filter((output) => output.status === 'ready').map((output) => output.id));
  const requested = Array.isArray(config?.selected) ? config.selected : [];
  const selected = [...new Set(requested.map(String))].filter((id) => readyIds.has(id));
  return { selected };
}

export function defaultCompilerSelection(outputs) {
  const preferred = new Set(['transcript-txt', 'subtitles-srt', 'subtitles-vtt', 'lyrics-lrc', 'thumbnail-png', 'source-metadata']);
  return (outputs || []).filter((output) => output.status === 'ready' && preferred.has(output.id)).map((output) => output.id);
}

export function buildCompilerManifest(project, outputs, selected) {
  const chosen = new Set(Array.isArray(selected) ? selected : []);
  const source = project?.source || null;
  return {
    format: 'utility-os-media-compiler-manifest',
    version: 1,
    projectId: String(project?.id || ''),
    generatedFromProjectUpdatedAt: String(project?.updatedAt || ''),
    source: source ? {
      kind: String(source.kind || ''),
      name: String(source.name || ''),
      mediaType: String(source.mediaType || ''),
      container: String(source.container || ''),
      detectedMime: String(source.detectedMime || ''),
      bytes: Number(source.bytes || 0),
      duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : null,
      width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
      height: Number.isFinite(Number(source.height)) ? Number(source.height) : null
    } : null,
    outputs: (outputs || []).map((output) => ({
      id: output.id,
      label: output.label,
      group: output.group,
      status: output.status,
      selected: chosen.has(output.id),
      reason: output.reason
    }))
  };
}
