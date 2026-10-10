/* Usuals: James's regular Grab orders, one tap (or "order my usual …") away.
 * Native does the work (android/.../usuals/*): it teaches by watching James build a basket in Grab once, then replays
 * those taps under a cover and stops on Grab's checkout. Placing the order is always James's tap on the cover.
 * This file is only the window: the list, Teach, Order, rename/edit, and what the last run did. */
(() => {
  'use strict';
  const N = () => window.WizardOSNative;
  const has = () => !!(N() && typeof N().usuals === 'function');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const els = new Set();
  let editing = null; // { id } while the edit sheet is open
  let teachName = null; // the name field while it is open

  function read() {
    if (!has()) return { list: [], blocker: 'native', state: {} };
    try { return JSON.parse(N().usuals() || '{}'); } catch (e) { return { list: [], blocker: '', state: {} }; }
  }
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const lastLine = u => {
    const r = u.lastResult || '';
    if (!u.lastRunAt) return u.lastTotal ? `Last basket ${u.lastTotal}` : `${u.steps.length} steps · never run`;
    if (r === 'ordered') return `Ordered ${ago(u.lastRunAt)}${u.lastTotal ? ' · ' + u.lastTotal : ''}`;
    if (r === 'ready') return `Reached checkout ${ago(u.lastRunAt)}${u.lastTotal ? ' · ' + u.lastTotal : ''}`;
    if (r.startsWith('failed')) return `Stopped ${ago(u.lastRunAt)} · ${r.replace(/^failed: /, '')}`;
    return `${u.steps.length} steps`;
  };

  function blockerCard(b) {
    if (b === 'native') return `<div class="us-note">Usuals runs on the Wizard OS Android app. Open it there to teach and order.</div>`;
    if (b === 'accessibility') return `<button class="us-note us-fix" data-us="a11y"><b>One switch first</b><span>Usuals taps through Grab with Wizard OS accessibility (the same switch as voice typing). Tap to turn it on.</span></button>`;
    if (b === 'grab') return `<div class="us-note"><b>Grab isn't on this phone</b><span>Install Grab and sign in, then come back.</span></div>`;
    return '';
  }

  function html() {
    const d = read(), list = d.list || [], b = d.blocker || '';
    const st = d.state || {};
    const live = st.mode && !/^(idle|done)$/.test(st.mode) && st.mode !== 'failed' ? `<div class="us-live">${esc(st.name)} · ${esc(st.status)}</div>` : '';
    const cards = list.map(u => `<div class="us-card" data-id="${esc(u.id)}">
        <button class="us-go" data-us="run" data-id="${esc(u.id)}" ${b ? 'disabled' : ''} aria-label="Order ${esc(u.name)}"><span class="us-ic">🍜</span><span class="us-meta"><b>${esc(u.name)}</b><small>${esc(lastLine(u))}</small></span><span class="us-cta">Order</span></button>
        <button class="us-more" data-us="edit" data-id="${esc(u.id)}" aria-label="Edit ${esc(u.name)}">⋯</button></div>`).join('');
    const empty = !list.length ? `<div class="us-empty"><div class="us-big">🍜</div><h3>Your usuals, one tap away</h3>
        <p>Teach a usual once: Grab opens, you build the basket like normal and stop at checkout, then tap Done. After that, tap it here or say <i>“order my usual ${'kra pao'}”</i>. Wizard fills the basket under a cover and waits for you to tap <b>Place order</b>.</p></div>` : '';
    const teach = teachName != null
      ? `<form class="us-teach" data-us-form="teach"><input name="n" maxlength="40" placeholder="Name it, e.g. Kra pao" value="${esc(teachName)}" autocomplete="off" enterkeyhint="go"><button type="submit" ${b ? 'disabled' : ''}>Open Grab</button></form>`
      : `<button class="us-add" data-us="teach" ${b ? 'disabled' : ''}>＋ Teach a usual</button>`;
    const log = st.log && st.log.length && st.mode === 'failed' ? `<details class="us-log"><summary>What the last run did</summary><pre>${esc(st.log.slice(-12).join('\n'))}</pre></details>` : '';
    return `<div class="desk-scroll us-wrap">${blockerCard(b)}${live}${empty}<div class="us-list">${cards}</div>${teach}
      <p class="us-fine">Runs on this phone with Grab open under a cover; it takes about half a minute. Your Grab login, card and address stay in Grab. Wizard never presses Place order for you.</p>${log}</div>${editSheet(list)}`;
  }

  function editSheet(list) {
    if (!editing) return '';
    const u = list.find(x => x.id === editing.id); if (!u) { editing = null; return ''; }
    return `<div class="us-sheet" data-us-sheet><form data-us-form="edit" data-id="${esc(u.id)}"><h4>Edit usual</h4>
      <label>Name<input name="n" maxlength="40" value="${esc(u.name)}"></label>
      <label>Steps <small>one per line · “tap Name”, “tap Add @ Item”, “type words”, “search”, “wait 1500”</small><textarea name="s" rows="8" spellcheck="false">${esc(u.script || '')}</textarea></label>
      <div class="us-row"><button type="button" data-us="delete" data-id="${esc(u.id)}" class="us-del">Delete</button><button type="button" data-us="reteach" data-id="${esc(u.id)}">Teach again</button><button type="submit" class="us-save">Save</button></div></form></div>`;
  }

  function paint() { els.forEach(el => { if (!el.isConnected) { els.delete(el); return; } const f = document.activeElement; const keep = f && el.contains(f) && f.name; el.innerHTML = html(); if (keep) { const n = el.querySelector(`[name="${keep}"]`); if (n) { n.focus(); n.setSelectionRange?.(n.value.length, n.value.length); } } }); }

  function toast(i, t) { window.__wos?.toast?.(i, t, 2600); }
  function why(b) {
    return b === 'accessibility' ? 'Turn on Wizard OS accessibility first' : b === 'grab' ? "Grab isn't installed" : b === 'busy' ? 'Finish teaching first' : b === 'missing' ? 'That usual is gone' : b;
  }

  function onClick(e) {
    const t = e.target.closest('[data-us]'); if (!t) return;
    const a = t.dataset.us, id = t.dataset.id;
    if (a === 'a11y') return N()?.voiceTypingSettings?.();
    if (a === 'teach') { teachName = ''; paint(); setTimeout(() => document.querySelector('.us-teach input')?.focus(), 30); return; }
    if (a === 'run') { const r = N().usualsRun(id); if (r) toast('🍜', why(r)); return; }
    if (a === 'edit') { editing = { id }; paint(); return; }
    if (a === 'delete') { if (!confirm('Delete this usual?')) return; N().usualsDelete(id); editing = null; paint(); return; }
    if (a === 'reteach') { const u = (read().list || []).find(x => x.id === id); editing = null; const r = N().usualsTeach(u ? u.name : ''); if (r) toast('🍜', why(r)); else N().usualsDelete(id); paint(); return; }
  }
  function onSubmit(e) {
    const f = e.target.closest('[data-us-form]'); if (!f) return;
    e.preventDefault();
    if (f.dataset.usForm === 'teach') {
      const name = f.n.value.trim() || 'My usual';
      teachName = null; paint();
      const r = N().usualsTeach(name); if (r) toast('🍜', why(r));
      return;
    }
    if (f.dataset.usForm === 'edit') {
      const ok = N().usualsSave(f.dataset.id, f.n.value, f.s.value);
      if (!ok) { toast('⚠', 'Those steps need at least one line'); return; }
      editing = null; paint(); toast('✓', 'Saved');
    }
  }

  window.WosUsuals = {
    available: has,
    mount(el) {
      if (!el || el.__us) { if (el) paint(); return; }
      el.__us = true; els.add(el);
      el.addEventListener('click', onClick);
      el.addEventListener('submit', onSubmit);
      paint();
    },
    refresh: paint,
    /** Back: edit sheet → teach name field → (nothing; the shell closes the window). */
    back() {
      if (editing) { editing = null; paint(); return 'usuals-edit'; }
      if (teachName != null) { teachName = null; paint(); return 'usuals-teach'; }
      return null;
    },
    /** "order my usual kra pao": the usual's id when the words are an order for one. */
    match(text) { if (!has() || typeof N().usualsMatch !== 'function') return ''; try { return N().usualsMatch(String(text || '')) || ''; } catch (e) { return ''; } },
    run(id) { const r = N().usualsRun(id); if (r) toast('🍜', why(r)); return !r; },
  };
  window.__wosUsuals = paint; // native onResume: the list may have changed (taught, ran)
  setInterval(() => { if (els.size && !document.hidden) { const st = read().state || {}; if (st.mode && st.mode !== 'idle') paint(); } }, 1500);
})();
