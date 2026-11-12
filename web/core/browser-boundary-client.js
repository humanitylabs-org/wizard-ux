/* Browser owner boundary, app side (wizard-os#133). Runs only inside a sandboxed (opaque-origin) app frame.
 *
 * core/app-client.js loads this when its document's origin is `null` and it sits in a frame; everywhere else it does
 * nothing. The shell (core/browser-boundary.js) never reads this document. It sends `hello` with a per-load channel;
 * we answer `ready` and from then on take, on that channel only, from the parent window only:
 *  - `back`: run WizardApp's own Back (overlays, registered handlers); reply handled / atRoot.
 *  - `theme`: apply the Appearance v1 context through WizardApp's own validator; ack with `theme.applied`.
 *  - `field.pin` / `field.insert` / `field.release`: seal the focused text field, then insert dictated text there only
 *    if nobody typed in it meanwhile.
 * And we tell the shell, as one boolean (`field.focus`), whether a text field has focus, so its orb offers dictation.
 * There is no generic request forwarding: request() carries only the methods the shell answers under the boundary.
 */
(() => {
  'use strict';
  if (window.WizBoundaryClient) return;
  let framed = false; try { framed = parent !== window; } catch (_) { framed = true; }
  if (!framed || globalThis.origin !== 'null') return;
  const TYPE = 'wizard:boundary', VERSION = 1, METHODS = ['ready'];
  // The shell's origin: our URL's own origin (the frame was loaded from the shell's host; only the document is opaque).
  const SHELL = location.origin;
  let channel = '', back = null, applyTheme = null, serial = 0;
  const waiters = new Set();   // requests made before the first hello wait for it (up to their own timeout)
  const seals = new Map(), requests = new Map();
  const error = (code, message) => Object.assign(new Error(message), { code });
  const send = data => { try { parent.postMessage({ ...data, type: TYPE, version: VERSION, channel }, SHELL); } catch (_) {} };
  function release(id) { const s = seals.get(id); if (s) { s.el.removeEventListener('input', s.changed); seals.delete(id); } }
  function clear() {
    for (const id of [...seals.keys()]) release(id);
    for (const wait of requests.values()) { clearTimeout(wait.timer); wait.reject(error('denied', 'App document changed')); }
    requests.clear();
  }
  addEventListener('pagehide', () => { clear(); channel = ''; });
  const editable = el => !!el?.isConnected && typeof el.matches === 'function'
    && el.matches('textarea,input[type=text],input[type=search],input[type=url],input[type=tel],input[type=email],input:not([type])')
    && !el.disabled && !el.readOnly && !el.closest('[inert],[data-no-dictation]') && typeof el.selectionStart === 'number';
  // Only whether a dictation-ready field has focus: never which field, its name or its text.
  // When the shell takes focus (the orb, a key on a shell control) this document's activeElement falls back to <body>,
  // so the last focused field is remembered until focus moves to something else inside this document.
  let fieldSent = null, lastField = null;
  const away = () => typeof document.hasFocus === 'function' && !document.hasFocus();
  const field = () => (editable(document.activeElement) ? document.activeElement : away() && editable(lastField) ? lastField : null);
  const reportField = force => {
    if (!channel) return;
    const on = !!field();
    if (!force && on === fieldSent) return;
    fieldSent = on; send({ op: 'field.focus', editable: on });
  };
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('focusin', () => { const el = document.activeElement; lastField = editable(el) ? el : null; reportField(false); }, true);
    document.addEventListener('focusout', () => setTimeout(() => { if (!away()) lastField = editable(document.activeElement) ? document.activeElement : null; reportField(false); }, 0), true);
  }
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || e.origin !== SHELL || !d || typeof d !== 'object' || d.type !== TYPE || d.version !== VERSION) return;
    if (d.op === 'hello') {
      if (typeof d.channel !== 'string' || !d.channel || d.channel.length > 80) return;
      // A new channel in the same document (the shell saw a load or reattached): seals end, open requests are asked
      // again on the new channel. Only a new document (pagehide) drops them.
      for (const id of [...seals.keys()]) release(id);
      channel = d.channel; send({ op: 'ready' }); reportField(true);
      for (const [id, wait] of requests) send({ op: 'service.request', id, method: wait.method, args: wait.args });
      for (const go of [...waiters]) go();
      return;
    }
    if (!channel || d.channel !== channel) return;
    if (d.op === 'service.reply') {
      const wait = requests.get(d.id); if (!wait) return;
      clearTimeout(wait.timer); requests.delete(d.id);
      if (d.error) wait.reject(error(String(d.error.code || 'failed'), String(d.error.message || 'App request failed'))); else wait.resolve(d.value);
      return;
    }
    const reply = (status, extra = {}) => send({ ...extra, op: 'reply', id: d.id, status });
    if (d.op === 'theme') {
      let ok = false; try { ok = applyTheme?.(d.appearance) === true; } catch (_) {}
      if (ok) send({ op: 'theme.applied', revision: d.appearance.revision });
      return;
    }
    if (d.op === 'back') {
      if (!back) return reply('refused');
      let did = false; try { did = back() === true; } catch (_) { return reply('refused'); }
      return reply(did ? 'handled' : 'atRoot');
    }
    if (d.op === 'field.pin') {
      const el = field();
      if (!el || seals.size >= 4) return reply('refused');
      const id = crypto.randomUUID ? crypto.randomUUID() : 'seal-' + Math.random().toString(36).slice(2);
      const s = { el, value: el.value, start: el.selectionStart, end: el.selectionEnd };
      s.changed = () => release(id);
      el.addEventListener('input', s.changed); seals.set(id, s);
      return reply('pinned', { seal: id });
    }
    if (d.op === 'field.release') { release(d.seal); return; }
    if (d.op === 'field.insert') {
      const s = seals.get(d.seal);
      if (!s || !editable(s.el) || s.value !== s.el.value || typeof d.text !== 'string' || d.text.length > 100000) { release(d.seal); return reply('stale'); }
      release(d.seal);
      let text = d.text;
      const before = s.value.slice(0, s.start).slice(-1), after = s.value.slice(s.end, s.end + 1);
      if (before && !/\s/.test(before) && /^[^\s.,;:!?)]/.test(text)) text = ' ' + text;
      if (after && !/\s/.test(after) && !/[\s(]$/.test(text)) text += ' ';
      s.el.setRangeText(text, s.start, s.end, 'end');
      s.el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: d.text }));
      return reply('inserted');
    }
  });
  window.WizBoundaryClient = Object.freeze({
    // WizardApp hands over its own Back and theme functions; then we ask the shell for a hello on a fresh channel.
    connect({ onBack, onTheme } = {}) {
      back = typeof onBack === 'function' ? onBack : null; applyTheme = typeof onTheme === 'function' ? onTheme : null;
      try { parent.postMessage({ type: TYPE, version: VERSION, op: 'boot' }, SHELL); } catch (_) {}
    },
    get ready() { return !!channel; },
    request(method, args, timeout = 15000) {
      if (!METHODS.includes(method)) return Promise.reject(error('unavailable', 'Not available inside the browser boundary yet'));
      if (requests.size + waiters.size >= 32) return Promise.reject(error('busy', 'Too many pending app requests'));
      const id = 'wbs-' + (++serial);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(go); requests.delete(id); reject(error('timeout', 'Shared app request timed out')); }, timeout);
        function go() { waiters.delete(go); requests.set(id, { resolve, reject, timer, method, args }); send({ op: 'service.request', id, method, args }); }
        if (channel) go(); else waiters.add(go);
      });
    },
  });
})();
