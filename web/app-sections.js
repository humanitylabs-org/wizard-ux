/* Wizard UX phone shell › the four sections around the orb (wizard-ux#1929, switch wizard/phone-sections, off by default).
 *
 * With the switch on, the phone's bottom bar is Home · Chats · (orb) · Messenger · Apps instead of a row of desk dots
 * and the desk +. The orb itself is not touched (James, 27 Nov 2026: keep today's orb exactly as it is).
 *
 * Sections are a view over the desks the shell already has, not a second window manager, so every app keeps its
 * place (its window stays loaded, nothing reloads) and turning the switch off leaves today's desks as they are:
 *   Home      desk 0.
 *   Chats     the desk holding the main Chats window (opened when there is none).
 *   Messenger the pinned slot: the desk holding the slot app. The slot is Messenger, else the first chat/messaging app,
 *             or the app the owner pinned (long-press, "Pin an app here"; synced as ui-preferences phoneSlot).
 *   Apps      the desk of the last app picked. The last two app desks stay loaded (a sideways swipe on the tile flips
 *             between them); picking a third closes the oldest.
 * The section desks are kept first in the strip in bar order (desk order is CSS order: nothing re-parents or reloads),
 * so a swipe or the bar scrub steps only through them. A desk that came from another (a link opened from a thread, a
 * view bound to a thread) sits right after the desk it came from and counts as that section.
 * The App selector is the Apps sheet as it is (Recent row of the last four, the grid, search). The pin sheet paints the
 * same grid in that sheet. Back is unchanged: one step inside the section, then Home, then it stays on Home. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.sections = function ({ $, APP, APPS, appVars, CHATS_APP, closeSheets, closeWin, esc, goDesk, HOME, launcher, LIVE, mainChats, openApp, openSheet, renderDots, renderLauncher, save, store, syncDesks, toast, vib, winApp }) {
  const SEC_SWITCH = 'wizard/phone-sections', SEC_ORDER = ['home', 'chats', 'slot', 'apps'];
  function secOn() {
    try { const r = document.documentElement; return (r.getAttribute('data-tweaks') || '').split(' ').includes(SEC_SWITCH) && r.dataset.shell !== 'desktop'; } catch (_) { return false; }
  }
  /* This device's Apps history: desk ids, the app in the Apps section first, the one a flip goes back to second. */
  /* var, not let: the shell's tests put this body back into app.js (tests/fixtures/app-parts.mjs), where goDesk may call
   * sectionsArrange before this body has run; secReady is true only once all of it has. */
  var secReady = false;
  var secState = store.get('sections.v1', null); if (!secState || !Array.isArray(secState.apps)) secState = { apps: [] };
  const secKeep = () => store.set('sections.v1', secState);

  /* ---- the Messenger slot ---- */
  const SEC_PIN_KEY = 'wos.phone.slot.v1';
  const secPinned = () => { try { const v = localStorage.getItem(SEC_PIN_KEY) || ''; return APP[v] && APP[v].url ? APP[v].id : ''; } catch (_) { return ''; } };
  const SEC_CHATTY = /messeng|messag|chat|signal|telegram|whatsapp|imessage|sms/i;
  function secDefaultSlot() {
    if (APP.messenger?.url) return APP.messenger.id;
    const a = APPS.find(x => x && x.url && x.kind === 'wizard' && x.id !== CHATS_APP.id && !x.agent && (SEC_CHATTY.test(x.id) || SEC_CHATTY.test(x.name || '')));
    return a ? a.id : '';
  }
  const secSlotId = () => secPinned() || secDefaultSlot();
  function secSetPin(id) {
    const v = id && APP[id]?.url ? APP[id].id : '';
    try { if (v) localStorage.setItem(SEC_PIN_KEY, v); else localStorage.setItem(SEC_PIN_KEY, ''); } catch (_) {}
    LIVE?.setPhoneSlot?.(v);
    sectionsPaint();
  }

  /* ---- which desk is which section ---- */
  const secW = () => appVars.W, secD = () => appVars.desks;
  const secReal = w => !!w && !w.from && !w.bound;
  function secChatsDesk() { return secD().find(d => !d.home && d.wins.some(id => mainChats(secW()[id]))) || null; }
  function secSlotDesk(chats = secChatsDesk()) {
    const sid = secSlotId(); if (!sid) return null;
    return secD().find(d => !d.home && d !== chats && d.wins.some(id => { const w = secW()[id]; return secReal(w) && w.app === 'frame' && w.appId === sid; })) || null;
  }
  // The desk a link or bound view came from (it is shown as part of that desk's section).
  function secParentOf(d) {
    if (!d || d.home) return null;
    for (const id of d.wins) {
      const w = secW()[id]; if (!w) continue;
      if (w.bound) { const p = secD().find(x => x.wins.includes(w.bound)); if (p && p !== d) return p; }
      if (w.from?.desk) { const p = secD().find(x => x.id === w.from.desk); if (p && p !== d) return p; }
    }
    return null;
  }
  function secAppsDesks(chats, slot) {
    return secState.apps.map(id => secD().find(d => d.id === id)).filter(d => d && !d.home && d !== chats && d !== slot && d.wins.length && !secParentOf(d));
  }
  function secAll() {
    const chats = secChatsDesk(), slot = secSlotDesk(chats), apps = secAppsDesks(chats, slot);
    return { home: secD()[HOME], chats, slot, apps: apps[0] || null, prev: apps[1] || null };
  }
  function sectionOfDesk(d, s = secAll()) {
    for (let k = 0, x = d; x && k < 4; k++, x = secParentOf(x)) for (const name of SEC_ORDER) if (s[name] && s[name] === x) return name;
    return '';
  }
  const secCurrent = () => sectionOfDesk(secD()[appVars.idx]);

  /* ---- keeping the strip in bar order ---- */
  var secBusy = false;
  // Called by goDesk (app-desks.js) with the desk it is about to show; returns that desk's index after arranging, or -1.
  function sectionsArrange(to) {
    if (!secReady || secBusy || !secOn() || !to) return -1;
    secBusy = true;
    try {
      let s = secAll();
      // An app desk that is no section yet (just opened from the App selector, by voice, from another app) is the Apps
      // section now; the app that was there is the one a flip goes back to.
      if (!to.home && to.wins.length && !sectionOfDesk(to, s) && !secParentOf(to) && to.wins.some(id => secReal(secW()[id]))) {
        secState.apps = [to.id, ...secState.apps.filter(id => id !== to.id)]; s = secAll();
      }
      const live = new Set(secAppsDesks(s.chats, s.slot).map(d => d.id));
      secState.apps = secState.apps.filter(id => live.has(id));
      // Only the last two apps stay loaded: the third oldest closes (picking another app replaces the pinned one).
      for (const id of secState.apps.splice(2)) { const d = secD().find(x => x.id === id); if (d && d !== to && secD()[appVars.idx] !== d) [...d.wins].forEach(w => closeWin(w, true)); }
      secKeep(); s = secAll();
      const order = [], add = d => { if (!d || order.includes(d)) return; order.push(d); for (const x of secD()) if (!order.includes(x) && secParentOf(x) === d) add(x); };
      for (const name of SEC_ORDER) add(s[name]);
      for (const d of secD()) if (!order.includes(d)) order.push(d); // the app a flip goes back to and any older desk, out of the way
      if (order.some((d, i) => secD()[i] !== d)) {
        const cur = secD()[appVars.idx]; appVars.desks = order; appVars.idx = Math.max(0, order.indexOf(cur)); syncDesks(); save();
      }
      return secD().indexOf(to);
    } finally { secBusy = false; }
  }
  // The bar scrub's stops: the index of each section desk there is, in bar order.
  function sectionsStops() {
    if (!secReady || !secOn()) return null;
    const s = secAll();
    return SEC_ORDER.map(n => s[n]).filter(Boolean).map(d => secD().indexOf(d)).filter(i => i >= 0);
  }

  /* ---- going to a section ---- */
  const secAt = d => secD().indexOf(d);
  function secGo(name, how = 'tap') {
    const s = secAll(), here = secCurrent();
    if (name !== 'apps' || appVars.sheet !== 'launcher') closeSheets(true);
    if (name === 'home') { if (appVars.idx !== HOME) goDesk(HOME); return; }
    if (name === 'chats') { if (s.chats) { if (here !== 'chats' || secD()[appVars.idx] !== s.chats) goDesk(secAt(s.chats)); } else openApp(APP[CHATS_APP.id]); return; }
    if (name === 'slot') {
      const sid = secSlotId(); if (!sid) { secOpenPin(); return; }
      if (s.slot) { if (secD()[appVars.idx] !== s.slot) goDesk(secAt(s.slot)); } else openApp(APP[sid]);
      return;
    }
    if (name === 'apps') {
      if (appVars.sheet === 'launcher' && !secPinMode) { closeSheets(); return; } // the tile again: the selector goes away
      // The first tap (no app yet), or a tap while on the app: the App selector, over the running app.
      if (!s.apps || (how === 'tap' && here === 'apps')) { openSheet('launcher'); return; }
      if (how === 'swipe' && here === 'apps') return;
      goDesk(secAt(s.apps));
    }
  }
  // A sideways swipe (the desk area, a flick along the bar, the orb's sideways drag): the next section in bar order.
  function sectionsSwipe(step) {
    if (!secReady || !secOn()) return false;
    const k = SEC_ORDER.indexOf(secCurrent() || 'home'), n = SEC_ORDER[k + step];
    if (!n) { goDesk(appVars.idx); return true; } // past the end: stay (Back never exits, neither does a swipe)
    if (n === 'apps' && !secAll().apps) { goDesk(appVars.idx); openSheet('launcher'); return true; }
    secGo(n, 'swipe'); return true;
  }
  // A sideways swipe on the Apps tile: flip between the last two apps.
  function secFlip() {
    const s = secAll(), a = s.apps, b = s.prev;
    if (!a || !b) { toast('⇄', 'Open a second app to flip between them', 1800); return; }
    secState.apps = [b.id, a.id, ...secState.apps.filter(id => id !== a.id && id !== b.id)]; secKeep();
    closeSheets(true); goDesk(secAt(b), true);
    const nm = d => esc(winApp(secW()[d.focus] || secW()[d.wins[0]]).name);
    toast('⇄', `${nm(b)} ⇄ ${nm(a)}`, 1600); vib(8);
  }

  /* ---- the bar ---- */
  const secSvg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const SEC_GRID = secSvg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>');
  const SEC_PLUS = secSvg('<path d="M12 6v12M6 12h12"/>');
  function secSigil(a) {
    const Sg = window.WizSigil; if (!Sg || !a) return '';
    const s = Sg.of(a.sigil || a); return `<span class="dsg" style="--c:${a.sgc || s.color}">${a.sgh || Sg.html(a.sigil || a)}</span>`;
  }
  function secTiles() {
    const s = secAll(), N = window.WizCore.workspaceNav, sid = secSlotId(), slotApp = sid ? APP[sid] : null;
    const appsWin = s.apps ? secW()[s.apps.focus] || secW()[s.apps.wins[0]] : null, appsApp = appsWin ? winApp(appsWin) : null;
    const chats = { ...CHATS_APP, sgc: window.WosAgents?.colour?.(window.WosAgents.get(window.WosAgents.defaultId())) || '' };
    return {
      home: { label: 'Home', icon: '<span class="dsg"><i class="sgi sg-home" aria-hidden="true"></i></span>', badge: '' },
      chats: { label: 'Chats', icon: secSigil(chats.sgc ? chats : CHATS_APP), badge: N?.label(CHATS_APP.id) || '' },
      // A pinned app other than the default shows its own icon and name and no Messenger badge.
      slot: { label: slotApp ? slotApp.name : 'Messenger', icon: slotApp ? secSigil(slotApp) : `<span class="dsg sec-empty">${SEC_PLUS}</span>`, badge: slotApp && !secPinned() ? N?.label(slotApp.id) || '' : '' },
      apps: { label: appsApp ? appsApp.name : 'Apps', icon: appsApp ? secSigil(appsApp) : `<span class="dsg sec-grid">${SEC_GRID}</span>`, badge: '' },
    };
  }
  var secPainted = '';
  function sectionsPaint() {
    if (!secReady) return;
    const dock = $('#dock'), orb = $('#orbWrap'); if (!dock || !orb) return;
    if (!secOn()) { dock.querySelectorAll('.sec-side').forEach(el => el.remove()); delete dock.dataset.sections; secPainted = ''; return; }
    let L = $('#secL'), R = $('#secR');
    if (!L) { L = document.createElement('div'); L.id = 'secL'; L.className = 'sec-side left'; orb.before(L); }
    if (!R) { R = document.createElement('div'); R.id = 'secR'; R.className = 'sec-side right'; orb.after(R); }
    dock.dataset.sections = '';
    const t = secTiles(), here = secCurrent();
    const tile = n => `<button class="sec-tile${n === here ? ' on' : ''}" type="button" data-sec="${n}" aria-label="${esc(t[n].label)}${t[n].badge ? `, ${esc(t[n].badge)} waiting` : ''}"${n === here ? ' aria-current="page"' : ''}>${t[n].icon}<span class="sec-nm">${esc(t[n].label)}</span>${t[n].badge ? `<b class="sec-bg">${esc(t[n].badge)}</b>` : ''}</button>`;
    const l = tile('home') + tile('chats'), r = tile('slot') + tile('apps');
    if (l + r === secPainted) return;
    secPainted = l + r; L.innerHTML = l; R.innerHTML = r;
  }

  /* ---- taps, the Messenger long-press and the Apps flip ---- */
  var secQuiet = 0, secHold = null, secFlipDrag = null;
  const secTileOf = e => e.target.closest?.('.sec-tile');
  $('#dock').addEventListener('click', e => {
    const b = secTileOf(e); if (!b || !secOn()) return;
    e.stopPropagation();
    if (Date.now() < secQuiet || Date.now() - (appVars.dockSwiped || 0) < 400) return;
    vib(6); secGo(b.dataset.sec);
  });
  $('#dock').addEventListener('contextmenu', e => { if (secTileOf(e)) e.preventDefault(); });
  $('#dock').addEventListener('pointerdown', e => {
    const b = secTileOf(e); if (!b || !secOn()) return;
    if (b.dataset.sec === 'slot') {
      clearTimeout(secHold); b.__hold = { x: e.clientX, y: e.clientY };
      secHold = setTimeout(() => { secHold = null; secQuiet = Date.now() + 700; vib(12); secOpenPin(); }, 500);
    }
    if (b.dataset.sec === 'apps') {
      // The Apps tile's own sideways swipe flips apps: the bar scrub (app-scrub.js) never starts from it.
      e.stopPropagation(); secFlipDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }, true);
  const secEndHold = () => { clearTimeout(secHold); secHold = null; };
  $('#dock').addEventListener('pointermove', e => {
    const b = secTileOf(e);
    if (secHold && b?.__hold && Math.hypot(e.clientX - b.__hold.x, e.clientY - b.__hold.y) > 10) secEndHold();
    if (secFlipDrag && e.pointerId === secFlipDrag.id) e.stopPropagation();
  }, true);
  const secFlipEnd = e => {
    secEndHold();
    if (!secFlipDrag || e.pointerId !== secFlipDrag.id) return;
    const dx = e.clientX - secFlipDrag.x, dy = e.clientY - secFlipDrag.y; secFlipDrag = null; e.stopPropagation();
    if (e.type === 'pointerup' && Math.abs(dx) >= 20 && Math.abs(dx) > Math.abs(dy)) { secQuiet = Date.now() + 500; secFlip(); }
  };
  $('#dock').addEventListener('pointerup', secFlipEnd, true); $('#dock').addEventListener('pointercancel', secFlipEnd, true);

  /* ---- "Pin an app here": the Apps sheet showing the grid, a tap pins ---- */
  var secPinMode = false;
  function secOpenPin() { secPinMode = true; launcher.classList.add('sec-pinning'); openSheet('launcher'); }
  new MutationObserver(() => { if (secPinMode && !launcher.classList.contains('open')) { secPinMode = false; launcher.classList.remove('sec-pinning'); } }).observe(launcher, { attributes: true, attributeFilter: ['class'] });
  // renderLauncher (app.js) paints this instead of the normal grid while pinning.
  function sectionsPinHtml() {
    if (!secReady || !secPinMode || !secOn()) return '';
    const sid = secSlotId(), def = secDefaultSlot(), list = APPS.filter(a => a && a.url && a.kind === 'wizard' && a.id !== CHATS_APP.id && a.id !== 'agents' && !window.WosAppKinds?.isSystem?.(a) && !window.WizCore.isMaintenanceApp?.(a));
    const tile = a => `<button class="lapp${a.id === sid ? ' sec-pinned' : ''}" type="button" data-secpin="${esc(a.id)}">${secSigilBox(a)}<span class="nm">${esc(a.name)}</span></button>`;
    return `<div class="lgroup sec-pin"><h4>Pin an app here</h4><div class="lgrid">${list.map(tile).join('')}</div>
      <button class="sec-reset" type="button" data-secreset${secPinned() ? '' : ' disabled'}>Reset to ${esc(def ? APP[def].name : 'Messenger')}</button></div>`;
  }
  const secSigilBox = a => window.WizSigil ? window.WizSigil.box('span', 'ic', a) : `<span class="ic">${esc(a.icon || '◇')}</span>`;
  launcher.addEventListener('click', e => {
    if (!secPinMode) return;
    const p = e.target.closest('[data-secpin]'), r = e.target.closest('[data-secreset]');
    if (!p && !r) return;
    e.stopPropagation();
    const id = p ? p.dataset.secpin : '';
    // The app that held the slot closes: the slot now opens the new app (Reset brings the default back).
    const old = secAll().slot, wasHere = !!old && secD()[appVars.idx] === old;
    secSetPin(id === secDefaultSlot() ? '' : id); closeSheets();
    if (old && old !== secAll().slot) [...old.wins].forEach(w => closeWin(w, true));
    if (wasHere) secGo('slot');
    const name = APP[secSlotId()]?.name || 'Messenger';
    toast('⌂', r ? `Reset to <b>${esc(name)}</b>` : `<b>${esc(name)}</b> pinned here`, 1600);
  }, true);

  /* ---- staying in step ---- */
  addEventListener('wizard:app-counts', () => sectionsPaint());
  addEventListener('wizard:apps', () => sectionsPaint());
  addEventListener('wos:prefs', () => { secPainted = ''; sectionsPaint(); });
  var secWas = secOn();
  new MutationObserver(() => {
    const now = secOn(); secPainted = '';
    if (now && !secWas) { sectionsArrange(secD()[appVars.idx]); }
    secWas = now; renderDots(); sectionsPaint();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks', 'data-shell'] });
  secReady = true;
  if (secOn()) sectionsArrange(secD()[appVars.idx]);
  sectionsPaint();
  // Read-only view for tests and QA (the section desks by id, the one in front, the slot app), plus the flip.
  window.WizCore.phoneSections = Object.freeze({ on: secOn, sections: () => { const s = secAll(); return Object.fromEntries(Object.entries(s).map(([k, d]) => [k, d ? d.id : null])); }, current: secCurrent, slotId: secSlotId, flip: secFlip, go: secGo, apps: () => [...secState.apps] });
  return { sectionsArrange, sectionsPaint, sectionsPinHtml, sectionsStops, sectionsSwipe };
};
