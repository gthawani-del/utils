const FORBIDDEN_TAGS = /<(script|foreignObject|iframe|object|embed|audio|video|canvas|style|link|meta)\b/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/i;
const JAVASCRIPT_URL = /(?:href|xlink:href)\s*=\s*["']\s*javascript:/i;
const DATA_URL = /(?:href|xlink:href|src)\s*=\s*["']\s*data:/i;
const REMOTE_URL = /(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i;
const CSS_IMPORT = /@import\b/i;
const ENTITY = /<!ENTITY\b/i;
const DOCTYPE = /<!DOCTYPE\b/i;

export function sanitizeSvgText(text) {
  const source = String(text || '');
  if (FORBIDDEN_TAGS.test(source)) throw new Error('SVG contains unsupported executable or embedded content.');
  if (EVENT_HANDLER.test(source)) throw new Error('SVG event handlers are not allowed.');
  if (JAVASCRIPT_URL.test(source) || DATA_URL.test(source) || REMOTE_URL.test(source)) throw new Error('SVG external or embedded resource URLs are not allowed.');
  if (CSS_IMPORT.test(source) || ENTITY.test(source) || DOCTYPE.test(source)) throw new Error('SVG imports, entities, and doctypes are not allowed.');
  return source;
}
