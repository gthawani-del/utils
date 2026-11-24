import { chooseSmartFocus, detectInformationRegions } from '/lib/image/smart-crop.js';
import { boundedCrop, cropFrameSize, cropInPixels, dragCropCorner, drawCropSource, ratioCrop, scaleCrop } from '/lib/image/interactive-crop.js';

export function createCropWorkspace({ commit, onError }) {
  const dialog = document.getElementById('crop-workspace');
  const stage = dialog.querySelector('.crop-stage');
  const photo = dialog.querySelector('.crop-photo');
  const frame = dialog.querySelector('.crop-frame');
  const canvas = photo.querySelector('canvas');
  const size = dialog.querySelector('#crop-result-size');
  const pointer = new Map();
  const sliders = [...dialog.querySelectorAll('[data-crop-transform]')];
  const ratios = [...dialog.querySelectorAll('[data-workspace-ratio]')];
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
    photo.style.width = Math.max(1, width * ratio) + 'px';
    photo.style.height = Math.max(1, height * ratio) + 'px';
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
    for (const control of sliders) {
      control.value = draft[control.dataset.cropTransform];
      control.nextElementSibling.textContent = control.value + '°';
    }
    if (repaint) {
      layout();
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
    draft = previous ? { ...previous, rect: { ...previous.rect } } : {
      preset: 'original', ratio: source.naturalWidth / source.naturalHeight,
      rect: boundedCrop({}), turn: 0, flip: false, angle: 0, horizontal: 0, vertical: 0,
    };
    if (!dialog.open) dialog.showModal();
    update({ repaint: true });
  }

  function changeRatio(preset) {
    const { width, height } = dimensions();
    draft.preset = preset;
    if (preset === 'free') { draft.ratio = 0; update(); return; }
    draft.ratio = preset === 'original' ? width / height : Number(preset);
    const rect = draft.rect;
    draft.rect = ratioCrop(width, height, draft.ratio, rect.x + rect.width / 2, rect.y + rect.height / 2);
    update();
  }

  new ResizeObserver(layout).observe(stage);
  dialog.addEventListener('close', () => {
    pointer.clear(); gesture = null; image = null;
    cancelAnimationFrame(rendering);
  });
  dialog.querySelector('[data-workspace-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-workspace-done]').addEventListener('click', () => {
    if (!draft) return;
    const next = { ...draft, rect: { ...draft.rect } };
    const hasEdit = next.turn || next.flip || next.angle || next.horizontal || next.vertical || next.rect.width < 1 || next.rect.height < 1;
    if (hasEdit || original) commit(hasEdit ? next : null);
    dialog.close();
  });
  for (const button of ratios) button.addEventListener('click', () => changeRatio(button.dataset.workspaceRatio));
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
    update();
  });
  dialog.querySelector('[data-workspace-rotate]').addEventListener('click', () => {
    const { x, y, width, height } = draft.rect;
    draft.turn = (draft.turn + 1) % 4;
    draft.rect = boundedCrop({ x: 1 - y - height, y: x, width: height, height: width });
    if (draft.ratio) draft.ratio = 1 / draft.ratio;
    // Keep a selected portrait preset portrait. Rotate the source underneath it.
    if (draft.preset !== 'free') changeRatio(draft.preset);
    update({ repaint: true });
  });
  dialog.querySelector('[data-workspace-flip]').addEventListener('click', () => {
    draft.flip = !draft.flip;
    draft.rect = boundedCrop({ ...draft.rect, x: 1 - draft.rect.x - draft.rect.width });
    update({ repaint: true });
  });
  for (const control of sliders) control.addEventListener('input', () => {
    draft[control.dataset.cropTransform] = Number(control.value);
    update({ repaint: true });
  });
  for (const button of dialog.querySelectorAll('[data-workspace-zoom]')) button.addEventListener('click', () => {
    draft.rect = scaleCrop(draft.rect, Number(button.dataset.workspaceZoom));
    update();
  });

  function point(event) {
    const bounds = photo.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  function startGesture() {
    const values = [...pointer.values()];
    if (!values.length) { gesture = null; return; }
    const [one, two] = values;
    gesture = { rect: { ...draft.rect }, one, two, corner: two ? null : one.corner };
  }

  photo.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer.size === 2) return;
    pointer.set(event.pointerId, { ...point(event), corner: event.target.closest('[data-corner]')?.dataset.corner });
    photo.setPointerCapture(event.pointerId);
    startGesture();
  });
  photo.addEventListener('pointermove', event => {
    if (!gesture || !pointer.has(event.pointerId)) return;
    pointer.set(event.pointerId, { ...pointer.get(event.pointerId), ...point(event) });
    const [one, two] = pointer.values();
    const base = gesture.rect;
    if (two) {
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (gesture.one.x + gesture.two.x) / 2;
      const midY = (gesture.one.y + gesture.two.y) / 2;
      const scaled = scaleCrop(base, distance(gesture.one, gesture.two) / Math.max(.001, distance(one, two)),
        (midX - base.x) / base.width, (midY - base.y) / base.height);
      draft.rect = boundedCrop({ ...scaled, x: scaled.x + midX - (one.x + two.x) / 2, y: scaled.y + midY - (one.y + two.y) / 2 });
    } else if (gesture.corner) {
      draft.rect = dragCropCorner(base, gesture.corner, one.x - gesture.one.x, one.y - gesture.one.y, draft.ratio);
    } else {
      draft.rect = boundedCrop({ ...base, x: base.x + gesture.one.x - one.x, y: base.y + gesture.one.y - one.y });
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
    draft.rect = corner ? dragCropCorner(draft.rect, corner, x, y, draft.ratio)
      : boundedCrop({ ...draft.rect, x: draft.rect.x + x, y: draft.rect.y + y });
    update();
  });
  return { open };
}
