/* My skin (Miguel, 20 Oct 2026): every owner has one personal stylesheet layered on top of whichever skin
 * they picked. It is a blank slate: empty = the picked skin exactly as its author made it.
 *
 * The folder lives on the box, outside this shell image: Skins/My skin/ in the owner's Files, served by
 * the Agent Service at GET /wizard/v1/my-skin (text/css, sanitised, size-capped). Shell and skin updates
 * never touch it, and the owner's agent edits it like any other file. James's and Miguel's skins keep
 * improving underneath; My skin's rules stay on top (same specificity, later in the cascade).
 *
 * CSS is applied as one <style> at the very end of <head>, after the base skin and its
 * package stylesheet, on phone and desktop. The last good copy is cached so it paints with the first frame.
 * Safety: an unreachable service keeps the cached copy; a service without My skin (404, older box) or any
 * non-CSS answer removes it; a bad rule only drops that rule (CSS error recovery). `?myskin=off` skips the
 * layer for one load, so a sheet that hides everything can always be fixed.
 *
 * Optional skin.js uses the package hook host, but only after a trusted Settings click approves its exact
 * SHA-256 on this device. Hash the response bytes and import those same bytes, never the URL again.
 * API: WosMySkin.state → { css, empty, info, off, script }, .refresh() → Promise, .reset() → Promise,
 *      .on(fn) (state changed), .FILE (the path inside Files). */
(function () {
  'use strict';
  const URL_CSS = '/wizard/v1/my-skin', CACHE = 'wos.myskin.v1', MAX = 64 * 1024;
  const FILE = 'Skins/My skin/skin.css', OK = 'wos.myskin.js.ok';
  const isDoc = typeof document !== 'undefined';
  let off = false;
  try { off = new URLSearchParams(location.search).get('myskin') === 'off'; } catch (_) {}
  const subs = new Set();
  const state = { css: '', empty: true, info: null, off, loaded: false };
  state.script = { exists: false, sha256: null, bytes: 0, approved: false };
  let verified = null, started = null, refreshSeq = 0;
  const approval = () => { try { return localStorage.getItem(OK); } catch (_) { return null; } };
  function stopScript() { window.WosSkinHost?.stopPersonal(); started = null; }
  function turnOff() {
    try { localStorage.removeItem(OK); } catch (_) {}
    state.script.approved = false; stopScript(); emit();
  }
  async function startScript() {
    const v = verified, host = window.WosSkinHost;
    if (off || !v || approval() !== v.sha256 || !host?.personalState.ready || started === v.sha256) return;
    started = v.sha256;
    await host.loadPersonal(v.bytes, () => !off && verified === v && approval() === v.sha256);
    emit();
  }
  function turnOn(event) {
    // No agent/API approval, synthetic clicks or stale buttons. The trusted event must hit this exact version.
    const b = event?.target?.closest?.('button[data-myskin="on"]');
    if (off || !verified || verified.sha256 !== state.script.sha256 || typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent) || !event.isTrusted || event.type !== 'click' || !b?.isConnected || b.disabled || b.dataset.myskinHash !== state.script.sha256 || !state.script.sha256) return false;
    try { localStorage.setItem(OK, state.script.sha256); } catch (_) { return false; }
    state.script.approved = true; startScript(); emit(); return true;
  }
  async function refreshScript(seq) {
    const info = state.info?.script;
    if (!info?.exists || verified?.sha256 !== info.sha256) { verified = null; stopScript(); }
    state.script = { exists: !!info?.exists, sha256: info?.sha256 || null, bytes: info?.bytes || 0, approved: false };
    if (!info?.exists || approval() !== info.sha256) { turnOff(); }
    if (!info?.exists || !/^[a-f0-9]{64}$/.test(info.sha256 || '') || info.bytes > MAX) { stopScript(); return; }
    try {
      const r = await fetch(`${URL_CSS}/script`, { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('application/javascript')) throw new Error('not a script');
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength > MAX) throw new Error('too large');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      if (seq !== refreshSeq) return;
      if (hash !== info.sha256 || hash !== r.headers.get('X-Wizard-Sha256')) throw new Error('script changed while reading');
      if (window.WosSkinHost?.scriptProblem(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) throw new Error('use the skin hook API');
      verified = verified?.sha256 === hash ? verified : { bytes, sha256: hash };
      state.script.valid = true;
      state.script.approved = approval() === hash;
      if (!state.script.approved) stopScript();
      else await startScript();
    } catch (_) { if (seq === refreshSeq) { verified = null; turnOff(); } }
  }
  const emptyCss = css => !String(css || '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').trim();
  let el = null, trial = null;
  // A transient CSS-only layer. Never write the cache, script approval or state.
  // Suppress only the real CSS sheet while trying a Store skin on the base.
  function cancelTryOn() {
    trial?.remove(); trial = null;
    if (el) el.media = '';
  }
  function tryOn(css) {
    if (!isDoc || typeof css !== 'string' || new TextEncoder().encode(css).byteLength > MAX) throw Error('Invalid trial stylesheet');
    cancelTryOn(); trial = document.createElement('style'); trial.id = 'wosSkinTryOn'; trial.textContent = css;
    if (el) el.media = 'not all';
    (document.head || document.documentElement).appendChild(trial);
    const own = trial;
    return () => { if (trial === own) cancelTryOn(); };
  }

  function styleEl() {
    if (!isDoc) return null;
    if (!el) { el = document.createElement('style'); el.id = 'wosMySkin'; el.dataset.mySkin = ''; }
    // Always last in <head>: after core/skins.css, the skin package sheet and skin-frame.css.
    const head = document.head || document.documentElement;
    if (el.parentNode !== head || head.lastElementChild !== el) head.appendChild(el);
    if (trial) { el.media = 'not all'; head.appendChild(trial); }
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
    if (off) return state;
    const seq = ++refreshSeq;
    let r;
    try { r = await fetch(URL_CSS, { cache: 'no-cache', credentials: 'same-origin' }); }
    catch (_) { state.loaded = true; emit(); return state; } // offline: keep the last good copy
    const type = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && type.startsWith('text/css')) {
      let css = '';
      try { css = await r.text(); } catch (_) { return state; }
      if (seq !== refreshSeq) return state;
      apply(css); cache(state.css);
    } else if (r.status !== 304) { apply(''); cache(''); } // no My skin on this box (yet): the base skin, exactly
    state.loaded = true;
    try {
      const j = await fetch(`${URL_CSS}?format=json`, { cache: 'no-store', credentials: 'same-origin' });
      const info = j.ok ? await j.json() : null;
      if (seq !== refreshSeq) return state;
      state.info = info; await refreshScript(seq);
    } catch (_) { verified = null; stopScript(); }
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
    refresh, reset, turnOn, turnOff, startScript, tryOn, cancelTryOn,
    on(fn) { if (typeof fn === 'function') subs.add(fn); return () => subs.delete(fn); },
    _test: { apply, emptyCss },
  };
  if (typeof window !== 'undefined') {
    window.WosMySkin = api;
    if (isDoc && !off) {
      window.addEventListener?.('storage', e => { if (e.key === OK) { stopScript(); refresh(); } });
      refresh();
      // Stylesheets added to <head> later (skin packages) must not land above My skin.
      document.addEventListener('DOMContentLoaded', () => { if (!state.empty && el) styleEl(); });
      // Coming back to the app picks up an edit made meanwhile (in Files or by the agent).
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
