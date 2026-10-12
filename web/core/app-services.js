/* Shared app platform host v1. Registry + live Window/document/path are the authority.
 * No generic RPC, parent-global proxy, guessed Back, or expiring safety holds. */
(() => {
  'use strict';
  if (window.WizAppServices) return;
  const VERSION = 1, ORIGIN = location.origin, frames = new Map();
  const OPS = new Set(['ready', 'share.text', 'share.file', 'capture.pending', 'capture.ack', 'update.hold', 'update.release']);
  let registry, available = null, serial = 0, rootArm = null;
  const uid = () => 'as-' + (++serial) + '-' + Math.random().toString(36).slice(2);
  const fault = message => new Error(message);
  function apps() { if (!registry) registry = [window.WizCore.apps('mobile'), window.WizCore.apps('desktop')]; return registry.flatMap(r => r.APPS); }
  function registered(st) {
    const a = apps().find(a => a.id === st.appId && a.kind !== 'native' && a.url);
    if (!a) return false;
    try { return new URL(a.url, ORIGIN).href === st.url.href; } catch (_) { return false; }
  }
  // A file entry grants its directory, not arbitrary adjacent paths or the origin root.
  function within(url, base) {
    if (url.origin !== base.origin) return false;
    if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) return false;
    const root = base.pathname.endsWith('/') ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
    return root !== '/' ? url.pathname.startsWith(root) : url.pathname === base.pathname;
  }
  function valid(st, doc) {
    if (!st || frames.get(st.frame) !== st || !st.frame.isConnected || !registered(st)) return false;
    try {
      const w = st.frame.contentWindow;
      return !!w && !st.frame.hasAttribute('srcdoc') && within(new URL(st.frame.src), st.url) && w.location.origin === ORIGIN && within(new URL(w.location.href), st.url) && (!doc || w.document === doc);
    } catch (_) { return false; } // off-origin resources fail closed: current path cannot be verified
  }
  function from(source) { return [...frames.values()].find(st => st.frame.contentWindow === source); }
  const changed = () => window.dispatchEvent(new CustomEvent('wizard:app-holds'));
  function reset(st) { st.holds.clear(); st.messageHolds?.clear(); st.client = null; st.doc = null; st.pendingBack = null; changed(); }
  function reconcile() {
    for (const st of frames.values()) {
      if (!st.frame.isConnected || !registered(st)) { st.detach(); continue; }
      if (st.doc && !valid(st, st.doc)) reset(st);
    }
  }
  function attach(frame, { appId, path } = {}) {
    frames.get(frame)?.detach();
    if (!frame || frame.tagName !== 'IFRAME' || !appId || !path) return () => {};
    let url; try { url = new URL(path, ORIGIN); } catch (_) { return () => {}; }
    const st = { frame, appId, url, doc: null, client: null, holds: new Map(), pendingBack: null, lastAlive: Date.now() };
    if (!registered(st)) return () => {};
    const load = () => { if (st.doc && !valid(st, st.doc)) reset(st); try { if (rootArm) frame.contentWindow.document.addEventListener('pointerdown', rootArm, true); } catch (_) {} };
    st.detach = () => { if (frames.get(frame) !== st) return; frames.delete(frame); frame.removeEventListener('load', load); reset(st); };
    frames.set(frame, st); frame.addEventListener('load', load);
    // App scripts can run before the frame load event. Attach when mounting, not only on load.
    try { frame.contentWindow.WizardApp?.ready?.(); } catch (_) {}
    cleanupLegacy(st).catch(() => {});
    return st.detach;
  }
  function connect(source, client) {
    const st = from(source); if (!valid(st)) return null;
    const doc = source.document;
    if (st.doc && st.doc !== doc) reset(st);
    st.doc = doc; st.client = client; st.lastAlive = Date.now();
    const check = () => { if (!valid(st, doc)) throw fault('App frame is no longer authorized'); st.lastAlive = Date.now(); };
    const hold = reason => {
      check(); if (st.holds.size >= 64) throw fault('Too many update holds');
      const id = uid(); st.holds.set(id, String(reason || 'Unsaved work').slice(0, 160)); changed();
      let released = false;
      return { release() { if (released) return; released = true; st.holds.delete(id); changed(); } };
    };
    // Capture holds start before permission, end only after stop/cancel settles. Lifecycle never cancels capture.
    const start = async opts => {
      check(); if (!window.WizAppCapture) throw fault('Shared capture unavailable');
      const h = hold('Recording');
      try {
        const session = await window.WizAppCapture.start(st.appId, opts);
        let finished;
        return Object.freeze({ id: session.id, onLevel(fn) { check(); return session.onLevel(fn); },
          stop() { check(); return finished ||= Promise.resolve(session.stop()).then(r => { h.release(); return r; }); },
          cancel() { check(); return finished ||= Promise.resolve(session.cancel()).then(r => { h.release(); return r; }); } });
      } catch (e) { h.release(); throw e; }
    };
    source.addEventListener('pagehide', () => { if (st.doc === doc) reset(st); }, { once: true });
    return Object.freeze({ version: VERSION, appId: st.appId,
      ready() { check(); return { version: VERSION, hosted: true, appId: st.appId }; },
      share: Object.freeze({ text(data) { check(); return window.WosChat?.sharePayload(data) || Promise.resolve('unsupported'); },
        file(file, opts) { check(); return window.WosChat?.shareFile(file, opts) || Promise.resolve('unsupported'); } }),
      theme: Object.freeze({ get() { check(); return window.WizAppearance?.get(frameOf(st)) || null; } }),
      update: Object.freeze({ hold, available() { check(); return available; } }),
      capture: Object.freeze({ start, pending() { check(); return window.WizAppCapture?.pending(st.appId) || Promise.resolve([]); },
        ack(id) { check(); if (!window.WizAppCapture) return Promise.reject(fault('Shared capture unavailable')); return window.WizAppCapture.ack(st.appId, id); } }),
      alive() { check(); return true; },
    });
  }
  const frameOf = st => st.frame;
  function back(frame) {
    const st = frames.get(frame); if (!st || !registered(st) || !frame.isConnected) return 'notReady';
    if (st.url.origin !== ORIGIN) {
      // A registered off-origin frame can only be asked to navigate, never access resources.
      if (st.pendingBack) return 'stay';
      const id = uid(); st.pendingBack = id;
      frame.contentWindow.postMessage({ type: 'wizard:app:back', version: VERSION, id }, st.url.origin);
      setTimeout(() => { if (st.pendingBack === id) st.pendingBack = null; }, 1200);
      return 'pending'; // no later shell step, including on timeout
    }
    if (!valid(st)) return 'stay';
    try {
      if (st.client && st.doc === frame.contentDocument) return st.client.back() === true ? 'handled' : 'atRoot';
      const hook = frame.contentWindow.__wizardCloseOverlay;
      if (typeof hook === 'function') return hook.call(frame.contentWindow) === true ? 'handled' : 'atRoot';
    } catch (_) { return 'stay'; }
    return 'notReady';
  }
  function busy() {
    reconcile();
    if ([...frames.values()].some(st => st.holds.size)) return true;
    try {
      const s = window.WizAppCapture?.getState?.();
      if (s && (s.active || s.recording || s.session || s.appId || /record|start|stop|permission/.test(s.state || s.status || ''))) return true;
    } catch (_) { return true; }
    return false;
  }
  function announce(detail) {
    available = detail;
    for (const st of frames.values()) if (valid(st, st.doc)) {
      try { st.frame.contentWindow.postMessage({ type: 'wizard:app:update', version: VERSION, available: detail }, ORIGIN); } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent('wizard:app-update', { detail }));
  }
  // The shell supplies reviewed exact migration entries; apps cannot ask to unregister workers or delete caches.
  async function cleanupLegacy(st) {
    const policy = window.WizCore.appMigrations?.[st.appId]; if (!policy || !registered(st) || st.url.origin !== ORIGIN) return [];
    const scope = new URL(policy.scope, ORIGIN), scripts = policy.scripts.map(path => new URL(path, ORIGIN));
    if (!within(scope, st.url) || scripts.some(script => !within(script, st.url)) || scope.pathname === '/') return [];
    const removed = [];
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() || []) {
      const workers = [reg.active, reg.waiting, reg.installing].filter(Boolean);
      if (reg.scope !== scope.href || !workers.length || workers.some(w => !scripts.some(script => w.scriptURL === script.href))) continue;
      if (await reg.unregister()) removed.push(reg.scope);
    }
    for (const name of policy.caches) if (await window.caches?.delete(name)) removed.push(name);
    return removed;
  }
  addEventListener('message', async e => {
    const d = e.data; if (!d || d.type !== 'wizard:app:request' || d.version !== VERSION || !OPS.has(d.op) || typeof d.id !== 'string' || d.id.length > 96) return;
    const st = from(e.source); if (!st || e.origin !== ORIGIN || !valid(st, st.doc)) return;
    // Bounded message transport handles serializable operations only. Session functions never cross it.
    const reply = (value, error) => { if (valid(st, st.doc)) e.source.postMessage({ type: 'wizard:app:reply', version: VERSION, id: d.id, value, error }, ORIGIN); };
    try {
      const svc = connect(e.source, st.client); let value;
      if (d.op === 'ready') value = svc.ready();
      if (d.op === 'share.text') value = await svc.share.text(d.args);
      if (d.op === 'share.file') value = await svc.share.file(d.args?.file, d.args?.options);
      if (d.op === 'capture.pending') value = await svc.capture.pending();
      if (d.op === 'capture.ack') value = await svc.capture.ack(d.args?.id);
      if (d.op === 'update.hold') { const h = svc.update.hold(d.args?.reason), id = uid(); st.messageHolds ||= new Map(); st.messageHolds.set(id, h); value = id; }
      if (d.op === 'update.release') { st.messageHolds?.get(d.args?.id)?.release(); st.messageHolds?.delete(d.args?.id); value = true; }
      reply(value);
    } catch (err) { reply(null, String(err.message || err).slice(0, 200)); }
  });
  function mount() { new MutationObserver(reconcile).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  // Liveness is diagnostic only. Never discard a hold or recorder because a clock ran out.
  setInterval(() => {
    reconcile();
    for (const st of frames.values()) if (st.doc && valid(st, st.doc)) {
      try { if (st.client?.alive?.() === true) st.lastAlive = Date.now(); } catch (_) {}
      st.suspect = Date.now() - st.lastAlive > 60000;
    }
  }, 15000);
  function guardBack(step, toast) {
    let watcher = null, armed = false, exitUntil = 0;
    const installed = () => matchMedia('(display-mode: standalone)').matches || !!window.WizardOSNative;
    function consume() {
      if (step()) return true;
      if (installed()) { toast?.('⌂', "You're home", 1400); return true; }
      if (Date.now() < exitUntil) return false;
      exitUntil = Date.now() + 2000; toast?.('⌂', 'Press back again to exit', 2000);
      try { watcher?.destroy(); } catch (_) {} watcher = null;
      setTimeout(() => { if (Date.now() >= exitUntil) { exitUntil = 0; arm(); } }, 2100);
      return true;
    }
    function arm() {
      if (Date.now() < exitUntil) return;
      if (!armed && navigator.userActivation?.isActive) { history.pushState({ ...history.state, __wizardShellGuard: true }, ''); armed = true; }
      if (!watcher && 'CloseWatcher' in window) { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; if (!consume()) history.back(); else setTimeout(arm, 0); }; }
    }
    rootArm = arm; document.addEventListener('pointerdown', arm, true);
    addEventListener('popstate', e => {
      if (e.state?.__wizardApp?.version === VERSION) return;
      armed = false;
      if (consume()) { history.pushState({ ...history.state, __wizardShellGuard: true }, ''); armed = true; }
      else history.back();
    });
  }
  window.WizAppServices = Object.freeze({ version: VERSION, attach, connect, back, guardBack,
    update: Object.freeze({ busy, announce, available: () => available }),
    inspect: () => { reconcile(); return [...frames.values()].map(st => ({ appId: st.appId, path: st.url.pathname, ready: !!st.doc, holds: [...st.holds.values()], suspect: !!st.suspect })); },
  });
})();
