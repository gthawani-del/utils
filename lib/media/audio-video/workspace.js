import { normalizeAudioEdits, previewVolumeAt } from '../audio/edits.js';
import { drawAudioVideoFrame, normalizeAudioVideoConfig, outputDimensions, recorderMimeType } from './visualizer.js';

function safeFilename(source, extension) {
  const raw = String(source?.name || 'audio-video').replace(/\.[^.]+$/, '');
  const stem = raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'audio-video';
  return `${stem}-visualizer.${extension}`;
}

function audioContextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function waitForMedia(element, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener('loadedmetadata', onReady);
      element.removeEventListener('canplay', onReady);
      element.removeEventListener('error', onError);
      fn(value);
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(reject, new Error('Browser could not prepare the local audio for rendering.'));
    const timer = setTimeout(() => finish(reject, new Error('Audio render preparation timed out.')), timeoutMs);
    element.addEventListener('loadedmetadata', onReady, { once: true });
    element.addEventListener('canplay', onReady, { once: true });
    element.addEventListener('error', onError, { once: true });
    element.load();
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initAudioVideoWorkspace({
  getProject,
  getPlayer,
  getSource,
  saveConfig,
  setStatus
}) {
  const panel = document.querySelector('#audio-video-panel');
  const unavailable = document.querySelector('#audio-video-unavailable');
  const designer = document.querySelector('#audio-video-designer');
  const canvas = document.querySelector('#audio-video-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const mode = document.querySelector('#audio-video-mode');
  const aspect = document.querySelector('#audio-video-aspect');
  const theme = document.querySelector('#audio-video-theme');
  const title = document.querySelector('#audio-video-title-input');
  const artist = document.querySelector('#audio-video-artist');
  const showLyrics = document.querySelector('#audio-video-lyrics');
  const playButton = document.querySelector('#audio-video-play');
  const renderButton = document.querySelector('#audio-video-render');
  const cancelButton = document.querySelector('#audio-video-cancel');
  const status = document.querySelector('#audio-video-status');
  const formatLabel = document.querySelector('#audio-video-format-label');

  let previewContext = null;
  let previewSourceNode = null;
  let previewAnalyser = null;
  let previewFrequency = null;
  let previewTime = null;
  let previewPlayer = null;
  let previewMedia = null;
  let previewMuteGain = null;
  let animationFrame = 0;
  let renderSession = null;

  function isUsableSource() {
    const source = getSource();
    return source?.kind === 'local-file' && source.mediaType === 'audio' && Boolean(source.objectUrl);
  }

  function currentConfig() {
    return normalizeAudioVideoConfig(getProject().audioVideo, getSource(), getProject().lyrics);
  }

  function persist(patch, message = '') {
    const next = normalizeAudioVideoConfig({ ...currentConfig(), ...patch }, getSource(), getProject().lyrics);
    saveConfig(next);
    syncControls();
    drawPreview();
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
  }

  function setCanvasDimensions(config) {
    const memory = Number(globalThis.navigator?.deviceMemory || 0);
    const compact = memory > 0 && memory <= 4;
    const dimensions = outputDimensions(config.aspect, { compact });
    if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
    if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
    canvas.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
    return dimensions;
  }

  function drawPreview() {
    if (!ctx) return;
    const config = currentConfig();
    const source = getSource();
    const dimensions = setCanvasDimensions(config);
    const player = getPlayer();
    const time = Number(player?.currentTime || 0);
    drawAudioVideoFrame(ctx, {
      width: dimensions.width,
      height: dimensions.height,
      config,
      frequencyData: previewFrequency,
      timeData: previewTime,
      time,
      duration: Number(source?.duration || 0),
      lyrics: getProject().lyrics
    });
  }

  function frameLoop() {
    if (getProject().activeCategory !== 'audio-video') {
      animationFrame = 0;
      return;
    }

    if (previewPlayer && previewMedia) {
      if (previewPlayer.paused && !previewMedia.paused) previewMedia.pause();
      if (!previewPlayer.paused && previewMedia.paused) previewMedia.play().catch(() => {});
      if (Number.isFinite(previewPlayer.currentTime) && Math.abs(previewPlayer.currentTime - previewMedia.currentTime) > 0.12) {
        try { previewMedia.currentTime = previewPlayer.currentTime; } catch {}
      }
    }

    if (previewAnalyser && previewFrequency && previewTime) {
      previewAnalyser.getByteFrequencyData(previewFrequency);
      previewAnalyser.getByteTimeDomainData(previewTime);
    }
    drawPreview();
    animationFrame = requestAnimationFrame(frameLoop);
  }

  function ensureFrameLoop() {
    if (!animationFrame && getProject().activeCategory === 'audio-video') {
      animationFrame = requestAnimationFrame(frameLoop);
    }
  }

  function stopFrameLoop() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  async function closePreviewGraph() {
    if (previewSourceNode) {
      try { previewSourceNode.disconnect(); } catch {}
    }
    if (previewAnalyser) {
      try { previewAnalyser.disconnect(); } catch {}
    }
    if (previewMuteGain) {
      try { previewMuteGain.disconnect(); } catch {}
    }
    if (previewMedia) {
      previewMedia.pause();
      previewMedia.removeAttribute('src');
      previewMedia.load();
    }
    if (previewContext && previewContext.state !== 'closed') {
      try { await previewContext.close(); } catch {}
    }
    previewContext = null;
    previewSourceNode = null;
    previewAnalyser = null;
    previewFrequency = null;
    previewTime = null;
    previewPlayer = null;
    previewMedia = null;
    previewMuteGain = null;
  }

  async function ensurePreviewGraph() {
    const player = getPlayer();
    const AudioContextClass = audioContextConstructor();
    if (!isUsableSource() || !player || player.tagName !== 'AUDIO' || !AudioContextClass) return false;

    if (previewPlayer === player && previewContext && previewAnalyser && previewMedia) {
      if (previewContext.state === 'suspended') await previewContext.resume();
      return true;
    }

    await closePreviewGraph();

    try {
      previewMedia = document.createElement('audio');
      previewMedia.preload = 'auto';
      previewMedia.src = getSource().objectUrl;
      await waitForMedia(previewMedia);
      try { previewMedia.currentTime = Number(player.currentTime || 0); } catch {}

      previewContext = new AudioContextClass();
      previewSourceNode = previewContext.createMediaElementSource(previewMedia);
      previewAnalyser = previewContext.createAnalyser();
      previewAnalyser.fftSize = 256;
      previewAnalyser.smoothingTimeConstant = 0.82;
      previewMuteGain = previewContext.createGain();
      previewMuteGain.gain.value = 0;
      previewFrequency = new Uint8Array(previewAnalyser.frequencyBinCount);
      previewTime = new Uint8Array(previewAnalyser.fftSize);
      previewSourceNode.connect(previewAnalyser);
      previewAnalyser.connect(previewMuteGain);
      previewMuteGain.connect(previewContext.destination);
      previewPlayer = player;
      if (previewContext.state === 'suspended') await previewContext.resume();
      return true;
    } catch {
      await closePreviewGraph();
      return false;
    }
  }

  function syncControls() {
    const config = currentConfig();
    mode.value = config.mode;
    aspect.value = config.aspect;
    theme.value = config.theme;
    title.value = config.title;
    artist.value = config.artist;
    showLyrics.checked = config.showLyrics;
    showLyrics.disabled = !(getProject().lyrics?.lines?.length > 0);

    const mime = recorderMimeType();
    const extension = mime.includes('mp4') ? 'MP4' : mime ? 'WebM' : 'unsupported';
    formatLabel.textContent = mime
      ? `Browser render: ${extension} · 30 fps · real-time`
      : 'This browser cannot record a canvas video with MediaRecorder.';
    renderButton.disabled = !isUsableSource() || !mime || !canvas.captureStream || Boolean(renderSession);
    playButton.disabled = !isUsableSource();
    cancelButton.disabled = !renderSession;
  }

  function updateVisibility() {
    const visible = getProject().activeCategory === 'audio-video';
    panel.classList.toggle('hidden', !visible);
    if (!visible) {
      stopFrameLoop();
      return;
    }

    unavailable.classList.toggle('hidden', isUsableSource());
    designer.classList.toggle('hidden', !isUsableSource());
    syncControls();
    drawPreview();
    ensureFrameLoop();
  }

  async function playVisualizer() {
    if (!isUsableSource()) return;
    const player = getPlayer();
    const ready = await ensurePreviewGraph();
    if (!ready) {
      status.textContent = 'Live analyser preview is not supported by this browser. Static preview remains available.';
      return;
    }

    try {
      if (previewMedia) {
        try { previewMedia.currentTime = Number(player.currentTime || 0); } catch {}
      }
      await player.play();
      await previewMedia?.play();
      status.textContent = 'Live audio-reactive preview running locally.';
    } catch {
      status.textContent = 'Playback was blocked. Use the native audio play button once, then retry.';
    }
  }

  async function renderVideo() {
    if (renderSession || !isUsableSource()) return;

    const mime = recorderMimeType();
    if (!mime || typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      status.textContent = 'This browser does not expose the required local video recording APIs.';
      return;
    }

    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) {
      status.textContent = 'Web Audio is unavailable in this browser.';
      return;
    }

    const source = getSource();
    const config = currentConfig();
    const sourceDuration = Number(source.duration || 0);
    const edits = normalizeAudioEdits(getProject().audioEdits || {}, sourceDuration);
    const start = Math.min(edits.trimStart, sourceDuration);
    const end = Math.min(Math.max(edits.trimEnd, start), sourceDuration);

    if (!(end > start)) {
      status.textContent = 'Choose an audio range longer than zero seconds before rendering.';
      return;
    }

    const renderAudio = document.createElement('audio');
    renderAudio.preload = 'auto';
    renderAudio.src = source.objectUrl;

    let audioContext = null;
    let mediaStream = null;
    let recorder = null;
    let analyser = null;
    let gain = null;
    let animation = 0;
    const chunks = [];

    const cleanup = async () => {
      if (animation) cancelAnimationFrame(animation);
      animation = 0;
      renderAudio.pause();
      renderAudio.removeAttribute('src');
      renderAudio.load();
      if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== 'closed') {
        try { await audioContext.close(); } catch {}
      }
      renderSession = null;
      syncControls();
      ensureFrameLoop();
    };

    try {
      status.textContent = 'Preparing local audio-to-video render…';
      syncControls();
      await waitForMedia(renderAudio);

      audioContext = new AudioContextClass();
      const sourceNode = audioContext.createMediaElementSource(renderAudio);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();

      sourceNode.connect(analyser);
      analyser.connect(gain);
      gain.connect(destination);

      const frequency = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Uint8Array(analyser.fftSize);
      const dimensions = setCanvasDimensions(config);
      const canvasStream = canvas.captureStream(30);
      mediaStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      recorder = new MediaRecorder(mediaStream, {
        mimeType: mime,
        videoBitsPerSecond: dimensions.width * dimensions.height > 800_000 ? 5_000_000 : 3_500_000,
        audioBitsPerSecond: 160_000
      });

      renderSession = { recorder, audio: renderAudio, context: audioContext, cancelled: false };
      syncControls();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });

      recorder.addEventListener('error', async () => {
        status.textContent = 'Browser recording failed before the video completed.';
        await cleanup();
      });

      recorder.addEventListener('stop', async () => {
        const cancelled = Boolean(renderSession?.cancelled);
        if (!cancelled && chunks.length) {
          const blob = new Blob(chunks, { type: mime });
          const extension = mime.includes('mp4') ? 'mp4' : 'webm';
          downloadBlob(blob, safeFilename(source, extension));
          status.textContent = `Rendered ${(end - start).toFixed(1)} seconds locally and prepared the ${extension.toUpperCase()} file.`;
          setStatus('Audio → Video render completed locally.');
        } else if (cancelled) {
          status.textContent = 'Render cancelled. No output file was created.';
        }
        await cleanup();
      });

      const drawRenderFrame = () => {
        if (!renderSession || renderSession.cancelled) return;
        const current = Math.min(end, Math.max(start, Number(renderAudio.currentTime || start)));
        analyser.getByteFrequencyData(frequency);
        analyser.getByteTimeDomainData(timeData);
        gain.gain.value = previewVolumeAt(current, edits, sourceDuration);

        drawAudioVideoFrame(ctx, {
          width: dimensions.width,
          height: dimensions.height,
          config,
          frequencyData: frequency,
          timeData,
          time: current,
          duration: sourceDuration,
          lyrics: getProject().lyrics
        });

        const progress = Math.max(0, Math.min(1, (current - start) / Math.max(.001, end - start)));
        status.textContent = `Rendering locally… ${Math.round(progress * 100)}% · real-time`;

        if (current >= end - 0.03 || renderAudio.ended) {
          renderAudio.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }

        animation = requestAnimationFrame(drawRenderFrame);
      };

      renderAudio.currentTime = start;
      if (audioContext.state === 'suspended') await audioContext.resume();
      recorder.start(1000);
      await renderAudio.play();
      stopFrameLoop();
      animation = requestAnimationFrame(drawRenderFrame);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Local audio-to-video rendering failed.';
      if (renderSession) renderSession.cancelled = true;
      if (recorder?.state && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch {}
      } else {
        await cleanup();
      }
    }
  }

  function cancelRender() {
    if (!renderSession) return;
    renderSession.cancelled = true;
    renderSession.audio.pause();
    if (renderSession.recorder.state !== 'inactive') {
      renderSession.recorder.stop();
    }
  }

  mode.addEventListener('change', () => persist({ mode: mode.value }, 'Visualizer style updated.'));
  aspect.addEventListener('change', () => persist({ aspect: aspect.value }, 'Output aspect updated.'));
  theme.addEventListener('change', () => persist({ theme: theme.value }, 'Visualizer theme updated.'));
  title.addEventListener('change', () => persist({ title: title.value }, 'Title updated.'));
  artist.addEventListener('change', () => persist({ artist: artist.value }, 'Artist text updated.'));
  showLyrics.addEventListener('change', () => persist({ showLyrics: showLyrics.checked }, 'Lyric overlay setting updated.'));
  playButton.addEventListener('click', playVisualizer);
  renderButton.addEventListener('click', renderVideo);
  cancelButton.addEventListener('click', cancelRender);

  syncControls();
  drawPreview();

  return {
    setAspect(aspect) {
      persist({ aspect }, `Output aspect set to ${aspect} by Command Assistant.`);
      return currentConfig();
    },
    updateVisibility,
    onSourceChanged() {
      closePreviewGraph();
      syncControls();
      updateVisibility();
    },
    resetForNewSource() {
      closePreviewGraph();
      if (renderSession) cancelRender();
      syncControls();
      drawPreview();
    },
    destroy() {
      stopFrameLoop();
      closePreviewGraph();
      if (renderSession) cancelRender();
    }
  };
}
