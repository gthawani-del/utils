const urls = new Set();

export function trackObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}

export function revokeObjectUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(url);
}

export async function clearWorkspace() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  for (const key of Object.keys(localStorage)) if (key.startsWith('utility-os:')) localStorage.removeItem(key);
  for (const key of Object.keys(sessionStorage)) if (key.startsWith('utility-os:')) sessionStorage.removeItem(key);
  if ('caches' in globalThis) {
    for (const key of await caches.keys()) if (key.startsWith('utility-os')) await caches.delete(key);
  }
}
