import { MEDIA_RENDER_BUDGET } from './budget.js';

export function validateRenderBlobStructure(blob, expected = {}) {
  if (!(blob instanceof Blob)) return { ok: false, reason: 'Processing worker did not return a media Blob.' };
  if (blob.size <= 0) return { ok: false, reason: 'Processing worker returned an empty output.' };

  const expectedBytes = Number(expected.bytes);
  if (Number.isFinite(expectedBytes) && expectedBytes > 0 && blob.size !== expectedBytes) {
    return { ok: false, reason: 'Processing proof output size did not match the source bytes.' };
  }

  const expectedMime = String(expected.mime || '').toLowerCase();
  const actualMime = String(blob.type || '').toLowerCase();
  if (expectedMime && actualMime !== expectedMime) {
    return { ok: false, reason: `Output type mismatch: expected ${expectedMime}, received ${actualMime || 'unknown'}.` };
  }

  return { ok: true, bytes: blob.size, mime: actualMime };
}

function waitForMetadata(element, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener('loadedmetadata', onReady);
      element.removeEventListener('error', onError);
      fn(value);
    };
    const onReady = () => finish(resolve);
    const onError = () => finish(reject, new Error('Browser could not decode the processed media output.'));
    const timer = setTimeout(
      () => finish(reject, new Error('Processed-output validation timed out.')),
      timeoutMs
    );
    element.addEventListener('loadedmetadata', onReady, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

export async function validateRenderOutput(blob, source, { timeoutMs = MEDIA_RENDER_BUDGET.validationTimeoutMs } = {}) {
  const structure = validateRenderBlobStructure(blob, {
    bytes: source?.bytes,
    mime: source?.detectedMime
  });
  if (!structure.ok) return structure;

  const mediaType = source?.mediaType === 'video' ? 'video' : 'audio';
  const element = document.createElement(mediaType);
  element.preload = 'metadata';
  const objectUrl = URL.createObjectURL(blob);
  element.src = objectUrl;

  try {
    await waitForMetadata(element, timeoutMs);
    const actualDuration = Number(element.duration);
    const expectedDuration = Number(source?.duration);

    if (Number.isFinite(expectedDuration) && expectedDuration >= 0 && Number.isFinite(actualDuration)) {
      const tolerance = Math.max(0.35, expectedDuration * 0.002);
      if (Math.abs(actualDuration - expectedDuration) > tolerance) {
        return { ok: false, reason: 'Processed-output duration did not match the proof operation.' };
      }
    }

    if (mediaType === 'video') {
      const expectedWidth = Number(source?.width);
      const expectedHeight = Number(source?.height);
      if (Number.isFinite(expectedWidth) && expectedWidth > 0 && element.videoWidth !== expectedWidth) {
        return { ok: false, reason: 'Processed-output width did not match the proof operation.' };
      }
      if (Number.isFinite(expectedHeight) && expectedHeight > 0 && element.videoHeight !== expectedHeight) {
        return { ok: false, reason: 'Processed-output height did not match the proof operation.' };
      }
    }

    return {
      ok: true,
      bytes: blob.size,
      mime: blob.type,
      duration: Number.isFinite(actualDuration) ? actualDuration : null,
      width: mediaType === 'video' ? Number(element.videoWidth || 0) : null,
      height: mediaType === 'video' ? Number(element.videoHeight || 0) : null
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Processed-output validation failed.'
    };
  } finally {
    element.pause?.();
    element.removeAttribute('src');
    element.load?.();
    URL.revokeObjectURL(objectUrl);
  }
}
