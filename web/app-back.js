/* Wizard UX phone shell › the phone Back step and its watchers. Moved out of app.js
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
window.WizCore.appParts.back = function ({ $, $$, agentWin, appVars, CHATS, closeMenu, closeOverview, closeReviewCoach, closeSheets, closeWin, deskOf, frameNav, goDesk, HOME, openSettings, pauseCommandCapture, save, selfPop, setFull, setZen, toast, txHide, V, winEl }) {
  const watchers = new Set();
  const phoneBack = window.WizEscapeBack.create();
  window.WizEscapeBack.installOwners(phoneBack, { chats: () => CHATS, links: () => appVars.LINKS,
    afterTour: () => { if (appVars.settingsReturn === 'help') { appVars.settingsReturn = ''; openSettings(); $('#settingsBody [data-st="help"]')?.focus(); } },
    afterChat: () => { if (appVars.settingsReturn === 'files') { appVars.settingsReturn = ''; openSettings(); $('#settingsBody [data-st="files"]')?.focus(); } },
  });
  phoneBack.watch(() => document.querySelector('#txChips [data-handoff], #txChips [data-hold]'), () => { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(0); }, 'draft');
  phoneBack.watch(() => appVars.ovEl?.classList.contains('open'), closeOverview, 'overview');
  phoneBack.watch(() => appVars.rvCoach, closeReviewCoach, 'review-coach');
  phoneBack.watch(() => appVars.menuFor, closeMenu, 'menu');
  phoneBack.watch(() => appVars.sheet, ({ outside }) => { if (appVars.sheet === 'settings' && !outside && appVars.settingsView?.back()) return 'settings-page'; closeSheets(); return 'sheet'; }, 'sheet');
  window.WosBack = Object.freeze({ names: phoneBack.names, escape(e) { e.preventDefault?.(); e.stopImmediatePropagation?.(); if (!e.repeat && !e.isComposing) return onBack(); } });
  function hostedBack(f) {
    const frame = winEl(f.id)?.querySelector('iframe');
    // A sandboxed app (browser boundary) answers later; at its root the shell's next Back step runs then.
    const result = window.WizAppServices?.back(frame, () => backStep(f.id));
    return result || 'notReady';
  }
  function backStep(skipHosted, { outside = false } = {}) {
    window.WosSettings?.cancelWait?.(); // every Back path (native, CloseWatcher, history) drops a System link still waiting
    // The Review coach promises that Back closes the review, not just this first-use hint.
    // Outside still dismisses only the hint; Back continues to the Reader's own history, then its chat.
    if (appVars.rvCoach && !outside) closeReviewCoach();
    const transient = phoneBack.run({ outside, recording: () => {
      // Retain/pause phone capture; only desktop Escape discards its voice note.
      if (!V.snap?.general || !['listen', 'command'].includes(V.state)) return false;
      V.stopAsked = true; pauseCommandCapture(); return 'recording';
    } }); if (transient) return transient;

    const d = appVars.desks[appVars.idx], f = appVars.W[d.focus];
    if (f && CHATS.isHosted(f.id)) return CHATS.threadBack(f);
    if (f) {
      if (f.app === 'pages') { if (window.WosPages.back(winEl(f.id)?.querySelector('.pg-host'))) return 'pages'; closeWin(f.id); return 'pages-close'; }
      if (f.app === 'chats' && f.thread) return CHATS.threadBack(f);
      if (f.app === 'chats' && (CHATS.hasFilter(f) || CHATS.ch(f.id).q)) {
        const c = CHATS.ch(f.id), back = c.filterFrom, did = CHATS.clearFilter(f);
        // A Home card's chip: one Back takes it off and goes back to Home, the way James came.
        if (did === 'chip' && !CHATS.hasFilter(f)) { c.fromCard = false; c.coach = false; c.filterFrom = null; const p = back ? appVars.desks.findIndex(x => x.id === back) : -1; if (p >= 0 && p !== appVars.idx) goDesk(p); }
        if (did) return did === 'search' ? 'search' : 'filter';
      }
      if (f.app === 'chats' && CHATS.channelBack?.(f)) return 'channel'; // a channel's feed → Channels
      if (f.app === 'chats' && CHATS.readyBack?.()) return 'ready-order'; // Priority / By subject → Newest
      // An agent's Chats opened from the Agents app: Back returns to that app (still open), never out.
      if (agentWin(f) && f.backTo && appVars.W[f.backTo] && deskOf(f.backTo) >= 0 && deskOf(f.backTo) !== appVars.idx) { const t = deskOf(f.backTo); f.backTo = ''; save(); goDesk(t); return 'agent-back'; }
      if (f.app === 'frame' && skipHosted !== f.id) {
        const result = hostedBack(f);
        if (['handled', 'pending', 'stay'].includes(result)) return 'hosted';
        if (result === 'notReady') { const nav = frameNav(f.id); if (nav?.canGoBack) { try { selfPop(winEl(f.id).querySelector('iframe').contentWindow); } catch (e) {} nav.back(); return 'frame'; } }
      }
      if (window.WizCompanionPane?.back(f.id)) return 'companion-back';
      if (d.full) { setFull(f.id, false); return 'tile'; }
      // A bound view: Back slides back to its thread; the view stays beside it until James leaves the thread.
      if (f.bound && appVars.W[f.bound] && deskOf(f.bound) >= 0) { goDesk(deskOf(f.bound)); return 'bound-back'; }
      if (f.from) { closeWin(f.id); return 'review-close'; } // a link's desk: Back closes it and lands where it came from
    }
    if (appVars.zen) { setZen(false); return 'zen'; }
    if (appVars.idx !== HOME) { goDesk(HOME); return 'home'; }
    return null;
  }
  /* A browser or OS back swipe (iOS Safari's left edge, Chrome's overscroll, Android's edge) that starts under a finger
   * a skin gesture has claimed (api.gesture.claim, e.g. a layout's edge drawer) belongs to that gesture: it is not
   * also a Back step. Nothing claims a finger in Desks, so every Back there is unchanged. */
  const ownedSwipe = () => !!window.WosSkinHost?.claimedLately?.();
  function onBack() {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did || 'root').slice(-30);
    if (!did) toast('⌂', "You're home", 1200);
    return did || 'root';
  }
  function makeWatcher(win, rearm) {
    if (!win || !('CloseWatcher' in win)) return null;
    try {
      const w = new win.CloseWatcher();
      w.onclose = () => { watchers.delete(w); if (!ownedSwipe()) onBack(); setTimeout(rearm, 0); };
      watchers.add(w); return w;
    } catch (e) { return null; }
  }
  let topWatcher = null;
  function armBack() {
    if (!topWatcher || !watchers.has(topWatcher)) topWatcher = makeWatcher(window, () => { topWatcher = null; armBack(); });
    ensureGuard();
  }
  function armFrameBack(f, win) {
    if (win._wosWatcher && watchers.has(win._wosWatcher)) return;
    const rearm = () => { try { if (f.contentWindow === win) { win._wosWatcher = null; armFrameBack(f, win); } } catch (e) {} };
    win._wosWatcher = makeWatcher(win, rearm);
  }
  function disarmAll() { for (const w of [...watchers]) { watchers.delete(w); try { w.destroy(); } catch (e) {} } topWatcher = null; $$('iframe.appframe').forEach(f => { try { f.contentWindow._wosWatcher = null; } catch (e) {} }); }
  function rearmFrames() { $$('iframe.appframe').forEach(f => { try { const w = f.contentWindow; if (w && w.document.readyState !== 'loading') armFrameBack(f, w); } catch (e) {} }); }
  // History guard: only pushed during a user gesture, so Chrome never skips it.
  function ensureGuard(force) {
    if (appVars.guardOn || (!force && !navigator.userActivation?.isActive)) return;
    history.pushState({ wos: 'guard' }, ''); appVars.guardOn = true;
  }
  return { armBack, armFrameBack, backStep, ensureGuard, onBack, ownedSwipe, phoneBack, rearmFrames, watchers };
};
