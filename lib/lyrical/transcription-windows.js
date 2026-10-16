export const TRANSCRIPTION_RATE = 16000;
export const WINDOW_SECONDS = 15;
export const CONTEXT_SECONDS = 2;
export const WINDOWS_PER_WORKER = 3;

// Only this window is copied/transferred to a worker. Context on either side
// avoids cutting words; each window owns a disjoint interval of the song.
export function transcriptionWindows(sampleCount) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0 || sampleCount > 300 * TRANSCRIPTION_RATE)
    throw new Error("Choose a song up to five minutes long.");
  const windows = [];
  const count = Math.ceil(sampleCount / (WINDOW_SECONDS * TRANSCRIPTION_RATE));
  // Distribute the remainder so encoder padding cannot create a near-empty
  // final recognition job (for example a 180.024-second MP3).
  const step = Math.ceil(sampleCount / count);
  const context = CONTEXT_SECONDS * TRANSCRIPTION_RATE;
  for (let coreStart = 0; coreStart < sampleCount; coreStart += step) {
    const coreEnd = Math.min(sampleCount, coreStart + step);
    windows.push({
      index: windows.length,
      start: Math.max(0, coreStart - context),
      end: Math.min(sampleCount, coreEnd + context),
      coreStart, coreEnd,
    });
  }
  return windows;
}

export function appendWindowWords(words, chunks, window) {
  const offset = window.start / TRANSCRIPTION_RATE;
  const coreStart = window.coreStart / TRANSCRIPTION_RATE;
  const coreEnd = window.coreEnd / TRANSCRIPTION_RATE;
  const windowEnd = window.end / TRANSCRIPTION_RATE;
  const candidates = chunks.flatMap((chunk) => {
    const [from, to] = chunk.timestamp || [];
    const text = String(chunk.text || "").trim();
    if (!text || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
    const start = Math.max(offset, offset + from);
    const end = Math.min(windowEnd, offset + to);
    const midpoint = (start + end) / 2;
    if (end <= start || midpoint < coreStart || midpoint >= coreEnd) return [];
    return [{ text, timestamp: [start, end] }];
  }).sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  for (const word of candidates) {
    const previous = words.at(-1);
    if (previous && word.timestamp[0] < previous.timestamp[1]) {
      // Overlap context can produce the same boundary word with slightly
      // different timings. Keep it once without deleting genuine repetitions.
      if (previous.text === word.text &&
          previous.timestamp[1] - word.timestamp[0] >
            (word.timestamp[1] - word.timestamp[0]) / 2) continue;
      word.timestamp[0] = previous.timestamp[1];
    }
    if (word.timestamp[1] > word.timestamp[0]) words.push(word);
  }
}

export function resumeTranscription(checkpoint, windows, identity) {
  if (checkpoint?.version !== 1 || checkpoint.language !== identity.language ||
      checkpoint.quality !== identity.quality || checkpoint.samples !== identity.samples ||
      !Number.isInteger(checkpoint.nextWindow) || checkpoint.nextWindow < 1 ||
      checkpoint.nextWindow > windows.length || !Array.isArray(checkpoint.chunks) ||
      checkpoint.chunks.length > 4000) return { nextWindow: 0, chunks: [] };
  let end = 0;
  const limit = windows[checkpoint.nextWindow - 1].end / TRANSCRIPTION_RATE;
  for (const chunk of checkpoint.chunks) {
    const [from, to] = chunk.timestamp || [];
    if (typeof chunk.text !== "string" || !chunk.text.trim() || chunk.text.length > 500 ||
        !Number.isFinite(from) || !Number.isFinite(to) || from < end || to <= from || to > limit)
      return { nextWindow: 0, chunks: [] };
    end = to;
  }
  return { nextWindow: checkpoint.nextWindow, chunks: structuredClone(checkpoint.chunks) };
}
