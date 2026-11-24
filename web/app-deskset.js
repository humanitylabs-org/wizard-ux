/* Wizard UX phone shell › Settings that belongs to a desk and opening a sheet. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.deskset = function ({ $, appVars, closeMenu, closeSheets, device, foldOpen, inboxEl, launcher, openChatsList, renderLauncher, renderSettings, settingsEl, tourEv, vib }) {
  let renderInbox; // late-bound: app.js declares these after the call, see bindLate
  const sheetOpen = () => !!appVars.sheet;
  /* Settings belongs to a desk (James, 21 Oct 2026): "the settings menu can stay open on the home screen; it
   * shouldn't block me from viewing my other desktops." A desk swipe (dock or orb) or a dot tap with Settings open
   * lifts it onto the desk it was opened on: it slides with that desk, the other desks are live and unblurred, and
   * landing back on that desk shows it again exactly as left (scroll kept). Opening Settings elsewhere moves it. */
  function liftSettings(deskId) {
    if (appVars.sheet !== 'settings') return;
    appVars.stDesk = deskId || (appVars.desks[appVars.idx] && appVars.desks[appVars.idx].id); appVars.sheet = null;
    device.classList.remove('sheet-open'); device.classList.add('st-parked');
    settingsEl.inert = true; settingsEl.setAttribute('aria-hidden', 'true');
    window.WosResources?.sync(); window.WosScenery?.update();
  }
  function dropParkedSettings() {
    appVars.stDesk = null; device.classList.remove('st-parked');
    settingsEl.inert = false; settingsEl.removeAttribute('aria-hidden');
    settingsEl.style.transition = ''; settingsEl.style.transform = ''; settingsEl.style.opacity = '';
  }
  function rideSettings(dx, anim) {
    const at = appVars.desks.findIndex(d => d.id === appVars.stDesk);
    if (at < 0) { settingsEl.classList.remove('open'); dropParkedSettings(); return; } // its (empty) desk went away
    const off = (at - appVars.idx) * (device.clientWidth || innerWidth) + dx;
    settingsEl.style.transition = anim ? 'transform 520ms var(--ease)' : 'none';
    settingsEl.style.transform = `translate3d(${off}px,0,0)`;
    // home again: Settings is the open sheet once more. Not while a bar scrub is live (wizard-ux#1516): the scrub snaps the
    // track on its start desk before it steps, and that snap must not re-open the Settings it just parked.
    if (at === appVars.idx && !dx && !appVars.sheet && !(appVars.DS && appVars.DS.live)) {
      dropParkedSettings(); if (anim) settingsEl.style.transition = 'transform 520ms var(--ease)';
      appVars.sheet = 'settings'; device.classList.add('sheet-open'); tourEv('sheet', { which: 'settings' }); // same handoff as openSheet
      window.WosResources?.sync(); window.WosScenery?.update();
    }
  }
  function openSheet(which, q) {
    // The pull-down notifications panel is retired (James, 18 Oct 2026): every way in (the Inbox tile, "open
    // inbox"/"notifications", the critical banner, the arrow key) opens Chats, whose Working and Ready
    // sections hold the same threads and which can stay open on a desk.
    if (which === 'inbox') return openChatsList();
    closeSheets(true); closeMenu();
    if (which === 'settings' && appVars.stDesk) dropParkedSettings(); // Settings opened on this desk moves here
    appVars.sheet = which; device.classList.add('sheet-open'); device.dataset.sheet = which; tourEv('sheet', { which });
    window.WosResources?.back(); window.WosResources?.sync();
    if (which === 'launcher') { foldOpen.agents = foldOpen.dev = false; renderLauncher(q || ''); launcher.classList.add('open'); const s = $('#search'); s.value = q || ''; window.WizCore.refreshApps?.({afterPending:true}); }
    else if (which === 'settings') { appVars.settingsFocus = document.activeElement; renderSettings(); settingsEl.classList.add('open'); $('#settingsBody').scrollTop = 0; appVars.settingsView?.focus(); }
    else { renderInbox(); inboxEl.classList.add('open'); }
    [launcher, inboxEl, settingsEl].forEach(el => { if (el === settingsEl && appVars.stDesk) return; el.style.transform = ''; el.style.opacity = ''; });
    window.WosScenery?.update(); // scenery hook: a sheet over Home freezes the background
    vib(6);
  }
  return { liftSettings, openSheet, rideSettings, bindLate: v => { if ('renderInbox' in v) renderInbox = v.renderInbox; } };
};
