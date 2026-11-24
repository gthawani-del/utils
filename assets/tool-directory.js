const image = '/image';
const batch = image + '/batch';
const editor = tool => image + '?tool=' + tool;

export const categories = [
  { id: 'images', label: 'Images', href: '/images', art: 'images', intro: 'Edit, resize and prepare images for wherever they need to go.' },
  { id: 'video', label: 'Video', href: '/tools?category=video', art: 'video', intro: 'Edit clips, work with captions and prepare video for publishing.' },
  { id: 'audio', label: 'Audio', href: '/tools?category=audio', art: 'audio', intro: 'Trim recordings, work with transcripts and turn audio into visuals.' },
  { id: 'studios', label: 'Studios', href: '/tools?category=studios', art: 'studios', intro: 'Open a full workspace for longer creative projects.' },
];

export const tools = [
  { id: 'resize', label: 'Resize Image', description: 'Fit, pad or crop one or more images to a new size.', href: batch, art: 'resize', category: 'images', group: 'Quick edits', terms: 'dimensions scale exact pixels' },
  { id: 'compress', label: 'Compress Image', description: 'Reduce file size or set a maximum in KB.', href: batch + '?tool=compress', art: 'compress', category: 'images', group: 'Quick edits', terms: 'reduce optimize kb' },
  { id: 'convert', label: 'Convert Image', description: 'Switch between JPEG, PNG, WebP and supported AVIF.', href: batch + '?tool=convert', art: 'convert', category: 'images', group: 'Quick edits', terms: 'jpg png webp avif' },
  { id: 'crop', label: 'Crop Image', description: 'Reframe a photo using a preset ratio or free crop.', href: editor('crop'), art: 'crop', category: 'images', group: 'Quick edits', terms: 'frame aspect ratio' },
  { id: 'extend', label: 'Extend Photo', description: 'Generate more background around an edge of a photo on your device.', href: editor('extend'), art: 'extend', category: 'images', group: 'Quick edits', terms: 'outpaint expand background canvas' },
  { id: 'watermark', label: 'Add Watermark', description: 'Place a logo or text over your image.', href: editor('watermark'), art: 'watermark', category: 'images', group: 'Quick edits' },
  { id: 'text', label: 'Add Text', description: 'Place editable text on a photo.', href: editor('text'), art: 'text', category: 'images', group: 'Quick edits' },
  { id: 'replace', label: 'Replace Text', description: 'Select an area, erase the old text and add new text.', href: editor('replace'), art: 'replace', category: 'images', group: 'Quick edits' },
  { id: 'cleanup', label: 'Clean Up Image', description: 'Brush over small marks or unwanted details.', href: editor('cleanup'), art: 'cleanup', category: 'images', group: 'Quick edits', terms: 'retouch erase remove' },
  { id: 'batch', label: 'Batch Resize & Export', description: 'Standardize a set, preview the results and download a ZIP.', href: batch, art: 'batch', category: 'images', group: 'Publishing', terms: 'product photos pad bulk zip' },
  { id: 'social', label: 'Social Asset Pack', description: 'Make multiple platform sizes from one master image.', href: editor('social'), art: 'social', category: 'images', group: 'Publishing', terms: 'instagram story reel crop export' },
  { id: 'webpack', label: 'Responsive Web Pack', description: 'Build image variants and copy responsive HTML.', href: editor('webpack'), art: 'web', category: 'images', group: 'Publishing', terms: 'webp avif srcset' },
  { id: 'assetdoctor', label: 'Asset Doctor', description: 'Check dimensions, format and size before export.', href: editor('assetdoctor'), art: 'doctor', category: 'images', group: 'Publishing', terms: 'qa check preflight' },
  { id: 'contact', label: 'Contact Sheet', description: 'Make a labeled photo grid for reviews and selections.', href: image + '/contact-sheet', art: 'contact', category: 'images', group: 'Publishing', terms: 'proof client grid' },
  { id: 'drawing', label: 'Algorithmic Drawing', description: 'Describe an idea and make repeatable artwork with flow, waves, or branching forms.', href: image + '/algorithmic-drawing', art: 'drawing', category: 'images', group: 'Create', terms: 'rosette pattern generative shapes algorithm poster artwork flow interference' },
  { id: 'image-studio', label: 'Image Studio', description: 'Crop, retouch, add layers and finish a complete image edit.', href: image, art: 'editor', category: 'images', group: 'Create' },
  { id: 'trim-video', label: 'Trim Video', description: 'Cut a clip to the section you want in Video Editor.', href: '/media/video-editor', art: 'trim-video', category: 'video', group: 'Video tools' },
  { id: 'resize-video', label: 'Resize Video for Social', description: 'Prepare a video for a new delivery frame.', href: '/media/video-editor?tool=reframe', art: 'resize-video', category: 'video', group: 'Video tools', terms: 'vertical aspect ratio export social' },
  { id: 'video-editor', label: 'Video Editor', description: 'Cut, arrange and export clips on a timeline.', href: '/media/video-editor', art: 'video', category: 'studios', group: 'Studios' },
  { id: 'captions', label: 'Subtitles & Transcription', description: 'Work with timed captions and transcription.', href: '/media?tool=transcript', art: 'text', category: 'video', group: 'Video tools', terms: 'captions srt vtt transcript' },
  { id: 'audio-trim', label: 'Trim & Level Audio', description: 'Trim a recording and adjust gain or fades.', href: '/media?tool=audio', art: 'audio', category: 'audio', group: 'Audio tools' },
  { id: 'audio-transcript', label: 'Transcription', description: 'Review speech and work with timed text.', href: '/media?tool=transcript', art: 'text', category: 'audio', group: 'Audio tools' },
  { id: 'visualizer', label: 'Audio Visualizer', description: 'Pair a recording with an animated visual.', href: '/media?tool=audio-video', art: 'resize-video', category: 'audio', group: 'Audio tools' },
  { id: 'lyrical', label: 'Lyrical', description: 'Turn a song and its lyrics into a video.', href: '/lyrical', art: 'audio', category: 'studios', group: 'Studios' },
  { id: 'motion', label: 'Motion Studio', description: 'Build animated explainers with visuals and voice.', href: '/media/motion-studio', art: 'studios', category: 'studios', group: 'Studios' },
  { id: 'media', label: 'Media Studio', description: 'Work with audio, video, captions and delivery tools.', href: '/media', art: 'video', category: 'studios', group: 'Studios' },
  { id: 'image-editor', label: 'Image Studio', description: 'Make several edits in one workspace.', href: image, art: 'editor', category: 'studios', group: 'Studios' },
];

export const quickTools = ['drawing', 'resize', 'compress', 'convert', 'crop', 'trim-video', 'resize-video']
  .map(id => tools.find(tool => tool.id === id));

export function matchesTool(tool, query) {
  const searchable = [tool.label, tool.description, tool.terms].filter(Boolean).join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(term => searchable.includes(term));
}

export function makeToolCard(tool, style) {
  const link = document.createElement('a');
  link.href = tool.href;
  link.className = 'directory-card directory-' + style;
  if (style === 'quick' && tool.id === 'drawing') link.classList.add('directory-quick-featured');
  const image = document.createElement('img');
  image.src = '/assets/brand/tools/' + tool.art + '.webp';
  image.alt = '';
  image.width = 256;
  image.height = 256;
  image.decoding = 'async';
  if (style === 'tool') image.loading = 'lazy';
  const copy = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = tool.label;
  copy.append(name);
  if (style === 'tool') {
    const description = document.createElement('small');
    description.textContent = tool.description;
    copy.append(description);
  }
  link.append(image, copy);
  return link;
}
