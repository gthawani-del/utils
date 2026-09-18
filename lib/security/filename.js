const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONTROL = /[\u0000-\u001f\u007f]/g;
const UNSAFE = /[<>:"/\\|?*]/g;

export function sanitizeFilename(name, fallback = 'output') {
  const raw = String(name || fallback).normalize('NFKC').replace(CONTROL, '').replace(UNSAFE, '-').replace(/\.\.+/g, '.').trim();
  const withoutTraversal = raw.replace(/^\.+/, '').replace(/\s+/g, ' ').slice(0, 120);
  const candidate = withoutTraversal || fallback;
  const stem = candidate.replace(/\.[^.]*$/, '');
  return RESERVED.test(stem) ? `_${candidate}` : candidate;
}

export function splitFilename(name) {
  const safe = sanitizeFilename(name);
  const index = safe.lastIndexOf('.');
  if (index <= 0) return { stem: safe, extension: '' };
  return { stem: safe.slice(0, index), extension: safe.slice(index + 1).toLowerCase() };
}

export function exportFilename(original, extension, { prefix = '', suffix = '', preserveOriginal = true } = {}) {
  const { stem } = splitFilename(original || 'image');
  const base = preserveOriginal ? stem : 'image';
  const cleanPrefix = sanitizeFilename(prefix, '').replace(/\./g, '');
  const cleanSuffix = sanitizeFilename(suffix, '').replace(/\./g, '');
  return sanitizeFilename(`${cleanPrefix}${base}${cleanSuffix}.${extension}`);
}
