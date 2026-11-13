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
  /* Links and pop-ups under the boundary: the sandbox has no allow-popups or allow-top-navigation, and the shell can't
   * patch this page's links (core/links.js guardFrame), so a link that opens a new tab or the whole page (target
   * _blank / _top / _parent), window.open, a link to another site or to a page outside this window's app path (the
   * shell names it in its hello), and an image of this Wizard did nothing or loaded into this window. Such a tap goes to
   * the shell (`link.open`), which opens it the way it does for a same-origin app: the link sheet, that app's window,
   * the owner's browser, the image viewer or a download. The shell takes it only right after a real tap in this
   * window, as a browser's pop-up rule. Registered before the saved-settings listener below, which leaves a link it took
   * alone. A download of the app's own file is saved by the page itself (below). */
  if (opaque) (() => {
    const LEAVE = /^_(blank|top|parent)$/i, IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
    const url = href => { try { const u = new URL(String(href), document.baseURI || location.href); return /^https?:$/.test(u.protocol) ? u : null; } catch (_) { return null; } };
    // A target that would open a new browsing context: _blank / _top / _parent, or a name no frame in this page has
    // (the browser would make a pop-up for it). _self and a named frame of the page stay the page's.
    const pops = target => {
      const t = String(target ?? '');
      if (!t || t.toLowerCase() === '_self') return false;
      if (LEAVE.test(t)) return true;
      try { return ![...document.querySelectorAll('iframe[name], frame[name], object[name]')].some(f => f.getAttribute('name') === t); } catch (_) { return true; }
    };
    const leaves = (u, target) => {
      if (u.origin !== location.origin || pops(target) || IMAGE.test(u.pathname)) return true;
      const home = window.WizBoundaryClient?.home || '';
      return !!home && (!u.pathname.startsWith(home) || /%(?:2f|5c|2e|25)/i.test(u.pathname));
    };
    const hand = (u, browse) => { boundaryClient().then(c => c?.request('link.open', { href: u.href, browse }, 8000)).catch(() => {}); };
    /* A download link to the app's own file (Music's Download clip): the page is opaque, so to the browser even this
     * host is another origin, and it ignores `download` there: the file loaded into the window in place of the app.
     * The page's own fetch (the shell's, inside the app path) takes the file, and a blob: address of this page saves it
     * under the link's name (else the answer's, else the address's). */
    const own = u => { const home = window.WizBoundaryClient?.home || ''; return u.origin === location.origin && (!home || (u.pathname.startsWith(home) && !/%(?:2f|5c|2e|25)/i.test(u.pathname))); };
    const saveName = (given, res, u) => {
      if (given) return given;
      const cd = res.headers.get('content-disposition') || '';
      let m = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
      try { if (m) return decodeURIComponent(m[1].trim()); } catch (_) {}
      m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd); if (m) return m[1].trim();
      try { return decodeURIComponent(u.pathname.split('/').pop() || '') || 'download'; } catch (_) { return 'download'; }
    };
    const save = (u, given) => {
      Promise.resolve().then(() => window.fetch(u.href, { credentials: 'include' })).then(async res => {
        if (!res.ok) throw new Error('download answered ' + res.status);
        const name = saveName(String(given || '').trim(), res, u), href = URL.createObjectURL(await res.blob()), x = document.createElement('a');
        x.href = href; x.download = name; x.style.display = 'none';
        (document.body || document.documentElement).appendChild(x); x.click(); x.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
      }).catch(err => { try { console.warn('Wizard: download failed', err); } catch (_) {} });
    };
    addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.('a[href], area[href]'); if (!a) return;
      const u = url(a.getAttribute('href')); if (!u) return;
      if (a.hasAttribute('download') && own(u)) { e.preventDefault(); e.stopPropagation(); save(u, a.getAttribute('download')); return; }
      // An in-page anchor stays the page's.
      if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && u.hash && !pops(a.getAttribute('target'))) return;
      if (!leaves(u, a.getAttribute('target'))) return;
      e.preventDefault(); e.stopPropagation();
      hand(u, a.hasAttribute('data-wizard-browse'));
    }, true);
    // A form aimed at the whole page would be refused by the sandbox: it stays in this window, as guardFrame does.
    addEventListener('submit', e => {
      const f = e.target, b = e.submitter, own = !!b?.hasAttribute?.('formtarget');
      const t = ((own ? b.getAttribute('formtarget') : f?.getAttribute?.('target')) || '').toLowerCase();
      if (t === '_top' || t === '_parent') (own ? b : f).setAttribute(own ? 'formtarget' : 'target', '_self');
    }, true);
    try {
      const open = window.open;
      window.open = function (href, target, features) {
        const u = href == null || href === '' ? null : url(href);
        if (u && (target == null || pops(target) || String(target) === '')) { hand(u, false); return null; }
        return open.call(window, href, target, features);
      };
    } catch (_) {}
  })();
  /* Saved settings under the boundary: the browser refuses localStorage and sessionStorage to an opaque origin (any use
   * throws), so the page gets stand-ins with the same methods. localStorage is the shell's copy for this window's
   * installed app (browser-boundary.js appStorage): a new window starts with it in its frame name, read here before the
   * app's own scripts run, and every change goes back to the shell (`storage.save`). Both also live in this frame's
   * name, so a reload inside the window keeps them; sessionStorage never leaves the window. The name carries the app's
   * own path: a page outside it (another app on this host) drops it unread, and a link or form that leaves that path
   * clears it first, so the next page cannot read it. A window that started without them asks once (`storage.load`)
   * and then fires a `storage` event, so the app can read them again; so does a change the shell could not keep. */
  const boundaryStorage = opaque ? (() => {
    try { void window.localStorage; return null; } catch (_) {}
    const NAME = 'wzst1:', MAX = 512 * 1024, KEY_MAX = 4096, BATCH = 1000;
    let seed = null;
    try { if (typeof window.name === 'string' && window.name.startsWith(NAME)) seed = JSON.parse(window.name.slice(NAME.length)); } catch (_) { seed = null; }
    const under = (path, base) => typeof base === 'string' && base.startsWith('/') && base.endsWith('/') && typeof path === 'string' && path.startsWith(base) && !/%(?:2f|5c|2e|25)/i.test(path);
    // Another page's settings (another app's path, or no path at all) are never read, and go now.
    if (!seed || typeof seed !== 'object' || !under(location.pathname, seed.p)) seed = null;
    if (!seed) { try { if (String(window.name).startsWith(NAME)) window.name = ''; } catch (_) {} }
    const base = seed ? seed.p : '';
    const pairs = o => { const m = new Map(); if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (typeof o[k] === 'string') m.set(k, o[k]); return m; };
    const local = pairs(seed?.l), session = pairs(seed?.s), changed = new Set();
    let ops = [], timer = 0, cleared = false, sender = null, client = null, asked = !!seed;
    // Without the app's path (a window that started without a seed) nothing goes in the name.
    const keep = () => { if (!base) return; try { window.name = NAME + JSON.stringify({ p: base, l: Object.fromEntries(local), s: Object.fromEntries(session) }); } catch (_) {} };
    const flush = () => { clearTimeout(timer); timer = 0; if (!ops.length || !sender) return; const all = ops; ops = []; for (let i = 0; i < all.length; i += BATCH) sender(all.slice(i, i + BATCH)); };
    const size = m => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
    const announce = () => { try { dispatchEvent(new StorageEvent('storage', { key: null })); } catch (_) {} };
    function note(map, op) {
      keep();
      if (map !== local) return;
      if (op.c) { cleared = true; changed.clear(); } else changed.add(op.k);
      ops.push(op); if (!timer) timer = setTimeout(flush, 150);
    }
    function apply(map, op) { if (op.c) map.clear(); else if (op.d) map.delete(op.k); else map.set(op.k, op.v); }
    // The shell could not keep a change (its storage for all apps is full, or it refused it): the page goes back to
    // what the shell has, plus the changes not sent yet, so it never believes in a setting that is gone on reopening.
    function refused() {
      if (!client) return;
      client.request('storage.load', {}, 10000).then(v => {
        local.clear(); for (const [k, x] of pairs(v?.store)) local.set(k, x);
        for (const op of ops) apply(local, op);
        keep(); announce();
        console.warn('WizardApp: the shell could not keep a saved setting (storage full); it was undone.');
      }, () => {});
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
          if (k.length > KEY_MAX || size(map) > MAX) { if (had) map.set(k, old); else map.delete(k); throw new DOMException('The app\u2019s saved settings are full.', 'QuotaExceededError'); }
          note(map, { k, v });
        },
        removeItem: k => { k = String(k); if (!map.has(k)) return; map.delete(k); note(map, { k, d: 1 }); },
        clear: () => { if (!map.size) return; map.clear(); note(map, { c: 1 }); },
      });
      const own = p => typeof p === 'string' && !(p in api) && map.has(p);
      // Named access (localStorage.foo, Object.keys(localStorage)) like the real one.
      return new Proxy(Object.create(null), {
        get: (_, p) => (p in api ? api[p] : own(p) ? map.get(p) : undefined),
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
    // A link or form in the page that leaves the app's own path (another app on this host, or another site): clear the
    // name first (the Navigation API is off for an opaque page). The app's own scripts hold the data anyway, so a
    // navigation they make is theirs; this covers content the app shows, such as a link in a note. If that navigation
    // is cancelled, the next change keeps them again.
    const away = (url, target) => {
      if (target && target !== '_self') return;
      try { const u = new URL(url, location.href); if (u.origin !== location.origin || !under(u.pathname, base)) window.name = ''; } catch (_) { window.name = ''; }
    };
    addEventListener('click', e => { const a = e.target?.closest?.('a[href], area[href]'); if (a && !e.defaultPrevented && !a.hasAttribute('download')) away(a.href, a.target); }, true);
    addEventListener('submit', e => { const f = e.target; if (f?.tagName === 'FORM') away(e.submitter?.formAction || f.action, e.submitter?.formTarget || f.target); }, true);
    addEventListener('pagehide', flush);
    return {
      // The boundary client is connected: from now on changes go to the shell. A window that started without its
      // saved settings asks for them once and takes every key the page has not changed itself meanwhile.
      ready(c) {
        client = c;
        if (!sender) sender = batch => { try { c.request('storage.save', { ops: batch }, 10000).then(ok => { if (ok === false) refused(); }, () => {}); } catch (_) {} };
        if (asked) { flush(); return; }
        asked = true;
        c.request('storage.load', {}, 10000).then(v => {
          let any = false;
          if (!cleared) for (const [k, x] of pairs(v?.store)) if (!changed.has(k) && local.get(k) !== x) { local.set(k, x); any = true; }
          if (any) { keep(); announce(); }
        }, () => {}).finally(flush);
      },
    };
  })() : null;
  /* The app's own backend under the boundary: an opaque page's fetch to this host goes out with `Origin: null` and no
   * cookies, and the browser hides the answer (CORS). So a fetch to this host goes through the shell (`net.fetch`), which
   * makes it only inside this window's own app path (core/app-services.js boundaryNet) and gives back a Response with
   * the status, headers and body. An address the shell won't fetch for this app (`outside`: another app, an owner
   * route), or a window with no shell channel, gets the page's own fetch unchanged, as before. The body streams: the
   * shell sends the status and headers first and the body in pieces as they arrive (`net` notices), so a reply written
   * as it goes and server-sent events read live. XMLHttpRequest, EventSource and WebSocket go the same way (below). */
  let netNotice = () => {};
  if (opaque && typeof window.fetch === 'function' && typeof Request === 'function') (() => {
    const native = window.fetch, NULL_BODY = [101, 103, 204, 205, 304];
    /* A streamed answer's body: pieces from the shell (onNet) go into a ReadableStream. The page's reads say how much
     * it has taken (net.ack, every ACK_STEP bytes), and the shell reads on only while little waits in between. Cancel
     * (the page's reader, or its AbortSignal) stops the call in the shell too (net.abort). */
    const streams = new Map(), ACK_STEP = 256 * 1024, QUEUE = 1024 * 1024;
    const sockets = new Map(); // this page's own WebSockets through the shell (below), by key
    function bodyStream(key, c, onEnd) {
      let ctrl = null, got = 0, acked = 0, done = false;
      const finish = () => { if (done) return false; done = true; streams.delete(key); try { onEnd(); } catch (_) {} return true; };
      const s = {
        stream: new ReadableStream({
          start(x) { ctrl = x; },
          pull() { if (!done && got - acked >= ACK_STEP) { acked = got; c.request('net.ack', { key, n: got }, 5000).catch(() => {}); } },
          cancel() { if (finish()) c.request('net.abort', { key }, 5000).catch(() => {}); },
        }, { highWaterMark: QUEUE, size: ch => ch.byteLength }),
        on(d) {
          if (done) return;
          if (d.event === 'chunk') { got += d.chunk.byteLength; try { ctrl.enqueue(new Uint8Array(d.chunk)); } catch (_) {} return; }
          if (!finish()) return;
          if (d.event === 'end') { try { ctrl.close(); } catch (_) {} return; }
          try { ctrl.error(d.error || new TypeError('network error')); } catch (_) {}
        },
        fail(err) { if (finish()) { try { ctrl.error(err); } catch (_) {} c.request('net.abort', { key }, 5000).catch(() => {}); } },
      };
      streams.set(key, s);
      return s;
    }
    // A new shell channel (the window reattached) ends every open stream: the shell stopped them. A call still waiting
    // for its answer's head is not one yet: either it fails on its own or it goes again on the new channel (hello `took`).
    netNotice = d => {
      if (d?.event === 'reset') { for (const s of [...streams.values()]) if (s.headed) s.on({ event: 'error' }); for (const w of [...sockets.values()]) w({ event: 'reset' }); return; }
      if (d?.ws === true) { sockets.get(d.key)?.(d); return; }
      streams.get(d?.key)?.on(d);
    };
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
    // The shell channel: a sandboxed app window gets its hello at once; a page nobody attached (no channel within 10 s)
    // keeps its own fetch.
    const channel = () => boundaryClient().then(async c => { for (let i = 0; c && !c.ready && i < 100; i++) await new Promise(r => setTimeout(r, 100)); return c && c.ready ? c : null; });
    window.fetch = function fetch(input, init) {
      let req;
      try { req = new Request(input, init); } catch (err) { return Promise.reject(err); }
      // From here on the page's own fetch takes `req` (or its copy): a Request body can be read only once.
      let u; try { u = new URL(req.url); } catch (_) { return native.call(this, req); }
      if (u.origin !== location.origin || req.mode === 'no-cors' || req.mode === 'navigate') return native.call(this, req);
      const signal = req.signal;
      if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
      const self = this, spare = req.clone();
      // An abort before the call reaches the shell stops it from being sent at all; one after it asks the shell to stop
      // (net.abort, by this call's own key), so it no longer runs on or holds one of the window's slots.
      const key = 'nf-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      let sent = null, flow = null;
      const cancel = () => {
        if (flow) { flow.fail(signal.reason ?? abortError()); return; }
        if (sent) sent.request('net.abort', { key }, 5000).catch(() => {});
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const run = (async () => {
        const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
        const c = await channel();
        if (signal?.aborted) throw signal.reason ?? abortError();
        if (!c) return native.call(self, spare);
        let v;
        // Ready before the call goes out: the body's pieces may follow its head at once.
        const pipe = typeof ReadableStream === 'function' ? bodyStream(key, c, () => signal?.removeEventListener('abort', cancel)) : null;
        try {
          sent = c;
          v = await c.request('net.fetch', { key, url: req.url, method: req.method, headers: [...req.headers], body, credentials: req.credentials, cache: req.cache, stream: !!pipe }, 300000);
        } catch (err) {
          streams.delete(key);
          if (err?.code === 'outside' || err?.code === 'unavailable') return native.call(self, spare);
          throw new TypeError('Failed to fetch');
        }
        const r = v?.net; if (!r || typeof r !== 'object') { streams.delete(key); throw new TypeError('Failed to fetch'); }
        const streamed = r.stream === true && !!pipe;
        if (pipe) pipe.headed = true;
        if (!streamed) streams.delete(key);
        const empty = NULL_BODY.includes(r.status) || req.method === 'HEAD';
        if (streamed && empty) pipe.fail(abortError());
        const res = new Response(empty ? null : streamed ? pipe.stream : r.body, { status: r.status, statusText: r.statusText || '', headers: r.headers || [] });
        try { Object.defineProperty(res, 'url', { value: r.url || req.url }); Object.defineProperty(res, 'redirected', { value: r.redirected === true }); } catch (_) {}
        if (streamed && !empty) flow = pipe;
        return res;
      })().finally(() => { sent = null; if (!flow) signal?.removeEventListener('abort', cancel); });
      if (!signal) return run;
      return new Promise((resolve, reject) => {
        const stop = () => reject(signal.reason ?? abortError());
        signal.addEventListener('abort', stop, { once: true });
        run.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
    };
    /* EventSource (server-sent events) to this host goes the same way: the stand-in reads the event stream through the
     * fetch stand-in above (a streamed answer), so a stream from the app's own backend arrives live with the owner's
     * cookie. It keeps the usual shape: readyState, url, withCredentials, open / message / error and named events,
     * lastEventId, `retry:` and reconnecting with Last-Event-ID, close(). An answer that is not a 200
     * text/event-stream ends it (CLOSED) as the browser's own does. Another site's stream uses the browser's own
     * EventSource, as before. */
    if (typeof window.EventSource === 'function' && typeof EventTarget === 'function' && typeof TextDecoder === 'function') {
      const NativeES = window.EventSource, viaShellES = window.fetch;
      const ES_EVENTS = ['open', 'message', 'error'];
      class EventSource extends EventTarget {
        #url = ''; #cred = false; #ready = 0; #stop = null; #last = ''; #retry = 3000; #timer = 0;
        constructor(url, init) {
          let u;
          try { u = new URL(String(url), location.href); } catch (_) { throw new DOMException('Failed to construct \u2018EventSource\u2019: The URL \u2018' + url + '\u2019 is invalid.', 'SyntaxError'); }
          if (u.origin !== location.origin) return new NativeES(url, init);
          super();
          for (const t of ES_EVENTS) {
            let h = null;
            Object.defineProperty(this, 'on' + t, { configurable: true, enumerable: true, get: () => h,
              set: v => { if (h) this.removeEventListener(t, h); h = typeof v === 'function' ? v : null; if (h) this.addEventListener(t, h); } });
          }
          this.#url = u.href; this.#cred = !!(init && init.withCredentials);
          this.#connect();
        }
        get url() { return this.#url; }
        get withCredentials() { return this.#cred; }
        get readyState() { return this.#ready; }
        close() { this.#ready = 2; clearTimeout(this.#timer); const stop = this.#stop; this.#stop = null; stop?.abort(); }
        // Reconnect after the stream ended or the connection dropped (not after close() or a refused answer).
        #lost(stop) {
          if (this.#stop !== stop || this.#ready === 2) return;
          this.#stop = null; this.#ready = 0;
          this.dispatchEvent(new Event('error'));
          if (this.#ready === 2) return;
          this.#timer = setTimeout(() => { if (this.#ready === 0 && !this.#stop) this.#connect(); }, this.#retry);
        }
        #fail(stop) { if (this.#stop !== stop) return; this.#stop = null; this.#ready = 2; this.dispatchEvent(new Event('error')); }
        async #connect() {
          const stop = new AbortController(); this.#stop = stop;
          const headers = [['Accept', 'text/event-stream'], ['Cache-Control', 'no-cache']];
          if (this.#last) headers.push(['Last-Event-ID', this.#last]);
          let res;
          try { res = await viaShellES.call(window, this.#url, { headers, credentials: this.#cred ? 'include' : 'same-origin', cache: 'no-store', signal: stop.signal }); } catch (_) { return this.#lost(stop); }
          if (this.#stop !== stop) { try { res.body?.cancel(); } catch (_) {} return; }
          const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (res.status !== 200 || type !== 'text/event-stream' || !res.body) { try { res.body?.cancel(); } catch (_) {} return this.#fail(stop); }
          this.#ready = 1; this.dispatchEvent(new Event('open'));
          const reader = res.body.getReader(), dec = new TextDecoder();
          let buf = '', data = '', name = '', idBuf = this.#last, first = true;
          const line = l => {
            if (l === '') {
              this.#last = idBuf;
              if (data) {
                const ev = new MessageEvent(name || 'message', { data: data.endsWith('\n') ? data.slice(0, -1) : data, origin: location.origin, lastEventId: this.#last });
                if (this.#stop === stop) this.dispatchEvent(ev);
              }
              data = ''; name = ''; return;
            }
            if (l[0] === ':') return;
            const at = l.indexOf(':'), field = at < 0 ? l : l.slice(0, at);
            let value = at < 0 ? '' : l.slice(at + 1); if (value[0] === ' ') value = value.slice(1);
            if (field === 'event') name = value;
            else if (field === 'data') data += value + '\n';
            else if (field === 'id') { if (!value.includes('\0')) idBuf = value; }
            else if (field === 'retry') { if (/^\d+$/.test(value)) this.#retry = Number(value); }
          };
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (this.#stop !== stop) { try { reader.cancel(); } catch (_) {} return; }
              if (done) break;
              buf += dec.decode(value, { stream: true });
              if (first && buf) { if (buf[0] === '\uFEFF') buf = buf.slice(1); first = false; }
              // Lines end with CRLF, LF or CR; a CR at the very end may still be half of a CRLF.
              let m;
              while ((m = /\r\n|\r|\n/.exec(buf)) && !(m[0] === '\r' && m.index === buf.length - 1)) { const l = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); line(l); if (this.#stop !== stop) return; }
            }
          } catch (_) { /* the connection dropped */ }
          this.#lost(stop);
        }
      }
      for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSED: 2 })) {
        Object.defineProperty(EventSource, k, { value: v, enumerable: true });
        Object.defineProperty(EventSource.prototype, k, { value: v, enumerable: true });
      }
      try { Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: EventSource }); } catch (_) {}
    }
    /* XMLHttpRequest goes the same way: an async request becomes a fetch through the stand-in above (so a call to this
     * app's own backend goes through the shell, and anything else goes out exactly as the page's own fetch would). The
     * stand-in keeps the usual shape: readyState, status, headers, responseType ('', text, json, arraybuffer, blob,
     * document), the on* handlers and listeners, abort, timeout, upload events and withCredentials. A synchronous request
     * cannot wait for the shell: it uses the browser's own XMLHttpRequest, as before. */
    if (typeof window.XMLHttpRequest !== 'function' || typeof EventTarget !== 'function') return;
    const NativeXHR = window.XMLHttpRequest, viaShell = window.fetch;
    const XHR_EVENTS = ['readystatechange', 'loadstart', 'progress', 'abort', 'error', 'load', 'timeout', 'loadend'];
    const state = name => new DOMException('The object\u2019s state must be OPENED.', name || 'InvalidStateError');
    const progress = (type, loaded, total) => new ProgressEvent(type, { lengthComputable: total > 0, loaded, total });
    function withHandlers(target, types) {
      for (const t of types) {
        let h = null;
        Object.defineProperty(target, 'on' + t, {
          configurable: true, enumerable: true, get: () => h,
          set: v => { if (h) target.removeEventListener(t, h); h = typeof v === 'function' ? v : null; if (h) target.addEventListener(t, h); },
        });
      }
    }
    class XMLHttpRequestUpload extends EventTarget { constructor() { super(); withHandlers(this, XHR_EVENTS.slice(1)); } }
    class XMLHttpRequest extends EventTarget {
      #s = { ready: 0, method: 'GET', url: '', headers: [], sent: false, status: 0, statusText: '', resHeaders: null, url2: '', raw: null, text: '', type: '', mime: '', timeout: 0, cred: false, stop: null, gen: 0, sync: null };
      constructor() { super(); withHandlers(this, XHR_EVENTS); this.upload = new XMLHttpRequestUpload(); }
      get readyState() { return this.#s.sync ? this.#s.sync.readyState : this.#s.ready; }
      get status() { return this.#s.sync ? this.#s.sync.status : this.#s.status; }
      get statusText() { return this.#s.sync ? this.#s.sync.statusText : this.#s.statusText; }
      get responseURL() { return this.#s.sync ? this.#s.sync.responseURL : this.#s.url2; }
      get responseType() { return this.#s.type; }
      set responseType(v) {
        if (this.#s.ready >= 3) throw state();
        if (['', 'text', 'json', 'arraybuffer', 'blob', 'document'].includes(v)) this.#s.type = v;
      }
      get timeout() { return this.#s.timeout; }
      set timeout(v) { this.#s.timeout = Math.max(0, Number(v) || 0); }
      get withCredentials() { return this.#s.cred; }
      set withCredentials(v) { if (this.#s.sent) throw state(); this.#s.cred = !!v; }
      get responseText() {
        if (this.#s.sync) return this.#s.sync.responseText;
        if (this.#s.type !== '' && this.#s.type !== 'text') throw state();
        return this.#s.ready >= 3 ? this.#s.text : '';
      }
      get responseXML() { if (this.#s.sync) return this.#s.sync.responseXML; return this.#s.type === '' || this.#s.type === 'document' ? this.#doc() : null; }
      get response() {
        const s = this.#s;
        if (s.sync) return s.sync.response;
        if (s.type === '' || s.type === 'text') return s.ready >= 3 ? s.text : '';
        if (s.ready !== 4 || !s.raw) return null;
        if (s.type === 'json') { try { return JSON.parse(s.text); } catch (_) { return null; } }
        if (s.type === 'arraybuffer') return s.raw.slice(0);
        if (s.type === 'blob') return new Blob([s.raw], { type: s.mime || this.getResponseHeader('content-type') || '' });
        return this.#doc();
      }
      #doc() {
        const s = this.#s; if (s.ready !== 4 || !s.raw) return null;
        const type = (s.mime || this.getResponseHeader('content-type') || '').split(';')[0].trim().toLowerCase();
        const kind = type === 'text/html' ? (s.type === 'document' ? 'text/html' : '') : /^(?:text|application)\/(?:[\w.+-]*\+)?xml$/.test(type) ? type : '';
        if (!kind) return null;
        try { return new DOMParser().parseFromString(s.text, kind); } catch (_) { return null; }
      }
      overrideMimeType(m) { if (this.#s.ready >= 3) throw state(); this.#s.mime = String(m); }
      getResponseHeader(name) {
        if (this.#s.sync) return this.#s.sync.getResponseHeader(name);
        if (!this.#s.resHeaders || this.#s.ready < 2) return null;
        const k = String(name).toLowerCase(), all = this.#s.resHeaders.filter(h => h[0].toLowerCase() === k).map(h => h[1]);
        return all.length ? all.join(', ') : null;
      }
      getAllResponseHeaders() {
        if (this.#s.sync) return this.#s.sync.getAllResponseHeaders();
        if (!this.#s.resHeaders || this.#s.ready < 2) return '';
        return this.#s.resHeaders.map(h => h[0].toLowerCase() + ': ' + h[1] + '\r\n').join('');
      }
      open(method, url, async = true, user, password) {
        const s = this.#s;
        // A request still open ends without events (its answer is dropped: the generation moved on).
        s.gen++;
        if (s.stop) { s.stop.abort(); s.stop = null; }
        const m = String(method).toUpperCase();
        if (/^(?:CONNECT|TRACE|TRACK)$/.test(m)) throw new DOMException('\u2018' + method + '\u2019 HTTP method is unsupported.', 'SecurityError');
        const u = new URL(String(url), location.href);
        if (user != null) u.username = user; if (password != null) u.password = password;
        Object.assign(s, { method: /^(?:DELETE|GET|HEAD|OPTIONS|POST|PUT|PATCH)$/.test(m) ? m : String(method), url: u.href, headers: [], sent: false, status: 0, statusText: '', resHeaders: null, url2: '', raw: null, text: '', sync: null });
        // A synchronous request can't wait for the shell: the browser's own one handles it, as before.
        if (async === false) {
          const x = new NativeXHR(); s.sync = x;
          x.withCredentials = s.cred; x.open(method, url, false, user, password); if (s.mime) x.overrideMimeType(s.mime);
          s.ready = 1; return;
        }
        s.ready = 1; this.dispatchEvent(new Event('readystatechange'));
      }
      setRequestHeader(name, value) {
        const s = this.#s;
        if (s.ready !== 1 || s.sent) throw state();
        if (s.sync) return s.sync.setRequestHeader(name, value);
        s.headers.push([String(name), String(value)]);
      }
      send(body = null) {
        const s = this.#s;
        if (s.ready !== 1 || s.sent) throw state();
        if (s.sync) {
          s.sent = true;
          try { s.sync.send(body); } finally { s.sent = false; }
          s.ready = 4; this.dispatchEvent(new Event('readystatechange'));
          if (s.sync.status) { this.dispatchEvent(progress('load', 0, 0)); }
          this.dispatchEvent(progress('loadend', 0, 0)); return;
        }
        s.sent = true;
        const gen = s.gen, stop = new AbortController(); s.stop = stop;
        if (s.method === 'GET' || s.method === 'HEAD') body = null;
        else if (typeof Document === 'function' && body instanceof Document) body = new XMLSerializer().serializeToString(body);
        // Upload events fire for any body (FormData and URLSearchParams too, whose size is only known once encoded).
        const upload = body != null, size = !upload ? 0 : typeof body === 'string' ? new Blob([body]).size : body.size ?? body.byteLength ?? 0;
        const live = () => s.gen === gen && s.stop === stop;
        let timer = 0, why = '';
        const end = (type, loaded, total) => {
          clearTimeout(timer); if (!live()) return; s.stop = null; s.sent = false;
          if (type !== 'load') { s.status = 0; s.statusText = ''; s.resHeaders = null; s.raw = null; s.text = ''; }
          s.ready = 4; this.dispatchEvent(new Event('readystatechange'));
          if (type !== 'load' && upload) { this.upload.dispatchEvent(progress(type, 0, 0)); this.upload.dispatchEvent(progress('loadend', 0, 0)); }
          this.dispatchEvent(progress(type, loaded, total)); this.dispatchEvent(progress('loadend', loaded, total));
        };
        this.dispatchEvent(progress('loadstart', 0, 0));
        if (upload) this.upload.dispatchEvent(progress('loadstart', 0, size));
        if (s.timeout) timer = setTimeout(() => { why = 'timeout'; stop.abort(); }, s.timeout);
        stop.signal.addEventListener('abort', () => { if (!why) why = 'abort'; end(why, 0, 0); }, { once: true });
        viaShell.call(window, s.url, { method: s.method, headers: s.headers, body, credentials: s.cred ? 'include' : 'same-origin', signal: stop.signal }).then(async res => {
          if (!live()) return;
          if (upload) { this.upload.dispatchEvent(progress('progress', size, size)); this.upload.dispatchEvent(progress('load', size, size)); this.upload.dispatchEvent(progress('loadend', size, size)); }
          s.status = res.status; s.statusText = res.statusText; s.resHeaders = [...res.headers]; s.url2 = res.url || s.url;
          s.ready = 2; this.dispatchEvent(new Event('readystatechange'));
          const raw = await res.arrayBuffer(); if (!live()) return;
          s.raw = raw;
          const cs = /charset=([^;]+)/i.exec(s.mime || res.headers.get('content-type') || '');
          try { s.text = new TextDecoder(cs ? cs[1].trim().replace(/^"|"$/g, '') : 'utf-8').decode(raw); } catch (_) { s.text = new TextDecoder().decode(raw); }
          s.ready = 3; this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(progress('progress', raw.byteLength, raw.byteLength));
          end('load', raw.byteLength, raw.byteLength);
        }, () => { if (live()) end('error', 0, 0); });
      }
      abort() {
        const s = this.#s;
        if (s.sync) return s.sync.abort();
        if (s.stop) { s.stop.abort(); s.ready = 0; return; }
        if (s.ready === 4) { s.ready = 0; s.status = 0; }
      }
    }
    for (const [k, v] of Object.entries({ UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 })) {
      Object.defineProperty(XMLHttpRequest, k, { value: v, enumerable: true });
      Object.defineProperty(XMLHttpRequest.prototype, k, { value: v, enumerable: true });
    }
    try {
      Object.defineProperty(window, 'XMLHttpRequest', { configurable: true, writable: true, value: XMLHttpRequest });
      Object.defineProperty(window, 'XMLHttpRequestUpload', { configurable: true, writable: true, value: XMLHttpRequestUpload });
    } catch (_) {}
    /* WebSocket to this host goes through the shell too (ws.open): an opaque page's own socket goes out with
     * `Origin: null` and no cookies, and a server that checks the Origin (the Recorder's live transcript) refuses it.
     * The shell opens it inside this window's own app path only. The server's messages come back as `ws` notices; the
     * page's go as ws.send, in the page's order, at most WS_INFLIGHT on the way at once (bufferedAmount counts the
     * rest). It keeps the usual shape: readyState, url, protocol, extensions, binaryType (blob or arraybuffer),
     * bufferedAmount, open / message / error / close, send (text, ArrayBuffer, a view or a Blob) and close(code,
     * reason). Another site's socket, an address the shell won't open for this app (`outside`), or a window with no
     * shell channel gets the browser's own WebSocket, as before. */
    if (typeof window.WebSocket === 'function' && typeof EventTarget === 'function') {
      const NativeWS = window.WebSocket, WS_EVENTS = ['open', 'message', 'error', 'close'], WS_INFLIGHT = 8;
      const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, bytes = t => new TextEncoder().encode(t).byteLength;
      const wsFail = (what, m, name) => new DOMException("Failed to " + what + " 'WebSocket': " + m, name);
      const isBlob = x => typeof Blob === 'function' && x instanceof Blob;
      class WebSocket extends EventTarget {
        #url = ''; #ready = 0; #protocol = ''; #ext = ''; #bin = 'blob'; #buffered = 0; #key = ''; #c = null; #native = null;
        #out = []; #busy = 0; #chain = Promise.resolve(); #early = [];
        constructor(url, protocols) {
          if (arguments.length < 1) throw new TypeError("Failed to construct 'WebSocket': 1 argument required, but only 0 present.");
          let u;
          try { u = new URL(String(url), location.href); } catch (_) { throw wsFail('construct', "The URL '" + url + "' is invalid.", 'SyntaxError'); }
          if (u.protocol === 'http:') u.protocol = 'ws:'; else if (u.protocol === 'https:') u.protocol = 'wss:';
          if (!/^wss?:$/.test(u.protocol)) throw wsFail('construct', "The URL's scheme must be either 'http', 'https', 'ws', or 'wss'.", 'SyntaxError');
          u.hash = '';
          const list = protocols === undefined ? [] : typeof protocols === 'string' ? [protocols] : Array.from(protocols, String);
          if (list.some(p => !TOKEN.test(p)) || new Set(list).size !== list.length) throw wsFail('construct', 'The subprotocol is invalid or duplicated.', 'SyntaxError');
          const own = new URL(u.href); own.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
          if (own.origin !== location.origin) return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
          super();
          for (const t of WS_EVENTS) {
            let h = null;
            Object.defineProperty(this, 'on' + t, { configurable: true, enumerable: true, get: () => h,
              set: v => { if (h) this.removeEventListener(t, h); h = typeof v === 'function' ? v : null; if (h) this.addEventListener(t, h); } });
          }
          this.#url = u.href;
          this.#key = 'ws-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          this.#open(list, protocols);
        }
        get url() { return this.#url; }
        get readyState() { return this.#native ? this.#native.readyState : this.#ready; }
        get protocol() { return this.#native ? this.#native.protocol : this.#protocol; }
        get extensions() { return this.#native ? this.#native.extensions : this.#ext; }
        get bufferedAmount() { return this.#native ? this.#native.bufferedAmount : this.#buffered; }
        get binaryType() { return this.#bin; }
        set binaryType(v) { if (v !== 'blob' && v !== 'arraybuffer') return; this.#bin = v; if (this.#native) this.#native.binaryType = v; }
        async #open(list, protocols) {
          const c = await channel();
          if (this.#ready !== 0) return this.#gone(1006, '', false); // closed while it waited for the shell
          if (!c) return this.#viaNative(protocols);
          this.#c = c; sockets.set(this.#key, d => this.#hear(d));
          let v;
          try { v = await c.request('ws.open', { key: this.#key, url: this.#url, protocols: list }, 60000); } catch (err) {
            sockets.delete(this.#key); this.#c = null;
            if ((err?.code === 'outside' || err?.code === 'unavailable') && this.#ready === 0) return this.#viaNative(protocols);
            return this.#gone(1006, '', false);
          }
          if (this.#ready !== 0) return; // close() meanwhile: its close comes from the shell
          this.#protocol = typeof v?.ws?.protocol === 'string' ? v.ws.protocol : '';
          this.#ext = typeof v?.ws?.extensions === 'string' ? v.ws.extensions : '';
          this.#ready = 1; this.dispatchEvent(new Event('open'));
          for (const d of this.#early.splice(0)) this.#hear(d);
          this.#pump();
        }
        // A notice from the shell for this socket: a message from the server, its close, or the end of the channel.
        #hear(d) {
          if (d.event === 'reset') return this.#gone(1006, '', false);
          if (this.#ready === 0) { this.#early.push(d); return; }
          if (d.event === 'close') return this.#gone(d.code, d.reason, d.wasClean);
          if (d.event !== 'message' || this.#ready !== 1) return;
          const data = typeof d.data !== 'string' && this.#bin === 'blob' ? new Blob([d.data]) : d.data;
          this.dispatchEvent(new MessageEvent('message', { data, origin: new URL(this.#url).origin }));
        }
        #gone(code, reason, clean) {
          if (this.#ready === 3) return;
          this.#ready = 3; this.#out.length = 0; this.#early.length = 0;
          sockets.delete(this.#key);
          if (!clean) this.dispatchEvent(new Event('error'));
          this.dispatchEvent(new CloseEvent('close', { code, reason: reason || '', wasClean: !!clean }));
        }
        #viaNative(protocols) {
          if (this.#ready !== 0) return this.#gone(1006, '', false);
          let n;
          try { n = protocols === undefined ? new NativeWS(this.#url) : new NativeWS(this.#url, protocols); } catch (_) { return this.#gone(1006, '', false); }
          this.#native = n; n.binaryType = this.#bin;
          n.addEventListener('open', () => this.dispatchEvent(new Event('open')));
          n.addEventListener('message', e => this.dispatchEvent(new MessageEvent('message', { data: e.data, origin: e.origin })));
          n.addEventListener('error', () => this.dispatchEvent(new Event('error')));
          n.addEventListener('close', e => { this.#ready = 3; this.dispatchEvent(new CloseEvent('close', { code: e.code, reason: e.reason, wasClean: e.wasClean })); });
        }
        send(data) {
          if (arguments.length < 1) throw new TypeError("Failed to execute 'send' on 'WebSocket': 1 argument required, but only 0 present.");
          if (this.#native) return this.#native.send(data);
          if (this.#ready === 0) throw wsFail('execute \'send\' on', 'Still in CONNECTING state.', 'InvalidStateError');
          let item;
          if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') item = data.slice(0);
          else if (ArrayBuffer.isView(data)) item = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          else if (isBlob(data)) item = data;
          else item = String(data);
          const n = typeof item === 'string' ? bytes(item) : isBlob(item) ? item.size : item.byteLength;
          this.#buffered += n;
          if (this.#ready !== 1) return; // closing or closed: counted, never sent (as the browser does)
          this.#out.push([item, n]); this.#pump();
        }
        // Sends what waits, in order (a Blob is read first, on the same chain), with at most WS_INFLIGHT on the way.
        #pump() {
          while (this.#ready === 1 && this.#busy < WS_INFLIGHT && this.#out.length) {
            const [item, n] = this.#out.shift(), c = this.#c, key = this.#key;
            this.#busy++;
            const done = () => { this.#busy--; this.#buffered = Math.max(0, this.#buffered - n); this.#pump(); };
            // The chain waits only for a Blob's bytes, never for the shell's answer, so up to WS_INFLIGHT are on the way.
            this.#chain = this.#chain.then(async () => {
              const data = isBlob(item) ? await item.arrayBuffer() : item;
              if (this.#ready !== 1 || this.#c !== c) return done();
              c.request('ws.send', { key, data }, 30000).then(done, () => { done(); this.#gone(1006, '', false); });
            }).catch(done);
          }
        }
        close(code, reason) {
          if (code !== undefined) {
            code = Number(code);
            if (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999))) throw wsFail('execute \'close\' on', 'The close code must be either 1000, or between 3000 and 4999.', 'InvalidAccessError');
          }
          if (reason !== undefined) { reason = String(reason); if (bytes(reason) > 123) throw wsFail('execute \'close\' on', 'The close reason must not be greater than 123 UTF-8 bytes.', 'SyntaxError'); }
          if (this.#native) return this.#native.close(...arguments);
          if (this.#ready >= 2) return;
          this.#ready = 2; this.#out.length = 0;
          // Not open yet: it never opens (error, then close 1006). Open: the closing handshake runs in the shell and its
          // close comes back as a notice.
          if (this.#c) this.#c.request('ws.close', { key: this.#key, ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) }, 10000).catch(() => this.#gone(1006, '', false));
        }
      }
      for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
        Object.defineProperty(WebSocket, k, { value: v, enumerable: true });
        Object.defineProperty(WebSocket.prototype, k, { value: v, enumerable: true });
      }
      try { Object.defineProperty(window, 'WebSocket', { configurable: true, writable: true, value: WebSocket }); } catch (_) {}
    }
  })();
  /* IndexedDB under the boundary: the browser refuses IndexedDB to an opaque origin (open throws), so the page gets a
   * stand-in with the same classes, requests and events (Music keeps its offline clips there, Files its video frames).
   * The shell keeps the app's databases (browser-boundary.js appIdb, under this window's installed app id only).
   * Opening one reads it whole from the shell once (`idb.load`); requests then run on this page's copy, in order, one
   * transaction at a time. A readwrite transaction's changes go to the shell together when it ends (`idb.commit`), and
   * `complete` fires only once the shell has written them; if it could not (the app's space is full), `abort` fires with
   * QuotaExceededError and nothing changed. When another window of the same app commits, this page reads the database
   * again before its next transaction (`idb` notice). Keys compare with the browser's own `indexedDB.cmp`, ranges are
   * the browser's own IDBKeyRange, and values are copies (structuredClone), as in the real one. A page that is not in a
   * Wizard window gets an `error` on open. */
  let idbNotice = () => {};
  if (opaque && typeof window.indexedDB?.cmp === 'function' && typeof structuredClone === 'function') (() => {
    const real = window.indexedDB, KeyRange = window.IDBKeyRange;
    try { const r = real.open('\u0000wz-probe'); r.onsuccess = () => { try { r.result.close(); real.deleteDatabase('\u0000wz-probe'); } catch (_) {} }; return; } catch (_) {}
    const cmp = (a, b) => real.cmp(a, b);
    const fail = (name, message) => new DOMException(message || name, name);
    const validKey = k => { try { cmp(k, k); return true; } catch (_) { return false; } };
    const clone = v => { try { return structuredClone(v); } catch (e) { throw fail('DataCloneError', String(e?.message || 'The value could not be cloned.')); } };
    const S = new WeakMap(); // each stand-in object's own state
    const later = fn => setTimeout(fn, 0);
    const channel = () => boundaryClient().then(async c => { for (let i = 0; c && !c.ready && i < 100; i++) await new Promise(r => setTimeout(r, 100)); return c && c.ready ? c : null; });
    const call = (method, args, timeout = 60000) => channel().then(c => { if (!c) throw fail('UnknownError', 'IndexedDB works when this app is open inside Wizard.'); return c.request(method, args, timeout); });
    // on<type> handler properties, kept as event listeners (so the order and preventDefault work as in the browser).
    function handlers(C, types) {
      for (const t of types) {
        const k = Symbol(t);
        Object.defineProperty(C.prototype, 'on' + t, { configurable: true, enumerable: true,
          get() { return this[k]?.fn ?? null; },
          set(fn) { if (this[k]) this.removeEventListener(t, this[k].l); this[k] = null; if (typeof fn === 'function') { const l = e => fn.call(this, e); this[k] = { fn, l }; this.addEventListener(t, l); } } });
      }
    }
    /* A listener that throws aborts the transaction, as in the browser (dispatchEvent only reports the exception, so
     * each listener is wrapped and notes it; the exception is still reported). */
    const WRAPS = new WeakMap();
    class Target extends EventTarget {
      addEventListener(type, fn, opts) {
        if (!fn || (typeof fn !== 'function' && typeof fn.handleEvent !== 'function')) return super.addEventListener(type, fn, opts);
        const cap = typeof opts === 'boolean' ? opts : !!opts?.capture, key = type + '|' + cap, self = this;
        let mine = WRAPS.get(this); if (!mine) WRAPS.set(this, mine = new WeakMap());
        let m = mine.get(fn); if (!m) mine.set(fn, m = new Map());
        let w = m.get(key);
        if (!w) { w = function (e) { try { return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e); } catch (x) { S.get(self).threw = true; throw x; } }; m.set(key, w); }
        return super.addEventListener(type, w, opts);
      }
      removeEventListener(type, fn, opts) {
        const cap = typeof opts === 'boolean' ? opts : !!opts?.capture;
        return super.removeEventListener(type, (fn && WRAPS.get(this)?.get(fn)?.get(type + '|' + cap)) || fn, opts);
      }
    }
    // Dispatch; true when a listener threw.
    const fire = (t, ev) => { const s = S.get(t); s.threw = false; t.dispatchEvent(ev); const threw = s.threw; s.threw = false; return threw; };
    const nameList = list => { const a = [...list].sort(); return Object.freeze(Object.assign(a, { item: i => a[i] ?? null, contains: n => a.includes(n) })); };
    const validPath = p => (typeof p === 'string' ? p === '' || p.split('.').every(x => /^[$A-Za-z_][$\w]*$/.test(x)) : Array.isArray(p) && p.length > 0 && p.every(x => typeof x === 'string' && x !== '' && validPath(x)));
    function pathValue(v, p) {
      if (Array.isArray(p)) { const out = []; for (const x of p) { const k = pathValue(v, x); if (k === undefined) return undefined; out.push(k); } return out; }
      if (p === '') return v;
      let cur = v;
      for (const part of p.split('.')) { if (cur === null || (typeof cur !== 'object' && typeof cur !== 'string') || !(part in Object(cur))) return undefined; cur = cur[part]; }
      return cur;
    }
    function inject(v, p, key) {
      const parts = p.split('.'), last = parts.pop();
      let cur = v;
      for (const part of parts) { if (cur[part] === undefined) cur[part] = {}; cur = cur[part]; if (cur === null || typeof cur !== 'object') throw fail('DataError', 'The key path does not lead to an object.'); }
      cur[last] = key;
    }
    const range = (q, need) => {
      if (q === undefined || q === null) { if (need) throw fail('DataError', 'No key or key range was given.'); return null; }
      if (q instanceof KeyRange) return q;
      if (!validKey(q)) throw fail('DataError', 'The parameter is not a valid key.');
      return KeyRange.only(q);
    };
    const inRange = (r, k) => !r || r.includes(k);
    // One database in this page: its stores (rows sorted by key) and its queue: loading it, opening it, and the
    // transactions, run one after another.
    const models = new Map();
    function model(name) {
      let m = models.get(name);
      if (m) return m;
      m = { name, version: 0, rev: 0, stores: new Map(), queue: [], running: null, conns: new Set(), loaded: false };
      models.set(name, m);
      enqueue(m, { start: done => load(m).then(done, done) });
      return m;
    }
    function storeOf(info) { return { keyPath: info.keyPath ?? null, autoIncrement: info.autoIncrement === true, next: Number(info.next) || 1, indexes: new Map((info.indexes || []).map(([n, x]) => [n, { keyPath: x.keyPath, unique: x.unique === true, multiEntry: x.multiEntry === true }])), rows: [] }; }
    function load(m) {
      return call('idb.load', { name: m.name }).then(v => {
        const d = v?.idb;
        m.stores = new Map(); m.version = 0; m.rev = 0;
        if (d && typeof d === 'object') {
          m.version = Number(d.version) || 0; m.rev = Number(d.rev) || 0;
          for (const [s, info] of d.stores || []) m.stores.set(s, storeOf(info));
          for (const [s, rows] of d.rows || []) { const st = m.stores.get(s); if (st) st.rows = rows.map(([k, x]) => ({ k, v: x })).sort((a, b) => cmp(a.k, b.k)); }
        }
        m.loaded = true; m.error = null;
      }, e => { m.loaded = false; m.error = e; });
    }
    function enqueue(m, item) { m.queue.push(item); pump(m); }
    function pump(m) {
      if (m.running || !m.queue.length) return;
      const item = m.running = m.queue.shift();
      later(() => item.start(() => { m.running = null; pump(m); }));
    }
    // Another window of this app changed the database: read it again before the next transaction here.
    idbNotice = name => {
      const m = models.get(name);
      if (m && !m.queue.some(x => x.reload)) enqueue(m, { reload: true, start: done => load(m).then(done, done) });
    };
    const find = (rows, k) => { let lo = 0, hi = rows.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(rows[mid].k, k) < 0) lo = mid + 1; else hi = mid; } return lo; };
    // The entries a store or index reads, sorted: { key, pk, v }.
    function entries(st, ix) {
      if (!ix) return st.rows.map(r => ({ key: r.k, pk: r.k, v: r.v }));
      const out = [];
      for (const r of st.rows) {
        const k = pathValue(r.v, ix.keyPath);
        if (k === undefined) continue;
        if (ix.multiEntry && Array.isArray(k)) { const seen = []; for (const e of k) if (validKey(e) && !seen.some(x => cmp(x, e) === 0)) { seen.push(e); out.push({ key: e, pk: r.k, v: r.v }); } }
        else if (validKey(k)) out.push({ key: k, pk: r.k, v: r.v });
      }
      return out.sort((a, b) => cmp(a.key, b.key) || cmp(a.pk, b.pk));
    }
    const indexKeys = (ix, v) => { const k = pathValue(v, ix.keyPath); if (k === undefined) return []; if (ix.multiEntry && Array.isArray(k)) return k.filter(validKey); return validKey(k) ? [k] : []; };
    function unique(st, v, pk) {
      for (const [, ix] of st.indexes) {
        if (!ix.unique) continue;
        for (const k of indexKeys(ix, v)) for (const r of st.rows) if (cmp(r.k, pk) !== 0 && indexKeys(ix, r.v).some(x => cmp(x, k) === 0)) throw fail('ConstraintError', 'A unique index already has this key.');
      }
    }

    class IDBRequest extends Target {
      constructor(source, tx) { super(); S.set(this, { source, tx, result: undefined, error: null, done: false }); }
      get result() { const s = S.get(this); if (!s.done) throw fail('InvalidStateError', 'The request has not finished.'); return s.result; }
      get error() { const s = S.get(this); if (!s.done) throw fail('InvalidStateError', 'The request has not finished.'); return s.error; }
      get source() { return S.get(this).source; }
      get transaction() { return S.get(this).tx; }
      get readyState() { return S.get(this).done ? 'done' : 'pending'; }
    }
    handlers(IDBRequest, ['success', 'error']);
    class IDBOpenDBRequest extends IDBRequest {}
    handlers(IDBOpenDBRequest, ['upgradeneeded', 'blocked']);
    class IDBVersionChangeEvent extends Event {
      constructor(type, init = {}) { super(type, init); this.oldVersion = init.oldVersion ?? 0; this.newVersion = init.newVersion ?? null; }
    }
    const settle = (req, result, error) => { const s = S.get(req); s.done = true; s.result = error ? undefined : result; s.error = error || null; };

    class IDBTransaction extends Target {
      constructor(db, names, mode) {
        super();
        const m = S.get(db).model;
        S.set(this, { db, m, names, mode, queue: [], state: 'active', error: null, ops: [], before: null, started: false });
        const s = S.get(this);
        if (mode !== 'readonly') s.before = new Map([...m.stores].map(([n, st]) => [n, { ...st, indexes: new Map(st.indexes), rows: st.rows.slice() }]));
        if (mode === 'versionchange') s.beforeVersion = m.version;
      }
      get db() { return S.get(this).db; }
      get mode() { return S.get(this).mode; }
      get durability() { return 'default'; }
      get error() { return S.get(this).error; }
      get objectStoreNames() { const s = S.get(this); return nameList(s.mode === 'versionchange' ? s.m.stores.keys() : s.names); }
      objectStore(name) {
        const s = S.get(this);
        if (s.state === 'done') throw fail('InvalidStateError', 'The transaction has finished.');
        if ((s.mode !== 'versionchange' && !s.names.includes(name)) || !s.m.stores.has(name)) throw fail('NotFoundError', 'No object store named ' + name + '.');
        return new IDBObjectStore(this, name);
      }
      abort() {
        const s = S.get(this);
        if (s.state === 'done' || s.state === 'committing') throw fail('InvalidStateError', 'The transaction has finished.');
        txAbort(this, null);
      }
      commit() { const s = S.get(this); if (s.state !== 'active') throw fail('InvalidStateError', 'The transaction is not active.'); }
    }
    handlers(IDBTransaction, ['complete', 'error', 'abort']);
    // Queue a request in the transaction; `op` runs when its turn comes and returns the result (or throws).
    function queueRequest(tx, source, op, req) {
      const s = S.get(tx);
      if (s.state !== 'active') throw fail('TransactionInactiveError', 'The transaction is not active.');
      req = req || new IDBRequest(source, tx);
      s.queue.push({ req, op });
      return req;
    }
    function txRun(tx, done) {
      const s = S.get(tx);
      s.done = done; s.started = true;
      const step = () => {
        if (s.state !== 'active') return;
        const r = s.queue.shift();
        if (!r) return txFinish(tx);
        let result, error = null;
        try { result = r.op(); } catch (e) { error = e instanceof DOMException ? e : fail('UnknownError', String(e?.message || e)); }
        settle(r.req, result, error);
        if (!error) { if (fire(r.req, new Event('success')) && s.state === 'active') return txAbort(tx, fail('AbortError', 'A success handler threw.')); }
        else {
          const ev = new Event('error', { bubbles: true, cancelable: true });
          const threw = fire(r.req, ev);
          let kept = ev.defaultPrevented && !threw;
          if (!kept && s.state === 'active') { const e2 = new Event('error', { cancelable: true }); tx.dispatchEvent(e2); kept = e2.defaultPrevented; }
          if (!kept && s.state === 'active') { const e3 = new Event('error', { cancelable: true }); s.db.dispatchEvent(e3); kept = e3.defaultPrevented; }
          if (!kept && s.state === 'active') return txAbort(tx, error);
        }
        later(step);
      };
      later(step);
    }
    function txFinish(tx) {
      const s = S.get(tx);
      s.state = 'committing';
      const complete = () => { s.state = 'done'; s.before = null; later(() => { tx.dispatchEvent(new Event('complete')); s.onEnd?.(true); s.done?.(); }); };
      if (s.mode === 'readonly' || !s.ops.length) return complete();
      // `base`: the shell's revision this page's copy is at. If another window of the app committed since, the shell
      // refuses (`stale`): this transaction aborts and the page reads the database again, so it never overwrites a
      // change it did not see (a key generator's number, a unique index).
      call('idb.commit', { name: s.m.name, ops: s.ops, base: s.m.rev }).then(v => {
        if (v && typeof v === 'object' && Number.isSafeInteger(v.idb?.rev)) { s.m.rev = v.idb.rev; return complete(); }
        if (v === 'stale') { s.m.queue.unshift({ reload: true, start: d => load(s.m).then(d, d) }); return txAbort(tx, fail('UnknownError', 'Another window of this app changed the database; try again.'), true); }
        txAbort(tx, fail('QuotaExceededError', 'This app\u2019s storage in Wizard is full.'), true);
      }, () => txAbort(tx, fail('UnknownError', 'Wizard could not save this change.'), true));
    }
    function txAbort(tx, error, committing) {
      const s = S.get(tx);
      if (s.state === 'done' || (s.state === 'committing' && !committing)) return;
      s.state = 'done'; s.error = error;
      if (s.before) s.m.stores = s.before;
      if (s.mode === 'versionchange') s.m.version = s.beforeVersion;
      const pending = s.queue.splice(0);
      later(() => {
        for (const r of pending) { settle(r.req, undefined, fail('AbortError', 'The transaction was aborted.')); r.req.dispatchEvent(new Event('error', { bubbles: true, cancelable: true })); }
        tx.dispatchEvent(new Event('abort', { bubbles: true }));
        s.db.dispatchEvent(new Event('abort'));
        s.onEnd?.(false);
        if (s.started) s.done?.();
      });
      if (!s.started) enqueueDrop(s);
    }
    // A transaction aborted before its turn: it leaves the queue.
    function enqueueDrop(s) { const i = s.m.queue.indexOf(s.item); if (i >= 0) s.m.queue.splice(i, 1); }

    class IDBDatabase extends Target {
      constructor(m) { super(); S.set(this, { model: m, version: m.version, closed: false, upgrade: null }); }
      get name() { return S.get(this).model.name; }
      get version() { return S.get(this).version; }
      get objectStoreNames() { return nameList(S.get(this).model.stores.keys()); }
      close() { const s = S.get(this); s.closed = true; s.model.conns.delete(this); }
      transaction(names, mode = 'readonly') {
        const s = S.get(this);
        if (s.closed) throw fail('InvalidStateError', 'The database connection is closing.');
        if (s.upgrade && S.get(s.upgrade).state !== 'done') throw fail('InvalidStateError', 'A version change transaction is running.');
        if (mode !== 'readonly' && mode !== 'readwrite') throw new TypeError('The transaction mode must be readonly or readwrite.');
        const list = [...new Set(typeof names === 'string' ? [names] : Array.from(names || [], String))];
        if (!list.length) throw fail('InvalidAccessError', 'The transaction needs at least one object store.');
        for (const n of list) if (!s.model.stores.has(n)) throw fail('NotFoundError', 'No object store named ' + n + '.');
        const tx = new IDBTransaction(this, list, mode), ts = S.get(tx);
        // Requests may be placed until this task ends; the transaction starts in its turn.
        ts.item = { start: done => { if (ts.state === 'done') return done(); txRun(tx, done); } };
        enqueue(s.model, ts.item);
        return tx;
      }
      createObjectStore(name, opts = {}) {
        const tx = upgrading(this); name = String(name);
        const keyPath = opts?.keyPath ?? null, autoIncrement = opts?.autoIncrement === true;
        if (keyPath !== null && !validPath(keyPath)) throw fail('SyntaxError', 'The key path is not valid.');
        const m = S.get(this).model;
        if (m.stores.has(name)) throw fail('ConstraintError', 'An object store named ' + name + ' already exists.');
        if (autoIncrement && (keyPath === '' || Array.isArray(keyPath))) throw fail('InvalidAccessError', 'An auto-increment store needs a simple key path.');
        const kp = Array.isArray(keyPath) ? [...keyPath] : keyPath;
        m.stores.set(name, storeOf({ keyPath: kp, autoIncrement }));
        S.get(tx).ops.push({ o: 'store', s: name, keyPath: kp, autoIncrement });
        return new IDBObjectStore(tx, name);
      }
      deleteObjectStore(name) {
        const tx = upgrading(this), m = S.get(this).model; name = String(name);
        if (!m.stores.has(name)) throw fail('NotFoundError', 'No object store named ' + name + '.');
        m.stores.delete(name);
        S.get(tx).ops.push({ o: 'unstore', s: name });
      }
    }
    handlers(IDBDatabase, ['abort', 'close', 'error', 'versionchange']);
    function upgrading(db) {
      const tx = S.get(db).upgrade;
      if (!tx || S.get(tx).state !== 'active') throw fail('InvalidStateError', 'Object stores change only while the database upgrades.');
      return tx;
    }

    class IDBObjectStore {
      constructor(tx, name) { S.set(this, { tx, name }); }
      get name() { return S.get(this).name; }
      get transaction() { return S.get(this).tx; }
      get keyPath() { const p = this._st().keyPath; return Array.isArray(p) ? [...p] : p; }
      get autoIncrement() { return this._st().autoIncrement; }
      get indexNames() { return nameList(this._st().indexes.keys()); }
      _st() { const s = S.get(this), st = S.get(s.tx).m.stores.get(s.name); if (!st) throw fail('InvalidStateError', 'The object store was deleted.'); return st; }
      _write() { const ts = S.get(S.get(this).tx); if (ts.mode === 'readonly') throw fail('ReadOnlyError', 'The transaction is read-only.'); if (ts.state !== 'active') throw fail('TransactionInactiveError', 'The transaction is not active.'); return ts; }
      put(value, key) { return this._put(value, key, false); }
      add(value, key) { return this._put(value, key, true); }
      _put(value, key, add, req) {
        const ts = this._write(), st = this._st(), name = S.get(this).name;
        const v = clone(value);
        let k;
        if (st.keyPath !== null) {
          if (key !== undefined) throw fail('DataError', 'This store uses in-line keys: no key argument.');
          k = pathValue(v, st.keyPath);
          if (k === undefined) { if (!st.autoIncrement) throw fail('DataError', 'The value has no key at the key path.'); }
          else if (!validKey(k)) throw fail('DataError', 'The key at the key path is not valid.');
          else k = clone(k);
        } else if (key !== undefined) { if (!validKey(key)) throw fail('DataError', 'The key is not valid.'); k = clone(key); }
        else if (!st.autoIncrement) throw fail('DataError', 'This store needs a key.');
        return queueRequest(S.get(this).tx, this, () => {
          const cur = this._st();
          if (k === undefined) {
            if (cur.next > 9007199254740992) throw fail('ConstraintError', 'The key generator is used up.');
            k = cur.next++;
            if (cur.keyPath !== null) inject(v, cur.keyPath, k);
            ts.ops.push({ o: 'next', s: name, n: cur.next });
          } else if (cur.autoIncrement && typeof k === 'number' && k >= cur.next) { cur.next = Math.floor(k) + 1; ts.ops.push({ o: 'next', s: name, n: cur.next }); }
          const i = find(cur.rows, k), has = i < cur.rows.length && cmp(cur.rows[i].k, k) === 0;
          if (add && has) throw fail('ConstraintError', 'A record with this key already exists.');
          unique(cur, v, k);
          if (has) cur.rows[i] = { k, v }; else cur.rows.splice(i, 0, { k, v });
          ts.ops.push({ o: 'put', s: name, k, v });
          return clone(k);
        }, req);
      }
      delete(query) {
        const ts = this._write(), r = range(query, true), name = S.get(this).name;
        return queueRequest(S.get(this).tx, this, () => {
          const cur = this._st();
          cur.rows = cur.rows.filter(row => { if (!r.includes(row.k)) return true; ts.ops.push({ o: 'del', s: name, k: row.k }); return false; });
        });
      }
      clear() {
        const ts = this._write(), name = S.get(this).name;
        return queueRequest(S.get(this).tx, this, () => { this._st().rows = []; ts.ops.push({ o: 'clear', s: name }); });
      }
      _list() { return entries(this._st(), null); }
      get(query) { return read(this, query, true, l => (l[0] ? clone(l[0].v) : undefined)); }
      getKey(query) { return read(this, query, true, l => (l[0] ? clone(l[0].pk) : undefined)); }
      getAll(query, count) { return read(this, query, false, l => l.slice(0, count > 0 ? count : undefined).map(e => clone(e.v))); }
      getAllKeys(query, count) { return read(this, query, false, l => l.slice(0, count > 0 ? count : undefined).map(e => clone(e.pk))); }
      count(query) { return read(this, query, false, l => l.length); }
      openCursor(query, direction) { return openCursor(this, query, direction, false); }
      openKeyCursor(query, direction) { return openCursor(this, query, direction, true); }
      index(name) {
        const ts = S.get(S.get(this).tx);
        if (ts.state === 'done') throw fail('InvalidStateError', 'The transaction has finished.');
        if (!this._st().indexes.has(name)) throw fail('NotFoundError', 'No index named ' + name + '.');
        return new IDBIndex(this, name);
      }
      createIndex(name, keyPath, opts = {}) {
        const tx = S.get(this).tx, ts = S.get(tx);
        if (ts.mode !== 'versionchange' || ts.state !== 'active') throw fail('InvalidStateError', 'Indexes change only while the database upgrades.');
        const st = this._st(); name = String(name);
        if (st.indexes.has(name)) throw fail('ConstraintError', 'An index named ' + name + ' already exists.');
        if (!validPath(keyPath)) throw fail('SyntaxError', 'The key path is not valid.');
        if (opts?.multiEntry === true && Array.isArray(keyPath)) throw fail('InvalidAccessError', 'A multi-entry index needs a simple key path.');
        const ix = { keyPath: Array.isArray(keyPath) ? [...keyPath] : keyPath, unique: opts?.unique === true, multiEntry: opts?.multiEntry === true };
        st.indexes.set(name, ix);
        ts.ops.push({ o: 'index', s: S.get(this).name, i: name, ...ix });
        // Records already in the store that break a unique index abort the upgrade, as in the browser.
        if (ix.unique) { const l = entries(st, ix); for (let i = 1; i < l.length; i++) if (cmp(l[i - 1].key, l[i].key) === 0) { later(() => txAbort(tx, fail('ConstraintError', 'Existing records break the unique index ' + name + '.'))); break; } }
        return new IDBIndex(this, name);
      }
      deleteIndex(name) {
        const ts = S.get(S.get(this).tx);
        if (ts.mode !== 'versionchange' || ts.state !== 'active') throw fail('InvalidStateError', 'Indexes change only while the database upgrades.');
        const st = this._st();
        if (!st.indexes.delete(name)) throw fail('NotFoundError', 'No index named ' + name + '.');
        ts.ops.push({ o: 'unindex', s: S.get(this).name, i: name });
      }
    }
    class IDBIndex {
      constructor(store, name) { S.set(this, { store, name }); }
      get name() { return S.get(this).name; }
      get objectStore() { return S.get(this).store; }
      get keyPath() { const p = this._ix().keyPath; return Array.isArray(p) ? [...p] : p; }
      get unique() { return this._ix().unique; }
      get multiEntry() { return this._ix().multiEntry; }
      _ix() { const s = S.get(this), ix = s.store._st().indexes.get(s.name); if (!ix) throw fail('InvalidStateError', 'The index was deleted.'); return ix; }
      _list() { return entries(S.get(this).store._st(), this._ix()); }
      get(query) { return read(this, query, true, l => (l[0] ? clone(l[0].v) : undefined)); }
      getKey(query) { return read(this, query, true, l => (l[0] ? clone(l[0].pk) : undefined)); }
      getAll(query, count) { return read(this, query, false, l => l.slice(0, count > 0 ? count : undefined).map(e => clone(e.v))); }
      getAllKeys(query, count) { return read(this, query, false, l => l.slice(0, count > 0 ? count : undefined).map(e => clone(e.pk))); }
      count(query) { return read(this, query, false, l => l.length); }
      openCursor(query, direction) { return openCursor(this, query, direction, false); }
      openKeyCursor(query, direction) { return openCursor(this, query, direction, true); }
    }
    const txOf = src => (src instanceof IDBIndex ? S.get(S.get(src).store).tx : S.get(src).tx);
    function read(src, query, need, pick) {
      const r = range(query, need);
      return queueRequest(txOf(src), src, () => pick(src._list().filter(e => inRange(r, e.key))));
    }

    class IDBCursor {
      constructor(src, req, r, direction, keyOnly) { S.set(this, { src, req, r, direction, keyOnly, pos: null, got: false }); }
      get source() { return S.get(this).src; }
      get request() { return S.get(this).req; }
      get direction() { return S.get(this).direction; }
      get key() { const p = S.get(this).pos; return p ? clone(p.key) : undefined; }
      get primaryKey() { const p = S.get(this).pos; return p ? clone(p.pk) : undefined; }
      _again(fn) {
        const s = S.get(this);
        if (S.get(txOf(s.src)).state !== 'active') throw fail('TransactionInactiveError', 'The transaction is not active.');
        if (!s.got) throw fail('InvalidStateError', 'The cursor is moving or has finished.');
        s.got = false; S.get(s.req).done = false;
        queueRequest(txOf(s.src), s.src, () => fn(), s.req);
      }
      advance(n) { n = Number(n); if (!(n >= 1) || !Number.isInteger(n)) throw new TypeError('advance() needs a positive whole number.'); this._again(() => cursorStep(this, n)); }
      continue(key) {
        if (key !== undefined && !validKey(key)) throw fail('DataError', 'The key is not valid.');
        const s = S.get(this), prev = s.direction.startsWith('prev');
        if (key !== undefined && s.pos && (prev ? cmp(key, s.pos.key) >= 0 : cmp(key, s.pos.key) <= 0)) throw fail('DataError', 'The key is not past the cursor.');
        this._again(() => cursorStep(this, 1, key));
      }
      continuePrimaryKey(key, pk) {
        if (!validKey(key) || !validKey(pk)) throw fail('DataError', 'The key is not valid.');
        this._again(() => cursorStep(this, 1, key, pk));
      }
      update(value) {
        const s = S.get(this);
        if (s.keyOnly) throw fail('InvalidStateError', 'This cursor has no value.');
        if (!s.got) throw fail('InvalidStateError', 'The cursor is moving or has finished.');
        const store = s.src instanceof IDBIndex ? S.get(s.src).store : s.src, st = store._st(), v = clone(value);
        if (st.keyPath !== null) { const k = pathValue(v, st.keyPath); if (k === undefined || !validKey(k) || cmp(k, s.pos.pk) !== 0) throw fail('DataError', 'The new value\u2019s key does not match the cursor.'); return store._put(v, undefined, false); }
        return store._put(v, s.pos.pk, false);
      }
      delete() {
        const s = S.get(this);
        if (s.keyOnly) throw fail('InvalidStateError', 'This cursor has no value.');
        if (!s.got) throw fail('InvalidStateError', 'The cursor is moving or has finished.');
        const store = s.src instanceof IDBIndex ? S.get(s.src).store : s.src;
        return store.delete(s.pos.pk);
      }
    }
    class IDBCursorWithValue extends IDBCursor {
      get value() { const p = S.get(this).pos; return p ? clone(p.v) : undefined; }
    }
    const DIRECTIONS = ['next', 'nextunique', 'prev', 'prevunique'];
    function openCursor(src, query, direction = 'next', keyOnly) {
      if (!DIRECTIONS.includes(direction)) throw new TypeError('Unknown cursor direction ' + direction + '.');
      const r = range(query, false), req = new IDBRequest(src, txOf(src));
      const c = keyOnly ? new IDBCursor(src, req, r, direction, true) : new IDBCursorWithValue(src, req, r, direction, false);
      return queueRequest(txOf(src), src, () => cursorStep(c, 1), req);
    }
    // Move the cursor n entries in its direction (past `key` / `pk` when given), reading the store as it is now.
    function cursorStep(c, n, key, pk) {
      const s = S.get(c), prev = s.direction.startsWith('prev'), uniq = s.direction.endsWith('unique');
      let list = s.src._list().filter(e => inRange(s.r, e.key));
      if (prev) list = list.reverse();
      const after = e => {
        if (!s.pos) return true;
        const d = cmp(e.key, s.pos.key) * (prev ? -1 : 1);
        if (uniq) return d > 0;
        return d > 0 || (d === 0 && cmp(e.pk, s.pos.pk) * (prev ? -1 : 1) > 0);
      };
      const reach = e => {
        if (key === undefined) return true;
        const d = cmp(e.key, key) * (prev ? -1 : 1);
        if (pk === undefined) return d >= 0;
        return d > 0 || (d === 0 && cmp(e.pk, pk) * (prev ? -1 : 1) >= 0);
      };
      let found = null;
      for (let i = 0; i < list.length && n > 0; i++) {
        let e = list[i];
        if (!after(e) || !reach(e)) continue;
        // prevunique stops on each key's first record (the lowest primary key), as the browser does.
        if (uniq && prev) { let j = i; while (j + 1 < list.length && cmp(list[j + 1].key, e.key) === 0) j++; e = list[j]; i = j; }
        n--; s.pos = e;
        if (!n) found = e;
      }
      if (!found) { s.pos = null; s.got = false; return null; }
      s.got = true;
      return c;
    }

    class IDBFactory {
      open(name, version) {
        if (arguments.length < 1) throw new TypeError('open() needs a name.');
        name = String(name);
        if (version !== undefined) { version = Number(version); if (!Number.isInteger(version) || version < 1 || version > 9007199254740991) throw new TypeError('The version must be a positive whole number.'); }
        const req = new IDBOpenDBRequest(null, null), m = model(name);
        enqueue(m, { start: done => {
          if (!m.loaded) { settle(req, undefined, m.error instanceof DOMException ? m.error : fail('UnknownError', 'IndexedDB works when this app is open inside Wizard.')); req.dispatchEvent(new Event('error', { cancelable: true })); m.queue.unshift({ start: d2 => load(m).then(d2, d2) }); return done(); }
          const old = m.version, want = version ?? (old || 1);
          if (want < old) { settle(req, undefined, fail('VersionError', 'The database is already at version ' + old + '.')); req.dispatchEvent(new Event('error', { cancelable: true })); return done(); }
          const db = new IDBDatabase(m);
          m.conns.add(db);
          if (want === old) { settle(req, db); req.dispatchEvent(new Event('success')); return done(); }
          // Upgrade: other connections here hear about it; a versionchange transaction runs the app's upgradeneeded.
          for (const o of m.conns) if (o !== db) o.dispatchEvent(new IDBVersionChangeEvent('versionchange', { oldVersion: old, newVersion: want }));
          const tx = new IDBTransaction(db, [], 'versionchange'), ts = S.get(tx);
          S.get(db).upgrade = tx;
          m.version = want; S.get(db).version = want;
          ts.ops.push({ o: 'version', v: want });
          S.get(req).tx = tx;
          ts.onEnd = ok => {
            S.get(req).tx = null;
            if (ok) { settle(req, db); req.dispatchEvent(new Event('success')); return; }
            S.get(db).version = old; db.close();
            settle(req, undefined, fail('AbortError', 'The upgrade was aborted.')); req.dispatchEvent(new Event('error', { cancelable: true }));
          };
          settle(req, db); S.get(req).done = true;
          const threw = fire(req, new IDBVersionChangeEvent('upgradeneeded', { oldVersion: old, newVersion: want }));
          txRun(tx, done);
          // The app's upgrade threw: nothing of it is kept and the open fails, so the next open upgrades again.
          if (threw && ts.state === 'active') txAbort(tx, fail('AbortError', 'The upgradeneeded handler threw.'));
        } });
        return req;
      }
      deleteDatabase(name) {
        name = String(name);
        const req = new IDBOpenDBRequest(null, null), m = model(name);
        enqueue(m, { start: done => {
          const old = m.version;
          for (const o of m.conns) o.dispatchEvent(new IDBVersionChangeEvent('versionchange', { oldVersion: old, newVersion: null }));
          call('idb.drop', { name }).then(ok => {
            if (ok !== true) throw fail('UnknownError', 'Wizard could not delete the database.');
            m.stores = new Map(); m.version = 0; m.rev = 0;
            settle(req, undefined); req.dispatchEvent(new IDBVersionChangeEvent('success', { oldVersion: old, newVersion: null }));
          }).catch(e => { settle(req, undefined, e instanceof DOMException ? e : fail('UnknownError', String(e?.message || e))); req.dispatchEvent(new Event('error', { cancelable: true })); }).finally(done);
        } });
        return req;
      }
      databases() { return call('idb.list', {}).then(v => (Array.isArray(v?.idb) ? v.idb.map(x => ({ name: String(x.name), version: Number(x.version) || 0 })) : [])); }
      cmp(a, b) { return cmp(a, b); }
    }
    const factory = new IDBFactory();
    try { Object.defineProperty(window, 'indexedDB', { configurable: true, enumerable: true, get: () => factory }); } catch (_) { return; }
    // The classes too, so a library's `instanceof IDBRequest` (idb, Dexie) sees the stand-ins.
    for (const [k, v] of Object.entries({ IDBFactory, IDBRequest, IDBOpenDBRequest, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBVersionChangeEvent })) {
      try { Object.defineProperty(window, k, { configurable: true, writable: true, value: v }); } catch (_) {}
    }
  })();
  /* document.cookie under the boundary: an opaque page may not read or write cookies (both throw SecurityError), which
   * stops a script that only checks one. The page gets a jar of its own for this document: what it writes it reads back;
   * nothing reaches its server or the shell, and the owner's sign-in cookies stay out of its reach (its calls to its own
   * backend carry them through the shell, above). */
  if (opaque) (() => {
    try { void document.cookie; return; } catch (_) {}
    const jar = new Map();
    try {
      Object.defineProperty(document, 'cookie', { configurable: true, enumerable: true,
        get: () => [...jar].map(([k, v]) => (k ? k + '=' + v : v)).join('; '),
        set: text => {
          const [pair, ...attrs] = String(text).split(';'), i = pair.indexOf('=');
          const k = (i < 0 ? '' : pair.slice(0, i)).trim(), v = (i < 0 ? pair : pair.slice(i + 1)).trim();
          let gone = false;
          for (const a of attrs) { const j = a.indexOf('='), n = (j < 0 ? a : a.slice(0, j)).trim().toLowerCase(), x = j < 0 ? '' : a.slice(j + 1).trim(); if ((n === 'max-age' && Number(x) <= 0) || (n === 'expires' && Date.parse(x) <= Date.now())) gone = true; }
          if (gone) jar.delete(k);
          else if (k.length + v.length <= 4096 && (jar.has(k) || jar.size < 180)) jar.set(k, v);
        } });
    } catch (_) {}
  })();
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
  const boundaryHooks = () => ({ onNet: d => netNotice(d), onIdb: n => idbNotice(n), onBack: back, onTheme: applyTheme, onTool: boundaryTool, onUpdate: v => { updateAvailable = v; notify(updates, v); }, onRefresh: r => refreshNow(r), onShare: () => pullShares(),
    onCapture: d => boundaryCapture.notice(d), onReady: () => { boundaryCapture.hello(); if (boundaryStorage && window.WizBoundaryClient) boundaryStorage.ready(window.WizBoundaryClient); }, keys: () => keyList(document), press: key => keyPress(key) });
  // A title-bar tap under the boundary arrives through the boundary client, not as a wizard:app:tool message.
  function boundaryTool(d) { if (!toolHandler || typeof d?.id !== 'string') return; try { toolHandler({ id: d.id, value: typeof d.value === 'string' ? d.value : undefined }); } catch (err) { console.warn('WizardApp tool', err); } }
  /* The photo viewer and navigation under the boundary (WizardApp.media.view, WizardApp.nav.*): the shell can't be
   * reached from this window, so each call goes to it as a request (app-services.js mediaView, navBack, threadOpen,
   * contextDraft, on the same rules as for a same-origin app). These calls answer at once, as they always have, so the
   * answer is true once the request is on its way; a refusal the shell sends back is only logged. */
  const shellNav = () => opaque && !service && transportReady;
  function shellAsk(op, args) {
    request(op, args).then(v => { if (v !== true) console.warn('WizardApp ' + op + ': not opened'); }, e => console.warn('WizardApp ' + op, e?.message || e));
    return true;
  }
  // Pictures: this host's own addresses go as they are; the page's own blob: pictures (its opaque origin's, which the shell
  // can't read) go as their bytes. Anything else is left out, and its place kept so the tapped item stays the one shown.
  function shellMedia(items, index) {
    if (!Array.isArray(items)) return false;
    let any = false;
    const list = items.slice(0, 500).map(it => {
      let u; try { u = new URL(String(it?.url || ''), location.href); } catch (_) { return {}; }
      const o = { kind: it?.kind === 'video' ? 'video' : 'image', name: String(it?.name || '').slice(0, 200), ...(it?.mime ? { mime: String(it.mime).slice(0, 100) } : {}) };
      if (u.protocol === 'blob:') { any = true; return fetch(u.href).then(r => r.blob()).then(blob => ({ ...o, blob }), () => ({})); }
      if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin) return {};
      any = true; return { ...o, url: u.href };
    });
    if (!any) return false;
    Promise.all(list).then(all => shellAsk('media.view', { items: all, index: Math.floor(+index) || 0 }));
    return true;
  }
  function shellThread(id, opts) {
    if (typeof id !== 'string' || !id || id.length > 512 || /[\s\x00-\x1f]/.test(id) || id === '__new__') throw new Error('Thread navigation unavailable');
    const o = {}, r = opts?.reply;
    if (r != null) o.reply = { key: String(r?.key || ''), title: r?.title == null ? undefined : String(r.title), message: r?.message == null ? undefined : String(r.message) };
    if (opts?.agent != null) o.agent = typeof opts.agent === 'string' ? opts.agent : '';
    if (opts?.draft != null) o.draft = typeof opts.draft === 'object' ? { text: opts.draft.text } : opts.draft;
    return shellAsk('nav.openThread', { id, opts: o });
  }
  function shellDraft(data) {
    if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || typeof data.title !== 'string' || data.title.length > 1000 || typeof data.message !== 'string' || data.message.length > 32000) throw new Error('Invalid app context');
    shellAsk('nav.openContextDraft', { id: data.id, title: data.title, message: data.message });
    // The shell keeps the draft's own id; nothing is ever sent from here.
    return Object.freeze({ kind: 'unsent-draft', id: null, sent: false });
  }
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
    nav: Object.freeze({ get threadAgents() { return service?.nav?.threadAgents === true || shellNav(); }, get threadDrafts() { return service?.nav?.threadDrafts === true || shellNav(); }, openThread: (id, opts) => service?.nav?.openThread(id, opts) === true || shellNav() && shellThread(id, opts),
      // Call after a finishing action (dismiss, archive, delete, save-and-close): returns the owner to the screen before the app.
      back: () => { try { return service?.nav?.back?.() === true || shellNav() && shellAsk('nav.back'); } catch (_) { return false; } }, openContextDraft: data => { if (shellNav()) return shellDraft(data); if (!service?.nav?.openContextDraft) throw new Error('Context drafts need the verified Wizard host'); return service.nav.openContextDraft(data); } }),
    theme: Object.freeze({ get: () => currentTheme || window.WizardTheme?.current || null, onChange: fn => listen(themes, fn, currentTheme || window.WizardTheme?.current) }),
    // Wizard's media viewer for the app's photos/videos ([{url, kind: 'image'|'video', name}], start index). Opened on
    // its own (no Wizard around it) the photo opens in a browser tab, which zooms natively.
    media: Object.freeze({ view: (items, index = 0) => {
      try { if (service?.media?.view) return service.media.view(items, index) === true; } catch (_) {}
      if (shellNav()) return shellMedia(items, index);
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
