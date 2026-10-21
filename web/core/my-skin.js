/* My skin (Miguel, 20 Oct 2026): every owner has one personal stylesheet layered on top of whichever skin
 * they picked. It is a blank slate: empty = the picked skin exactly as its author made it.
 *
 * The file lives on the box, outside this shell image: Skins/My skin.css in the owner's Files, served by
 * the Agent Service at GET /wizard/v1/my-skin (text/css, sanitised, size-capped). Shell and skin updates
 * never touch it, and the owner's agent edits it like any other file. James's and Miguel's skins keep
 * improving underneath; My skin's rules stay on top (same specificity, later in the cascade).
 *
 * CSS only, never script. Applied as one <style> at the very end of <head>, after the base skin and its
 * package stylesheet, on phone and desktop. The last good copy is cached so it paints with the first frame.
 * Safety: an unreachable service keeps the cached copy; a service without My skin (404, older box) or any
 * non-CSS answer removes it; a bad rule only drops that rule (CSS error recovery). `?myskin=off` skips the
 * layer for one load, so a sheet that hides everything can always be fixed.
 *
 * API: WosMySkin.state → { css, empty, info, off }, .refresh() → Promise, .reset() → Promise,
 *      .on(fn) (state changed), .FILE (the path inside Files). */
(function () {
  'use strict';
  const URL_CSS = '/wizard/v1/my-skin', CACHE = 'wos.myskin.v1', MAX = 64 * 1024;
  const FILE = 'Skins/My skin.css';
  const isDoc = typeof document !== 'undefined';
  let off = false;
  try { off = new URLSearchParams(location.search).get('myskin') === 'off'; } catch (_) {}
  const subs = new Set();
  const state = { css: '', empty: true, info: null, off, loaded: false };
  const emptyCss = css => !String(css || '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').trim();
  let el = null;

  function styleEl() {
    if (!isDoc) return null;
    if (!el) { el = document.createElement('style'); el.id = 'wosMySkin'; el.dataset.mySkin = ''; }
    // Always last in <head>: after core/skins.css, the skin package sheet and skin-frame.css.
    const head = document.head || document.documentElement;
    if (el.parentNode !== head || head.lastElementChild !== el) head.appendChild(el);
    return el;
  }
  function apply(css) {
    css = typeof css === 'string' && css.length <= MAX ? css : '';
    state.css = css; state.empty = emptyCss(css);
    if (!isDoc) return;
    if (off || state.empty) { if (el) { el.textContent = ''; el.remove(); } }
    else { const s = styleEl(); if (s.textContent !== css) s.textContent = css; }
    if (document.documentElement) document.documentElement.toggleAttribute('data-my-skin', !off && !state.empty);
  }
  const emit = () => { for (const fn of [...subs]) { try { fn(state); } catch (_) {} } };
  const cache = css => { try { if (css && !emptyCss(css)) localStorage.setItem(CACHE, css); else localStorage.removeItem(CACHE); } catch (_) {} };

  async function refresh() {
    let r;
    try { r = await fetch(URL_CSS, { cache: 'no-cache', credentials: 'same-origin' }); }
    catch (_) { state.loaded = true; emit(); return state; } // offline: keep the last good copy
    const type = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && type.startsWith('text/css')) {
      let css = '';
      try { css = await r.text(); } catch (_) { return state; }
      apply(css); cache(state.css);
    } else if (r.status !== 304) { apply(''); cache(''); } // no My skin on this box (yet): the base skin, exactly
    state.loaded = true;
    try { const j = await fetch(`${URL_CSS}?format=json`, { cache: 'no-store', credentials: 'same-origin' }); state.info = j.ok ? await j.json() : null; } catch (_) {}
    emit(); return state;
  }
  async function reset() {
    const r = await fetch(URL_CSS, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Requested-With': 'wizard' } });
    if (!r.ok) throw new Error(`My skin reset failed (${r.status})`);
    apply(''); cache('');
    return refresh();
  }

  // First paint: the cached copy, synchronously, then the box's current file.
  if (!off) { try { const c = localStorage.getItem(CACHE); if (c) apply(c); } catch (_) {} }
  const api = {
    FILE,
    get state() { return state; },
    refresh, reset,
    on(fn) { if (typeof fn === 'function') subs.add(fn); return () => subs.delete(fn); },
    _test: { apply, emptyCss },
  };
  if (typeof window !== 'undefined') {
    window.WosMySkin = api;
    if (isDoc && !off) {
      refresh();
      // Stylesheets added to <head> later (skin packages) must not land above My skin.
      document.addEventListener('DOMContentLoaded', () => { if (!state.empty && el) styleEl(); });
      // Coming back to the app picks up an edit made meanwhile (in Files or by the agent).
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
