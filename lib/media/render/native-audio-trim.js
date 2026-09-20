function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeAudioTrimRange(start, end, duration) {
  const safeDuration = Math.max(0, finite(duration));
  const safeStart = Math.min(safeDuration, Math.max(0, finite(start)));
  const safeEnd = Math.min(safeDuration, Math.max(safeStart, finite(end, safeDuration)));
  return {
    start: safeStart,
    end: safeEnd,
    duration: Math.max(0, safeEnd - safeStart)
  };
}

export function normalizeAudioRenderSettings(edits, duration) {
  const input = edits && typeof edits === 'object' ? edits : {};
  const range = normalizeAudioTrimRange(input.start ?? input.trimStart, input.end ?? input.trimEnd, duration);
  return {
    ...range,
    volume: Math.max(0, Math.min(1, finite(input.volume, 1))),
    fadeIn: Math.max(0, Math.min(range.duration, finite(input.fadeIn))),
    fadeOut: Math.max(0, Math.min(range.duration, finite(input.fadeOut)))
  };
}

export function audioGainPlan(settings) {
  const input = normalizeAudioRenderSettings(settings, settings?.sourceDuration ?? settings?.end ?? settings?.trimEnd ?? 0);
  return {
    volume: input.volume,
    fadeIn: input.fadeIn,
    fadeOut: input.fadeOut,
    duration: input.duration,
    fadeOutStart: Math.max(0, input.duration - input.fadeOut)
  };
}

export function audioTrimTimeoutMs(selectionSeconds) {
  const seconds = Math.max(0, finite(selectionSeconds));
  return Math.max(30_000, Math.round(seconds * 1_500 + 20_000));
}

export function selectAudioRecorderMime(isTypeSupported = globalThis.MediaRecorder?.isTypeSupported?.bind(globalThis.MediaRecorder)) {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4'
  ];
  if (typeof isTypeSupported !== 'function') return '';
  return candidates.find((type) => isTypeSupported(type)) || '';
}

function waitForEvent(element, successEvent, errorMessage, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener(successEvent, onSuccess);
      element.removeEventListener('error', onError);
      fn(value);
    };
    const onSuccess = () => finish(resolve);
    const onError = () => finish(reject, new Error(errorMessage));
    const timer = setTimeout(() => finish(reject, new Error(errorMessage)), timeoutMs);
    element.addEventListener(successEvent, onSuccess, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch {}
  }
}

export function nativeAudioTrimSupport() {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof document === 'undefined') return { ok: false, reason: 'DOM media APIs are unavailable.' };
  if (typeof AudioContextCtor !== 'function') return { ok: false, reason: 'Web Audio is unavailable in this browser.' };
  if (typeof MediaRecorder === 'undefined') return { ok: false, reason: 'MediaRecorder is unavailable in this browser.' };
  const mime = selectAudioRecorderMime();
  if (!mime) return { ok: false, reason: 'No supported browser audio recording container was found.' };
  return { ok: true, mime, AudioContextCtor };
}

export async function renderNativeAudioTrim(source, edits, {
  signal,
  onProgress,
  onStage
} = {}) {
  const support = nativeAudioTrimSupport();
  if (!support.ok) return { ok: false, state: 'unsupported', error: { code: 'ENCODER_UNAVAILABLE', message: support.reason } };

  const settings = normalizeAudioRenderSettings(edits, source?.duration);
  const range = { start: settings.start, end: settings.end, duration: settings.duration };
  if (range.duration <= 0) {
    return { ok: false, state: 'failed', error: { code: 'INVALID_TRIM', message: 'Trim selection must have a positive duration.' } };
  }
  if (!source?.objectUrl || source?.mediaType !== 'audio') {
    return { ok: false, state: 'failed', error: { code: 'SOURCE_UNAVAILABLE', message: 'A relinked local audio source is required.' } };
  }

  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.src = source.objectUrl;

  let context = null;
  let mediaNode = null;
  let volumeGain = null;
  let fadeInGain = null;
  let fadeOutGain = null;
  let destination = null;
  let recorder = null;
  let interval = 0;
  let timeout = 0;

  const cleanup = async () => {
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
    interval = 0;
    timeout = 0;
    try { audio.pause(); } catch {}
    try { mediaNode?.disconnect(); } catch {}
    try { volumeGain?.disconnect(); } catch {}
    try { fadeInGain?.disconnect(); } catch {}
    try { fadeOutGain?.disconnect(); } catch {}
    try { destination?.disconnect?.(); } catch {}
    stopTracks(destination?.stream);
    audio.removeAttribute('src');
    try { audio.load(); } catch {}
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
  };

  try {
    onStage?.('Loading source');
    if (audio.readyState < 1) await waitForEvent(audio, 'loadedmetadata', 'Browser could not load the local audio for trimming.');

    audio.playbackRate = 1;
    audio.currentTime = range.start;
    await waitForEvent(audio, 'seeked', 'Browser could not seek to the selected In point.');

    context = new support.AudioContextCtor();
    if (context.state === 'suspended') await context.resume();

    mediaNode = context.createMediaElementSource(audio);
    volumeGain = context.createGain();
    fadeInGain = context.createGain();
    fadeOutGain = context.createGain();
    destination = context.createMediaStreamDestination();

    const renderStart = context.currentTime;
    volumeGain.gain.cancelScheduledValues(renderStart);
    volumeGain.gain.setValueAtTime(settings.volume, renderStart);

    fadeInGain.gain.cancelScheduledValues(renderStart);
    if (settings.fadeIn > 0) {
      fadeInGain.gain.setValueAtTime(0, renderStart);
      fadeInGain.gain.linearRampToValueAtTime(1, renderStart + settings.fadeIn);
    } else {
      fadeInGain.gain.setValueAtTime(1, renderStart);
    }

    fadeOutGain.gain.cancelScheduledValues(renderStart);
    if (settings.fadeOut > 0) {
      const fadeOutStart = renderStart + Math.max(0, range.duration - settings.fadeOut);
      fadeOutGain.gain.setValueAtTime(1, renderStart);
      fadeOutGain.gain.setValueAtTime(1, fadeOutStart);
      fadeOutGain.gain.linearRampToValueAtTime(0, renderStart + range.duration);
    } else {
      fadeOutGain.gain.setValueAtTime(1, renderStart);
    }

    mediaNode.connect(volumeGain);
    volumeGain.connect(fadeInGain);
    fadeInGain.connect(fadeOutGain);
    fadeOutGain.connect(destination);

    if (!destination.stream?.getAudioTracks?.().length) {
      await cleanup();
      return { ok: false, state: 'unsupported', error: { code: 'AUDIO_CAPTURE_UNAVAILABLE', message: 'Browser could not expose an audio stream for local trimming.' } };
    }

    const chunks = [];
    recorder = new MediaRecorder(destination.stream, { mimeType: support.mime });

    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };

      const onAbort = () => {
        try { audio.pause(); } catch {}
        if (recorder?.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        finish({ ok: false, state: 'cancelled', error: { code: 'CANCELLED', message: 'Audio trim was cancelled.' } });
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });

      recorder.addEventListener('error', () => {
        finish({ ok: false, state: 'failed', error: { code: 'RECORDER_FAILURE', message: 'Browser audio encoder failed safely.' } });
      });

      recorder.addEventListener('stop', () => {
        if (signal?.aborted) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || support.mime });
        finish(blob.size
          ? { ok: true, state: 'completed', blob, mime: blob.type, range, settings }
          : { ok: false, state: 'failed', error: { code: 'EMPTY_OUTPUT', message: 'Audio trim produced an empty output.' } });
      });

      const stage = settings.volume !== 1 || settings.fadeIn > 0 || settings.fadeOut > 0
        ? 'Rendering audio edits'
        : 'Encoding audio trim';
      onStage?.(stage);
      recorder.start(1000);

      interval = setInterval(() => {
        if (signal?.aborted) return;
        const current = Math.max(range.start, Math.min(range.end, finite(audio.currentTime, range.start)));
        const progress = range.duration > 0 ? ((current - range.start) / range.duration) * 100 : 0;
        onProgress?.(Math.max(0, Math.min(99, progress)), stage);
        if (current >= range.end - 0.025 || audio.ended) {
          try { audio.pause(); } catch {}
          if (recorder.state !== 'inactive') recorder.stop();
        }
      }, 80);

      timeout = setTimeout(() => {
        try { audio.pause(); } catch {}
        if (recorder?.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        finish({ ok: false, state: 'timed_out', error: { code: 'TIMEOUT', message: 'Audio trim exceeded its operation-specific time budget.' } });
      }, audioTrimTimeoutMs(range.duration));

      audio.play().catch(() => {
        if (recorder?.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        finish({ ok: false, state: 'failed', error: { code: 'PLAYBACK_BLOCKED', message: 'Browser blocked local render playback. Interact with the page and retry.' } });
      });
    });

    return result;
  } catch (error) {
    return {
      ok: false,
      state: 'failed',
      error: {
        code: 'AUDIO_TRIM_FAILURE',
        message: error instanceof Error ? error.message : 'Audio processing failed safely.'
      }
    };
  } finally {
    await cleanup();
  }
}
