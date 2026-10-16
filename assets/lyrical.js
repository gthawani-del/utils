import {
  LIMITS,
  STYLES,
  linesFromWords,
  reviseLine,
  validateLines,
  chooseDirection,
  dimensions,
  timeLabel,
  scriptReviewNote,
  visualSummary,
  validateVisuals,
} from "/lib/lyrical/project.js";
import {
  alignLyrics,
  timingWords,
  savedTimingReference,
  splitTimedLine,
  mergeTimedLines,
  insertTimedLine,
} from "/lib/lyrical/timing.js";
import { decodeSong, transcribeSong } from "/lib/lyrical/audio.js";
import { limitedTranscriptionDevice, transcriptionQuality, transcriptionDevice, voskLanguage } from "/lib/lyrical/transcription-policy.js";
import {
  drawLyricalFrame,
  loadLyricalFonts,
  invalidateLyricalRender,
  lyricalMotionLabel,
} from "/lib/lyrical/renderer.js";
import { visualPlan, storyboardFor, sceneImageIndices, sceneTransition, TRANSITIONS, previewWindow } from "/lib/lyrical/storyboard.js";
import { longHoldLines } from "/lib/lyrical/motion.js";
import { prepareImage, releaseImage, createImageCache } from "/lib/lyrical/images.js";
import {
  saveDraft,
  readDraft,
  assetStore,
  clearDraft,
} from "/lib/lyrical/storage.js";
import { probeExport, exportLyrical } from "/lib/lyrical/export.js";
import { sanitizeFilename } from "/lib/security/filename.js";

const $ = (selector) => document.querySelector(selector);
const player = $("#song-player"),
  canvas = $("#video-canvas"),
  ctx = canvas.getContext("2d");
const panels = ["song", "lyrics", "images", "video"];
const visualDefaults = { visualTheme: "auto", scenePacing: "auto", transition: "auto", transitionSpeed: "normal", imageMovement: "auto" };
let project = {
  version: 1,
  name: "",
  duration: 0,
  lines: [],
  analysis: {},
  settings: {
    ...visualDefaults,
    style: "clean",
    aspect: "9:16",
    intensity: "subtle",
    presentation: "phrases",
    accent: STYLES.clean.accent,
    textSize: 1,
  },
  confirmed: false,
  maxStep: 0,
  step: 0,
  images: [],
  textOnly: false,
};
let audioBuffer = null,
  mono = null,
  sourceFile = null,
  sourceUrl = "",
  images = [],
  history = [],
  busy = false,
  raf = 0,
  saveTimer = 0,
  stopAt = null,
  downloadUrl = "",
  transcriptionController = null,
  processingActive = false,
  retryTranscription = null,
  exportController = null,
  probeRevision = 0;
let stockPage = 1,
  stockQuery = "",
  stockController = null,
  restoring = false;
const imageCache = createImageCache();
let previewLoading = false, previewResume = false, previewEpoch = 0, replaceImageId = null;
const initialDraft = readDraft();
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const button = (text, fn, className = "text-button") => {
  const b = node("button", text, className);
  b.type = "button";
  b.addEventListener("click", (event) => {
    if (!busy) fn(event);
  });
  return b;
};
function message(text, error = false) {
  const el = $("#app-message");
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle("error", error);
}
function snapshot() {
  return {
    ...project,
    images: images.map(
      ({ id, name, width, height, cropX, cropY, sourceUrl, author, prepared }) => ({
        id,
        name,
        width,
        height,
        cropX,
        cropY,
        sourceUrl,
        author,
        prepared,
      }),
    ),
    updatedAt: Date.now(),
  };
}
function persist() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveDraft(snapshot());
      $("#save-status").textContent = "Draft saved on this device.";
    } catch {
      $("#save-status").textContent =
        "Storage is full. Keep this page open to preserve your work.";
    }
  }, 200);
}
function syncNavigation() {
  document.querySelectorAll("[data-step]").forEach((b) => {
    const step = Number(b.dataset.step);
    b.disabled = busy || step > project.maxStep;
    if (step === project.step) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });
}
function renderWorkflowView() {
  const hasSong = Boolean(audioBuffer);
  document.body.classList.toggle("has-song", hasSong);
  document.body.classList.toggle("transcribing", processingActive);
  document.body.dataset.lyricalStep = String(project.step);
  panels.forEach((name, i) => {
    $("#step-" + name).hidden = processingActive || i !== project.step;
  });
  $("#song-empty").hidden = hasSong;
  $("#song-ready").hidden = !hasSong;
  $("#song-bar").hidden = !hasSong;
  $("#change-song").hidden = project.step !== 0 || processingActive;
  $("#processing-panel").hidden = !processingActive;
  $(".lyrical-heading").hidden = project.step !== 0 && !processingActive;
  $("#page-heading").textContent = processingActive
    ? "Creating your lyrics."
    : hasSong ? "Get your lyrics." : "Create your lyric video.";
  $("#page-description").textContent = processingActive
    ? "Your words will appear here when they’re ready."
    : hasSong ? "Check the language, then generate and sync your lyrics."
      : "Add a song, check the lyrics and bring your images.";
  $("#review-existing").hidden = !project.lines.length;
  $("#transcribe").hidden = Boolean(retryTranscription);
  $("#retry-transcription").hidden = !retryTranscription;
  $("#retry-transcription").className = project.lines.length ? "secondary-button" : "primary-button";
  $("#transcribe").className = project.lines.length ? "secondary-button" : "primary-button";
  $("#transcribe").textContent = project.lines.length ? "Transcribe again" : "Generate lyrics";
  updateQualityHint();
}
function updateQualityHint() {
  const device = transcriptionDevice();
  const select = $("#transcription-quality");
  select.querySelector('[value="base"]').disabled = limitedTranscriptionDevice(device);
  select.querySelector('[value="vosk"]').disabled = !voskLanguage($("#song-language").value);
  select.value = transcriptionQuality(select.value, device, $("#song-language").value);
  $("#quality-hint").textContent = select.value === "vosk"
    ? "Experimental alternative for English or Hindi. Downloads about 40–45 MB on first use. Review the lyrics carefully; singing and mixed languages may be inaccurate."
    : select.value === "base"
    ? "Larger speech engine for desktops. Words may still need corrections."
    : "Uses a compact speech engine and processes short sections. Best for phones.";
}
function clearTranscriptionFeedback() {
  retryTranscription = null;
  $("#transcription-status").textContent = "";
  $("#retry-transcription").hidden = true;
  $("#transcribe").hidden = false;
}
function focusHeading(selector) {
  const heading = $(selector);
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}
function setBusy(value, cancelId) {
  busy = value;
  document.body.classList.toggle("busy", value);
  document
    .querySelectorAll(
      "main button,main input,main select,main textarea,#start-over",
    )
    .forEach((el) => {
      if (value) {
        if (!("preBusy" in el.dataset))
          el.dataset.preBusy = el.disabled ? "1" : "0";
        el.disabled = true;
      } else if ("preBusy" in el.dataset) {
        el.disabled = el.dataset.preBusy === "1";
        delete el.dataset.preBusy;
      }
    });
  if (value && cancelId) $(cancelId).disabled = false;
  syncNavigation();
}
function showStep(step, { scroll = true } = {}) {
  if (step > project.maxStep || busy) return;
  player.pause();
  stopAt = null;
  previewEpoch++;
  previewLoading = previewResume = false;
  imageCache.clear();
  $("#preview-buffering").hidden = true;
  project.step = step;
  renderWorkflowView();
  syncNavigation();
  message("");
  if (step === 1) renderLyrics();
  if (step === 2) {
    renderImages();
    renderDirection();
  }
  if (step === 3) {
    $("#export-visual-summary").textContent = visualSummary(
      project.textOnly,
      images,
    );
    $("#export-transition-summary").textContent = project.textOnly ? "Lyric animation only" : storyboardFor(project, images.length).length + " scenes · " + TRANSITIONS[project.settings.transition || "auto"];
    $("#export-timing-note").hidden = !longHoldLines(project.lines).length;
    drawPreview();
    checkExport();
  }
  persist();
  if (scroll) {
    $(".lyrical-steps").scrollIntoView({ block: "start" });
    focusHeading(step === 0 ? "#page-heading" : "#step-" + panels[step] + " h2");
  }
}
document
  .querySelectorAll("[data-step]")
  .forEach((b) =>
    b.addEventListener("click", () => showStep(Number(b.dataset.step))),
  );
document
  .querySelectorAll("[data-back]")
  .forEach((b) =>
    b.addEventListener("click", () => showStep(Number(b.dataset.back))),
  );
function remember() {
  history.push(structuredClone(project.lines));
  if (history.length > 30) history.shift();
  $("#undo-lyrics").disabled = false;
}
function invalidateVideo() {
  previewEpoch++;
  previewLoading = previewResume = false;
  imageCache.clear();
  invalidateLyricalRender(project);
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = "";
  }
  $("#download-result").hidden = true;
  $("#export-status").textContent = "";
}
function invalidateLyrics() {
  invalidateVideo();
  project.confirmed = false;
  project.maxStep = Math.min(project.maxStep, 1);
  $("#review-confirm").checked = false;
  syncNavigation();
  persist();
}
function applyDirection() {
  invalidateVideo();
  project.direction = chooseDirection(project.lines, project.analysis);
  project.settings = {
    ...project.settings,
    style: project.direction.style,
    intensity: project.direction.intensity,
    presentation: project.direction.presentation,
    textSize: 1,
    accent: STYLES[project.direction.style].accent,
  };
  project.customStyle = false;
  renderDirection();
}
function renderDirection() {
  const suggested = STYLES[project.direction?.style] || STYLES.clean;
  const current = STYLES[project.settings.style] || STYLES.clean;
  $("#review-direction-name").textContent = suggested.name;
  $("#review-direction-reason").textContent = project.direction?.reason || "";
  $("#review-style-swatch").dataset.style = project.direction?.style || "clean";
  $("#direction-name").textContent = current.name;
  $("#direction-reason").textContent = project.customStyle
    ? "Your adjustments are applied. You can return to the system direction below."
    : project.direction?.reason || "";
  for (const key of ["aspect", "style", "intensity", "presentation", "accent"])
    $("#" + key).value = project.settings[key];
  $("#text-size").value = project.settings.textSize;
  for (const key of Object.keys(visualDefaults)) $("#" + key).value = project.settings[key] || visualDefaults[key];
}
async function selectSong(file, { restore = false } = {}) {
  if (busy || !file || (restoring && !restore)) return;
  setBusy(true);
  message("Reading your song on this device…");
  let selected = false;
  try {
    const decoded = await decodeSong(file);
    if (
      restore &&
      Math.abs(decoded.audioBuffer.duration - project.duration) > 0.05
    )
      throw new Error(
        "This recording has a different duration. Choose the original song to restore the timing.",
      );
    player.pause();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceFile = file;
    sourceUrl = URL.createObjectURL(file);
    player.src = sourceUrl;
    audioBuffer = decoded.audioBuffer;
    mono = decoded.mono;
    if (!restore) {
      images.forEach(releaseImage);
      images = [];
      history = [];
      invalidateVideo();
      project = {
        ...project,
        sample: false,
        name: file.name,
        duration: audioBuffer.duration,
        analysis: decoded.analysis,
        lines: [],
        timingWords: [],
        timingLanguage: "",
        timingModel: "",
        transcriptionCheckpoint: null,
        confirmed: false,
        maxStep: 0,
        step: 0,
        images: [],
        textOnly: false,
        customStyle: false,
        settings: { ...project.settings, ...visualDefaults },
      };
      await assetStore("clear").catch(() => {});
    }
    $("#song-name").textContent = project.name;
    $("#song-meta").textContent =
      timeLabel(audioBuffer.duration);
    $("#song-language").value = project.language || "";
    project.transcriptionQuality = transcriptionQuality(project.transcriptionQuality, transcriptionDevice(), project.language);
    $("#transcription-quality").value = project.transcriptionQuality;
    $("#recovery").hidden = true;
    clearTranscriptionFeedback();
    $("#song-language").removeAttribute("aria-invalid");
    if (!restore) $("#paste-lyrics").value = "";
    renderWorkflowView();
    try {
      await assetStore("put", "song", file);
    } catch {
      $("#save-status").textContent =
        "Audio could not be saved. You may need to select it again when returning.";
    }
    message("");
    persist();
    selected = true;
  } catch (error) {
    message(error.message, true);
  } finally {
    if (!restore) setBusy(false);
    $("#song-input").value = "";
    if (selected && !restore) showStep(0);
  }
}
$("#choose-song").addEventListener("click", () => $("#song-input").click());
$("#change-song").addEventListener("click", () => $("#song-input").click());
$("#song-input").addEventListener("change", () =>
  selectSong($("#song-input").files[0]),
);
for (const selector of ["#song-language", "#transcription-quality"]) {
  $(selector).addEventListener("change", () => {
    if (project.lines.length && !project.timingLanguage)
      project.timingLanguage = project.language;
    project.language = $("#song-language").value;
    project.transcriptionQuality = transcriptionQuality($("#transcription-quality").value, transcriptionDevice(), project.language);
    project.transcriptionCheckpoint = null;
    $("#song-language").removeAttribute("aria-invalid");
    clearTranscriptionFeedback();
    message("");
    updateQualityHint();
    persist();
  });
}
$("#paste-lyrics").addEventListener("input", clearTranscriptionFeedback);
function dropTarget(el, handler) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("dragging");
  });
  el.addEventListener("dragleave", () => el.classList.remove("dragging"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("dragging");
    if (!busy) handler([...e.dataTransfer.files]);
  });
}
dropTarget($("#song-drop"), (files) => selectSong(files[0]));
async function syncLyrics(texts = null, { savedOnly = false } = {}) {
  if (!mono || busy) return;
  const language = $("#song-language").value;
  if (!language) {
    if (project.step !== 0) showStep(0);
    message("Choose your song’s language to continue.", true);
    $("#song-language").setAttribute("aria-invalid", "true");
    $("#song-language").focus();
    return;
  }
  if (
    texts &&
    (!texts.length ||
      texts.length > LIMITS.lines ||
      texts.some((text) => !text.trim() || text.length > 500))
  ) {
    message(
      "Use 1–600 non-empty lyric lines, up to 500 characters each.",
      true,
    );
    return;
  }
  const saved = texts ? savedTimingReference(project, language) : [];
  if (savedOnly && !saved.length) {
    message(
      "No saved transcript is available. Your current timing is kept. To detect vocals again, open Song and choose Transcribe again.",
      true,
    );
    $("#app-message").scrollIntoView({ block: "center" });
    return;
  }
  if (project.lines.length && !project.timingLanguage)
    project.timingLanguage = project.language;
  project.language = language;
  project.transcriptionQuality = transcriptionQuality($("#transcription-quality").value, transcriptionDevice(), project.language);
  persist();
  transcriptionController = new AbortController();
  clearTranscriptionFeedback();
  setBusy(true, "#cancel-processing");
  player.pause();
  message("");
  const needsRecognition = !saved.length;
  const started = performance.now();
  let keepCurrent = false;
  let completed = false;
  let failed = false;
  const elapsed = () => {
    $("#processing-elapsed").textContent =
      timeLabel((performance.now() - started) / 1000) + " elapsed";
  };
  const keep = () => {
    keepCurrent = true;
    transcriptionController?.abort();
  };
  $("#keep-current-lyrics").hidden = !project.lines.length;
  $("#keep-current-lyrics").disabled = false;
  $("#keep-current-lyrics").addEventListener("click", keep);
  processingActive = needsRecognition;
  renderWorkflowView();
  if (processingActive) {
    $("#song-bar").scrollIntoView({ block: "start" });
    focusHeading("#processing-heading");
  }
  elapsed();
  const clock = needsRecognition ? setInterval(elapsed, 1000) : null;
  const status = (text) => {
    $("#transcription-status").textContent = text;
    $("#timing-status").textContent = text;
    $("#processing-status").textContent = text;
  };
  status(
    needsRecognition ? "Preparing transcription…" : "Using saved vocal timing…",
  );
  try {
    const reference = saved.length
      ? saved
      : timingWords(
          await transcribeSong(mono, {
            language,
            languageName: $("#song-language").selectedOptions[0].textContent,
            quality: project.transcriptionQuality,
            checkpoint: project.transcriptionCheckpoint,
            onCheckpoint: (checkpoint) => {
              project.transcriptionCheckpoint = checkpoint;
              persist();
            },
            signal: transcriptionController.signal,
            onStatus: status,
          }),
          project.duration,
        );
    if (needsRecognition) {
      project.transcriptionCheckpoint = null;
      persist();
    }
    status("Matching lyrics to the audio timeline…");
    const lines = texts
      ? alignLyrics(texts, reference, project.duration)
      : linesFromWords(reference, project.duration);
    if (!lines.length)
      throw new Error(
        "No usable vocal timing was detected. Check the song language and retry.",
      );
    const error = validateLines(lines, project.duration);
    if (error)
      throw new Error(
        "Automatic sync could not finish. Check the song language and retry.",
      );
    if (project.lines.length) remember();
    project.lines = lines;
    project.timingWords = reference;
    project.timingLanguage = language;
    if (needsRecognition) project.timingModel = project.transcriptionQuality;
    project.confirmed = false;
    project.maxStep = 1;
    $("#fine-tune-timing").checked = false;
    applyDirection();
    status(
      "Lyrics synced automatically. Review the words and play any line to check it.",
    );
    completed = true;
    processingActive = false;
    setBusy(false);
    showStep(1);
    message(
      scriptReviewNote(language, lines) ||
        (lines.some((line) => line.timingQuality === "estimated")
          ? "Lyrics synced. Some matches are estimated — play the marked lines to check them."
          : "Timing is automatic. Correct any words, then confirm your lyrics."),
    );
  } catch (error) {
    if (error.name === "AbortError")
      status("Sync cancelled. Your song and existing lyrics are safe.");
    else {
      failed = true;
      if (needsRecognition) retryTranscription = () => syncLyrics(texts?.slice() || null);
      status(error.message);
      $("#transcription-status").textContent = "";
      $("#timing-status").textContent = "";
      message(error.message, true);
    }
  } finally {
    clearInterval(clock);
    $("#keep-current-lyrics").removeEventListener("click", keep);
    processingActive = false;
    if (busy) setBusy(false);
    transcriptionController = null;
    renderWorkflowView();
    if (keepCurrent) showStep(1);
    else if (!completed) {
      if (failed) {
        $("#app-message").scrollIntoView({ block: "center" });
        focusHeading("#app-message");
      } else {
        const control = project.step === 0 ? $("#transcribe") : $("#auto-sync");
        control.focus();
      }
    }
  }
}
$("#transcribe").addEventListener("click", () => syncLyrics());
$("#cancel-processing").addEventListener("click", () =>
  transcriptionController?.abort(),
);
$("#review-existing").addEventListener("click", () => showStep(1));
$("#retry-transcription").addEventListener("click", () => retryTranscription?.());
$("#use-pasted").addEventListener("click", () => {
  const lines = $("#paste-lyrics")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!audioBuffer || !lines.length) {
    message("Choose your song and paste some lyrics first.", true);
    return;
  }
  syncLyrics(lines);
});
$("#auto-sync").addEventListener("click", () =>
  syncLyrics(
    project.lines.map((line) => line.text),
    { savedOnly: true },
  ),
);
$("#fine-tune-timing").addEventListener("change", renderLyrics);
function editTiming(index, key, value) {
  remember();
  project.lines[index] = {
    ...project.lines[index],
    [key]: value,
    words: [],
    timing: "manual",
    timingQuality: "estimated",
  };
  invalidateLyrics();
}
function renderLyrics() {
  const list = $("#lyrics-list");
  list.replaceChildren();
  const longHolds = longHoldLines(project.lines);
  $("#timing-quality-note").hidden = !longHolds.length;
  $("#timing-quality-note").textContent = longHolds.length
    ? "Check the long hold in line " +
      (longHolds[0] + 1) +
      ". A word may have been stretched across a pause by transcription. Play the marked line before confirming."
    : "";
  project.lines.forEach((line, index) => {
    const row = node("article", undefined, "lyric-row");
    row.dataset.lineId = line.id;
    const play = button(
      "▶",
      () => {
        const line = project.lines[index];
        if (line.start === null) {
          message("Open Timing options to re-sync this saved draft.", true);
          return;
        }
        stopAt = line.end;
        player.currentTime = line.start;
        player
          .play()
          .catch(() =>
            message("Tap the audio play button to start listening."),
          );
      },
      "line-play",
    );
    play.setAttribute("aria-label", "Play line " + (index + 1));
    const input = node("textarea");
    input.rows = 1;
    input.maxLength = 500;
    input.value = line.text;
    input.dir = "auto";
    input.setAttribute("aria-label", "Lyric line " + (index + 1));
    let editRemembered = false;
    input.addEventListener("focus", () => {
      editRemembered = false;
    });
    input.addEventListener("input", () => {
      fitLyricInput(input);
      if (!editRemembered) {
        remember();
        editRemembered = true;
      }
      project.lines[index] = reviseLine(project.lines[index], input.value);
      invalidateLyrics();
      syncNote.textContent =
        project.lines[index].timingQuality === "estimated"
          ? "Estimated sync · listen"
          : "Timing kept";
    });
    const meta = node("div", undefined, "line-meta");
    const syncNote = node(
      "span",
      longHolds.includes(index)
        ? "Long hold · listen"
        : line.timingQuality === "estimated"
          ? "Estimated sync · listen"
          : line.timing === "edited"
            ? "Timing kept"
            : "Auto-synced",
      "line-note",
    );
    syncNote.classList.toggle("estimated", line.timingQuality === "estimated");
    meta.append(syncNote);
    const details = node("details");
    const summary = node(
      "summary",
      line.start === null
        ? "Sync needed"
        : timeLabel(line.start) + " – " + timeLabel(line.end) + " · Timing",
    );
    details.append(summary);
    details.hidden = !$("#fine-tune-timing").checked;
    const controls = node("div", undefined, "timing-controls");
    for (const key of ["start", "end"]) {
      const label = node(
        "label",
        key === "start" ? "Start (seconds)" : "End (seconds)",
      );
      const field = node("input");
      field.type = "number";
      field.min = "0";
      field.max = String(project.duration);
      field.step = ".01";
      field.value = line[key] ?? "";
      field.setAttribute(
        "aria-label",
        (key === "start" ? "Start" : "End") + " of line " + (index + 1),
      );
      field.addEventListener("input", () => {
        editTiming(index, key, field.value === "" ? null : Number(field.value));
        summary.textContent = "Timing changed · review audio";
      });
      label.append(field);
      controls.append(label);
      controls.append(
        button(key === "start" ? "Start here" : "End here", () => {
          const v = Math.round(player.currentTime * 100) / 100;
          editTiming(index, key, v);
          field.value = String(v);
          summary.textContent = "Timing changed · review audio";
        }),
      );
    }
    details.append(controls);
    meta.append(details);
    meta.append(
      button("Split", () => {
        const text = input.value;
        const at =
          input.selectionStart > 0 && input.selectionStart < text.length
            ? input.selectionStart
            : text.indexOf(" ", Math.floor(text.length / 2));
        if (at < 1 || at >= text.length) {
          message("Place the cursor between words to split this line.", true);
          return;
        }
        const line = project.lines[index];
        remember();
        const left = text.slice(0, at).trim(),
          right = text.slice(at).trim();
        if (!left || !right) return;
        try {
          project.lines.splice(
            index,
            1,
            ...splitTimedLine(line, at, crypto.randomUUID()),
          );
        } catch (error) {
          message(error.message, true);
          return;
        }
        invalidateLyrics();
        renderLyrics();
      }),
    );
    if (index < project.lines.length - 1)
      meta.append(
        button("Merge next", () => {
          remember();
          const line = project.lines[index];
          const next = project.lines[index + 1];
          if ((line.text + " " + next.text).length > 500) {
            message("Keep each lyric line under 500 characters.", true);
            return;
          }
          project.lines.splice(index, 2, mergeTimedLines(line, next));
          invalidateLyrics();
          renderLyrics();
        }),
      );
    meta.append(
      button("Remove", () => {
        remember();
        project.lines.splice(index, 1);
        invalidateLyrics();
        renderLyrics();
      }),
    );
    row.append(play, input, meta);
    list.append(row);
    fitLyricInput(input);
  });
  $("#undo-lyrics").disabled = !history.length;
  $("#review-confirm").checked = project.confirmed;
  renderDirection();
}
function fitLyricInput(input) {
  input.style.height = "auto";
  input.style.height = input.scrollHeight + 2 + "px";
}
let lyricsWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === lyricsWidth) return;
  lyricsWidth = entry.contentRect.width;
  if (!$("#step-lyrics").hidden)
    $("#lyrics-list").querySelectorAll("textarea").forEach(fitLyricInput);
}).observe($("#lyrics-list"));
$("#undo-lyrics").addEventListener("click", () => {
  if (history.length) {
    project.lines = history.pop();
    invalidateLyrics();
    renderLyrics();
  }
});
$("#add-line").addEventListener("click", () => {
  if (project.lines.length >= LIMITS.lines) return;
  remember();
  const inserted = insertTimedLine(
    project.lines,
    player.currentTime,
    project.duration,
    crypto.randomUUID(),
  );
  project.lines = inserted.lines;
  invalidateLyrics();
  renderLyrics();
  $("#lyrics-list")
    .children[inserted.index]?.querySelector("textarea")
    ?.focus();
});
$("#confirm-lyrics").addEventListener("click", () => {
  const error = validateLines(project.lines, project.duration);
  if (error) {
    message(
      error + " Open Timing options to re-sync from the saved transcript.",
      true,
    );
    return;
  }
  if (!$("#review-confirm").checked) {
    message(
      "Listen through and tick the review confirmation before continuing.",
      true,
    );
    return;
  }
  project.confirmed = true;
  project.maxStep = 2;
  if (!project.customStyle) applyDirection();
  showStep(2);
});

function imageTab(stock) {
  $("#upload-images").hidden = stock;
  $("#stock-images").hidden = !stock;
  for (const id of ["upload", "stock"]) {
    const active = (id === "stock") === stock;
    $("#tab-" + id).setAttribute("aria-selected", String(active));
    $("#tab-" + id).tabIndex = active ? 0 : -1;
  }
}
$("#tab-upload").addEventListener("click", () => imageTab(false));
$("#tab-stock").addEventListener("click", () => imageTab(true));
$(".image-tabs").addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const stock = $("#tab-stock").getAttribute("aria-selected") !== "true";
    imageTab(stock);
    $(stock ? "#tab-stock" : "#tab-upload").focus();
  }
});
async function addImage(blob, meta = {}) {
  invalidateVideo();
  if (images.length >= LIMITS.images)
    throw new Error("Use up to " + LIMITS.images + " images. Remove one to add another.");
  const image = await prepareImage(blob, meta);
  images.push(image);
  project.textOnly = false;
  try {
    await assetStore("put", "image:" + image.id, image.blob);
  } catch {
    message(
      "Image added, but could not be saved for a return visit. Keep this page open.",
      true,
    );
  }
  renderImages();
  persist();
}
async function uploadImages(files) {
  if (busy) return;
  setBusy(true);
  message("Preparing images…");
  try {
    for (const file of files) {
      await addImage(file, { name: file.name });
    }
    message("");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    $("#images-input").value = "";
  }
}
$("#choose-images").addEventListener("click", () => $("#images-input").click());
$("#images-input").addEventListener("change", () =>
  uploadImages([...$("#images-input").files]),
);
dropTarget($("#image-drop"), uploadImages);
function renderImages() {
  invalidateVideo();
  renderVisualPlan();
  const scenes = storyboardFor(project, images.length);
  $("#image-count").textContent = images.length + " / " + LIMITS.images;
  $("#text-only").checked = project.textOnly;
  $("#image-readiness").textContent = visualSummary(project.textOnly, images);
  $("#image-mode-note").textContent = visualSummary(project.textOnly, images);
  const list = $("#selected-images");
  list.replaceChildren();
  images.forEach((image, index) => {
    const card = node("article", undefined, "selected-image");
    const preview = node("img");
    preview.src = image.url;
    preview.alt = "Crop preview for " + image.name;
    preview.loading = "lazy";
    preview.style.aspectRatio = project.settings.aspect.replace(":", "/");
    preview.style.objectPosition = image.cropX + "% " + image.cropY + "%";
    card.append(preview, node("p", index + 1 + ". " + image.name));
    const uses = scenes.filter((scene) => scene.imageIndex === index);
    card.append(node("p", uses.length + (uses.length === 1 ? " scene" : " scenes") + " · first at " + timeLabel(uses[0]?.start || 0), "image-caption"));
    const actions = node("div", undefined, "image-buttons");
    const prev = button(
      "←",
      () => {
        [images[index - 1], images[index]] = [images[index], images[index - 1]];
        renderImages();
        persist();
      },
      "secondary-button",
    );
    prev.disabled = index === 0;
    prev.setAttribute("aria-label", "Move image " + (index + 1) + " earlier");
    const next = button(
      "→",
      () => {
        [images[index + 1], images[index]] = [images[index], images[index + 1]];
        renderImages();
        persist();
      },
      "secondary-button",
    );
    next.disabled = index === images.length - 1;
    next.setAttribute("aria-label", "Move image " + (index + 1) + " later");
    actions.append(
      prev,
      next,
      button("Replace", () => {
        replaceImageId = image.id;
        $("#replace-image-input").click();
      }),
      button("Remove", () => {
        images.splice(index, 1);
        releaseImage(image);
        assetStore("delete", "image:" + image.id).catch(() => {});
        renderImages();
        persist();
      }),
    );
    card.append(actions);
    const crop = node("details");
    crop.append(node("summary", "Adjust crop"));
    for (const [key, title] of [
      ["cropX", "Crop left / right"],
      ["cropY", "Crop up / down"],
    ]) {
      const label = node("label", title);
      const slider = node("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = image[key];
      slider.setAttribute("aria-label", title + " for image " + (index + 1));
      slider.addEventListener("input", () => {
        invalidateVideo();
        image[key] = Number(slider.value);
        preview.style.objectPosition = image.cropX + "% " + image.cropY + "%";
        renderStoryboard(storyboardFor(project, images.length));
        persist();
      });
      label.append(slider);
      crop.append(label);
    }
    card.append(crop);
    if (Math.max(image.width, image.height) < 1600)
      card.append(
        node("p", "Limited resolution: 720p is recommended.", "small-copy"),
      );
    list.append(card);
  });
  renderStoryboard(scenes);
}
function renderVisualPlan() {
  const plan = visualPlan(project);
  $("#visual-plan-name").textContent = plan.name;
  $("#visual-plan-description").textContent = plan.description;
  $("#visual-plan-palette").textContent = plan.palette;
  $("#visual-plan-basis").textContent = plan.basis + ". Adjust the theme to match your story.";
  $("#scene-recommendation").textContent = plan.count + " suggested scenes";
  $("#scene-recommendation-note").textContent = "For your " + timeLabel(project.duration) + " song. Start with " + plan.count + " images, or use fewer and we’ll repeat them. One image can stay throughout.";
  const ideas = $("#photo-ideas");
  ideas.replaceChildren();
  for (const query of plan.searches) ideas.append(button(query, () => {
    imageTab(true);
    $("#stock-query").value = query;
    searchPhotos();
    $("#stock-form").scrollIntoView({ block: "center" });
    $("#stock-query").focus({ preventScroll: true });
  }, "secondary-button"));
}
function renderStoryboard(scenes) {
  const list = $("#storyboard-scenes");
  list.replaceChildren();
  $("#storyboard-panel").hidden = project.textOnly;
  $("#scene-count").textContent = scenes.length + " auto-timed scenes";
  for (const scene of scenes) {
    const card = node("article", undefined, "storyboard-scene");
    const image = images[scene.imageIndex];
    if (image) {
      const thumbnail = node("img");
      thumbnail.src = image.url;
      thumbnail.alt = "Scene " + (scene.index + 1) + ": " + image.name;
      thumbnail.loading = "lazy";
      thumbnail.style.objectPosition = image.cropX + "% " + image.cropY + "%";
      card.append(thumbnail);
    } else card.append(node("div", String(scene.index + 1).padStart(2, "0"), "scene-placeholder"));
    card.append(
      node("p", timeLabel(scene.start) + "–" + timeLabel(scene.end), "scene-time"),
      node("p", scene.label),
      node("p", scene.excerpt, "scene-excerpt"),
      node("p", scene.index ? TRANSITIONS[sceneTransition(project, scene).type] : "Opening image", "small-copy"),
    );
    if (!image) card.append(button("Find " + scene.search, () => {
      imageTab(true);
      $("#stock-query").value = scene.search;
      searchPhotos();
      $("#stock-form").scrollIntoView({ block: "center" });
    }));
    list.append(card);
  }
}
$("#replace-image-input").addEventListener("change", async () => {
  const input = $("#replace-image-input");
  const file = input.files[0];
  const index = images.findIndex((image) => image.id === replaceImageId);
  input.value = "";
  if (busy || !file || index < 0) return;
  setBusy(true);
  invalidateVideo();
  message("Preparing your replacement image…");
  try {
    const previous = images[index];
    const replacement = await prepareImage(file, { id: previous.id, name: file.name });
    images[index] = replacement;
    releaseImage(previous);
    await assetStore("put", "image:" + replacement.id, replacement.blob).catch(() => message("Image replaced, but this change could not be saved. Keep this page open.", true));
    renderImages();
    persist();
    if (!$("#app-message").classList.contains("error")) message("Image replaced. Scene timing is unchanged.");
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); replaceImageId = null; }
});
$("#text-only").addEventListener("change", () => {
  project.textOnly = $("#text-only").checked;
  renderImages();
  persist();
});
async function searchPhotos(append = false) {
  const q = $("#stock-query").value.trim();
  if (!q) return;
  stockController?.abort();
  stockController = new AbortController();
  if (!append) {
    stockPage = 1;
    stockQuery = q;
    $("#stock-results").replaceChildren();
  }
  $("#stock-status").textContent = "Finding photos…";
  $("#stock-more").hidden = true;
  const orientation =
    project.settings.aspect === "9:16"
      ? "vertical"
      : project.settings.aspect === "16:9"
        ? "horizontal"
        : "all";
  try {
    const res = await fetch(
      "/api/lyrical/photos?" +
        new URLSearchParams({
          q: stockQuery,
          orientation,
          page: String(stockPage),
        }),
      { signal: stockController.signal },
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data.error?.message ||
          "Photo search is unavailable. You can still upload images.",
      );
    for (const photo of data.photos || []) {
      const card = node("article", undefined, "stock-photo");
      const choose = button(
        "",
        async () => {
          if (busy) return;
          setBusy(true);
          message("Adding your selected photo…");
          try {
            const response = await fetch(
              "/api/lyrical/image?id=" + encodeURIComponent(photo.id),
            );
            if (!response.ok) {
              const result = await response.json();
              throw new Error(
                result.error?.message || "Could not add this photo.",
              );
            }
            await addImage(await response.blob(), {
              id: "pixabay-" + photo.id + "-" + crypto.randomUUID(),
              name: "Photo by " + photo.author,
              sourceUrl: photo.sourceUrl,
              author: photo.author,
            });
            message("Photo added to your sequence.");
          } catch (error) {
            message(error.message, true);
          } finally {
            setBusy(false);
          }
        },
        "",
      );
      const image = node("img");
      image.src = photo.previewUrl;
      image.alt = "Stock photo by " + photo.author;
      image.loading = "lazy";
      choose.setAttribute("aria-label", "Add photo by " + photo.author);
      choose.append(image, node("span", "+ Add"));
      const credit = node("a", photo.author + " · Pixabay");
      credit.href = photo.sourceUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      card.append(choose, credit);
      $("#stock-results").append(card);
    }
    $("#stock-status").textContent = data.photos?.length
      ? "Select photos to add them to your sequence."
      : "No photos found. Try a broader English keyword.";
    $("#stock-more").hidden =
      !data.photos?.length ||
      $("#stock-results").children.length >= Math.min(data.total, 500);
  } catch (error) {
    if (error.name !== "AbortError")
      $("#stock-status").textContent = error.message;
  }
}
$("#stock-form").addEventListener("submit", (e) => {
  e.preventDefault();
  searchPhotos();
});
$("#stock-more").addEventListener("click", () => {
  stockPage++;
  searchPhotos(true);
});
for (const key of ["aspect", "style", "intensity", "presentation", "accent", ...Object.keys(visualDefaults)])
  $("#" + key).addEventListener("change", () => {
    invalidateVideo();
    project.settings[key] = $("#" + key).value;
    if (key === "style")
      project.settings.accent = STYLES[project.settings.style].accent;
    if (["style", "intensity", "presentation", "accent"].includes(key)) project.customStyle = true;
    renderDirection();
    if (["aspect", ...Object.keys(visualDefaults)].includes(key)) renderImages();
    persist();
  });
$("#text-size").addEventListener("input", () => {
  invalidateVideo();
  project.settings.textSize = Number($("#text-size").value);
  project.customStyle = true;
  persist();
});
$("#reset-direction").addEventListener("click", () => {
  applyDirection();
  persist();
});
$("#create-video").addEventListener("click", async () => {
  if (!project.confirmed) {
    message("Confirm the lyrics before creating a video.", true);
    return;
  }
  const imageError = validateVisuals(project.textOnly, images);
  if (imageError) {
    message(imageError, true);
    return;
  }
  message("Preparing your video…");
  try {
    await loadLyricalFonts();
    project.maxStep = 3;
    const window = previewWindow(storyboardFor(project, images.length), project.duration);
    player.currentTime = window.start;
    showStep(3);
    stopAt = window.end;
    const epoch = previewEpoch;
    await preparePreviewImages();
    if (epoch !== previewEpoch || project.step !== 3 || busy) return;
    player
      .play()
      .catch(() =>
        message("Tap Play preview to see the motion before downloading."),
      );
  } catch (error) {
    if (error.name === "AbortError") return;
    message(
      error.message || "The preview could not load. Check your connection and retry.",
      true,
    );
  }
});
function previewIndices() {
  return project.textOnly ? [] : sceneImageIndices(project, storyboardFor(project, images.length), player.currentTime);
}
async function preparePreviewImages() {
  await imageCache.prepare(images, previewIndices());
}
function drawPreview() {
  if (!audioBuffer || project.step !== 3 || busy) return;
  const needed = previewIndices();
  if (!imageCache.ready(images, needed)) {
    if (previewLoading) return;
    const epoch = previewEpoch;
    previewLoading = true;
    previewResume = !player.paused;
    player.pause();
    $("#preview-buffering").hidden = false;
    $("#preview-buffering").textContent = "Preparing this scene…";
    imageCache.prepare(images, needed).then(() => {
      if (epoch !== previewEpoch) return;
      previewLoading = false;
      $("#preview-buffering").hidden = true;
      const resume = previewResume;
      drawPreview();
      if (resume && !previewLoading && project.step === 3 && !busy) {
        previewResume = false;
        player.play().catch(() => {});
      }
    }).catch((error) => {
      if (epoch !== previewEpoch) return;
      previewLoading = previewResume = false;
      $("#preview-buffering").textContent = error.message;
      message(error.message, true);
    });
    return;
  }
  const size = dimensions(project.settings.aspect, "720");
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  drawLyricalFrame(
    ctx,
    project,
    project.textOnly ? [] : images,
    player.currentTime,
    canvas.width,
    canvas.height,
  );
  $("#preview-seek").max = String(project.duration);
  $("#preview-seek").value = String(player.currentTime);
  $("#preview-time").textContent =
    timeLabel(player.currentTime) + " / " + timeLabel(project.duration);
  $("#motion-label").textContent = lyricalMotionLabel(
    project,
    player.currentTime,
  );
}
function animate() {
  drawPreview();
  if (!player.paused) raf = requestAnimationFrame(animate);
}
player.addEventListener("play", () => {
  $("#preview-play").textContent = "Pause";
  cancelAnimationFrame(raf);
  animate();
});
player.addEventListener("pause", () => {
  $("#preview-play").textContent = "Play preview";
  cancelAnimationFrame(raf);
  drawPreview();
});
player.addEventListener("seeked", drawPreview);
player.addEventListener("timeupdate", () => {
  if (stopAt !== null && player.currentTime >= stopAt) {
    player.pause();
    stopAt = null;
  }
  if (player.paused) drawPreview();
});
$("#preview-play").addEventListener("click", () => {
  previewResume = false;
  stopAt = null;
  if (player.paused) {
    if (player.currentTime >= project.duration - 0.05) player.currentTime = 0;
    player
      .play()
      .catch(() => message("Use the audio player to start playback."));
  } else player.pause();
});
$("#preview-seek").addEventListener("input", () => {
  previewResume = false;
  stopAt = null;
  player.currentTime = Number($("#preview-seek").value);
  drawPreview();
});
$("#preview-highlight").addEventListener("click", async () => {
  if (busy) return;
  player.pause();
  previewResume = false;
  const window = previewWindow(storyboardFor(project, images.length), project.duration);
  player.currentTime = window.start;
  stopAt = window.end;
  const epoch = previewEpoch;
  try {
    await preparePreviewImages();
    if (epoch === previewEpoch && project.step === 3 && !busy) await player.play();
  }
  catch (error) { if (error.name !== "AbortError") message(error.message, true); }
});
async function checkExport() {
  const revision = ++probeRevision;
  $("#export-video").disabled = true;
  $("#export-support").textContent = "Checking available export formats…";
  try {
    const size = dimensions(
      project.settings.aspect,
      $("#export-quality").value,
    );
    const formats = await probeExport({
      ...size,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
    });
    if (revision !== probeRevision) return;
    $("#export-format").replaceChildren();
    for (const f of formats) {
      const o = node("option", f.format.toUpperCase());
      o.value = f.format;
      $("#export-format").append(o);
    }
    $("#export-video").disabled = busy || !formats.length;
    $("#export-support").textContent = formats.length
      ? "Export is available on this device."
      : "This browser cannot encode this video with audio. Try 720p or open the project in a current desktop browser.";
  } catch (error) {
    if (revision === probeRevision)
      $("#export-support").textContent = error.message;
  }
}
$("#export-quality").addEventListener("change", checkExport);
$("#export-video").addEventListener("click", async () => {
  if (busy || !audioBuffer) return;
  const imageError = validateVisuals(project.textOnly, images);
  if (imageError) {
    message(imageError, true);
    return;
  }
  player.pause();
  previewEpoch++;
  previewLoading = previewResume = false;
  imageCache.clear();
  exportController = new AbortController();
  $("#cancel-export").hidden = false;
  $("#export-progress").hidden = false;
  $("#export-progress").value = 0;
  $("#download-result").hidden = true;
  setBusy(true, "#cancel-export");
  let wake = null;
  try {
    try {
      wake = await navigator.wakeLock?.request("screen");
    } catch {}
    await loadLyricalFonts();
    const size = dimensions(
        project.settings.aspect,
        $("#export-quality").value,
      ),
      output = document.createElement("canvas");
    output.width = size.width;
    output.height = size.height;
    const context = output.getContext("2d");
    const frozen = structuredClone(project);
    const format = $("#export-format").value;
    const blob = await exportLyrical({
      canvas: output,
      drawFrame: async (time) => {
        const needed = frozen.textOnly ? [] : sceneImageIndices(frozen, storyboardFor(frozen, images.length), time);
        if (!imageCache.ready(images, needed)) await imageCache.prepare(images, needed, exportController.signal);
        drawLyricalFrame(
          context,
          frozen,
          frozen.textOnly ? [] : images,
          time,
          size.width,
          size.height,
        );
      },
      audioBuffer,
      duration: project.duration,
      fps: 30,
      format,
      signal: exportController.signal,
      onProgress: (percent) => {
        $("#export-progress").value = percent;
        $("#export-status").textContent =
          percent < 99
            ? "Creating your video · " + Math.floor(percent) + "%"
            : "Finishing the video file…";
      },
    });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const link = $("#download-result");
    link.href = downloadUrl;
    link.download = sanitizeFilename(
      project.name.replace(/\.[^.]+$/, "") + "-lyrical." + format,
    );
    link.hidden = false;
    $("#export-status").textContent =
      "Your video is ready · " +
      (blob.size / 1024 / 1024).toFixed(1) +
      " MB. Tap Save video.";
  } catch (error) {
    $("#export-status").textContent =
      error.name === "AbortError"
        ? "Export cancelled. Your project is safe."
        : error.message;
  } finally {
    if (wake) await wake.release().catch(() => {});
    setBusy(false);
    $("#cancel-export").hidden = true;
    exportController = null;
    imageCache.clear();
    drawPreview();
    checkExport();
  }
});
$("#cancel-export").addEventListener("click", () => exportController?.abort());
$("#download-lyrics").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([project.lines.map((l) => l.text).join("\n")], {
      type: "text/plain;charset=utf-8",
    }),
  );
  const a = node("a");
  a.href = url;
  a.download = sanitizeFilename(
    project.name.replace(/\.[^.]+$/, "") + "-lyrics.txt",
  );
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("beforeunload", (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
$("#start-over").addEventListener("click", async () => {
  if (
    project.name &&
    !confirm(
      "Start a new project? This replaces the draft saved on this device.",
    )
  )
    return;
  await clearDraft().catch(() => {});
  location.reload();
});
if (initialDraft) {
  $("#recovery").hidden = false;
  $("#recovery-copy").textContent =
    "Continue “" +
    initialDraft.name +
    "”? Your previous draft is saved on this device.";
}
$("#dismiss-draft").addEventListener(
  "click",
  () => ($("#recovery").hidden = true),
);
$("#resume").addEventListener("click", async () => {
  if (!initialDraft || busy || restoring) return;
  restoring = true;
  clearTimeout(saveTimer);
  message("Restoring your draft…");
  let restored = false;
  try {
    const file = await assetStore("get", "song");
    if (!file)
      throw new Error(
        "The saved audio is no longer available. Start a new project with your original song.",
      );
    project = { ...initialDraft, settings: { ...visualDefaults, ...initialDraft.settings } };
    await selectSong(file, { restore: true });
    if (!audioBuffer) return;
    setBusy(true);
    for (const meta of initialDraft.images || []) {
      const blob = await assetStore("get", "image:" + meta.id);
      if (blob) images.push(await prepareImage(blob, meta));
    }
    if (images.length !== (initialDraft.images || []).length) {
      project.maxStep = Math.min(2, project.maxStep);
      project.step = Math.min(2, project.step);
    }
    await loadLyricalFonts();
    renderDirection();
    setBusy(false);
    showStep(Math.min(project.step, project.maxStep));
    restored = true;
  } catch (error) {
    message(error.message, true);
  } finally {
    restoring = false;
    if (busy) setBusy(false);
    if (restored) persist();
  }
});
$("#try-sample").addEventListener("click", async () => {
  if (busy) return;
  const sampleRate = 22050,
    duration = 12,
    length = sampleRate * duration,
    bytes = new ArrayBuffer(44 + length * 2),
    view = new DataView(bytes);
  const write = (at, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate,
      note = [220, 261.63, 329.63, 293.66][Math.floor(t / 3) % 4],
      envelope = Math.exp(-(t % 0.5) * 7) * 0.22;
    const value =
      Math.sin(t * note * Math.PI * 2) *
      envelope *
      Math.min(1, t * 4, (duration - t) * 4);
    view.setInt16(44 + i * 2, value * 32767, true);
  }
  await selectSong(
    new File([bytes], "Lyrical sample.wav", { type: "audio/wav" }),
  );
  if (!audioBuffer) return;
  project.lines = [
    "Every beat",
    "A new beginning",
    "Let the words",
    "Carry the song",
  ].map((text, i) => ({
    id: "sample-" + i,
    text,
    start: i * 3 + 0.3,
    end: i * 3 + 2.7,
    words: [],
    timing: "sample",
  }));
  project.sample = true;
  project.maxStep = 1;
  applyDirection();
  showStep(1);
  message(
    "Sample project: original instrumental audio with illustrative lyric timing. No transcription was performed.",
  );
});
