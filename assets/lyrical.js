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
} from "/lib/lyrical/project.js";
import { decodeSong, transcribeSong } from "/lib/lyrical/audio.js";
import { drawLyricalFrame, loadLyricalFonts } from "/lib/lyrical/renderer.js";
import { prepareImage, releaseImage } from "/lib/lyrical/images.js";
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
let project = {
  version: 1,
  name: "",
  duration: 0,
  lines: [],
  analysis: {},
  settings: {
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
  exportController = null,
  probeRevision = 0;
let stockPage = 1,
  stockQuery = "",
  stockController = null,
  restoring = false;
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
      ({ id, name, width, height, cropX, cropY, sourceUrl, author }) => ({
        id,
        name,
        width,
        height,
        cropX,
        cropY,
        sourceUrl,
        author,
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
  project.step = step;
  panels.forEach((name, i) => ($("#step-" + name).hidden = i !== step));
  syncNavigation();
  message("");
  if (step === 1) renderLyrics();
  if (step === 2) {
    renderImages();
    renderDirection();
  }
  if (step === 3) {
    drawPreview();
    checkExport();
  }
  persist();
  if (scroll) $(".lyrical-steps").scrollIntoView({ block: "start" });
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
}
async function selectSong(file, { restore = false } = {}) {
  if (busy || !file || (restoring && !restore)) return;
  setBusy(true);
  message("Reading your song on this device…");
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
        confirmed: false,
        maxStep: 0,
        step: 0,
        images: [],
        textOnly: false,
        customStyle: false,
      };
      await assetStore("clear").catch(() => {});
    }
    $("#song-name").textContent = project.name;
    $("#song-meta").textContent =
      timeLabel(audioBuffer.duration) + " · Local audio";
    $("#song-bar").hidden = false;
    $("#song-ready").hidden = false;
    $("#song-language").value = project.language || "";
    $("#transcription-quality").value = project.transcriptionQuality || "small";
    $("#recovery").hidden = true;
    try {
      await assetStore("put", "song", file);
    } catch {
      $("#save-status").textContent =
        "Audio could not be saved. You may need to select it again when returning.";
    }
    message("");
    persist();
  } catch (error) {
    message(error.message, true);
  } finally {
    if (!restore) setBusy(false);
    $("#song-input").value = "";
  }
}
$("#choose-song").addEventListener("click", () => $("#song-input").click());
$("#song-input").addEventListener("change", () =>
  selectSong($("#song-input").files[0]),
);
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
$("#transcribe").addEventListener("click", async () => {
  if (!mono || busy) return;
  const language = $("#song-language").value;
  if (!language) {
    message("Choose the song language before transcribing.", true);
    return;
  }
  project.language = language;
  project.transcriptionQuality = $("#transcription-quality").value;
  persist();
  transcriptionController = new AbortController();
  $("#cancel-transcription").hidden = false;
  setBusy(true, "#cancel-transcription");
  message("");
  try {
    const chunks = await transcribeSong(mono, {
      language,
      quality: project.transcriptionQuality,
      signal: transcriptionController.signal,
      onStatus: (text) => ($("#transcription-status").textContent = text),
    });
    const lines = linesFromWords(chunks, project.duration);
    if (!lines.length)
      throw new Error(
        "No usable lyrics were detected. Try selecting the language, or paste your lyrics below.",
      );
    project.lines = lines;
    project.confirmed = false;
    project.maxStep = 1;
    project.language = $("#song-language").value;
    applyDirection();
    $("#transcription-status").textContent =
      "Transcription ready. Check the words and timing before continuing.";
    setBusy(false);
    showStep(1);
    message(
      scriptReviewNote(language, lines) ||
        "Transcription is a draft. Singing, overlapping voices and repeated phrases can need correction.",
    );
  } catch (error) {
    if (error.name === "AbortError")
      $("#transcription-status").textContent =
        "Transcription cancelled. Your song is still ready.";
    else {
      $("#transcription-status").textContent = error.message;
      message(error.message, true);
    }
  } finally {
    if (busy) setBusy(false);
    $("#cancel-transcription").hidden = true;
    transcriptionController = null;
  }
});
$("#cancel-transcription").addEventListener("click", () =>
  transcriptionController?.abort(),
);
$("#use-pasted").addEventListener("click", () => {
  const lines = $("#paste-lyrics")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!audioBuffer || !lines.length) {
    message("Choose your song and paste some lyrics first.", true);
    return;
  }
  if (lines.length > LIMITS.lines) {
    message("Please use fewer than 600 lines.", true);
    return;
  }
  project.lines = lines.map((text, i) => ({
    id: "manual-" + i,
    text,
    start: null,
    end: null,
    words: [],
    timing: "manual",
  }));
  project.confirmed = false;
  project.maxStep = 1;
  applyDirection();
  showStep(1);
  message(
    "Set each line’s start and end while listening. We have not guessed word timing.",
  );
});
function editTiming(index, key, value) {
  remember();
  project.lines[index] = {
    ...project.lines[index],
    [key]: value,
    words: [],
    timing: "edited",
  };
  invalidateLyrics();
}
function renderLyrics() {
  const list = $("#lyrics-list");
  list.replaceChildren();
  project.lines.forEach((line, index) => {
    const row = node("article", undefined, "lyric-row");
    row.dataset.lineId = line.id;
    const play = button(
      "▶",
      () => {
        const line = project.lines[index];
        if (line.start === null) {
          message("Set a start time for this line first.", true);
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
    input.rows = 2;
    input.maxLength = 500;
    input.value = line.text;
    input.dir = "auto";
    input.setAttribute("aria-label", "Lyric line " + (index + 1));
    let editRemembered = false;
    input.addEventListener("focus", () => {
      editRemembered = false;
    });
    input.addEventListener("input", () => {
      if (!editRemembered) {
        remember();
        editRemembered = true;
      }
      project.lines[index] = reviseLine(project.lines[index], input.value);
      invalidateLyrics();
      if (!meta.querySelector(".line-note"))
        meta.append(node("span", "Check timing", "line-note"));
    });
    const meta = node("div", undefined, "line-meta");
    const details = node("details");
    const summary = node(
      "summary",
      line.start === null
        ? "Set line timing"
        : timeLabel(line.start) + " – " + timeLabel(line.end) + " · Timing",
    );
    details.append(summary);
    if (line.start === null) details.open = true;
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
    if (line.timing === "edited" || line.timing === "manual")
      meta.append(node("span", "Check timing", "line-note"));
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
        project.lines.splice(
          index,
          1,
          { ...line, text: left, end: null, words: [], timing: "edited" },
          {
            ...line,
            id: crypto.randomUUID(),
            text: right,
            start: null,
            words: [],
            timing: "edited",
          },
        );
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
          project.lines.splice(index, 2, {
            ...line,
            text: line.text + " " + next.text,
            end: next.end,
            words: [],
            timing: "edited",
          });
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
  });
  $("#undo-lyrics").disabled = !history.length;
  $("#review-confirm").checked = project.confirmed;
  renderDirection();
}
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
  project.lines.push({
    id: crypto.randomUUID(),
    text: "",
    start: Math.round(player.currentTime * 100) / 100,
    end: null,
    words: [],
    timing: "manual",
  });
  invalidateLyrics();
  renderLyrics();
  $("#lyrics-list").lastElementChild?.querySelector("textarea")?.focus();
});
$("#confirm-lyrics").addEventListener("click", () => {
  const error = validateLines(project.lines, project.duration);
  if (error) {
    message(error, true);
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
    throw new Error("Use up to 8 images. Remove one to add another.");
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
  $("#image-count").textContent = images.length + " / " + LIMITS.images;
  $("#text-only").checked = project.textOnly;
  $("#image-readiness").textContent = images.length
    ? images.length + " image" + (images.length === 1 ? "" : "s") + " ready."
    : project.textOnly
      ? "Typography-only video selected."
      : "Add an image or choose typography only.";
  const list = $("#selected-images");
  list.replaceChildren();
  images.forEach((image, index) => {
    const card = node("article", undefined, "selected-image");
    const preview = node("img");
    preview.src = image.url;
    preview.alt = "Crop preview for " + image.name;
    preview.style.aspectRatio = project.settings.aspect.replace(":", "/");
    preview.style.objectPosition = image.cropX + "% " + image.cropY + "%";
    card.append(preview, node("p", index + 1 + ". " + image.name));
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
      button("Remove", () => {
        images.splice(index, 1);
        releaseImage(image);
        assetStore("delete", "image:" + image.id).catch(() => {});
        renderImages();
        persist();
      }),
    );
    card.append(actions);
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
        persist();
      });
      label.append(slider);
      card.append(label);
    }
    if (Math.max(image.width, image.height) < 1600)
      card.append(
        node("p", "Limited resolution: 720p is recommended.", "small-copy"),
      );
    list.append(card);
  });
}
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
for (const key of ["aspect", "style", "intensity", "presentation", "accent"])
  $("#" + key).addEventListener("change", () => {
    invalidateVideo();
    project.settings[key] = $("#" + key).value;
    if (key === "style")
      project.settings.accent = STYLES[project.settings.style].accent;
    if (key !== "aspect") project.customStyle = true;
    renderDirection();
    if (key === "aspect") renderImages();
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
  if (!images.length && !project.textOnly) {
    message("Add at least one image, or choose typography only.", true);
    return;
  }
  message("Preparing your video…");
  try {
    await loadLyricalFonts();
    project.maxStep = 3;
    const first = project.lines[0];
    player.currentTime = first
      ? first.start + Math.min(0.8, (first.end - first.start) / 2)
      : 0;
    showStep(3);
  } catch {
    message(
      "The video fonts could not load. Check your connection and retry.",
      true,
    );
  }
});
function drawPreview() {
  if (!audioBuffer || project.step !== 3) return;
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
  stopAt = null;
  if (player.paused) {
    if (player.currentTime >= project.duration - 0.05) player.currentTime = 0;
    player
      .play()
      .catch(() => message("Use the audio player to start playback."));
  } else player.pause();
});
$("#preview-seek").addEventListener("input", () => {
  stopAt = null;
  player.currentTime = Number($("#preview-seek").value);
  drawPreview();
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
  player.pause();
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
      drawFrame: (time) =>
        drawLyricalFrame(
          context,
          frozen,
          project.textOnly ? [] : images,
          time,
          size.width,
          size.height,
        ),
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
    project = initialDraft;
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
