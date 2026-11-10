const DB = 'utility-os-motion';
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function draft(action, value) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', action === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('projects');
      const req = action === 'read' ? store.get('draft') : action === 'clear' ? store.clear() : store.put(value, 'draft');
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
