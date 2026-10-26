/* The Share to Wizard sheet, shared by native incoming shares and installed apps on both shells.
 * REUSE: Chats uploads + durable send. EXTEND: device.js's sheet, not the Android share tray. */
(() => {
  'use strict';
  if (window.WizShareWizard) return;
  const host = () => window.__wos || window.__wux;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blob = x => x && ['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(x));
  const fsize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  let active = null;
  const CONFIRM_TIMEOUT_MS = 60000; // opaque apps cannot keep an unattended confirmation open forever
  function valid(data) {
    const files = data?.files ?? [];
    if (!Array.isArray(files) || files.length > 10 || files.some(f => !blob(f)) || files.reduce((n,f) => n + f.size, 0) > 100 * 1048576) throw new Error('Use up to 10 files / 100 MB');
    if (data?.text != null && (typeof data.text !== 'string' || data.text.length > 100000)) throw new Error('Use up to 100000 characters');
    if (data?.title != null && (typeof data.title !== 'string' || data.title.length > 200)) throw new Error('Invalid share title');
    if (!files.length && !data?.text?.trim()) throw new Error('Nothing to share');
    return {files, text: data?.text || '', title: data?.title || ''};
  }
  function finish(result, expected = active) {
    const a = active; if (!a || a !== expected) return;
    active = null; clearTimeout(a.confirmTimer); clearInterval(a.authorityTimer); a.el.remove(); a.mount.classList.remove('dv-share-open');
    a.urls.forEach(u => URL.revokeObjectURL(u)); a.resolve(result); a.focus?.focus?.();
  }
  function back() { if (!active) return false; if (!active.busy) finish('cancelled'); return true; }
  function open({items = [], text = '', title = '', skipped = 0, stay = false, requireTrusted = false} = {}, authorize = () => true) {
    if (requireTrusted && !authorize()) return Promise.resolve('denied');
    const w = host(), chats = w?.chats;
    if (!w || !chats?.uploadFile || !chats?.sendChat || !(w.openWizardThread || w.openThread)) return Promise.resolve('unsupported');
    if (active) return Promise.resolve('unsupported'); // never replace a sheet holding someone's unsent note
    const threads = (w.live?.sessions || []).filter(s => !s.archived && !s.hidden).slice(0, 6);
    const mount = document.querySelector('#device') || document.body;
    const el = document.createElement('div'); el.className = 'wz-share dv-wrap open'; el.dataset.dv = 'share';
    el.innerHTML = `<div class="dv-scrim" data-dvclose></div><section class="dv-sheet" role="dialog" aria-modal="true" aria-label="Share to Wizard" tabindex="-1">
      <div class="dv-head"><span class="dv-ic">↗</span><div><b>Share to Wizard</b><small>${items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Text'}${skipped ? ` · ${skipped} skipped (too large or unreadable)` : ''}</small></div><button class="dv-cancel" data-dvclose aria-label="Cancel share">×</button></div>
      ${title ? `<p class="dv-source">${esc(title)}</p>` : ''}
      <div class="dv-items">${items.map((f,n) => `<span class="dv-item" data-n="${n}">${/^image\//.test(f.mime) ? '<img alt="">' : '<span class="dv-fi">▤</span>'}<span class="dv-nm">${esc(f.name)}<small>${esc(fsize(f.bytes))}</small></span></span>`).join('')}</div>
      <textarea class="dv-text" rows="3" aria-label="Share message" placeholder="Add a message (optional)">${esc(text)}</textarea>
      <button class="dv-btn primary wide" data-shareto="__new__">Send to a new chat</button>
      ${threads.length ? `<div class="dv-sub">Or add to a chat</div>${threads.map(s => `<button class="dv-thread" data-shareto="${esc(s.id)}">${esc(s.title || 'Untitled chat')}</button>`).join('')}` : ''}
      <div class="dv-status" aria-live="polite"></div></section>`;
    return new Promise(resolve => {
      const a = active = {el, mount, resolve, busy: false, urls: [], uploaded: [], focus: document.activeElement};
      if (requireTrusted) {
        a.confirmTimer = setTimeout(() => { if (active === a) finish('denied'); }, CONFIRM_TIMEOUT_MS);
        a.authorityTimer = setInterval(() => { if (active === a && !authorize()) finish('denied'); }, 250);
      }
      mount.append(el); mount.classList.add('dv-share-open'); el.querySelector('[role=dialog]').focus({preventScroll:true});
      items.forEach((f,n) => { if (/^image\//.test(f.mime) && f.bytes < 6e6) {
        try { const u = URL.createObjectURL(f.blob || f.read()); a.urls.push(u); el.querySelector(`[data-n="${n}"] img`).src = u; } catch (_) {}
      }});
      el.addEventListener('click', async e => {
        if (e.target.closest('[data-dvclose]')) return back();
        const b = e.target.closest('[data-shareto]'); if (!b || a.busy) return;
        if (requireTrusted && (e.isTrusted !== true || e.target.ownerDocument !== document || b.ownerDocument !== document || !b.isConnected || !el.isConnected || !el.contains(b))) return finish('denied', a);
        if (!authorize()) return finish(requireTrusted ? 'denied' : 'unsupported', a);
        const note = el.querySelector('.dv-text').value.trim(), status = el.querySelector('.dv-status');
        if (!note && !items.length) { status.textContent = 'Add a message first'; return; }
        clearTimeout(a.confirmTimer);
        a.busy = true; el.querySelectorAll('button').forEach(x => x.disabled = true);
        try {
          // Retain successful upload receipts across retries; there is still exactly one send.
          for (let n = a.uploaded.length; n < items.length; n++) {
            if (!authorize()) return finish(requireTrusted ? 'denied' : 'unsupported', a);
            const f = items[n]; status.textContent = `Uploading ${n + 1} of ${items.length}…`;
            a.uploaded.push(await chats.uploadFile(new File([f.blob || f.read()], f.name, {type: f.mime})));
          }
          if (!authorize()) return finish(requireTrusted ? 'denied' : 'unsupported', a);
          status.textContent = 'Sending…';
          const target = b.dataset.shareto;
          // From an installed app (stay): send in the background and leave the owner where they were. Any existing
          // main Chats window can carry the send (sendChat with away + sid never navigates it); with none open, one is
          // opened for the send, then closed and the previous desk/window put back.
          const before = new Set(Object.keys(w.wins || {})), deskWas = w.idx, focusWas = w.cur ?? w.desks?.[w.idx]?.focus;
          let wid = stay ? Object.keys(w.wins).find(k => w.wins[k].app === 'chats' && !w.wins[k].agent) : '';
          const opened = !wid;
          if (!wid) { (w.openWizardThread || w.openThread)(target); wid = Object.keys(w.wins).find(k => w.wins[k].app === 'chats' && w.wins[k].thread === target); }
          if (!wid) throw new Error('No chat window');
          // Keep the destination's draft/tray untouched. One message carries all files and the edited note.
          const receipt = await chats.sendChat(wid, note, 'shared to Wizard', null, {sid: target, files: a.uploaded, seal: false, away: true});
          if (stay && opened) {
            if (!before.has(wid)) w.closeWin?.(wid, true);
            if (deskWas != null && w.idx !== deskWas) w.goDesk?.(deskWas, true);
            if (focusWas != null && w.wins?.[focusWas]) w.focusWin?.(focusWas);
          }
          if (!receipt) throw new Error('Could not save the message');
          finish('sent', a); w.toast?.('✦', 'Sent to Wizard', 1800);
        } catch (err) {
          a.busy = false; el.querySelectorAll('button').forEach(x => x.disabled = false);
          status.textContent = (err.user ? err.message : 'Couldn’t send · check the connection and try again');
        }
      });
    });
  }
  function wizard(data, authorize, { requireTrusted = false } = {}) {
    const p = valid(data);
    return open({stay:true, requireTrusted, text:p.text, title:p.title, items:p.files.map((f,n) => ({name:f.name || `attachment-${n+1}`, mime:f.type, bytes:f.size, blob:f}))}, authorize);
  }
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); back(); }
    if (e.key === 'Tab') {
      const xs = [...active.el.querySelectorAll('button:not(:disabled),textarea')], first = xs[0], last = xs.at(-1);
      if (e.shiftKey && (document.activeElement === first || !xs.includes(document.activeElement))) {e.preventDefault();last?.focus();}
      else if (!e.shiftKey && (document.activeElement === last || !xs.includes(document.activeElement))) {e.preventDefault();first?.focus();}
    }
  }, true);
  window.WizShareWizard = Object.freeze({open, wizard, valid, back, get busy() {return !!active;}});
})();
