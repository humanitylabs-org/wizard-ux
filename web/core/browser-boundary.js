/* Browser owner boundary: sandboxed app frames (wizard-os#133). Off unless the box turned it on.
 *
 * core/shell-token.js runs first and sets window.WizShellBoundary only when the box ran `wam browser-boundary on`
 * (the page carried a shell-only token). Only then does this module turn on: app frames get `sandbox` WITHOUT
 * `allow-same-origin`, so an app page runs in an opaque origin. It cannot read the shell's storage or DOM, cannot reach
 * `parent.*`, and its owner calls carry no shell token (the Agent Service and App Manager refuse them).
 *
 * The shell then never reads an app document. Back, appearance and field insertion go through postMessage:
 *  - attach(frame) gives the frame a fresh random channel on every load and says `hello`; the app's
 *    core/browser-boundary-client.js answers `ready` on that channel. Origin `null` is never an identity: a message is
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
  let serial = 0, claimed = [];
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
    st.channel = newChannel(); st.ready = false; st.backPending = false;
    // A new document: whatever field it had focused is gone, and old dictation seals no longer match (gen).
    st.gen = (st.gen || 0) + 1; if (st.field) { st.field = false; fieldChanged(); }
    themedWin(st.frame)?.classList.remove('wz-themed');
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
  // The shell's own pages that run in an app window (Store, Agents, Setup) are shell code, not apps: they stay
  // same-origin so they keep their owner calls, which the top-level shell sends with the token
  // (core/shell-token.js armFrame). Same list as there.
  const SHELL_PAGE = /^\/(?:wizard-os-home|wizard-ux)\/(?:store|agents|setup)\/(?:index\.html)?$/;
  const shellPage = url => {
    try { const u = new URL(String(url), location.href); return u.origin === location.origin && SHELL_PAGE.test(u.pathname); } catch (_) { return false; }
  };
  // Backstop for such a frame: if it ever lands on a same-origin page that is not one of the shell's own (none of
  // them navigates its frame elsewhere today), it is reloaded sandboxed like any app page. Another site's page can't
  // reach the shell, so it is left alone and checked again on its next load.
  const guarded = new WeakSet();
  function guard(frame) {
    if (guarded.has(frame)) return;
    guarded.add(frame);
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
    frame.addEventListener('load', check);
    check();
  }
  function attach(frame) {
    if (frame?.tagName === 'IFRAME' && !frame.hasAttribute('sandbox') && !frame.hasAttribute('srcdoc')) { guard(frame); return () => {}; }
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
      // The one service this slice answers. Every other app service stays closed under the boundary.
      const value = d.method === 'ready' ? { version: VERSION, hosted: true } : undefined;
      send(st, 'service.reply', { id: d.id, ...(value ? { value } : { error: { code: 'unavailable', message: 'Not available inside the browser boundary yet' } }) });
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
