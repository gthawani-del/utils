const KEY = "utility-os:lyrical:draft:v1";
const DB = "utility-os-lyrical";
export function saveDraft(project) {
  localStorage.setItem(KEY, JSON.stringify(project));
}
export function readDraft() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    return p?.version === 1 &&
      Array.isArray(p.lines) &&
      Array.isArray(p.images) &&
      p.settings &&
      Number.isInteger(p.step) &&
      p.step >= 0 &&
      p.step <= 3 &&
      Number.isFinite(p.duration) &&
      p.duration > 0
      ? p
      : null;
  } catch {
    return null;
  }
}
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function assetStore(action, key, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "assets",
        action === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("assets");
      const request =
        action === "get"
          ? store.get(key)
          : action === "put"
            ? store.put(value, key)
            : action === "clear"
              ? store.clear()
              : store.delete(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function clearDraft() {
  localStorage.removeItem(KEY);
  await assetStore("clear");
}
