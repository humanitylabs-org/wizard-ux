/* Wizard UX phone shell › views bound to a thread and the peek. Moved out of app.js
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
window.WizCore.appParts.bound = function ({ $$, APP, applyLayout, appVars, boundOf, CHATS, clip, closeWin, deskOf, device, esc, findApp, focusWin, fromOf, goDesk, linkTitle, openWin, renderDots, save, secOf, store, track, winEl, winTitle }) {
  let bringBeside, frameHref, syncReviewChip, toast; // late-bound: app.js declares these after the call, see bindLate
  function threadShown(wid, el) {
    if (appVars.boundBusy) return;
    appVars.boundManager ||= window.WosBoundView.create({ windows: () => Object.values(appVars.W), win: id => appVars.W[id], findApp, APP, linkTitle,
      visible: id => deskOf(id) === appVars.idx, from: fromOf, title: winTitle, close: id => closeWin(id, true, true),
      open: (obj, origin) => { openWin(obj, { stay:true }); boundTip(origin); },
      reload: id => { save(); const f = winEl(id)?.querySelector('iframe'); if (f) f.src = f.src; }, changed: syncPeek });
    appVars.boundManager.shown(wid, el);
  }
  // Re-check every open thread (after a desk change) and drop bound views whose thread went away.
  function syncBound() {
    if (appVars.boundBusy) return;
    for (const w of Object.values(appVars.W)) if (w.bound && deskOf(w.id) >= 0) { const c = appVars.W[w.bound]; if (!c || deskOf(c.id) < 0 || c.thread !== w.bsid) { appVars.boundBusy = true; try { closeWin(w.id, true, true); } finally { appVars.boundBusy = false; } } }
    const f = appVars.W[appVars.desks[appVars.idx]?.focus];
    if (f && f.app === 'chats' && f.thread && f.thread !== '__new__') { const el = winEl(f.id)?.querySelector('[data-chats]'); if (el && el.querySelector('.ch-thread') && CHATS.ch(f.id).loadedFor === f.thread) threadShown(f.id, el); }
    syncPeek();
  }
  function boundTip(wid) {
    const n = store.get('boundTips', 0); if (n >= 3) return;
    store.set('boundTips', n + 1);
    const b = boundOf(wid); if (b) toast('▸', `<b>${esc(clip(winTitle(b), 28))}</b> is open beside this thread · tap or swipe the right edge to look`, 2600);
  }
  /* The peek (James, 12 Oct 2026: no tab, the bottom bar swipe is enough): on the thread the bound desk leans
   * 36 px in from the right; on the bound view its thread leans 12 px in from the left. The leaning edge is a
   * handle too (core/edge-peek.js, told through WosSkinHost.beside): tap or swipe it to move across. */
  function syncPeek() {
    const f = appVars.W[appVars.desks[appVars.idx]?.focus], b0 = f && f.app === 'chats' && f.thread ? boundOf(f.id) : null, b = b0 && b0.bsid === f.thread ? b0 : null;
    const on = !!(b && deskOf(b.id) === appVars.idx + 1);
    const owner = f?.bound ? appVars.W[f.bound] : null;
    const left = !!(owner && owner.thread === f.bsid && deskOf(owner.id) === appVars.idx - 1);
    const nsec = on ? secOf(appVars.idx + 1) : null;
    const psec = left ? secOf(appVars.idx - 1) : null;
    const hsec = on ? secOf(appVars.idx) : null;
    const vsec = left ? secOf(appVars.idx) : null;
    $$('.desk.bound-peek', track).forEach(s => { if (s !== nsec) s.classList.remove('bound-peek'); });
    $$('.desk.bound-chat-peek', track).forEach(s => { if (s !== psec) s.classList.remove('bound-chat-peek'); });
    $$('.desk.bound-host', track).forEach(s => { if (s !== hsec) s.classList.remove('bound-host'); });
    $$('.desk.bound-view-host', track).forEach(s => { if (s !== vsec) s.classList.remove('bound-view-host'); });
    if (nsec) nsec.classList.add('bound-peek');
    if (psec) psec.classList.add('bound-chat-peek');
    if (hsec) hsec.classList.add('bound-host');
    if (vsec) vsec.classList.add('bound-view-host');
    device.classList.toggle('bound-peeking', on);
    device.classList.toggle('bound-view-peeking', left);
    window.WosSkinHost?.beside?.();
  }
  // "Open app": a normal copy on a desk of its own, beside the bound one; the bound view stays with the thread.
  function detachBound(id) {
    const w = appVars.W[id]; if (!w || !w.from) return;
    if (!w.bound) return pinWin(id); // a manually opened review becomes its own app desk
    const href = frameHref(id) || w.url || '';
    const a = w.appId && w.appId !== 'link' ? (APP[w.appId] || findApp(w.appId)) : null;
    if (a) {
      const here = Object.keys(appVars.W).find(k => appVars.W[k].app === 'frame' && appVars.W[k].appId === a.id && !appVars.W[k].from && deskOf(k) >= 0);
      if (here) { bringBeside(here); goDesk(deskOf(here), true); focusWin(here); }
      else openWin({ app: 'frame', appId: a.id, ...(href && href !== a.url ? { url: href } : {}) });
    } else openWin({ app: 'frame', appId: 'link', url: href, title: winTitle(w) });
    toast('↗', `${esc(clip(winTitle(w), 30))} has its own desk now · the review view stays with the thread`, 2200);
  }
  function pinWin(id) {
    const w = appVars.W[id]; if (!w || !w.from) return;
    delete w.from; save();
    const el = winEl(id); if (el) { el.classList.remove('reviewing'); el.querySelector('[data-wact="detach"]')?.remove(); el.querySelector('.rv-tag')?.remove(); }
    applyLayout(deskOf(id)); renderDots(); syncReviewChip(); toast('↗', 'Open app · it now has its own desk', 1600);
  }
  return { detachBound, pinWin, syncBound, threadShown, bindLate: v => { if ('bringBeside' in v) bringBeside = v.bringBeside; if ('frameHref' in v) frameHref = v.frameHref; if ('syncReviewChip' in v) syncReviewChip = v.syncReviewChip; if ('toast' in v) toast = v.toast; } };
};
