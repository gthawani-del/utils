const categories = [
  { id: 'video', name: 'Video Editor', short: 'Video Editor', icon: '▣', hint: 'Edit, trim, effects, transitions', copy: 'Upload or open a project to begin editing video in the shared Media Studio workspace.' },
  { id: 'audio', name: 'Audio Studio', short: 'Audio Studio', icon: '◫', hint: 'Clean, enhance, mix, convert', copy: 'Audio tools will use the same project media without requiring a second upload.' },
  { id: 'transcript', name: 'Transcription & Subtitles', short: 'Transcription & Subtitles', icon: 'CC', hint: 'Transcribe, caption, translate', copy: 'Transcription, timestamps and subtitle editing will live here once the transcription phase is approved.' },
  { id: 'lyrics', name: 'Lyrics & Karaoke', short: 'Lyrics & Karaoke', icon: '♫', hint: 'Lyrics, LRC, karaoke videos', copy: 'Lyrics timing, karaoke highlighting and reusable text styles will be added in their own phase.' },
  { id: 'audio-video', name: 'Audio → Video', short: 'Audio → Video', icon: '▧', hint: 'Turn audio into engaging video', copy: 'Visualizers, lyric videos and audiograms will operate on the same shared Media Project.' },
  { id: 'compiler', name: 'Media Compiler', short: 'Media Compiler', icon: '◆', hint: 'Create multiple versions', copy: 'One source will later produce multiple deterministic delivery outputs.' },
  { id: 'qc', name: 'QC & Forensics', short: 'QC & Forensics', icon: '◇', hint: 'Check, fix, analyze media', copy: 'Codec, timing, audio and delivery checks will appear here after the processing foundation exists.' },
  { id: 'delivery', name: 'Pro Workflow & Delivery', short: 'Pro Workflow & Delivery', icon: '⇧', hint: 'Prepare and deliver anywhere', copy: 'Packaging, manifests and professional delivery controls will be introduced later.' }
];

const desktopNav = document.querySelector('#desktop-category-nav');
const mobileRail = document.querySelector('#mobile-category-rail');
const workspaceTitle = document.querySelector('#workspace-title');
const emptyTitle = document.querySelector('#empty-title');
const emptyCopy = document.querySelector('#empty-copy');
const phaseNote = document.querySelector('#phase-note');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const commandMessage = document.querySelector('#command-message');

function makeDesktopButton(category, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'desktop-category-button';
  button.dataset.category = category.id;

  const icon = document.createElement('span');
  icon.textContent = category.icon;

  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = category.name;
  const hint = document.createElement('small');
  hint.textContent = category.hint;
  copy.append(title, hint);

  button.append(icon, copy);
  button.setAttribute('aria-label', `${index + 1}. ${category.name}`);
  return button;
}

function makeMobileButton(category) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-card';
  button.dataset.category = category.id;

  const icon = document.createElement('span');
  icon.textContent = category.icon;
  const label = document.createElement('small');
  label.textContent = category.short;

  button.append(icon, label);
  return button;
}

for (const [index, category] of categories.entries()) {
  desktopNav.append(makeDesktopButton(category, index));
  mobileRail.append(makeMobileButton(category));
}

function selectCategory(id) {
  const category = categories.find((item) => item.id === id) || categories[0];
  document.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === category.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  workspaceTitle.textContent = category.name;
  emptyTitle.textContent = `${category.name} is ready for a project`;
  emptyCopy.textContent = category.copy;
  phaseNote.textContent = 'Step 1 is interface-only. Processing is intentionally not enabled yet.';
}

document.addEventListener('click', (event) => {
  const categoryButton = event.target.closest('[data-category]');
  if (categoryButton) {
    selectCategory(categoryButton.dataset.category);
    return;
  }

  const placeholder = event.target.closest('[data-placeholder-action]');
  if (placeholder) {
    const action = placeholder.dataset.placeholderAction;
    phaseNote.textContent = `${action} is intentionally inactive in Step 1. Secure media ingestion begins in Step 2.`;
  }
});

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = commandInput.value.trim();
  if (!value) {
    commandMessage.textContent = 'Enter an outcome first. No command has been executed.';
    return;
  }
  commandMessage.textContent = 'Command planning is a later phase. Nothing was processed or uploaded.';
});

selectCategory('video');
