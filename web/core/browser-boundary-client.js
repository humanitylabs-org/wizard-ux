/* Opaque-frame client. No owner/native API and no generic request forwarding.
 * Apps load this next to app-client.js; the shell never reads an app document. */
(() => {
  'use strict';
  if (parent === window || globalThis.origin !== 'null') return;
  let channel = '', back = null, applyTheme = null;
  const seals = new Map(), requests = new Map();
  let serial = 0;
  const error = (code, message) => Object.assign(new Error(message), { code });
  function cancelRequests() {
    for (const wait of requests.values()) { clearTimeout(wait.timer); wait.reject(error('denied', 'App document changed')); }
    requests.clear();
  }
  const send = data => parent.postMessage({ type: 'wizard:boundary', version: 1, channel, ...data }, location.origin);
  function release(id) { const s = seals.get(id); if (s) { s.el.removeEventListener('input', s.changed); seals.delete(id); } }
  function clear() { for (const id of seals.keys()) release(id); cancelRequests(); }
  addEventListener('pagehide', () => { clear(); channel = ''; });
  function editable(el) {
    return el?.isConnected && el.matches('textarea,input[type=text],input[type=search],input[type=url],input[type=tel],input:not([type])') && !el.disabled && !el.readOnly && !el.closest('[inert],[data-no-dictation]') && typeof el.selectionStart === 'number';
  }
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== parent || e.origin !== location.origin || !d || d.type !== 'wizard:boundary' || d.version !== 1) return;
    if (d.op === 'hello' && typeof d.channel === 'string' && d.channel.length <= 80) {
      clear(); channel = d.channel; send({ op: 'ready' }); return;
    }
    if (!channel || d.channel !== channel) return;
    if (d.op === 'service.reply') {
      const wait = requests.get(d.id); if (!wait) return;
      clearTimeout(wait.timer); requests.delete(d.id);
      if (d.error) wait.reject(error(d.error.code || 'failed', d.error.message || 'App request failed')); else wait.resolve(d.value);
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
  });
  window.WizBoundaryClient = Object.freeze({
    connect({ onBack, onTheme }) { back = onBack; applyTheme = onTheme; },
    get ready() { return !!channel; },
    request(method, args, timeout = 15000) {
      if (!channel || !['ready', 'share.wizard', 'voice.transcribe'].includes(method)) return Promise.reject(error('unavailable', 'Shared app capability unavailable'));
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
