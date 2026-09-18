import { timedOut, fail, cancelled } from './result.js';
import { SECURITY_BUDGET } from './budget.js';

export class WorkerRunner {
  #workerUrl;
  #active = new Map();

  constructor(workerUrl) {
    this.#workerUrl = workerUrl;
  }

  async run(message, transfer = [], timeoutMs = SECURITY_BUDGET.workerTimeoutMs, signal) {
    const id = crypto.randomUUID();
    const worker = new Worker(this.#workerUrl, { type: 'module', name: 'utility-os-worker' });
    this.#active.set(id, worker);

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        this.#active.delete(id);
        resolve(value);
      };
      const onAbort = () => finish(cancelled());
      const timer = setTimeout(() => finish(timedOut()), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event) => finish(event.data);
      worker.onerror = () => finish(fail('The processing worker failed safely.'));
      worker.onmessageerror = () => finish(fail('The processing worker returned unreadable data.'));
      try {
        worker.postMessage({ id, ...message }, transfer);
      } catch {
        finish(fail('Unable to start processing.'));
      }
    });
  }

  terminateAll() {
    for (const worker of this.#active.values()) worker.terminate();
    this.#active.clear();
  }
}
