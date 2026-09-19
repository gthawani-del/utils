import { normalizeAudioEdits } from '../audio/edits.js';
import { normalizeTranscript, runSubtitleQa } from '../transcript/subtitles.js';
import { normalizeVideoEdits } from '../video/edits.js';

const CHECKS = Object.freeze([
  ['codec', 'Codec / container', 'Essence'],
  ['profile', 'Codec profile', 'Essence'],
  ['bitrate', 'Bitrate', 'Essence'],
  ['frame-rate', 'Frame rate', 'Video'],
  ['vfr', 'Variable frame rate', 'Video'],
  ['resolution', 'Resolution', 'Video'],
  ['color', 'Color metadata', 'Video'],
  ['sample-rate', 'Audio sample rate', 'Audio'],
  ['channels', 'Channel layout', 'Audio'],
  ['loudness', 'Loudness', 'Audio'],
  ['true-peak', 'True peak', 'Audio'],
  ['clipping', 'Clipping', 'Audio'],
  ['black-frames', 'Black frames', 'Forensics'],
  ['frozen-frames', 'Frozen frames', 'Forensics'],
  ['duplicate-frames', 'Duplicate frames', 'Forensics'],
  ['silence', 'Silence', 'Forensics'],
  ['av-drift', 'Audio / video drift', 'Timing'],
  ['timestamps', 'Broken timestamps', 'Timing'],
  ['subtitles', 'Subtitle errors', 'Text'],
  ['privacy', 'Metadata / privacy', 'Privacy'],
  ['delivery', 'Delivery compatibility', 'Delivery']
]);

function check(id, status, summary, detail = '') {
  const definition = CHECKS.find((item) => item[0] === id);
  return {
    id,
    label: definition?.[1] || id,
    group: definition?.[2] || 'Other',
    status,
    summary,
    detail
  };
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function estimatedBitrate(source) {
  const bytes = finitePositive(source?.bytes);
  const duration = finitePositive(source?.duration);
  if (!bytes || !duration) return null;
  return Math.round((bytes * 8) / duration);
}

function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond) return '';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mb/s`;
  return `${Math.round(bitsPerSecond / 1000)} kb/s`;
}

function unavailable(id, applicability = true) {
  const notes = {
    profile: 'Requires stream-level codec parsing.',
    'frame-rate': 'Requires stream/frame timing inspection.',
    vfr: 'Requires per-frame timestamp inspection.',
    color: 'Requires stream-level color metadata parsing.',
    'sample-rate': 'Requires decoded audio or stream-level audio metadata.',
    channels: 'Requires decoded audio or stream-level audio metadata.',
    loudness: 'EBU/ITU loudness measurement is not implemented in the lightweight QC pass.',
    'true-peak': 'True-peak oversampling is not implemented in the lightweight QC pass.',
    clipping: 'Full-sample audio analysis is not implemented in the lightweight QC pass.',
    'black-frames': 'Full or sampled frame analysis is not implemented in the lightweight QC pass.',
    'frozen-frames': 'Frame comparison is not implemented in the lightweight QC pass.',
    'duplicate-frames': 'Frame comparison is not implemented in the lightweight QC pass.',
    silence: 'Full audio-window analysis is not implemented in the lightweight QC pass.',
    'av-drift': 'Independent audio/video timestamp comparison is not implemented.',
    timestamps: 'Browser metadata decode succeeded, but packet/frame timestamps are not parsed.'
  };
  return check(
    id,
    applicability ? 'not-inspected' : 'not-applicable',
    applicability ? 'Not inspected' : 'Not applicable',
    applicability ? notes[id] || 'This check requires a deeper media parser.' : 'This check does not apply to the current source type.'
  );
}

export function runQcReport(project) {
  const source = project?.source || null;
  if (!source) {
    return {
      generatedAt: new Date().toISOString(),
      source: null,
      checks: CHECKS.map(([id]) => check(id, 'not-inspected', 'No source loaded', 'Load a local audio/video source to run QC.')),
      counts: { pass: 0, warning: 0, partial: 0, notInspected: CHECKS.length, notApplicable: 0 }
    };
  }

  const local = source.kind === 'local-file';
  const video = source.mediaType === 'video';
  const audio = source.mediaType === 'audio';
  const checks = [];

  if (local && source.container && source.detectedMime) {
    checks.push(check(
      'codec',
      'pass',
      `${String(source.container).toUpperCase()} container recognized`,
      `File signature identified as ${source.detectedMime}. Exact elementary-stream codec/profile is not inferred from the filename.`
    ));
  } else {
    checks.push(check('codec', 'not-inspected', 'Remote/reference source not decoded', 'QC only inspects local media in this phase.'));
  }

  checks.push(unavailable('profile', local));

  const bitrate = local ? estimatedBitrate(source) : null;
  checks.push(bitrate
    ? check('bitrate', 'partial', `Estimated overall bitrate: ${formatBitrate(bitrate)}`, 'Estimate = file bytes × 8 ÷ duration. This is total-file average, not per-stream bitrate.')
    : check('bitrate', 'not-inspected', 'Bitrate unavailable', 'File size and duration are both required for a deterministic estimate.'));

  checks.push(unavailable('frame-rate', local && video));
  checks.push(unavailable('vfr', local && video));

  if (video && finitePositive(source.width) && finitePositive(source.height)) {
    const odd = Number(source.width) % 2 !== 0 || Number(source.height) % 2 !== 0;
    checks.push(check(
      'resolution',
      odd ? 'warning' : 'pass',
      `${source.width} × ${source.height}`,
      odd
        ? 'At least one dimension is odd; some delivery encoders require even pixel dimensions.'
        : 'Browser metadata reported valid video dimensions.'
    ));
  } else {
    checks.push(unavailable('resolution', video));
  }

  checks.push(unavailable('color', local && video));
  checks.push(unavailable('sample-rate', local));
  checks.push(unavailable('channels', local));
  checks.push(unavailable('loudness', local));
  checks.push(unavailable('true-peak', local));
  checks.push(unavailable('clipping', local));
  checks.push(unavailable('black-frames', local && video));
  checks.push(unavailable('frozen-frames', local && video));
  checks.push(unavailable('duplicate-frames', local && video));
  checks.push(unavailable('silence', local));
  checks.push(unavailable('av-drift', local && video));

  if (local && finitePositive(source.duration)) {
    checks.push(check(
      'timestamps',
      'partial',
      'Browser decoded a finite duration',
      'Container-level playback metadata loaded successfully. Packet/frame timestamp continuity is not yet parsed.'
    ));
  } else {
    checks.push(unavailable('timestamps', local));
  }

  if (Array.isArray(project?.transcript?.cues) && project.transcript.cues.length) {
    const qa = runSubtitleQa(project.transcript, { duration: finitePositive(source.duration) });
    const issueCount = qa.overlaps + qa.timing + qa.safeArea + qa.blanks;
    checks.push(check(
      'subtitles',
      issueCount ? 'warning' : 'pass',
      issueCount ? `${issueCount} subtitle QA issue${issueCount === 1 ? '' : 's'}` : `${qa.totalCues} subtitle cues passed current checks`,
      `Overlaps: ${qa.overlaps}; timing: ${qa.timing}; safe-area guidance: ${qa.safeArea}; blank cues: ${qa.blanks}.`
    ));
  } else {
    checks.push(check('subtitles', 'not-applicable', 'No subtitle cues', 'Import or create subtitles to include subtitle QA.'));
  }

  if (local) {
    const warning = String(source.warning || '');
    checks.push(check(
      'privacy',
      warning.includes('MIME') ? 'warning' : 'partial',
      warning.includes('MIME') ? 'Declared MIME differs from detected signature' : 'Local-processing boundary intact',
      'Source bytes remain local in this workflow. Embedded media metadata such as EXIF/ID3/XMP is not parsed or stripped yet.'
    ));
  } else {
    checks.push(check(
      'privacy',
      'partial',
      'Reference URL stored locally',
      'No media bytes are fetched in this phase. URL metadata is stored in the browser session project.'
    ));
  }

  if (local && finitePositive(source.duration)) {
    checks.push(check(
      'delivery',
      'partial',
      'Browser playback compatibility confirmed',
      'This browser decoded the source metadata. Platform-specific delivery profiles, codec levels and packaging rules are not yet validated.'
    ));
  } else {
    checks.push(check('delivery', 'not-inspected', 'Delivery compatibility not tested', 'A decoded local source is required for the current compatibility check.'));
  }

  const counts = {
    pass: checks.filter((item) => item.status === 'pass').length,
    warning: checks.filter((item) => item.status === 'warning').length,
    partial: checks.filter((item) => item.status === 'partial').length,
    notInspected: checks.filter((item) => item.status === 'not-inspected').length,
    notApplicable: checks.filter((item) => item.status === 'not-applicable').length
  };

  return {
    generatedAt: new Date().toISOString(),
    source: {
      kind: String(source.kind || ''),
      name: String(source.name || ''),
      mediaType: String(source.mediaType || ''),
      container: String(source.container || ''),
      detectedMime: String(source.detectedMime || ''),
      bytes: Number(source.bytes || 0),
      duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : null,
      width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
      height: Number.isFinite(Number(source.height)) ? Number(source.height) : null
    },
    checks,
    counts
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deterministicQcFixes(project) {
  const source = project?.source || null;
  const duration = finitePositive(source?.duration) || 0;
  const changes = [];
  const patch = {};

  if (source?.mediaType === 'video' && project?.videoEdits) {
    const normalized = normalizeVideoEdits(project.videoEdits, duration);
    if (!sameJson(normalized, project.videoEdits)) {
      patch.videoEdits = normalized;
      changes.push('Normalized video trim/playback state to source bounds.');
    }
  }

  if (source?.mediaType === 'audio' && project?.audioEdits) {
    const normalized = normalizeAudioEdits(project.audioEdits, duration);
    if (!sameJson(normalized, project.audioEdits)) {
      patch.audioEdits = normalized;
      changes.push('Normalized audio trim/level/fade state to source bounds.');
    }
  }

  if (Array.isArray(project?.transcript?.cues) && project.transcript.cues.length) {
    const original = normalizeTranscript(project.transcript);
    const sorted = original.cues
      .map((cue) => {
        const text = cue.text.replace(/[ \t]+$/gm, '').trim();
        let end = cue.end;
        if (duration > 0 && cue.start < duration && cue.end > duration) end = duration;
        return { ...cue, text, end: Math.max(cue.start, end) };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const next = { ...original, cues: sorted };
    if (!sameJson(next, original)) {
      patch.transcript = next;
      changes.push('Sorted subtitle cues, trimmed trailing whitespace, and clamped safe end-overflow to media duration.');
    }
  }

  return { changed: changes.length > 0, changes, patch };
}
