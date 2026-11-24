/* Wizard UX desktop shell › a link to a page inside an installed app opens as that app's window, and deep links
 * (?session=, ?view=, ?video=) on start. Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.links = function ({ APP, appAt, C, CHATS, closeSettings, commandSnapshot, findApp, findWin, focused, goHome, LINKS, LIVE, localCommand, MOD, newChat, newWin, openAgentChats, openApp, openAppLink, openPicker, openSettings, openThread, syncChatsPane, toast, toggleKeys, winEl }) {
  // A link to a page inside an installed app opens as that app's window (its services: shared microphone,
  // Back, theme), not in the plain link pane (James, 19 Oct 2026: Outline said "not connected to Wizard").
  if (LINKS) LINKS.route = href => {
    let u; try { u = new URL(href, location.href); } catch (e) { return false; }
    const pageSlug = window.WosPages.match(href);
    if (pageSlug) { newWin({app:'pages',appId:'pages',pageSlug}); return true; }
    const a = u.origin === location.origin && appAt(u.href); if (!a) return false;
    const rel = u.pathname + u.search + u.hash, same = new URL(a.url, location.href);
    // (a #fragment on the app's own address is a deep link, e.g. /wizardos-tracker/#item/…: the window goes there too)
    if (same.pathname + same.search === u.pathname + u.search) { openApp(a, { fresh: false, ...(u.hash && u.hash !== same.hash ? { path: rel } : {}) }); return true; }
    return openAppLink(rel, a.name);
  };
  if (LINKS) window.WizLinks.intercept(document.body, LINKS);
  LIVE?.refresh();
  /* Deep links (core/deeplink.js): ?session= opens the thread in a Chats window, ?view= a screen, ?video= the player.
   * Back/Esc then walks thread → list → stays; the page is never left. */
  window.WosFeatures.install({command:localCommand,context:commandSnapshot,openFeature:(id,opts)=>{closeSettings();newWin({app:'feature',featureId:id,featureOptions:opts,title:window.WosFeatures.entries.find(f=>f.id===id)?.title});}});
  window.WosAppVoice.install({apps:()=>APP,findWin:appId=>findWin(w=>w.app==='frame'&&w.appId===appId)?.id,open:appId=>{openApp(APP[appId]);return findWin(w=>w.appId===appId)?.id;},frameOf:id=>winEl(id)?.querySelector('iframe'),toast});
  // First-message guide (core/tour.js WosTour.desk): once per browser on an alongside install's first launch, or from
  // ?view=tour and the Keys sheet's "Show me again". VM launches keep Setup only (alongsideOnly).
  const DESK_TOUR = window.WosTour?.desk || null;
  DESK_TOUR?.attach({ mod: MOD, toast, newChat: () => newChat(),
    composer: () => { const f = focused(); return f?.app === 'chats' ? winEl(f.id)?.querySelector('.pane-main .ch-compose .ch-field') || null : null; },
    pane: () => { const f = focused(); return f?.app === 'chats' ? winEl(f.id)?.querySelector('.pane-main') || null : null; } });
  C.deeplink.handle({
    thread: sid => openThread(sid),
    view(v, section, installQuery) {
      if (v === 'tour' && window.WosTour?.desk) { closeSettings(); toggleKeys(false); return window.WosTour.desk.start('link'); }
      if (v === 'help') { closeSettings(); return toggleKeys(true); }
      if (v === 'home') return goHome();
      if (v === 'apps') return openPicker();
      if (v === 'install') {
        // The Store window must exist now to receive the link; the Store needs no setup check of its own.
        window.WosAppSetup?.close(); // an earlier app's pending check or sheet must not reopen it over the Store
        openApp(APP['app-store'], { setupChecked: true });
        const w=findWin(w=>w.appId==='app-store');
        return C.deeplink.installInFrame(w && winEl(w.id)?.querySelector('iframe'),installQuery);
      }
      if (v === 'store') return openApp(APP['app-store']);
      if (v === 'agents') return openApp(APP.agents);
      if (window.WosFeatures.open(v)) return;
      if (window.WosSettings.route(v, openSettings)) return;
      if (v === 'files') { const a = findApp('files') || APP.files; if (a) return openApp(a); return toast('◇', 'Files isn’t on this Wizard', 1800); }
      openApp(APP.wizard);
      { const f = focused(); if (f?.app === 'chats' && f.thread) { CHATS.chatsBack(f); syncChatsPane(f.id); } }
      const show = (tries = 50) => { const f = focused(); const sec = f && winEl(f.id)?.querySelector(`.pane-list [data-sec="${section}"]`); if (!sec) { if (tries > 0) setTimeout(() => show(tries - 1), 100); return; } if (!sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click(); winEl(f.id)?.querySelector(`.pane-list [data-sec="${section}"]`)?.scrollIntoView({ block: 'start' }); };
      if (section) show();
    },
    app(id) {
      const a = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (a) return openApp(a);
      // Cold launch: the registered app list may still be loading. The same deep link must work in either shell.
      Promise.resolve(C.appsLoaded?.()).then(() => { const b = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (b) openApp(b); });
    },
    video: item => CHATS.KIT.viewer.open([item]),
    agent: id => openAgentChats(id),
    toast,
  });
  return {  };
};
