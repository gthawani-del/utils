export const IMAGE_PRESETS = Object.freeze([
  { id: 'instagram-square', label: 'Instagram Square', width: 1080, height: 1080 },
  { id: 'instagram-portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
  { id: 'instagram-story', label: 'Instagram Story', width: 1080, height: 1920 },
  { id: 'youtube-thumbnail', label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { id: 'linkedin', label: 'LinkedIn', width: 1200, height: 627 },
  { id: 'x', label: 'X', width: 1600, height: 900 },
  { id: 'website-hero', label: 'Website Hero', width: 1920, height: 1080 },
  { id: 'website-thumbnail', label: 'Website Thumbnail', width: 800, height: 450 },
  { id: 'whatsapp', label: 'WhatsApp Optimized', width: 1600, height: 1200 }
]);

export const CROP_PRESETS = Object.freeze([
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: 'custom', label: 'Custom', ratio: null }
]);
