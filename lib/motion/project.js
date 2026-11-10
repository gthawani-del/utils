export const VERSION = 1;
export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const TEMPLATES = [
  ...[
    ['problem', 'Problem → solution', 'Highlight the bottleneck. Show what changes.', 'explain', 'sage', ['Problem', 'Change', 'Outcome'], ['Where things get stuck', 'Make the change visible', 'Take the next step']],
    ['workflow', 'Document → workflow', 'Turn an agreement into connected responsibilities.', 'process', 'sage', ['Request', 'Review', 'Complete'], ['Start with the agreement', 'Connect the responsibilities', 'Move the work forward']],
    ['systems', 'Connected systems', 'Draw connections and follow a signal through them.', 'explain', 'ink', ['Input', 'System', 'Output'], ['Bring the pieces together', 'Follow the connection', 'One clear next step']],
    ['knowledge', 'Files → organised knowledge', 'Sort incoming files into connected collections.', 'process', 'clay', ['Capture', 'Organise', 'Use'], ['Make room for knowledge', 'Give every file a place', 'Put the knowledge to work']],
    ['voice', 'Voice → action', 'Connect a spoken request to a task and result.', 'demonstrate', 'ink', ['Request', 'Action', 'Result'], ['Start with a request', 'Follow the action', 'Show the result']],
    ['walkthrough', 'Product walkthrough', 'Focus attention on a screen and its key actions.', 'demonstrate', 'sage', ['Open', 'Choose', 'Confirm'], ['Introduce the experience', 'Show the important actions', 'Invite people to try it']],
    ['comparison', 'Before → after', 'Transform one state into another with a clear comparison.', 'compare', 'clay', ['Before', 'Change', 'After'], ['Show the starting point', 'Make the difference clear', 'Choose the next step']],
    ['checklist', 'Checklist → outcome', 'Complete each task and reveal the final outcome.', 'process', 'sage', ['Prepare', 'Check', 'Share'], ['Start with a clear plan', 'Move through the checklist', 'Bring it all together']],
  ].map(([id, name, description, category, palette, labelHints, headings]) => ({ id, name, description, category, palette, labelHints, scenes: [
    [headings[0], 'Replace this sample with the situation you want to explain.', 'title'],
    [headings[1], 'Add the actual steps, actions or changes. Keep each label short.', id],
    [headings[2], 'Tell your audience what to do next.', 'closing'],
  ] })),
  { id: 'explainer', legacy: true, category: 'explain', labelHints: ['Prepare', 'Review', 'Share'], name: 'Clear explainer', description: 'One idea, three clear steps.', palette: 'sage', scenes: [
    ['A clearer way forward', 'Turn a complex idea into a story people can follow.', 'title'],
    ['Start with the problem', 'Explain what matters. Show the next step. Make the outcome clear.', 'steps'],
    ['Make the next move', 'Give your audience one useful action to take.', 'closing'],
  ] },
  { id: 'launch', legacy: true, category: 'demonstrate', labelHints: ['Open', 'Choose', 'Confirm'], name: 'Product reveal', description: 'Introduce a product. Show its value.', palette: 'ink', scenes: [
    ['Meet your next essential', 'A thoughtful introduction to what you are building.', 'title'],
    ['Designed around you', 'Show one useful feature and the difference it makes.', 'feature'],
    ['See it in action', 'Add your website and an invitation to explore.', 'closing'],
  ] },
  { id: 'process', legacy: true, category: 'process', labelHints: ['Prepare', 'Review', 'Share'], name: 'How it works', description: 'Make a workflow easy to understand.', palette: 'clay', scenes: [
    ['From idea to outcome', 'A simple walkthrough, one step at a time.', 'title'],
    ['Three steps. One result.', 'Prepare your content. Review the details. Share the result.', 'steps'],
    ['Ready when you are', 'Bring the process together with a clear next step.', 'closing'],
  ] },
];
export const PALETTES = {
  sage: { name: 'Paper & forest', bg: '#f3f1e8', ink: '#193e34', accent: '#35634e', soft: '#d6dfcb' },
  ink: { name: 'Midnight & lime', bg: '#172c2a', ink: '#f3f1e8', accent: '#d2e18b', soft: '#294642' },
  clay: { name: 'Warm clay', bg: '#f5ece4', ink: '#493028', accent: '#a34c31', soft: '#e7d3c3' },
};
export const LAYOUTS = ['title', 'steps', 'feature', 'closing', 'problem', 'workflow', 'systems', 'knowledge', 'voice', 'walkthrough', 'comparison', 'checklist'];
export const COLOR_KEYS = ['bg', 'ink', 'body', 'accent', 'secondary', 'soft', 'line'];
export const FONTS = ['sans', 'serif', 'mono'];
export const INTENSITIES = ['subtle', 'balanced', 'energetic'];
function validateColors(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose valid custom colours.');
  const result = {};
  for (const key of COLOR_KEYS) if (Object.hasOwn(value, key)) {
    if (typeof value[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value[key])) throw new Error(`Colour ${key}: use a six-digit HEX value.`);
    result[key] = value[key].toLowerCase();
  }
  return result;
}
export function resolveColors(project, scene) {
  const base = PALETTES[project.palette] || PALETTES.sage;
  return { ...base, body: base.ink, secondary: base.accent, line: base.accent, ...validateColors(project.colors), ...validateColors(scene?.colors) };
}
export function contrastRatio(a, b) {
  const luminance = hex => { const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export const EFFECTS = ['reveal', 'stagger', 'rise'];
export function durationOf(project) { return project.scenes.reduce((n, s) => n + s.duration, 0); }
export function makeProject(templateId = 'explainer', options = {}) {
  const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const total = Number(options.duration) || 24;
  return validateProject({ version: VERSION, title: options.title || 'My motion story', format: options.format || 'vertical', language: options.language || 'en-IN', template: template.id, palette: template.palette, colors: {}, font: options.font || 'sans', intensity: 'balanced', brand: '', url: '', logo: '', music: false, audio: '', audioName: '', scenes: template.scenes.map(([title, body, layout], i) => ({ id: `scene-${i + 1}`, title, body, layout, duration: total / 3, effect: i === 1 ? 'stagger' : 'reveal', image: '', points: [...template.labelHints], narration: body, colors: {} })) });
}
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: enter ${required ? '1–' : 'up to '}${max} characters.`);
  return value;
}
function media(value, kind) {
  if (value === '') return '';
  const limit = kind === 'image' ? 3 * 1024 * 1024 : 24 * 1024 * 1024;
  const re = kind === 'image' ? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/ : /^data:audio\/(mpeg|mp3|wav|x-wav|mp4|aac|ogg|webm);base64,[A-Za-z0-9+/]+=*$/;
  if (typeof value !== 'string' || value.length > limit || !re.test(value)) throw new Error(`Invalid ${kind}. Use a supported local file within the size limit.`);
  return value;
}
export function validateProject(input) {
  if (!input || input.version !== VERSION || !Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw new Error('Import a Motion Studio version 1 project with 1–12 scenes.');
  if (!['vertical', 'wide'].includes(input.format) || !Object.hasOwn(PALETTES, input.palette) || !TEMPLATES.some(t => t.id === input.template)) throw new Error('Unsupported format, palette or template.');
  if (input.intensity !== undefined && !INTENSITIES.includes(input.intensity)) throw new Error('Choose Subtle, Balanced or Energetic motion.');
  if (input.font !== undefined && !FONTS.includes(input.font)) throw new Error('Choose Sans, Serif or Mono typography.');
  const project = {
    version: VERSION, title: text(input.title, 80, 'Project name', true), format: input.format,
    template: input.template, palette: input.palette, colors: validateColors(input.colors), font: input.font || 'sans', intensity: input.intensity || 'balanced', language: text(input.language, 32, 'Language', true),
    brand: text(input.brand, 40, 'Brand'), url: text(input.url, 80, 'Website'), logo: media(input.logo, 'image'),
    music: input.music === true, audio: media(input.audio, 'audio'), audioName: text(input.audioName, 120, 'Audio filename'),
    scenes: input.scenes.map((s, i) => {
      if (!s || !LAYOUTS.includes(s.layout) || !EFFECTS.includes(s.effect)) throw new Error(`Scene ${i + 1} has an unsupported layout or animation.`);
      if (!Number.isFinite(s.duration) || s.duration < 2 || s.duration > 30) throw new Error(`Scene ${i + 1}: duration must be 2–30 seconds.`);
      if (!Array.isArray(s.points) || s.points.length !== 3) throw new Error('Each scene needs three step labels.');
      return { colors: validateColors(s.colors), narration: text(s.narration === undefined ? s.body : s.narration, 1000, `Scene ${i + 1} narration`), points: s.points.map(p => text(p, 40, 'Step label', true)), id: `scene-${i + 1}`, title: text(s.title, 80, `Scene ${i + 1} heading`, true), body: text(s.body, 220, `Scene ${i + 1} description`), layout: s.layout, effect: s.effect, duration: s.duration, image: media(s.image, 'image') };
    }),
  };
  const assetBytes = project.logo.length + project.audio.length + project.scenes.reduce((n, s) => n + s.image.length, 0);
  if (assetBytes > MAX_PROJECT_BYTES - 65536) throw new Error('The project exceeds 32 MB. Remove an image or shorten the narration.');
  if (durationOf(project) > 120) throw new Error('Keep the video within two minutes.');
  return project;
}
export function sceneAt(project, time) {
  let start = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const scene = project.scenes[i];
    if (time < start + scene.duration || i === project.scenes.length - 1) return { scene, index: i, start, local: Math.max(0, Math.min(scene.duration, time - start)) };
    start += scene.duration;
  }
}
export function dimensions(format, size = 720) { return format === 'wide' ? { width: Math.round(size * 16 / 9 / 2) * 2, height: size } : { width: size, height: Math.round(size * 16 / 9 / 2) * 2 }; }
export function fitNarration(project, seconds) {
  const total = Math.ceil(seconds + 0.5), current = durationOf(project);
  const next = structuredClone(project);
  next.scenes.forEach(s => s.duration = total * s.duration / current);
  return validateProject(next);
}
