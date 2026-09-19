import { MEDIA_RENDER_BUDGET, preflightRenderJob } from './budget.js';
import { validateRenderOutput } from './validate.js';
import { renderNativeVideoTrim } from './native-trim.js';

const WORKER_URL = '/workers/media-render.worker.js';

function jobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeError(message, code = 'PROCESSING_FAILED') {
  return { code, message: String(message || 'Media processing failed.').slice(0, 240) };
}

export class MediaRenderRunner {
  #active = null;

  get activeJob() {
    if (!this.#active) return null;
    const { id, operation, status, progress, stage, startedAt } = this.#active;
    return { id, operation, status, progress, stage, startedAt };
  }

  async runProof(source, { signal, onState, onProgress } = {}) {
    if (this.#active) {
      return { ok: false, state: 'failed', error: safeError('Another media-processing job is already running.', 'JOB_BUSY') };
    }

    const preflight = preflightRenderJob(source);
    if (!preflight.ok) {
      return { ok: false, state: 'failed', error: safeError(preflight.reason, 'RESOURCE_BUDGET') };
    }

    const id = jobId();
    const worker = new Worker(WORKER_URL, { type: 'module', name: 'utility-os-media-render' });
    const startedAt = Date.now();
    const job = {
      id,
      operation: 'pipeline-proof',
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      startedAt,
      worker,
      preflight
    };
    this.#active = job;

    const emitState = (status, stage = job.stage) => {
      job.status = status;
      job.stage = stage;
      onState?.({
        id,
        operation: job.operation,
        status,
        progress: job.progress,
        stage,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        warnings: preflight.warnings
      });
    };

    const emitProgress = (progress, stage) => {
      job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
      job.stage = String(stage || job.stage);
      onProgress?.({
        id,
        progress: job.progress,
        stage: job.stage,
        elapsedMs: Date.now() - startedAt
      });
    };

    return await new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        if (this.#active?.id === id) this.#active = null;
      };

      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const cancel = (state, reason, code) => {
        if (settled) return;
        try { worker.postMessage({ type: 'cancel', jobId: id }); } catch {}
        emitState(state, reason);
        setTimeout(() => finish({ ok: false, state, error: safeError(reason, code) }), 0);
      };

      const onAbort = () => cancel('cancelled', 'Media processing was cancelled.', 'CANCELLED');
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeout = setTimeout(
        () => cancel('timed_out', 'Media processing exceeded its operation-specific time budget.', 'TIMEOUT'),
        preflight.timeoutMs
      );

      worker.onerror = () => {
        emitState('failed', 'Worker failed safely');
        finish({ ok: false, state: 'failed', error: safeError('The media-processing worker failed safely.') });
      };

      worker.onmessageerror = () => {
        emitState('failed', 'Unreadable worker response');
        finish({ ok: false, state: 'failed', error: safeError('The media-processing worker returned unreadable data.') });
      };

      worker.onmessage = async (event) => {
        const message = event.data || {};
        if (message.jobId !== id || settled) return;

        if (message.type === 'progress') {
          emitProgress(message.progress, message.stage);
          return;
        }

        if (message.type === 'cancelled') {
          emitState('cancelled', 'Cancelled');
          finish({ ok: false, state: 'cancelled', error: safeError('Media processing was cancelled.', 'CANCELLED') });
          return;
        }

        if (message.type === 'error') {
          emitState('failed', 'Failed');
          finish({ ok: false, state: 'failed', error: safeError(message.error?.message, message.error?.code) });
          return;
        }

        if (message.type !== 'result') return;

        emitState('validating', 'Validating output');
        emitProgress(96, 'Validating output');
        const validation = await validateRenderOutput(message.blob, source);
        if (!validation.ok) {
          emitState('failed', 'Output validation failed');
          finish({ ok: false, state: 'failed', error: safeError(validation.reason, 'OUTPUT_INVALID') });
          return;
        }

        emitProgress(100, 'Validated');
        emitState('completed', 'Completed');
        finish({
          ok: true,
          state: 'completed',
          operation: 'pipeline-proof',
          blob: message.blob,
          validation,
          preflight,
          elapsedMs: Date.now() - startedAt
        });
      };

      emitState('running', 'Starting worker');
      try {
        worker.postMessage({
          type: 'start',
          jobId: id,
          operation: 'pipeline-proof',
          input: source.file,
          expectedMime: source.detectedMime,
          chunkBytes: MEDIA_RENDER_BUDGET.proofChunkBytes
        });
      } catch {
        emitState('failed', 'Unable to start worker');
        finish({ ok: false, state: 'failed', error: safeError('Unable to start the media-processing worker.') });
      }
    });
  }

  async runVideoTrim(source, trim, { signal, onState, onProgress } = {}) {
    if (this.#active) {
      return { ok: false, state: 'failed', error: safeError('Another media-processing job is already running.', 'JOB_BUSY') };
    }

    const preflight = preflightRenderJob(source);
    if (!preflight.ok) {
      return { ok: false, state: 'failed', error: safeError(preflight.reason, 'RESOURCE_BUDGET') };
    }
    if (source?.mediaType !== 'video') {
      return { ok: false, state: 'failed', error: safeError('Real trim rendering currently supports local video only.', 'UNSUPPORTED_MEDIA') };
    }

    const id = jobId();
    const startedAt = Date.now();
    const job = {
      id,
      operation: 'video-trim',
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      startedAt,
      preflight,
      worker: { terminate() {} }
    };
    this.#active = job;

    const emitState = (status, stage = job.stage) => {
      job.status = status;
      job.stage = stage;
      onState?.({
        id,
        operation: job.operation,
        status,
        progress: job.progress,
        stage,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        warnings: preflight.warnings
      });
    };
    const emitProgress = (progress, stage) => {
      job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
      job.stage = String(stage || job.stage);
      onProgress?.({ id, progress: job.progress, stage: job.stage, elapsedMs: Date.now() - startedAt });
    };

    emitState('running', 'Starting browser encoder');
    const rendered = await renderNativeVideoTrim(source, trim, {
      signal,
      onStage: (stage) => emitState('running', stage),
      onProgress: emitProgress
    });

    if (!rendered.ok) {
      emitState(rendered.state || 'failed', rendered.error?.message || 'Video trim failed');
      this.#active = null;
      return rendered;
    }

    emitState('validating', 'Validating trimmed video');
    emitProgress(99, 'Validating trimmed video');
    const validation = await validateRenderOutput(rendered.blob, source, {
      expected: {
        mime: rendered.blob.type,
        duration: rendered.range.duration,
        width: source.width,
        height: source.height
      }
    });

    if (!validation.ok) {
      emitState('failed', 'Output validation failed');
      this.#active = null;
      return { ok: false, state: 'failed', error: safeError(validation.reason, 'OUTPUT_INVALID') };
    }

    emitProgress(100, 'Validated');
    emitState('completed', 'Completed');
    this.#active = null;
    return {
      ok: true,
      state: 'completed',
      operation: 'video-trim',
      blob: rendered.blob,
      validation,
      range: rendered.range,
      preflight,
      elapsedMs: Date.now() - startedAt
    };
  }

  cancel() {
    const job = this.#active;
    if (!job) return false;
    try { job.worker.postMessage({ type: 'cancel', jobId: job.id }); } catch {}
    return true;
  }

  terminate() {
    const job = this.#active;
    if (!job) return;
    try { job.worker.terminate(); } catch {}
    this.#active = null;
  }
}
