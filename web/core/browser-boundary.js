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
 *    real tap in that window, events stream back as `notice` `capture`).
 *    They are handed to the one server core/app-services.js registers (serve(fn)), which checks the
 *    frame against the installed app list and validates the data. Answers are protocol data only (a boolean, a share
 *    status, a transcript, the vault's `{ secret }` or `{ available, saved }`, Wizard ID's public info, signed event or
 *    NIP-44 result), and an answer is dropped if the frame got a new channel (a load) meanwhile. A title-bar
 *    tap goes back as `tool` on the current channel. Every new channel (a load) first clears that window's
 *    title-bar tools (onReset); the client sends its last badge and title bar again on each new channel.
 *  - notice(frame, kind, data): the shell's own notices to a ready app, on its current channel: `update` (a new
 *    shell is ready; only its version string crosses), `refresh` (read your data again; only the reason crosses) and
 *    `share` (a share was handed to this app: pull it; nothing else crosses) and `capture` (a recording event or this
 *    app's current recording, plain data and audio only).
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
    'capture.sync', 'capture.prepare', 'capture.release', 'capture.start', 'capture.call', 'capture.settle', 'capture.pending', 'capture.ack'];
  // Sharing out and Share to Wizard open a shell sheet: only right after a real tap or key in that app window, never
  // from a page alone.
  // Preparing a recording (capture.prepare) needs the same tap; a new recording (capture.start) is checked by the server
  // with the tap it is handed (a fresh tap, or a recording this window prepared on one).
  const TAPPED = ['share.text', 'share.file', 'share.wizard', 'capture.prepare'], INFLIGHT = 4;
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
  function send(st, op, data = {}) {
    if (!connected(st)) return;
    // An opaque origin can only be addressed with '*'. Nothing sent here carries a credential: admission is the
    // frame's own WindowProxy plus the per-load channel.
    try { st.frame.contentWindow?.postMessage({ ...data, type: TYPE, version: VERSION, channel: st.channel, op }, '*'); } catch (_) {}
  }
  function revoke(st) {
    for (const [id, wait] of pending) if (wait.st === st) { clearTimeout(wait.timer); pending.delete(id); wait.resolve({ status: 'stale' }); }
    st.channel = newChannel(); st.ready = false; st.backPending = false; st.inflight = 0; st.appKeys = [];
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
  function attach(frame) {
    if (frame?.tagName === 'IFRAME' && !frame.hasAttribute('sandbox') && !frame.hasAttribute('srcdoc')) return guard(frame);
    if (!opaqueFrame(frame)) return () => {};
    const had = sessions.get(frame); if (had) return had.detach;
    const st = { frame, channel: newChannel(), ready: false, appearance: null, backPending: false, field: false, gen: 0 };
    const hello = () => { revoke(st); st.appSent = appOn(st); send(st, 'hello', keysMsg(st)); };
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
    if (d.op === 'boot') { if (!st.ready) { st.appSent = appOn(st); send(st, 'hello', keysMsg(st)); } return; }
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
      const answer = (value, code, message) => { if (connected(st) && st.channel === channel) send(st, 'service.reply', { id: d.id, ...(code ? { error: { code, message } } : { value }) }); };
      if (d.method === 'ready') return answer({ version: VERSION, hosted: true });
      if (!st.ready || !server || !SERVED.includes(d.method)) return answer(undefined, 'unavailable', 'Not available inside the browser boundary yet');
      // The tap must be in this window: a tap or key elsewhere in the shell also activates the shell, but then this
      // frame no longer has focus (a click or key in the frame gives it focus).
      if (TAPPED.includes(d.method) && (!activated() || !visible(st.frame) || !focusedFrame(st.frame))) return answer(undefined, 'refused', d.method.startsWith('capture.') ? 'Recording needs a tap in the app' : 'Share needs a tap in the app');
      if ((st.inflight || 0) >= INFLIGHT) return answer(undefined, 'busy', 'Too many app requests at once');
      let value;
      // Whether this request came right after a real tap or key in this focused, visible window (see TAPPED).
      const tapped = activated() && visible(st.frame) && focusedFrame(st.frame);
      try { value = server(st.frame, d.method, d.args, Object.freeze({ tapped })); } catch (err) { return answer(undefined, 'refused', String(err?.message || 'Refused').slice(0, 200)); }
      if (!value || typeof value.then !== 'function') return answer(shape(value));
      st.inflight = (st.inflight || 0) + 1;
      Promise.resolve(value).then(v => answer(shape(v)), err => answer(undefined, 'refused', String(err?.message || 'Refused').slice(0, 200)))
        .finally(() => { if (st.channel === channel) st.inflight--; });
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
  window.WizBrowserBoundary = Object.freeze({
    enabled: true,
    sandbox: SANDBOX,
    // The attributes every app frame gets while the boundary is on (no allow-same-origin, ever).
    // The shell's own pages (shellPage) are the one exception: they stay same-origin (see guard above).
    frameAttributes: url => (url !== undefined && shellPage(url) ? '' : `sandbox="${SANDBOX}"`),
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
