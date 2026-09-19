import { drawAudioVideoFrame, normalizeAudioVideoConfig, outputDimensions } from '../audio-video/visualizer.js';
import { lyricsToLrc } from '../lyrics/lyrics.js';
import { transcriptToSrt, transcriptToTxt, transcriptToVtt } from '../transcript/subtitles.js';
import {
  buildCompilerManifest,
  defaultCompilerSelection,
  deriveCompilerOutputs,
  normalizeCompilerConfig
} from './plan.js';
import { createTar } from './tar.js';

function safeStem(source) {
  const raw = String(source?.name || 'media-project').replace(/\.[^.]+$/, '');
  return raw.replace(/[^a-z0-9 _.-]/gi, '-').trim().slice(0, 80) || 'media-project';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Browser could not create the requested image output.'));
    }, type);
  });
}

export function initCompilerWorkspace({
  getProject,
  getSource,
  saveCompiler,
  saveAudioVideo,
  openCategory,
  setStatus
}) {
  const panel = document.querySelector('#compiler-panel');
  const list = document.querySelector('#compiler-output-list');
  const summary = document.querySelector('#compiler-summary');
  const packageButton = document.querySelector('#compiler-build-package');
  const selectReady = document.querySelector('#compiler-select-ready');
  const clearButton = document.querySelector('#compiler-clear');
  const status = document.querySelector('#compiler-status');

  function capabilities() {
    return {
      mediaRecorder: typeof MediaRecorder !== 'undefined',
      canvasCapture: typeof HTMLCanvasElement !== 'undefined'
        && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    };
  }

  function outputs() {
    return deriveCompilerOutputs(getProject(), capabilities());
  }

  function config() {
    const available = outputs();
    const stored = normalizeCompilerConfig(getProject().compiler, available);
    if (!stored.selected.length && !Array.isArray(getProject().compiler?.selected)) {
      return { selected: defaultCompilerSelection(available) };
    }
    return stored;
  }

  function persist(next, message = '') {
    const normalized = normalizeCompilerConfig(next, outputs());
    saveCompiler(normalized);
    if (message) {
      status.textContent = message;
      setStatus(message);
    }
    render();
  }

  function prepareVideo(output) {
    const project = getProject();
    const current = normalizeAudioVideoConfig(project.audioVideo, project.source, project.lyrics);
    const next = normalizeAudioVideoConfig({ ...current, aspect: output.aspect }, project.source, project.lyrics);
    saveAudioVideo(next);
    setStatus(`${output.label} prepared in Audio → Video.`);
    openCategory('audio-video');
  }

  function outputCard(output, selected) {
    const card = document.createElement('article');
    card.className = 'compiler-output-card';
    card.dataset.status = output.status;

    const top = document.createElement('div');
    top.className = 'compiler-output-top';

    const title = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = output.label;
    const group = document.createElement('span');
    group.textContent = output.group;
    title.append(label, group);

    const badge = document.createElement('span');
    badge.className = 'compiler-status-badge';
    badge.textContent = output.status === 'ready' ? 'Ready'
      : output.status === 'prepare' ? 'Prepare'
      : 'Unavailable';

    top.append(title, badge);

    const reason = document.createElement('p');
    reason.textContent = output.reason;

    const actions = document.createElement('div');
    actions.className = 'compiler-output-actions';

    if (output.status === 'ready') {
      const choice = document.createElement('label');
      choice.className = 'compiler-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected;
      checkbox.addEventListener('change', () => {
        const current = new Set(config().selected);
        if (checkbox.checked) current.add(output.id);
        else current.delete(output.id);
        persist({ selected: [...current] });
      });
      const copy = document.createElement('span');
      copy.textContent = 'Include in package';
      choice.append(checkbox, copy);
      actions.append(choice);
    }

    if (output.status === 'prepare') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'media-button';
      button.textContent = 'Prepare renderer';
      button.addEventListener('click', () => prepareVideo(output));
      actions.append(button);
    }

    card.append(top, reason, actions);
    return card;
  }

  function render() {
    const available = outputs();
    const current = config();
    const selected = new Set(current.selected);

    list.replaceChildren();
    for (const output of available) list.append(outputCard(output, selected.has(output.id)));

    const readyCount = available.filter((output) => output.status === 'ready').length;
    const prepareCount = available.filter((output) => output.status === 'prepare').length;
    summary.textContent = `${readyCount} package outputs ready · ${prepareCount} video variants can be prepared · ${selected.size} selected`;
    packageButton.disabled = selected.size === 0;
  }

  async function thumbnailBlob() {
    const project = getProject();
    const config = normalizeAudioVideoConfig({ ...project.audioVideo, aspect: '16:9' }, project.source, project.lyrics);
    const { width, height } = outputDimensions('16:9');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable in this browser.');

    drawAudioVideoFrame(context, {
      width,
      height,
      config,
      frequencyData: null,
      timeData: null,
      time: 0,
      duration: Number(project.source?.duration || 0),
      lyrics: project.lyrics
    });
    return canvasBlob(canvas);
  }

  async function buildFiles(selectedIds) {
    const project = getProject();
    const source = getSource();
    const available = outputs();
    const manifest = buildCompilerManifest(project, available, selectedIds);
    const files = [{
      name: 'compiler-manifest.json',
      data: JSON.stringify(manifest, null, 2)
    }];

    for (const id of selectedIds) {
      if (id === 'transcript-txt') files.push({ name: 'transcript.txt', data: transcriptToTxt(project.transcript) });
      if (id === 'subtitles-srt') files.push({ name: 'subtitles.srt', data: transcriptToSrt(project.transcript) });
      if (id === 'subtitles-vtt') files.push({ name: 'subtitles.vtt', data: transcriptToVtt(project.transcript) });
      if (id === 'lyrics-lrc') files.push({ name: 'lyrics.lrc', data: lyricsToLrc(project.lyrics) });
      if (id === 'thumbnail-png') files.push({ name: 'thumbnail.png', data: await thumbnailBlob() });
      if (id === 'source-metadata') {
        files.push({
          name: 'source-metadata.json',
          data: JSON.stringify(manifest.source, null, 2)
        });
      }
    }

    return { files, source };
  }

  async function buildPackage() {
    const current = config();
    if (!current.selected.length) return;

    packageButton.disabled = true;
    status.textContent = 'Building compiler package locally…';

    try {
      const { files, source } = await buildFiles(current.selected);
      const tar = await createTar(files);
      downloadBlob(tar, `${safeStem(source)}-compiler.tar`);
      status.textContent = `Created local compiler package with ${files.length} files. No media bytes were uploaded.`;
      setStatus('Media Compiler package completed locally.');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Media Compiler package failed.';
    } finally {
      render();
    }
  }

  selectReady.addEventListener('click', () => {
    persist({ selected: outputs().filter((output) => output.status === 'ready').map((output) => output.id) }, 'Selected all currently buildable outputs.');
  });
  clearButton.addEventListener('click', () => persist({ selected: [] }, 'Cleared compiler selection.'));
  packageButton.addEventListener('click', buildPackage);

  render();

  return {
    updateVisibility() {
      const visible = getProject().activeCategory === 'compiler';
      panel.classList.toggle('hidden', !visible);
      if (visible) render();
    },
    onSourceChanged() {
      render();
    },
    resetForNewSource() {
      render();
    }
  };
}
