// Wizard OS service worker: scoped to /wizard-os-home/ only, so every app on this origin installs separately.
// Network-first passthrough (Chrome needs a fetch handler to treat the page as installable); nothing is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Private media and byte-range requests stay with the browser's own network stack: routing a 15 MB video through
// respondWith(fetch()) made Share/Save wait ~30 s on Android (18 Oct 2026).
const PRIVATE_MEDIA = /^\/wizard\/(?:attachments\/|files\/)/;
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || PRIVATE_MEDIA.test(u.pathname)) return;
  event.respondWith(fetch(req));
});
