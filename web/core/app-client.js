/* WizardApp v1: the only app-facing platform facade. Same-origin synchronous
 * connection keeps share/capture inside the originating gesture. Standalone uses
 * the same resource modules; hosted apps never own a root guard or install worker. */
(() => {
  'use strict';
  // Runs before frontend scripts, including iframe refresh/recreation. The native
  // document-start hook is an additional fence, not the sole ordering guarantee.
  // Ordinary workspace/standalone clients are unchanged: the policy is session-only.
  try { if (parent !== window && parent.WizHomeScreenPolicy?.mode) parent.WizHomeScreenPolicy.installPresentationStorage(window); } catch (_) {}
  if (window.WizardApp) return;
  // Home-screen identity (manifest, apple-touch-icon, title) for an app opened directly at its own path:
  // the shared, registry-backed core/app-identity.js. Top-level documents only; it is a no-op in the shell.
  try { if (parent === window && !window.WizardAppIdentity) { const s = document.createElement('script'); s.src = '/wizard-os-home/core/app-identity.js'; (document.head || document.documentElement).appendChild(s); } } catch (_) {}
  const ORIGIN = location.origin, VERSION = 1, overlays = [], handlers = [], themes = new Set(), updates = new Set();
  let service = null, transportReady = false, currentTheme = null, updateAvailable = null, rootWatcher = null, guarded = false, exitUntil = 0, requestId = 0;
  const requests = new Map(), companionMessages = new Set(), keepCallbacks = new Map();
  let toolHandler = null, orbHandler = null;
  const guardPush = history.pushState.bind(history);
  let guardBase = null, standaloneIsRoot = null;
  let conversation = null, commandHandler = null;
  const commands = Object.freeze({ register(handler) {
    if (typeof handler?.claims !== 'function' || typeof handler?.receive !== 'function') throw new TypeError('Commands need claims and receive');
    if (commandHandler) throw new Error('Commands already registered');
    const registered = commandHandler = Object.freeze({claims:handler.claims,receive:handler.receive});
    return () => { if (commandHandler === registered) commandHandler = null; };
  } });
  const voiceInput = Object.freeze({ register(handler) {
    if (typeof handler?.snapshot !== 'function' || typeof handler?.receive !== 'function') throw new TypeError('Voice input needs snapshot and receive');
    if (conversation) throw new Error('Voice input already registered');
    conversation = Object.freeze({ snapshot: handler.snapshot, receive: handler.receive });
    const registered = conversation;
    return () => { if (conversation === registered) conversation = null; };
  } });
  const conversationClient = Object.freeze({
    get voiceCommands() { return commandHandler; },
    get voiceInput() { return conversation; },
    get conversation() { return conversation; },
    back, alive: () => true,
  });
  const framed = parent !== window;
  const detached = () => !service;
  /* Browser owner boundary (wizard-os#133): a box with the boundary on loads app frames sandboxed, so this document has
   * an opaque origin and cannot reach the shell's window. Back, appearance and field insertion then travel by
   * postMessage through core/browser-boundary-client.js; requests carry only what the shell answers there. */
  const opaque = framed && globalThis.origin === 'null';
  // Wizard ID: the phone's sheet may stay open 3 minutes. Under the boundary the shell first waits up to a minute for
  // the window to be in front (app-services.js boundaryIdentity), so the app waits for both.
  const ID_WAIT = opaque ? 255000 : 190000;
  /* Saved settings under the boundary: the browser refuses localStorage and sessionStorage to an opaque origin (any use
   * throws), so the page gets stand-ins with the same methods. localStorage is the shell's copy for this window's
   * installed app (browser-boundary.js appStorage): a new window starts with it in its frame name, read here before the
   * app's own scripts run, and every change goes back to the shell (`storage.save`). Both also live in this frame's
   * name, so a reload inside the window keeps them; sessionStorage never leaves the window. A window that started
   * without them asks once (`storage.load`) and then fires a `storage` event, so the app can read them again. Before a
   * link or form takes the window to another site the name is cleared, so that page cannot read them. */
  const boundaryStorage = opaque ? (() => {
    try { void window.localStorage; return null; } catch (_) {}
    const NAME = 'wzst1:', MAX = 512 * 1024;
    let seed = null;
    try { if (typeof window.name === 'string' && window.name.startsWith(NAME)) seed = JSON.parse(window.name.slice(NAME.length)); } catch (_) { seed = null; }
    const pairs = o => { const m = new Map(); if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (typeof o[k] === 'string') m.set(k, o[k]); return m; };
    const local = pairs(seed?.l), session = pairs(seed?.s), changed = new Set();
    let ops = [], timer = 0, cleared = false, sender = null;
    const keep = () => { try { window.name = NAME + JSON.stringify({ l: Object.fromEntries(local), s: Object.fromEntries(session) }); } catch (_) {} };
    const flush = () => { clearTimeout(timer); timer = 0; if (!ops.length || !sender) return; const batch = ops; ops = []; sender(batch); };
    const size = m => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
    function note(map, op) {
      keep();
      if (map !== local) return;
      if (op.c) { cleared = true; changed.clear(); } else changed.add(op.k);
      ops.push(op); if (!timer) timer = setTimeout(flush, 150);
    }
    function make(map) {
      const api = Object.freeze({
        get length() { return map.size; },
        key: i => { const k = [...map.keys()][Number(i) >>> 0]; return k === undefined ? null : k; },
        getItem: k => { k = String(k); return map.has(k) ? map.get(k) : null; },
        setItem: (k, v) => {
          k = String(k); v = String(v);
          const had = map.has(k), old = map.get(k); if (had && old === v) return;
          map.set(k, v);
          if (size(map) > MAX) { if (had) map.set(k, old); else map.delete(k); throw new DOMException('The app\u2019s saved settings are full.', 'QuotaExceededError'); }
          note(map, { k, v });
        },
        removeItem: k => { k = String(k); if (!map.has(k)) return; map.delete(k); note(map, { k, d: 1 }); },
        clear: () => { if (!map.size) return; map.clear(); note(map, { c: 1 }); },
      });
      const own = p => typeof p === 'string' && !(p in api) && map.has(p);
      // Named access (localStorage.foo, Object.keys(localStorage)) like the real one.
      return new Proxy(Object.create(null), {
        get: (_, p) => (p in api ? (p === 'length' ? api.length : api[p]) : own(p) ? map.get(p) : undefined),
        set: (_, p, v) => { if (typeof p === 'string' && !(p in api)) api.setItem(p, v); return true; },
        deleteProperty: (_, p) => { if (typeof p === 'string') api.removeItem(p); return true; },
        has: (_, p) => p in api || own(p),
        ownKeys: () => [...map.keys()],
        getOwnPropertyDescriptor: (_, p) => (own(p) ? { value: map.get(p), writable: true, enumerable: true, configurable: true } : undefined),
      });
    }
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: (s => () => s)(make(local)) });
      Object.defineProperty(window, 'sessionStorage', { configurable: true, enumerable: true, get: (s => () => s)(make(session)) });
    } catch (_) { return null; }
    // A link or form in the page that takes this window to another site: clear the name first, so that page cannot read
    // them (the Navigation API is off for an opaque page). The app's own scripts hold the data anyway; this covers
    // content the app shows, such as a link in a note. If that navigation is cancelled, the next change keeps them again.
    const away = (url, target) => { try { if ((!target || target === '_self') && new URL(url, location.href).origin !== location.origin) window.name = ''; } catch (_) {} };
    addEventListener('click', e => { const a = e.target?.closest?.('a[href], area[href]'); if (a && !a.hasAttribute('download')) away(a.href, a.target); }, true);
    addEventListener('submit', e => { const f = e.target; if (f?.tagName === 'FORM') away(e.submitter?.formAction || f.action, e.submitter?.formTarget || f.target); }, true);
    addEventListener('pagehide', flush);
    return {
      // The boundary client is connected: from now on changes go to the shell. A window that started without its
      // saved settings asks for them once and takes every key the page has not changed itself meanwhile.
      ready(client) {
        if (!sender) sender = batch => { try { client.request('storage.save', { ops: batch }, 10000).catch(() => {}); } catch (_) {} };
        if (seed) { flush(); return; }
        seed = {};
        client.request('storage.load', {}, 10000).then(v => {
          const store = pairs(v?.store); let any = false;
          if (!cleared) for (const [k, x] of store) if (!changed.has(k) && local.get(k) !== x) { local.set(k, x); any = true; }
          if (any) { keep(); try { dispatchEvent(new StorageEvent('storage', { key: null })); } catch (_) {} }
        }, () => {}).finally(flush);
      },
    };
  })() : null;
  let boundaryLoad = null;
  function boundaryClient() {
    if (!opaque) return Promise.resolve(null);
    if (window.WizBoundaryClient) return Promise.resolve(window.WizBoundaryClient);
    return boundaryLoad || (boundaryLoad = new Promise(resolve => {
      const s = document.createElement('script'); s.src = '/wizard-os-home/core/browser-boundary-client.js';
      s.onload = () => { const c = window.WizBoundaryClient || null; c?.connect(boundaryHooks()); resolve(c); };
      s.onerror = () => { boundaryLoad = null; resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    }));
  }
  // What the boundary client hands back to WizardApp: Back, theme, title-bar taps, and the shell's update, fresh-data
  // and share-waiting notices (the same as wizard:app:update / wizard:app:refresh / wizard:app:share same-origin).
  const boundaryHooks = () => ({ onBack: back, onTheme: applyTheme, onTool: boundaryTool, onUpdate: v => { updateAvailable = v; notify(updates, v); }, onRefresh: r => refreshNow(r), onShare: () => pullShares(),
    onCapture: d => boundaryCapture.notice(d), onReady: () => { boundaryCapture.hello(); if (boundaryStorage && window.WizBoundaryClient) boundaryStorage.ready(window.WizBoundaryClient); }, keys: () => keyList(document), press: key => keyPress(key) });
  // A title-bar tap under the boundary arrives through the boundary client, not as a wizard:app:tool message.
  function boundaryTool(d) { if (!toolHandler || typeof d?.id !== 'string') return; try { toolHandler({ id: d.id, value: typeof d.value === 'string' ? d.value : undefined }); } catch (err) { console.warn('WizardApp tool', err); } }
  const localHolds = new Map();
  const notify = (set, value) => { for (const fn of set) try { fn(value); } catch (e) { console.warn('WizardApp subscriber', e); } };
  function request(op, args, timeout = 15000, onAdmitted) {
    if (typeof opaque !== 'undefined' && opaque) return boundaryClient().then(c => c ? c.request(op, args, timeout) : Promise.reject(new Error('Shared app transport unavailable')));
    if (!framed || requests.size >= 32) return Promise.reject(new Error('Shared app transport unavailable'));
    const id = 'wa-' + (++requestId) + '-' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(id); reject(Object.assign(new Error('Shared app transport timed out'), op === 'ready.write' ? {uncertain:true} : {})); }, timeout);
      requests.set(id, { resolve, reject, timer, onAdmitted, op });
      try { parent.postMessage({ type: 'wizard:app:request', version: VERSION, id, op, args }, ORIGIN); }
      catch (e) { clearTimeout(timer); requests.delete(id); reject(e); }
    });
  }
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
  // Tapping outside a modal is Back (James, 28 Oct 2026). Capture before app/kit
  // click handlers: a drag out, or the lifting finger that opened a menu, is not a tap.
  // cancel is the native Escape path, including apps that preventDefault and close themselves.
  if (typeof MutationObserver !== 'undefined') {
    const presses = new WeakMap();
    const changed = records => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target.tagName === 'DIALOG') presses.delete(r.target);
        for (const n of r.addedNodes || []) {
          if (n.tagName === 'DIALOG') presses.delete(n);
          n.querySelectorAll?.('dialog').forEach(d => presses.delete(d));
        }
      }
    };
    const observer = new MutationObserver(changed);
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    const modal = e => {
      changed(observer.takeRecords()); // showModal + pointerdown may happen in one task
      const d = e.target.closest?.('dialog');
      return d?.open && d.matches(':modal') && !d.hasAttribute('data-wz-no-outside-close') ? d : null;
    };
    const outside = (d, e) => {
      const r = d.getBoundingClientRect();
      return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    };
    addEventListener('pointerdown', e => {
      const d = modal(e); if (d) presses.set(d, { outside: outside(d, e) });
    }, true);
    addEventListener('pointercancel', e => { const d = modal(e); if (d) presses.delete(d); }, true);
    // A real tap on a <label> makes the browser forward a second click (no pointerdown) to its control.
    const forwarded = new WeakMap();
    addEventListener('click', e => {
      const d = modal(e); if (!d || e.detail === 0) return; // keyboard/AT activation is never swallowed
      if (forwarded.get(d) === e.target) { forwarded.delete(d); return; }
      const press = presses.get(d); presses.delete(d);
      const control = press && !outside(d, e) ? e.target.closest?.('label')?.control : null;
      if (control && d.contains(control)) forwarded.set(d, control); else forwarded.delete(d);
      if (!press || outside(d, e)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (press?.outside && outside(d, e) && d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
      }
    }, true);
  }
  // Composer input (paste files/text, drop, Enter policy): the shell's one implementation, core/composer-input.js,
  // the same code Chats uses. Loaded on first use; a bind made before it lands is queued, unbind is synchronous.
  let composerLoad = null;
  function composerModule() {
    if (window.WizComposerInput) return Promise.resolve(window.WizComposerInput);
    return composerLoad || (composerLoad = new Promise(resolve => {
      const s = document.createElement('script'); s.src = '/wizard-os-home/core/composer-input.js';
      s.onload = () => resolve(window.WizComposerInput || null); s.onerror = () => { composerLoad = null; resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    }));
  }
  composerModule(); // eager: the first paste must not wait on a network fetch
  // Wizard's one attachment chip (core/attach-chip.js + .css), the same chip Chats' tray shows. Loaded eagerly;
  // until it lands node() returns a plain name + Remove chip so a fast pick never waits (James, 26 Oct 2026).
  let chipLoad = null;
  function chipModule() {
    if (window.WizAttachChip) return Promise.resolve(window.WizAttachChip);
    return chipLoad || (chipLoad = new Promise(resolve => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/wizard-os-home/core/attach-chip.css';
      (document.head || document.documentElement).appendChild(css);
      const s = document.createElement('script'); s.src = '/wizard-os-home/core/attach-chip.js';
      s.onload = () => resolve(window.WizAttachChip || null); s.onerror = () => { chipLoad = null; resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    }));
  }
  chipModule();
  function chipNode(c, opts = {}) {
    if (window.WizAttachChip) return window.WizAttachChip.node(c, opts);
    const el = document.createElement('span'); el.className = 'ch-att'; el.dataset.attkey = String(c?.key ?? '');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = String(c?.name || 'File');
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'ch-attrm'; rm.setAttribute('aria-label', 'Remove'); rm.textContent = '×';
    rm.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); opts.onRemove?.(c?.key); });
    el.append(nm, rm); return el;
  }
  function composerBind(root, opts) {
    let off = null, dead = false;
    composerModule().then(m => { if (!dead && m) off = m.bind(root, opts); });
    return () => { dead = true; if (off) { off(); off = null; } };
  }
  // Esc in an app opened on its own (not inside Wizard, which routes Esc to Back itself): close the topmost
  // overlay from anywhere; leave a nested view only when the key is not typed into a field.
  if (!framed) addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.repeat) return;
    const t = e.target, typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    if (!overlays.length && typing) return;
    let did = false; try { did = back(); } catch (_) {}
    if (did) e.preventDefault();
  });
  /* App keys (docs/ai-apps-view.md › App keys; one anchor, Miguel 4 Nov 2026): an app marks a control with
   * data-wz-key="<key>" (optional data-wz-key-label) and ⌥ + that key clicks the first live match (a field is focused as
   * well). Keys: one lower-case letter a–z or / , . ; — never Wizard's own: ⌥H ⌥W ⌥S and the voice keys ⌥D ⌥V ⌥C (the
   * digits, [ ], arrows, ` and Space are not app keys at all). Plain keys are the app's own business again. Read from
   * e.code (macOS ⌥ turns e.key letters into symbols). Framed in Wizard the shell presses them (it knows what is in
   * front and what is Wizard's), so a framed SDK never acts itself; opened on its own (a browser tab) the SDK does.
   * WizardApp.keys.list() = the live targets ({ el, key, label }), which the shell marks and presses. */
  const RESERVED_LETTERS = 'hwsdvc';
  const keyOk = k => typeof k === 'string' && /^[a-z/,.;]$/.test(k) && !RESERVED_LETTERS.includes(k);
  const KEY_PUNCT = { Slash: '/', Comma: ',', Period: '.', Semicolon: ';' };
  const keyOfCode = code => { const m = /^Key([A-Z])$/.exec(String(code || '')); const k = m ? m[1].toLowerCase() : KEY_PUNCT[code] || ''; return keyOk(k) ? k : ''; };
  const keyBox = n => typeof n.getClientRects === 'function' && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0;
  const keyLive = n => keyBox(n) && !n.closest('[hidden], [inert], [aria-hidden="true"]') && !n.disabled && n.getAttribute('aria-disabled') !== 'true';
  function keyScope(doc) {
    const open = [...doc.querySelectorAll('[aria-modal="true"], [role="dialog"]:not([hidden]), dialog[open]')].filter(m => keyBox(m) && !m.closest('[hidden], [inert]'));
    return open.length ? open[open.length - 1] : doc;   // the topmost (the last one opened sits last in the page)
  }
  function keyList(doc = document) {
    const scope = keyScope(doc), out = [];
    for (const el of scope.querySelectorAll('[data-wz-key]')) {
      const key = el.getAttribute('data-wz-key');
      if (keyOk(key) && keyLive(el)) out.push(Object.freeze({ el, key, label: String(el.getAttribute('data-wz-key-label') || el.getAttribute('aria-label') || el.title || '').slice(0, 64) }));
    }
    return out;
  }
  // ⌥ + key, nothing else held (⇧ / Ctrl / ⌘ are other keys); typing in a field is fine (⌥ types nothing we keep)
  function keyMatch(e, doc = document) {
    if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented || e.isComposing) return null;
    const name = keyOfCode(e.code); if (!name) return null;
    return keyList(doc).find(k => k.key === name) || null;
  }
  function keyPress(key) {
    const hit = keyOk(key) ? keyList(document).find(k => k.key === key) : null; if (!hit) return false;
    // a field as the target ('/' to search): it takes the typing too (a click alone never focuses a field)
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(hit.el.tagName || '') || hit.el.isContentEditable) hit.el.focus?.({ preventScroll: true });
    hit.el.click();
    return true;
  }
  if (!framed) addEventListener('keydown', e => {
    const hit = keyMatch(e); if (!hit) return;
    e.preventDefault();
    if (!e.repeat) keyPress(hit.key);   // held down: once
  });
  const keys = Object.freeze({ list: () => keyList(document), match: e => keyMatch(e)?.el || null });
  function ready(meta = {}) {
    if (framed) {
      try { service = parent.WizAppServices?.connect(window, conversationClient) || null; } catch (_) { service = null; }
      if (service) { try { rootWatcher?.destroy(); } catch (_) {} rootWatcher = null; }
      parent.postMessage({ type: 'wizard:appearance:ready', version: VERSION, app: String(meta.name || '').slice(0, 96) }, ORIGIN);
    }
    if (service) { const r = service.ready(); registerShare(); return Promise.resolve(r); }
    if (!framed) return Promise.resolve({ version: VERSION, hosted: false });
    return request('ready', null, 1500).then(result => {
      transportReady = result?.version === VERSION && result.hosted === true;
      if (transportReady) registerShare();
      return transportReady ? result : { version: VERSION, hosted: false };
    }, () => { transportReady = false; return { version: VERSION, hosted: false }; });
  }
  /* Receiving shares from Wizard's share sheet (docs/SHARE-SHEET.md). Hosted apps only: the shell keeps each item
   * pending until receive() returns true (the item is visibly placed, e.g. in the app's composer), then it is acked. */
  let shareRecv = null, sharePull = null; const SHARE_BATCH = 32;
  function shareOp(op, args) {
    if (service) return Promise.resolve().then(() => op === 'receive' ? service.share.receive(args) : op === 'targets' ? service.share.targets(args.targets) : op === 'pending' ? service.share.pending() : service.share.ack(args.id));
    if (transportReady) return request('share.' + op, args);
    return Promise.reject(new Error('Receiving shares needs the Wizard host'));
  }
  function pullShares() {
    if (!shareRecv) return Promise.resolve(0);
    if (sharePull) { sharePull.again = true; return sharePull.done; }
    const run = sharePull = { again: false };
    run.done = (async () => {
      let n = 0; const offered = new Set();
      try {
        do {
          run.again = false;
          const items = await shareOp('pending').catch(() => []);
          let fresh = 0;
          for (const it of Array.isArray(items) ? items : []) {
            if (!shareRecv) break;
            if (offered.has(it?.id)) continue; // refused once in this pull: not offered again
            offered.add(it?.id); fresh++;
            let ok = false;
            try { ok = (await shareRecv.receive(Object.freeze({ ...it }))) === true; } catch (e) { console.warn('WizardApp share receive', e); }
            if (ok) { await shareOp('ack', { id: it.id }).catch(() => {}); n++; }
          }
          // A full batch (the browser boundary hands at most SHARE_BATCH items at a time): pull the rest too.
          if (Array.isArray(items) && items.length >= SHARE_BATCH && fresh) run.again = true;
        } while (run.again && shareRecv);
      } finally { sharePull = null; }
      return n;
    })();
    return run.done;
  }
  function registerShare() {
    if (!shareRecv || (!service && !transportReady)) return Promise.resolve(false);
    return shareOp('receive', { accepts: shareRecv.accepts, targets: shareRecv.targets }).then(ok => { if (ok) pullShares(); return ok === true; }, () => false);
  }
  function receiveShares({ accepts, targets, receive } = {}) {
    if (typeof receive !== 'function') throw new TypeError('Share receiver needs receive(item)');
    shareRecv = { accepts: Array.isArray(accepts) ? accepts.slice(0, 8) : [], targets: Array.isArray(targets) ? targets.slice(0, 24) : undefined, receive };
    registerShare();
    const mine = shareRecv;
    return () => { if (shareRecv !== mine) return; shareRecv = null; shareOp('receive', { accepts: [] }).catch(() => {}); };
  }
  function shareTargets(list) { if (shareRecv && Array.isArray(list)) shareRecv.targets = list.slice(0, 24); return shareRecv && Array.isArray(list) ? shareOp('targets', { targets: list.slice(0, 24) }).then(v => v === true, () => false) : Promise.resolve(false); }
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
    const stamp = state => { const next = { ...(state && typeof state === 'object' ? state : {}), __wizardApp: { version: VERSION, id, index } }; delete next.__wizardAppGuard; return next; };
    if (!framed) standaloneIsRoot = isRoot;
    priorReplace.call(history, stamp(history.state), '');
    const wrappedPush = function (state, title, url) {
      index++; try { return priorPush.call(history, stamp(state), title, url); } catch (e) { index--; throw e; }
    };
    const wrappedReplace = function (state, title, url) { return priorReplace.call(history, stamp(state), title, url); };
    history.pushState = wrappedPush; history.replaceState = wrappedReplace;
    const pop = e => { const mark = e.state?.__wizardApp; if (mark?.id === id) index = mark.index; else index = 0; pending = false; };
    addEventListener('popstate', pop);
    // A traversal already admitted by this adapter still owns Back until its
    // popstate arrives. Reporting root while it is pending lets a rapid second
    // hardware callback collapse fullscreen or send the shell Home.
    const unregister = register({ canGoBack: () => pending || (!isRoot() && index > 0),
      back: () => { if (pending) return true; if (isRoot() || index <= 0) return false; pending = true; history.back(); return true; } });
    return () => { unregister(); removeEventListener('popstate', pop); if (history.pushState === wrappedPush) history.pushState = priorPush; if (history.replaceState === wrappedReplace) history.replaceState = priorReplace; if (standaloneIsRoot === isRoot) standaloneIsRoot = null; };
  }
  const listen = (set, fn, value) => { if (typeof fn !== 'function') throw new TypeError('Subscriber must be a function'); set.add(fn); if (value) fn(value); return () => set.delete(fn); };
  const TOKENS = ['canvas', 'base', 'chrome', 'overlay', 'surface', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'accent', 'accent-soft', 'on-accent', 'reader-surface'];
  /* Shared kit + skin layer (James, 23 Oct 2026). A hosted app that uses the Wizard UI kit gets the shell's live copy
   * (/wizard-os-home/kit/wizard-ui.css) instead of its vendored snapshot, and every themed app gets the active skin's
   * stylesheets (core/skins.css, loaded skin package css, then My skin) after its own styles, so a skin can restyle
   * .wz-* components. Mirrored on every appearance push, so a skin change follows live. A same-origin app reads the
   * layer from its parent; a sandboxed one (browser boundary, wizard-os#133) gets it with the theme, as same-origin
   * stylesheet paths plus My skin's CSS, because it cannot read the shell. */
  const KIT = '/wizard-os-home/kit/wizard-ui.css', KIT_TOKENS = '/wizard-os-home/kit/wizard-tokens.css';
  function skinSource(layer) {
    if (typeof opaque !== 'undefined' && opaque) {
      if (!layer || typeof layer !== 'object' || !Array.isArray(layer.sheets)) return null;
      const want = [];
      for (const p of layer.sheets.slice(0, 24)) {
        if (typeof p !== 'string' || p.length > 512 || !p.startsWith('/')) continue;
        let u; try { u = new URL(p, location.origin); } catch (_) { continue; }
        if (u.origin === location.origin && /\.css$/.test(u.pathname) && !want.includes(u.href)) want.push(u.href);
      }
      return { want, css: typeof layer.mine === 'string' && layer.mine.length <= 65536 ? layer.mine : '' };
    }
    let pd = null; try { pd = parent.document; } catch (_) { return null; }
    if (!pd) return null;
    const want = [...pd.querySelectorAll('link[rel="stylesheet"]')].filter(l => /(^|\/)core\/skins\.css(\?|$)/.test(l.getAttribute('href') || '') || l.dataset.skinPkg).filter(l => !l.disabled).map(l => l.href);
    const mine = pd.getElementById('wosMySkin'), css = mine && !mine.disabled ? String(mine.textContent || '') : '';
    return { want, css };
  }
  function syncSkinLayer(layer) {
    const src = skinSource(layer), head = document.head; if (!src || !head) return false;
    const { want, css } = src;
    const vendored = [...head.querySelectorAll('link[rel="stylesheet"]')].find(l => /(^|\/)wizard-ui\.css(\?|$)/.test(l.getAttribute('href') || '') && l.dataset.wzShared !== 'kit');
    if (vendored && !head.querySelector('link[data-wz-shared="kit"]')) {
      // Tokens travel with the kit: older vendored kits carried their own fallbacks and no tokens file.
      const mk = (href, kind) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(href, location.origin).href; l.dataset.wzShared = kind; return l; };
      const t = mk(KIT_TOKENS, 'tokens'), k = mk(KIT, 'kit');
      let ready = 0; const done = () => { if (++ready === 2) vendored.disabled = true; };
      t.addEventListener('load', done, { once: true }); k.addEventListener('load', done, { once: true });
      vendored.after(t, k);
    }
    const have = new Map([...head.querySelectorAll('link[data-wz-skin-layer]')].map(l => [l.href, l]));
    for (const [href, l] of have) if (!want.includes(href)) l.remove();
    for (const href of want) if (!have.has(href)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.wzSkinLayer = ''; head.appendChild(l); }
    let s = head.querySelector('style[data-wz-my-skin]');
    if (css) { if (!s) { s = document.createElement('style'); s.dataset.wzMySkin = ''; } s.textContent = css; head.appendChild(s); }
    else if (s) s.remove();
    return true;
  }
  function applyTheme(a, layer) {
    if (!a || a.version !== VERSION || !Number.isSafeInteger(a.revision) || a.revision < 0 || !['window', 'immersive'].includes(a.presentation) || !['light', 'dark'].includes(a.colorScheme) || !/^[a-z0-9-]{1,40}$/.test(a.skin || '') || !a.tokens) return false;
    if (!TOKENS.every(k => typeof a.tokens[k] === 'string' && a.tokens[k].length < 96 && a.tokens[k].length > 0 && !/[;{}]|url\(/i.test(a.tokens[k]) && (!window.CSS?.supports || CSS.supports('color', a.tokens[k])))) return false;
    if (currentTheme && a.revision < currentTheme.revision) return false;
    if (currentTheme && a.revision === currentTheme.revision && JSON.stringify(a) === JSON.stringify(currentTheme)) return true;
    const root = document.documentElement;
    for (const k of TOKENS) root.style.setProperty('--wz-' + k, a.tokens[k]);
    root.style.colorScheme = a.colorScheme;
    root.dataset.skin = a.skin; root.dataset.presentation = a.presentation; root.dataset.colorScheme = a.colorScheme;
    root.setAttribute('data-wz-hosted', '');
    if (framed) { try { syncSkinLayer(layer); } catch (e) { console.warn('WizardApp skin layer', e); } }
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
    if (d.type === 'wizard:app:keep' && d.version === VERSION && typeof d.id === 'string') {
      Promise.resolve().then(() => keepCallbacks.get(d.keepId)?.()).then(result => parent.postMessage({type: 'wizard:app:kept', version: VERSION, id: d.id, result: result === 'kept' ? 'kept' : false}, ORIGIN), () => parent.postMessage({type: 'wizard:app:kept', version: VERSION, id: d.id, result: false}, ORIGIN));
    }
    if (d.type === 'wizard:app:companion' && d.version === VERSION) notify(companionMessages, { from: d.from, data: d.data });
    if (d.type === 'wizard:app:admitted' && d.version === VERSION && requests.has(d.id) && e instanceof MessageEvent && e.isTrusted) {
      const pending = requests.get(d.id), fn = pending.onAdmitted; pending.onAdmitted = null;
      try { fn?.(); } catch (_) {}
    }
    if (d.type === 'wizard:app:reply' && d.version === VERSION && requests.has(d.id)) {
      if (requests.get(d.id).op === 'ready.write' && (!(e instanceof MessageEvent) || !e.isTrusted)) return;
      const pending = requests.get(d.id); clearTimeout(pending.timer); requests.delete(d.id);
      if (d.error) {
        const error = new Error(String(d.error));
        if (pending.op === 'ready.write' && d.details && typeof d.details === 'object') for (const [key,value] of Object.entries(d.details)) if (!['__proto__','prototype','constructor'].includes(key)) error[key] = value;
        pending.reject(error);
      } else pending.resolve(d.value);
    }
    if (d.type === 'wizard:appearance' && applyTheme(d.appearance)) parent.postMessage({ type: 'wizard:appearance:ack', version: VERSION, revision: currentTheme.revision }, ORIGIN);
    if (d.type === 'wizard:app:orb' && d.version === VERSION && orbHandler) { try { orbHandler(); } catch (err) { console.warn('WizardApp orb', err); } }
    if (d.type === 'wizard:app:tool' && d.version === VERSION && toolHandler && typeof d.id === 'string') { try { toolHandler({ id: d.id, value: typeof d.value === 'string' ? d.value : undefined }); } catch (err) { console.warn('WizardApp tool', err); } }
    if (d.type === 'wizard:app:update' && d.version === VERSION) { updateAvailable = d.available; notify(updates, updateAvailable); }
    if (d.type === 'wizard:app:share' && d.version === VERSION) pullShares();
    if (d.type === 'wizard:app:refresh' && d.version === VERSION) refreshNow(d.reason);
  });
  /* Fresh data (issue 1243): the shell asks a hosted app to read its data again when its window comes back into view or
   * to the front, about once a minute while in view, and after an agent tool for this app finishes. An app that
   * registered view.onRefresh gets {reason}; any other app gets the usual web signal it already reads on return, a
   * visibilitychange while visible, so existing `if (!document.hidden) load()` handlers refresh with no app change. */
  const refreshers = new Set();
  function refreshNow(reason) {
    if (document.hidden) return;
    const r = Object.freeze({ reason: ['visible', 'focus', 'poll', 'agent'].includes(reason) ? reason : 'poll' });
    if (refreshers.size) notify(refreshers, r);
    else { try { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); } catch (e) { console.warn('WizardApp refresh', e); } }
  }
  globalThis.document?.addEventListener?.('visibilitychange', e => { if (e.isTrusted && !document.hidden && refreshers.size) notify(refreshers, Object.freeze({ reason: 'visible' })); });
  function onRefresh(fn) {
    if (typeof fn !== 'function') throw new TypeError('onRefresh needs a function');
    refreshers.add(fn); return () => { refreshers.delete(fn); };
  }
  function hold(reason, options = {}) {
    if (service) return service.update.hold(reason, options);
    if (transportReady) {
      const keepId = typeof options.keep === 'function' ? 'keep-' + (++requestId) : null;
      if (keepId) keepCallbacks.set(keepId, options.keep);
      const pending = request('update.hold', { reason, keepId }); let released = false;
      pending.catch(() => {});
      return { release() { if (released) return; released = true; keepCallbacks.delete(keepId); pending.then(id => request('update.release', { id })).catch(() => {}); } };
    }
    const id = {}; localHolds.set(id, String(reason || 'Unsaved work'));
    return { release() { localHolds.delete(id); } };
  }
  async function nativeReceipt(invoke) {
    let timer;
    try {
      let result = await Promise.race([Promise.resolve(invoke()), new Promise(resolve => { timer = setTimeout(() => resolve('unsupported'), 15000); })]);
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) {} }
      const outcome = result && typeof result === 'object' ? result.status || result.outcome : result;
      return ['shared', 'copied', 'cancelled', 'unsupported'].includes(outcome) ? outcome : 'unsupported';
    } catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'unsupported'; }
    finally { clearTimeout(timer); }
  }
  async function fallbackText(data = {}) {
    if (window.WosChat?.sharePayload) return window.WosChat.sharePayload(data);
    const payload = {};
    for (const k of ['title', 'text', 'url']) if (data[k] != null && String(data[k])) payload[k] = String(data[k]);
    if (!payload.text && !payload.url) return 'unsupported';
    if ((payload.text || '').length > 90000 || (payload.title || '').length > 1024 || (payload.url || '').length > 8192) return 'unsupported';
    if (payload.url) { try { const parsed = new URL(payload.url, location.href); if (!/^https?:$/.test(parsed.protocol)) return 'unsupported'; if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(payload.url)) payload.url = parsed.href; } catch (_) { return 'unsupported'; } }
    const native = window.WizardOSNative;
    if (!framed && typeof native?.shareText === 'function') return nativeReceipt(() => native.shareText([payload.text, payload.url].filter(Boolean).join('\n'), payload.title || ''));
    if (navigator.share) {
      try { await navigator.share(payload); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; return 'unsupported'; }
    }
    try { if (!navigator.clipboard?.writeText) return 'unsupported'; await navigator.clipboard.writeText([payload.text, payload.url].filter(Boolean).join('\n')); return 'copied'; } catch (_) { return 'unsupported'; }
  }
  async function fallbackFile(file, { title } = {}) {
    if (window.WosChat?.shareFile) return window.WosChat.shareFile(file, { title });
    if (!file || !['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(file)) || file.size > 32 * 1024 * 1024) return 'unsupported';
    const native = window.WizardOSNative;
    if (!framed && typeof native?.shareFile === 'function') {
      let bytes;
      try { bytes = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); }); } catch (_) { return 'unsupported'; }
      return nativeReceipt(() => native.shareFile(bytes, file.name || 'wizard-file', file.type));
    }
    try { if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], ...(title ? { title } : {}) }); return 'shared'; } } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
    return 'unsupported';
  }
  /* Recording under the browser owner boundary (wizard-os#133): the shell's one recorder (core/app-capture.js) records
   * for this window's app, as for a same-origin app, and its sessions come over the boundary channel. The API stays the
   * same: current(), capabilities() and getInfo() answer from what the shell last sent (on every channel and with the
   * session's events), prepare() answers at once and asks the shell in the background (call it in the tap, as before),
   * and a new start() needs that tap (or a recording prepared on it in the last minute). */
  const boundaryCapture = (() => {
    const caps = { value: null }, sessions = new Map(), prepared = new Map();
    let current = null, synced = null, serialPrep = 0;
    const KEYS = ['kind', 'mime', 'audio', 'pcm', 'chunkMs', 'maxMs', 'maxBytes', 'systemAudio', 'meta', 'seqBase', 'offsetMs', 'preparedId', 'resumeId'];
    const value = v => v?.capture;
    const ask = (method, args, timeout = 60000) => request(method, args, timeout).then(value);
    function opts(o) {
      if (['auto', 'command'].includes(o?.kind)) throw new Error('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata');
      const out = {}; if (o && typeof o === 'object') for (const k of KEYS) if (o[k] !== undefined && typeof o[k] !== 'function') out[k] = o[k];
      return out;
    }
    // Hold to record on a touch screen: the browser counts a touch as a tap only when the finger lifts. A start while a
    // finger is down is sent as `press`; the shell then records at once but holds the take back until the finger lifts
    // (a real tap here confirms it, `capture.confirm`). See app-services.js boundaryCapture.
    let pressing = 0, starting = 0;
    const confirmHeld = () => {
      for (const [id, s] of sessions) if (s.held) ask('capture.confirm', { id }, 15000).then(v => { if (v === true) s.held = false; }, () => {});
      if (starting) ask('capture.confirm', {}, 15000).catch(() => {}); // the shell keeps this lift for the start on its way
    };
    if (typeof opaque !== 'undefined' && opaque) {
      addEventListener('pointerdown', e => { if (e.isPrimary && e.pointerType !== 'mouse') pressing = performance.now(); }, true);
      const lift = e => { if (e.pointerType === 'mouse') return; pressing = 0; confirmHeld(); };
      addEventListener('pointerup', lift, true); addEventListener('touchend', lift, true);
      addEventListener('pointercancel', e => { if (e.pointerType !== 'mouse') pressing = 0; }, true);
    }
    function sync() { return synced = ask('capture.sync', {}, 15000).then(c => { if (c) { current = c.current || null; caps.value = c.caps || null; } }, () => {}); }
    function session(id, info) {
      const s = sessions.get(id) || { listeners: { level: new Set(), pcm: new Set(), chunk: new Set(), state: new Set(), warn: new Set() } };
      if (info) { s.info = info; s.at = Date.now(); }
      sessions.set(id, s);
      const on = key => fn => { if (typeof fn !== 'function') throw new TypeError('A capture listener is required'); s.listeners[key].add(fn); return () => s.listeners[key].delete(fn); };
      const call = (method, args, timeout) => ask('capture.call', { id, method, args }, timeout);
      const finish = method => () => call(method, undefined, 180000).then(r => { sessions.delete(id); return r; });
      return Object.freeze({ id, reattached: () => false,
        // The shell's last info; a running recording's length keeps counting between its updates.
        getInfo() {
          const i = s.info ? JSON.parse(JSON.stringify(s.info)) : {};
          if (i.phase === 'recording' && !i.paused && typeof i.durationMs === 'number') i.durationMs += Math.min(Date.now() - s.at, 1500);
          return i;
        },
        onLevel: on('level'), onPcm: on('pcm'), onChunk: on('chunk'), onState: on('state'), onWarn: on('warn'),
        chunks: () => call('chunks').then(v => (Array.isArray(v) ? v : [])), setSystemAudio: v => call('setSystemAudio', { on: !!v }),
        pause: () => call('pause'), resume: () => call('resume'), stop: finish('stop'), cancel: finish('cancel') });
    }
    const opened = c => (c?.id ? session(c.id, c.info) : null);
    return {
      notice(d) {
        if (d.event === 'current') { current = d.value || null; return; }
        const s = sessions.get(d.id); if (!s) return;
        if (d.info) { s.info = d.info; s.at = Date.now(); }
        for (const fn of [...(s.listeners[d.event] || [])]) { try { fn(d.value); } catch (e) { console.warn('WizardApp capture listener', e); } }
      },
      // A new channel: read the recorder again; a session this document still follows is attached again on it.
      hello() { sync(); if (sessions.size) ask('capture.start', { attach: true }, 60000).then(c => { if (c?.id && !sessions.has(c.id)) sessions.clear(); if (c?.id) session(c.id, c.info); }, () => {}); },
      current: () => (current ? JSON.parse(JSON.stringify(current)) : null),
      capabilities: o => { const v = caps.value?.[(o?.kind === 'meeting' ? 'meeting' : 'audio') + (o?.pcm === true ? '-pcm' : '')]; return v ? { ...v } : {}; },
      prepare(o) {
        const local = 'prepared-' + (++serialPrep) + '-' + Math.random().toString(36).slice(2), p = ask('capture.prepare', { opts: opts(o) }, 15000).then(c => c?.id || null, () => null);
        prepared.set(local, p);
        return Object.freeze({ id: local, release() { if (!prepared.delete(local)) return; p.then(id => { if (id) ask('capture.release', { id }).catch(() => {}); }); } });
      },
      async start(o) {
        const args = opts(o);
        if (args.preparedId !== undefined) { const p = prepared.get(args.preparedId); prepared.delete(args.preparedId); const id = p ? await p : null; if (id) args.preparedId = id; else delete args.preparedId; }
        const press = pressing;
        if (press) starting++;
        let c; try { c = await ask('capture.start', { opts: args, ...(press ? { press: true } : {}) }, 180000); } finally { if (press) starting--; }
        const s = opened(c);
        if (s && c.held === true) { sessions.get(s.id).held = true; if (pressing !== press) confirmHeld(); } // lifted meanwhile
        return s;
      },
      attach: async () => { await synced; return opened(await ask('capture.start', { attach: true }, 180000)); },
      settle: async keepId => { await synced; const v = await ask('capture.settle', { keepId: typeof keepId === 'string' ? keepId : null }, 120000); await sync(); return Array.isArray(v) ? v : []; },
      pending: async () => { await synced; const v = await ask('capture.pending', {}, 60000); return Array.isArray(v) ? v : []; },
      ack: async id => { await ask('capture.ack', { id }, 60000); },
    };
  })();
  function captureModule() { if (!window.WizAppCapture) throw new Error('Load shared app-capture.js before app-client.js for standalone capture'); return window.WizAppCapture; }
  // A fallback owner is generated, not a raw pathname (capture IDs cannot contain
  // slashes). Capture it once so ordinary in-app route changes do not change owner.
  const standaloneOwner = (() => {
    const root = location.pathname.split('/').filter(Boolean)[0] || 'root';
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(root)) return 'standalone-' + root;
    let hash = 2166136261; for (const c of root) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
    return 'standalone-' + hash.toString(36);
  })();
  const standaloneId = () => document.documentElement.dataset.app || standaloneOwner;
  function stayBack() {
    if (back()) return;
    // Installed apps consume root. A browser tab may leave only after a second Back within two seconds.
    if (matchMedia('(display-mode: standalone)').matches || window.WizardOSNative || window.WizardNative || window.webkit?.messageHandlers?.wizardNative) return;
    exitUntil = Date.now() + 2000;
    let el = document.getElementById('wizard-app-back-notice');
    if (!el) { el = document.createElement('div'); el.id = 'wizard-app-back-notice'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;background:#222;color:white;padding:12px;border-radius:8px'; document.body.appendChild(el); }
    el.textContent = 'Press back again to exit';
    try { rootWatcher?.destroy(); } catch (_) {} rootWatcher = null;
    setTimeout(() => { if (Date.now() >= exitUntil) { exitUntil = 0; el.remove(); armStandalone(); } }, 2100);
  }
  function pushStandaloneGuard() {
    // A guard protects the current domain entry; it is not another app route.
    guardBase = history.state?.__wizardApp || null;
    guardPush({ ...history.state, __wizardAppGuard: true }, ''); guarded = true;
  }
  function armStandalone() {
    if (framed || !detached() || Date.now() < exitUntil) return;
    if ('CloseWatcher' in window && !rootWatcher) {
      rootWatcher = new CloseWatcher(); rootWatcher.onclose = () => { rootWatcher = null; stayBack(); setTimeout(armStandalone, 0); };
    }
    if (!guarded && navigator.userActivation?.isActive) {
      pushStandaloneGuard();
    }
  }
  if (!framed) {
    document.addEventListener('pointerdown', armStandalone, true);
    addEventListener('popstate', e => {
      if (Date.now() < exitUntil) { history.back(); return; }
      guarded = !!e.state?.__wizardAppGuard;
      const mark = e.state?.__wizardApp;
      const rootGuard = !guarded && mark && guardBase && mark.id === guardBase.id && mark.index === guardBase.index && standaloneIsRoot?.();
      if (mark && !rootGuard) {
        // Let the router finish its one domain step, then protect a newly reached
        // root even when the next Back comes without another pointer gesture.
        setTimeout(() => { if (!guarded && !exitUntil && detached() && standaloneIsRoot?.()) pushStandaloneGuard(); }, 0);
        return;
      }
      stayBack(); if (!exitUntil) pushStandaloneGuard();
    });
  }
  function shellOp(op, args) {
    if (service?.shell) return Promise.resolve().then(() => service.shell[op](args));
    if (transportReady) return request('shell.' + op, args);
    return Promise.reject(new Error('Companion panes need the Wizard workspace host'));
  }
  const sharedResult = promise => promise.then(value => ['shared', 'copied', 'cancelled', 'unsupported'].includes(value) ? value : 'unsupported', () => 'unsupported');
  window.WizardApp = Object.freeze({ version: VERSION, get hosted() { return !!service || transportReady; }, ready,
    readyExtension: Object.freeze({write: (kind,input,before,options={}) => request('ready.write',{kind,input,before},120000,options.onAdmitted)}),
    identity: Object.freeze({
      info: () => framed ? request('identity.info') : Promise.resolve({ unavailable: true }),
      sign: event => framed ? request('identity.sign', { event }, ID_WAIT) : Promise.resolve({ unavailable: true }),
      nip44_encrypt: args => framed ? request('identity.nip44_encrypt', args, ID_WAIT) : Promise.resolve({ unavailable: true }),
      nip44_decrypt: args => framed ? request('identity.nip44_decrypt', args, ID_WAIT) : Promise.resolve({ unavailable: true }),
    }),
    shell: Object.freeze({
      openCompanion: opts => shellOp('openCompanion', opts),
      closeCompanion: () => shellOp('closeCompanion'),
      postCompanion: data => shellOp('postCompanion', data),
      focusApp: () => shellOp('focusApp'),
      toast: (icon, message) => service?.shell?.toast(icon, message) || false,
      onCompanionMessage: fn => listen(companionMessages, fn),
    }),
    voiceInput, conversation: voiceInput, // backwards-compatible name, identical receiver/authority
    back: Object.freeze({ register, push, useHistory }),
    view: Object.freeze({ isVisible: () => !document.hidden && (!framed || service?.view?.isVisible() === true), onRefresh }),
    nav: Object.freeze({ get threadAgents() { return service?.nav?.threadAgents === true; }, get threadDrafts() { return service?.nav?.threadDrafts === true; }, openThread: (id, opts) => service?.nav?.openThread(id, opts) === true,
      // Call after a finishing action (dismiss, archive, delete, save-and-close): returns the owner to the screen before the app.
      back: () => { try { return service?.nav?.back?.() === true; } catch (_) { return false; } }, openContextDraft: data => { if (!service?.nav?.openContextDraft) throw new Error('Context drafts need the verified Wizard host'); return service.nav.openContextDraft(data); } }),
    theme: Object.freeze({ get: () => currentTheme || window.WizardTheme?.current || null, onChange: fn => listen(themes, fn, currentTheme || window.WizardTheme?.current) }),
    // Wizard's media viewer for the app's photos/videos ([{url, kind: 'image'|'video', name}], start index). Opened on
    // its own (no Wizard around it) the photo opens in a browser tab, which zooms natively.
    media: Object.freeze({ view: (items, index = 0) => {
      try { if (service?.media?.view) return service.media.view(items, index) === true; } catch (_) {}
      if (framed) return false;
      const it = Array.isArray(items) ? items[Math.max(0, Math.floor(+index) || 0)] : null;
      if (!it?.url) return false; window.open(String(it.url), '_blank', 'noopener'); return true;
    } }),
    device: Object.freeze({ legacy: Object.freeze({
      available(method) { return !!service?.device?.legacy?.available(method); },
      call(method, args = []) { if (!service?.device?.legacy) throw new Error('Legacy device unavailable'); return service.device.legacy.call(method, args); },
    }), backgroundAudio: Object.freeze({
      request(method, params = {}) {
        if (!service?.device?.backgroundAudio) return Promise.reject(new Error('Background audio unavailable'));
        return service.device.backgroundAudio.request(method, params);
      },
    }) }),
    voice: Object.freeze({ commands, stripAddress: text => service ? service.voice.stripAddress(text) : String(text || ''), transcribe: (file, opts = {}) => service?.voice ? service.voice.transcribe(file, opts) : transportReady ? request('voice.transcribe', { file, language: opts.language }, 180000) : Promise.resolve({ unavailable: true }) }),
    share: Object.freeze({ get wizard() { return service?.share?.wizard ? data => service.share.wizard(data) : transportReady ? data => request('share.wizard', data, 600000) : undefined; }, text: data => service ? service.share.text(data) : transportReady ? sharedResult(request('share.text', data)) : fallbackText(data), file: (file, opts) => service ? service.share.file(file, opts) : transportReady ? sharedResult(request('share.file', { file, options: opts })) : fallbackFile(file, opts),
      receive: receiveShares, targets: shareTargets, check: () => pullShares() }),
    titlebar: Object.freeze({ set: (tools, onTool) => { toolHandler = typeof onTool === 'function' ? onTool : null; return service ? Promise.resolve(service.titlebar.set(tools)) : transportReady ? request('titlebar.set', { tools }).then(v => v === true, () => false) : Promise.resolve(false); },
      shown: () => { try { return !!service?.titlebar.shown(); } catch (_) { return false; } } }),
    /* The agent orb as this app's main button: claim({ icon, label }, onTap) puts the icon on a host agent orb in this
     * app's colour while the app is in front; tap runs onTap. Resolves true when the host shows it (the app then hides
     * its own button), false when there is no orb to claim. No shell view draws one since the Two orbs layout went
     * (wizard-ux issue 1338), so today it resolves false and apps keep their own button; kept so apps never break. */
    orb: Object.freeze({
      claim: (spec, onTap) => { orbHandler = typeof onTap === 'function' ? onTap : null; return service?.orb ? Promise.resolve(service.orb.set(spec)) : transportReady ? request('orb.set', { spec }).then(v => v === true, () => false) : Promise.resolve(false); },
      release: () => { orbHandler = null; return service?.orb ? Promise.resolve(service.orb.set(null)) : transportReady ? request('orb.set', { spec: null }).then(() => true, () => false) : Promise.resolve(false); },
      shown: () => { try { return !!service?.orb?.shown(); } catch (_) { return false; } },
    }),
    /* Lower Wizard Music while this app plays something short (a voice note); duck(false) restores it. */
    audio: Object.freeze({ duck: on => service?.audio ? Promise.resolve(service.audio.duck(!!on)).then(v => v === true, () => false) : transportReady ? request('audio.duck', { on: !!on }).then(v => v === true, () => false) : Promise.resolve(false) }),
    /* Fingerprint vault (WizardOS Android app): keep one small secret for this app on the phone, behind the
     * fingerprint. has() -> {available, saved}; seal(secret, title) and open(title) show the fingerprint prompt;
     * errors carry .code (cancelled, unavailable, not_saved, invalidated, busy, failed). */
    vault: Object.freeze((() => {
      const call = (op, args) => service?.vault ? service.vault[op.slice(6)](...(op === 'vault.seal' ? [args.secret, args.title] : [args?.title]))
        : transportReady ? request(op, args, 130000).catch(e => { throw Object.assign(new Error(String(e.message).replace(/^vault:/, '')), { code: String(e.message).startsWith('vault:') ? String(e.message).slice(6) : 'unavailable' }); })
        : Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
      return {
        has: () => call('vault.has').catch(() => ({ available: false, saved: false })),
        seal: (secret, title) => call('vault.seal', { secret, title }),
        open: title => call('vault.open', { title }).then(r => r.secret),
        forget: () => call('vault.forget'),
      };
    })()),
    keys, // Live app-key targets while Option is held.
    badge: Object.freeze({ set: (n, o) => { const more = !!(o && o.more === true); return service ? service.badge.set(n, { more }) : transportReady ? request('badge.set', { n, more }).then(() => true, () => false) : Promise.resolve(false); } }),
    attachChip: Object.freeze({ node: chipNode, paint: (el, c) => window.WizAttachChip?.paint(el, c), ready: () => chipModule().then(m => !!m) }),
    composer: Object.freeze({ bind: composerBind, insertText: (field, text) => window.WizComposerInput ? window.WizComposerInput.insertText(field, text) : (composerModule(), false) }),
    update: Object.freeze({ hold, onAvailable: fn => listen(updates, fn, updateAvailable || service?.update.available()) }),
    capture: Object.freeze({ start: async opts => { if (['auto', 'command'].includes(opts?.kind)) throw new Error('Capture kind is reserved for Wizard voice; use audio/meeting and task metadata'); if (service) return service.capture.start(opts); if (opaque) return boundaryCapture.start(opts); if (framed) throw new Error('Shared capture needs the verified synchronous host connection'); const resource=captureModule(); return opts?.resumeId && resource.resume ? resource.resume(standaloneId(),opts.resumeId,opts) : resource.start(standaloneId(), opts); },
      prepare: opts => { if(service) return service.capture.prepare(opts); if(opaque) return boundaryCapture.prepare(opts); if(framed) throw new Error('Capture preparation needs the verified host connection'); return captureModule().prepare(standaloneId(),opts); },
      capabilities: opts => { if(service) return service.capture.capabilities(opts); if(opaque) return boundaryCapture.capabilities(opts); if(framed) return {}; return captureModule().capabilities(opts); },
      attach: () => { if(service) return service.capture.attach(); if(opaque) return boundaryCapture.attach(); if(framed) throw new Error('Capture recovery needs the verified host connection'); return captureModule().attach(standaloneId()); },
      current: () => { if(service) return service.capture.current(); if(opaque) return boundaryCapture.current(); if(framed) return null; return captureModule().current(standaloneId()); },
      settle: keepId => { if(service) return service.capture.settle(keepId); if(opaque) return boundaryCapture.settle(keepId); if(framed) throw new Error('Capture cleanup needs the verified host connection'); return captureModule().settle(standaloneId(),keepId); },
      pending: async () => service ? service.capture.pending() : opaque ? boundaryCapture.pending() : transportReady ? request('capture.pending') : captureModule().pending(standaloneId()), ack: async id => service ? service.capture.ack(id) : opaque ? boundaryCapture.ack(id) : transportReady ? request('capture.ack', { id }) : captureModule().ack(standaloneId(), id) }),
  });
  if (opaque) { if (window.WizBoundaryClient) window.WizBoundaryClient.connect(boundaryHooks()); else boundaryClient(); }
  ready();
})();
