/* Shared app platform host v1. Registry + live Window/document/path are the authority.
 * No generic RPC, parent-global proxy, guessed Back, or expiring safety holds. */
(() => {
  'use strict';
  if (window.WizAppServices) return;
  const VERSION = 1, ORIGIN = location.origin, frames = new Map();
  const OPS = new Set(['ready', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'share.receive', 'share.targets', 'share.pending', 'share.ack', 'capture.pending', 'capture.ack', 'update.hold', 'update.release', 'badge.set', 'titlebar.set', 'shell.openCompanion', 'shell.closeCompanion', 'shell.postCompanion', 'shell.focusApp']);
  let registry, available = null, serial = 0, rootArm = null;
  // Share receiving (docs/SHARE-SHEET.md): the share sheet hands its per-app ops here once, at shell load, before
  // any app frame exists; they are never on a global, so a frame reaches only its own app id's items.
  let shareOps = null;
  const claimShare = ops => { if (shareOps || !ops) return false; shareOps = ops; return true; };
  const uid = () => 'as-' + (++serial) + '-' + Math.random().toString(36).slice(2);
  const fault = message => new Error(message);
  // Apps use the box's one configured transcriber; no microphone or provider credentials cross the frame.
  async function transcribeFile(file, opts = {}) {
    if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file)) || !file.size || file.size > 25 * 1024 * 1024) throw fault('Use an audio file up to 25 MB');
    if (opts.language != null && (typeof opts.language !== 'string' || !/^[a-zA-Z-]{0,35}$/.test(opts.language))) throw fault('Invalid transcription language');
    const config = window.WizConfig;
    await config?.ready;
    if (!config?.transcribe || !config.endpoint('transcribe')) return { unavailable: true };
    try { const result = await config.transcribe(file, { language: opts.language || '', prompt: config.voicePrompt?.() || '' }); return { text: String(result.text || '').trim() }; }
    catch (e) { if (e.code === 'no_voice') return { unavailable: true }; throw e; }
  }
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
  function reset(st) { window.WizCompanionPane?.detach(st.frame); if (st.tools) setTools(st, null); for (const [token, pin] of conversationPins) if (pin.st === st) conversationPins.delete(token); for (const off of st.captureOffs || []) { try { off(); } catch (_) {} } st.captureOffs?.clear(); st.holds.clear(); st.messageHolds?.clear(); st.requests?.clear(); st.client = null; st.doc = null; st.pendingBack = null; changed(); }
  function reconcile() {
    for (const st of frames.values()) {
      if (st.tools && st.frame.isConnected && !barOf(st)?.querySelector(':scope > .wtools')) paintTools(st);
      if (!st.frame.isConnected || !registered(st)) { st.detach(); continue; }
      if (st.doc && !valid(st, st.doc)) reset(st);
    }
  }
  function attach(frame, { appId, path, openThread, openContextDraft, isVisible, back, readingStorage } = {}) {
    frames.get(frame)?.detach();
    if (!frame || frame.tagName !== 'IFRAME' || !appId || !path) return () => {};
    let url; try { url = new URL(path, ORIGIN); } catch (_) { return () => {}; }
    const st = { frame, appId, url, openThread, openContextDraft, isVisible, back, doc: null, client: null, holds: new Map(), pendingBack: null, lastAlive: Date.now() };
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
    st.doc = doc; if (client !== undefined) st.client = client; st.lastAlive = Date.now();
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
      ready() { check(); window.WizCompanionPane?.ready(st.frame); return { version: VERSION, hosted: true, appId: st.appId }; },
      shell: Object.freeze({
        openCompanion(opts = {}) {
          check();
          if (typeof opts.path !== 'string' || !opts.path || opts.path.length > 4096) throw fault('Companion needs an app path');
          const url = new URL(opts.path, source.location.href);
          if (!within(url, st.url) || url.username || url.password) throw fault('Companion must stay inside the registered app path');
          if (!window.WizCompanionPane) throw fault('Companion panes unavailable');
          return window.WizCompanionPane.open(st, { ...opts, path: url.pathname + url.search + url.hash });
        },
        closeCompanion() { check(); return window.WizCompanionPane?.close(st.frame) === true; },
        postCompanion(value) { check(); return window.WizCompanionPane?.post(st.frame, value) === true; },
        focusApp() { check(); return window.WizCompanionPane?.focusApp(st.frame) === true || window.WizOpenApp?.(st.appId) === true; },
        toast(icon, message) { check(); if (typeof icon !== 'string' || typeof message !== 'string') return false; const shell = window.__wos || window.__wux; shell?.toast?.(icon.slice(0, 20), message.slice(0, 2000), 2600); return !!shell?.toast; },
      }),
      badge: Object.freeze({ set(n) { check(); setBadge(st.appId, n); st.badged = true; return true; } }),
      titlebar: Object.freeze({ set(list) { check(); return setTools(st, list); },
        shown() { check(); const b = barOf(st)?.querySelector(':scope > .wtools'); return !!b && b.getClientRects().length > 0 && b.offsetHeight > 0; } }),
      view: Object.freeze({ isVisible() { check(); return !document.hidden && st.isVisible?.() === true; } }),
      /* Photos and videos an app shows open in Wizard's one media viewer (pinch/double-tap zoom, pan, swipe between
       * items, Save/Share, Back/Esc closes) above the app, exactly as in Chats (James, 26 Oct 2026). Only this app's
       * own origin (or its blob: URLs) is opened; relative URLs resolve against the app's document. */
      media: Object.freeze({ view(items, index = 0) {
        check();
        if (st.isVisible?.() !== true || !window.WosChat?.viewer || !Array.isArray(items)) return false;
        const base = source.location.href, clean = [], list = items.slice(0, 500), want = Math.floor(+index) || 0;
        let i = want >= list.length ? Infinity : 0; // past the end (stale index, intake cap) still clamps to the last item
        for (const [n, it] of list.entries()) {
          if (n === want) i = clean.length; // the tapped item keeps its place after unsafe entries are dropped
          let u; try { u = new URL(String(it?.url || ''), base); } catch (_) { continue; }
          const own = u.origin === location.origin && /^https?:$/.test(u.protocol);
          const blob = u.protocol === 'blob:' && u.href.startsWith('blob:' + location.origin + '/');
          if (!own && !blob) continue;
          const kind = it?.kind === 'video' ? 'video' : 'image';
          clean.push({ url: u.href, kind, name: String(it?.name || '').slice(0, 200), mime: String(it?.mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg')).slice(0, 100) });
        }
        return clean.length ? window.WosChat.viewer.open(clean, Math.max(0, Math.min(clean.length - 1, i))) === true : false;
      } }),
      nav: Object.freeze({ threadAgents: true,
      /* The app finished what the owner came for (dismissed, archived, saved, deleted): take one Back past the app's
       * own views, landing on the previous screen exactly as the shell's Back would (James, 25 Oct 2026). */
      back() { check(); if (st.isVisible?.() !== true || typeof st.back !== 'function') return false; return st.back() === true; },
      openContextDraft(data) {
        check();
        // Installed Wizard apps may attach bounded reference data to a fresh MAIN Chats draft, never send or run.
        // Identity and namespace come from the attached live frame, never from the caller's payload. The id grammar
        // matches WosChat.reply.clean's key namespace, so every admitted app can produce a valid reply key.
        if (!/^[a-z][a-z0-9-]{0,40}$/.test(st.appId) || !apps().some(a => a.id === st.appId && a.kind === 'wizard') || st.isVisible?.() !== true || typeof st.openContextDraft !== 'function') throw fault('Context draft unavailable');
        if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 1000 || typeof data.message !== 'string' || data.message.length > 32000) throw fault('Invalid app context');
        // A Reply: the composer stays empty; the item rides beside the draft and is framed as quoted, untrusted
        // reference DATA only in the message that is sent (WosChat.reply).
        return st.openContextDraft(st.appId + ':' + data.id, { title: data.title, message: data.message });
      }, openThread(id, opts) {
        check();
        // This bounded workflow is admitted only for an admitted installed app's current document (Manager, Wisdom).
        if (!hostedThreadAuthorized(st) || st.isVisible?.() !== true || typeof id !== 'string' || !id || id.length > 512 || /[\s\x00-\x1f]/.test(id) || id === '__new__') throw fault('Thread navigation unavailable');
        // Optional app item that rides beside the thread's draft: keyed to this app, quoted as data when sent.
        let reply = null;
        if (opts?.reply != null) {
          const r = opts.reply, key = String(r?.key || '');
          if (!key.startsWith(st.appId + ':')) throw fault('Reply context must be keyed to this app');
          reply = window.WosChat?.reply?.clean({ key, title: r?.title, message: r?.message });
          if (!reply) throw fault('Invalid reply context');
        }
        const agent = opts?.agent;
        if (agent != null) {
          const a = typeof agent === 'string' ? window.WosAgents?.get(agent) : null;
          if (!a || a.status !== 'running' || !window.WosAgents.isOther(agent)) throw fault('Thread agent unavailable');
        }
        return st.openThread?.(id, { ...(reply ? { reply } : {}), ...(agent ? { agent } : {}) }) === true;
      } }),
      share: Object.freeze({ text(data) {
        check();
        if (data?.url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(data.url))) {
          try { data = { ...data, url: new URL(String(data.url), source.location.href).href }; } catch (_) { return Promise.resolve('unsupported'); }
        }
        return window.WosChat?.sharePayload(data) || Promise.resolve('unsupported');
      },
        async wizard(data) {
          check();
          if (!window.WizShareWizard) return 'unsupported';
          window.WizShareWizard.valid(data);
          const h = hold('Share to Wizard');
          try { return await window.WizShareWizard.wizard(data, () => valid(st, doc)); }
          finally { h.release(); }
        },
        file(file, opts) { check(); if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file))) return Promise.resolve('unsupported'); return window.WosChat?.shareFile(file, opts) || Promise.resolve('unsupported'); },
        // Receiving (docs/SHARE-SHEET.md): this verified frame registers its own app id only; items stay pending
        // until the app acks that it placed one in its own composer.
        receive(opts) { check(); return !!shareOps?.register(st.appId, { accepts: opts?.accepts, targets: opts?.targets }); },
        targets(list) { check(); return !!shareOps?.setTargets(st.appId, list); },
        pending() { check(); return shareOps?.pending(st.appId, { owner: st, alive: () => frames.get(st.frame) === st && st.frame.isConnected && valid(st, st.doc) }) || []; },
        ack(id) { check(); return typeof id === 'string' && !!shareOps?.ack(st.appId, id); } }),
      device: Object.freeze({ legacy: Object.freeze({
        available(method) { check(); return !!window.WizAndroidRelay?.legacyAvailable(source, st.appId, method); },
        call(method, args = []) { check(); if (!window.WizAndroidRelay) throw fault('Legacy device unavailable'); return window.WizAndroidRelay.legacy(source, st.appId, method, args); },
      }), backgroundAudio: Object.freeze({request(method, params) {
        check();
        if (!window.WizBackgroundAudio) return Promise.reject(fault('Background audio unavailable'));
        return window.WizBackgroundAudio.request(source, method, params);
      }}) }),
      voice: Object.freeze({ stripAddress(text) { check(); return window.WizConfig.stripAddress(String(text || '')); }, async transcribe(file, opts) { check(); const result = await transcribeFile(file, opts); check(); return result; } }),
      theme: Object.freeze({ get() { check(); return window.WizAppearance?.get(frameOf(st)) || null; } }),
      update: Object.freeze({ hold, available() { check(); return available; } }),
      capture: Object.freeze({ start: opts => { if (st.frame.dataset?.voiceService) throw fault('Voice service has no capture authority'); return start(opts); },
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
  // A share was handed to an app that is already open: tell its verified frame to pull.
  addEventListener('wizard:share-pending', e => {
    for (const st of frames.values()) if (st.appId === e.detail?.appId && valid(st, st.doc)) {
      try { st.frame.contentWindow.postMessage({ type: 'wizard:app:share', version: VERSION }, ORIGIN); } catch (_) {}
    }
  });
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
      if (d.op.startsWith('shell.')) value = svc.shell[d.op.slice(6)](d.args);
      if (d.op === 'share.text') value = await svc.share.text(d.args);
      if (d.op === 'share.wizard') value = await svc.share.wizard(d.args);
      if (d.op === 'share.file') value = await svc.share.file(d.args?.file, d.args?.options);
      if (d.op === 'voice.transcribe') value = await svc.voice.transcribe(d.args?.file, { language: d.args?.language });
      if (d.op === 'share.receive') value = svc.share.receive(d.args);
      if (d.op === 'share.targets') value = svc.share.targets(d.args?.targets);
      if (d.op === 'share.pending') value = svc.share.pending();
      if (d.op === 'share.ack') value = svc.share.ack(d.args?.id);
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
  // Same list as chats.js HOSTED_APPS: apps whose conversations are the real Chats thread over their window.
  function hostedThreadAuthorized(st) {
    if (!st || !window.WizLauncher?.hasHostedThread(st.appId) || !valid(st, st.doc) || typeof st.openThread !== 'function') return false;
    const app = apps().find(a => a.id === st.appId && a.kind === 'wizard' && a.url);
    try { return !!app && new URL(app.url, location.href).href === st.url.href; } catch (_) { return false; }
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
    for (const f of frames.values()) if (f.frame.isConnected && !f.frame.dataset?.voiceService) open.add(f.appId);
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
  // Installed providers may opt into cold command handling with the existing
  // `provides` capability list. The app owns grammar; core only warms its page.
  const voiceFrames = new Map();
  let warmingVoice = false;
  function warmVoice() {
    if (warmingVoice || !document.createElement || !document.body) return;
    warmingVoice = true;
    try {
    const wanted = new Map(apps().filter(a => a.provides?.includes('voice-commands')).slice(0, 64).map(a => [a.id, a]));
    for (const [id, entry] of voiceFrames) if (!wanted.has(id) || wanted.get(id).url !== entry.url) { entry.detach(); entry.frame.remove(); voiceFrames.delete(id); }
    for (const [id, app] of wanted) {
      if (voiceFrames.has(id)) continue;
      let url; try { url = new URL(app.url, location.href); } catch (_) { continue; }
      if (url.origin !== location.origin) continue;
      const frame = document.createElement('iframe'); frame.className = 'appframe'; frame.hidden = true; frame.dataset.voiceService = id;
      frame.src = url.href; frame.style.display = 'none'; frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1');
      document.body.appendChild(frame);
      const detach = attach(frame, {appId:id, path:app.url});
      voiceFrames.set(id, {frame, detach, url:app.url});
    }
    } finally { warmingVoice = false; }
  }
  addEventListener('wizard:apps', warmVoice);
  addEventListener('DOMContentLoaded', warmVoice);
  setTimeout(warmVoice, 0);
  const voiceClaims = new Map();
  function voiceCommand(text, context) {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) return null;
    const meta = Object.freeze({stage:context.stage, kind:context.kind, view:Object.freeze({kind:String(context.view?.kind || ''), appId:String(context.view?.appId || '')})});
    for (const app of apps()) for (const st of frames.values()) {
      try {
        const handler = st.client?.voiceCommands;
        if (st.appId !== app.id || typeof handler?.claims !== 'function' || typeof handler?.receive !== 'function' || !valid(st, st.doc)) continue;
        if (handler.claims(text, meta) !== true || !valid(st, st.doc)) continue;
        const token = uid();
        if (voiceClaims.size >= 32) voiceClaims.delete(voiceClaims.keys().next().value);
        voiceClaims.set(token, {st, doc:st.doc, handler, text, meta});
        return {action:'app_voice', appId:st.appId, token};
      } catch (_) {} // An app's bad claim cannot swallow shell commands.
    }
    return null;
  }
  function runVoiceCommand(command, done) {
    const claim = voiceClaims.get(command.token); voiceClaims.delete(command.token);
    if (!claim || !valid(claim.st, claim.doc) || claim.st.client?.voiceCommands !== claim.handler) return false;
    try {
      Promise.resolve(claim.handler.receive(claim.text, claim.meta)).then(ok => done?.(ok === true), () => done?.(false));
      return true;
    } catch (_) { done?.(false); return false; }
  }
  window.WizAppServices = Object.freeze({ voiceCommand, runVoiceCommand, authorized: frame => { const st = frames.get(frame); return valid(st, st?.doc); }, version: VERSION, claimShare, attach, connect, back, guardBack, ownsThreadLink, appsClosed, trackOpenApps,
    voiceInput: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    conversation: Object.freeze({ pin: pinConversation, deliver: deliverConversation }),
    update: Object.freeze({ busy, announce, available: () => available, reloadPlan, prepareReload, frames: updateFrames }),
    inspect: () => { reconcile(); return [...frames.values()].map(st => ({ appId: st.appId, path: st.url.pathname, ready: !!st.doc, holds: [...st.holds.values()], suspect: !!st.suspect })); },
  });
})();
