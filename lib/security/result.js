export const OperationState = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  UNSUPPORTED: 'unsupported',
  CANCELLED: 'cancelled'
});

export function ok(value) {
  return { state: OperationState.COMPLETED, value };
}

export function fail(message, code = 'PROCESSING_FAILED') {
  return { state: OperationState.FAILED, error: { code, message } };
}

export function unsupported(message, code = 'UNSUPPORTED') {
  return { state: OperationState.UNSUPPORTED, error: { code, message } };
}

export function timedOut(message = 'Processing timed out.') {
  return { state: OperationState.TIMED_OUT, error: { code: 'TIMEOUT', message } };
}

export function cancelled(message = 'Processing cancelled.') {
  return { state: OperationState.CANCELLED, error: { code: 'CANCELLED', message } };
}
