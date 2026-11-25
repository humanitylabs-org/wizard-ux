/* Wizard UX phone shell › the Back guard, first run, the native shell bridge and deep links. Moved out of app.js
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
window.WizCore.appParts.boot = function ({ $, APP, APPS, appVars, armBack, backStep, blank, browserBarInset, buildDesks, cancelVoice, ch, CH, CHATS, chatsBack, closeAppPlayback, closeDesk, closeMenu, closeOverview, closePeek, closeSheets, closeWin, deskOf, device, ensureGuard, execute, FIELDS, findApp, finishVoice, focusWin, fromOf, goDesk, handleText, HOME, LIVE, localParse, mainChats, markVisibleThreadsSeen, MAXW, mergeDesks, mountLinks, moveWin, nativeFinish, nativeResume, NOMATCH_MS, onBack, onUnsentChange, openAgentChats, openApp, openChat, openChatsList, openLinkDesk, openOverview, openPeek, openSearch, openSettings, openSheet, openWin, openWizardThread, orbWrap, OUTBOX, ownedSwipe, pinWin, placeApp, placeTrack, posOf, QUICK_MS, quickTake, rearmFrames, recDone, recoverDictation, recoverParkedReply, refreshCompose, refreshHome, renderChats, renderDesk, renderDots, renderSettings, reorderDesks, runUtterance, save, sendChat, sendSnap, setFull, setVoice, setZen, shock, sideButtonTap, splitDesk, startVoice, store, syncDesks, toAgent, toast, track, tx, txHide, txShow, unsentAll, V, vib, viewContext, viewOf, watchers, winApp, winEl }) {
  addEventListener('popstate', e => {
    // Landing on a guard entry means the Back key popped something stacked above it (a hosted app's entry or a
    // second guard). We never navigate forward, so every pop is a user Back: never swallow one.
    appVars.guardOn = e.state?.wos === 'guard';
    if (appVars.ignorePop) { appVars.ignorePop--; appVars.dropUntil = 0; return; }
    if (Date.now() < appVars.dropUntil) { appVars.dropUntil = 0; return; } // our own guard drop surfacing late (counts once)
    // a back swipe of the browser / OS under a finger a skin gesture owns (a layout's edge drawer) is that gesture's
    if (ownedSwipe()) { ensureGuard(true); return; }
    onBack();
    // A consumed step re-arms at once, so the next Back (even with no tap in
    // between) is caught too, including at Home.
    ensureGuard(true);
  });
  // Every touch is a user activation: refresh the watchers and the guard then.
  // (Touch only grants activation on pointerup/click, so listen to all three.)
  for (const ev of ['pointerdown', 'pointerup', 'click']) addEventListener(ev, () => { { armBack(); rearmFrames(); } }, true);
  addEventListener('keydown', () => { armBack(); }, true);
  if (history.state?.wos !== 'root' && history.state?.wos !== 'guard') history.replaceState({ wos: 'root' }, '');
  if (history.state?.wos === 'guard') appVars.guardOn = true;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !('CloseWatcher' in window)) { onBack(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') goDesk(appVars.idx + 1);
    else if (e.key === 'ArrowLeft') goDesk(appVars.idx - 1);
    else if (e.key === 'ArrowUp') { appVars.sheet === 'inbox' ? closeSheets() : openSheet('launcher'); }
    else if (e.key === 'ArrowDown') { appVars.sheet === 'launcher' ? closeSheets() : openSheet('inbox'); }
    else if (e.key === '/') { e.preventDefault(); openSheet('launcher'); setTimeout(() => $('#search').focus(), 50); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE && LIVE.refresh(); markVisibleThreadsSeen(); } });

  // The phone keeps a still resting orb; live voice/agent feedback stays animated.
  // Shared native Everywhere hosts retain their existing cadence.
  Orb.setRestingMotion?.(false);

  /* Starfield + Nebula drift + skin canvases: core/scenery.js (battery-gated decorative motion). */

  /* ---------------- boot ---------------- */
  buildDesks(); setVoice('idle'); armBack();
  browserBarInset();
  /* Workspace sync (core/workspace-sync.js): the same desks on every device. Home stays this phone's own; a desk
   * with more windows than the phone tiles keeps the rest in d.more so they are never dropped from the shared copy. */
  window.WosWorkspaceSync?.create({
    shell: 'phone',
    title: w => winApp(w)?.name || w.title || w.appId,
    read: () => ({ desks: appVars.desks.filter(d => !d.home).map(d => ({ id: d.id, wins: [...d.wins.map(id => appVars.W[id]).filter(Boolean), ...(d.more || [])] })) }),
    apply(state, o = {}) {
      if (!state) { const i = posOf(o.focus); if (i > 0) { closeSheets(true); goDesk(i); } return; }
      const here = appVars.desks[appVars.idx]?.id, at = appVars.idx;
      // Joining the owner's shared workspaces: his open apps replace this device's starter apps (seed), so a phone
      // whose storage was reset never shows starter apps he did not open (James, 6 Nov 2026).
      if (o.join && state.desks.length) appVars.desks = appVars.desks.filter(d => {
        if (d.home || !d.wins.some(id => appVars.W[id]?.seed)) return true;
        d.wins = d.wins.filter(id => { if (!appVars.W[id]?.seed) return true; winEl(id)?.remove(); delete appVars.W[id]; return false; });
        if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
        return d.wins.length > 0;
      });
      const r = window.WosWorkspaceSync.reconcile(appVars.desks.slice(1), appVars.W, state, { fresh: id => blank({ id }), max: MAXW });
      r.removed.forEach(id => { closeAppPlayback(appVars.W[id]); CHATS.closeHosted(id); CHATS.forget(id); delete appVars.W[id]; delete CH[id]; });
      appVars.desks = [appVars.desks[0], ...r.desks].map(d => { if (!d.wins.length) d.full = false; return d; });
      syncDesks(); appVars.desks.forEach((_, i) => renderDesk(i));
      appVars.idx = posOf(here); if (appVars.idx < 0) appVars.idx = Math.max(0, Math.min(at, appVars.desks.length - 1));
      placeTrack(0, false); renderDots(); save();
    },
  });
  // Decorative motion lives only on a visible, recently touched Home with nothing over it (core/scenery.js).
  window.WosScenery?.attach({ device, homeInView: () => appVars.idx === HOME && !appVars.desks[appVars.idx]?.full, deskIdx: () => appVars.idx });
  if (LIVE) LIVE.refresh();
  $('#clock').textContent = window.WizConfig.hm();
  window.addEventListener('wizard:config', () => { const t = $('#homeTime'), c = $('#clock'), hm = window.WizConfig.hm(); if (t) t.textContent = hm; if (c) c.textContent = hm; });
  /* First run: the practice tour (core/tour.js). Say "help" or Settings → Gestures & help to see it again. */
  window.WosTour?.attach({
    device, orbWrap, shock, vib, toast,
    setMode: m => Orb.setMode(m),
    goHome: () => { if (appVars.idx !== HOME) goDesk(HOME, true); },
    workingCard: () => track.querySelector('.home-desk [data-act="working"]'),
    cmdExample: () => (findApp('calendar') ? 'Open Calendar' : 'Open Files'),
    noMic: () => appVars.NOMIC,
    closeSheets: () => closeSheets(),
    setZen: on => setZen(on),
    dismissVoice: () => { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(1200); },
    prepare: () => { if (V.state !== 'idle') cancelVoice(true); closeMenu(); closeOverview(); closeSheets(true); const d = appVars.desks[appVars.idx]; if (d.full && d.focus) setFull(d.focus, false); },
    say: (t, kind) => runUtterance(t, kind || 'auto'),
    openChats: () => { closeSheets(); openChatsList(); },
    atHome: () => appVars.idx === HOME && !appVars.sheet,
  });
  const firstRun = !store.get('coached', false) && !window.WosTour?.done();
  // Setup (core/setup-launch.js) opens first on a box's first run; the tour then waits for the first return to Home.
  // First run is the Welcome modal (core/welcome.js): connect an AI, pick a look, send a first message. It replaces
  // the automatic Setup window and gesture tour (Miguel, 29 Oct 2026); "help" and ?view=tour still open the tour.
  void firstRun;
  window.WosWelcome?.boot({ app: id => APP[id] || null, openStore: () => { const a = APP['app-store']; if (a) openApp(a); },
    deeplinked: () => (window.__deeplinkLog || []).length > 0, busy: () => V.state !== 'idle',
    // Say hello's mic (issue 1730): the orb's own dictation into the focused box (native mic in the Android app).
    voice: () => ({ state: V.state, kind: V.kind || '' }),
    dictate: () => { if (V.state === 'idle') { if (!FIELDS?.refresh()) return false; startVoice('dictation'); return true; } if (V.kind === 'dictation' && (V.state === 'listen' || V.state === 'paused')) { finishVoice(); return true; } return V.kind === 'dictation'; },
    dictateCancel: () => { if (V.kind === 'dictation' && V.state !== 'idle' && V.state !== 'think') cancelVoice(); },
    // One main Chats window, and the new thread opens in it as soon as it is saved.
    send: async text => { closeSheets(true); const w = placeApp(mainChats, { app: 'chats', thread: null }); if (!w) throw new Error('Chats unavailable'); const it = await sendChat(w.id, text, 'the first message, from the Welcome screen', null, { sid: '__new__', away: true }); if (it?.sessionId) window.WosWelcome.whenThreadExists(it.sessionId, sid => openWizardThread(sid)); return it || null; } });
  // Native shell (WizardOS Android app): the app hands every hardware/gesture Back to the shell. A step that
  // undoes something returns its name; at the true root the shell stays put and says so. The app never exits
  // on Back (James's rule), just like the browser guard above.
  window.__wosNativeBack = () => {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did ? 'native:' + did : 'native:root').slice(-30);
    if (!did) toast('⌂', "You're home", 1200);
    return did || 'root';
  };
  if (/WizardOS-Android\//.test(navigator.userAgent)) document.documentElement.classList.add('native-app');
  // Assistant handoff (side-key app → WizardOS). 'listen' opens the orb listening; 'say' shows the words as a
  // draft that James sends with one tap — another app can never make Archimedes act on its own.
  let threadHandoffGeneration = 0;
  // Messenger at its pinned Agent chat (`#chat=agent:notes`, Messenger's own link). On a cold start the app list may
  // still be loading, so wait for it once. Without Messenger the button keeps today's listening orb: never a dead press.
  const AGENT_NOTE_APPS = ['messenger', 'wizard-messenger'];
  function agentNote() {
    const log = s => { window.__backLog = (window.__backLog || []).concat('handoff:agent-note:' + s).slice(-30); };
    const open = () => {
      const id = AGENT_NOTE_APPS.find(x => window.WizCanOpen?.(x)); if (!id) return false;
      let u; try { u = new URL(APP[id].url, location.href); u.hash = 'chat=agent:notes'; } catch (_) { return false; }
      const ok = window.WizOpenApp?.(id, u.href) === true; log(ok ? 'open:' + id : 'refused:' + id); return ok;
    };
    if (open()) return;
    Promise.resolve(window.WizCore?.appsLoaded?.()).catch(() => {}).then(() => {
      if (open()) return;
      log('no-messenger');
      toast('◉', 'The Agent chat is in Messenger · get it from the App Store', 3200);
      if (V.state === 'idle') startVoice('auto');
    });
  }
  window.__wosHandoff = h => {
    // A side-button handoff means James already knows the gestures: clear the first-run coach so the draft is visible.
    if (window.WosTour?.active) window.WosTour.finish('handoff');
    if (!h || typeof h !== 'object') return false;
    closeSheets(); if (appVars.idx !== HOME && h.action !== 'thread') goDesk(HOME);
    if (h.action === 'listen') { if (V.state === 'idle') startVoice('auto'); return true; }
    if (h.action === 'thread' && h.id) {
      const id = String(h.id), generation = ++threadHandoffGeneration;
      // Android 0.9.15's share notification carries only thread_id. On a cold start or just-shared
      // thread its owning agent is not cached yet: resolve agent lists BEFORE opening Chats.
      // Never open a private notification in main while the refresh is still in flight.
      Promise.resolve(LIVE?.refreshAgents?.()).then(() => {
        if (generation !== threadHandoffGeneration) return;
        if (!LIVE?.agentOf?.(id) && Object.values(LIVE?.agentStatus || {}).some(s => !s.ok)) {
          toast('◉', 'Could not locate that chat · reconnect and tap again'); return;
        }
        openWizardThread(id); LIVE?.refresh();
      }).catch(() => { if (generation === threadHandoffGeneration) toast('◉', 'Could not locate that chat · reconnect and tap again'); });
      return true;
    }
    // Side button opens the Agent chat (wizard-ux issue 1528, switch wizard/assist-agent-note): the Android app sends
    // this instead of starting a Wizard take. Messenger's pinned Agent chat takes the typed or voice note and ticks it.
    if (h.action === 'agent-note') { agentNote(); return true; }
    if (APP[h.action]?.kind === 'wizard') return openApp(APP[h.action]);
    // Photos is its own app: older WizardOS builds still ask for Settings › photos-backup (notification, native screen).
    if (h.action === 'settings' && (h.focus === 'photos-backup' || h.focus === 'photos')) { if (!window.WizOpenApp?.('photos')) toast('▣', 'Photos backup lives in the Photos app · install it from the App Store', 3200); return true; }
    if (h.action === 'unsent' || h.action === 'settings') { onUnsentChange(); openSettings(h.action === 'unsent' || (typeof h.focus === 'string' && window.WosSettings?.features.some(f => f.id === h.focus) ? h.focus : undefined)); return true; }
    if (h.action === 'side-button') { store.set('sideHidden', false); refreshHome(true); if (appVars.SIDE && (appVars.SIDE.step === 'mic' || appVars.SIDE.step === 'assistant')) sideButtonTap(false); else toast('◉', 'Side button is on. Hold it to talk.', 2600); return true; }
    const text = String(h.text || '').trim().slice(0, 2000);
    if (h.action !== 'say' || !text) return false;
    if (V.state !== 'idle') cancelVoice(true);
    clearTimeout(appVars.txHideT);
    // Talking to Wizard is sending: no draft, no confirm — same as the orb.
    window.__backLog = (window.__backLog || []).concat('handoff:say').slice(-30);
    runUtterance(text, 'auto');
    return true;
  };
  /* choice: moved to app-choice.js (wizard-ux issue 1665), called once here */
  const {  } = window.WizCore.appParts.choice({ $, APP, APPS, cancelVoice, closeSheets, FIELDS, findApp, finishVoice, mountLinks, NOMATCH_MS, openApp, openSearch, openSheet, openWizardThread, OUTBOX, startVoice, toAgent, toast, tx, txHide, V });
  // Shared app command delivery; compatibility ownership is confined to voice-legacy.
  window.WosAppVoice?.install({
    apps: () => APP,
    findWin: appId => {
      const mine = id => appVars.W[id]?.app === 'frame' && appVars.W[id].appId === appId;
      return appVars.desks[appVars.idx].wins.find(mine) || Object.keys(appVars.W).find(id => mine(id) && deskOf(id) >= 0) || null;
    },
    open: appId => { closeSheets(true); const w = placeApp(x => x.app === 'frame' && x.appId === appId && !x.from, { app: 'frame', appId }); return w ? w.id : null; },
    frameOf: id => winEl(id)?.querySelector('iframe.appframe') || null,
    toast,
  });
  window.__wos = {
    get links() { return appVars.LINKS; },
    get voiceBorrowing() { return appVars.parking || !!appVars.parkedReply || !!V.admitting; },
    openAgentChats,
    live: LIVE, openPeek, closePeek, openOverview, closeOverview, mergeDesks, splitDesk, reorderDesks, closeDesk, openLinkDesk, pinWin, openWizardThread, goDesk, openSheet, closeSheets, runUtterance, openApp, openWin, closeWin, moveWin, setFull, focusWin, openChat, sendChat, onBack, viewContext, viewOf, execute, handleText, quickTake, QUICK_MS,
    HOME, get idx() { return appVars.idx; }, get desks() { return appVars.desks; }, get ovLog() { return window.__ovLog || []; }, get wins() { return appVars.W; }, get voice() { return V.state; }, get voiceHandedOff() { return !!V.handedOff && OUTBOX.handedOff?.(V.handedOff); }, get sheet() { return appVars.sheet; },
    get back() { return { watchers: watchers.size, guardOn: appVars.guardOn, exitArmed: false, log: window.__backLog || [] }; },
    openSearch,
    startVoice, finishVoice, cancelVoice, recoverDictation, recoverParkedReply, outbox: OUTBOX, openSettings, unsentAll, renderSettings,
    canSearch: () => !!APP['wizard-search'], chats: CHATS, chat: CHATS.KIT, get viewer() { return CHATS.KIT.viewer.state; }, threadAct: CHATS.threadAct, openRowSheet: CHATS.openRowSheet,
    // web/device.js (share, recovery, update banner, hot reload) works through these.
    chatState: ch, addFiles: CHATS.addFiles, uploadFile: CHATS.uploadFile, renderChats, refreshCompose, toAgent, toast, txShow, txHide, setVoice, nativeFinish, nativeResume, recDone, get V() { return V; },
    reset() { Object.keys(localStorage).filter(k => k.startsWith('wos.')).forEach(k => localStorage.removeItem(k)); location.reload(); },
  };

  /* ---------------- banners, deep links, voice card (core/status.js, core/deeplink.js, core/voice-status.js) ---------------- */
  const chatsInFront = () => { const f = appVars.W[appVars.desks[appVars.idx].focus]; return f?.app === 'chats' && f.thread && f.thread !== '__new__' ? f.thread : ''; };
  window.WizCore.status?.attach({ openChats: () => openSheet('inbox'), inboxOpen: () => appVars.sheet === 'inbox', current: chatsInFront });
  window.WizCore.voiceStatus?.onChange(() => { if (appVars.sheet === 'settings') renderSettings(); });
  // The list may still be loading: wait for the section (up to ~5 s), open it, bring it into view.
  function showSection(k, tries = 50) {
    if (!k) return;
    const sec = track.querySelector(`.win[data-win="${appVars.desks[appVars.idx].focus}"] [data-sec="${k}"]`);
    if (!sec) { if (tries > 0) setTimeout(() => showSection(k, tries - 1), 100); return; }
    if (!sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click();
    const target = track.querySelector(`.win[data-win="${appVars.desks[appVars.idx].focus}"] [data-sec="${k}"]`);
    const scroller = target?.closest('.ch-scroll');
    if (scroller) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
  window.WosFeatures.install({
    context: () => {const id=appVars.desks[appVars.idx].focus,v=viewOf(id);return {id,view:{kind:v?.kind,appId:appVars.W[id]?.appId}};},
    openFeature: (id,opts) => {closeSheets(true);return openWin({app:'feature',featureId:id,featureOptions:opts,title:window.WosFeatures.entries.find(f=>f.id===id)?.title});},
    command: (text,snap=sendSnap()) => { const c = localParse(text, snap, 'command'); return c ? execute(c, text,{snap}) : false; }
  });
  window.WizCore.deeplink?.handle({
    // ?session= takes exactly the path the Android app's ACTION_THREAD intent takes.
    thread: id => window.__wosHandoff({ action: 'thread', id }),
    view(v, section, installQuery) {
      if (window.WosTour?.active && v !== 'tour') window.WosTour.finish('deeplink');
      if (v === 'tour') return window.WosTour?.start('link');
      if (v === 'help') { closeSheets(true); return window.WosTour?.openHelp(); }
      closeSheets(true);
      if (v === 'home') { window.WosResources?.back(); return goDesk(0, true); }
      if (v === 'apps') return openSheet('launcher');
      if (v === 'install') {
        // The Store window must exist now to receive the link; the Store needs no setup check of its own.
        window.WosAppSetup?.close(); // an earlier app's pending check or sheet must not reopen it over the Store
        openApp(APP['app-store'], {}, { setupChecked: true });
        const w=Object.values(appVars.W).find(w=>w.appId==='app-store');
        return window.WizCore.deeplink.installInFrame(w && document.querySelector(`[data-win="${w.id}"] iframe`),installQuery);
      }
      if (v === 'store') return openApp(APP['app-store']);
      if (v === 'agents') return openApp(APP.agents);
      if (window.WosFeatures.open(v)) return;
      if (window.WosSettings.route(v, openSettings)) return;
      if (v === 'files') { const a = findApp('files') || APP.files; if (a) return openApp(a); toast('◇', 'Files isn’t on this Wizard', 1800); return; }
      // work / chats: the Chats window, at the asked-for section.
      const here = appVars.desks.findIndex(d => d.wins.some(x => mainChats(appVars.W[x])));
      if (here >= 0 && here !== appVars.idx) goDesk(here, true);
      openApp(APP.wizard);
      const cw = appVars.W[appVars.desks[appVars.idx].focus]; if (mainChats(cw) && cw.thread) chatsBack(cw);
      showSection(section);
    },
    app(id, srcEl) {
      // Android, switch wizard/app-windows (wizard-os issue 650): a link to an app (also one this app was opened with) opens its own window.
      if (window.WizAndroidRelay?.openAppWindow?.(id)) return;
      // A tapped link inside a window (a Chats thread) remembers where it came from.
      const srcId = srcEl && srcEl.closest ? srcEl.closest('.win')?.dataset.win : '';
      const opts = srcId && appVars.W[srcId] ? { from: fromOf(srcId) } : {};
      const a = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (a) return openApp(a, {}, opts);
      Promise.resolve(window.WizCore.appsLoaded?.()).then(() => { if (window.WizAndroidRelay?.openAppWindow?.(id)) return; const b = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (b) openApp(b, {}, opts); });
    },
    video: item => { closeSheets(true); return CHATS.KIT.viewer.open([item]); },
    agent: id => openAgentChats(id),
    toast,
  });
  window.WizCore.deeplink?.consume();
  return {  };
};
