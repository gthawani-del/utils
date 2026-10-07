import { drawVideoFrame, outputDimensions, supportedVideoExportFormats } from './render.js';
import { drawKineticText } from './kinetic.js';
import { normalizeSmoothMatch, validateConformSources } from './conform.js';

function awaitEvent(target, event, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(event + ' timed out')); }, timeout);
    function cleanup() { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', fail); }
    function done() { cleanup(); resolve(); }
    function fail() { cleanup(); reject(new Error('Cannot decode this video')); }
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}
async function seek(video, time) {
  if (Math.abs(video.currentTime - time) < 0.025) return;
  const pending = awaitEvent(video, 'seeked');
  video.currentTime = time;
  await pending;
}
// Real-time browser-native conform. Reuses one decoder for mixed resolutions,
// outputs one fixed canvas stream at 30 fps by default. Does not interpolate frames.
export async function renderConformedVideo({ segments, sources, aspect = '9:16', fit = 'contain', fps = 30, resolution = 720, customWidth = 0, customHeight = 0, format = 'mp4', rotation = 0, textCues = [], onProgress = () => {} }) {
  const settings = normalizeSmoothMatch({ aspect, fit, fps, resolution, customWidth, customHeight });
  const total = validateConformSources(segments, sources);
  const mime = supportedVideoExportFormats().find(item => item.format === format)?.mimeType;
  if (!mime) throw new Error(format.toUpperCase() + ' recording unavailable in this browser');
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Canvas recording unavailable');
  const first = sources[segments[0].sourceId];
  const dims = outputDimensions(first.width, first.height, settings.aspect, Math.round(settings.resolution * 16 / 9), settings.customWidth, settings.customHeight);
  const canvas = document.createElement('canvas');
  canvas.width = dims.width; canvas.height = dims.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable');
  const video = document.createElement('video');
  video.preload = 'auto'; video.playsInline = true;
  const stream = canvas.captureStream(settings.fps);
  let audioContext = null;
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (Context) {
      audioContext = new Context();
      const media = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      media.connect(destination);
      destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      await audioContext.resume();
    }
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await audioContext?.close().catch(() => {});
    throw new Error('Audio pipeline unavailable: ' + error.message);
  }
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 });
  const chunks = [];
  let recordError = null;
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = event => { recordError = event.error || new Error('Recording failed'); };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = () => recordError ? reject(recordError) : resolve();
  });
  let active = true;
  let raf = 0;
  let lastFrame = -Infinity;
  let elapsed = 0;
  let timelineTime = 0;
  let currentFit = settings.fit;
  const paint = now => {
    if (!active) return;
    if (now - lastFrame >= 1000 / settings.fps - 1) {
      drawVideoFrame(ctx, video, dims.width, dims.height, currentFit, rotation);
      drawKineticText(ctx, textCues, timelineTime, dims.width, dims.height);
      lastFrame = now;
    }
    raf = requestAnimationFrame(paint);
  };
  try {
    const firstReady = awaitEvent(video, 'loadedmetadata');
    video.src = first.objectUrl;
    video.load();
    await firstReady;
    await seek(video, segments[0].start);
    raf = requestAnimationFrame(paint);
    recorder.start(1000);
    let activeSource = segments[0].sourceId;
    for (const segment of segments) {
      currentFit = ['contain', 'cover', 'blur'].includes(segment.fit) ? segment.fit : settings.fit;
      if (segment.sourceId !== activeSource) {
        video.pause();
        const ready = awaitEvent(video, 'loadedmetadata');
        video.src = sources[segment.sourceId].objectUrl;
        video.load();
        await ready;
        activeSource = segment.sourceId;
      }
      await seek(video, segment.start);
      await video.play();
      while (!video.ended && video.currentTime < segment.end - 0.02) {
        await new Promise(resolve => setTimeout(resolve, 25));
        timelineTime = elapsed + Math.min(segment.end - segment.start, Math.max(0, video.currentTime - segment.start));
        onProgress(Math.min(99, Math.round(timelineTime / total * 100)));
      }
      video.pause();
      elapsed += segment.end - segment.start;
      timelineTime = elapsed;
    }
    recorder.stop();
    await stopped;
    if (!chunks.length) throw new Error('No media data was recorded');
    onProgress(100);
    return new Blob(chunks, { type: mime });
  } catch (error) {
    if (recorder.state !== 'inactive') {
      recorder.stop();
      await stopped.catch(() => {});
    }
    throw error;
  } finally {
    active = false;
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute('src');
    video.load();
    stream.getTracks().forEach(track => track.stop());
    await audioContext?.close().catch(() => {});
  }
}
