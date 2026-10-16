// Model files load concurrently and their total size is not known in advance.
// Report bytes loaded across files instead of treating each file's percentage
// as overall progress. Loading from the browser cache uses the same events.
export function createSpeechLoadReporter(onStatus) {
  const loadedByFile = new Map();
  let reportedMB = 0;
  return (event) => {
    if (
      event?.status !== "progress" ||
      !event.file ||
      !Number.isFinite(event.loaded) ||
      event.loaded < 0
    ) return;

    const key = JSON.stringify([event.name || "", event.file]);
    loadedByFile.set(key, Math.max(loadedByFile.get(key) || 0, event.loaded));
    const total = [...loadedByFile.values()].reduce((sum, bytes) => sum + bytes, 0);
    const mb = Math.floor(total / 1_000_000);
    if (mb <= reportedMB) return;
    reportedMB = mb;
    onStatus("Preparing speech engine · " + mb + " MB loaded");
  };
}
