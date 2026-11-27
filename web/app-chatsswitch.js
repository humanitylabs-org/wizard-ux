/* Wizard UX phone shell › the Chats tile's switcher (wizard-ux#1957, switch wizard/chats-switcher, off by default; the
 * phone's four-section bar, app-sections.js). James, 27 Nov 2026: one bottom bar, the view named at the top, and the
 * views one-handed from the Chats tile, the way the Apps tile opens the App selector.
 *
 * With it on, Chats has no second bar (core/chats-sent.js draws no Inbox · Tags · Sent tabs and names the view in the
 * title, with a ▾). The views (Inbox, Sent, Archived, every tag, other agents) are in one sheet that rises from the bar:
 *   tap Chats while on Chats, or tap the title's ▾  the sheet; Chats again, a tap outside or Back closes it;
 *   hold Chats and slide                           the sheet under the finger, letting go on a view opens it,
 *                                                  anywhere else (or back on the tile) changes nothing;
 *   a sideways swipe on the Chats tile             flips between the last two views (nothing with only one so far);
 *   a sideways swipe on the bar or the orb         while Chats is in front: one view along the sheet's order
 *                                                  (Inbox, Sent, Archived, then the tags and agents), stopping at
 *                                                  the ends (app-scrub.js asks `stepper`).
 * Tapping Chats from another section still goes to Chats in the view it was left in. The sheet's views and the switch
 * itself are Chats' own (CHATS.switcher: views, view, go), so the list and the sheet can't disagree. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.chatsswitch = function ({ $, appVars, CHATS, CHATS_APP, device, esc, mainChats, phoneBack, vib }) {
  const CS_SW = 'wizard/chats-switcher', CS_KEY = 'wos.chats.switcher.v1';
  // var, not let: the shell's tests may put this body back into app.js, where its hoisted functions can run first.
  var csReady = false;
  const P = () => window.WizCore.phoneSections;
  function csOn() {
    try { return (document.documentElement.getAttribute('data-tweaks') || '').split(' ').includes(CS_SW) && !!P()?.on?.(); } catch (_) { return false; }
  }
  // The main agent's Chats window (the Chats section's), or null before Chats was first opened.
  function csWin() {
    const d = appVars.desks.find(x => x.id === P()?.sections?.().chats), W = appVars.W;
    return (d && d.wins.map(id => W[id]).find(mainChats)) || Object.values(W).find(mainChats) || null;
  }
  const S = () => CHATS.switcher;

  /* ---- the last two views (for the tile's flip) ---- */
  function csRecent() { try { const v = JSON.parse(localStorage.getItem(CS_KEY) || '{}'); return Array.isArray(v.recent) ? v.recent.filter(k => typeof k === 'string' && k.length < 200).slice(0, 2) : []; } catch (_) { return []; } }
  function csNote(key) {
    if (!key) return; const r = csRecent(); if (r[0] === key) return;
    try { localStorage.setItem(CS_KEY, JSON.stringify({ recent: [key, ...r.filter(k => k !== key)].slice(0, 2) })); } catch (_) {}
  }
  const csNow = () => { const w = csWin(); return w ? S().view(w) : ''; };

  /* ---- the sheet ---- */
  const csEl = document.createElement('section'), csScrim = document.createElement('div');
  csScrim.className = 'cs-scrim'; csScrim.id = 'csScrim'; csScrim.hidden = true;
  csEl.className = 'cs-sheet'; csEl.id = 'chatsSwitch'; csEl.setAttribute('role', 'dialog'); csEl.setAttribute('aria-label', 'Chats views'); csEl.hidden = true;
  device.append(csScrim, csEl);
  const CS_SVG = {
    inbox: '<path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z"/>',
    sent: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    archived: '<path d="M4 5h16v4H4zM6 9v10h12V9M10 13h4"/>',
  };
  var csState = { open: false, hold: null, hot: '', closedAt: 0 };
  function csHtml() {
    const w = csWin(), v = S().views(w), n = window.WizCore.workspaceNav?.label?.(CHATS_APP.id) || '';
    const cur = k => k === v.cur ? ' cur' : '';
    const tile = t => `<button type="button" class="cs-tile${cur(t.key)}" role="menuitem" data-csview="${esc(t.key)}"${t.key === v.cur ? ' aria-current="true"' : ''} aria-label="${esc(t.label)}${t.unread ? ', unread' : ''}">`
      + `<span class="cs-ic" aria-hidden="true">${t.kind === 'agent' ? t.sigil : esc(t.emoji || '#')}</span><span class="cs-nm">${esc(t.label)}</span>${t.unread ? '<i class="cs-dot" aria-hidden="true"></i>' : ''}</button>`;
    const big = b => `<button type="button" class="cs-big${cur(b.key)}" role="menuitem" data-csview="${b.key}"${b.key === v.cur ? ' aria-current="true"' : ''} aria-label="${b.label}${b.key === 'inbox' && n ? `, ${esc(n)} waiting` : ''}">`
      + `<svg viewBox="0 0 24 24" aria-hidden="true">${CS_SVG[b.key]}</svg><span>${b.label}</span>${b.key === 'inbox' && n ? `<b class="cs-n">${esc(n)}</b>` : ''}</button>`;
    return (v.grid.length ? `<div class="cs-grid" role="group" aria-label="Tags and agents">${v.grid.map(tile).join('')}</div>` : '')
      + `<div class="cs-base" role="group" aria-label="Inbox, Sent and Archived">${v.base.map(big).join('')}</div>`;
  }
  // The sheet sits right above the bar (and clears the orb's top), wherever the skin and the phone put them.
  function csPlace() {
    const bar = $('#dock'), dv = device.getBoundingClientRect(), r = bar?.getBoundingClientRect(); if (!r || !r.height) return;
    const o = $('#orbWrap')?.getBoundingClientRect(), top = o && o.height ? Math.min(r.top, o.top) : r.top;
    device.style.setProperty('--cs-above', Math.round(dv.bottom - top + 6) + 'px');
  }
  function csPaint() { if (csState.open) { csEl.innerHTML = csHtml(); csMark(csState.hot); } }
  function csOpen(how = 'tap') {
    if (!csReady || !csOn()) return false;
    csNote(csNow());
    csPlace(); csState = { ...csState, open: true, hot: '' };
    csEl.innerHTML = csHtml(); csEl.hidden = false; csScrim.hidden = false; csEl.dataset.how = how;
    device.classList.add('cs-up');
    const g = csEl.querySelector('.cs-grid'), c = g?.querySelector('.cur'); if (g) g.scrollTop = c ? Math.max(0, c.offsetTop - 8) : 0;
    requestAnimationFrame(() => { csEl.classList.add('open'); csScrim.classList.add('open'); });
    vib(how === 'hold' ? 14 : 6); return true;
  }
  function csClose() {
    if (!csState.open) return false;
    csState.open = false; csState.hot = ''; csState.closedAt = Date.now();
    csEl.classList.remove('open'); csScrim.classList.remove('open'); device.classList.remove('cs-up');
    csEl.hidden = true; csScrim.hidden = true; return true;
  }
  // Show a view: the Chats section first (from another section), then the view; the sheet closes in the same frame.
  function csPick(key) {
    csClose();
    if (!key) return false;
    if (P()?.current?.() !== 'chats') P()?.go?.('chats');
    const w = csWin(); if (!w) return false;
    const was = S().view(w); csNote(was);
    if (key === was && !w.thread) return true;
    const ok = S().go(w, key);
    if (ok) csNote(key); else { try { localStorage.setItem(CS_KEY, JSON.stringify({ recent: csRecent().filter(k => k !== key) })); } catch (_) {} }
    return ok;
  }
  csEl.addEventListener('click', e => { const b = e.target.closest?.('[data-csview]'); if (b) { vib(6); csPick(b.dataset.csview); } });
  csScrim.addEventListener('click', () => csClose());
  phoneBack?.watch?.(() => csState.open, () => { csClose(); return 'chats-switcher'; }, 'chats-switcher');

  /* ---- hold Chats and slide ---- */
  const csItemAt = (x, y) => { const el = document.elementFromPoint(x, y); return el?.closest?.('#chatsSwitch [data-csview]') || null; };
  function csMark(key) { csEl.querySelectorAll('[data-csview]').forEach(b => b.classList.toggle('hot', !!key && b.dataset.csview === key)); }
  var csFinger = null, csQuiet = 0;
  const csTile = e => e.target.closest?.('.sec-tile[data-sec="chats"]');
  $('#dock').addEventListener('pointerdown', e => {
    if (csState.open && !csTile(e)) csClose(); // a tap on the bar while the sheet is up closes it
    const b = csTile(e); if (!b || !csOn()) return;
    // The Chats tile's own gestures (hold, flip): the bar scrub (app-scrub.js) never starts from it.
    e.stopPropagation(); clearTimeout(csFinger?.t);
    csFinger = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now(), held: false, t: setTimeout(() => { if (!csFinger || csFinger.moved) return; csFinger.held = true; csQuiet = Date.now() + 900; if (!csState.open) csOpen('hold'); csState.hold = true; }, 350) };
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
  }, true);
  $('#dock').addEventListener('pointermove', e => {
    if (!csFinger || e.pointerId !== csFinger.id) return;
    e.stopPropagation();
    if (!csFinger.held) { if (Math.hypot(e.clientX - csFinger.x, e.clientY - csFinger.y) > 10) { csFinger.moved = true; clearTimeout(csFinger.t); } return; }
    const it = csItemAt(e.clientX, e.clientY), key = it ? it.dataset.csview : '';
    if (key !== csState.hot) { csState.hot = key; csMark(key); if (key) vib(5); }
  }, true);
  const csFingerEnd = e => {
    if (!csFinger || e.pointerId !== csFinger.id) return;
    const f = csFinger; csFinger = null; clearTimeout(f.t); e.stopPropagation();
    const dx = e.clientX - f.x, dy = e.clientY - f.y, flick = e.type === 'pointerup' && Math.abs(dx) >= 20 && Math.abs(dx) > Math.abs(dy);
    if (f.held) {
      csQuiet = Date.now() + 700; csState.hold = null;
      const lit = csState.hot, it = e.type === 'pointerup' ? csItemAt(e.clientX, e.clientY) : null;
      if (it) { csPick(it.dataset.csview); return; }
      csClose(); // let go on nothing, or back on the tile: no change
      // A quick sideways flick that a busy phone saw as a hold (its moves came in after the hold timer): still the flip.
      if (flick && !lit && Math.abs(dy) < 30 && Date.now() - f.at < 700) csFlip();
      return;
    }
    if (flick) { csQuiet = Date.now() + 500; csFlip(); }
  };
  $('#dock').addEventListener('pointerup', csFingerEnd, true); $('#dock').addEventListener('pointercancel', csFingerEnd, true);
  // A tap on Chats while Chats is in front: the sheet (again: it closes). From elsewhere: app-sections.js goes to Chats.
  $('#dock').addEventListener('click', e => {
    const b = csTile(e); if (!b || !csOn()) return;
    if (Date.now() < csQuiet) { e.stopPropagation(); return; }
    if (csState.open || Date.now() - csState.closedAt < 400) { e.stopPropagation(); csClose(); return; }
    if (P()?.current?.() === 'chats') { e.stopPropagation(); csOpen('tap'); }
  }, true);

  /* ---- the tile's flip and the bar's steps ---- */
  function csFlip() {
    const now = csNow(), r = csRecent(), to = r[0] && r[0] !== now ? r[0] : r[1];
    if (!to || to === now) { vib(4); return false; } // only one view used so far: nothing to flip to
    return csPick(to);
  }
  function csOrder() { const v = S().views(csWin()); return [...v.base, ...v.grid].map(x => x.key); }
  // step +1: the next view along the sheet (a swipe to the left); -1: the one before. The ends stay.
  function csStep(step) {
    const list = csOrder(), at = list.indexOf(csNow()), to = (at < 0 ? 0 : at) + step;
    if (at >= 0 && (to < 0 || to >= list.length)) { vib(4); return false; }
    vib(8); return csPick(list[Math.max(0, Math.min(list.length - 1, to))]);
  }
  // app-scrub.js: while Chats is in front, the bar's and the orb's sideways swipes step views (null: scrub as before).
  function csStepper() { return csReady && csOn() && !csState.open && !appVars.sheet && P()?.current?.() === 'chats' && csWin() ? csStep : null; }

  /* ---- staying in step ---- */
  addEventListener('wizard:app-counts', () => csPaint());
  addEventListener('wos:prefs', () => csPaint());
  new MutationObserver(() => { if (!csOn()) csClose(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks', 'data-shell'] });
  csReady = true;
  // Chats' title ▾ opens the sheet through this; tests and QA read the rest.
  window.WizCore.chatsSwitcher = Object.freeze({ on: csOn, open: how => csOpen(how), close: csClose, isOpen: () => csState.open, recent: csRecent, view: csNow, order: csOrder, flip: csFlip, step: csStep, stepper: csStepper, pick: csPick });
  return { chatsStepper: csStepper };
};
