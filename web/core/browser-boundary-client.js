/* Browser owner boundary, app side (wizard-os#133). Runs only inside a sandboxed (opaque-origin) app frame.
 *
 * core/app-client.js loads this when its document's origin is `null` and it sits in a frame; everywhere else it does
 * nothing. The shell (core/browser-boundary.js) never reads this document. It sends `hello` with a per-load channel;
 * we answer `ready` and from then on take, on that channel only, from the parent window only:
 *  - `back`: run WizardApp's own Back (overlays, registered handlers); reply handled / atRoot.
 *  - `theme`: apply the Appearance v1 context (and the skin layer: stylesheet paths + My skin) through WizardApp's own
 *    validator; ack with `theme.applied`.
 *  - `field.pin` / `field.insert` / `field.release`: seal the focused text field or rich-text (contenteditable) region,
 *    then insert dictated text there only if nobody typed in it meanwhile.
 * And we tell the shell, as one boolean (`field.focus`), whether a text field has focus, so its orb offers dictation.
 * Desktop keys (`input`): a click here (the shell focuses this window), this window losing focus, and only the shell's
 * keys: Esc, bare ⌥ and the ⌥ codes the shell named (`keys`), never plain typing. Esc and those codes are held back
 * from this page, the way the shell's own key handler took them before the boundary; every other ⌥ chord stays this
 * page's alone, and so do ⌥ word moves and, on a Mac, ⌥- / ⌥= typed in a text field.
 * There is no generic request forwarding: request() carries only the methods the shell answers under the boundary:
 * `ready`, `badge.set`, `titlebar.set`, `share.text`, `share.file`, `share.wizard` (the shell opens its own sheet, and
 * only right after a real tap in this page), `voice.transcribe`, `update.hold` / `update.release` and receiving shares
 * (`share.receive`, `share.targets`, `share.pending`, `share.ack`, for this window's own app only), `audio.duck` and
 * the fingerprint vault (`vault.has`, `vault.seal`, `vault.open`, `vault.forget`, this app's own secret) and Wizard ID
 * (`identity.info`, `identity.sign`, `identity.nip44_encrypt`, `identity.nip44_decrypt`: the phone's own approval
 * sheet asks the owner each time). Holds are this
 * document's: the shell drops them with each channel, so they are placed again on every new channel (the id the app
 * gets stays the same). The last badge and title bar are sent again on every
 * new channel (the shell clears the title bar on each load), and a title-bar tap comes back as `tool` (onTool).
 * The shell's notices come as `notice`: `update` (a new shell is ready: { version } or null, onUpdate) and `refresh`
 * (read your data again, with the reason: onRefresh) and `share` (a share is waiting: onShare pulls it), the same
 * signals a same-origin app gets as wizard:app:update / wizard:app:refresh / wizard:app:share.
 * App keys (data-wz-key): while the shell's layout presses app keys (`app` in hello / keys), this page reports its live
 * ⌥ keys as `keys.app` (key, label, box in this window), holds back ⌥ + one of them and sends it as `input`, and on
 * `keys.press` WizardApp presses that control itself (only a key that is live here now).
 * Recording (`capture.*`): the shell's one recorder records for this window's app; preparing or starting a new
 * recording needs a real tap here. Its events come as `notice` `capture` (onCapture), and onReady runs after every
 * hello so WizardApp can read the recorder's state again and reattach its sessions on the new channel.
 * Saved settings (`storage.load`, `storage.save`): the page's localStorage stand-in (core/app-client.js) keeps the
 * shell's copy for this window's app up to date.
 * The app's own backend (`net.fetch`): app-client.js sends the page's fetch to this host through the shell, which makes
 * it only inside this window's app path. One open on a channel that is replaced fails instead of being sent again.
 */
(() => {
  'use strict';
  if (window.WizBoundaryClient) return;
  let framed = false; try { framed = parent !== window; } catch (_) { framed = true; }
  if (!framed || globalThis.origin !== 'null') return;
  const TYPE = 'wizard:boundary', VERSION = 1, METHODS = ['ready', 'badge.set', 'titlebar.set', 'share.text', 'share.file', 'share.wizard', 'voice.transcribe', 'update.hold', 'update.release',
    'share.receive', 'share.targets', 'share.pending', 'share.ack', 'audio.duck', 'vault.has', 'vault.seal', 'vault.open', 'vault.forget',
    'identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt',
    'capture.sync', 'capture.prepare', 'capture.release', 'capture.start', 'capture.call', 'capture.settle', 'capture.pending', 'capture.ack', 'capture.confirm',
    'storage.load', 'storage.save', 'net.fetch', 'net.abort'], STICKY = ['badge.set', 'titlebar.set'];
  // The shell's origin: our URL's own origin (the frame was loaded from the shell's host; only the document is opaque).
  const SHELL = location.origin;
  let channel = '', back = null, applyTheme = null, onTool = null, onUpdate = null, onRefresh = null, onShare = null, onCapture = null, onReady = null, serial = 0, claimed = new Set();
  // App keys (data-wz-key): WizardApp's own live list and press (core/app-client.js keys), used only while the shell's
  // layout presses app keys (`app` in hello / keys).
  let appKeys = null, appPress = null, appOn = false, appSent = '', appQueued = false, appKeyNow = [];
  const CAPTURE_EVENTS = ['level', 'pcm', 'chunk', 'state', 'warn', 'info', 'current'];
  const sticky = new Map();   // the last badge / title bar this document asked for, sent again on a new channel
  const waiters = new Set();   // requests made before the first hello wait for it (up to their own timeout)
  const seals = new Map(), requests = new Map();
  const holds = new Map();   // the app's hold id -> { reason, shell: the shell's id on the current channel, placing }
  const error = (code, message) => Object.assign(new Error(message), { code });
  const send = data => { try { parent.postMessage({ ...data, type: TYPE, version: VERSION, channel }, SHELL); } catch (_) {} };
  function release(id) { const s = seals.get(id); if (s) { s.el.removeEventListener('input', s.changed); s.observer?.disconnect(); seals.delete(id); } }
  function clear() {
    for (const id of [...seals.keys()]) release(id);
    for (const wait of requests.values()) { clearTimeout(wait.timer); wait.reject(error('denied', 'App document changed')); }
    requests.clear();
  }
  addEventListener('pagehide', () => { clear(); sticky.clear(); holds.clear(); channel = ''; });
  const PLAIN = 'textarea,input[type=text],input[type=search],input[type=url],input[type=tel],input[type=email],input:not([type])';
  const plain = el => el.matches(PLAIN);
  // The dictation target for a focused element: a plain text field, or the root of the rich-text (contenteditable)
  // region it sits in, the same rule as the shell's own dictation (core/focused-field.js) for a same-origin app.
  const editable = el => {
    if (!el?.isConnected || typeof el.matches !== 'function' || el.closest('[inert],[data-no-dictation],[aria-disabled="true"]')) return null;
    if (plain(el)) return !el.disabled && !el.readOnly && typeof el.selectionStart === 'number' ? el : null;
    if (el.isContentEditable !== true) return null;
    let root = el;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  };
  // Only whether a dictation-ready field has focus: never which field, its name or its text.
  // When the shell takes focus (the orb, a key on a shell control) this document's activeElement falls back to <body>,
  // so the last focused field is remembered until focus moves to something else inside this document.
  const deepActive = () => { let a = document.activeElement; for (let i = 0; i < 4 && a?.shadowRoot?.activeElement; i++) a = a.shadowRoot.activeElement; return a; };
  // A region inside an open shadow root keeps its caret in that root's selection (Chromium), else the document's.
  const selectionOf = el => { const root = el.getRootNode?.(); return (root && root !== document && root.getSelection?.()) || document.getSelection?.() || null; };
  let fieldSent = null, lastField = null;
  const away = () => typeof document.hasFocus === 'function' && !document.hasFocus();
  const field = () => editable(deepActive()) || (away() && editable(lastField)) || null;
  const reportField = force => {
    if (!channel) return;
    const on = !!field();
    if (!force && on === fieldSent) return;
    fieldSent = on; send({ op: 'field.focus', editable: on });
  };
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('focusin', () => { lastField = editable(deepActive()); reportField(true); }, true);
    document.addEventListener('focusout', () => setTimeout(() => { if (!away()) lastField = editable(deepActive()); reportField(false); }, 0), true);
  }
  // A field that turns read-only, disabled, inert or no-dictation, or leaves the page, without a focus event: say so,
  // so the shell never offers a take that would be refused at the end.
  if (typeof MutationObserver === 'function' && document.documentElement) {
    let queued = false;
    new MutationObserver(() => { if (queued || !fieldSent) return; queued = true; setTimeout(() => { queued = false; reportField(false); }, 0); })
      .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['readonly', 'disabled', 'inert', 'data-no-dictation', 'type', 'contenteditable', 'aria-disabled'] });
  }
  // Desktop keys and clicks for the shell (see the header). The field flag is only whether a text field has focus.
  const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');
  function setKeys(list, app) {
    claimed = new Set(Array.isArray(list) ? list.filter(c => typeof c === 'string' && c.length <= 24).slice(0, 64) : []);
    const was = appOn; appOn = app === true;
    if (appOn !== was) { appSent = ''; appKeyNow = []; }
    reportKeys(true);
  }
  /* App keys for the shell: which of this page's ⌥ keys are live and where each control sits in this window (only key,
   * a short label and a box; never the control itself). Sent when the page changes, scrolls or resizes, and on ⌥. */
  const APP_PUNCT = { Slash: '/', Comma: ',', Period: '.', Semicolon: ';' };
  const appKeyOf = code => { const m = /^Key([A-Z])$/.exec(String(code || '')); return m ? m[1].toLowerCase() : APP_PUNCT[code] || ''; };
  function reportKeys(now) {
    if (!channel || (!appOn && !appSent)) return;
    if (!now) { if (!appQueued) { appQueued = true; setTimeout(() => { appQueued = false; reportKeys(true); }, 60); } return; }
    let list = [];
    if (appOn && typeof appKeys === 'function') {
      try { list = appKeys() || []; } catch (_) { list = []; }
      list = [...list].slice(0, 24).map(t => { const r = t.el.getBoundingClientRect(); return { key: t.key, label: String(t.label || '').slice(0, 64), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(t => t.w > 0 && t.h > 0 && t.y + t.h > 0 && t.x + t.w > 0 && t.y < (globalThis.innerHeight || Infinity) && t.x < (globalThis.innerWidth || Infinity));
    }
    appKeyNow = list.map(t => t.key);
    const sig = JSON.stringify(list); if (sig === appSent) return;
    appSent = list.length ? sig : ''; send({ op: 'keys.app', keys: list });
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(() => { if (appOn) reportKeys(false); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-wz-key', 'data-wz-key-label', 'aria-label', 'hidden', 'disabled', 'aria-disabled', 'inert', 'aria-hidden', 'aria-modal', 'open', 'class', 'style'] });
  }
  addEventListener('scroll', () => { if (appOn) reportKeys(false); }, { capture: true, passive: true });
  addEventListener('resize', () => { if (appOn) reportKeys(false); });
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
  // ⌥ + one of this page's live app keys while the shell presses them: the shell presses it (and may first take the
  // key back for Wizard), as before the boundary. ⇧ is never an app key; on a Mac ⌥E/U/I in a field stay accents.
  function appTakes(e, field) {
    if (!appOn || e.shiftKey || !e.altKey || e.metaKey || e.ctrlKey) return false;
    if (MAC && field && /^(KeyE|KeyU|KeyI)$/.test(e.code)) return false;
    reportKeys(true);
    return appKeyNow.includes(appKeyOf(e.code));
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
    if (bareAlt(e)) reportKeys(true);   // the shell's keys guide is about to show: where the keys sit now
    if (esc || shellTakes(e, field, readOnly) || appTakes(e, field)) { e.preventDefault(); e.stopImmediatePropagation(); } else if (!bareAlt(e)) return;
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
      channel = d.channel; appSent = ''; send({ op: 'ready' }); setKeys(d.keys, d.app); reportField(true);
      for (const [id, wait] of requests) {
        // An app's own backend call may already have reached its server on the old channel: never send it twice (a
        // POST would run twice). It fails like a dropped connection, and the app retries if it wants to.
        if (wait.method === 'net.fetch') { clearTimeout(wait.timer); requests.delete(id); wait.reject(error('failed', 'Connection to the app server was interrupted')); continue; }
        send({ op: 'service.request', id, method: wait.method, args: wait.args });
      }
      for (const go of [...waiters]) go();
      // Holds: the shell dropped them with the old channel. One still being placed is re-sent above with the requests.
      for (const h of holds.values()) { h.shell = null; if (!h.placing) place(h); }
      for (const [method, args] of sticky) {
        if (![...requests.values()].some(w => w.method === method)) send({ op: 'service.request', id: 'wbs-' + (++serial), method, args });
      }
      try { onReady?.(); } catch (_) {}
      return;
    }
    if (!channel || d.channel !== channel) return;
    if (d.op === 'keys') { setKeys(d.keys, d.app); return; }
    if (d.op === 'keys.press') {
      // Only a key this page has live now; WizardApp presses its own control (a field as the target takes focus).
      if (!appOn || typeof d.key !== 'string' || typeof appPress !== 'function') return;
      reportKeys(true);
      if (appKeyNow.includes(d.key)) { try { appPress(d.key); } catch (_) {} }
      return;
    }
    if (d.op === 'tool') {
      if (typeof d.tool !== 'string' || d.tool.length > 32 || (d.value !== undefined && typeof d.value !== 'string')) return;
      try { onTool?.({ id: d.tool, value: d.value }); } catch (_) {}
      return;
    }
    if (d.op === 'notice') {
      if (d.kind === 'refresh' && ['visible', 'focus', 'poll', 'agent'].includes(d.reason)) { try { onRefresh?.(d.reason); } catch (_) {} }
      if (d.kind === 'share') { try { onShare?.(); } catch (_) {} }
      if (d.kind === 'capture' && CAPTURE_EVENTS.includes(d.event) && (d.id === undefined || (typeof d.id === 'string' && d.id.length <= 128))) {
        try { onCapture?.({ event: d.event, id: d.id, value: d.value, info: d.info && typeof d.info === 'object' ? d.info : undefined }); } catch (_) {}
      }
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
      let ok = false; try { ok = applyTheme?.(d.appearance, d.layer) === true; } catch (_) {}
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
      let s;
      if (plain(el)) s = { el, value: el.value, start: el.selectionStart, end: el.selectionEnd };
      else {
        // Rich text: the caret (or selection) must sit inside the region; any change to it before the words land
        // (typing, an editor's own update) ends the seal, as the shell does for a same-origin contenteditable.
        const sel = selectionOf(el), range = sel?.rangeCount ? sel.getRangeAt(0) : null;
        if (!range || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return reply('refused');
        s = { el, rich: true, value: el.innerHTML, range: range.cloneRange() };
        if (typeof MutationObserver === 'function') {
          s.observer = new MutationObserver(() => release(id));
          s.observer.observe(el, { subtree: true, childList: true, characterData: true });
        }
      }
      s.changed = () => release(id);
      el.addEventListener('input', s.changed); seals.set(id, s);
      return reply('pinned', { seal: id });
    }
    if (d.op === 'field.release') { release(d.seal); return; }
    if (d.op === 'field.insert') {
      const s = seals.get(d.seal);
      if (!s || editable(s.el) !== s.el || typeof d.text !== 'string' || d.text.length > 100000) { release(d.seal); return reply('stale'); }
      if (s.rich) return reply(insertRich(s, d.seal, d.text) ? 'inserted' : 'stale');
      if (s.value !== s.el.value) { release(d.seal); return reply('stale'); }
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
  // Dictated words into a sealed rich-text region, the way the shell does it for a same-origin app: through the
  // browser's own editing pipeline (beforeinput + input, so editors and an attached keyboard stay in sync), with a
  // manual insert only as the fallback. Never if the region changed or the sealed caret left it.
  function insertRich(s, id, words) {
    const el = s.el, r = s.range;
    const ok = s.value === el.innerHTML && el.contains(r.startContainer) && el.contains(r.endContainer);
    release(id);
    if (!ok) return false;
    const selection = selectionOf(el);
    if (!selection) return false;
    let t = words, native = false;
    const was = deepActive();
    try {
      // Same neighbour spacing as plain fields; only the caret's own text node counts, so a new line never gains a space.
      const c = r.startContainer, o = r.startOffset, prev = c.nodeType === 3 ? c : c.childNodes[o - 1];
      const before = c.nodeType === 3 ? (o ? c.data[o - 1] : '') : prev?.nodeType === 3 ? prev.data.slice(-1) : '';
      if (before && !/\s/.test(before) && /^[^\s.,;:!?)]/.test(t)) t = ' ' + t;
      if (!el.contains(deepActive())) el.focus({ preventScroll: true });
      selection.removeAllRanges(); selection.addRange(r);
      native = !!document.execCommand('insertText', false, t);
    } catch (_) { native = false; }
    if (was && was !== document.body && !el.contains(was) && was.isConnected) { try { was.focus({ preventScroll: true }); } catch (_) {} }
    if (native) return true; // the browser already fired input; never add a second
    try {
      r.deleteContents();
      const node = document.createTextNode(t); r.insertNode(node); r.setStartAfter(node); r.collapse(true);
      selection.removeAllRanges(); selection.addRange(r);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: words }));
      return true;
    } catch (_) { return false; }
  }
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
    connect({ onBack, onTheme, onTool: tap, onUpdate: upd, onRefresh: fresh, onShare: shared, onCapture: recording, onReady: hello, keys: listKeys, press } = {}) {
      appKeys = typeof listKeys === 'function' ? listKeys : null; appPress = typeof press === 'function' ? press : null;
      onCapture = typeof recording === 'function' ? recording : null; onReady = typeof hello === 'function' ? hello : null;
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
