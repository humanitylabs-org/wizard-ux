/* Opaque-frame client. No owner/native API and no generic request forwarding.
 * Apps load this next to app-client.js; the shell never reads an app document. */
(() => {
  'use strict';
  if (parent === window || globalThis.origin !== 'null') return;
  let channel = '', port = null, connected = false, back = null, applyTheme = null;
  const seals = new Map(), requests = new Map();
  let serial = 0;
  const error = (code, message, retryable = false) => Object.assign(new Error(message), { code, retryable });
  function cancelRequests() {
    for (const wait of requests.values()) { clearTimeout(wait.timer); wait.reject(error('denied', 'App document changed')); }
    requests.clear();
  }
  const send = data => port?.postMessage({ type: 'wizard:boundary', version: 1, channel, ...data });
  function release(id) { const s = seals.get(id); if (s) { s.el.removeEventListener('input', s.changed); seals.delete(id); } }
  function clear() { connected=false; for (const id of seals.keys()) release(id); cancelRequests(); }
  addEventListener('pagehide', () => { clear(); port?.close(); port=null; channel = ''; });
  function editable(el) {
    return el?.isConnected && el.matches('textarea,input[type=text],input[type=search],input[type=url],input[type=tel],input:not([type])') && !el.disabled && !el.readOnly && !el.closest('[inert],[data-no-dictation]') && typeof el.selectionStart === 'number';
  }
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || e.origin !== location.origin || !d || d.type !== 'wizard:boundary' || d.version !== 1) return;
    if (d.op !== 'hello' || typeof d.channel !== 'string' || d.channel.length > 80) return;
    clear(); port?.close(); channel = d.channel;
    const ports = new MessageChannel(); port = ports.port1;
    port.onmessage = event => receive(event.data); port.start();
    parent.postMessage({type:'wizard:boundary',version:1,channel,op:'ready',portRole:'document'},location.origin,[ports.port2]);
  });
  function receive(d) {
    if (!d || d.type !== 'wizard:boundary' || d.version !== 1 || !channel || d.channel !== channel) return;
    if (d.op === 'challenge' && typeof d.nonce === 'string') { send({op:'challenge.reply',nonce:d.nonce}); return; }
    if (d.op === 'connected') { connected=true; dispatchEvent(new Event('wizard:boundary:connected')); return; }
    if (!connected) return;
    if (d.op === 'service.reply') {
      const wait = requests.get(d.id); if (!wait) return;
      clearTimeout(wait.timer); requests.delete(d.id);
      if (d.error) { const e = error(d.error.code || 'failed', typeof d.error.message === 'string' ? d.error.message.slice(0, 300) : 'App request failed', d.error.retryable === true); if (typeof d.error.outcome === 'string') e.outcome = d.error.outcome; if (typeof d.error.operationKey === 'string') e.operationKey = d.error.operationKey; if (Number.isSafeInteger(d.error.offset)) e.offset = d.error.offset; wait.reject(e); } else wait.resolve(d.value);
      return;
    }
    const reply = (status, extra = {}) => send({ op: 'reply', id: d.id, status, ...extra });
    if (d.op === 'theme') { try { if (applyTheme?.(d.appearance) === true) send({ op: 'theme.applied', revision: d.appearance.revision }); } catch (_) {} return; }
    if (d.op === 'back') { try { reply(back?.() === true ? 'handled' : back ? 'atRoot' : 'refused'); } catch (_) { reply('refused'); } return; }
    if (d.op === 'field.pin') {
      const el = document.activeElement;
      if (!editable(el) || seals.size >= 4) return reply('refused');
      const id = crypto.randomUUID(), s = { el, value: el.value, start: el.selectionStart, end: el.selectionEnd, dirty: false };
      s.changed = () => { s.dirty = true; };
      el.addEventListener('input', s.changed); seals.set(id, s);
      return reply('pinned', { seal: id });
    }
    if (d.op === 'field.release') { release(d.seal); return; }
    if (d.op === 'field.insert') {
      const s = seals.get(d.seal);
      if (!s || s.dirty || !editable(s.el) || s.value !== s.el.value || typeof d.text !== 'string' || d.text.length > 100000) { release(d.seal); return reply('stale'); }
      release(d.seal);
      let text = d.text;
      const before = s.value.slice(0, s.start).slice(-1), after = s.value.slice(s.end, s.end + 1);
      if (before && !/\s/.test(before) && /^[^\s.,;:!?)]/.test(text)) text = ' ' + text;
      if (after && !/\s/.test(after) && !/[\s(]$/.test(text)) text += ' ';
      s.el.setRangeText(text, s.start, s.end, 'end');
      s.el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: d.text }));
      return reply('inserted');
    }
  }
  window.WizBoundaryClient = Object.freeze({
    connect({ onBack, onTheme }) { back = onBack; applyTheme = onTheme; },
    get ready() { return connected; },
    request(method, args, timeout = 15000) {
      if (!connected || !['ready', 'share.wizard', 'voice.transcribe', 'nav.contextDraft', 'data.call', 'data.status', 'media.open', 'state.read', 'state.write', 'state.transaction', 'intent.confirm', 'intent.open', 'recovery.call', 'store.call', 'upload.create', 'upload.chunk', 'upload.status', 'upload.commit', 'upload.abort', 'download.request'].includes(method)) return Promise.reject(error('unavailable', 'Shared app capability unavailable'));
      if (requests.size >= 32) return Promise.reject(error('busy', 'Too many pending app requests'));
      const id = 'wbs-' + (++serial);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(id); reject(error('timeout', 'Shared app request timed out')); }, timeout);
        requests.set(id, { resolve, reject, timer });
        try { send({ op: 'service.request', id, method, args }); }
        catch (err) { clearTimeout(timer); requests.delete(id); reject(err); }
      });
    },
  });
})();
