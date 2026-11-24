// Build fresh EXIF from an allowlist. Source APP segments, GPS, orientation,
// and embedded thumbnails are deliberately excluded from the new JPEG.
export function cameraExif({ make, model, dateTimeOriginal } = {}) {
  const field = (tag, text) => ({ tag, bytes: new TextEncoder().encode(text.replace(/[^\x20-\x7e]/g, '').slice(0, 128) + '\0') });
  const root = [];
  if (make) root.push(field(0x010f, make));
  if (model) root.push(field(0x0110, model));
  const date = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(dateTimeOriginal || '') ? field(0x9003, dateTimeOriginal) : null;
  if (!root.length && !date) return null;
  const ifdSize = count => 6 + count * 12;
  const rootCount = root.length + Number(Boolean(date));
  const exifOffset = 8 + ifdSize(rootCount);
  let storage = exifOffset + (date ? ifdSize(1) : 0);
  const size = storage + [...root, ...(date ? [date] : [])].reduce((sum, item) => sum + (item.bytes.length > 4 ? item.bytes.length : 0), 0);
  const segment = new Uint8Array(10 + size);
  segment.set([255, 225, (segment.length - 2) >> 8, (segment.length - 2) & 255, 69, 120, 105, 102, 0, 0]);
  const tiff = segment.subarray(10);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  tiff.set([73, 73, 42, 0, 8, 0, 0, 0]);
  view.setUint16(8, rootCount, true);
  const write = (offset, { tag, bytes }) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 2, true);
    view.setUint32(offset + 4, bytes.length, true);
    if (bytes.length <= 4) tiff.set(bytes, offset + 8);
    else {
      view.setUint32(offset + 8, storage, true);
      tiff.set(bytes, storage);
      storage += bytes.length;
    }
  };
  root.forEach((item, index) => write(10 + index * 12, item));
  if (date) {
    const pointer = 10 + root.length * 12;
    view.setUint16(pointer, 0x8769, true);
    view.setUint16(pointer + 2, 4, true);
    view.setUint32(pointer + 4, 1, true);
    view.setUint32(pointer + 8, exifOffset, true);
    view.setUint16(exifOffset, 1, true);
    write(exifOffset + 2, date);
  }
  return segment;
}

export function addCameraExif(blob, segment) {
  return segment ? new Blob([blob.slice(0, 2), segment, blob.slice(2)], { type: blob.type }) : blob;
}
