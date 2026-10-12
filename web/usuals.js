/* Food (was Usuals, renamed 12 Oct): James's Grab orders, one tap or one spell ("order food", "order kra pao") away.
 * Native does the work (android/.../usuals/*). "Order something new" opens Grab to browse: whatever he ends up
 * ordering is saved as a usual, named after the food (rename after). A saved usual replays under a cover and stops on
 * Grab's checkout. Placing the order is always James's tap: in Grab, or on the cover.
 * This file is only the window: the list, Order something new, Order, rename/edit, and what the last run did. */
(() => {
  'use strict';
  const N = () => window.WizardOSNative;
  const has = () => !!(N() && typeof N().usuals === 'function');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const els = new Set();
  let editing = null; // { id } while the edit sheet is open
  let teachName = null; // the name field while it is open (Edit → Teach again keeps the old name)
  let naming = null;    // { id } while a just-saved usual's name field is open

  function read() {
    if (!has()) return { list: [], blocker: 'native', state: {} };
    try { return JSON.parse(N().usuals() || '{}'); } catch (e) { return { list: [], blocker: '', state: {} }; }
  }
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const lastLine = u => {
    const r = u.lastResult || '';
    if (!u.lastRunAt) return [u.basket, u.lastTotal].filter(Boolean).join(' · ') || `${u.steps.length} steps · never run`;
    if (r === 'ordered') return `Ordered ${ago(u.lastRunAt)}${u.lastTotal ? ' · ' + u.lastTotal : ''}${u.basket ? ' · ' + u.basket : ''}`;
    if (r === 'ready') return `Reached checkout ${ago(u.lastRunAt)}${u.lastTotal ? ' · ' + u.lastTotal : ''}`;
    if (r.startsWith('failed')) return `Stopped ${ago(u.lastRunAt)} · ${r.replace(/^failed: /, '')}`;
    return `${u.steps.length} steps`;
  };

  function blockerCard(b) {
    if (b === 'native') return `<div class="us-note">Food runs on the Wizard OS Android app. Open it there to order.</div>`;
    if (b === 'accessibility') return `<button class="us-note us-fix" data-us="a11y"><b>One switch first</b><span>Food taps through Grab with Wizard OS accessibility (the same switch as voice typing). Tap to turn it on.</span></button>`;
    if (b === 'grab') return `<div class="us-note"><b>Grab isn't on this phone</b><span>Install Grab and sign in, then come back.</span></div>`;
    return '';
  }

  function nameCard(u) {
    return `<form class="us-name" data-us-form="name" data-id="${esc(u.id)}">
        <div class="us-name-h"><b>Saved ✓</b><span>${esc([u.basket, u.place && 'from ' + u.place].filter(Boolean).join(' · ') || 'Your Grab order')}</span></div>
        <div class="us-name-row"><input name="n" maxlength="40" value="${esc(u.name)}" autocomplete="off" enterkeyhint="done" aria-label="Name"><button type="submit">Save name</button></div>
        <button type="button" class="us-keep" data-us="keep" data-id="${esc(u.id)}">Keep “${esc(u.name)}”</button></form>`;
  }

  function html() {
    const d = read(), list = d.list || [], b = d.blocker || '';
    const st = d.state || {};
    const live = st.mode && !/^(idle|done)$/.test(st.mode) && st.mode !== 'failed'
      ? `<div class="us-live"><span>${esc(st.browsing ? 'New order' : st.name)} · ${esc(st.status)}</span><button data-us="stop">${st.mode === 'teaching' ? "Don't save" : 'Stop'}</button></div>` : '';
    // The newest usual still wearing its made-up name gets the name field on top; it says what's in it.
    const fresh = list.filter(u => u.needsName).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))[0];
    if (naming && !list.some(u => u.id === naming.id && u.needsName)) naming = null;
    const nameUi = fresh && !(st.mode && st.mode !== 'idle' && st.mode !== 'failed') ? nameCard(fresh) : '';
    const cards = list.map(u => `<div class="us-card" data-id="${esc(u.id)}">
        <button class="us-go" data-us="run" data-id="${esc(u.id)}" ${b ? 'disabled' : ''} aria-label="Order ${esc(u.name)}"><span class="us-ic">🍜</span><span class="us-meta"><b>${esc(u.name)}</b><small>${esc(lastLine(u))}</small></span><span class="us-cta">Order</span></button>
        <button class="us-more" data-us="edit" data-id="${esc(u.id)}" aria-label="Edit ${esc(u.name)}">⋯</button></div>`).join('');
    const newBtn = `<button class="us-new" data-us="new" ${b ? 'disabled' : ''}><span class="us-ic">🛵</span><span class="us-meta"><b>Order something new</b><small>Browse Grab. What you order is saved here.</small></span></button>`;
    const ex = list.length ? (list[0].name || '').split(/ \+ | · /)[0].toLowerCase() : 'kra pao';
    const spells = `<div class="us-spells"><b>Say it to the orb</b><span><i>“order food”</i> or <i>“order grab”</i> · a new order in Grab</span><span><i>“order ${esc(ex)}”</i> · a saved order, straight to checkout</span><span><i>“food”</i> · opens this</span></div>`;
    const empty = !list.length ? `<div class="us-empty"><div class="us-big">🍜</div><h3>Your Grab orders, one tap away</h3>
        <p>Tap <b>Order something new</b> and order in Grab like normal. Whatever you order is saved here, named after the food. Next time, tap it or say <i>“order kra pao”</i>. Wizard fills the basket and stops at checkout for your <b>Place order</b>.</p></div>` : '';
    const teach = teachName != null
      ? `<form class="us-teach" data-us-form="teach"><input name="n" maxlength="40" placeholder="Name it, e.g. Kra pao" value="${esc(teachName)}" autocomplete="off" enterkeyhint="go"><button type="submit" ${b ? 'disabled' : ''}>Open Grab</button></form>` : '';
    const log = st.log && st.log.length && st.mode === 'failed' ? `<details class="us-log"><summary>What the last run did</summary><pre>${esc(st.log.slice(-12).join('\n'))}</pre></details>` : '';
    return `<div class="desk-scroll us-wrap">${blockerCard(b)}${live}${nameUi}${empty}${newBtn}${teach}<div class="us-list">${cards}</div>${spells}
      <p class="us-fine">Runs on this phone with Grab on screen. Your Grab login, card and address stay in Grab. Wizard never presses Place order for you: you tap it, in Grab or on the cover.</p>${log}</div>${editSheet(list)}`;
  }

  function editSheet(list) {
    if (!editing) return '';
    const u = list.find(x => x.id === editing.id); if (!u) { editing = null; return ''; }
    return `<div class="us-sheet" data-us-sheet><form data-us-form="edit" data-id="${esc(u.id)}"><h4>Edit order</h4>
      <label>Name<input name="n" maxlength="40" value="${esc(u.name)}"></label>
      <label>Steps <small>one per line · “tap Name”, “tap Add @ Item”, “type words”, “search”, “wait 1500”</small><textarea name="s" rows="8" spellcheck="false">${esc(u.script || '')}</textarea></label>
      <div class="us-row"><button type="button" data-us="delete" data-id="${esc(u.id)}" class="us-del">Delete</button><button type="button" data-us="reteach" data-id="${esc(u.id)}">Teach again</button><button type="submit" class="us-save">Save</button></div></form></div>`;
  }

  function paint() { els.forEach(el => { if (!el.isConnected) { els.delete(el); return; } const f = document.activeElement; const keep = f && el.contains(f) && f.name; el.innerHTML = html(); if (keep) { const n = el.querySelector(`[name="${keep}"]`); if (n) { n.focus(); n.setSelectionRange?.(n.value.length, n.value.length); } } }); }

  function toast(i, t) { window.__wos?.toast?.(i, t, 2600); }
  function why(b) {
    return b === 'accessibility' ? 'Turn on Wizard OS accessibility first' : b === 'grab' ? "Grab isn't installed" : b === 'busy' ? 'Finish the order in progress first' : b === 'missing' ? 'That order is gone' : b;
  }

  function onClick(e) {
    const t = e.target.closest('[data-us]'); if (!t) return;
    const a = t.dataset.us, id = t.dataset.id;
    if (a === 'a11y') return N()?.voiceTypingSettings?.();
    if (a === 'new') { const r = N().usualsTeach(''); if (r) toast('🍜', why(r)); paint(); return; }
    if (a === 'stop') { N().usualsCancel?.(); setTimeout(paint, 300); return; }
    if (a === 'keep') { N().usualsKeepName?.(id); paint(); return; }
    if (a === 'run') { const r = N().usualsRun(id); if (r) toast('🍜', why(r)); return; }
    if (a === 'edit') { editing = { id }; paint(); return; }
    if (a === 'delete') { if (!confirm('Delete this saved order?')) return; N().usualsDelete(id); editing = null; paint(); return; }
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
    if (f.dataset.usForm === 'name') {
      const n = f.n.value.trim();
      if (n) N().usualsSave(f.dataset.id, n, null); else N().usualsKeepName?.(f.dataset.id);
      document.activeElement?.blur?.(); paint(); toast('✓', 'Saved');
      return;
    }
    if (f.dataset.usForm === 'edit') {
      const ok = N().usualsSave(f.dataset.id, f.n.value, f.s.value);
      if (!ok) { toast('⚠', 'Those steps need at least one line'); return; }
      editing = null; paint(); toast('✓', 'Saved');
    }
  }

  /* Spells (James, 12 Oct: "I need voice commands that are easy to cast"). Same words the native side knows
   * (UsualsPolicy.isBrowse), so the in-app orb casts them even on an app build that predates the newer phrases. */
  const NEW_SPELL = /^(?!(?:.* )?get (?:me |us )?something$)(?:(?:please |can you |could you |let'?s |i(?: want to| wanna| would like to|'d like to) )?(?:order|get)(?: me| us)? (?:some |a |my )?(?:food|foods|grab|grab ?food|lunch|dinner|breakfast|brunch|supper|a snack|snacks|takeout|takeaway|take out|take away|delivery|food delivery|something(?: new| different| else)?(?: to eat)?)(?: (?:from|on|with|through) grab)?|order (?:from|on) grab|(?:a )?(?:food|grab|grab food) order|grab (?:me )?(?:some )?food|grab me something(?: new)? to eat|new (?:food|grab) order)$/;
  const OPEN_SPELL = /^(?:food|wizard food|wizard eats|eats|my food|grab food app|food app|my orders|my saved orders|saved orders|my usuals|usuals)$/;
  function spell(text) {
    const s = String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(hey |ok |okay )?(wizard|archimedes) /, '').replace(/ (please|now|for me)$/, '').trim();
    if (NEW_SPELL.test(s)) return 'new';
    if (OPEN_SPELL.test(s)) return 'open';
    return '';
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
    available: has,
    /** Food spells the shell checks after match(): 'new' (open Grab for a new order), 'open' (open Food), or ''. */
    spell,
    /** "order my usual kra pao": the usual's id when the words are an order for one. */
    match(text) { if (!has() || typeof N().usualsMatch !== 'function') return ''; try { return N().usualsMatch(String(text || '')) || ''; } catch (e) { return ''; } },
    run(id) { const r = N().usualsRun(id); if (r) toast('🍜', why(r)); return !r; },
  };
  window.__wosUsuals = paint; // native onResume: the list may have changed (taught, ran)
  setInterval(() => { if (els.size && !document.hidden) { const st = read().state || {}; if (st.mode && st.mode !== 'idle') paint(); } }, 1500);
})();
