import * as ort from '/assets/ort/ort.wasm.bundle.min.mjs';
import { modelSize } from '../lib/image/extend-photo.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('/assets/ort/', self.location.origin).href;

self.addEventListener('message', async ({ data: { pixels, known, side } }) => {
  let session;
  let tensor;
  let result;
  const report = message => self.postMessage({ message });
  try {
    report('Preparing the local model…');
    const config = await fetch('/assets/extend-model.json').then(response => response.json());
    const response = await fetch(config.url, { credentials: 'omit', referrerPolicy: 'no-referrer', integrity: config.integrity });
    if (!response.ok) throw new Error('model download');
    const weights = await response.arrayBuffer();
    session = await ort.InferenceSession.create(weights, { executionProviders: ['wasm'] });

    report('Extending the photo on this device…');
    const area = modelSize * modelSize;
    const input = new Float32Array(4 * area);
    const right = known.x + known.width - 1;
    const bottom = known.y + known.height - 1;
    for (let y = 0; y < modelSize; y++) {
      for (let x = 0; x < modelSize; x++) {
        const i = y * modelSize + x;
        const missing = side === 'left' ? x < known.x : side === 'right' ? x > right
          : side === 'top' ? y < known.y : y > bottom;
        if (missing) {
          input[3 * area + i] = 1;
          continue;
        }
        const sx = Math.max(known.x, Math.min(right, x));
        const sy = Math.max(known.y, Math.min(bottom, y));
        const index = (sy * modelSize + sx) * 4;
        for (let c = 0; c < 3; c++) input[c * area + i] = pixels[index + c] / 255;
      }
    }
    tensor = new ort.Tensor('float32', input, [1, 4, modelSize, modelSize]);
    const outputs = await session.run({ input: tensor });
    result = outputs.output;
    const strip = known.result;
    const output = new Uint8ClampedArray(strip.width * strip.height * 4);
    for (let y = 0; y < strip.height; y++) {
      for (let x = 0; x < strip.width; x++) {
        const src = (strip.y + y) * modelSize + strip.x + x;
        const to = (y * strip.width + x) * 4;
        for (let c = 0; c < 3; c++) output[to + c] = result.data[c * area + src] * 255;
        output[to + 3] = 255;
      }
    }
    self.postMessage({ output, width: strip.width, height: strip.height }, [output.buffer]);
  } catch {
    self.postMessage({ error: 'Photo extension could not run on this device. Check your connection for the model download and try again.' });
  } finally {
    result?.dispose();
    tensor?.dispose();
    await session?.release();
  }
});
