const CATEGORY_ALIASES = Object.freeze([
  { id: 'video', label: 'Video Editor', terms: ['video editor', 'video editing'] },
  { id: 'audio', label: 'Audio Studio', terms: ['audio studio', 'audio editor', 'audio editing'] },
  { id: 'transcript', label: 'Transcription & Subtitles', terms: ['transcription', 'transcript', 'subtitles', 'captions'] },
  { id: 'lyrics', label: 'Lyrics & Karaoke', terms: ['lyrics', 'karaoke'] },
  { id: 'audio-video', label: 'Audio → Video', terms: ['audio to video', 'audio→video', 'visualizer', 'audiogram'] },
  { id: 'compiler', label: 'Media Compiler', terms: ['media compiler', 'compiler'] },
  { id: 'qc', label: 'QC & Forensics', terms: ['qc', 'quality control', 'forensics'] },
  { id: 'delivery', label: 'Pro Workflow & Delivery', terms: ['delivery', 'pro workflow', 'handoff'] }
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseClock(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const colon = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (colon) {
    const hours = Number(colon[1] || 0);
    const minutes = Number(colon[2] || 0);
    const seconds = Number(colon[3] || 0);
    if (minutes > 59 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  const unit = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hours?)?$/);
  if (!unit) return null;
  const amount = Number(unit[1]);
  const suffix = unit[2] || 's';
  if (suffix.startsWith('ms')) return amount / 1000;
  if (suffix.startsWith('m') && !suffix.startsWith('ms')) return amount * 60;
  if (suffix.startsWith('h')) return amount * 3600;
  return amount;
}

function sourceContext(project) {
  const source = project?.source || null;
  return {
    hasSource: Boolean(source),
    local: source?.kind === 'local-file',
    mediaType: String(source?.mediaType || ''),
    duration: Number.isFinite(Number(source?.duration)) ? Math.max(0, Number(source.duration)) : 0
  };
}

function action(id, type, label, index, params = {}, adjustable = [], status = 'ready', reason = '') {
  return { id, type, label, index, params, adjustable, status, reason };
}

function occurrence(text, regex) {
  const match = regex.exec(text);
  return match ? { index: match.index, match } : null;
}

function statusFor(type, project) {
  const source = sourceContext(project);

  if (type === 'open-category') return { status: 'ready', reason: 'Routes to an existing Media Studio workspace.' };
  if (type === 'run-qc' || type === 'apply-qc-fixes') {
    return source.hasSource
      ? { status: 'ready', reason: 'Uses the existing deterministic QC engine.' }
      : { status: 'blocked', reason: 'Load a source before running QC.' };
  }
  if (type === 'trim') {
    return source.local && (source.mediaType === 'video' || source.mediaType === 'audio')
      ? { status: 'ready', reason: 'Uses the current non-destructive local trim state.' }
      : { status: 'blocked', reason: 'Trim requires a relinked local audio or video source.' };
  }
  if (type === 'volume' || type === 'fade-in' || type === 'fade-out') {
    return source.local && source.mediaType === 'audio'
      ? { status: 'ready', reason: 'Uses the existing Audio Studio preview/edit state.' }
      : { status: 'blocked', reason: 'This command currently requires a local audio source.' };
  }
  if (type === 'set-aspect') {
    return source.local && source.mediaType === 'audio'
      ? { status: 'ready', reason: 'Routes the current audio project to the browser-native Audio → Video renderer.' }
      : { status: 'blocked', reason: 'The current aspect renderer supports local audio projects only.' };
  }

  return { status: 'blocked', reason: 'This operation is recognized but its deterministic processing engine is not implemented yet.' };
}

function unsupportedAction(type, label, index, params = {}, adjustable = [], reason = '') {
  return action(
    `${type}-${index}`,
    type,
    label,
    index,
    params,
    adjustable,
    'blocked',
    reason || 'Recognized, but this processing engine is not implemented yet.'
  );
}

function dedupeAndSort(actions) {
  const seen = new Set();
  return actions
    .sort((a, b) => a.index - b.index)
    .filter((item) => {
      const key = item.type === 'open-category' ? `${item.type}:${item.params.category}` : item.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => ({ ...item, id: `${item.type}-${index + 1}`, order: index }));
}

export function parseCommand(command, project = {}) {
  const raw = String(command || '').trim();
  const text = raw.toLowerCase();
  if (!raw) return { command: raw, actions: [], unrecognized: true };

  const actions = [];
  const source = sourceContext(project);

  const trim = occurrence(text, /\b(?:trim|cut)\s+(?:from\s+)?((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hours?)?)\s+(?:to|until|-)\s+((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hours?)?)/i);
  if (trim) {
    const start = parseClock(trim.match[1]);
    const end = parseClock(trim.match[2]);
    const state = statusFor('trim', project);
    actions.push(action('trim', 'trim', 'Trim media range', trim.index, { start, end }, [
      { key: 'start', label: 'Start (seconds)', type: 'number', min: 0, step: 0.01 },
      { key: 'end', label: 'End (seconds)', type: 'number', min: 0, step: 0.01 }
    ], start !== null && end !== null && end >= start ? state.status : 'blocked',
    start === null || end === null || end < start ? 'Trim needs a valid start and end time, with end ≥ start.' : state.reason));
  }

  const volume = occurrence(text, /\b(?:set\s+)?volume(?:\s+to|\s+at)?\s+(\d{1,3})\s*%/i);
  if (volume) {
    const value = Math.min(100, Math.max(0, Number(volume.match[1])));
    const state = statusFor('volume', project);
    actions.push(action('volume', 'volume', 'Set audio volume', volume.index, { percent: value }, [
      { key: 'percent', label: 'Volume %', type: 'number', min: 0, max: 100, step: 1 }
    ], state.status, state.reason));
  }

  for (const [type, label, regex] of [
    ['fade-in', 'Set fade in', /\bfade\s*in(?:\s+for|\s+over|\s+)?\s*(\d+(?:\.\d+)?)\s*(s|sec(?:ond)?s?|m|min(?:ute)?s?)?/i],
    ['fade-out', 'Set fade out', /\bfade\s*out(?:\s+for|\s+over|\s+)?\s*(\d+(?:\.\d+)?)\s*(s|sec(?:ond)?s?|m|min(?:ute)?s?)?/i]
  ]) {
    const found = occurrence(text, regex);
    if (!found) continue;
    let seconds = Number(found.match[1]);
    if (String(found.match[2] || '').toLowerCase().startsWith('m')) seconds *= 60;
    const state = statusFor(type, project);
    actions.push(action(type, type, label, found.index, { seconds }, [
      { key: 'seconds', label: 'Seconds', type: 'number', min: 0, step: 0.1 }
    ], state.status, state.reason));
  }

  let aspect = null;
  let aspectIndex = Number.POSITIVE_INFINITY;
  for (const [value, regex] of [
    ['9:16', /\b(?:9\s*:\s*16|reel|shorts?|vertical)\b/i],
    ['1:1', /\b(?:1\s*:\s*1|square)\b/i],
    ['16:9', /\b(?:16\s*:\s*9|youtube|landscape)\b/i]
  ]) {
    const found = occurrence(text, regex);
    if (found && found.index < aspectIndex) {
      aspect = value;
      aspectIndex = found.index;
    }
  }
  if (aspect) {
    const state = statusFor('set-aspect', project);
    actions.push(action('set-aspect', 'set-aspect', `Set output aspect to ${aspect}`, aspectIndex, { aspect }, [
      { key: 'aspect', label: 'Aspect', type: 'select', options: ['16:9', '9:16', '1:1'] }
    ], state.status, state.reason));
  }

  const qcFix = occurrence(text, /\b(?:apply|run|do)?\s*(?:safe\s+)?(?:qc\s+)?fix(?:es)?\b/i);
  if (qcFix) {
    const state = statusFor('apply-qc-fixes', project);
    actions.push(action('apply-qc-fixes', 'apply-qc-fixes', 'Apply deterministic QC fixes', qcFix.index, {}, [], state.status, state.reason));
  } else {
    const qc = occurrence(text, /\b(?:run|check|perform|open)?\s*(?:qc|quality\s+control|forensics)\b/i);
    if (qc) {
      const state = statusFor('run-qc', project);
      actions.push(action('run-qc', 'run-qc', 'Run QC report', qc.index, {}, [], state.status, state.reason));
    }
  }

  const removeSilence = occurrence(text, /\b(?:remove|cut|delete)\s+(?:the\s+)?silence\b/i);
  if (removeSilence) actions.push(unsupportedAction(
    'remove-silence',
    'Remove silence',
    removeSilence.index,
    {},
    [],
    'Silence detection/removal is not implemented yet; the Command Assistant will not invent cuts.'
  ));

  const normalize = occurrence(text, /\bnormalize(?:\s+(?:the\s+)?)?(?:voice|audio|dialogue|dialog)?\b/i);
  if (normalize) actions.push(unsupportedAction(
    'normalize-audio',
    'Normalize audio / dialogue',
    normalize.index,
    {},
    [],
    'Loudness normalization requires a real measurement/processing engine that is not enabled yet.'
  ));

  const captions = occurrence(text, /\b(?:add|generate|create|auto(?:matically)?\s+generate|transcribe)\s+(?:captions?|subtitles?|transcript)\b/i);
  if (captions) actions.push(unsupportedAction(
    'generate-captions',
    'Generate captions / transcript',
    captions.index,
    {},
    [],
    'Automatic speech-to-text is not enabled. Existing SRT/VTT import and manual cue editing remain available.'
  ));

  const size = occurrence(text, /\b(?:under|below|max(?:imum)?|target(?:\s+size)?(?:\s+of)?)\s*(\d+(?:\.\d+)?)\s*(mb|gb)\b/i);
  if (size) {
    const mb = String(size.match[2]).toLowerCase() === 'gb' ? Number(size.match[1]) * 1024 : Number(size.match[1]);
    actions.push(unsupportedAction(
      'target-size',
      `Target export size ≤ ${mb} MB`,
      size.index,
      { megabytes: mb },
      [{ key: 'megabytes', label: 'Target MB', type: 'number', min: 1, step: 1 }],
      'Target-size encoding requires the future deterministic media encoder.'
    ));
  }

  const mp3 = occurrence(text, /\b(?:export|convert|make|create).{0,18}\bmp3\b/i);
  if (mp3) actions.push(unsupportedAction(
    'encode-mp3',
    'Encode podcast MP3',
    mp3.index,
    {},
    [],
    'MP3 encoding is not enabled without a dedicated local encoder.'
  ));

  const explicitOpen = /\b(?:open|go\s+to|show|switch\s+to)\s+([a-z&→\- ]{2,40})/gi;
  let openMatch;
  while ((openMatch = explicitOpen.exec(text))) {
    const phrase = openMatch[1].trim();
    const category = CATEGORY_ALIASES.find((item) => item.terms.some((term) => phrase.startsWith(term)));
    if (!category) continue;
    const state = statusFor('open-category', project);
    actions.push(action(
      'open-category',
      'open-category',
      `Open ${category.label}`,
      openMatch.index,
      { category: category.id },
      [{ key: 'category', label: 'Workspace', type: 'select', options: CATEGORY_ALIASES.map((item) => item.id) }],
      state.status,
      state.reason
    ));
  }

  const ordered = dedupeAndSort(actions);
  return {
    command: raw,
    actions: ordered,
    unrecognized: ordered.length === 0,
    context: source
  };
}

export function reevaluateAction(input, project = {}) {
  const item = { ...input, params: { ...(input?.params || {}) } };
  if (['remove-silence', 'normalize-audio', 'generate-captions', 'target-size', 'encode-mp3'].includes(item.type)) return item;

  if (item.type === 'trim') {
    const start = finite(item.params.start, -1);
    const end = finite(item.params.end, -1);
    if (start < 0 || end < start) {
      return { ...item, status: 'blocked', reason: 'Trim needs a valid start and end time, with end ≥ start.' };
    }
  }

  if (item.type === 'volume') {
    const value = finite(item.params.percent, -1);
    if (value < 0 || value > 100) return { ...item, status: 'blocked', reason: 'Volume must be between 0% and 100%.' };
  }

  if (item.type === 'fade-in' || item.type === 'fade-out') {
    if (finite(item.params.seconds, -1) < 0) return { ...item, status: 'blocked', reason: 'Fade duration must be zero or greater.' };
  }

  const state = statusFor(item.type, project);
  return { ...item, status: state.status, reason: state.reason };
}
