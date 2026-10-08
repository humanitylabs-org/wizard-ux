// Wizard OS service worker: scoped to /wizard-os-home/ only, so every app on this origin installs separately.
// Network-first passthrough (Chrome needs a fetch handler to treat the page as installable); nothing is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) event.respondWith(fetch(req));
});
