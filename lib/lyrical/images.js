import { sniffFile } from "../security/sniff.js";
import { LIMITS } from "./project.js";
export async function prepareImage(blob, meta = {}) {
  if (!blob?.size || blob.size > LIMITS.imageBytes)
    throw new Error("Choose JPG, PNG or WebP images up to 12 MB each.");
  const signature = await sniffFile(blob);
  if (!["jpeg", "png", "webp"].includes(signature.kind))
    throw new Error("Use a JPG, PNG or WebP image.");
  let bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close();
    throw new Error(
      "This image is too large to decode safely. Resize it below 40 megapixels.",
    );
  }
  const ratio = Math.min(
    1,
    Math.sqrt(2_500_000 / (bitmap.width * bitmap.height)),
    2560 / Math.max(bitmap.width, bitmap.height),
  );
  if (ratio < 1) {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * ratio),
      resizeHeight: Math.round(bitmap.height * ratio),
      resizeQuality: "high",
    });
    bitmap.close();
    bitmap = resized;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) {
      bitmap.close();
      throw new Error("Could not prepare this image.");
    }
  }
  return {
    ...meta,
    id: meta.id || crypto.randomUUID(),
    name: meta.name || "Image",
    blob,
    bitmap,
    url: URL.createObjectURL(blob),
    width: bitmap.width,
    height: bitmap.height,
    cropX: meta.cropX ?? 50,
    cropY: meta.cropY ?? 50,
  };
}
export function releaseImage(image) {
  image.bitmap?.close();
  if (image.url) URL.revokeObjectURL(image.url);
}
