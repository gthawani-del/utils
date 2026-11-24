import { processImage } from './image.worker.js';
import { exportBatch } from '../assets/batch-archive.js';

self.onmessage = async ({ data }) => {
  if (data.type === 'probe') {
    try {
      const canvas = new OffscreenCanvas(2, 2);
      canvas.getContext('2d').fillRect(0, 0, 2, 2);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      const avif = await canvas.convertToBlob({ type: 'image/avif' }).then(output => output.type === 'image/avif', () => false);
      self.postMessage({ supported: true, avif });
    } catch {
      self.postMessage({ supported: false });
    }
    return;
  }
  if (data.type !== 'export') return;
  try {
    const result = await exportBatch(data.items, data.options, {
      process: async (item, settings) => processImage({ buffer: await item.file.arrayBuffer(), settings, batchOutput: true }),
      report: message => self.postMessage(message),
    });
    self.postMessage({ type: 'complete', ...result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
