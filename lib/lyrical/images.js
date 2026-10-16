import { sniffFile } from "../security/sniff.js";
import { LIMITS } from "./project.js";

async function jpeg(bitmap, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    context.fillStyle = "#171b20";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Could not prepare this image.");
    return blob;
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export async function prepareImage(blob, meta = {}) {
  if (!blob?.size || blob.size > LIMITS.imageBytes)
    throw new Error("Choose JPG, PNG or WebP images up to 12 MB each.");
  const signature = await sniffFile(blob);
  if (!["jpeg", "png", "webp"].includes(signature.kind))
    throw new Error("Use a JPG, PNG or WebP image.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("This image is too large. Resize it below 40 megapixels.");
    const ratio = Math.min(1, Math.sqrt(2_000_000 / (bitmap.width * bitmap.height)), 1920 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    // Retain compressed assets and small thumbnails, not every decoded image.
    const normalized = meta.prepared === 1 && ratio === 1 ? blob : await jpeg(bitmap, width, height, 0.9);
    const thumbRatio = Math.min(1, 360 / Math.max(width, height));
    const thumbnail = await jpeg(bitmap, Math.max(1, Math.round(width * thumbRatio)), Math.max(1, Math.round(height * thumbRatio)), 0.78);
    return {
      ...meta, id: meta.id || crypto.randomUUID(), name: meta.name || "Image",
      blob: normalized, bitmap: null, prepared: 1,
      url: URL.createObjectURL(thumbnail), width, height,
      cropX: meta.cropX ?? 50, cropY: meta.cropY ?? 50,
    };
  } finally {
    bitmap.close();
  }
}

export function releaseImage(image) {
  image.bitmap?.close();
  image.bitmap = null;
  if (image.url) URL.revokeObjectURL(image.url);
}

export function createImageCache({ decode = (blob) => createImageBitmap(blob) } = {}) {
  let generation = 0;
  let pending = Promise.resolve();
  const retained = new Set();
  function evict(image) {
    image.bitmap?.close();
    image.bitmap = null;
    retained.delete(image);
  }
  return {
    ready(images, indices) {
      return indices.every((index) => images[index]?.bitmap?.width > 0);
    },
    prepare(images, indices, signal) {
      const wanted = [...new Set(indices)].map((index) => images[index]);
      if (wanted.length > 2 || wanted.some((image) => !image?.blob?.size))
        return Promise.reject(new Error("An image is missing. Return to Images and replace it."));
      const current = generation;
      const run = async () => {
        const cancelled = () => current !== generation || signal?.aborted;
        if (cancelled()) throw new DOMException("Image loading cancelled.", "AbortError");
        for (const image of retained) if (!wanted.includes(image)) evict(image);
        for (const image of wanted) {
          if (image.bitmap?.width > 0) continue;
          let bitmap;
          try { bitmap = await decode(image.blob); }
          catch { throw new Error("An image could not load. Return to Images and replace it."); }
          if (cancelled()) {
            bitmap.close();
            throw new DOMException("Image loading cancelled.", "AbortError");
          }
          image.bitmap = bitmap;
          retained.add(image);
        }
      };
      const result = pending.then(run);
      pending = result.catch(() => {});
      return result;
    },
    clear() {
      generation++;
      for (const image of retained) evict(image);
    },
  };
}
