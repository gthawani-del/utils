import { clearWorkspace } from '/lib/security/workspace.js';

const tools = [
  ['Lyrical', 'Turn your song into a lyric video.', '/lyrical', 'lyrical'],
  ['Video Editor', 'Cut and arrange your video clips.', '/media/video-editor', 'video'],
  ['Image Studio', 'Resize, crop and compress images.', '/image', 'image'],
  ['Media & Transcription', 'Edit media and turn speech into text.', '/media', 'media'],
];
for (const [name, description, href, symbol] of tools) {
  const link = document.createElement('a');
  link.className = 'home-tool' + (name === 'Lyrical' ? ' home-tool-featured' : '');
  link.href = href;
  const icon = document.createElement('span');
  icon.className = 'home-tool-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(document.getElementById('icon-' + symbol).content.cloneNode(true));
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = name;
  const detail = document.createElement('span');
  detail.textContent = description;
  copy.append(title, detail);
  const arrow = document.createElement('span');
  arrow.className = 'home-tool-arrow';
  arrow.textContent = '›';
  arrow.setAttribute('aria-hidden', 'true');
  link.append(icon, copy, arrow);
  document.querySelector('#tool-grid').append(link);
}
document.querySelectorAll('[data-open]').forEach(button => {
  button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
});
document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
document.querySelector('#clear-workspace').addEventListener('click', async event => {
  if (!confirm('Delete saved drafts and local preferences from this browser? Download any work you want to keep first. This cannot be undone.')) return;
  event.currentTarget.disabled = true;
  const status = document.querySelector('#storage-status');
  try {
    await clearWorkspace();
    status.textContent = 'Saved workspace cleared.';
  } catch {
    status.textContent = 'Some saved data could not be cleared. You can try again.';
  } finally {
    document.querySelector('#clear-workspace').disabled = false;
  }
});
