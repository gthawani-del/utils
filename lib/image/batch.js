import { sanitizeFilename, splitFilename } from '../security/filename.js';
import { calculateResize } from './math.js';

export function batchSettings(dimensions, options) {
  const convertOnly = options.framing === 'original';
  return {
    resizeMode: convertOnly ? 'fit' : options.framing,
    width: convertOnly ? dimensions.width : options.width,
    height: convertOnly ? dimensions.height : options.height,
    preserveAspect: true,
    format: options.format,
    quality: options.quality,
    targetBytes: options.targetBytes,
    background: '#ffffff',
    solidBackground: !convertOnly && options.framing === 'contain' && options.padding === 'white',
  };
}

export function batchDimensions(dimensions, settings) {
  if (settings.resizeMode === 'fill' || settings.resizeMode === 'contain') {
    return { width: settings.width, height: settings.height };
  }
  return calculateResize(dimensions.width, dimensions.height, settings);
}

export function batchFilenames(files, format, numberedPrefix) {
  const extension = format === 'jpeg' ? 'jpg' : format;
  const used = new Set();
  return files.map((file, index) => {
    const stem = numberedPrefix
      ? `${sanitizeFilename(numberedPrefix, 'image')}-${String(index + 1).padStart(3, '0')}`
      : splitFilename(file.name).stem;
    let count = 1;
    let name;
    do {
      const suffix = count > 1 ? `-${count}` : '';
      const limit = 118 - extension.length - suffix.length;
      name = sanitizeFilename(`${stem.slice(0, limit)}${suffix}.${extension}`);
      count++;
    } while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase());
    return name;
  });
}

export function contactSheetLayout(count, requestedColumns, withLabels) {
  const columns = Math.min(requestedColumns, count);
  const rows = Math.ceil(count / columns);
  const tile = 240;
  const gap = 16;
  const labelHeight = withLabels ? 28 : 0;
  return {
    columns, tile, gap, labelHeight,
    width: columns * tile + (columns + 1) * gap,
    height: rows * (tile + labelHeight) + (rows + 1) * gap,
  };
}
