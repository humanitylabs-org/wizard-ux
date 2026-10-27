/* Owner release layer (wizard-os#186): an owner's own behaviour and layout, worn on every skin.
 *
 * Skins are look only. What an owner changes about how things work or are arranged lives in their release, and the
 * box may ship it as a layer next to the release file:
 *   ../my-release.json            {name, base, changes, layer?: {css?: true, js?: true}}
 *   ../my-release/layer.css       every rule starts with html[data-mine]; loads right after core/skins.css, so a skin
 *                                 package (inserted after it) can still recolour its parts and My skin stays on top
 *   ../my-release/layer.js        ES module, `export default function (api) { … }`: the skin hook API
 *                                 (web/skins/README.md), run as a WosSkinHost.builtin on every skin
 * Both paths are fixed and same-origin: the layer is part of the box's own shell build, not an agent-editable file.
 *
 * Nothing loads unless Developer mode is confirmed on by the server and the box provides a layer. A stock box (no my-release.json, or one without `layer`) never sets
 * html[data-mine] and requests nothing else. Cached layers never bypass Developer mode; the file is re-read after
 * the shared setting is known, and a layer that went away is removed again.
 * `?mine=off` skips the layer for one load (stock behaviour on the picked skin), for comparing or for a layer that
 * breaks something.
 *
 *   WosOwnerLayer.on()     → true while html[data-mine] is set
 *   WosOwnerLayer.state    → {off, css, js, checked}
 *   WosOwnerLayer.ready    → Promise, settles once the release file has been read
 */
(function () {
  'use strict';
  if (window.WosOwnerLayer) return;
  const CACHE = 'wos.ownerLayer.v1';
  const base = document.currentScript?.src || location.href;
  const FILE = new URL('../my-release.json', base).href;
  const CSS = new URL('../my-release/layer.css', base).href;
  const JS = new URL('../my-release/layer.js', base).href;
  const root = document.documentElement;
  let off = false;
  try { off = new URLSearchParams(location.search).get('mine') === 'off'; } catch (_) {}
  const state = { off, css: false, js: false, checked: false };
  let link = null, jsStarted = false;
  const remember = v => { try { if (v) localStorage.setItem(CACHE, JSON.stringify(v)); else localStorage.removeItem(CACHE); } catch (_) {} };

  // Right after core/skins.css. This script runs first in <head>, before the parser has made that link, so a cached
  // layer waits for it (and lands at the end of <head> if it never comes) instead of sitting above every core sheet.
  const place = () => {
    const anchor = document.querySelector('link[href*="core/skins.css"]');
    if (!link || !anchor?.parentNode) return false;
    if (anchor.nextSibling !== link) anchor.parentNode.insertBefore(link, anchor.nextSibling);
    return true;
  };
  function addCss() {
    if (link) return;
    link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = CSS; link.dataset.ownerLayer = '';
    if (place()) return;
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(() => { if (place()) mo.disconnect(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', () => { mo.disconnect(); if (link && !place() && !link.parentNode) document.head.appendChild(link); }, { once: true });
    } else document.addEventListener('DOMContentLoaded', () => { if (link && !place()) document.head.appendChild(link); }, { once: true });
  }
  function startJs() {
    if (jsStarted) return;
    const go = () => {
      const H = window.WosSkinHost; if (!H || jsStarted) return !!jsStarted;
      jsStarted = true;
      import(JS).then(m => { if (typeof m?.default === 'function' && state.js) H.builtin('owner-layer', m.default, { when: 'always', label: 'My release' }); })
        .catch(e => console.warn('[owner layer] layer.js did not load', e));
      return true;
    };
    if (!go()) document.addEventListener('DOMContentLoaded', go, { once: true });
  }
  function apply(v) {
    state.css = !!v?.css; state.js = !!v?.js;
    if (off || !(state.css || state.js)) {
      delete root.dataset.mine;
      window.WosSkinHost?.removeBuiltin?.('owner-layer'); jsStarted = false;
      if (link) { link.remove(); link = null; }
      return;
    }
    root.dataset.mine = '';
    if (state.css) addCss(); else if (link) { link.remove(); link = null; }
    if (state.js) startJs(); else { window.WosSkinHost?.removeBuiltin?.('owner-layer'); jsStarted = false; }
  }
  // Fail closed until the shared server-backed Developer mode setting is known.
  // A stale release file or cached layer must never turn developer tools on.
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  async function mode(enabled) {
    if (!enabled || off) { remember(null); apply(null); state.checked = true; resolveReady(state); return; }
    try {
      const r = await fetch(FILE, { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json().catch(() => null) : null;
      // Mode may have changed while the file was in flight.
      if (!window.WosUpdates?.developer) { apply(null); return; }
      const L = d && typeof d === 'object' && d.layer && typeof d.layer === 'object' ? { css: d.layer.css === true, js: d.layer.js === true } : null;
      const v = L && (L.css || L.js) ? L : null;
      remember(v); apply(v);
    } catch (_) { apply(null); }
    finally { state.checked = true; resolveReady(state); }
  }
  window.addEventListener('wos:developer-mode', e => mode(e.detail === true));
  if (window.WosUpdates?.state) mode(window.WosUpdates.developer);
  if (off) mode(false);
  window.WosOwnerLayer = Object.freeze({ on: () => root.dataset.mine != null, get state() { return { ...state }; }, ready: ready.then(() => ({ ...state })) });
})();
