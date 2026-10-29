// Wizard OS service worker: scoped to /wizard-os-home/ only, so every app on this origin installs separately.
// Network first, always: online, every request goes to Wizard exactly as before (Chrome also needs a fetch handler to
// treat the page as installable). The shell's own files (pages, scripts, styles, icons under this scope) are copied
// into one cache as they arrive, so Wizard still opens with no connection or on spotty wifi (a plane, a tunnel); the
// shell then shows its saved chat list and threads. Nothing outside the scope is cached here: chats, files, apps and
// every /wizard/* API stay network-only.
const CACHE = 'wos-shell-v1', PREFIX = 'wos-shell-', MAX_ENTRIES = 800;
const SCOPE = new URL(self.registration.scope).pathname;
// Private media and byte-range requests stay with the browser's own network stack: routing a 15 MB video through
// respondWith(fetch()) made Share/Save wait ~30 s on Android (18 Oct 2026).
const PRIVATE_MEDIA = /^\/wizard\/(?:attachments\/|files\/)/;
const RELEASE = /<meta name="wos-release" content="([^"]+)"/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Own prefix only: never touch another app's caches on this origin.
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

// Pages are cached without their query (?thread=…), so a deep link still opens offline.
const pageKey = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const cacheable = res => !!res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected &&
  !/no-store/i.test(res.headers.get('cache-control') || '');

// One copy per release: once a page from a newer release (stamped ?v=<token>, tools/stamp-assets.sh) arrives,
// files stamped with any other token go, so an offline start can never mix two releases' modules.
async function prune(release) {
  const cache = await caches.open(CACHE), keys = await cache.keys();
  let left = keys.length;
  for (const key of keys) {
    const v = new URL(key.url).searchParams.get('v');
    if (release && v && v !== release) { await cache.delete(key); left--; }
  }
  if (left <= MAX_ENTRIES) return;
  for (const key of (await cache.keys()).slice(0, left - MAX_ENTRIES)) await cache.delete(key);
}

// A link that is up but crawling (hotel wifi, one bar) would keep Wizard on a blank screen until the network gave
// up. Past SLOW_MS a saved copy answers instead, and the network read still lands in the background for next time.
const SLOW_MS = 3000;
async function savedCopy(req) {
  const cache = await caches.open(CACHE);
  if (req.mode !== 'navigate') return cache.match(req);
  return await cache.match(pageKey(req.url)) || await cache.match(new URL('index.html', self.registration.scope).href) || await cache.match(self.registration.scope);
}
async function shell(event) {
  const req = event.request, page = req.mode === 'navigate';
  // An explicit no-store read (update checks) is never answered from a saved copy, so it is never saved either.
  if (req.cache === 'no-store') return fetch(req);
  // A stamped file (?v=<release token>, tools/stamp-assets.sh) never changes under its URL: its saved copy is exact.
  if (!page && new URL(req.url).searchParams.has('v')) { const hit = await (await caches.open(CACHE)).match(req); if (hit) return hit; }
  let fellBack = false, timer = 0;
  const network = fetch(req).then(res => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        if (!page) return cache.put(req, copy);
        const html = await copy.clone().text();
        await cache.put(pageKey(req.url), copy);
        // The page on screen came from the saved copy: its release's files must stay until the next fresh start.
        if (!fellBack) await prune(html.match(RELEASE)?.[1] || '');
      })().catch(() => {}));
    }
    return res;
  });
  try {
    const first = await Promise.race([network, new Promise(r => { timer = setTimeout(() => r(null), SLOW_MS); })]);
    if (first) return first;
    const hit = await savedCopy(req);
    if (hit) { fellBack = true; event.waitUntil(network.catch(() => {})); return hit; }
    return await network;
  } catch (error) {
    const hit = await savedCopy(req);
    if (hit) return hit;
    throw error;
  } finally { clearTimeout(timer); }
}

// First visit: the page loaded before this worker ran, so it hands over what it loaded (pwa-install.js). The copies
// come from the browser's HTTP cache (a revalidation at most). Only this scope's files; never sw.js, never no-store.
const inScope = url => { try { const u = new URL(url); return u.origin === self.location.origin && u.pathname.startsWith(SCOPE) && u.pathname !== SCOPE + 'sw.js'; } catch (_) { return false; } };
self.addEventListener('message', event => {
  const d = event.data;
  if (!d || d.type !== 'wos-shell-warm' || !Array.isArray(d.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE), urls = [...new Set(d.urls.filter(u => typeof u === 'string' && inScope(u)))].slice(0, 400);
    let release = '';
    for (const url of urls) {
      try {
        const page = !/\.[a-z0-9]+$/i.test(new URL(url).pathname) || /\.html$/i.test(new URL(url).pathname);
        const key = page ? pageKey(url) : url;
        if (!page && await cache.match(key)) continue;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!cacheable(res)) continue;
        if (page) release = (await res.clone().text()).match(RELEASE)?.[1] || release;
        await cache.put(key, res);
      } catch (_) { /* best effort: the next visit fills the gaps */ }
    }
    if (release) await prune(release);
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || PRIVATE_MEDIA.test(u.pathname)) return;
  if (!u.pathname.startsWith(SCOPE) || u.pathname === SCOPE + 'sw.js') { event.respondWith(fetch(req)); return; }
  event.respondWith(shell(event));
});
