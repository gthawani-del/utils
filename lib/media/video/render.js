import { drawKineticText } from './kinetic.js';
// Browser-local, real-time WebM renderer. No network, transcoding service or FFmpeg.
// Recording runs at playback speed and is limited by browser codec and memory support.
export function outputDimensions(width, height, aspect, maxEdge = 1280, customWidth = 0, customHeight = 0) {
  if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw new RangeError('Invalid dimensions');
  const ratios = { original: width / height, '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '21:9': 21 / 9, custom: customWidth / customHeight };
  const ratio = ratios[aspect];
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('Invalid aspect ratio');
  if (aspect === 'custom') return { width: customWidth, height: customHeight };
  let w, h;
  if (ratio >= 1) { w = maxEdge; h = maxEdge / ratio; }
  else { h = maxEdge; w = maxEdge * ratio; }
  return { width: Math.max(2, Math.round(w / 2) * 2), height: Math.max(2, Math.round(h / 2) * 2) };
}
export function drawVideoFrame(ctx, video, width, height, fit, rotation) {
  if (!['contain', 'cover', 'blur'].includes(fit) || ![0, 90, 180, 270].includes(rotation)) throw new RangeError('Invalid framing');
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const rotated = rotation === 90 || rotation === 270;
  const sw = rotated ? vh : vw, sh = rotated ? vw : vh;
  if (fit === 'blur') {
    const cover = Math.max(width / sw, height / sh);
    ctx.save();
    ctx.filter = 'blur(22px) brightness(0.55)';
    ctx.translate(width / 2, height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(video, -vw * cover / 2, -vh * cover / 2, vw * cover, vh * cover);
    ctx.restore();
  }
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / sw, height / sh);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(video, -vw * scale / 2, -vh * scale / 2, vw * scale, vh * scale);
  ctx.restore();
}
function waitFor(video, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Media operation timed out')); }, timeout);
    function cleanup() { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); }
    function done() { cleanup(); resolve(); }
    function fail() { cleanup(); reject(new Error('Media playback failed')); }
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}
async function seek(video, seconds) {
  if (Math.abs(video.currentTime - seconds) < 0.02) return;
  const done = waitFor(video, 'seeked');
  video.currentTime = seconds;
  await done;
}
export function supportedVideoExportFormats(recorder = globalThis.MediaRecorder) {
  if (!recorder?.isTypeSupported) return [];
  const formats = [
    { format: 'mp4', mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"' },
    { format: 'mp4', mimeType: 'video/mp4;codecs="avc1.42E01E"' },
    { format: 'webm', mimeType: 'video/webm;codecs=vp9,opus' },
    { format: 'webm', mimeType: 'video/webm;codecs=vp8,opus' },
    { format: 'webm', mimeType: 'video/webm' }
  ];
  return formats.filter(item => recorder.isTypeSupported(item.mimeType));
}
export async function renderVideo({ sourceUrl, segments, width, height, aspect = 'original', fit = 'contain', rotation = 0, fps = 30, format = 'mp4', textCues = [], onProgress = () => {} }) {
  if (!sourceUrl || !Array.isArray(segments) || !segments.length || segments.length > 500) throw new RangeError('No renderable segments');
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Browser does not support local video recording');
  if (!['mp4', 'webm'].includes(format)) throw new RangeError('Unsupported export format');
  const selected = supportedVideoExportFormats().find(item => item.format === format);
  if (!selected) throw new Error(format.toUpperCase() + ' recording is not supported by this browser. Select WebM or use a compatible browser.');
  const mimeType = selected.mimeType;
  const dims = outputDimensions(width, height, aspect);
  const canvas = document.createElement('canvas');
  canvas.width = dims.width; canvas.height = dims.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas rendering unavailable');
  const video = document.createElement('video');
  video.preload = 'auto'; video.playsInline = true; video.crossOrigin = 'anonymous';
  video.src = sourceUrl;
  const ready = waitFor(video, 'loadedmetadata');
  video.load();
  await ready;
  const total = segments.reduce((sum, segment) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > video.duration + 0.05) throw new RangeError('Invalid segment boundaries');
    return sum + segment.end - segment.start;
  }, 0);
  if (total > 1800) throw new RangeError('Local export is limited to 30 minutes');
  const stream = canvas.captureStream(fps);
  let audioContext, audioSource, audioDestination;
  // Audio from the local media element is recorded through Web Audio when available.
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (Context) {
      audioContext = new Context();
      audioSource = audioContext.createMediaElementSource(video);
      audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
      audioDestination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      await audioContext.resume();
    }
  } catch {
    if (audioContext) await audioContext.close().catch(() => {});
    audioContext = null;
  }
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3500000 });
  const chunks = [];
  let recordingError = null;
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = event => { recordingError = event.error || new Error('Recording failed'); };
  const finished = new Promise((resolve, reject) => {
    recorder.onstop = () => recordingError ? reject(recordingError) : resolve();
  });
  let frameHandle = 0;
  let completed = 0;
  const draw = () => { drawVideoFrame(ctx, video, dims.width, dims.height, fit, rotation); drawKineticText(ctx, textCues, video.currentTime, dims.width, dims.height); frameHandle = requestAnimationFrame(draw); };
  try {
    await seek(video, segments[0].start);
    draw();
    recorder.start(1000);
    for (const segment of segments) {
      await seek(video, segment.start);
      await video.play();
      while (video.currentTime < segment.end - 0.015 && !video.ended) {
        await new Promise(resolve => setTimeout(resolve, 30));
        onProgress(Math.min(99, Math.round(100 * (completed + Math.min(segment.end - segment.start, Math.max(0, video.currentTime - segment.start))) / total)));
      }
      video.pause();
      completed += segment.end - segment.start;
    }
    recorder.stop();
    await finished;
    if (!chunks.length) throw new Error('No video data was recorded');
    onProgress(100);
    return new Blob(chunks, { type: mimeType });
  } catch (error) {
    if (recorder.state !== 'inactive') { recorder.stop(); await finished.catch(() => {}); }
    throw error;
  } finally {
    video.pause();
    cancelAnimationFrame(frameHandle);
    stream.getTracks().forEach(track => track.stop());
    if (audioContext) await audioContext.close().catch(() => {});
    video.removeAttribute('src');
    video.load();
  }
}

// Backward-compatible WebM entry point.
export function renderVideoWebM(options) { return renderVideo({ ...options, format: 'webm' }); }
