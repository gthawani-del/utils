function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeVideoTrimRange(start, end, duration) {
  const safeDuration = Math.max(0, finite(duration));
  const safeStart = Math.min(safeDuration, Math.max(0, finite(start)));
  const safeEnd = Math.min(safeDuration, Math.max(safeStart, finite(end, safeDuration)));
  return {
    start: safeStart,
    end: safeEnd,
    duration: Math.max(0, safeEnd - safeStart)
  };
}

const ALLOWED_RENDER_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
const ALLOWED_OUTPUT_ASPECTS = Object.freeze(['original', '16:9', '9:16', '1:1']);
const ASPECT_RATIOS = Object.freeze({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 });
const MAX_ASPECT_PIXELS = Object.freeze({ '16:9': 1920 * 1080, '9:16': 1080 * 1920, '1:1': 1080 * 1080 });

function evenFloor(value) {
  return Math.max(2, Math.floor(Math.max(2, finite(value, 2)) / 2) * 2);
}

export function videoOutputDimensions(width, height, aspect = 'original') {
  const sourceWidth = evenFloor(width);
  const sourceHeight = evenFloor(height);
  const normalizedAspect = ALLOWED_OUTPUT_ASPECTS.includes(String(aspect)) ? String(aspect) : 'original';
  if (normalizedAspect === 'original') {
    return { width: sourceWidth, height: sourceHeight, aspect: 'original', changed: false };
  }
  const ratio = ASPECT_RATIOS[normalizedAspect];
  const sourcePixels = sourceWidth * sourceHeight;
  const targetPixels = Math.max(4, Math.min(sourcePixels, MAX_ASPECT_PIXELS[normalizedAspect]));
  let targetWidth = evenFloor(Math.sqrt(targetPixels * ratio));
  let targetHeight = evenFloor(targetWidth / ratio);
  return {
    width: targetWidth,
    height: targetHeight,
    aspect: normalizedAspect,
    changed: targetWidth !== sourceWidth || targetHeight !== sourceHeight
  };
}

export function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sw = Math.max(1, finite(sourceWidth, 1));
  const sh = Math.max(1, finite(sourceHeight, 1));
  const tw = Math.max(1, finite(targetWidth, 1));
  const th = Math.max(1, finite(targetHeight, 1));
  const scale = Math.min(tw / sw, th / sh);
  const width = sw * scale;
  const height = sh * scale;
  return { x: (tw - width) / 2, y: (th - height) / 2, width, height };
}

export function videoOutputDuration(selectionSeconds, playbackRate) {
  const seconds = Math.max(0, finite(selectionSeconds));
  const rate = ALLOWED_RENDER_RATES.includes(Number(playbackRate)) ? Number(playbackRate) : 1;
  return rate > 0 ? seconds / rate : seconds;
}

export function normalizeVideoRenderSettings(input, duration) {
  const source = input && typeof input === 'object' ? input : {};
  const range = normalizeVideoTrimRange(source.start ?? source.trimStart, source.end ?? source.trimEnd, duration);
  const playbackRate = ALLOWED_RENDER_RATES.includes(Number(source.playbackRate)) ? Number(source.playbackRate) : 1;
  const outputAspect = ALLOWED_OUTPUT_ASPECTS.includes(String(source.outputAspect)) ? String(source.outputAspect) : 'original';
  const dimensions = videoOutputDimensions(source.sourceWidth, source.sourceHeight, outputAspect);
  return {
    ...range,
    muted: Boolean(source.muted),
    playbackRate,
    outputDuration: videoOutputDuration(range.duration, playbackRate),
    outputAspect,
    outputWidth: dimensions.width,
    outputHeight: dimensions.height,
    resizeChanged: dimensions.changed
  };
}

export function selectVideoOutputTracks(videoStream, audioStream, muted) {
  const videoTracks = videoStream?.getVideoTracks?.() || [];
  const audioTracks = muted ? [] : (audioStream?.getAudioTracks?.() || []);
  return [...videoTracks, ...audioTracks];
}

export function videoTrimTimeoutMs(selectionSeconds) {
  const seconds = Math.max(0, finite(selectionSeconds));
  return Math.max(30_000, Math.round(seconds * 1_500 + 20_000));
}

export function selectVideoRecorderMime(isTypeSupported = globalThis.MediaRecorder?.isTypeSupported?.bind(globalThis.MediaRecorder)) {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
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

function captureFrom(video) {
  const capture = video.captureStream || video.mozCaptureStream;
  return typeof capture === 'function' ? capture.call(video) : null;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch {}
  }
}

export function nativeVideoTrimSupport() {
  if (typeof document === 'undefined') return { ok: false, reason: 'DOM media APIs are unavailable.' };
  if (typeof MediaRecorder === 'undefined') return { ok: false, reason: 'MediaRecorder is unavailable in this browser.' };
  const probe = document.createElement('video');
  if (typeof (probe.captureStream || probe.mozCaptureStream) !== 'function') {
    return { ok: false, reason: 'Video captureStream is unavailable in this browser.' };
  }
  const mime = selectVideoRecorderMime();
  if (!mime) return { ok: false, reason: 'No supported browser video recording container was found.' };
  return { ok: true, mime };
}

export async function renderNativeVideoTrim(source, edits, {
  signal,
  onProgress,
  onStage
} = {}) {
  const support = nativeVideoTrimSupport();
  if (!support.ok) return { ok: false, state: 'unsupported', error: { code: 'ENCODER_UNAVAILABLE', message: support.reason } };

  const settings = normalizeVideoRenderSettings({
    ...edits,
    sourceWidth: source?.width,
    sourceHeight: source?.height
  }, source?.duration);
  const range = { start: settings.start, end: settings.end, duration: settings.duration };
  if (range.duration <= 0) {
    return { ok: false, state: 'failed', error: { code: 'INVALID_TRIM', message: 'Trim selection must have a positive duration.' } };
  }
  if (!source?.objectUrl || source?.mediaType !== 'video') {
    return { ok: false, state: 'failed', error: { code: 'SOURCE_UNAVAILABLE', message: 'A relinked local video source is required.' } };
  }

  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;
  video.src = source.objectUrl;
  let capturedStream = null;
  let renderVideoStream = null;
  let outputStream = null;
  let audioContext = null;
  let audioNode = null;
  let audioDestination = null;
  let canvas = null;
  let canvasContext = null;
  let animationFrame = 0;
  let recorder = null;
  let interval = 0;
  let timeout = 0;

  const cleanup = () => {
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
    interval = 0;
    timeout = 0;
    try { video.pause(); } catch {}
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    stopTracks(outputStream);
    if (renderVideoStream !== outputStream) stopTracks(renderVideoStream);
    if (capturedStream !== outputStream && capturedStream !== renderVideoStream) stopTracks(capturedStream);
    try { audioNode?.disconnect(); } catch {}
    try { audioDestination?.disconnect?.(); } catch {}
    if (audioContext && audioContext.state !== 'closed') {
      try { audioContext.close(); } catch {}
    }
    video.removeAttribute('src');
    try { video.load(); } catch {}
  };

  try {
    onStage?.('Loading source');
    if (video.readyState < 1) await waitForEvent(video, 'loadedmetadata', 'Browser could not load the local video for trimming.');

    video.playbackRate = settings.playbackRate;
    if ('preservesPitch' in video) video.preservesPitch = true;
    if ('mozPreservesPitch' in video) video.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = true;
    video.currentTime = range.start;
    await waitForEvent(video, 'seeked', 'Browser could not seek to the selected In point.');

    capturedStream = captureFrom(video);
    if (!capturedStream || capturedStream.getVideoTracks().length === 0) {
      cleanup();
      return { ok: false, state: 'unsupported', error: { code: 'CAPTURE_UNAVAILABLE', message: 'Browser could not expose the video stream for local processing.' } };
    }

    renderVideoStream = capturedStream;

    if (settings.outputAspect !== 'original') {
      canvas = document.createElement('canvas');
      canvas.width = settings.outputWidth;
      canvas.height = settings.outputHeight;
      canvasContext = canvas.getContext('2d', { alpha: false });
      if (!canvasContext || typeof canvas.captureStream !== 'function') {
        cleanup();
        return { ok: false, state: 'unsupported', error: { code: 'CANVAS_CAPTURE_UNAVAILABLE', message: 'Browser cannot safely capture resized video output.' } };
      }

      const drawFrame = () => {
        if (!canvasContext || signal?.aborted || video.ended) return;
        const rect = containRect(video.videoWidth || source.width, video.videoHeight || source.height, canvas.width, canvas.height);
        canvasContext.fillStyle = '#000';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
        try { canvasContext.drawImage(video, rect.x, rect.y, rect.width, rect.height); } catch {}
        animationFrame = requestAnimationFrame(drawFrame);
      };
      drawFrame();
      renderVideoStream = canvas.captureStream(30);
    }

    let audioStream = null;
    if (!settings.muted) {
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof AudioContextCtor !== 'function') {
        cleanup();
        return { ok: false, state: 'unsupported', error: { code: 'AUDIO_CAPTURE_UNAVAILABLE', message: 'Web Audio is required to preserve audio during video processing.' } };
      }
      audioContext = new AudioContextCtor();
      if (audioContext.state === 'suspended') await audioContext.resume();
      audioNode = audioContext.createMediaElementSource(video);
      audioDestination = audioContext.createMediaStreamDestination();
      audioNode.connect(audioDestination);
      audioStream = audioDestination.stream;
    }

    const tracks = selectVideoOutputTracks(renderVideoStream, audioStream, settings.muted);
    outputStream = new MediaStream(tracks);

    if (settings.muted && outputStream.getAudioTracks().length !== 0) {
      cleanup();
      return { ok: false, state: 'failed', error: { code: 'MUTE_FAILED', message: 'Muted render still contained an audio track before encoding.' } };
    }
    if (!settings.muted && outputStream.getAudioTracks().length === 0) {
      cleanup();
      return { ok: false, state: 'failed', error: { code: 'AUDIO_CAPTURE_FAILED', message: 'Video processing could not preserve the source audio track.' } };
    }

    const chunks = [];
    recorder = new MediaRecorder(outputStream, { mimeType: support.mime });

    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };

      const onAbort = () => {
        try { video.pause(); } catch {}
        if (recorder?.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        finish({ ok: false, state: 'cancelled', error: { code: 'CANCELLED', message: 'Video trim was cancelled.' } });
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });

      recorder.addEventListener('error', () => {
        finish({ ok: false, state: 'failed', error: { code: 'RECORDER_FAILURE', message: 'Browser video encoder failed safely.' } });
      });

      recorder.addEventListener('stop', () => {
        if (signal?.aborted) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || support.mime });
        finish(blob.size
          ? { ok: true, state: 'completed', blob, mime: blob.type, range, settings, audioTrackCount: outputStream?.getAudioTracks?.().length || 0 }
          : { ok: false, state: 'failed', error: { code: 'EMPTY_OUTPUT', message: 'Video trim produced an empty output.' } });
      });

      const stageParts = ['Encoding video'];
      if (settings.outputAspect !== 'original') stageParts.push(`${settings.outputAspect} fit`);
      if (settings.playbackRate !== 1) stageParts.push(`${settings.playbackRate}× speed`);
      if (settings.muted) stageParts.push('mute');
      const stage = stageParts.join(' + ');
      onStage?.(stage);
      recorder.start(1000);

      interval = setInterval(() => {
        if (signal?.aborted) return;
        const current = Math.max(range.start, Math.min(range.end, finite(video.currentTime, range.start)));
        const progress = range.duration > 0 ? ((current - range.start) / range.duration) * 100 : 0;
        onProgress?.(Math.max(0, Math.min(99, progress)), stage);
        if (current >= range.end - 0.025 || video.ended) {
          try { video.pause(); } catch {}
          if (recorder.state !== 'inactive') recorder.stop();
        }
      }, 80);

      timeout = setTimeout(() => {
        try { video.pause(); } catch {}
        if (recorder?.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        finish({ ok: false, state: 'timed_out', error: { code: 'TIMEOUT', message: 'Video trim exceeded its operation-specific time budget.' } });
      }, videoTrimTimeoutMs(settings.outputDuration));

      video.play().catch(() => {
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
        code: 'TRIM_FAILURE',
        message: error instanceof Error ? error.message : 'Video trim failed safely.'
      }
    };
  } finally {
    cleanup();
  }
}
