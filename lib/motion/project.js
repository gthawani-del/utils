export const VERSION = 1;
export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const TEMPLATES = [
  { id: 'explainer', name: 'Clear explainer', description: 'One idea, three clear steps.', palette: 'sage', scenes: [
    ['A clearer way forward', 'Turn a complex idea into a story people can follow.', 'title'],
    ['Start with the problem', 'Explain what matters. Show the next step. Make the outcome clear.', 'steps'],
    ['Make the next move', 'Give your audience one useful action to take.', 'closing'],
  ] },
  { id: 'launch', name: 'Product reveal', description: 'Introduce a product. Show its value.', palette: 'ink', scenes: [
    ['Meet your next essential', 'A thoughtful introduction to what you are building.', 'title'],
    ['Designed around you', 'Show one useful feature and the difference it makes.', 'feature'],
    ['See it in action', 'Add your website and an invitation to explore.', 'closing'],
  ] },
  { id: 'process', name: 'How it works', description: 'Make a workflow easy to understand.', palette: 'clay', scenes: [
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
export const EFFECTS = ['reveal', 'stagger', 'rise'];
export function durationOf(project) { return project.scenes.reduce((n, s) => n + s.duration, 0); }
export function makeProject(templateId = 'explainer', options = {}) {
  const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const total = Number(options.duration) || 24;
  return validateProject({ version: VERSION, title: options.title || 'My motion story', format: options.format || 'vertical', language: options.language || 'en-IN', template: template.id, palette: template.palette, brand: '', url: '', logo: '', music: false, audio: '', audioName: '', scenes: template.scenes.map(([title, body, layout], i) => ({ id: `scene-${i + 1}`, title, body, layout, duration: total / 3, effect: i === 1 ? 'stagger' : 'reveal', image: '', points: ['Prepare', 'Review', 'Share'] })) });
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
  const project = {
    version: VERSION, title: text(input.title, 80, 'Project name', true), format: input.format,
    template: input.template, palette: input.palette, language: text(input.language, 32, 'Language', true),
    brand: text(input.brand, 40, 'Brand'), url: text(input.url, 80, 'Website'), logo: media(input.logo, 'image'),
    music: input.music === true, audio: media(input.audio, 'audio'), audioName: text(input.audioName, 120, 'Audio filename'),
    scenes: input.scenes.map((s, i) => {
      if (!s || !['title', 'steps', 'feature', 'closing'].includes(s.layout) || !EFFECTS.includes(s.effect)) throw new Error(`Scene ${i + 1} has an unsupported layout or animation.`);
      if (!Number.isFinite(s.duration) || s.duration < 2 || s.duration > 30) throw new Error(`Scene ${i + 1}: duration must be 2–30 seconds.`);
      if (!Array.isArray(s.points) || s.points.length !== 3) throw new Error('Each scene needs three step labels.');
      return { points: s.points.map(p => text(p, 40, 'Step label', true)), id: `scene-${i + 1}`, title: text(s.title, 80, `Scene ${i + 1} heading`, true), body: text(s.body, 220, `Scene ${i + 1} description`), layout: s.layout, effect: s.effect, duration: s.duration, image: media(s.image, 'image') };
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
