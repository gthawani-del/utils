import { calculateCrop, calculateResize } from './math.js';

const LARGE_FILE_BYTES = 5 * 1024 * 1024;
const HIGH_RES_PIXELS = 24_000_000;

export function buildAssetDoctorReport({
  fileSize = 0,
  inspect = {},
  settings = {},
  preset = null,
  transparencyDetected = false,
  supportedFormats = ['jpeg','png','webp']
} = {}) {
  const dimensions = inspect.dimensions || { width: 0, height: 0 };
  const target = plannedOutputDimensions(dimensions, settings);
  const issues = [];
  const sourcePixels = dimensions.width * dimensions.height;
  const targetPixels = target.width * target.height;
  const crop = calculateCrop(dimensions.width || 1, dimensions.height || 1, settings.crop);

  if (fileSize >= LARGE_FILE_BYTES) {
    issues.push(issue('large-file','warning','Large source file',
      `Source file is ${formatBytes(fileSize)}.`,
      'For web or social delivery, consider WebP/AVIF or Performance Budget after editing.'));
  }

  if (sourcePixels >= HIGH_RES_PIXELS && targetPixels > 0 && sourcePixels >= targetPixels * 4) {
    issues.push(issue('excessive-resolution','info','Much more resolution than the current output needs',
      `Source is ${dimensions.width}×${dimensions.height} (${megapixels(sourcePixels)} MP); planned output is about ${target.width}×${target.height}.`,
      'Resize during export rather than carrying the full source dimensions into the delivery asset.'));
  }

  if (target.width > crop.width || target.height > crop.height) {
    const scale = Math.max(target.width / Math.max(1,crop.width), target.height / Math.max(1,crop.height));
    issues.push(issue('upscale','warning','Output requires upscaling',
      `The selected crop provides about ${Math.round(crop.width)}×${Math.round(crop.height)}, while the planned output is ${target.width}×${target.height} (${scale.toFixed(2)}× on the limiting axis).`,
      'Reduce output dimensions or use a higher-resolution source to avoid magnifying existing pixels.'));
  }

  if (transparencyDetected && settings.format === 'jpeg') {
    issues.push(issue('transparency-loss','warning','Transparency will be lost in JPEG',
      'Transparent pixels were detected in the decoded image and the selected output is JPEG.',
      'Choose PNG, WebP or AVIF to preserve transparency, or intentionally use the selected background color.'));
  }

  const exif = inspect.exif || {};
  if (exif.hasGps) {
    issues.push(issue('gps','warning','GPS metadata detected',
      'The source JPEG contains a GPS metadata pointer.',
      'Utility OS strips metadata on export; export a privacy-clean copy before publishing.'));
  } else if (exif.hasExif) {
    issues.push(issue('exif','info','EXIF metadata detected',
      'The source JPEG contains EXIF metadata.',
      'Utility OS strips metadata on export while leaving the original untouched.'));
  }

  if (Number(exif.orientation || 1) !== 1) {
    issues.push(issue('orientation','info','Non-standard EXIF orientation',
      `EXIF orientation is ${exif.orientation}.`,
      'Utility OS normalizes orientation while rendering/exporting.'));
  }

  const color = inspect.color || {};
  if (color.wideGamut) {
    issues.push(issue('color-profile','warning','Wide-gamut color profile detected',
      `The file advertises ${color.profileName || 'a recognized wide-gamut profile'}.`,
      'Check the exported copy on an sRGB display/browser if color consistency matters.'));
  }

  if (preset && (target.width !== preset.width || target.height !== preset.height)) {
    issues.push(issue('preset-dimensions','warning','Dimensions do not match the selected preset',
      `Preset expects ${preset.width}×${preset.height}; current planned output is ${target.width}×${target.height}.`,
      'Reapply the preset or correct width/height before export.'));
  }

  if (settings.format && !supportedFormats.includes(settings.format)) {
    issues.push(issue('unsupported-format','error','Selected output format is not supported here',
      `${String(settings.format).toUpperCase()} encoding did not pass the browser capability check.`,
      'Choose JPEG, PNG or another format reported as supported by this browser.'));
  }

  if (!issues.length) {
    issues.push(issue('ready','good','No measured export issues found',
      `Source: ${dimensions.width}×${dimensions.height} · ${formatBytes(fileSize)}. Planned output: ${target.width}×${target.height} ${String(settings.format || '').toUpperCase()}.`,
      'Proceed with export, or use Performance Budget if you need a strict delivery-size limit.'));
  }

  return {
    issues,
    target,
    counts: {
      errors: issues.filter((x)=>x.severity==='error').length,
      warnings: issues.filter((x)=>x.severity==='warning').length,
      info: issues.filter((x)=>x.severity==='info').length
    }
  };
}

export function plannedOutputDimensions(source, settings = {}) {
  const crop = calculateCrop(source.width || 1, source.height || 1, settings.crop);
  const mode = settings.resizeMode || 'fit';
  let target;
  if (mode === 'fill' || mode === 'contain') {
    target = { width: positiveInt(settings.width,crop.width), height: positiveInt(settings.height,crop.height) };
  } else {
    target = calculateResize(crop.width,crop.height,settings);
  }
  const rotation = ((Number(settings.rotate)||0)%360+360)%360;
  if (rotation === 90 || rotation === 270) return { width: target.height, height: target.width };
  return target;
}

function issue(code,severity,title,detail,fix){ return {code,severity,title,detail,fix}; }
function megapixels(pixels){ return (pixels/1_000_000).toFixed(pixels>=10_000_000?1:2); }
function positiveInt(value,fallback){ const n=Math.round(Number(value)); return Number.isFinite(n)&&n>0?n:Math.max(1,Math.round(fallback)); }
function formatBytes(bytes){ if(bytes<1024)return `${bytes} B`; if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(2)} MB`; }
