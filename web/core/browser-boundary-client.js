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
 * Desktop keys (`input`): a click here (the shell focuses this window), this window losing focus, and only the shell's
 * keys: Esc, bare ⌥ and the ⌥ codes the shell named (`keys`), never plain typing. Esc and those codes are held back
 * from this page, the way the shell's own key handler took them before the boundary; every other ⌥ chord stays this
 * page's alone, and so do ⌥ word moves and, on a Mac, ⌥- / ⌥= typed in a text field.
 * There is no generic request forwarding: request() carries only the methods the shell answers under the boundary:
 * `ready`, `badge.set`, `titlebar.set`, `share.text`, `share.file`, `share.wizard` (the shell opens its own sheet, and
 * only right after a real tap in this page), `voice.transcribe`, `update.hold` / `update.release` and receiving shares
 * (`share.receive`, `share.targets`, `share.pending`, `share.ack`, for this window's own app only). Holds are this
 * document's: the shell drops them with each channel, so they are placed again on every new channel (the id the app
 * gets stays the same). The last badge and title bar are sent again on every
 * new channel (the shell clears the title bar on each load), and a title-bar tap comes back as `tool` (onTool).
 * The shell's notices come as `notice`: `update` (a new shell is ready: { version } or null, onUpdate) and `refresh`
 * (read your data again, with the reason: onRefresh) and `share` (a share is waiting: onShare pulls it), the same
 * signals a same-origin app gets as wizard:app:update / wizard:app:refresh / wizard:app:share.
 */
(() => {
  'use strict';
  if (window.WizBoundaryClient) return;
  let framed = false; try { framed = parent !== window; } catch (_) { framed = true; }
  if (!framed || globalThis.origin !== 'null') return;
  const TYPE = 'wizard:boundary', VERSION = 1, METHODS = ['ready', 'badge.set', 'titlebar.set', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'update.hold', 'update.release',
    'share.receive', 'share.targets', 'share.pending', 'share.ack'], STICKY = ['badge.set', 'titlebar.set'];
  // The shell's origin: our URL's own origin (the frame was loaded from the shell's host; only the document is opaque).
  const SHELL = location.origin;
  let channel = '', back = null, applyTheme = null, onTool = null, onUpdate = null, onRefresh = null, onShare = null, serial = 0, claimed = new Set();
  const sticky = new Map();   // the last badge / title bar this document asked for, sent again on a new channel
  const waiters = new Set();   // requests made before the first hello wait for it (up to their own timeout)
  const seals = new Map(), requests = new Map();
  const holds = new Map();   // the app's hold id -> { reason, shell: the shell's id on the current channel, placing }
  const error = (code, message) => Object.assign(new Error(message), { code });
  const send = data => { try { parent.postMessage({ ...data, type: TYPE, version: VERSION, channel }, SHELL); } catch (_) {} };
  function release(id) { const s = seals.get(id); if (s) { s.el.removeEventListener('input', s.changed); seals.delete(id); } }
  function clear() {
    for (const id of [...seals.keys()]) release(id);
    for (const wait of requests.values()) { clearTimeout(wait.timer); wait.reject(error('denied', 'App document changed')); }
    requests.clear();
  }
  addEventListener('pagehide', () => { clear(); sticky.clear(); holds.clear(); channel = ''; });
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
    document.addEventListener('focusin', () => { const el = document.activeElement; lastField = editable(el) ? el : null; reportField(true); }, true);
    document.addEventListener('focusout', () => setTimeout(() => { if (!away()) lastField = editable(document.activeElement) ? document.activeElement : null; reportField(false); }, 0), true);
  }
  // A field that turns read-only, disabled, inert or no-dictation, or leaves the page, without a focus event: say so,
  // so the shell never offers a take that would be refused at the end.
  if (typeof MutationObserver === 'function' && document.documentElement) {
    let queued = false;
    new MutationObserver(() => { if (queued || !fieldSent) return; queued = true; setTimeout(() => { queued = false; reportField(false); }, 0); })
      .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['readonly', 'disabled', 'inert', 'data-no-dictation', 'type'] });
  }
  // Desktop keys and clicks for the shell (see the header). The field flag is only whether a text field has focus.
  const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');
  function setKeys(list) { claimed = new Set(Array.isArray(list) ? list.filter(c => typeof c === 'string' && c.length <= 24).slice(0, 64) : []); }
  const deepActive = () => { let a = document.activeElement; for (let i = 0; i < 4 && a?.shadowRoot?.activeElement; i++) a = a.shadowRoot.activeElement; return a; };
  const textField = el => !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA)$/.test(el.tagName || '')
    && !(el.tagName === 'INPUT' && /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/i.test(el.type || '')));
  // Mirrors the shell's own pass-throughs (desktop onKey): ⌥← / ⌥→ word moves, ⌥⇧ arrows selecting in a field,
  // and on a Mac ⌥- / ⌥= typing – — ≠ ± in an editable field.
  function shellTakes(e, field, readOnly) {
    const c = e.code;
    if (!claimed.has(c)) return false;
    if ((c === 'ArrowLeft' || c === 'ArrowRight') && (!e.shiftKey || field)) return false;
    if ((c === 'ArrowUp' || c === 'ArrowDown') && e.shiftKey && field) return false;
    if (MAC && field && !readOnly && (c === 'Minus' || c === 'Equal')) return false;
    return true;
  }
  const sendKey = (type, e, field, readOnly) => send({ op: 'input', kind: 'key', event: type, key: String(e.key || '').slice(0, 32), code: String(e.code || '').slice(0, 32),
    altKey: !!e.altKey, shiftKey: !!e.shiftKey, metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, repeat: !!e.repeat, field, readOnly });
  const bareAlt = e => e.key === 'Alt' && !e.metaKey && !e.ctrlKey;
  addEventListener('keydown', e => {
    if (!channel) return;
    const esc = e.key === 'Escape';
    if (esc && (e.isComposing || e.keyCode === 229)) return;
    if (!esc && !bareAlt(e) && !(e.altKey && !e.metaKey && !e.ctrlKey)) return;
    const el = deepActive(), field = textField(el), readOnly = !!el?.readOnly;
    if (esc || shellTakes(e, field, readOnly)) { e.preventDefault(); e.stopImmediatePropagation(); } else if (!bareAlt(e)) return;
    sendKey('keydown', e, field, readOnly);
  }, true);
  addEventListener('keyup', e => { if (channel && bareAlt(e)) sendKey('keyup', e, false, false); }, true);
  addEventListener('blur', () => { if (channel) send({ op: 'input', kind: 'blur' }); });
  addEventListener('pointerdown', () => { if (channel) send({ op: 'input', kind: 'pointer' }); }, true);
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || e.origin !== SHELL || !d || typeof d !== 'object' || d.type !== TYPE || d.version !== VERSION) return;
    if (d.op === 'hello') {
      if (typeof d.channel !== 'string' || !d.channel || d.channel.length > 80) return;
      // A new channel in the same document (the shell saw a load or reattached): seals end, open requests are asked
      // again on the new channel. Only a new document (pagehide) drops them.
      for (const id of [...seals.keys()]) release(id);
      channel = d.channel; setKeys(d.keys); send({ op: 'ready' }); reportField(true);
      for (const [id, wait] of requests) send({ op: 'service.request', id, method: wait.method, args: wait.args });
      for (const go of [...waiters]) go();
      // Holds: the shell dropped them with the old channel. One still being placed is re-sent above with the requests.
      for (const h of holds.values()) { h.shell = null; if (!h.placing) place(h); }
      for (const [method, args] of sticky) {
        if (![...requests.values()].some(w => w.method === method)) send({ op: 'service.request', id: 'wbs-' + (++serial), method, args });
      }
      return;
    }
    if (!channel || d.channel !== channel) return;
    if (d.op === 'keys') { setKeys(d.keys); return; }
    if (d.op === 'tool') {
      if (typeof d.tool !== 'string' || d.tool.length > 32 || (d.value !== undefined && typeof d.value !== 'string')) return;
      try { onTool?.({ id: d.tool, value: d.value }); } catch (_) {}
      return;
    }
    if (d.op === 'notice') {
      if (d.kind === 'refresh' && ['visible', 'focus', 'poll', 'agent'].includes(d.reason)) { try { onRefresh?.(d.reason); } catch (_) {} }
      if (d.kind === 'share') { try { onShare?.(); } catch (_) {} }
      if (d.kind === 'update' && (d.available === null || (d.available && typeof d.available === 'object' && typeof d.available.version === 'string'))) {
        try { onUpdate?.(d.available ? Object.freeze({ version: d.available.version.slice(0, 128) }) : null); } catch (_) {}
      }
      return;
    }
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
  // Asks the shell for one hold. A reply always comes on the channel that is current when it arrives (the shell drops
  // answers for an old one, and an open request is re-sent with each hello). If the app released the hold meanwhile,
  // the shell's id is let go at once.
  function place(h) {
    h.placing = true;
    const p = send1('update.hold', { reason: h.reason });
    p.then(id => {
      h.placing = false;
      if (typeof id !== 'string') return;
      if ([...holds.values()].includes(h) && !h.shell) h.shell = id;
      else send1('update.release', { id }).catch(() => {});
    }, () => { h.placing = false; });
    return p;
  }
  function send1(method, args, timeout = 15000) {
    if (requests.size + waiters.size >= 32) return Promise.reject(error('busy', 'Too many pending app requests'));
    const id = 'wbs-' + (++serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(go); requests.delete(id); reject(error('timeout', 'Shared app request timed out')); }, timeout);
      function go() { waiters.delete(go); requests.set(id, { resolve, reject, timer, method, args }); send({ op: 'service.request', id, method, args }); }
      if (channel) go(); else waiters.add(go);
    });
  }
  function hold(args) {
    if (holds.size >= 64) return Promise.reject(error('busy', 'Too many update holds'));
    const key = 'hold-' + (++serial), h = { reason: String(args?.reason || 'Unsaved work').slice(0, 160), shell: null, placing: false };
    holds.set(key, h);
    return place(h).then(() => key, err => { holds.delete(key); throw err; });
  }
  function unhold(args) {
    const h = holds.get(args?.id); if (!h) return Promise.resolve(false);
    holds.delete(args.id);
    if (h.shell) send1('update.release', { id: h.shell }).catch(() => {});
    return Promise.resolve(true);
  }
  window.WizBoundaryClient = Object.freeze({
    // WizardApp hands over its own Back and theme functions; then we ask the shell for a hello on a fresh channel.
    connect({ onBack, onTheme, onTool: tap, onUpdate: upd, onRefresh: fresh, onShare: shared } = {}) {
      back = typeof onBack === 'function' ? onBack : null; applyTheme = typeof onTheme === 'function' ? onTheme : null;
      onTool = typeof tap === 'function' ? tap : null;
      onUpdate = typeof upd === 'function' ? upd : null; onRefresh = typeof fresh === 'function' ? fresh : null;
      onShare = typeof shared === 'function' ? shared : null;
      try { parent.postMessage({ type: TYPE, version: VERSION, op: 'boot' }, SHELL); } catch (_) {}
    },
    get ready() { return !!channel; },
    request(method, args, timeout = 15000) {
      if (!METHODS.includes(method)) return Promise.reject(error('unavailable', 'Not available inside the browser boundary yet'));
      if (method === 'update.hold') return hold(args);
      if (method === 'update.release') return unhold(args);
      // The shell can't read this page's address; relative title-bar links resolve against it (and are still checked).
      if (method === 'titlebar.set' || method === 'share.text') args = { ...(args && typeof args === 'object' ? args : {}), base: String(location.href || '').slice(0, 2048) };
      if (STICKY.includes(method)) sticky.set(method, args);
      return send1(method, args, timeout);
    },
  });
})();
