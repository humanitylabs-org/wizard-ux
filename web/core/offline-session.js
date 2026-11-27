/* Offline home-screen sessions, driven by what installed apps declare (wizard.md `home_screen.offline`).
 * publish(): tell the shell worker which app ids may open from a pin with no connection (a tiny snapshot in
 *   its own cache; the shell holds no per-app list and an app's URL or a caller query cannot grant itself one).
 * ready(): prepare the small app-session shell before an opted-in pinned app mounts. No reload, no app data access. */
(() => {
  'use strict';
  const CACHE = 'wizard-os-home-registry', URL_ = '/wizard-os-home/offline-apps.json';
  // A renamed app's earlier ids (wizard.md renamed_from) count too: a pin made under the old id opens offline (ux#1471).
  const idsOf = list => [...new Set((list || []).filter(a => a?.homeScreen?.offline && /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(a.id)))
    .flatMap(a => [a.id, ...(a.renamedFrom || []).filter(v => /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(v)))]))].sort();
  async function publish(list) {
    if (!globalThis.caches) return false;
    // A registry that carries no installed app at all (offline cache miss) must not erase the last good list.
    if (!(list || []).some(a => a?.source === 'apps.json')) return false;
    const body = JSON.stringify({ v: 1, ids: idsOf(list) }), cache = await caches.open(CACHE);
    const saved = await cache.match(URL_);
    if (saved && await saved.text() === body) return true;
    await cache.put(URL_, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    return true;
  }
  async function prepare() {
    if (!navigator.serviceWorker) throw Error('Offline shell unavailable');
    const reg = await navigator.serviceWorker.register('/wizard-os-home/sw.js', { scope: '/wizard-os-home/', updateViaCache: 'none' });
    const worker = reg.installing || reg.waiting || reg.active;
    if (!worker) throw Error('Offline shell unavailable');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); }
        else if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(Error('Offline shell unavailable')); }
      };
      worker.addEventListener('statechange', changed); changed();
    });
    return true;
  }
  let pending = null;
  const ready = list => pending ||= (async () => {
    let timer;
    try {
      return await Promise.race([
        (async () => { await publish(list).catch(() => false); return prepare(); })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Offline shell timed out')), 15000); }),
      ]);
    } catch (_) { return false; } finally { clearTimeout(timer); }
  })();
  globalThis.WizOfflineSession = Object.freeze({ publish, ready, idsOf });
  /* Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open, off by default). The shell worker
   * can't read the switch, so the full shell page (never a pinned app page, whose switch list is only a copy) saves a
   * tiny flag beside the offline registry while it is on and removes it once the switch is settled off. While the flag
   * is there core/offline-sw.js answers release-stamped shell files from a saved copy instead of the network. */
  const PIN_SWITCH = 'wizard/pin-instant-open', PIN_FLAG = '/wizard-os-home/pin-instant-open.json';
  let pinWas = null, pinSettled = false;
  function pinSync() {
    if (!globalThis.caches || typeof document === 'undefined' || !document.documentElement || globalThis.WizHomeScreenPolicy?.mode) return;
    let on = false; try { on = (document.documentElement.dataset.tweaks || '').split(' ').includes(PIN_SWITCH); } catch (_) {}
    if (!on && !pinSettled) return;
    if (on === pinWas) return;
    pinWas = on;
    caches.open(CACHE).then(c => on ? c.put(PIN_FLAG, new Response('{"on":true}', { headers: { 'Content-Type': 'application/json' } })) : c.delete(PIN_FLAG)).catch(() => {});
  }
  try {
    if (typeof MutationObserver === 'function' && document.documentElement) new MutationObserver(pinSync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
    addEventListener('wos:experience', () => { pinSettled = true; pinSync(); });
    setTimeout(() => { pinSettled = true; pinSync(); }, 5000);
    pinSync();
  } catch (_) {}
})();
