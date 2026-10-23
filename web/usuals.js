/* Food (was Usuals, renamed 12 Oct): James's Grab orders, one tap or one spell ("order food", "order kra pao") away.
 * "Order something new" opens Grab to browse: whatever he ends up ordering is saved as a usual, named after the food
 * (rename after). A saved usual replays under a cover and stops on Grab's checkout. Placing the order is always
 * James's tap: in Grab, or on the cover.
 *
 * This file is the window: the list, Order something new, Order, rename/edit, and what the last run did. The work goes
 * through a backend (web/food/backend.js):
 *  - Android 0.10.2+: the generic device.automation v1 capability. Recipes, names, voice words and the route rules
 *    live in web (web/food/*); native records, replays and shows the cover, and alone guards the money button.
 *  - older Android: the pre-v1 native Food (WizardOSNative.usuals*), unchanged.
 * localStorage 'wos.food.backend' = 'native' pins the old path while v1 is proven on a phone. */
(() => {
  'use strict';
  const N = () => window.WizardOSNative;
  const legacyHas = () => !!(N() && typeof N().usuals === 'function');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const els = new Set();
  let editing = null; // { id } while the edit sheet is open
  let teachName = null; // the name field while it is open (Edit → Teach again keeps the old name)
  const log = m => { window.__foodLog = (window.__foodLog || []).concat(m).slice(-40); };

  let B = window.WosFoodBackend.legacy(N);
  let choosing = null;
  function pinnedNative() { try { return localStorage.getItem('wos.food.backend') === 'native'; } catch (e) { return false; } }
  /** v1 when this APK offers device.automation v1 (and nobody pinned the old path); else the old native Food. */
  function choose() {
    if (choosing) return choosing;
    choosing = (async () => {
      const P = window.WizDevicePort;
      if (!pinnedNative() && P && P.available() && await P.has('device.automation', 1, 'record')) {
        B = window.WosFoodBackend.automation({
          port: P, rules: window.WosFoodRules, store: window.WosFoodStore.create(localStorage, window.WosFoodRules),
          stripAddress: t => window.WizConfig ? window.WizConfig.stripAddress(t) : t, onChange: paint, log,
        });
        await B.init();
      }
      log('backend:' + B.kind);
      paint();
      return B;
    })();
    return choosing;
  }
  const has = () => legacyHas() || !!(window.WizDevicePort && window.WizDevicePort.available());

  function read() {
    if (!has()) return { list: [], blocker: 'native', state: {} };
    return B.snapshot() || { list: [], blocker: '', state: {} };
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
    const runLog = st.log && st.log.length && st.mode === 'failed' ? `<details class="us-log"><summary>What the last run did</summary><pre>${esc(st.log.slice(-12).join('\n'))}</pre></details>` : '';
    return `<div class="desk-scroll us-wrap">${blockerCard(b)}${live}${nameUi}${empty}${newBtn}${teach}<div class="us-list">${cards}</div>${spells}
      <p class="us-fine">Runs on this phone with Grab on screen. Your Grab login, card and address stay in Grab. Wizard never presses Place order for you: you tap it, in Grab or on the cover.</p>${runLog}</div>${editSheet(list)}`;
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
  function refresh() { paint(); choose().then(b => b.refresh()).then(paint, paint); }

  function toast(i, t) { window.__wos?.toast?.(i, t, 2600); }
  function why(b) {
    return b === 'accessibility' ? 'Turn on Wizard OS accessibility first' : b === 'grab' ? "Grab isn't installed" : b === 'busy' ? 'Finish the order in progress first'
      : b === 'missing' ? 'That order is gone' : b === 'commit-step' ? 'That order names a payment button; edit its steps' : b;
  }
  /** Backend actions answer '' (started) or a blocker code, sync (old native) or async (v1). */
  const said = p => Promise.resolve(p).then(r => { if (r) toast('🍜', why(r)); paint(); }, () => paint());

  function onClick(e) {
    const t = e.target.closest('[data-us]'); if (!t) return;
    const a = t.dataset.us, id = t.dataset.id;
    if (a === 'a11y') return N()?.voiceTypingSettings?.();
    if (a === 'new') { said(B.teach('')); return; }
    if (a === 'stop') { Promise.resolve(B.cancel()).then(() => setTimeout(refresh, 300)); return; }
    if (a === 'keep') { B.keepName(id); paint(); return; }
    if (a === 'run') { said(B.run(id)); return; }
    if (a === 'edit') { editing = { id }; paint(); return; }
    if (a === 'delete') { if (!confirm('Delete this saved order?')) return; B.remove(id); editing = null; paint(); return; }
    if (a === 'reteach') { const u = (read().list || []).find(x => x.id === id); editing = null; said(B.teach(u ? u.name : '', id)); }
  }
  function onSubmit(e) {
    const f = e.target.closest('[data-us-form]'); if (!f) return;
    e.preventDefault();
    if (f.dataset.usForm === 'teach') {
      const name = f.n.value.trim() || 'My usual';
      teachName = null; paint();
      said(B.teach(name));
      return;
    }
    if (f.dataset.usForm === 'name') {
      const n = f.n.value.trim();
      if (n) B.save(f.dataset.id, n, null); else B.keepName(f.dataset.id);
      document.activeElement?.blur?.(); paint(); toast('✓', 'Saved');
      return;
    }
    if (f.dataset.usForm === 'edit') {
      const ok = B.save(f.dataset.id, f.n.value, f.s.value);
      if (!ok) { toast('⚠', 'Those steps need at least one line'); return; }
      editing = null; paint(); toast('✓', 'Saved');
    }
  }

  /* Spells (James, 12 Oct: "I need voice commands that are easy to cast"). The order spells live in the shared voice
   * table (web/food/rules.js voiceTable), which v1 also hands to native for the floating orb and side button. */
  const OPEN_SPELL = /^(?:food|wizard food|wizard eats|eats|my food|grab food app|food app|my orders|my saved orders|saved orders|my usuals|usuals)$/;
  const SPELLS_ONLY = window.WosFoodRules.voiceTable([]);
  function spell(text) {
    const s = window.WizConfig.stripAddress(text).toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/ (please|now|for me)$/, '').trim();
    if (window.WosFoodRules.matchTable(SPELLS_ONLY, s) === '+new') return 'new';
    if (OPEN_SPELL.test(s)) return 'open';
    return '';
  }
  window.WosUsuals = {
    available: has,
    mount(el) {
      if (!el || el.__us) { if (el) refresh(); return; }
      el.__us = true; els.add(el);
      el.addEventListener('click', onClick);
      el.addEventListener('submit', onSubmit);
      refresh();
    },
    refresh,
    /** Back: edit sheet → teach name field → (nothing; the shell closes the window). */
    back() {
      if (editing) { editing = null; paint(); return 'usuals-edit'; }
      if (teachName != null) { teachName = null; paint(); return 'usuals-teach'; }
      return null;
    },
    /** Food spells the shell checks after match(): 'new' (open Grab for a new order), 'open' (open Food), or ''. */
    spell,
    /** "order my usual kra pao": the usual's id when the words are an order for one ('+new' for a new order on v1). */
    match(text) { if (!has()) return ''; try { return B.match(text) || ''; } catch (e) { return ''; } },
    run(id) { said(B.run(id)); return true; },
    /** QA: which backend Food uses, 'automation-v1' or 'native-usuals'. */
    backend: () => B.kind,
  };
  window.__wosUsuals = refresh; // native onResume: the list may have changed (taught, ran)
  window.__wosAutomation = () => { if (B.kind === 'automation-v1') B.collect().then(paint); }; // outcomes may be waiting
  if (has()) choose();
  setInterval(() => { if (els.size && !document.hidden) { const st = read().state || {}; if (st.mode && st.mode !== 'idle') refresh(); } }, 1500);
})();
