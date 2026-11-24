import { chooseSmartFocus, detectInformationRegions } from '/lib/image/smart-crop.js';
import { boundedCrop, cropFrameSize, cropInPixels, dragCropCorner, drawCropSource, ratioCrop, scaleCrop } from '/lib/image/interactive-crop.js';

export function createCropWorkspace({ commit, onError, extend }) {
  const dialog = document.getElementById('crop-workspace');
  const stage = dialog.querySelector('.crop-stage');
  const photo = dialog.querySelector('.crop-photo');
  const frame = dialog.querySelector('.crop-frame');
  const canvas = photo.querySelector('canvas');
  const size = dialog.querySelector('#crop-result-size');
  const pointer = new Map();
  const sliders = [...dialog.querySelectorAll('[data-crop-transform]')];
  const ratios = [...dialog.querySelectorAll('[data-workspace-ratio]')];
  const lock = dialog.querySelector('[data-workspace-lock]');
  const orientations = [...dialog.querySelectorAll('[data-workspace-orientation]')];
  const reset = dialog.querySelector('[data-workspace-reset]');
  const done = dialog.querySelector('[data-workspace-done]');
  let image;
  let original;
  let draft;
  let gesture;
  let rendering;
  let request = 0;

  function dimensions() {
    return cropFrameSize(image.naturalWidth, image.naturalHeight, draft.turn);
  }

  function updateFrame() {
    const { x, y, width, height } = draft.rect;
    Object.assign(frame.style, { left: x * 100 + '%', top: y * 100 + '%', width: width * 100 + '%', height: height * 100 + '%' });
    const dims = dimensions();
    const pixels = cropInPixels(dims.width, dims.height, draft.rect);
    size.textContent = pixels.width + ' × ' + pixels.height + ' px';
  }

  function layout() {
    if (!image || !dialog.open) return;
    const { width, height } = dimensions();
    const bounds = stage.getBoundingClientRect();
    const ratio = Math.min(Math.max(1, bounds.width - 30) / width, Math.max(1, bounds.height - 30) / height);
    placePhoto(width * ratio, height * ratio);
  }

  function placePhoto(width, height, x = 0, y = 0) {
    photo.style.width = Math.max(1, width) + 'px';
    photo.style.height = Math.max(1, height) + 'px';
    photo.style.transform = `translate(${x}px, ${y}px)`;
  }

  function holdFrame(bounds, base) {
    const width = bounds.width * base.width / draft.rect.width;
    const height = bounds.height * base.height / draft.rect.height;
    const stageBounds = stage.getBoundingClientRect();
    const left = bounds.left + bounds.width * base.x - width * draft.rect.x;
    const top = bounds.top + bounds.height * base.y - height * draft.rect.y;
    placePhoto(width, height, left + width / 2 - stageBounds.left - stageBounds.width / 2,
      top + height / 2 - stageBounds.top - stageBounds.height / 2);
  }

  function adjusted() {
    return Boolean(draft.turn || draft.flip || draft.angle || draft.horizontal || draft.vertical
      || draft.rect.width < 1 || draft.rect.height < 1);
  }

  function freshDraft() {
    return {
      preset: 'original', ratio: image.naturalWidth / image.naturalHeight, orientation: null,
      rect: boundedCrop({}), turn: 0, flip: false, angle: 0, horizontal: 0, vertical: 0,
    };
  }

  function frameRatio() {
    const { width, height } = dimensions();
    return draft.rect.width * width / (draft.rect.height * height);
  }

  function paint() {
    const dims = dimensions();
    const scale = Math.min(1, 900 / Math.max(dims.width, dims.height));
    canvas.width = Math.max(1, Math.round(dims.width * scale));
    canvas.height = Math.max(1, Math.round(dims.height * scale));
    drawCropSource(image, canvas, draft);
  }

  function update({ repaint = false } = {}) {
    updateFrame();
    for (const button of ratios) button.setAttribute('aria-pressed', String(button.dataset.workspaceRatio === draft.preset));
    lock.setAttribute('aria-pressed', String(Boolean(draft.ratio)));
    const ratio = frameRatio();
    for (const button of orientations) {
      const active = button.dataset.workspaceOrientation === (ratio < .999 ? 'portrait' : ratio > 1.001 ? 'landscape' : null);
      button.setAttribute('aria-pressed', String(active));
    }
    reset.disabled = !adjusted() && draft.preset === 'original';
    done.disabled = !adjusted() && !original;
    for (const control of sliders) {
      control.value = draft[control.dataset.cropTransform];
      control.nextElementSibling.textContent = control.value + '°';
    }
    if (repaint) {
      cancelAnimationFrame(rendering);
      rendering = requestAnimationFrame(() => { if (dialog.open) paint(); });
    }
  }

  async function open(src, previous) {
    const current = ++request;
    const source = new Image();
    try {
      source.src = src;
      await source.decode();
    } catch {
      if (current === request) onError('This image could not be opened in Crop.');
      return;
    }
    if (current !== request) return;
    image = source;
    original = previous;
    draft = previous ? { ...previous, rect: { ...previous.rect } } : freshDraft();
    dialog.querySelector('details').open = false;
    if (!dialog.open) dialog.showModal();
    layout();
    update({ repaint: true });
  }

  function changeRatio(preset, orientation = null) {
    const { width, height } = dimensions();
    draft.preset = preset;
    draft.orientation = orientation;
    if (preset === 'free' && !orientation) {
      draft.ratio = 0;
      update();
      return;
    }
    const baseRatio = preset === 'original' ? width / height : preset === 'free' || preset === 'locked' ? frameRatio() : Number(preset);
    draft.ratio = orientation === 'portrait' ? Math.min(baseRatio, 1 / baseRatio)
      : orientation === 'landscape' ? Math.max(baseRatio, 1 / baseRatio) : baseRatio;
    const rect = draft.rect;
    draft.rect = ratioCrop(width, height, draft.ratio, rect.x + rect.width / 2, rect.y + rect.height / 2);
    layout();
    update();
  }

  new ResizeObserver(layout).observe(stage);
  dialog.addEventListener('close', () => {
    pointer.clear(); gesture = null; image = null;
    cancelAnimationFrame(rendering);
  });
  dialog.querySelector('[data-workspace-cancel]').addEventListener('click', () => dialog.close());
  done.addEventListener('click', () => {
    if (!draft) return;
    const next = { ...draft, rect: { ...draft.rect } };
    const hasEdit = adjusted();
    if (hasEdit ? JSON.stringify(next) !== JSON.stringify(original) : original) commit(hasEdit ? next : null);
    dialog.close();
  });
  for (const button of ratios) button.addEventListener('click', () => changeRatio(button.dataset.workspaceRatio));
  lock.addEventListener('click', () => {
    draft.ratio = draft.ratio ? 0 : frameRatio();
    draft.preset = draft.ratio ? 'locked' : 'free';
    draft.orientation = null;
    update();
  });
  for (const button of orientations) button.addEventListener('click', () => {
    const orientation = button.dataset.workspaceOrientation;
    if (button.getAttribute('aria-pressed') !== 'true') changeRatio(draft.preset, orientation);
  });
  reset.addEventListener('click', () => {
    draft = freshDraft();
    layout();
    update({ repaint: true });
  });
  dialog.querySelector('[data-workspace-extend]').addEventListener('click', () => {
    if (image && draft) extend(image, { ...draft, rect: { ...draft.rect } });
  });
  dialog.querySelector('[data-workspace-auto]').addEventListener('click', () => {
    const dims = dimensions();
    const sample = document.createElement('canvas');
    const scale = Math.min(1, 330 / Math.max(dims.width, dims.height));
    sample.width = Math.max(1, Math.round(dims.width * scale));
    sample.height = Math.max(1, Math.round(dims.height * scale));
    drawCropSource(image, sample, draft);
    const pixels = sample.getContext('2d').getImageData(0, 0, sample.width, sample.height);
    const rect = draft.rect;
    const ratio = rect.width * dims.width / (rect.height * dims.height);
    const focus = chooseSmartFocus(dims.width, dims.height, ratio,
      detectInformationRegions(pixels.data, pixels.width, pixels.height));
    draft.rect = boundedCrop({ ...rect, x: focus.focusX - rect.width / 2, y: focus.focusY - rect.height / 2 });
    layout();
    update();
  });
  dialog.querySelector('[data-workspace-rotate]').addEventListener('click', () => {
    const { x, y, width, height } = draft.rect;
    draft.turn = (draft.turn + 1) % 4;
    draft.rect = boundedCrop({ x: 1 - y - height, y: x, width: height, height: width });
    if (draft.ratio) draft.ratio = 1 / draft.ratio;
    // Keep a selected portrait preset portrait. Rotate the source underneath it.
    if (draft.preset !== 'free' && draft.preset !== 'locked' && (draft.preset !== 'original' || draft.orientation)) changeRatio(draft.preset, draft.orientation);
    layout();
    update({ repaint: true });
  });
  dialog.querySelector('[data-workspace-flip]').addEventListener('click', () => {
    draft.flip = !draft.flip;
    draft.angle = -draft.angle;
    draft.vertical = -draft.vertical;
    draft.rect = boundedCrop({ ...draft.rect, x: 1 - draft.rect.x - draft.rect.width });
    layout();
    update({ repaint: true });
  });
  for (const control of sliders) control.addEventListener('input', () => {
    draft[control.dataset.cropTransform] = Number(control.value);
    update({ repaint: true });
  });
  for (const button of dialog.querySelectorAll('[data-workspace-zoom]')) button.addEventListener('click', () => {
    const base = draft.rect;
    const bounds = photo.getBoundingClientRect();
    draft.rect = scaleCrop(base, Number(button.dataset.workspaceZoom));
    holdFrame(bounds, base);
    update();
  });

  function point(event, bounds) {
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  function startGesture() {
    const values = [...pointer.values()];
    if (!values.length) { gesture = null; return; }
    const bounds = photo.getBoundingClientRect();
    const [first, second] = values;
    gesture = { rect: { ...draft.rect }, bounds, one: point(first, bounds),
      two: second && point(second, bounds), corner: second ? null : first.corner };
  }

  photo.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer.size === 2) return;
    if (pointer.size) for (const value of pointer.values()) value.corner = null;
    pointer.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY, corner: event.target.closest('[data-corner]')?.dataset.corner });
    photo.setPointerCapture(event.pointerId);
    startGesture();
  });
  photo.addEventListener('pointermove', event => {
    if (!gesture || !pointer.has(event.pointerId)) return;
    Object.assign(pointer.get(event.pointerId), { clientX: event.clientX, clientY: event.clientY });
    const [one, two] = [...pointer.values()].map(value => point(value, gesture.bounds));
    const base = gesture.rect;
    if (two) {
      const distance = (a, b) => Math.hypot((a.x - b.x) * gesture.bounds.width, (a.y - b.y) * gesture.bounds.height);
      const factor = distance(gesture.one, gesture.two) / Math.max(1, distance(one, two));
      const midX = (gesture.one.x + gesture.two.x) / 2;
      const midY = (gesture.one.y + gesture.two.y) / 2;
      const scaled = scaleCrop(base, factor, (midX - base.x) / base.width, (midY - base.y) / base.height);
      const scale = scaled.width / base.width;
      draft.rect = boundedCrop({ ...scaled, x: scaled.x + (midX - (one.x + two.x) / 2) * scale,
        y: scaled.y + (midY - (one.y + two.y) / 2) * scale });
      holdFrame(gesture.bounds, base);
    } else if (gesture.corner) {
      draft.rect = dragCropCorner(base, gesture.corner, one.x - gesture.one.x, one.y - gesture.one.y, draft.ratio);
    } else {
      draft.rect = boundedCrop({ ...base, x: base.x + gesture.one.x - one.x, y: base.y + gesture.one.y - one.y });
      holdFrame(gesture.bounds, base);
    }
    update();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) photo.addEventListener(type, event => {
    if (pointer.delete(event.pointerId)) startGesture();
  });
  photo.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const [x, y] = delta;
    const corner = event.target.dataset.corner;
    layout();
    draft.rect = corner ? dragCropCorner(draft.rect, corner, x, y, draft.ratio)
      : boundedCrop({ ...draft.rect, x: draft.rect.x + x, y: draft.rect.y + y });
    update();
  });
  return { open };
}
