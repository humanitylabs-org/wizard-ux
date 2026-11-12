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
 * Off (the default): nothing is defined and every frame is exactly as before.
 */
(() => {
  'use strict';
  if (window.WizBrowserBoundary) return;
  if (!window.WizShellBoundary?.on) return;
  try { if (window.top !== window) return; } catch (_) { return; }
  const VERSION = 1, TYPE = 'wizard:boundary', ASK_MS = 1200, SANDBOX = 'allow-scripts allow-forms allow-downloads';
  const sessions = new Map(), pending = new Map();
  let serial = 0;
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
  function attach(frame) {
    if (!opaqueFrame(frame)) return () => {};
    const had = sessions.get(frame); if (had) return had.detach;
    const st = { frame, channel: newChannel(), ready: false, appearance: null, backPending: false };
    const hello = () => { revoke(st); send(st, 'hello'); };
    st.detach = () => { if (sessions.get(frame) !== st) return; frame.removeEventListener('load', hello); revoke(st); sessions.delete(frame); };
    sessions.set(frame, st);
    frame.addEventListener('load', hello); hello();
    return st.detach;
  }
  const visible = f => f.isConnected && !f.closest('[hidden], [inert]') && f.getClientRects().length > 0;
  const STATUSES = ['handled', 'atRoot', 'pinned', 'inserted', 'refused', 'stale'];
  addEventListener('message', e => {
    const d = e.data;
    if (e.origin !== 'null' || !d || typeof d !== 'object' || d.type !== TYPE || d.version !== VERSION) return;
    const st = [...sessions.values()].find(s => s.frame.contentWindow === e.source);
    if (!connected(st)) return;
    // A client that loaded after our hello asks for one; it gets a fresh hello on the current channel.
    if (d.op === 'boot') { if (!st.ready) send(st, 'hello'); return; }
    if (d.channel !== st.channel) return;
    if (d.op === 'ready') {
      st.ready = true;
      if (st.appearance) send(st, 'theme', { appearance: st.appearance });
      try { window.WizAppearance?.sync?.(); } catch (_) {}
      return;
    }
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
    frameAttributes: () => `sandbox="${SANDBOX}"`,
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
    theme(frame, appearance) { const st = sessions.get(frame); if (!st || !appearance) return; st.appearance = appearance; if (st.ready) send(st, 'theme', { appearance }); },
    async pinField(frame) {
      const st = sessions.get(frame);
      if (!connected(st) || document.activeElement !== frame || !visible(frame)) return null;
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
