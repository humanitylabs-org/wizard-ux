/* Browser owner boundary: sandboxed app frames (wizard-os#133). Off unless the box turned it on.
 *
 * core/shell-token.js runs first and sets window.WizShellBoundary only when the box ran `wam browser-boundary on`
 * (the page carried a shell-only token). Only then does this module turn on: app frames get `sandbox` WITHOUT
 * `allow-same-origin`, so an app page runs in an opaque origin. It cannot read the shell's storage or DOM, cannot reach
 * `parent.*`, and its owner calls carry no shell token (the Agent Service and App Manager refuse them).
 *
 * The shell then never reads an app document. Back, appearance and field insertion go through postMessage:
 *  - attach(frame) gives the frame a fresh random channel on every load and says `hello`; the app's
 *    core/browser-boundary-client.js answers `ready` on that channel (ready(frame), and a `wizard:boundary-ready`
 *    event on the frame element). Origin `null` is never an identity: a message is
 *    admitted only from the registered frame's own contentWindow with the current channel.
 *  - back(frame, onRoot): asks the app to go back one step. `handled` = the app did it; `atRoot` = onRoot() runs the
 *    shell's own next step. No answer (timeout) stays put, because a late answer may already have moved the app.
 *  - theme(frame, appearance, layer): the Appearance v1 context and the skin layer, pushed on change and again on
 *    every `ready`.
 *  - pinField(frame): the focused field in the focused app frame is sealed once; insert(text) puts text there only if
 *    the field did not change in between, release() lets it go.
 *  - field.focus: the app says (a boolean, nothing else) whether a text field has focus, so the shell's dictation
 *    (core/focused-field.js) can offer the orb for a sandboxed app; fieldState(frame) and onField(fn) expose it.
 *  - input: a click in the app (to focus its window), the window losing focus, Esc, bare ⌥ (the keys guide) and the
 *    ⌥ codes named by keys(codes) and by the running layout's layoutKeys(codes), never plain typing; the app holds exactly those back from its own page. The shell
 *    cannot tell a real key from a made-up one, so keys(codes) must only name keys that move around the owner's own
 *    windows. With a layout that presses app keys (pressAppKeys, the AI apps view) the app also reports its own
 *    data-wz-key controls (`keys.app`: key, label, box in its window) and forwards ⌥ + one of those keys; appKeys(frame)
 *    gives stand-ins for them, whose click() sends `keys.press` (the app presses its own control). onInput(fn) gets them for the focused, visible frame only; a click and a named ⌥ key also need the
 *    browser's transient user activation (a real click or key in the frame activates the shell too), so a page that
 *    only posts messages cannot press them at all.
 *  - service.request: the bounded app services the shell answers under the boundary: `ready`; the ones that act
 *    only on the app's own window, `badge.set` and `titlebar.set`; sharing out (`share.text`, `share.file`), which
 *    also needs the browser's transient user activation in that focused, visible frame and always opens the shell's own share
 *    sheet, where the owner picks (the shell's confirm); `share.wizard` (the same tap, then the shell's own Send to
 *    <agent> sheet, where the owner reads the text and sends or cancels); `voice.transcribe` (the box's transcriber,
 *    within a per-app budget); and `update.hold` / `update.release` (the app's unsaved work makes a shell update wait,
 *    for that window's current document only); and receiving shares (`share.receive`, `share.targets`, `share.pending`,
 *    `share.ack`), always for the window's own installed app id, where a pending item crosses as its share fields only;
 *    `audio.duck` (lower Wizard Music for that window, restored on its next load); and the fingerprint vault
 *    (`vault.has`, `vault.seal`, `vault.open`, `vault.forget`: the window's own app's secret, only while that window is
 *    in front, back only to the document that asked); and Wizard ID (`identity.info`, `identity.sign`,
 *    `identity.nip44_encrypt`, `identity.nip44_decrypt`, Android: an installed apps.json app only, the phone's own
 *    approval sheet only while that window is in front, back only to the document that asked); and recording
 *    (`capture.*`: the shell's one recorder, for the window's own app; preparing or starting a new recording needs a
 *    real tap in that window, events stream back as `notice` `capture`); and the app's own saved settings
 *    (`storage.load`, `storage.save`: see appStorage below); and the app's calls to its own backend (`net.fetch`: see
 *    net below).
 *    They are handed to the one server core/app-services.js registers (serve(fn)), which checks the
 *    frame against the installed app list and validates the data. Answers are protocol data only (a boolean, a share
 *    status, a transcript, the vault's `{ secret }` or `{ available, saved }`, Wizard ID's public info, signed event or
 *    NIP-44 result), and an answer is dropped if the frame got a new channel (a load) meanwhile. A title-bar
 *    tap goes back as `tool` on the current channel. Every new channel (a load) first clears that window's
 *    title-bar tools (onReset); the client sends its last badge and title bar again on each new channel.
 *  - notice(frame, kind, data): the shell's own notices to a ready app, on its current channel: `update` (a new
 *    shell is ready; only its version string crosses), `refresh` (read your data again; only the reason crosses) and
 *    `share` (a share was handed to this app: pull it; nothing else crosses) and `capture` (a recording event or this
 *    app's current recording, plain data and audio only) and `net` (a piece of a streamed answer to one of this
 *    document's own backend calls: bytes, end or error).
 *  - appStorage: a sandboxed page has no localStorage of its own (the browser refuses it to an opaque origin), so the
 *    app kit (core/app-client.js) gives it a stand-in and the shell keeps the data, per installed app id, in its own
 *    storage (`wos.app-storage.v1.<appId>`, 512K characters per app, 1.5M for all apps together). A new app window
 *    gets it at once through the frame's name (frameAttributes(url, appId) / storageName(appId)), with the app's own
 *    path (the page drops it outside that path), because a page reads its settings while it loads, before any message
 *    can arrive; `storage.load` answers a window that got none, and
 *    `storage.save` takes the page's changes (set, remove, clear) for the window's own app id only. Its IndexedDB the
 *    same way (appIdb: `idb.load`, `idb.commit`, `idb.drop`, `idb.list`; another window of the app hears `notice` `idb`).
 *  - net: an opaque page's own fetch to its app's backend goes out with `Origin: null` and no cookies, and the browser
 *    hides the answer (CORS), so app-client.js sends a `fetch` to this host as `net.fetch` and the shell makes it.
 *    core/app-services.js makes it only inside the window's own app path (the same rule as its links), never to an
 *    owner route (ownerRoute, the same list as core/shell-token.js, so no token is ever added). Only GET and HEAD
 *    follow a redirect, and only to an answer inside that path; any other method's redirect is never followed.
 *    `net.abort` stops one of the window's own open calls. At most NET_INFLIGHT at once per window, apart from the other services, and
 *    NET_MAX bytes each way. What crosses back is the status, the headers the browser shows a page and the body. A
 *    streamed call (`stream`: server-sent events, a reply written as it goes) gets its status and headers first and its
 *    body as `net` notices (bytes, end, error); `net.ack` says how much the page has taken, so the shell reads on only
 *    while little waits in between.
 *  - ws: an opaque page's own WebSocket goes out with `Origin: null` and no cookies, and an app server that checks the
 *    Origin refuses it, so app-client.js opens a socket to this host as `ws.open` and the shell opens it, on the same
 *    rule as net (the window's own app path, never an owner route). The server's messages come as `ws` notices (text or
 *    bytes, then its close); the page's messages go as `ws.send` and its close as `ws.close`. Every socket of a
 *    document ends with it.
 *  - link.open: the sandbox has no `allow-popups` or `allow-top-navigation`, and the shell can no longer patch the
 *    page's links (core/links.js guardFrame), so app-client.js hands a tapped link that leaves the window (a new tab,
 *    another site, a page outside the window's `home` path, window.open) to the shell, which opens it as it does for
 *    a same-origin app (WizLinks.follow). Only right after a real tap in that focused, visible window (TAPPED).
 *  - media.view, nav.*: the app's pictures in the shell's media viewer, and its navigation calls (Back after a finishing
 *    action, a thread, a Chats draft with its item), on the same rules as for a same-origin app (core/app-services.js
 *    mediaView, navBack, threadOpen, contextDraft). The page's own blob: pictures cross as their bytes.
 * Off (the default): nothing is defined and every frame is exactly as before.
 */
(() => {
  'use strict';
  if (window.WizBrowserBoundary) return;
  // On with this page's shell token (core/shell-token.js), or, without one (a shell or pinned app opened from the
  // offline copy), when this device saw the box turn the boundary on and has not seen it turn off since.
  const remembered = () => { try { return localStorage.getItem('wos.browser-boundary.v1') === '1'; } catch (_) { return false; } };
  if (!window.WizShellBoundary?.on && !remembered()) return;
  try { if (window.top !== window) return; } catch (_) { return; }
  const VERSION = 1, TYPE = 'wizard:boundary', ASK_MS = 1200, SANDBOX = 'allow-scripts allow-forms allow-downloads';
  const sessions = new Map(), pending = new Map(), fieldListeners = new Set(), inputListeners = new Set();
  const resetListeners = new Set(), SERVED = ['badge.set', 'titlebar.set', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'update.hold', 'update.release',
    'share.receive', 'share.targets', 'share.pending', 'share.ack', 'audio.duck', 'vault.has', 'vault.seal', 'vault.open', 'vault.forget',
    'identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt',
    'capture.sync', 'capture.prepare', 'capture.release', 'capture.start', 'capture.call', 'capture.settle', 'capture.pending', 'capture.ack', 'capture.confirm',
    'storage.load', 'storage.save', 'idb.load', 'idb.commit', 'idb.drop', 'idb.list', 'net.fetch', 'net.abort', 'net.ack', 'ws.open', 'ws.send', 'ws.close', 'link.open',
    'media.view', 'nav.back', 'nav.openThread', 'nav.openContextDraft'];
  // Sharing out and Share to Wizard open a shell sheet: only right after a real tap or key in that app window, never
  // from a page alone.
  // Preparing a recording (capture.prepare) needs the same tap; a new recording (capture.start) is checked by the server
  // with the tap it is handed (a fresh tap, or a recording this window prepared on one; a start on touch-down is held
  // until a tap confirms it, capture.confirm).
  // Opening a link (link.open: a new tab, another site, another app) needs the same tap, as a browser's own pop-up rule.
  const TAPPED = ['share.text', 'share.file', 'share.wizard', 'capture.prepare', 'link.open'], INFLIGHT = 4;
  // An app's own backend calls (net.fetch): a separate budget, so a slow call never blocks Back or the other services.
  const NET_INFLIGHT = 8, NET_MAX = 32 * 1024 * 1024;
  // Owner routes on this origin: the same list as core/shell-token.js OWNER (a test keeps them identical). An app's
  // net.fetch never goes there.
  const OWNER = /^\/(?:wizard\/|api\/|v1\/|wizard-os-home\/(?:api|store-install)\/|wizard-ux\/(?:api|store-install)\/)/;
  const ownerRoute = u => { try { const x = new URL(String(u), location.href); return x.origin === location.origin && (OWNER.test(x.pathname) || x.pathname.includes('//')); } catch (_) { return true; } };
  const NOTICE_REASONS = ['visible', 'focus', 'poll', 'agent'];
  // A share handed to this app (share.pending): only the item's own share fields, never the shell's record of it.
  const SHARE_KINDS = ['text', 'url', 'image', 'file'], SHARE_FIELDS = [['text', 200000], ['url', 8192], ['title', 1024], ['name', 255], ['mime', 255], ['target', 160]];
  const isBlob = f => !!f && ['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(f));
  function shareItem(x) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || x.id.length > 96 || !SHARE_KINDS.includes(x.kind)) return null;
    const o = { id: x.id, kind: x.kind, target: null };
    for (const [k, n] of SHARE_FIELDS) if (typeof x[k] === 'string' && x[k].length <= n) o[k] = x[k];
    if (Number.isFinite(x.size) && x.size >= 0) o.size = x.size;
    if (isBlob(x.file)) o.file = x.file;
    return o;
  }
  // What may cross back to the app: protocol data only, never a shell object. Shares go in batches of 32; the app's
  // client (app-client.js pullShares) asks again after a full batch.
  function shape(v) {
    // Recording (capture.*): the shell's recorder's own data for this app (session info, takes with their audio, chunk
    // lists), as plain data and audio only.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'capture' in v) return { capture: plain(v.capture) };
    // The app's own saved settings (storage.load): string keys and values only.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.store instanceof Map) return { store: Object.fromEntries([...v.store].filter(([k, x]) => typeof k === 'string' && typeof x === 'string')) };
    // The app's own IndexedDB (idb.load, idb.list): what this app stored there, as it stored it (appIdb below).
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'idb' in v) return { idb: v.idb };
    // An app's own backend answer (net.fetch): status, the headers a page may see, the body bytes and the final address.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.net && typeof v.net === 'object') return { net: netShape(v.net) };
    // An app's own socket that opened (ws.open): the subprotocol and extensions the server chose.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.ws && typeof v.ws === 'object') {
      const str = x => (typeof x === 'string' && x.length <= 1024 ? x : '');
      return { ws: { protocol: str(v.ws.protocol), extensions: str(v.ws.extensions) } };
    }
    if (Array.isArray(v)) return v.slice(0, 32).map(shareItem).filter(Boolean);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length <= 32 ? v : null;
    if (v && typeof v === 'object') {
      if (v.unavailable === true) return { unavailable: true };
      if (typeof v.text === 'string' && v.text.length <= 200000) return { text: v.text };
      // The fingerprint vault: the app's own secret (open), or whether one is saved (has, seal, forget).
      if (typeof v.secret === 'string' && v.secret.length <= 4096) return { secret: v.secret };
      if (typeof v.saved === 'boolean') return typeof v.available === 'boolean' ? { available: v.available, saved: v.saved } : { saved: v.saved };
      return identityShape(v);
    }
    return null;
  }
  function netShape(r) {
    const status = Number.isInteger(r.status) && r.status >= 200 && r.status <= 599 ? r.status : 502;
    const headers = Array.isArray(r.headers) ? r.headers.slice(0, 200).filter(h => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string' && h[0].length <= 256 && h[1].length <= 16384).map(h => [h[0], h[1]]) : [];
    const body = Object.prototype.toString.call(r.body) === '[object ArrayBuffer]' && r.body.byteLength <= NET_MAX ? r.body : null;
    // stream: the body follows as `net` notices (notice below), so none comes with the head.
    return { status, statusText: typeof r.statusText === 'string' ? r.statusText.slice(0, 256) : '', headers, body: r.stream === true ? null : body, ...(r.stream === true ? { stream: true } : {}), url: typeof r.url === 'string' && r.url.length <= 8192 ? r.url : '', redirected: r.redirected === true };
  }
  // Plain data only: JSON values, Blobs (recorded audio) and binary PCM. No functions, no shell objects, bounded size.
  const BINARY = v => Object.prototype.toString.call(v) === '[object ArrayBuffer]' || ArrayBuffer.isView(v);
  function plain(v, depth = 0) {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return v.length <= 200000 ? v : v.slice(0, 200000);
    if (typeof v !== 'object' || depth > 8) return undefined;
    if (isBlob(v) || BINARY(v)) return v;
    if (Array.isArray(v)) return v.slice(0, 4096).map(x => plain(x, depth + 1)).filter(x => x !== undefined);
    // A plain object only (its prototype is Object.prototype, or none): never a class instance or a host object.
    const proto = Object.getPrototypeOf(v);
    if (proto !== null && Object.getPrototypeOf(proto) !== null) return undefined;
    const o = {};
    for (const k of Object.keys(v).slice(0, 256)) { if (k === '__proto__') continue; const x = plain(v[k], depth + 1); if (x !== undefined) o[k] = x; }
    return o;
  }
  const CAPTURE_EVENTS = ['level', 'pcm', 'chunk', 'state', 'warn', 'info', 'current'];
  // Wizard ID (docs/WIZARD_ID.md): the owner's public info, a signed event, or a NIP-44 result; nothing else crosses.
  const HEX = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
  const short = (s, n) => (typeof s === 'string' && s.length <= n ? s : undefined);
  function identityShape(v) {
    for (const k of ['denied', 'cancelled', 'none']) if (v[k] === true) return { [k]: true };
    if (typeof v.ciphertext === 'string' && v.ciphertext.length <= 200000) return { ciphertext: v.ciphertext };
    if (typeof v.plaintext === 'string' && v.plaintext.length <= 200000) return { plaintext: v.plaintext };
    if (HEX(v.sig, 128) && HEX(v.id, 64) && HEX(v.pubkey, 64) && Number.isInteger(v.created_at) && Number.isInteger(v.kind) && typeof v.content === 'string'
      && Array.isArray(v.tags) && v.tags.every(t => Array.isArray(t) && t.every(x => typeof x === 'string'))) {
      return { id: v.id, pubkey: v.pubkey, created_at: v.created_at, kind: v.kind, tags: v.tags.map(t => t.slice()), content: v.content, sig: v.sig };
    }
    if (HEX(v.pubkey, 64) && typeof v.npub === 'string' && v.npub.length <= 100) {
      const o = { npub: v.npub, pubkey: v.pubkey };
      for (const k of ['name', 'picture']) if (short(v[k], 2048) !== undefined) o[k] = v[k];
      if (typeof v.backed_up === 'boolean') o.backed_up = v.backed_up;
      return o;
    }
    return null;
  }
  let serial = 0, claimed = [], server = null;
  // The ⌥ codes the shell takes: the desktop's own (keys(codes)) plus those of each layout that adds its own window
  // keys while it runs (layoutKeys(codes), e.g. the AI apps view's ⌥H Home and ⌥K search).
  let baseKeys = [];
  const layoutSets = new Set();
  const codeList = codes => (Array.isArray(codes) ? codes.filter(c => typeof c === 'string' && c.length <= 24).slice(0, 64) : []);
  function claimNow() {
    claimed = [...new Set([...baseKeys, ...[...layoutSets].flat()])].slice(0, 64);
    for (const st of sessions.values()) if (st.ready) { st.appSent = appOn(st); send(st, 'keys', keysMsg(st)); }
  }
  const appPressers = new Set();   // layouts that press app keys, each with the one frame it presses them in (its app in front)
  /* App keys (data-wz-key, docs/ai-apps-view.md › App keys): the app reports which of its controls carry an ⌥ key
   * (the key, a short label and where it sits in its own window), and the layout that presses app keys (pressAppKeys)
   * shows keycaps there and asks the app to press one (`keys.press`, by key only). The app can only ever press its own
   * controls, which it could do by itself; Wizard's own keys (RESERVED_LETTERS, digits, arrows…) are never app keys. */
  const RESERVED_LETTERS = 'hwsdvc', APP_PUNCT = { Slash: '/', Comma: ',', Period: '.', Semicolon: ';' }, APP_KEYS_MAX = 24;
  const appKeyOk = k => typeof k === 'string' && /^[a-z/,.;]$/.test(k) && !RESERVED_LETTERS.includes(k);
  const appKeyOf = code => { const m = /^Key([A-Z])$/.exec(String(code || '')); const k = m ? m[1].toLowerCase() : APP_PUNCT[code] || ''; return appKeyOk(k) ? k : ''; };
  const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000;
  function appKeyList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const t of list.slice(0, APP_KEYS_MAX)) {
      if (!t || typeof t !== 'object' || !appKeyOk(t.key) || ![t.x, t.y, t.w, t.h].every(num) || t.w <= 0 || t.h <= 0) continue;
      out.push(Object.freeze({ key: t.key, label: typeof t.label === 'string' ? t.label.slice(0, 64) : '', x: t.x, y: t.y, w: t.w, h: t.h }));
    }
    return out;
  }
  // Only the frame a layout presses app keys in (its app in front) reports and holds back its ⌥ keys; any other app
  // window keeps its own ⌥ shortcuts.
  const appOn = st => { for (const p of appPressers) { try { if (p() === st.frame) return true; } catch (_) {} } return false; };
  const keysMsg = st => ({ keys: claimed, app: appOn(st) });
  const helloMsg = st => ({ ...keysMsg(st), home: st.home || '' });
  function syncAppKeys() {
    for (const st of sessions.values()) {
      const on = appOn(st);
      if (!on) st.appKeys = [];
      if (st.ready && on !== !!st.appSent) send(st, 'keys', keysMsg(st));
      st.appSent = on;
    }
  }
  const fieldChanged = () => { for (const fn of [...fieldListeners]) { try { fn(); } catch (_) {} } };
  const newChannel = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const opaqueFrame = f => !!f && f.tagName === 'IFRAME' && f.hasAttribute('sandbox') && !String(f.getAttribute('sandbox')).split(/\s+/).includes('allow-same-origin') && !f.hasAttribute('srcdoc');
  const connected = st => !!st && st.frame.isConnected && sessions.get(st.frame) === st;
  // Per frame: the backend calls its current channel took and has not answered yet (hello `took`).
  const tooks = new WeakMap(), tookOf = f => { let t = tooks.get(f); if (!t) tooks.set(f, t = new Set()); return t; };
  function send(st, op, data = {}) {
    if (!connected(st)) return;
    // An opaque origin can only be addressed with '*'. Nothing sent here carries a credential: admission is the
    // frame's own WindowProxy plus the per-load channel.
    try { st.frame.contentWindow?.postMessage({ ...data, type: TYPE, version: VERSION, channel: st.channel, op }, '*'); } catch (_) {}
  }
  function revoke(st) {
    for (const [id, wait] of pending) if (wait.st === st) { clearTimeout(wait.timer); pending.delete(id); wait.resolve({ status: 'stale' }); }
    st.channel = newChannel(); st.ready = false; st.backPending = false; st.inflight = 0; st.netInflight = 0; st.appKeys = [];
    // A new document: whatever field it had focused is gone, and old dictation seals no longer match (gen).
    st.gen = (st.gen || 0) + 1; if (st.field) { st.field = false; fieldChanged(); }
    themedWin(st.frame)?.classList.remove('wz-themed');
    // Whatever the old document put in its window (title-bar tools) goes with it; the client sends it again.
    for (const fn of [...resetListeners]) { try { fn(st.frame); } catch (_) {} }
  }
  // One question to the app; the answer comes back as `reply` with the same id (or `timeout`).
  function ask(st, op, data = {}) {
    if (!connected(st) || !st.ready) return Promise.resolve({ status: 'unavailable' });
    if (pending.size >= 32) return Promise.resolve({ status: 'busy' });
    const id = 'wb-' + (++serial);
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ status: 'timeout' }); }, ASK_MS);
      pending.set(id, { st, resolve, timer }); send(st, op, { ...data, id });
    });
  }
  const themedWin = f => f.closest?.('.st-embed') || f.closest?.('.wl-embed') ? null : f.closest?.('.win');
  // The shell's own pages that run in an app window (Store, Agents, Setup, and the App Manager's Connections view in Settings) are shell code, not apps: they stay
  // same-origin so they keep their owner calls, which the top-level shell sends with the token
  // (core/shell-token.js armFrame). Same list as there.
  const SHELL_PAGE = /^\/(?:wizard-os-home|wizard-ux)\/(?:store|agents|setup|store-install\/_connections)\/(?:index\.html)?$/;
  const shellPage = url => {
    try { const u = new URL(String(url), location.href); return u.origin === location.origin && SHELL_PAGE.test(u.pathname); } catch (_) { return false; }
  };
  // Backstop for such a frame: if it ever lands on a same-origin page that is not one of the shell's own (none of
  // them navigates its frame elsewhere today), it is reloaded sandboxed like any app page. Another site's page can't
  // reach the shell, so it is left alone and checked again on its next load.
  const guarded = new WeakMap();
  function guard(frame) {
    if (guarded.has(frame)) return guarded.get(frame);
    const check = () => {
      if (!frame.isConnected || frame.hasAttribute('sandbox')) return;
      let href = '';
      try {
        const l = frame.contentWindow.location;
        if (l.href === 'about:blank' || (l.origin === location.origin && SHELL_PAGE.test(l.pathname))) return;
        if (l.origin !== location.origin) return;
        href = l.href;
      } catch (_) { return; }
      frame.setAttribute('sandbox', SANDBOX);
      attach(frame);
      frame.src = href;
    };
    // The window's own disposer (app-services) also ends a session the guard started later.
    const dispose = () => {
      frame.removeEventListener('load', check);
      guarded.delete(frame);
      sessions.get(frame)?.detach();
    };
    guarded.set(frame, dispose);
    frame.addEventListener('load', check);
    check();
    return dispose;
  }
  // The window's own app path (`home`, e.g. /notes/), told to the page in each hello so its links that leave it go to
  // the shell (link.open). The page knows its own address anyway; nothing else about the window crosses.
  // Encoded paths as within() allows them (/my%20app/), never an encoded slash, backslash, dot or percent.
  const HOME = /^\/(?:(?!\.\.?\/)[^/?#\\]+\/)+$/, ENCODED = /%(?:2f|5c|2e|25)/i;
  const homeOk = h => typeof h === 'string' && h.length <= 512 && HOME.test(h) && !ENCODED.test(h);
  function attach(frame, { home } = {}) {
    if (frame?.tagName === 'IFRAME' && !frame.hasAttribute('sandbox') && !frame.hasAttribute('srcdoc')) return guard(frame);
    if (!opaqueFrame(frame)) return () => {};
    const had = sessions.get(frame); if (had) { if (homeOk(home)) had.home = home; return had.detach; }
    const st = { frame, channel: newChannel(), ready: false, appearance: null, backPending: false, field: false, gen: 0,
      home: homeOk(home) ? home : '' };
    // `took`: the backend calls (net.fetch) the old channel accepted and has not answered. One the page sent that is
    // not listed never reached the app's server (it came on a channel this load had already ended), so the page sends it
    // again. Kept per frame, not per session, so a frame attached again still lists what its old session took.
    const hello = () => { const took = [...tookOf(frame)]; revoke(st); tooks.set(frame, new Set()); st.appSent = appOn(st); send(st, 'hello', { ...helloMsg(st), took }); };
    st.detach = () => { if (sessions.get(frame) !== st) return; frame.removeEventListener('load', hello); revoke(st); sessions.delete(frame); };
    sessions.set(frame, st);
    frame.addEventListener('load', hello); hello();
    return st.detach;
  }
  const visible = f => f.isConnected && !f.closest('[hidden], [inert]') && f.getClientRects().length > 0;
  // The browser's transient user activation: a real click or key in the app's frame also activates the shell (its
  // ancestor) for a few seconds; a page that only posts messages never gets it. No API: refuse.
  const activated = () => globalThis.navigator?.userActivation?.isActive === true;
  const focusedFrame = f => document.activeElement === f && (typeof document.hasFocus !== 'function' || document.hasFocus());
  // A finger lifting after a long press (hold to record) activates the frame and the shell but gives the frame no focus.
  // Such an activation came from a frame, not from the shell itself, when the shell saw no input of its own in the
  // activation's lifetime (Chromium: 5 s) and focus is not in another frame. Used only to confirm a held recording.
  let shellInputAt = 0;
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click']) {
    try { addEventListener(type, e => { if (e.isTrusted) shellInputAt = Date.now(); }, true); } catch (_) {}
  }
  const frameActivated = f => activated() && visible(f) && (focusedFrame(f) ||
    (Date.now() - shellInputAt > 5500 && !(document.activeElement?.tagName === 'IFRAME' && document.activeElement !== f)));
  const word = v => (typeof v === 'string' && v.length <= 32 ? v : '');
  function emit(frame, ev) { for (const fn of [...inputListeners]) { try { fn(frame, ev); } catch (_) {} } }
  function input(st, d) {
    if (!st.ready || !inputListeners.size) return;
    const frame = st.frame;
    if (d.kind === 'blur') return emit(frame, Object.freeze({ kind: 'blur' }));
    if (!visible(frame)) return;
    if (d.kind === 'pointer') { if (activated()) emit(frame, Object.freeze({ kind: 'pointer' })); return; }
    if (d.kind !== 'key' || (d.event !== 'keydown' && d.event !== 'keyup') || !focusedFrame(frame)) return;
    const ev = { kind: 'key', type: d.event, key: word(d.key), code: word(d.code), altKey: d.altKey === true, shiftKey: d.shiftKey === true,
      metaKey: d.metaKey === true, ctrlKey: d.ctrlKey === true, repeat: d.repeat === true, field: d.field === true, readOnly: d.readOnly === true };
    const esc = ev.key === 'Escape', bareAlt = ev.key === 'Alt' && !ev.metaKey && !ev.ctrlKey;
    // Only the shell's keys: Esc, ⌥ itself (the keys guide) and the named ⌥ codes (⌘ and Ctrl stay the app's and the browser's).
    const appKey = appOn(st) && ev.altKey && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && st.appKeys.some(t => t.key === appKeyOf(ev.code));
    if (!esc && !bareAlt && !appKey && !(ev.altKey && !ev.metaKey && !ev.ctrlKey && claimed.includes(ev.code))) return;
    // Esc is never an activation in browsers (it can only ask for the Back the app could already ask for), and bare ⌥
    // only shows the keys guide; a named ⌥ key needs one.
    if (ev.type === 'keydown' && !esc && !bareAlt && !activated()) return;
    emit(frame, Object.freeze(ev));
  }
  const STATUSES = ['handled', 'atRoot', 'pinned', 'inserted', 'refused', 'stale'];
  addEventListener('message', e => {
    const d = e.data;
    if (e.origin !== 'null' || !d || typeof d !== 'object' || d.type !== TYPE || d.version !== VERSION) return;
    const st = [...sessions.values()].find(s => s.frame.contentWindow === e.source);
    if (!connected(st)) return;
    // A client that loaded after our hello asks for one; it gets a fresh hello on the current channel.
    if (d.op === 'boot') { if (!st.ready) { st.appSent = appOn(st); send(st, 'hello', helloMsg(st)); } return; }
    if (d.channel !== st.channel) return;
    if (d.op === 'ready') {
      st.ready = true;
      // The shell's own proof that an app document answered on this load (the Troubleshooter window waits on it,
      // core/reach.js). Only this frame's own window, on the current channel, can raise it.
      try { st.frame.dispatchEvent(new Event('wizard:boundary-ready')); } catch (_) {}
      if (st.appearance) send(st, 'theme', { appearance: st.appearance, layer: st.layer || null });
      try { window.WizAppearance?.sync?.(); } catch (_) {}
      return;
    }
    if (d.op === 'field.focus') {
      // Every report repaints: focus coming back into the frame from the shell changes nothing here but the shell's
      // own focus, which the shell cannot observe inside the frame.
      st.field = d.editable === true; fieldChanged();
      return;
    }
    if (d.op === 'input') { input(st, d); return; }
    if (d.op === 'keys.app') { st.appKeys = appOn(st) ? appKeyList(d.keys) : []; return; }
    if (d.op === 'theme.applied') {
      if (st.appearance && d.revision === st.appearance.revision) themedWin(st.frame)?.classList.add('wz-themed');
      return;
    }
    if (d.op === 'service.request' && typeof d.id === 'string' && d.id.length <= 96) {
      // `ready` and the bounded services (SERVED, see the header). Every other app service stays closed under the
      // boundary. The answer is protocol data only (shape), and only on the channel the request came in on.
      const channel = st.channel;
      // A backend call taken on this channel stays listed until it is answered (see hello's `took`).
      const took = d.method === 'net.fetch';
      if (took) tookOf(st.frame).add(d.id);
      const answer = (value, code, message) => {
        if (!connected(st) || st.channel !== channel) return;
        if (took) tookOf(st.frame).delete(d.id);
        send(st, 'service.reply', { id: d.id, ...(code ? { error: { code, message } } : { value }) });
      };
      if (d.method === 'ready') return answer({ version: VERSION, hosted: true });
      if (!st.ready || !server || !SERVED.includes(d.method)) return answer(undefined, 'unavailable', 'Not available inside the browser boundary yet');
      // The tap must be in this window: a tap or key elsewhere in the shell also activates the shell, but then this
      // frame no longer has focus (a click or key in the frame gives it focus).
      if (TAPPED.includes(d.method) && (!activated() || !visible(st.frame) || !focusedFrame(st.frame))) return answer(undefined, 'refused', d.method.startsWith('capture.') ? 'Recording needs a tap in the app' : d.method === 'link.open' ? 'Opening a link needs a tap in the app' : 'Share needs a tap in the app');
      // Opening a socket waits for its server like a backend call does, on the same budget.
      const net = d.method === 'net.fetch' || d.method === 'ws.open', slot = net ? 'netInflight' : 'inflight';
      // Stopping a call, taking a streamed answer's pieces and a socket's own messages or close are answered at once
      // and never wait for a slot.
      const quick = ['net.abort', 'net.ack', 'ws.send', 'ws.close'].includes(d.method);
      if (!quick && (st[slot] || 0) >= (net ? NET_INFLIGHT : INFLIGHT)) return answer(undefined, 'busy', 'Too many app requests at once');
      let value;
      // Whether this request came right after a real tap or key in this focused, visible window (see TAPPED).
      const tapped = activated() && visible(st.frame) && focusedFrame(st.frame), lifted = tapped || frameActivated(st.frame);
      // A refusal may carry its own code (net.fetch, ws.open: `outside`, so the app's own fetch or socket goes out
      // unchanged instead).
      const code = err => (net && err?.code === 'outside' ? 'outside' : 'refused');
      try { value = server(st.frame, d.method, d.args, Object.freeze({ tapped, lifted })); } catch (err) { return answer(undefined, code(err), String(err?.message || 'Refused').slice(0, 200)); }
      if (!value || typeof value.then !== 'function') return answer(shape(value));
      st[slot] = (st[slot] || 0) + 1;
      Promise.resolve(value).then(v => answer(shape(v)), err => answer(undefined, code(err), String(err?.message || 'Refused').slice(0, 200)))
        .finally(() => { if (st.channel === channel) st[slot]--; });
      return;
    }
    if (d.op === 'reply' && typeof d.id === 'string') {
      const wait = pending.get(d.id);
      if (!wait || wait.st !== st) return;
      clearTimeout(wait.timer); pending.delete(d.id);
      // Protocol data only: never an app-supplied callback or URL.
      wait.resolve({ status: STATUSES.includes(d.status) ? d.status : 'refused', seal: typeof d.seal === 'string' && d.seal.length <= 80 ? d.seal : null });
    }
  });
  // A sandboxed app's own saved settings (see the header). Kept as string pairs in a Map, so no key (not even
  // `__proto__`) can reach an object's prototype.
  const STORE = 'wos.app-storage.v1.', STORE_NAME = 'wzst1:', STORE_MAX = 512 * 1024, STORE_ALL = 1536 * 1024;
  const STORE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  const storeSize = m => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
  function storeRead(id) {
    const m = new Map();
    if (typeof id !== 'string' || !STORE_ID.test(id)) return m;
    try {
      const o = JSON.parse(localStorage.getItem(STORE + id) || '{}');
      if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (typeof o[k] === 'string') m.set(k, o[k]);
    } catch (_) {}
    return m;
  }
  // The page's changes, in order: { k, v } sets, { k, d: 1 } removes, { c: 1 } clears. All or nothing: false when the
  // app id, a change or the size is not acceptable, and then nothing is written.
  function storeApply(id, ops) {
    if (typeof id !== 'string' || !STORE_ID.test(id) || !Array.isArray(ops) || !ops.length || ops.length > 5000) return false;
    const m = storeRead(id);
    for (const op of ops) {
      if (!op || typeof op !== 'object') return false;
      if (op.c === 1) { m.clear(); continue; }
      if (typeof op.k !== 'string' || op.k.length > 4096) return false;
      if (op.d === 1) m.delete(op.k);
      else if (typeof op.v === 'string') m.set(op.k, op.v);
      else return false;
    }
    const n = storeSize(m);
    if (n > STORE_MAX) return false;
    try {
      let others = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(STORE) && k !== STORE + id) others += (localStorage.getItem(k) || '').length; }
      if (others + n > STORE_ALL) return false;
      if (m.size) localStorage.setItem(STORE + id, JSON.stringify(Object.fromEntries(m))); else localStorage.removeItem(STORE + id);
      return true;
    } catch (_) { return false; }
  }
  // The installed app's own path (its registered url), as app-services.js checks a window: the page keeps its settings
  // only while it stays under it (app-client.js), so another app's page on this host never reads them.
  function storeBase(id) {
    try {
      const all = [window.WizCore.apps('mobile'), window.WizCore.apps('desktop')].flatMap(r => r?.APPS || []);
      const a = all.find(x => x && x.id === id && typeof x.url === 'string');
      const u = a && new URL(a.url, location.href);
      if (!u || u.origin !== location.origin) return '';
      return u.pathname.endsWith('/') ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
    } catch (_) { return ''; }
  }
  // What a new app window starts with: the frame's name (the page reads it before it can hear anything), with the
  // app's own path. '' = not an installed app here.
  function storageName(id) {
    const base = typeof id === 'string' && STORE_ID.test(id) ? storeBase(id) : '';
    return base ? STORE_NAME + JSON.stringify({ p: base, l: Object.fromEntries(storeRead(id)) }) : '';
  }
  /* A sandboxed app's IndexedDB (its stand-in in core/app-client.js; the browser refuses IndexedDB to an opaque page).
   * The shell keeps each installed app's databases in its own IndexedDB (`wos-app-idb-v1`), keyed by the window's
   * installed app id, never one the page names: `dbs` holds each database's version, object stores and indexes under
   * [app, name], `rows` each record under [app, name, store, key]. The page sends a finished transaction's changes as
   * one list (idb.commit), written all together or not at all; 64 MB per app, 256 MB for all apps together. One app's
   * loads and changes run one at a time, in order. */
  const IDB = 'wos-app-idb-v1', IDB_APP = 64 * 1024 * 1024, IDB_ALL = 256 * 1024 * 1024, IDB_NAME = 256, IDB_OPS = 20000;
  let idbHomeP = null;
  const idbQueue = new Map();
  const idbReq = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  function idbHome() {
    return idbHomeP || (idbHomeP = new Promise((ok, no) => {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('dbs'); r.result.createObjectStore('rows'); };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); idbHomeP = null; }; ok(d); };
      r.onerror = () => { idbHomeP = null; no(r.error); };
    }));
  }
  const idbOk = (id, name) => typeof id === 'string' && STORE_ID.test(id) && typeof name === 'string' && name.length <= IDB_NAME;
  function idbSerial(id, fn) {
    const p = (idbQueue.get(id) || Promise.resolve()).then(fn);
    const tail = p.catch(() => {});
    idbQueue.set(id, tail);
    tail.then(() => { if (idbQueue.get(id) === tail) idbQueue.delete(id); });
    return p;
  }
  // [app, name, store] < [app, name, store, any key] < [app, name, store + '\0']: one store's rows; likewise one database.
  const idbStoreRows = (id, name, s) => IDBKeyRange.bound([id, name, s], [id, name, s + '\u0000'], false, true);
  const idbDbRows = (id, name) => IDBKeyRange.bound([id, name], [id, name + '\u0000'], false, true);
  const idbPath = (p, index) => {
    if (p === null && !index) return null;
    if (typeof p === 'string' && p.length <= 1024) return p;
    if (Array.isArray(p) && p.length && p.length <= 32 && p.every(x => typeof x === 'string' && x.length <= 1024)) return [...p];
    throw new Error('bad key path');
  };
  // About how much a record takes, for the space limits.
  function idbBytes(v, seen = new Set()) {
    if (v === null || v === undefined) return 1;
    if (typeof v === 'string') return 2 * v.length + 4;
    if (typeof v !== 'object') return 8;
    if (seen.has(v)) return 8;
    seen.add(v);
    if (isBlob(v)) return v.size + 64;
    if (BINARY(v)) return v.byteLength + 16;
    let n = 16;
    if (v instanceof Map) { for (const [k, x] of v) n += idbBytes(k, seen) + idbBytes(x, seen); return n; }
    if (v instanceof Set) { for (const x of v) n += idbBytes(x, seen); return n; }
    for (const k of Object.keys(v)) n += 2 * k.length + idbBytes(v[k], seen);
    return n;
  }
  /* Turning the boundary on (wizard-os#133): until then the app's page kept its databases in this origin's own
   * IndexedDB, which its sandboxed page can no longer open. core/app-services.js notes which installed app opened which
   * database while its window was same-origin (`wos.app-idb-owners.v1`: { name: { app } }, app '' = more than one app
   * opened it). The first time the app's sandboxed page opens a database the shell has no copy of, and that app alone
   * opened it before, the shell copies it over once: version, stores, indexes and every record (`wos.app-idb-carried.v1`
   * notes it, so a database the app deletes later never comes back). The shell's own databases (wos-…, the recorder's
   * wizard-app-capture-v1) are never carried; the old database stays as it was. True when a copy was written. */
  const IDB_OWNERS = 'wos.app-idb-owners.v1', IDB_CARRIED = 'wos.app-idb-carried.v1';
  const idbShellName = n => /^wos/i.test(n) || /^wizard-app-capture/i.test(n);
  const readJson = k => { try { const o = JSON.parse(localStorage.getItem(k) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } };
  async function idbCarry(id, name) {
    const mark = id + '\n' + name;
    try {
      if (idbShellName(name) || readJson(IDB_OWNERS)[name]?.app !== id || readJson(IDB_CARRIED)[mark]) return false;
      if (typeof indexedDB.databases !== 'function' || !(await indexedDB.databases()).some(d => d.name === name)) return false;
      const done = () => { const c = readJson(IDB_CARRIED); c[mark] = Date.now(); try { localStorage.setItem(IDB_CARRIED, JSON.stringify(c)); } catch (_) {} };
      const old = await new Promise((ok, no) => {
        const r = indexedDB.open(name);
        // It went away since databases(): never create it here.
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };
        r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); r.onblocked = () => no(new Error('blocked'));
      });
      const ops = [{ o: 'version', v: old.version }];
      try {
        const names = [...old.objectStoreNames];
        if (names.length) {
          const tx = old.transaction(names, 'readonly');
          for (const s of names) {
            const os = tx.objectStore(s);
            ops.push({ o: 'store', s, keyPath: os.keyPath ?? null, autoIncrement: os.autoIncrement === true });
            for (const i of [...os.indexNames]) { const x = os.index(i); ops.push({ o: 'index', s, i, keyPath: x.keyPath, unique: x.unique === true, multiEntry: x.multiEntry === true }); }
            const [keys, vals] = await Promise.all([idbReq(os.getAllKeys()), idbReq(os.getAll())]);
            let next = 1;
            keys.forEach((k, j) => { ops.push({ o: 'put', s, k, v: vals[j] }); if (typeof k === 'number' && k >= next) next = Math.floor(k) + 1; });
            if (os.autoIncrement) ops.push({ o: 'next', s, n: next });
          }
          // The real key generator can be ahead of the highest key left (the newest records were deleted): ask it with
          // one add per store in a transaction that is then aborted, which writes nothing and puts the generator back.
          const auto = names.filter(s => ops.some(x => x.o === 'store' && x.s === s && x.autoIncrement));
          if (auto.length) {
            const gen = await new Promise(ok => {
              const got = {}; let t;
              try { t = old.transaction(auto, 'readwrite'); } catch (_) { return ok(got); }
              t.onabort = () => ok(got); t.oncomplete = () => ok(got);
              let left = auto.length;
              for (const s of auto) {
                try {
                  const os = t.objectStore(s), q = os.add(os.keyPath === null ? 0 : {});
                  q.onsuccess = () => { if (typeof q.result === 'number') got[s] = q.result; if (!--left) t.abort(); };
                  q.onerror = e => { e.preventDefault(); if (!--left) t.abort(); };
                } catch (_) { if (!--left) t.abort(); }
              }
            });
            for (const x of ops) if (x.o === 'next' && Number.isSafeInteger(gen[x.s]) && gen[x.s] > x.n) x.n = gen[x.s];
          }
        }
      } finally { old.close(); }
      // In pieces of at most IDB_OPS changes, each on the revision the last one wrote; all or nothing.
      let base = 0;
      for (let i = 0; i < ops.length; i += IDB_OPS) {
        const r = await idbWrite(id, name, ops.slice(i, i + IDB_OPS), base);
        if (!r || typeof r !== 'object') {
          if (base) await new Promise(ok => { idbHome().then(d => { const t = d.transaction(['dbs', 'rows'], 'readwrite'); t.oncomplete = t.onabort = ok; t.objectStore('rows').delete(idbDbRows(id, name)); t.objectStore('dbs').delete([id, name]); }, ok); });
          done(); return false;
        }
        base = r.idb.rev;
      }
      done(); return true;
    } catch (_) { return false; }
  }
  function idbLoad(id, name) {
    if (!idbOk(id, name)) return Promise.resolve({ idb: null });
    return idbSerial(id, async () => {
      let m = await idbReq((await idbHome()).transaction('dbs', 'readonly').objectStore('dbs').get([id, name]));
      if (!m && await idbCarry(id, name)) m = await idbReq((await idbHome()).transaction('dbs', 'readonly').objectStore('dbs').get([id, name]));
      if (!m) return { idb: null };
      const tx = (await idbHome()).transaction(['dbs', 'rows'], 'readonly');
      const os = tx.objectStore('rows'), rows = [];
      for (const [s] of m.stores) {
        const r = idbStoreRows(id, name, s), [keys, vals] = await Promise.all([idbReq(os.getAllKeys(r)), idbReq(os.getAll(r))]);
        rows.push([s, keys.map((k, i) => [k[3], vals[i].v])]);
      }
      return { idb: { version: m.version, rev: m.rev || 0, stores: m.stores.map(([s, x]) => [s, { keyPath: x.keyPath, autoIncrement: x.autoIncrement, next: x.next, indexes: x.indexes }]), rows } };
    });
  }
  // The changes of one transaction, in order: { o: 'version', v }, { o: 'store', s, keyPath, autoIncrement },
  // { o: 'unstore', s }, { o: 'index', s, i, keyPath, unique, multiEntry }, { o: 'unindex', s, i }, { o: 'next', s, n },
  // { o: 'put', s, k, v }, { o: 'del', s, k }, { o: 'clear', s }, made on the page's copy at revision `base`.
  // { idb: { rev } } (the new revision) when all were written; 'stale' (nothing written) when another window of the app
  // committed since `base`, so the page never overwrites a change it did not see; false (nothing written) when a change
  // is not acceptable or the space is full.
  function idbCommit(id, name, ops, base) {
    if (!idbOk(id, name) || !Array.isArray(ops) || !ops.length || ops.length > IDB_OPS || !Number.isSafeInteger(base)) return Promise.resolve(false);
    return idbSerial(id, () => idbWrite(id, name, ops, base));
  }
  // One commit, already in this app's turn (idbSerial).
  function idbWrite(id, name, ops, base) {
    return new Promise(done => {
      let tx = null, rev = 0;
      const stop = (why = false) => { done(why); try { tx?.abort(); } catch (_) {} };
      idbHome().then(async d => {
        tx = d.transaction(['dbs', 'rows'], 'readwrite');
        tx.oncomplete = () => done({ idb: { rev } });
        tx.onabort = () => done(false);
        const dbs = tx.objectStore('dbs'), rows = tx.objectStore('rows');
        const m = (await idbReq(dbs.get([id, name]))) || { version: 0, rev: 0, stores: [], size: 0 };
        if ((m.rev || 0) !== base) return stop('stale');
        rev = m.rev = (m.rev || 0) + 1;
        const stores = new Map(m.stores);
        const info = s => { const x = typeof s === 'string' && stores.get(s); if (!x) throw new Error('no such store'); return x; };
        for (const op of ops) {
          if (!op || typeof op !== 'object' || (op.s !== undefined && (typeof op.s !== 'string' || op.s.length > IDB_NAME))) throw new Error('bad change');
          if (op.o === 'version') { if (!Number.isSafeInteger(op.v) || op.v < 1) throw new Error('bad version'); m.version = op.v; }
          else if (op.o === 'store') { if (typeof op.s !== 'string' || stores.has(op.s)) throw new Error('bad store'); stores.set(op.s, { keyPath: idbPath(op.keyPath ?? null), autoIncrement: op.autoIncrement === true, next: 1, indexes: [], size: 0 }); }
          else if (op.o === 'unstore') { info(op.s); rows.delete(idbStoreRows(id, name, op.s)); stores.delete(op.s); }
          else if (op.o === 'index') { const x = info(op.s); if (typeof op.i !== 'string' || op.i.length > IDB_NAME || x.indexes.some(([n]) => n === op.i)) throw new Error('bad index'); x.indexes = [...x.indexes, [op.i, { keyPath: idbPath(op.keyPath, true), unique: op.unique === true, multiEntry: op.multiEntry === true }]]; }
          else if (op.o === 'unindex') { const x = info(op.s); x.indexes = x.indexes.filter(([n]) => n !== op.i); }
          else if (op.o === 'next') { const x = info(op.s); if (!Number.isFinite(op.n) || op.n < 1) throw new Error('bad key generator'); x.next = op.n; }
          else if (op.o === 'put' || op.o === 'del') {
            const x = info(op.s), key = [id, name, op.s, op.k], old = await idbReq(rows.get(key));
            if (op.o === 'put') { const n = idbBytes(op.k) + idbBytes(op.v); rows.put({ v: op.v, n }, key); x.size += n - (old?.n || 0); }
            else if (old) { rows.delete(key); x.size -= old.n || 0; }
          }
          else if (op.o === 'clear') { const x = info(op.s); rows.delete(idbStoreRows(id, name, op.s)); x.size = 0; }
          else throw new Error('bad change');
        }
        m.stores = [...stores];
        m.size = m.stores.reduce((n, [, x]) => n + (x.size || 0), 0);
        const [keys, all] = await Promise.all([idbReq(dbs.getAllKeys()), idbReq(dbs.getAll())]);
        let app = 0, total = 0;
        keys.forEach((k, i) => { if (k[0] === id && k[1] === name) return; total += all[i]?.size || 0; if (k[0] === id) app += all[i]?.size || 0; });
        if (app + m.size > IDB_APP || total + m.size > IDB_ALL) return stop();
        dbs.put(m, [id, name]);
      }).catch(() => stop());
    });
  }
  function idbDrop(id, name) {
    if (!idbOk(id, name)) return Promise.resolve(false);
    return idbSerial(id, () => idbHome().then(d => new Promise(done => {
      const tx = d.transaction(['dbs', 'rows'], 'readwrite');
      tx.oncomplete = () => done(true); tx.onabort = () => done(false);
      tx.objectStore('rows').delete(idbDbRows(id, name));
      tx.objectStore('dbs').delete([id, name]);
    }))).catch(() => false);
  }
  function idbList(id) {
    if (typeof id !== 'string' || !STORE_ID.test(id)) return Promise.resolve({ idb: [] });
    return idbSerial(id, async () => {
      const os = (await idbHome()).transaction('dbs').objectStore('dbs'), r = IDBKeyRange.bound([id], [id + '\u0000'], false, true);
      const [keys, vals] = await Promise.all([idbReq(os.getAllKeys(r)), idbReq(os.getAll(r))]);
      return { idb: keys.map((k, i) => ({ name: k[1], version: vals[i].version })) };
    });
  }
  const attr = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  window.WizBrowserBoundary = Object.freeze({
    enabled: true,
    sandbox: SANDBOX,
    // The attributes every app frame gets while the boundary is on (no allow-same-origin, ever).
    // The shell's own pages (shellPage) are the one exception: they stay same-origin (see guard above).
    // With the window's installed app id, its saved settings ride along as the frame's name (appStorage).
    frameAttributes: (url, appId) => {
      if (url !== undefined && shellPage(url)) return '';
      const name = appId ? storageName(appId) : '';
      return `sandbox="${SANDBOX}"` + (name ? ` name="${attr(name)}"` : '');
    },
    storageName,
    // For core/app-services.js only, always with the frame's own installed app id (never one the page names).
    appStorage: Object.freeze({ load: id => ({ store: storeRead(id) }), save: storeApply }),
    // Likewise its IndexedDB (appIdb above): load, commit, drop and list, always for the frame's own installed app id.
    appIdb: Object.freeze({ load: idbLoad, commit: idbCommit, drop: idbDrop, list: idbList }),
    // For core/app-services.js net.fetch: whether a URL is an owner route on this origin (never fetched for an app).
    ownerRoute,
    netMax: NET_MAX,
    shellPage,
    owns: frame => sessions.has(frame),
    // Whether the app document now in this frame answered on its current channel (`wizard:boundary-ready` fires then).
    ready: frame => { const st = sessions.get(frame); return !!(connected(st) && st.ready); },
    // Which document is in the frame now (it changes on every load): a long request checks it is still the same one.
    gen: frame => { const st = sessions.get(frame); return connected(st) ? st.gen : null; },
    attach,
    // Shell-side admission for a later bounded app service: registered element + its WindowProxy + current channel.
    admits(frame, source, channel) { const st = sessions.get(frame); return !!(connected(st) && st.ready && frame.contentWindow === source && st.channel === channel); },
    back(frame, onRoot) {
      const st = sessions.get(frame);
      if (!connected(st) || !visible(frame)) return 'stay';
      if (!st.ready) return 'notReady';
      if (st.backPending) return 'pending';
      st.backPending = true; const channel = st.channel;
      ask(st, 'back').then(answer => {
        if (sessions.get(frame) !== st || st.channel !== channel) return;
        st.backPending = false;
        if (answer.status === 'atRoot') { try { onRoot?.(); } catch (_) {} }
      });
      return 'pending';
    },
    // Dictation: whether the app reported a focused text field (never which one, never its text), and the document
    // generation a seal belongs to. null = not attached or not ready.
    fieldState(frame) { const st = sessions.get(frame); return connected(st) && st.ready ? Object.freeze({ focused: st.field, gen: st.gen }) : null; },
    onField(fn) { if (typeof fn !== 'function') return () => {}; fieldListeners.add(fn); return () => fieldListeners.delete(fn); },
    // Desktop keys: which ⌥ codes the shell takes (the app then keeps them from its page), and the input it forwards.
    keys(codes) { baseKeys = codeList(codes); claimNow(); },
    // A layout's own window keys, taken too while it runs (the same rule: only keys that move between and around the
    // owner's own windows or open the shell's own panels, never ones that speak, send or act on a chat). off() lets go.
    layoutKeys(codes) {
      const set = Object.freeze(codeList(codes)); layoutSets.add(set); claimNow();
      return () => { if (layoutSets.delete(set)) claimNow(); };
    },
    onInput(fn) { if (typeof fn !== 'function') return () => {}; inputListeners.add(fn); return () => inputListeners.delete(fn); },
    // A layout that presses app keys (the AI apps view) says so while it runs, with frameFn() = the frame of its app in
    // front (null: none). Only that frame reports and holds back its ⌥ keys (the Classic desktop has no app keys, and
    // other app windows keep theirs). The returned off() lets go; off.sync() is called when the app in front changes.
    pressAppKeys(frameFn) {
      if (typeof frameFn !== 'function') return Object.assign(() => {}, { sync: () => {} });
      const p = () => frameFn(); appPressers.add(p); syncAppKeys();
      return Object.assign(() => { if (appPressers.delete(p)) syncAppKeys(); }, { sync: syncAppKeys });
    },
    // The app keys this frame's document reported (none when it is not ready or nobody presses them), as stand-ins the
    // keys guide can place a keycap on (its box in the shell's viewport comes from the frame's offset, like a
    // same-origin node) and a layout can press: click() asks the app to press that key in its own page.
    appKeys(frame) {
      const st = sessions.get(frame);
      if (!connected(st) || !st.ready || !appOn(st) || !visible(frame)) return [];
      const channel = st.channel;
      return st.appKeys.map(t => {
        const r = Object.freeze({ left: t.x, top: t.y, right: t.x + t.w, bottom: t.y + t.h, width: t.w, height: t.h, x: t.x, y: t.y });
        const style = Object.freeze({ visibility: 'visible' });
        const el = Object.freeze({
          tagName: '', hidden: false, isContentEditable: false,
          getBoundingClientRect: () => r, getClientRects: () => [r],
          ownerDocument: Object.freeze({ defaultView: Object.freeze({ getComputedStyle: () => style }), elementFromPoint: () => el }),
          contains: n => n === el, closest: () => null,
          click: () => { if (connected(st) && st.ready && st.channel === channel) send(st, 'keys.press', { key: t.key }); },
          focus: () => {},
        });
        return Object.freeze({ el, key: t.key, label: t.label });
      });
    },
    // App services (core/app-services.js): one server, registered once, answers SERVED for a ready frame; it gets the
    // frame element (never the app's window) and must check it. onReset(fn) runs on every new channel of a frame.
    serve(fn) { if (server || typeof fn !== 'function') return false; server = fn; return true; },
    onReset(fn) { if (typeof fn !== 'function') return () => {}; resetListeners.add(fn); return () => resetListeners.delete(fn); },
    // A tap on one of the app's own title-bar tools, back to that frame on its current channel.
    tool(frame, id, value) {
      const st = sessions.get(frame);
      if (!connected(st) || !st.ready || typeof id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(id)) return false;
      if (value !== undefined && (typeof value !== 'string' || value.length > 64)) return false;
      send(st, 'tool', value === undefined ? { tool: id } : { tool: id, value });
      return true;
    },
    // Shell -> app notices (see the header): protocol data only, to the document that answered on the current channel.
    notice(frame, kind, data = {}) {
      const st = sessions.get(frame);
      if (!connected(st) || !st.ready) return false;
      if (kind === 'refresh') {
        if (!NOTICE_REASONS.includes(data?.reason)) return false;
        send(st, 'notice', { kind, reason: data.reason }); return true;
      }
      if (kind === 'share') { send(st, 'notice', { kind }); return true; } // a share is waiting: pull it (share.pending)
      if (kind === 'capture') {
        // Recording: an event of a session this document started or attached (level, pcm, chunk, state, warn, info), or
        // what this app's recorder holds now (current). Plain data and audio only.
        if (!CAPTURE_EVENTS.includes(data?.event)) return false;
        const out = { kind, event: data.event };
        if (typeof data.id === 'string' && data.id.length <= 128) out.id = data.id;
        for (const k of ['value', 'info']) { const x = plain(data[k]); if (x !== undefined) out[k] = x; }
        send(st, 'notice', out); return true;
      }
      if (kind === 'net') {
        // A streamed answer of this document's own backend call (net.fetch with stream): a piece of its body (bytes
        // only), its end, or an error (a short message). Nothing else crosses.
        if (typeof data?.key !== 'string' || !data.key || data.key.length > 64) return false;
        if (data.event === 'chunk') {
          if (Object.prototype.toString.call(data.chunk) !== '[object ArrayBuffer]' || data.chunk.byteLength > NET_MAX) return false;
          send(st, 'notice', { kind, key: data.key, event: 'chunk', chunk: data.chunk }); return true;
        }
        if (data.event === 'end') { send(st, 'notice', { kind, key: data.key, event: 'end' }); return true; }
        if (data.event === 'error') { send(st, 'notice', { kind, key: data.key, event: 'error', message: typeof data.message === 'string' ? data.message.slice(0, 200) : '' }); return true; }
        return false;
      }
      if (kind === 'idb') {
        // Another window of this app changed one of its IndexedDB databases: only its name crosses.
        if (typeof data?.name !== 'string' || data.name.length > 256) return false;
        send(st, 'notice', { kind, name: data.name }); return true;
      }
      if (kind === 'ws') {
        // This document's own socket (ws.open): a message from its server (text or bytes) or its close (code, reason,
        // clean or not). Nothing else crosses.
        if (typeof data?.key !== 'string' || !data.key || data.key.length > 64) return false;
        if (data.event === 'message') {
          const text = typeof data.data === 'string';
          if (text ? data.data.length > NET_MAX : Object.prototype.toString.call(data.data) !== '[object ArrayBuffer]' || data.data.byteLength > NET_MAX) return false;
          send(st, 'notice', { kind, key: data.key, event: 'message', data: data.data }); return true;
        }
        if (data.event === 'close') {
          const code = Number.isInteger(data.code) && data.code >= 1000 && data.code <= 4999 ? data.code : 1006;
          const reason = typeof data.reason === 'string' ? data.reason.slice(0, 123) : '';
          send(st, 'notice', { kind, key: data.key, event: 'close', code, reason, wasClean: data.wasClean === true }); return true;
        }
        return false;
      }
      if (kind === 'update') {
        const v = data?.available, version = typeof v?.version === 'string' ? v.version.slice(0, 128) : '';
        send(st, 'notice', { kind, available: v ? { version } : null }); return true;
      }
      return false;
    },
    // The skin layer (appearance-host skinLayer: same-origin stylesheet paths + My skin's CSS) travels with the theme,
    // since a sandboxed app cannot read the shell's stylesheets itself (app-client syncSkinLayer).
    theme(frame, appearance, layer) {
      const st = sessions.get(frame); if (!st || !appearance) return;
      st.appearance = appearance; st.layer = layer || null;
      if (st.ready) send(st, 'theme', { appearance, layer: st.layer });
    },
    async pinField(frame) {
      const st = sessions.get(frame);
      // The frame has focus, or the app still reports its focused field while a shell control (the orb) is pressed.
      // Another focused frame never lends its focus.
      if (!connected(st) || !visible(frame)) return null;
      const active = document.activeElement;
      if (active !== frame && (!st.field || active?.tagName === 'IFRAME')) return null;
      const channel = st.channel, result = await ask(st, 'field.pin');
      if (!connected(st) || st.channel !== channel || result.status !== 'pinned' || !result.seal) return null;
      let used = false;
      return Object.freeze({
        async insert(text) {
          if (used || !connected(st) || st.channel !== channel || typeof text !== 'string' || text.length > 100000) return false;
          used = true;
          return (await ask(st, 'field.insert', { seal: result.seal, text })).status === 'inserted';
        },
        release() { if (used) return; used = true; send(st, 'field.release', { seal: result.seal }); },
      });
    },
  });
})();
