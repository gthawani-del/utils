import { Zip, ZipPassThrough } from 'fflate';
import { batchDimensions, batchFilenames, batchSettings } from './batch.js';
import { addCameraExif, cameraExif } from './batch-exif.js';
import { SECURITY_BUDGET, validateBatchBudget, validateDimensions, validateFileBudget } from '../security/budget.js';

const archiveLimit = SECURITY_BUDGET.maxOutputBytes * 4;
const chunkSize = 256 * 1024;

export async function exportBatch(items, options, { process, report, signal }) {
  const batch = validateBatchBudget(items.map(item => item.file));
  if (!batch.ok) throw new Error(batch.reason);
  const chunks = [];
  const outputs = [];
  let offset = 0;
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(data);
    offset += data.byteLength;
    if (offset > archiveLimit) throw new Error('The ZIP exceeds the archive size limit.');
  });

  const settings = items.map(item => batchSettings(item.inspect.dimensions, options));
  const dimensions = items.map((item, i) => batchDimensions(item.inspect.dimensions, settings[i]));
  const names = batchFilenames(items.map(item => item.file), options.format, options.prefix, options.pattern, dimensions);
  const check = () => signal?.throwIfAborted();
  const total = items.filter(item => !item.skip).length;
  let current = 0;
  for (const [i, item] of items.entries()) {
    check();
    if (item.skip) continue;
    report({ type: 'progress', current: ++current, total, name: item.file.name });
    let blob, output;
    try {
      const fileCheck = validateFileBudget(item.file);
      const sizeCheck = validateDimensions(dimensions[i].width, dimensions[i].height);
      if (!fileCheck.ok || !sizeCheck.ok) throw new Error(fileCheck.reason || sizeCheck.reason);
      const metadata = options.keepCamera && options.format === 'jpeg' && item.inspect.kind === 'jpeg'
        ? cameraExif(item.inspect.exif) : null;
      const target = options.targetBytes ? options.targetBytes - (metadata?.length || 0) : 0;
      if (options.targetBytes && target <= 0) throw new Error('The size limit is smaller than the selected camera details.');
      const result = await process(item, { ...settings[i], batchFocus: item.focus || {}, targetBytes: target });
      check();
      if (result.state !== 'completed') throw new Error(result.error?.message || 'The image could not be encoded.');
      output = result.value;
      if (!output.blob?.size || output.blob.type !== output.mime) throw new Error('The encoder returned an invalid file.');
      blob = addCameraExif(output.blob, metadata);
      if (options.targetBytes && blob.size > options.targetBytes) throw new Error('Could not meet the maximum file size.');
      if (blob.size > SECURITY_BUDGET.maxOutputBytes) throw new Error('This result exceeds the file size limit.');
      if (offset + blob.size + 1024 * (items.length + 1) > archiveLimit) {
        throw new Error('The archive is full. Retry this image in a smaller batch.');
      }
    } catch (error) {
      check();
      report({ type: 'item-error', id: item.id, message: error.message });
      continue;
    }

    const entry = new ZipPassThrough(names[i]);
    entry.mtime = new Date(2000, 0, 1);
    zip.add(entry);
    // The empty push flushes the local header. A stored entry's data can be
    // downloaded directly as a slice of the archive without retaining copies.
    entry.push(new Uint8Array(), false);
    const start = offset;
    for (let begin = 0; begin < blob.size; begin += chunkSize) {
      check();
      const end = Math.min(begin + chunkSize, blob.size);
      entry.push(new Uint8Array(await blob.slice(begin, end).arrayBuffer()), end === blob.size);
    }
    outputs.push({ id: item.id, name: names[i], width: output.width, height: output.height, mime: output.mime, start, size: blob.size });
  }
  check();
  if (!outputs.length) return { blob: null, outputs };
  zip.end();
  return { blob: new Blob(chunks, { type: 'application/zip' }), outputs };
}
