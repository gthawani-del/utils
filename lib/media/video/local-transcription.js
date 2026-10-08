// Optional local speech recognition: model downloads only after explicit user action.
// Uses Transformers.js Whisper with word timestamps; never uploads media to an application backend.
export function speechSegmentsToCues(chunks, duration) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map(chunk => {
    const [start, end] = chunk.timestamp || [];
    return { text: String(chunk.text || '').trim(), start: Number(start), end: Math.min(Number(end), duration) };
  }).filter(cue => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start);
}
export async function recognizeLocalAudio(file, { onStatus = () => {}, signal, language = 'auto', model = 'Xenova/whisper-tiny' } = {}) {
  if (!file || file.size > 45 * 1024 * 1024) throw new Error('Local recognition supports files up to 45 MB');
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('Web Audio is not available on this device');
  const context = new Context();
  try {
    onStatus('Decoding audio on device…');
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 300) throw new Error('Limit: 5 minutes per local transcription');
    const sampleRate = 16000;
    const length = Math.floor(decoded.duration * sampleRate);
    const mono = new Float32Array(length);
    // Downmix and resample with linear interpolation, bounded for mobile memory.
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const input = decoded.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const pos = i * decoded.sampleRate / sampleRate;
        const left = Math.min(input.length - 1, Math.floor(pos));
        const right = Math.min(input.length - 1, left + 1);
        mono[i] += (input[left] + (input[right] - input[left]) * (pos - left)) / decoded.numberOfChannels;
      }
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    onStatus('Downloading local recognition model (first use may be large)…');
    let pipeline, env;
    try {
      ({ pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'));
    } catch (error) {
      throw new Error('Recognition runtime could not load. Check internet connection and browser security settings. ' + (error?.message || ''));
    }
    env.allowLocalModels = false;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
    let transcriber;
    try { transcriber = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback: progress => {
      if (progress.status === 'progress') onStatus('Downloading model: ' + Math.round(progress.progress || 0) + '%');
    } }); }
    catch (error) { throw new Error('Recognition model failed to load (' + model + '): ' + (error?.message || String(error)) + '. Try a stable connection or retry after clearing the model cache.'); }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    onStatus('Recognizing words locally…');
    const options = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word', task: 'transcribe' };
    if (language !== 'auto') options.language = language;
    let result;
    try { result = await transcriber(mono, options); }
    catch (error) { throw new Error('Local recognition failed: ' + (error?.message || 'Unknown inference error')); }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return speechSegmentsToCues(result.chunks || [], decoded.duration);
  } finally { await context.close().catch(() => {}); }
}
