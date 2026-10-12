/* Wizard OS preview, first script of the candidate index (before core/*). Preview only: never in production.
 *
 *  - Phone shell at every width: core/shell.js (device → phone/desktop redirect) is not loaded here, so this
 *    sets window.WIZ_SHELL itself and never writes the sticky 'wux.shell' choice.
 *  - The four sample apps are known at first paint: the app-registry cache (wux.apps.v1, read by core/apps.js)
 *    is seeded with the same four ids and URLs the preview server's GET /wizard/v1/apps returns.
 *  - First visit (or a new preview version, or ?preview-reset): the desk strip is seeded as
 *    Home · Wisdom (in front, reading) · Music · Signal · Topics, and stale frame history is dropped. Any layout
 *    already on this origin is copied once to 'wos.preview.backup' first (WosPreview.restore() puts it back).
 *    Nothing else in storage is touched.
 *  - The first-run tour is marked done (core/tour.js is not loaded either).
 *  - Safety: no writes leave this page (fetch with any method other than GET/HEAD is refused, sendBeacon is off)
 *    and the microphone is never opened (getUserMedia is refused), so the orb cannot record or send.
 */
(() => {
  'use strict';
  const VERSION = '2026-10-12.1';
  const NS = 'wos.preview.';
  const BASE = '/wizard-os-home/demo/apps/';
  const APPS = [
    { id: 'wisdom', name: 'Wisdom', url: BASE + 'wisdom.html', icon: '☯', colors: ['#e8b46a', '#8a5a2b'], desc: 'Sample reading library' },
    { id: 'wizard-music', name: 'Wizard Music', url: BASE + 'music.html', icon: '♫', colors: ['#a48bfa', '#4ff0b0'], desc: 'Sample player · no audio' },
    { id: 'wizard-signal', name: 'Wizard Signal', url: BASE + 'signal.html', icon: '◎', colors: ['#4aa8f2', '#ff5ccf'], desc: 'Sample timeline' },
    { id: 'topics', name: 'Topics', url: BASE + 'topics.html', icon: '◇', colors: ['#3fe0ff', '#8f63ff'], desc: 'Sample edition' },
  ];
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.dataset.preview = 'sample';
  window.WIZ_SHELL = 'phone';

  let ls = null; try { ls = window.localStorage; ls.getItem(NS + 'probe'); } catch (e) { ls = null; }
  const get = k => { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } };
  const set = (k, v) => { try { if (ls) ls.setItem(k, v); } catch (e) {} };
  const LAYOUT_KEYS = ['wos.wins4', 'wos.strip', 'wos.idx4', 'wos.stripSeeded', 'wux.apps.v1'];

  if (ls) {
    if (get(NS + 'backup') === null) {
      const b = {}; for (const k of LAYOUT_KEYS) b[k] = get(k);
      set(NS + 'backup', JSON.stringify({ at: new Date().toISOString(), keys: b }));
    }
    set('wux.apps.v1', JSON.stringify(APPS));
    if (get(NS + 'seed') !== VERSION || params.has('preview-reset')) {
      const W = {}, strip = [{ id: 'home', wins: [], focus: null, full: false, home: true }];
      for (const a of APPS) {
        const wid = 'wp-' + a.id;
        W[wid] = { id: wid, app: 'frame', appId: a.id }; // no remembered url: every frame starts at its app's page
        strip.push({ id: 'dp-' + a.id, wins: [wid], focus: wid, full: false });
      }
      set('wos.wins4', JSON.stringify(W));
      set('wos.strip', JSON.stringify(strip));
      set('wos.idx4', '1');
      set('wos.stripSeeded', 'true');
      set(NS + 'seed', VERSION);
    }
    set('wos.coached', 'true');
    set('wos.tour.v1', 'true');
    set('wos.immTips', '3'); // Familiar shell: keep transient fullscreen coaching off the styling sample.
  }

  /* ---------- safety: read-only, no microphone ---------- */
  const refused = [];
  const note = what => { refused.push({ what, at: Date.now() }); if (refused.length > 30) refused.shift(); };
  const realFetch = window.fetch && window.fetch.bind(window);
  if (realFetch) {
    window.fetch = function (input, init) {
      const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        note('fetch:' + method);
        return Promise.reject(new TypeError('Wizard OS preview is read-only: ' + method + ' is off'));
      }
      return realFetch(input, init);
    };
  }
  try { if (navigator.sendBeacon) navigator.sendBeacon = () => { note('beacon'); return false; }; } catch (e) {}
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) md.getUserMedia = () => { note('microphone'); return Promise.reject(new DOMException('Wizard OS preview: the microphone is off', 'NotAllowedError')); };
  } catch (e) {}

  window.WosPreview = {
    version: VERSION, apps: APPS, base: BASE,
    // A deep link (?open= / ?session= / ?view=) was asked for: the preview controls leave the first view to it.
    explicit: params.has('open') || params.has('session') || params.has('view'),
    get refused() { return refused.slice(); },
    restore() {
      let b = null; try { b = JSON.parse(get(NS + 'backup') || 'null'); } catch (e) {}
      if (!b || !b.keys) return false;
      for (const [k, v] of Object.entries(b.keys)) { try { if (v === null) ls.removeItem(k); else ls.setItem(k, v); } catch (e) {} }
      for (const k of ['seed', 'backup', 'comparison']) { try { ls.removeItem(NS + k); } catch (e) {} }
      return true;
    },
  };
})();
