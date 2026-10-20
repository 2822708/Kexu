import { legacyNames } from '../../../shared/brandCompatibility.mjs'
/** Cache only complete public builds; business data lives in the device's IndexedDB. */
export function createServiceWorkerSource(options: {
  version: string
  base: string
  precache: string[]
  assets: string[]
}): string {
  const { version, base, precache, assets } = options
  return `/* Kexu mobile shell ${version}; generated at build time. */
const CACHE_PREFIX = 'kexu-mobile-shell-' + ${JSON.stringify(base)} + '-';
const LEGACY_CACHE_PREFIX = ${`String.fromCharCode(${Array.from(legacyNames.cachePrefix, (character) => character.charCodeAt(0)).join(",")})`} + ${JSON.stringify(base)} + '-';
const ownedCache = (key) => key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX);
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const BASE = ${JSON.stringify(base)};
const SHELL = BASE + 'index.html';
const ACTIVATION = BASE + '__pwa_activation__';
const READY = BASE + '__pwa_ready__';
const PRECACHE = ${JSON.stringify(precache)};
const ASSETS = new Set(${JSON.stringify(assets)});

async function previousBuildAsset(path) {
  const keys = await caches.keys();
  for (const key of keys.reverse()) {
    if (!ownedCache(key) || key === CACHE_NAME) continue;
    const cached = await caches.match(path, { cacheName: key });
    if (cached) return cached;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((url) => new Request(url, { credentials: 'omit', cache: 'reload' })));
    // Written only after the entire public build, including lazy dependencies, succeeds.
    await cache.put(READY, new Response(${JSON.stringify(version)}));
  })());
  // Updates wait until the user has saved their work and explicitly confirms.
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter((key) => ownedCache(key) && key !== CACHE_NAME);
    let previous = '';
    let lastActivation = 0;
    // A newer waiting/failed install must not displace the build still running
    // in another tab. Keep the last activated build, not just the last created cache.
    for (const key of oldKeys) {
      const marker = await caches.match(ACTIVATION, { cacheName: key });
      const order = marker ? Number(await marker.text()) : 0;
      if (Number.isSafeInteger(order) && order > lastActivation &&
          await caches.match(SHELL, { cacheName: key })) {
        previous = key;
        lastActivation = order;
      }
    }
    // Compatibility with a previous worker that did not write activation markers.
    for (const key of [...oldKeys].reverse()) {
      if (previous) break;
      if (await caches.match(SHELL, { cacheName: key })) { previous = key; break; }
    }
    const currentCache = await caches.open(CACHE_NAME);
    await currentCache.put(ACTIVATION, new Response(String(lastActivation + 1)));
    await Promise.all(oldKeys.filter((key) => key !== previous)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ACTIVATE_SAVED_UPDATE') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data && event.data.type === 'GET_OFFLINE_STATUS' && event.ports && event.ports[0]) {
    const port = event.ports[0];
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const marker = await cache.match(READY);
        let missing = 0;
        for (const path of PRECACHE) if (!await cache.match(path)) missing++;
        port.postMessage({ type: 'OFFLINE_STATUS', ready: !!marker && missing === 0,
          version: ${JSON.stringify(version)}, assetCount: PRECACHE.length, missingCount: missing });
      } catch {
        port.postMessage({ type: 'OFFLINE_STATUS', ready: false });
      }
    })());
  }
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.pathname.startsWith(BASE) || url.search ||
      request.headers.has('Authorization') || request.headers.has('X-API-Key')) return;
  const relative = url.pathname.slice(BASE.length);
  if (/^(api|auth|ai|backups?|snapshots?|vaults?|cloud)(\\/|$)/i.test(relative)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Never cache live navigation responses: a proxy may return personalized HTML.
        return await fetch(request);
      } catch {
        const shell = await caches.match(SHELL, { cacheName: CACHE_NAME });
        return shell || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p>本机课表数据仍保存在浏览器中，但离线页面资源尚未准备完整。请联网后重新打开Kexu；不要清除网站数据。</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
    })());
    return;
  }
  // Only known build assets may be added to the cache. An old tab can also read
  // an existing cached hashed /assets/ file from the immediately previous build.
  const currentAsset = ASSETS.has(url.pathname);
  const oldHashedAsset = /^assets\\/[^/]+-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$/.test(relative);
  if (!currentAsset && !oldHashedAsset) return;
  event.respondWith((async () => {
    const cache = currentAsset ? await caches.open(CACHE_NAME) : null;
    const current = cache && await cache.match(url.pathname);
    if (current) return current;
    if (oldHashedAsset) {
      const previous = await previousBuildAsset(url.pathname);
      if (previous) return previous;
    }
    const response = await fetch(request);
    if (cache && response.ok && response.type === 'basic' &&
        !/(no-store|private)/i.test(response.headers.get('Cache-Control') || '')) {
      await cache.put(url.pathname, response.clone());
    }
    return response;
  })());
});
`
}
