/* The Share to Wizard sheet, shared by native incoming shares and installed apps on both shells.
 * REUSE: Chats uploads + durable send, WizAttachChip for the items. EXTEND: device.js's sheet, not the Android share tray. */
(() => {
  'use strict';
  if (window.WizShareWizard) return;
  const host = () => window.__wos || window.__wux;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blob = x => x && ['[object Blob]', '[object File]'].includes(Object.prototype.toString.call(x));
  const fsize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  let active = null, jobs = 0; const retries = [];
  function valid(data) {
    const files = data?.files ?? [];
    if (!Array.isArray(files) || files.length > 10 || files.some(f => !blob(f)) || files.reduce((n,f) => n + f.size, 0) > 100 * 1048576) throw new Error('Use up to 10 files / 100 MB');
    if (data?.text != null && (typeof data.text !== 'string' || data.text.length > 100000)) throw new Error('Use up to 100000 characters');
    if (data?.title != null && (typeof data.title !== 'string' || data.title.length > 200)) throw new Error('Invalid share title');
    if (!files.length && !data?.text?.trim()) throw new Error('Nothing to share');
    return {files, text: data?.text || '', title: data?.title || ''};
  }
  function finish(result) {
    const a = active; if (!a) return;
    active = null; a.el.remove(); a.mount.classList.remove('dv-share-open');
    a.urls.forEach(u => URL.revokeObjectURL(u)); a.resolve(result); a.focus?.focus?.();
    const next = retries.shift(); if (next) setTimeout(() => open(...next), 0); // a failed send waiting its turn
  }
  function back() { if (!active) return false; finish('cancelled'); return true; }
  // Layout (James, 27 Oct 2026): two choices, "New chat" or one existing chat picked from a dropdown; the forwarded
  // content sits in a greyed, read-only quote; his own comment goes in a separate box above it. Send closes the
  // sheet at once and the upload + send carry on in the background, so nobody stares at "Uploading 3 of 3…".
  function open({items = [], text = '', title = '', skipped = 0, stay = false, comment = '', error = '', dest = ''} = {}, authorize = () => true) {
    const w = host(), chats = w?.chats;
    if (!w || !chats?.uploadFile || !chats?.sendChat || !(w.openWizardThread || w.openThread)) return Promise.resolve('unsupported');
    if (active) return Promise.resolve('unsupported'); // never replace a sheet holding someone's unsent note
    const threads = (w.live?.sessions || []).filter(s => !s.archived && !s.hidden).slice(0, 40);
    const mount = document.querySelector('#device') || document.body;
    const el = document.createElement('div'); el.className = 'wz-share dv-wrap open'; el.dataset.dv = 'share';
    const kind = f => /^image\//.test(f.mime) ? 'image' : /^audio\//.test(f.mime) ? 'voice' : 'file';
    const kept = items.map(() => true), urls = [];
    const preview = items.map(f => { if (kind(f) !== 'image' || f.bytes >= 6e6) return ''; try { const u = URL.createObjectURL(f.blob || f.read()); urls.push(u); return u; } catch (_) { return ''; } });
    const chip = (f, n) => window.WizAttachChip ? WizAttachChip.html({key: String(n), name: f.name, bytes: f.bytes, kind: kind(f) === 'voice' && !/voice|ptt/i.test(f.name) ? 'file' : kind(f), preview: preview[n] || ''})
      : `<span class="ch-att" data-attkey="${n}"><span class="nm">${esc(f.name)}<small>${esc(fsize(f.bytes))}</small></span><button type="button" class="ch-attrm" data-attrm="${n}" aria-label="Remove">×</button></span>`;
    el.innerHTML = `<div class="dv-scrim" data-dvclose></div><section class="dv-sheet" role="dialog" aria-modal="true" aria-label="Share to Wizard" tabindex="-1">
      <div class="dv-head"><span class="dv-ic">↗</span><div><b>Share to Wizard</b><small>${items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Text'}${skipped ? ` · ${skipped} skipped (too large or unreadable)` : ''}</small></div><button class="dv-cancel" data-dvclose aria-label="Cancel share">×</button></div>
      ${title ? `<p class="dv-source">${esc(title)}</p>` : ''}
      <div class="dv-items">${items.map(chip).join('')}</div>
      <textarea class="dv-text" rows="2" aria-label="Your comment" placeholder="Add a comment or context (optional)">${esc(comment)}</textarea>
      ${text ? `<blockquote class="dv-quote" aria-label="Shared content (not editable)" tabindex="0">${esc(text)}</blockquote>` : ''}
      <div class="dv-dest" role="radiogroup" aria-label="Send to">
        <label class="dv-opt"><input type="radio" name="dv-dest" value="new"${dest && threads.some(t => t.id === dest) ? '' : ' checked'}><span>New chat</span></label>
        ${threads.length ? `<label class="dv-opt dv-pick"><input type="radio" name="dv-dest" value="pick" aria-label="Existing chat"${dest && threads.some(t => t.id === dest) ? ' checked' : ''}><select class="dv-chat" aria-label="Existing chat"><option value="">Add to a chat…</option>${threads.map(s => `<option value="${esc(s.id)}"${s.id === dest ? ' selected' : ''}>${esc(s.title || 'Untitled chat')}</option>`).join('')}</select></label>` : ''}
      </div>
      <button class="dv-btn primary wide dv-send" data-sharesend>Send</button>
      <div class="dv-status" aria-live="polite">${esc(error)}</div></section>`;
    return new Promise(resolve => {
      const a = active = {el, mount, resolve, urls, focus: document.activeElement};
      mount.append(el); mount.classList.add('dv-share-open'); el.querySelector('[role=dialog]').focus({preventScroll:true});
      const $ = q => el.querySelector(q), status = $('.dv-status'), pick = $('.dv-chat');
      const radio = v => $(`input[name="dv-dest"][value="${v}"]`);
      pick?.addEventListener('change', () => { radio(pick.value ? 'pick' : 'new').checked = true; status.textContent = ''; });
      radio('pick')?.addEventListener('change', () => { if (!pick.value) { pick.focus(); try { pick.showPicker?.(); } catch (_) {} } });
      el.addEventListener('click', e => {
        if (e.target.closest('[data-dvclose]')) return back();
        const rm = e.target.closest('[data-attrm]');
        if (rm) { const n = Number(rm.dataset.attrm); kept[n] = false; rm.closest('[data-attkey]')?.remove(); const left = kept.filter(Boolean).length; $('.dv-head small').firstChild.textContent = left ? `${left} ${left === 1 ? 'item' : 'items'}` : 'Text'; return; }
        if (!e.target.closest('[data-sharesend]')) return;
        if (!authorize()) return finish('unsupported');
        const target = radio('pick')?.checked ? pick.value : '__new__';
        if (!target) { status.textContent = 'Choose a chat, or pick New chat'; pick.focus(); return; }
        const note = [$('.dv-text').value.trim(), text.trim()].filter(Boolean).join('\n\n'), chosen = items.filter((_, n) => kept[n]);
        if (!note && !chosen.length) { status.textContent = 'Add a comment first'; return; }
        // Read every item now (a native share is released as soon as this resolves); only the upload is slow.
        let files;
        try { files = chosen.map(f => new File([f.blob || f.read()], f.name, {type: f.mime})); }
        catch (_) { status.textContent = 'Couldn’t read a shared item · remove it and try again'; return; }
        const job = {files, note, target, stay, title, text, comment: $('.dv-text').value, authorize};
        finish('sent');
        deliver(w, chats, job);
      });
    });
  }
  async function deliver(w, chats, job) {
    jobs++;
    try {
      const uploaded = [];
      for (const f of job.files) uploaded.push(await chats.uploadFile(f));
      if (!job.authorize()) return; // the app lost its share permission while uploading
      // Never navigate: the owner has moved on. Any main Chats window carries the send (away + sid never moves it);
      // with none open, one is opened for the send and the desk/window the owner is on is put back straight away.
      const before = new Set(Object.keys(w.wins || {})), deskWas = w.idx, focusWas = w.cur ?? w.desks?.[w.idx]?.focus;
      let wid = Object.keys(w.wins || {}).find(k => w.wins[k].app === 'chats' && !w.wins[k].agent), opened = false;
      if (!wid) {
        (w.openWizardThread || w.openThread)(job.target);
        wid = Object.keys(w.wins).find(k => w.wins[k].app === 'chats' && w.wins[k].thread === job.target);
        opened = !!wid && !before.has(wid);
        if (deskWas != null && w.idx !== deskWas) w.goDesk?.(deskWas, true);
        if (focusWas != null && w.wins?.[focusWas]) w.focusWin?.(focusWas);
      }
      if (!wid) throw new Error('No chat window');
      // Keep the destination's draft/tray untouched. One message carries all files and the note.
      let receipt;
      try { receipt = await chats.sendChat(wid, job.note, 'shared to Wizard', null, {sid: job.target, files: uploaded, seal: false, away: true}); }
      finally { if (opened && w.wins?.[wid]) w.closeWin?.(wid, true); }
      if (!receipt) throw new Error('Could not save the message');
      if (!job.stay) w.toast?.('✦', 'Sent to Wizard', 1800);
    } catch (err) {
      // Nothing is lost: the same share comes back with the comment and destination kept, ready to send again.
      w.toast?.('!', 'Couldn’t send to Wizard · try again', 3200);
      const again = [{items: job.files.map(f => ({name: f.name, mime: f.type, bytes: f.size, blob: f})), text: job.text, title: job.title, stay: job.stay, comment: job.comment, dest: job.target === '__new__' ? '' : job.target, error: 'Couldn’t send · check the connection and try again'}, job.authorize];
      if (active) retries.push(again); else open(...again);
    } finally { jobs--; }
  }
  function wizard(data, authorize) {
    const p = valid(data);
    return open({stay:true, text:p.text, title:p.title, items:p.files.map((f,n) => ({name:f.name || `attachment-${n+1}`, mime:f.type, bytes:f.size, blob:f}))}, authorize);
  }
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); back(); }
    if (e.key === 'Tab') {
      const xs = [...active.el.querySelectorAll('button:not(:disabled),textarea,input,select,[tabindex="0"]')], first = xs[0], last = xs.at(-1);
      if (e.shiftKey && (document.activeElement === first || !xs.includes(document.activeElement))) {e.preventDefault();last?.focus();}
      else if (!e.shiftKey && (document.activeElement === last || !xs.includes(document.activeElement))) {e.preventDefault();first?.focus();}
    }
  }, true);
  window.WizShareWizard = Object.freeze({open, wizard, valid, back, get busy() {return !!active || jobs > 0;}});
})();
