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
 *  - theme(frame, appearance): the Appearance v1 context, pushed on change and again on every `ready`.
 *  - pinField(frame): the focused field in the focused app frame is sealed once; insert(text) puts text there only if
 *    the field did not change in between, release() lets it go.
 *  - field.focus: the app says (a boolean, nothing else) whether a text field has focus, so the shell's dictation
 *    (core/focused-field.js) can offer the orb for a sandboxed app; fieldState(frame) and onField(fn) expose it.
 *  - input: a click in the app (to focus its window), the window losing focus, Esc, bare ⌥ (the keys guide) and the
 *    ⌥ codes named by keys(codes), never plain typing; the app holds exactly those back from its own page. The shell
 *    cannot tell a real key from a made-up one, so keys(codes) must only name keys that move around the owner's own
 *    windows. onInput(fn) gets them for the focused, visible frame only; a click and a named ⌥ key also need the
 *    browser's transient user activation (a real click or key in the frame activates the shell too), so a page that
 *    only posts messages cannot press them at all.
 *  - service.request: the bounded app services the shell answers under the boundary: `ready`; the ones that act
 *    only on the app's own window, `badge.set` and `titlebar.set`; sharing out (`share.text`, `share.file`), which
 *    also needs the browser's transient user activation in that focused, visible frame and always opens the shell's own share
 *    sheet, where the owner picks (the shell's confirm); `share.wizard` (the same tap, then the shell's own Send to
 *    <agent> sheet, where the owner reads the text and sends or cancels); `voice.transcribe` (the box's transcriber,
 *    within a per-app budget); and `update.hold` / `update.release` (the app's unsaved work makes a shell update wait,
 *    for that window's current document only). They are handed to the one server core/app-services.js registers (serve(fn)), which checks the
 *    frame against the installed app list and validates the data. Answers are protocol data only (a boolean, a share
 *    status, a transcript), and an answer is dropped if the frame got a new channel (a load) meanwhile. A title-bar
 *    tap goes back as `tool` on the current channel. Every new channel (a load) first clears that window's
 *    title-bar tools (onReset); the client sends its last badge and title bar again on each new channel.
 *  - notice(frame, kind, data): the shell's own notices to a ready app, on its current channel: `update` (a new
 *    shell is ready; only its version string crosses) and `refresh` (read your data again; only the reason crosses).
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
  const resetListeners = new Set(), SERVED = ['badge.set', 'titlebar.set', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'update.hold', 'update.release'];
  // Sharing out and Share to Wizard open a shell sheet: only right after a real tap or key in that app window, never
  // from a page alone.
  const TAPPED = ['share.text', 'share.file', 'share.wizard'], INFLIGHT = 4;
  const NOTICE_REASONS = ['visible', 'focus', 'poll', 'agent'];
  // What may cross back to the app: protocol data only, never a shell object.
  function shape(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length <= 32 ? v : null;
    if (v && typeof v === 'object') {
      if (v.unavailable === true) return { unavailable: true };
      if (typeof v.text === 'string' && v.text.length <= 200000) return { text: v.text };
    }
    return null;
  }
  let serial = 0, claimed = [], server = null;
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
    st.channel = newChannel(); st.ready = false; st.backPending = false; st.inflight = 0;
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
    const hello = () => { revoke(st); send(st, 'hello', { keys: claimed }); };
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
    if (!esc && !bareAlt && !(ev.altKey && !ev.metaKey && !ev.ctrlKey && claimed.includes(ev.code))) return;
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
    if (d.op === 'boot') { if (!st.ready) send(st, 'hello', { keys: claimed }); return; }
    if (d.channel !== st.channel) return;
    if (d.op === 'ready') {
      st.ready = true;
      // The shell's own proof that an app document answered on this load (the Troubleshooter window waits on it,
      // core/reach.js). Only this frame's own window, on the current channel, can raise it.
      try { st.frame.dispatchEvent(new Event('wizard:boundary-ready')); } catch (_) {}
      if (st.appearance) send(st, 'theme', { appearance: st.appearance });
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
      if (TAPPED.includes(d.method) && (!activated() || !visible(st.frame) || !focusedFrame(st.frame))) return answer(undefined, 'refused', 'Share needs a tap in the app');
      if ((st.inflight || 0) >= INFLIGHT) return answer(undefined, 'busy', 'Too many app requests at once');
      let value;
      try { value = server(st.frame, d.method, d.args); } catch (err) { return answer(undefined, 'refused', String(err?.message || 'Refused').slice(0, 200)); }
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
    keys(codes) {
      claimed = Array.isArray(codes) ? codes.filter(c => typeof c === 'string' && c.length <= 24).slice(0, 64) : [];
      for (const st of sessions.values()) if (st.ready) send(st, 'keys', { keys: claimed });
    },
    onInput(fn) { if (typeof fn !== 'function') return () => {}; inputListeners.add(fn); return () => inputListeners.delete(fn); },
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
      if (kind === 'update') {
        const v = data?.available, version = typeof v?.version === 'string' ? v.version.slice(0, 128) : '';
        send(st, 'notice', { kind, available: v ? { version } : null }); return true;
      }
      return false;
    },
    theme(frame, appearance) { const st = sessions.get(frame); if (!st || !appearance) return; st.appearance = appearance; if (st.ready) send(st, 'theme', { appearance }); },
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
