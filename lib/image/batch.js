import { sanitizeFilename, splitFilename } from '../security/filename.js';
import { calculateResize, coverRect } from './math.js';

export function batchSettings(dimensions, options) {
  const original = options.framing === 'original';
  const relative = ['half', 'max-width'].includes(options.preset);
  const scale = options.preset === 'half' ? .5 : Math.min(1, 1200 / dimensions.width);
  const resizeMode = original || relative ? 'fit' : options.framing;
  const padding = options.padding === 'custom' ? options.padColor : options.padding === 'black' ? '#000000' : '#ffffff';
  return {
    resizeMode,
    width: original ? dimensions.width : relative ? Math.max(1, Math.round(dimensions.width * scale)) : options.width,
    height: original ? dimensions.height : relative ? Math.max(1, Math.round(dimensions.height * scale)) : options.height,
    preserveAspect: resizeMode !== 'stretch' && !(relative && !original),
    format: options.format,
    quality: options.quality,
    targetBytes: options.targetBytes,
    background: resizeMode === 'contain' ? padding : '#ffffff',
    solidBackground: resizeMode === 'contain' && !['transparent', 'blur'].includes(options.padding),
    blurPadding: resizeMode === 'contain' && options.padding === 'blur',
  };
}

export function batchDimensions(dimensions, settings) {
  if (settings.resizeMode === 'fill' || settings.resizeMode === 'contain') {
    return { width: settings.width, height: settings.height };
  }
  return calculateResize(dimensions.width, dimensions.height, settings);
}

export function batchFilenames(files, format, numberedPrefix, pattern = '', dimensions = []) {
  const extension = format === 'jpeg' ? 'jpg' : format;
  const used = new Set();
  return files.map((file, index) => {
    const original = splitFilename(file.name).stem;
    const stem = numberedPrefix
      ? `${sanitizeFilename(numberedPrefix, 'image')}-${String(index + 1).padStart(3, '0')}`
      : pattern ? pattern.replace(/\{(name|width|height|index)\}/g, (_, key) => ({
        name: original, width: dimensions[index]?.width, height: dimensions[index]?.height,
        index: String(index + 1).padStart(3, '0'),
      })[key] ?? '') : original;
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

export function batchCover(width, height, targetWidth, targetHeight, focus = {}) {
  return coverRect(width, height, targetWidth, targetHeight, focus.x ?? .5, focus.y ?? .5);
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
