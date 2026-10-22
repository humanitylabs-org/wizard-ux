/* Shared app platform host v1. Registry + live Window/document/path are the authority.
 * No generic RPC, parent-global proxy, guessed Back, or expiring safety holds. */
(() => {
  'use strict';
  if (window.WizAppServices) return;
  const VERSION = 1, ORIGIN = location.origin, frames = new Map();
  const OPS = new Set(['ready', 'share.text', 'share.file', 'capture.pending', 'capture.ack', 'update.hold', 'update.release', 'badge.set', 'titlebar.set']);
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
  function reset(st) { if (st.tools) setTools(st, null); for (const [token, pin] of conversationPins) if (pin.st === st) conversationPins.delete(token); for (const off of st.captureOffs || []) { try { off(); } catch (_) {} } st.captureOffs?.clear(); st.holds.clear(); st.messageHolds?.clear(); st.requests?.clear(); st.client = null; st.doc = null; st.pendingBack = null; changed(); }
  function reconcile() {
    for (const st of frames.values()) {
      if (st.tools && st.frame.isConnected && !barOf(st)?.querySelector(':scope > .wtools')) paintTools(st);
      if (!st.frame.isConnected || !registered(st)) { st.detach(); continue; }
      if (st.doc && !valid(st, st.doc)) reset(st);
    }
  }
  function attach(frame, { appId, path, openThread, openContextDraft, isVisible, readingStorage } = {}) {
    if (window.WizBrowserBoundary?.enabled) return window.WizBrowserBoundary.attach(frame);
    frames.get(frame)?.detach();
    if (!frame || frame.tagName !== 'IFRAME' || !appId || !path) return () => {};
    let url; try { url = new URL(path, ORIGIN); } catch (_) { return () => {}; }
    const st = { frame, appId, url, openThread, openContextDraft, isVisible, doc: null, client: null, holds: new Map(), pendingBack: null, lastAlive: Date.now() };
    if (!registered(st)) return () => {};
    const load = () => { if (st.doc && !valid(st, st.doc)) reset(st); try { if (rootArm) frame.contentWindow.document.addEventListener('pointerdown', rootArm, true); } catch (_) {} cleanupLegacy(st).catch(() => {}); restoreReturn(st); };
    st.detach = () => { if (frames.get(frame) !== st) return; frames.delete(frame); frame.removeEventListener('load', load); reset(st); if (st.badged) setBadge(st.appId, 0); };
    frames.set(frame, st); frame.addEventListener('load', load);
    const detachReading = window.WizAppReadingPosition?.attach(frame, { appId, authorize: () => valid(st), ...(readingStorage ? { storage: readingStorage } : {}) });
    const detachServices = st.detach;
    st.detach = () => { detachReading?.(); detachServices(); queueSweep(); };
    // App scripts can run before the frame load event. Attach when mounting, not only on load.
    try { frame.contentWindow.WizardApp?.ready?.(); } catch (_) {}
    cleanupLegacy(st).catch(() => {});
    return st.detach;
  }
  // App badge: an installed app's own unread count on its desk mark / bar badge (same slot Notifications uses).
  // Keyed by the verified frame's app id, so an app can only badge itself; shell-owned counts are not writable.
  const SHELL_COUNTS = new Set(['wizard', 'notifications']);
  function setBadge(appId, n) {
    if (SHELL_COUNTS.has(appId) || String(appId).startsWith('agent:')) throw fault('Badge unavailable');
    n = Number(n); window.WizCore?.workspaceNav?.setCount(appId, Number.isFinite(n) ? Math.min(999, Math.max(0, Math.floor(n))) : 0);
  }
  /* Title-bar tools: a hosted app may put a few controls (older/newer, a picker, a same-app link) into its own
   * window bar instead of drawing a toolbar of its own, so its content keeps the screen. The shell renders them
   * from validated data (never app markup); taps go back to that verified document only. */
  const TOOL_ICONS = { prev: 'm15 5-7 7 7 7', next: 'm9 5 7 7-7 7' };
  const barOf = st => st.frame.closest('.win')?.querySelector(':scope > .wbar') || null;
  function cleanTools(st, list) {
    if (list == null) return null;
    if (!Array.isArray(list) || list.length > 6) throw fault('Use up to 6 title-bar tools');
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
    return list.map(x => {
      if (!x || !/^[a-z0-9-]{1,32}$/.test(x.id || '') || !['button', 'select', 'link'].includes(x.kind)) throw fault('Invalid title-bar tool');
      const o = { id: x.id, kind: x.kind, label: str(x.label, 60) || x.id, text: str(x.text, 16), icon: TOOL_ICONS[x.icon] ? x.icon : '', disabled: x.disabled === true };
      if (x.kind === 'select') {
        if (!Array.isArray(x.options) || x.options.length > 500) throw fault('Invalid picker options');
        o.options = x.options.map(p => ({ value: str(p?.value, 64), label: str(p?.label, 60) })); o.value = str(x.value, 64);
      }
      if (x.kind === 'link') {
        let u = null; try { u = new URL(String(x.href || ''), st.doc?.location?.href || st.url.href); } catch (_) {}
        if (!u || !within(u, st.url)) throw fault('Title-bar links stay inside the app');
        o.href = u.href;
      }
      return o;
    });
  }
  function paintTools(st) {
    const bar = barOf(st); if (!bar) return false;
    let box = bar.querySelector(':scope > .wtools');
    if (!st.tools?.length) { box?.remove(); bar.classList.remove('has-tools'); return true; }
    if (!box) {
      box = document.createElement('span'); box.className = 'wtools';
      bar.insertBefore(box, [...bar.children].find(c => c.matches('button, .wb, .wpin, .wroute-slot')) || null);
      const send = (id, value) => { try { if (valid(st, st.doc)) st.frame.contentWindow.postMessage({ type: 'wizard:app:tool', version: VERSION, id, value }, ORIGIN); } catch (_) {} };
      // Own the gesture: a tap here is never a title-bar double tap, a drag or a window action.
      for (const ev of ['pointerdown', 'dblclick']) box.addEventListener(ev, e => e.stopPropagation());
      box.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('button[data-tool]'); if (b && !b.disabled) send(b.dataset.tool); });
      box.addEventListener('change', e => { const s = e.target.closest('select[data-tool]'); if (s) send(s.dataset.tool, s.value); });
    }
    const key = JSON.stringify(st.tools); if (box.dataset.key === key) return true;
    box.dataset.key = key; box.replaceChildren();
    for (const x of st.tools) {
      let el;
      if (x.kind === 'select') {
        el = document.createElement('select'); el.className = 'wtool wtool-pick';
        for (const p of x.options) { const op = document.createElement('option'); op.value = p.value; op.textContent = p.label; el.append(op); }
        el.value = x.value;
      } else {
        el = document.createElement(x.kind === 'link' ? 'a' : 'button'); el.className = 'wtool';
        if (x.kind === 'link') { el.href = x.href; el.target = '_blank'; el.rel = 'noopener'; } else el.type = 'button';
        if (x.icon) { el.classList.add('wtool-ic'); el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TOOL_ICONS[x.icon]}"/></svg>`; }
        else el.textContent = x.text || x.label;
        if (x.disabled) { if (x.kind === 'link') el.setAttribute('aria-disabled', 'true'); else el.disabled = true; }
      }
      el.dataset.tool = x.id; el.dataset.wact = 'tool'; el.setAttribute('aria-label', x.label); el.title = x.label;
      box.append(el);
    }
    bar.classList.add('has-tools');
    return true;
  }
  function setTools(st, list) { st.tools = cleanTools(st, list); return paintTools(st); }
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
      if (['auto', 'command'].includes(opts?.kind)) throw fault('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata');
      const shell = window.__wos || window.__wux;
      if (shell?.voice && shell.voice !== 'idle') throw Object.assign(fault('Microphone held by Wizard voice'), { code: 'busy', appId: 'wizard-voice' });
      const h = hold('Recording');
      const resource = window.WizAppCapture;
      const release = () => { h.release(); removeEventListener('wizard-app-capture-state', onCaptureState); };
      const onCaptureState = () => { if (resource.getState?.().active === false) release(); }; // actual recorder state, never elapsed time
      addEventListener('wizard-app-capture-state', onCaptureState);
      try {
        const safe = {}; for (const key of ['kind','mime','audio','pcm','chunkMs','maxMs','maxBytes','systemAudio','meta','seqBase','offsetMs','preparedId','resumeId']) if(opts?.[key] !== undefined) safe[key]=opts[key];
        const session = await (safe.resumeId && resource.resume ? resource.resume(st.appId, safe.resumeId, safe) : resource.start(st.appId, safe));
        let finished;
        const finish = method => {
          check();
          if (!finished) finished = Promise.resolve().then(() => session[method]()).then(r => { release(); return r; }, e => { finished = null; throw e; });
          return finished;
        };
        check();
        const observe = (method, fn) => {
          check(); if (typeof fn !== 'function' || !session[method]) throw fault('Capture listener unavailable');
          const off=session[method](value=>{ if(valid(st,doc)) { try { fn(value); } catch (_) {} } });
          st.captureOffs ||= new Set(); const release=()=>{off();st.captureOffs.delete(release);};st.captureOffs.add(release);return release;
        };
        const call = (method, ...args) => { check(); if(!session[method]) throw fault('Capture method unavailable');return session[method](...args); };
        return Object.freeze({ id: session.id, onLevel: fn=>observe('onLevel',fn),
          onPcm: fn=>observe('onPcm',fn), onChunk: fn=>observe('onChunk',fn), onState: fn=>observe('onState',fn), onWarn: fn=>observe('onWarn',fn),
          getInfo: ()=>call('getInfo'), chunks: ()=>call('chunks'), setSystemAudio: on=>call('setSystemAudio',on),
          stop: () => finish('stop'), cancel: () => finish('cancel'),
          pause() { check(); if (!session.pause) return Promise.reject(fault('Capture pause unavailable')); return session.pause(); },
          resume() { check(); if (!session.resume) return Promise.reject(fault('Capture resume unavailable')); return session.resume(); } });
      } catch (e) { release(); throw e; }
    };
    source.addEventListener('pagehide', () => { if (st.doc === doc) reset(st); }, { once: true });
    return Object.freeze({ version: VERSION, appId: st.appId,
      ready() { check(); return { version: VERSION, hosted: true, appId: st.appId }; },
      badge: Object.freeze({ set(n) { check(); setBadge(st.appId, n); st.badged = true; return true; } }),
      titlebar: Object.freeze({ set(list) { check(); return setTools(st, list); },
        shown() { check(); const b = barOf(st)?.querySelector(':scope > .wtools'); return !!b && b.getClientRects().length > 0 && b.offsetHeight > 0; } }),
      view: Object.freeze({ isVisible() { check(); return !document.hidden && st.isVisible?.() === true; } }),
      nav: Object.freeze({ openContextDraft(data) {
        check();
        if (st.appId !== 'notifications' || st.isVisible?.() !== true || typeof st.openContextDraft !== 'function') throw fault('Context draft unavailable');
        if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 1000 || typeof data.message !== 'string' || data.message.length > 32000) throw fault('Invalid notification context');
        // A Reply: the composer stays empty; the item rides beside the draft and is framed as quoted, untrusted
        // reference DATA only in the message that is sent (WosChat.reply).
        return st.openContextDraft('notifications:' + data.id, { title: data.title, message: data.message });
      }, openThread(id) {
        check();
        // This bounded workflow is admitted only for the installed Manager's current document.
        if (!managerAuthorized(st) || st.isVisible?.() !== true || typeof id !== 'string' || !id || id.length > 512 || /[\s\x00-\x1f]/.test(id) || id === '__new__') throw fault('Thread navigation unavailable');
        return st.openThread?.(id) === true;
      } }),
      share: Object.freeze({ text(data) {
        check();
        if (data?.url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(data.url))) {
          try { data = { ...data, url: new URL(String(data.url), source.location.href).href }; } catch (_) { return Promise.resolve('unsupported'); }
        }
        return window.WosChat?.sharePayload(data) || Promise.resolve('unsupported');
      },
        file(file, opts) { check(); if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file))) return Promise.resolve('unsupported'); return window.WosChat?.shareFile(file, opts) || Promise.resolve('unsupported'); } }),
      theme: Object.freeze({ get() { check(); return window.WizAppearance?.get(frameOf(st)) || null; } }),
      update: Object.freeze({ hold, available() { check(); return available; } }),
      capture: Object.freeze({ start,
        prepare(opts) {
          check(); const shell=window.__wos||window.__wux;
          if(shell?.voice && shell.voice!=='idle') throw Object.assign(fault('Microphone held by Wizard voice'),{code:'busy',appId:'wizard-voice'});
          if(!window.WizAppCapture?.prepare) throw fault('Capture preparation unavailable');
          const p=window.WizAppCapture.prepare(st.appId,opts);st.captureOffs ||= new Set();
          const release=()=>{p.release();st.captureOffs.delete(release);};st.captureOffs.add(release);
          return Object.freeze({id:p.id,release});
        },
        capabilities(opts) {check();return window.WizAppCapture?.capabilities?.(opts) || {};},
        current() {check();return window.WizAppCapture?.current?.(st.appId) || null;},
        pending() { check(); if (!window.WizAppCapture) return Promise.reject(fault('Shared capture unavailable')); return window.WizAppCapture.pending(st.appId); },
        ack(id) { check(); if (!window.WizAppCapture) return Promise.reject(fault('Shared capture unavailable')); return window.WizAppCapture.ack(st.appId, id); } }),
      alive() { check(); return true; },
    });
  }
  const frameOf = st => st.frame;
  addEventListener('wizard-app-capture-state', changed);
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
      if (s && (s.hold || s.active || s.recording || s.session || s.appId || /record|start|stop|permission/.test(s.state || s.status || ''))) return true;
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
    const policy = window.WizCore.appMigrations?.[st.appId]; if (!policy || !valid(st) || st.url.origin !== ORIGIN) return [];
    const scope = new URL(policy.scope, ORIGIN), scripts = policy.scripts.map(path => new URL(path, ORIGIN));
    if (!within(scope, st.url) || scripts.some(script => !within(script, st.url)) || scope.pathname === '/') return [];
    const removed = [];
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() || []) {
      if (!valid(st)) return removed;
      const workers = [reg.active, reg.waiting, reg.installing].filter(Boolean);
      if (reg.scope !== scope.href || !workers.length || workers.some(w => !scripts.some(script => w.scriptURL === script.href))) continue;
      if (await reg.unregister()) removed.push(reg.scope);
    }
    for (const name of policy.caches) { if (!valid(st)) return removed; if (await window.caches?.delete(name)) removed.push(name); }
    return removed;
  }
  addEventListener('message', async e => {
    const d = e.data; if (!d || d.type !== 'wizard:app:request' || d.version !== VERSION || !OPS.has(d.op) || typeof d.id !== 'string' || d.id.length > 96) return;
    const st = from(e.source); if (!st || e.origin !== ORIGIN || !valid(st, st.doc)) return;
    st.requests ||= new Set(); if (st.requests.size >= 32 || st.requests.has(d.id)) return; st.requests.add(d.id);
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
      if (d.op === 'badge.set') value = svc.badge.set(d.args?.n);
      if (d.op === 'titlebar.set') value = svc.titlebar.set(d.args?.tools);
      if (d.op === 'update.release') { st.messageHolds?.get(d.args?.id)?.release(); st.messageHolds?.delete(d.args?.id); value = true; }
      reply(value);
    } catch (err) { reply(null, String(err.message || err).slice(0, 200)); }
    finally { st.requests.delete(d.id); }
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
    const installed = () => matchMedia('(display-mode: standalone)').matches || !!window.WizardOSNative || !!window.WizardNative || !!window.webkit?.messageHandlers?.wizardNative;
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
  // Only a trusted installed catalog capability admits app voice input.
  // No endpoint supplied by apps; no postMessage/global RPC. A token binds the live
  // document AND receiver at recording start. Reload/navigation requires recovery,
  // never a replacement recipient or a fallback to Chats.
  const conversationPins = new Map();
  const voiceApp = appId => apps().find(a => a.id === appId && a.kind === 'wizard' && a.url && a.receives_voice_input === true);
  const receiverOf = st => st?.client?.voiceInput || st?.client?.conversation;
  function voiceAuthorized(st, appId) {
    const app = voiceApp(appId); if (!app || !st) return false;
    try {
      const url = new URL(app.url, location.href);
      return url.origin === ORIGIN && url.href === st.url.href && valid(st, st.doc);
    } catch (_) { return false; }
  }
  function freezeTarget(value) {
    let nodes = 0, chars = 0;
    function copy(v, depth) {
      if (++nodes > 256 || depth > 8) throw fault('Voice target too complex');
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') { chars += v.length; if (chars > 8192) throw fault('Voice target too large'); return v; }
      if (!v || typeof v !== 'object' || Object.prototype.toString.call(v) !== (Array.isArray(v) ? '[object Array]' : '[object Object]')) throw fault('Voice target must be JSON');
      const out = Array.isArray(v) ? [] : {};
      for (const key of Object.keys(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fault('Invalid voice target key');
        chars += key.length; if (chars > 8192) throw fault('Voice target too large');
        out[key] = copy(v[key], depth + 1);
      }
      return Object.freeze(out);
    }
    if (!value || Array.isArray(value) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160) throw fault('Voice target needs a label');
    return copy(value, 0);
  }
  function pinConversation(frame, appId) {
    const app = voiceApp(appId); if (!app) return null;
    const st = frames.get(frame), token = 'conversation-' + crypto.randomUUID();
    const pin = { appId, token, label: String(app.name || appId).slice(0, 160), target: null };
    try {
      if (!voiceAuthorized(st, appId) || !st.doc || st.appId !== appId) throw fault('App frame unavailable');
      const receiver = receiverOf(st);
      if (typeof receiver?.snapshot !== 'function' || typeof receiver?.receive !== 'function') throw fault('Voice receiver unavailable');
      const target = receiver.snapshot();
      if (target === null) return null; // deliberate inactive view, unlike absent/broken receiver
      pin.target = freezeTarget(target);
      pin.label = pin.target.label;
      conversationPins.set(token, { st, doc: st.doc, receiver, target: pin.target });
    } catch (_) { /* Keep a sealed unavailable destination, not a null/fallback route. */ }
    return Object.freeze(pin);
  }
  async function deliverConversation(pin, message) {
    const held = conversationPins.get(pin?.token);
    const authorize = () => {
      if (!held || pin.appId !== held.st.appId || !voiceAuthorized(held.st, pin.appId) || !valid(held.st, held.doc) || receiverOf(held.st) !== held.receiver)
        throw fault('App view closed, reloaded or unavailable · recording kept; copy transcript from Recordings');
    };
    authorize();
    if (!message || !/^[A-Za-z0-9_-]{8,100}$/.test(message.request_id || '') || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 12000 || message.files?.length)
      throw fault('App voice input accepts text only, up to 12000 characters · original kept');
    const receipt = await held.receiver.receive(Object.freeze({ request_id: message.request_id, text: message.text, target: held.target }), authorize);
    // Receipt is evidence of durable admission even if focus changed during POST.
    if (receipt?.accepted !== true || receipt.request_id !== message.request_id) throw fault('App receipt uncertain · original kept');
    return { accepted: true, request_id: message.request_id };
  }
  function managerAuthorized(st) {
    if (!st || st.appId !== 'wizard-manager' || !valid(st, st.doc) || typeof st.openThread !== 'function') return false;
    const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.url);
    try { return !!app && new URL(app.url, location.href).href === st.url.href; } catch (_) { return false; }
  }
  function ownsThreadLink(source, anchor) {
    const st = from(source);
    if (!managerAuthorized(st)) return false;
    try {
      const u = new URL(anchor.href);
      return u.origin === ORIGIN && u.pathname === '/wizard-os-home/' &&
        !!anchor.dataset.wizardNativeThread && u.searchParams.get('session') === anchor.dataset.wizardNativeThread;
    } catch (_) { return false; }
  }
  /* Reload plan for the "Update ready" banner. A native meeting keeps recording through a shell reload (see
   * WizAppCapture.reloadCheck); its app's capture holds ("… recording", "… capture …") are then not a reason
   * to wait, because the app reattaches to the same meeting after load. Every other hold still blocks:
   * kind 'capture' (a recording that would stop or a save after Stop) or 'work' (unsaved app state). */
  const CAPTURE_HOLD = /record|captur/i;
  function reloadPlan() {
    reconcile();
    let cap;
    try { cap = window.WizAppCapture?.reloadCheck?.(); } catch (_) { cap = { safe: false, reason: 'capture' }; }
    if (!cap) { const s = window.WizAppCapture?.getState?.(); cap = s && (s.hold || s.active || s.recording) ? { safe: false, reason: 'capture' } : { safe: true, keeps: null }; }
    const keeps = cap.safe ? cap.keeps || null : null, blocking = [];
    if (!cap.safe) blocking.push({ appId: null, kind: 'capture', reason: cap.reason || 'capture' });
    for (const st of frames.values()) for (const reason of st.holds.values()) {
      const capture = CAPTURE_HOLD.test(reason);
      if (capture && keeps && st.appId === keeps.appId) continue;
      blocking.push({ appId: st.appId, kind: capture ? 'capture' : 'work', reason });
    }
    return { ok: !blocking.length, keeps, blocking, recording: blocking.some(b => b.kind === 'capture') };
  }
  // Right before location.reload() with a kept meeting: let capture writes land, then take the kept app's
  // frames out. Its own leave guard (a beforeunload prompt meant for a standalone tab) would otherwise stop the
  // reload; removing a frame fires no beforeunload. The recorder and its journal live outside the frame.
  async function prepareReload(plan) {
    if (!plan?.keeps) return;
    try { await window.WizAppCapture?.prepareReload?.(); } catch (_) {}
    for (const st of [...frames.values()]) if (st.appId === plan.keeps.appId) {
      // Come back to the same place in the app (the meeting being recorded): frames keep only path + query.
      try { const l = st.frame.contentWindow.location; if (valid(st) && l.hash && l.hash !== '#' && l.hash !== '#/') sessionStorage.setItem(RETURN_KEY, JSON.stringify({ appId: st.appId, path: l.pathname + l.search, hash: l.hash.slice(0, 512), at: Date.now() })); } catch (_) {}
      try { st.detach(); st.frame.remove(); } catch (_) {}
    }
  }
  // Per-app update check (core/app-versions.js): attached same-origin app frames, whether each is on screen, and
  // what would be lost by reloading it. A frame with no isVisible host (single-app session) is the whole page.
  function updateFrames() {
    reconcile();
    return [...frames.values()].filter(st => valid(st)).map(st => {
      let visible = true; try { if (st.isVisible) visible = st.isVisible() === true; } catch (_) { visible = false; }
      return Object.freeze({ frame: st.frame, appId: st.appId, visible, holds: [...st.holds.values()], suspect: !!st.suspect });
    });
  }
  // One-shot, after a reload that kept a recording: put the kept app's frame back on the route it showed.
  const RETURN_KEY = 'wos.reload-return.v1';
  function restoreReturn(st) {
    let r; try { r = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); } catch (_) { r = null; }
    if (!r || r.appId !== st.appId) return;
    try {
      const w = st.frame.contentWindow, here = w.location;
      if (Date.now() - r.at > 10 * 60e3) { sessionStorage.removeItem(RETURN_KEY); return; }
      if (!valid(st) || here.href === 'about:blank' || here.pathname + here.search !== r.path) return; // not loaded yet
      sessionStorage.removeItem(RETURN_KEY);
      if (!here.hash || here.hash === '#' || here.hash === '#/') here.hash = r.hash;
    } catch (_) {}
  }
  /* Closed means closed (James, 19 Oct 2026). Each shell reports the app ids that still have a window after a
   * close; any app outside that set loses its microphone at once (its take is saved for recovery, never
   * discarded). Hidden desks, Back and frame reloads keep the window, so they never reach this. */
  function appsClosed(openIds) {
    const open = new Set([...(openIds || [])].filter(Boolean)), cap = window.WizAppCapture;
    if (!cap?.closeApp) return [];
    reconcile(); // a still-mounted frame of the app (any surface) also counts as open
    for (const f of frames.values()) if (f.frame.isConnected) open.add(f.appId);
    const st = cap.getState?.() || {}, owners = new Set();
    if (st.active && st.appId) owners.add(st.appId);
    const stopped = [];
    for (const appId of owners) if (!open.has(appId)) {
      try { stopped.push(cap.closeApp(appId).catch(() => null)); } catch (_) {}
    }
    return stopped;
  }
  // The shell registers its window model once; every frame detach (a window closing) then re-checks it.
  let openProvider = null, sweepTimer = 0;
  function trackOpenApps(fn) { openProvider = typeof fn === 'function' ? fn : null; }
  function queueSweep() {
    if (!openProvider || sweepTimer) return;
    sweepTimer = setTimeout(() => { sweepTimer = 0; try { appsClosed(openProvider()); } catch (_) {} }, 0);
  }
  window.WizAppServices = Object.freeze({ version: VERSION, attach, connect, back, guardBack, ownsThreadLink, appsClosed, trackOpenApps,
    voiceInput: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    conversation: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    update: Object.freeze({ busy, announce, available: () => available, reloadPlan, prepareReload, frames: updateFrames }),
    inspect: () => { reconcile(); return [...frames.values()].map(st => ({ appId: st.appId, path: st.url.pathname, ready: !!st.doc, holds: [...st.holds.values()], suspect: !!st.suspect })); },
  });
})();
