// Optional local speech recognition: model downloads only after explicit user action.
// Uses Transformers.js Whisper with word timestamps; never uploads media to an application backend.
export function speechSegmentsToCues(chunks, duration) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map(chunk => {
    const [start, end] = chunk.timestamp || [];
    return { text: String(chunk.text || '').trim(), start: Number(start), end: Math.min(Number(end), duration) };
  }).filter(cue => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start);
}
export async function recognizeLocalAudio(file, { onStatus = () => {}, signal, language = 'auto', model = 'onnx-community/whisper-tiny' } = {}) {
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
      ({ pipeline, env } = await import('/assets/recognition-runtime.js'));
    } catch (error) {
      throw new Error('RUNTIME_LOAD_FAILED: bundled recognition runtime unavailable. ' + (error?.message || String(error)));
    }
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/assets/ort/';
    // Avoid worker/thread initialization failures in iOS Safari.
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
    onStatus('Checking multilingual model files…');
    try {
      const probe = await fetch('https://huggingface.co/' + model + '/resolve/main/config.json', { cache: 'no-store' });
      if (!probe.ok) throw new Error('HTTP ' + probe.status);
    } catch (error) {
      throw new Error('Cannot reach the model repository: ' + (error?.message || String(error)) + '. Check network or browser content blockers.');
    }
    onStatus('Downloading model files to browser cache…');
    let transcriber;
    try { transcriber = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }, progress_callback: progress => {
      if (progress.status === 'progress') onStatus('Downloading model: ' + Math.round(progress.progress || 0) + '%');
    } }); }
    catch (error) { throw new Error('MODEL_LOAD_FAILED: ' + (error?.message || String(error)) + '. Check browser storage and model file downloads.'); }
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
