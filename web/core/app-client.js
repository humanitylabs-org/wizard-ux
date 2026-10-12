/* WizardApp v1: the only app-facing platform facade. Same-origin synchronous
 * connection keeps share/capture inside the originating gesture. Standalone uses
 * the same resource modules; hosted apps never own a root guard or install worker. */
(() => {
  'use strict';
  if (window.WizardApp) return;
  const ORIGIN = location.origin, VERSION = 1, overlays = [], handlers = [], themes = new Set(), updates = new Set();
  let service = null, currentTheme = null, updateAvailable = null, rootWatcher = null, guarded = false, exitUntil = 0;
  const framed = parent !== window;
  const detached = () => !service;
  const localHolds = new Map();
  const notify = (set, value) => { for (const fn of set) try { fn(value); } catch (e) { console.warn('WizardApp subscriber', e); } };
  function back() {
    const top = overlays[overlays.length - 1];
    if (top) { if (top.fn() === false) return false; top.release(); return true; }
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i];
      const can = h.canGoBack();
      if (typeof can !== 'boolean') throw new TypeError('canGoBack must return a synchronous boolean');
      if (can) { const did = h.back(); if (typeof did !== 'boolean') throw new TypeError('back must return a synchronous boolean'); return did; }
    }
    return false;
  }
  function ready(meta = {}) {
    if (framed) {
      try { service = parent.WizAppServices?.connect(window, { back, alive: () => true }) || null; } catch (_) { service = null; }
      if (service) { try { rootWatcher?.destroy(); } catch (_) {} rootWatcher = null; }
      parent.postMessage({ type: 'wizard:appearance:ready', version: VERSION, app: String(meta.name || '').slice(0, 96) }, ORIGIN);
    }
    return Promise.resolve(service ? service.ready() : { version: VERSION, hosted: false });
  }
  function register({ canGoBack, back: fn }) {
    if (typeof canGoBack !== 'function' || typeof fn !== 'function') throw new TypeError('Back needs synchronous canGoBack/back callbacks');
    const h = { canGoBack, back: fn }; handlers.push(h);
    return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
  }
  function push(fn) {
    if (typeof fn !== 'function') throw new TypeError('Back overlay needs a callback');
    const h = { fn, release() { const i = overlays.indexOf(h); if (i >= 0) overlays.splice(i, 1); } };
    overlays.push(h); return { release: h.release };
  }
  function useHistory({ isRoot } = {}) {
    if (typeof isRoot !== 'function') throw new TypeError('History adapter needs isRoot');
    const history = window.history, id = 'wh-' + Math.random().toString(36).slice(2);
    const priorPush = history.pushState, priorReplace = history.replaceState;
    let index = 0, pending = false;
    const stamp = state => ({ ...(state && typeof state === 'object' ? state : {}), __wizardApp: { version: VERSION, id, index } });
    priorReplace.call(history, stamp(history.state), '');
    const wrappedPush = function (state, title, url) {
      index++; try { return priorPush.call(history, stamp(state), title, url); } catch (e) { index--; throw e; }
    };
    const wrappedReplace = function (state, title, url) { return priorReplace.call(history, stamp(state), title, url); };
    history.pushState = wrappedPush; history.replaceState = wrappedReplace;
    const pop = e => { const mark = e.state?.__wizardApp; if (mark?.id === id) index = mark.index; else index = 0; pending = false; };
    addEventListener('popstate', pop);
    const unregister = register({ canGoBack: () => !pending && !isRoot() && index > 0,
      back: () => { if (pending || isRoot() || index <= 0) return false; pending = true; history.back(); return true; } });
    return () => { unregister(); removeEventListener('popstate', pop); if (history.pushState === wrappedPush) history.pushState = priorPush; if (history.replaceState === wrappedReplace) history.replaceState = priorReplace; };
  }
  const listen = (set, fn, value) => { if (typeof fn !== 'function') throw new TypeError('Subscriber must be a function'); set.add(fn); if (value) fn(value); return () => set.delete(fn); };
  const TOKENS = ['canvas', 'base', 'chrome', 'overlay', 'surface', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'accent', 'accent-soft', 'on-accent', 'reader-surface'];
  function applyTheme(a) {
    if (!a || a.version !== VERSION || !Number.isSafeInteger(a.revision) || a.revision < 0 || !['window', 'immersive'].includes(a.presentation) || !['light', 'dark'].includes(a.colorScheme) || !/^[a-z0-9-]{1,40}$/.test(a.skin || '') || !a.tokens) return false;
    if (!TOKENS.every(k => typeof a.tokens[k] === 'string' && a.tokens[k].length < 96 && a.tokens[k].length > 0 && !/[;{}]|url\(/i.test(a.tokens[k]) && (!window.CSS?.supports || CSS.supports('color', a.tokens[k])))) return false;
    if (currentTheme && a.revision < currentTheme.revision) return false;
    const root = document.documentElement;
    for (const k of TOKENS) root.style.setProperty('--wz-' + k, a.tokens[k]);
    root.style.colorScheme = a.colorScheme;
    root.dataset.skin = a.skin; root.dataset.presentation = a.presentation; root.dataset.colorScheme = a.colorScheme;
    root.setAttribute('data-wz-hosted', '');
    currentTheme = Object.freeze({ ...a, tokens: Object.freeze({ ...a.tokens }) });
    notify(themes, currentTheme);
    if (!window.WizardTheme) dispatchEvent(new CustomEvent('wizard:theme', { detail: currentTheme }));
    return true;
  }
  // Compatibility with the already-vendored Appearance v1 client: one protocol, same tokens and event.
  addEventListener('wizard:theme', e => { if (window.WizardTheme && e.detail !== currentTheme) { currentTheme = e.detail; notify(themes, currentTheme); } });
  addEventListener('message', e => {
    if (!framed || e.source !== parent || e.origin !== ORIGIN || !e.data) return;
    const d = e.data;
    if (d.type === 'wizard:appearance' && applyTheme(d.appearance)) parent.postMessage({ type: 'wizard:appearance:ack', version: VERSION, revision: currentTheme.revision }, ORIGIN);
    if (d.type === 'wizard:app:update' && d.version === VERSION) { updateAvailable = d.available; notify(updates, updateAvailable); }
  });
  function hold(reason) {
    if (service) return service.update.hold(reason);
    const id = {}; localHolds.set(id, String(reason || 'Unsaved work'));
    return { release() { localHolds.delete(id); } };
  }
  async function fallbackText(data = {}) {
    if (window.WosChat?.sharePayload) return window.WosChat.sharePayload(data);
    const payload = {};
    for (const k of ['title', 'text', 'url']) if (data[k] != null && String(data[k])) payload[k] = String(data[k]);
    if (!payload.text && !payload.url) return 'unsupported';
    if (payload.url) { try { if (!/^https?:$/.test(new URL(payload.url).protocol)) return 'unsupported'; } catch (_) { return 'unsupported'; } }
    if (navigator.share) {
      try { await navigator.share(payload); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; return 'unsupported'; }
    }
    try { if (!navigator.clipboard?.writeText) return 'unsupported'; await navigator.clipboard.writeText([payload.text, payload.url].filter(Boolean).join('\n')); return 'copied'; } catch (_) { return 'unsupported'; }
  }
  async function fallbackFile(file, { title } = {}) {
    if (window.WosChat?.shareFile) return window.WosChat.shareFile(file, { title });
    try { if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], ...(title ? { title } : {}) }); return 'shared'; } } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
    return 'unsupported';
  }
  function captureModule() { if (!window.WizAppCapture) throw new Error('Load shared app-capture.js before app-client.js for standalone capture'); return window.WizAppCapture; }
  const standaloneId = () => document.documentElement.dataset.app || location.pathname.replace(/\/$/, '') || 'standalone';
  function stayBack() {
    if (back()) return;
    // Installed apps consume root. A browser tab may leave only after a second Back within two seconds.
    if (matchMedia('(display-mode: standalone)').matches || window.WizardOSNative) return;
    exitUntil = Date.now() + 2000;
    let el = document.getElementById('wizard-app-back-notice');
    if (!el) { el = document.createElement('div'); el.id = 'wizard-app-back-notice'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;background:#222;color:white;padding:12px;border-radius:8px'; document.body.appendChild(el); }
    el.textContent = 'Press back again to exit';
    try { rootWatcher?.destroy(); } catch (_) {} rootWatcher = null;
    setTimeout(() => { if (Date.now() >= exitUntil) { exitUntil = 0; el.remove(); armStandalone(); } }, 2100);
  }
  function armStandalone() {
    if (framed || !detached() || Date.now() < exitUntil) return;
    if ('CloseWatcher' in window && !rootWatcher) {
      rootWatcher = new CloseWatcher(); rootWatcher.onclose = () => { rootWatcher = null; stayBack(); setTimeout(armStandalone, 0); };
    }
    if (!guarded && navigator.userActivation?.isActive) {
      history.pushState({ ...history.state, __wizardAppGuard: true }, ''); guarded = true;
    }
  }
  if (!framed) {
    document.addEventListener('pointerdown', armStandalone, true);
    addEventListener('popstate', e => {
      if (Date.now() < exitUntil) { history.back(); return; }
      if (e.state?.__wizardApp) return; // a real app route: its router owns this step
      guarded = false; stayBack(); if (!exitUntil) { history.pushState({ ...history.state, __wizardAppGuard: true }, ''); guarded = true; }
    });
  }
  window.WizardApp = Object.freeze({ version: VERSION, get hosted() { return !!service; }, ready,
    back: Object.freeze({ register, push, useHistory }),
    theme: Object.freeze({ get: () => currentTheme || window.WizardTheme?.current || null, onChange: fn => listen(themes, fn, currentTheme || window.WizardTheme?.current) }),
    share: Object.freeze({ text: data => service ? service.share.text(data) : fallbackText(data), file: (file, opts) => service ? service.share.file(file, opts) : fallbackFile(file, opts) }),
    update: Object.freeze({ hold, onAvailable: fn => listen(updates, fn, updateAvailable || service?.update.available()) }),
    capture: Object.freeze({ start: opts => service ? service.capture.start(opts) : captureModule().start(standaloneId(), opts),
      pending: () => service ? service.capture.pending() : captureModule().pending(standaloneId()), ack: id => service ? service.capture.ack(id) : captureModule().ack(standaloneId(), id) }),
  });
  ready();
})();
