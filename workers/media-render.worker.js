try {
  Object.defineProperty(self, 'fetch', {
    value: () => Promise.reject(new Error('Network disabled in Utility OS media workers.')),
    writable: false
  });
} catch {}

const cancelled = new Set();

function send(message) {
  self.postMessage(message);
}

function safeMessage(value) {
  return String(value || 'Media processing failed.').slice(0, 240);
}

function yieldTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const jobId = String(message.jobId || '');

  if (message.type === 'cancel') {
    if (jobId) cancelled.add(jobId);
    return;
  }

  if (message.type !== 'start' || !jobId) return;

  try {
    if (message.operation !== 'pipeline-proof') {
      send({
        type: 'error',
        jobId,
        error: { code: 'UNSUPPORTED_OPERATION', message: 'Unsupported media-processing worker operation.' }
      });
      return;
    }

    const input = message.input;
    if (!(input instanceof Blob) || input.size <= 0) {
      send({
        type: 'error',
        jobId,
        error: { code: 'INVALID_INPUT', message: 'Media-processing worker received invalid media.' }
      });
      return;
    }

    const chunkBytes = Math.max(1024 * 1024, Math.min(16 * 1024 * 1024, Number(message.chunkBytes) || 8 * 1024 * 1024));
    const expectedMime = String(message.expectedMime || input.type || 'application/octet-stream');
    const parts = [];
    const total = input.size;

    send({ type: 'progress', jobId, progress: 2, stage: 'Worker started' });

    for (let offset = 0; offset < total; offset += chunkBytes) {
      if (cancelled.has(jobId)) {
        cancelled.delete(jobId);
        send({ type: 'cancelled', jobId });
        return;
      }

      const end = Math.min(total, offset + chunkBytes);
      parts.push(input.slice(offset, end));
      const progress = Math.min(92, 5 + Math.round((end / total) * 87));
      send({ type: 'progress', jobId, progress, stage: 'Copying media bytes' });
      await yieldTurn();
    }

    if (cancelled.has(jobId)) {
      cancelled.delete(jobId);
      send({ type: 'cancelled', jobId });
      return;
    }

    const blob = new Blob(parts, { type: expectedMime });
    parts.length = 0;

    if (blob.size !== total || blob.size <= 0) {
      send({
        type: 'error',
        jobId,
        error: { code: 'OUTPUT_SIZE', message: 'Media-processing proof output failed size validation.' }
      });
      return;
    }

    send({ type: 'progress', jobId, progress: 95, stage: 'Returning output for validation' });
    send({ type: 'result', jobId, blob, size: blob.size, mime: blob.type });
  } catch (error) {
    send({
      type: 'error',
      jobId,
      error: {
        code: 'WORKER_FAILURE',
        message: safeMessage(error instanceof Error ? error.message : 'Media-processing worker failed safely.')
      }
    });
  } finally {
    cancelled.delete(jobId);
  }
};
