/* Wizard UX phone shell › Settings as a sheet, unsent items, Home repaints and the New desk app cards. Moved out of app.js
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
window.WizCore.appParts.cards = function ({ $, $$, APP, applyLayout, APPS, appTile, appVars, blank, CHATS, closeSheets, closeWin, deskOf, detachBound, device, DOWL, esc, focusWin, frameEdge, frameSetHidden, gearBtn, goDesk, HOME, ico, live, LIVE, mainChats, MON, NATIVE, norm, openApp, openChat, openChatsFiltered, openWin, OUTBOX, pinWin, placeApp, readNativeUnsent, renderChats, renderDots, renderThread, runUtterance, save, secOf, setFull, settingsContext, shareCutout, sideButtonTap, sideCard, store, syncDesks, tapOpen, track, unsentCard, winApp, winEl }) {
  let armBack, armFrameBack, backStep, bindWinPinch, ensureGuard, FIELDS, onBack, openSheet, reloadWin, renderInbox, renderMoons, toast, V; // late-bound: app.js declares these after the call, see bindLate
  function renderSettings() {
    if (!appVars.settingsView) appVars.settingsView = window.WosSettings.mount($('#settingsBody'), settingsContext());
    else appVars.settingsView.render();
  }
  function openFilesScreen() {
    closeSheets(true);
    let wid = chatsWinAny();
    if (!wid) { const w = openWin({ app: 'chats', thread: null }); if (!w) return; wid = w.id; }
    focusWin(wid); renderChats(appVars.W[wid]);
    setTimeout(() => CHATS.PW?.openFiles(wid), 30);
  }
  function openSettings(focus) {
    openSheet('settings');
    appVars.settingsView?.focus(focus === true ? 'unsent' : focus);
  }
  function unsentAction(id, origin, action) { return window.WosSettings.unsentAction(settingsContext(), id, origin, action); }
  // Edit puts the words back in a composer (the thread's, or a new chat's) and takes the item out of the queue.
  function editUnsent(it) {
    if (it.state === 'unconfirmed' || OUTBOX?.quarantined(it.id)) { toast('!', it.error || 'Waiting for device storage verification · original kept', 3200); return; }
    if (it.body) { toast('!', 'Delivery is uncertain · retry this submission to reconcile before editing', 3000); return; }
    closeSheets(true);
    const known = it.kind === 'reply' || LIVE?.session(it.sessionId);
    let wid;
    if (known) { openWizardThread(it.sessionId); wid = appVars.desks[appVars.idx].focus; }
    else {
      const agent = it.agent || '';
      const w = openWin({ app: 'chats', thread: null, ...(agent ? { agent } : {}) }); if (!w) return;
      wid = w.id; focusWin(wid); openChat(wid, '__new__');
    }
    if (!window.WosSettings.moveDraft({ chats: CHATS, wid: wid, item: it, outbox: OUTBOX, toast })) return; renderChats(appVars.W[wid]);
    setTimeout(() => { const ta = track.querySelector(`[data-chats="${wid}"] textarea`); ta?.focus(); }, 50);
  }
  // Empty desks (the New desk's app grid) drawn again, unless someone is typing in their search.
  function repaintNewDesks(onlyChanged) {
    appVars.desks.forEach((d, i) => { if (!d.wins.length && !d.home) { const g = secOf(i)?.querySelector('.glance'); if (g && !g.querySelector('[data-ndq]')?.value && document.activeElement?.closest('.glance') !== g) { const html = renderEmpty(i); if (!onlyChanged || g._wosNd !== html) { g.innerHTML = html; g._wosNd = html; } } } });
  }
  // ux#1646: a fresh app list redraws the New desk, so an app that gained its page leaves Agent apps for Apps.
  window.addEventListener('wizard:apps', () => { try { repaintNewDesks(true); } catch (_) {} });
  let lastUnsentSig = '';
  function onUnsentChange() {
    readNativeUnsent();
    if (appVars.sheet === 'settings') renderSettings();
    if (appVars.sheet === 'inbox') renderInbox();
    refreshHome(); renderMoons();
    repaintNewDesks();
    for (const id of Object.keys(appVars.W)) { const w = appVars.W[id]; if ((w.app === 'chats' || CHATS.isHosted(id)) && w.thread) { const el = track.querySelector(`[data-chats="${id}"]`); if (el) renderThread(w, el); } }
    for (const id of Object.keys(appVars.W)) { const w = appVars.W[id]; if (w.app === 'chats' && !w.thread) { const el = track.querySelector(`[data-chats="${id}"]`); if (el && el.querySelector('.ch-list')) CHATS.renderChatList(w, el); } }
    // Tell Android how many app messages are stuck, so it can say so in a notification while the app is closed.
    const failed = OUTBOX ? OUTBOX.unsent().filter(x => x.state === 'failed') : [];
    const sig = failed.map(x => x.id).join(',');
    if (sig !== lastUnsentSig) { lastUnsentSig = sig; try { NATIVE() && window.WizardOSNative.appUnsent && window.WizardOSNative.appUnsent(failed.length, failed[0]?.text || ''); } catch (e) {} }
  }
  OUTBOX?.onChange(onUnsentChange);
  window.__wosUnsent = () => { onUnsentChange(); return true; };
  window.__wosEverywhere = () => { if (appVars.sheet === 'settings') renderSettings(); return true; };
  /* home: moved to app-home.js (wizard-ux issue 1665), called once here */
  const { renderHome, bindLate: homeLate } = window.WizCore.appParts.home({ $, DOWL, gearBtn, live, LIVE, MON, refreshHome: (...a) => refreshHome(...a), sideCard, unsentCard });
  const refreshHome = force => { if (!appVars.desks[HOME].wins.length) { const g = secOf(HOME)?.querySelector('.glance'); if (g) paintHome(g, renderHome()); } };
  // Home repaints go through the skin host so a tweak's home-main mount survives (plain innerHTML without one).
  function paintHome(el, html) { if (window.WosSkinHost?.paintHome) window.WosSkinHost.paintHome(el, html); else el.innerHTML = html; }

  /* ---------------- empty desk, app cards, maps, frames ---------------- */
  /* ＋ after the last desk (James, 12 Oct 2026): jump straight to a new desk at the end of the strip. An empty desk
   * is a page of app tiles, not a pop-up: tap one and it opens right here. Leave without picking and the desk goes. */
  function newDesk() {
    const last = appVars.desks.length - 1;
    if (last > 0 && !appVars.desks[last].wins.length) return goDesk(last);
    foldOpen.agents = foldOpen.dev = false; appVars.desks.push(blank({})); syncDesks(); renderDots(); goDesk(appVars.desks.length - 1, true); // the empty desk titles itself; a label flash would cover its search pill
  }
  /* Swipe up on the orb opens Desks instead of Apps when a skin's CSS (or the owner's
   * My skin) sets `--wos-orb-swipe-up` on <html>: `desks` = the regular overview, `pill` = Miguel's pill panel (the skin
   * or My skin then carries the .ov-pill styling, as Miguel's skin.css does). */
  const orbUpVar = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-orb-swipe-up').trim(); } catch (_) { return ''; } };
  const orbUpDesks = () => ['desks', 'pill'].includes(orbUpVar());
  /* App kinds (core/app-kinds.js, shared with the desktop selector): Apps, Agent apps, Agents, Connectors, system apps
   * first and ringed; every group ends with a "+ Get ..." tile for its App Store section, and Agents also has
   * "+ Build agents" (the Agents app, where agents are made and managed). */
  const AK = window.WosAppKinds;
  const { isSystem } = AK;
  const appKinds = () => AK.kinds(APPS, APP);
  const sysMark = html => html.replace('class="lapp', 'class="lapp lapp-sys').replace('<span class="nm">', '<span class="nm" title="System app">');
  const backTile = a => `<button class="lapp lapp-back${isSystem(a) ? ' lapp-sys' : ''}" data-appinfo="${esc(a.id)}" data-name="${esc(a.name)}" style="--i:${appVars.tileN++}">${ico('span', 'ic', a)}<span class="nm">${esc(a.name)}</span></button>`;
  const kindTile = a => a.url || a.kind !== 'wizard' ? (isSystem(a) ? sysMark(appTile(a)) : appTile(a)) : backTile(a);
  const plusTile = (attrs, label) => `<button class="lapp lapp-get" ${attrs}><span class="ic">+</span><span class="nm">${esc(label)}</span></button>`;
  const getTile = k => plusTile(`data-storekind="${AK.GET[k][0]}"`, AK.GET[k][1]);
  // System apps lead their group in the same grid; their purple tile (skin.css .lapp-sys) marks them, no label or box.
  function sysSplit(list, tile) { return AK.sysFirst(list).map(tile).join(''); }
  function kindGroups(order) {
    const K = appKinds();
    const grp = (k, body) => `<div class="lgroup kg-${k}"><h4>${AK.LABELS[k]}</h4><div class="lgrid">${body}${getTile(k)}</div></div>`;
    const G = {
      apps: grp('apps', sysSplit(K.apps, kindTile)),
      wiz: grp('wiz', sysSplit(K.wiz, backTile)),
      agents: grp('agents', sysSplit(K.agents, kindTile) + (K.builder ? plusTile('data-app="agents"', 'Build agents') : '')),
      conns: grp('conns', sysSplit(K.conns, kindTile)),
    };
    // Apps are for people; Agent apps, Agents and Connectors are mostly for agents: one "For agents" section,
    // folded by default (each open of the sheet or a New desk starts folded), tap the row to open it.
    const fa = order.filter(k => k !== 'apps' && G[k]);
    const n = (K.wiz.length + K.agents.length + K.conns.length);
    const fold = (key, label, count, body) => `<div class="forag fa-${key}${foldOpen[key] ? ' open' : ''}" data-fold="${key}"><button type="button" class="fa-row" data-fatoggle="${key}" aria-expanded="${!!foldOpen[key]}"><span>${label}</span><small>${count}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="fa-body">${body}</div></div>`;
    const dev = order.includes('apps') && K.dev.length ? fold('dev', 'In development', K.dev.length, `<div class="lgroup kg-dev"><h4>In development</h4><div class="lgrid">${K.dev.map(kindTile).join('')}</div></div>`) : '';
    const folded = fa.length ? fold('agents', 'For agents', n, fa.map(k => G[k]).join('')) : '';
    return (order.includes('apps') ? G.apps : '') + dev + folded;
  }
  // "+ Get ..." tiles open the App Store on that section (store.js reads ?kind=).
  function openStoreKind(kind) {
    closeSheets(); // not quiet: the Apps sheet must close even when it was opened without a tracked sheet
    const url = AK.storeUrl(kind), id = Object.keys(appVars.W).find(k => appVars.W[k].appId === 'app-store' && deskOf(k) >= 0);
    if (id) { const f = winEl(id)?.querySelector('iframe'); appVars.W[id].url = url; if (f) f.src = url; const t = deskOf(id); if (t !== appVars.idx) goDesk(t, true); focusWin(id); save(); return; }
    openWin({ app: 'frame', appId: 'app-store', url });
  }
  const foldOpen = { agents: false, dev: false };
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-fatoggle]'); if (!t) return;
    e.stopPropagation(); const key = t.dataset.fatoggle || 'agents'; foldOpen[key] = !foldOpen[key];
    document.querySelectorAll(`.forag[data-fold="${key}"]`).forEach(el => { el.classList.toggle('open', foldOpen[key]); el.querySelector('[data-fatoggle]')?.setAttribute('aria-expanded', String(foldOpen[key])); });
  }, true);
  // The tile was drawn as an agent app; the app may have gained its page since (ux#1646): decide at the tap.
  function openAppInfo(el, fromSheet) { AK.pageOrSheet(APP, el.dataset.appinfo, el.dataset.name || '', a => tapOpen(a, el, fromSheet)); }
  function renderEmpty(i) {
    // Miguel's app kinds are every skin's New desk (James, 23 Oct 2026): Apps with system apps first and ringed, then
    // Wizard apps, Agents and Connectors folded under "For agents".
    // Search apps (James, 23 Oct 2026): a pill at bottom centre, above the dock; typing filters every group in place
    // (For agents unfolds while a query is on), Enter opens the first match.
    appVars.tileN = 0; return `<div class="desk-scroll new-desk kinds"><div class="nd-head"><b>New desk</b><span>Pick an app to open here</span></div>${kindGroups(['apps', 'wiz', 'agents', 'conns'])}<p class="nd-none" hidden>No app matches</p></div><form class="nd-search" role="search" data-ndsearch><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" data-ndq placeholder="Search apps" aria-label="Search apps" autocomplete="off" enterkeyhint="go"></form>`;
  }
  /* frame: moved to app-frame.js (wizard-ux issue 1665), called once here */
  const { probeFrame, renderApp, renderFrame, selfPop, takeSelfPop, tameHistory, watchEarly } = window.WizCore.appParts.frame({ APP, esc, ico, winApp });
  // Closed means closed: an app with no window left on any desk stops its microphone (take saved for recovery).
  window.WizAppServices?.trackOpenApps?.(() => appVars.desks.flatMap(d => d.wins).map(id => appVars.W[id]).filter(Boolean).flatMap(w => [w.appId, w.servicesAs]));
  function watchFrames(root) {
    $$('[data-recovery]', root).forEach(el => window.WizReach.mountRecovery(el, appVars.W[el.closest('.win')?.dataset.win]?.url));
    $$('iframe.appframe', root).forEach(f => {
      // A sandboxed repair page (browser boundary) is never read: core/reach.js talks to it over the boundary channel.
      if (f.closest('[data-recovery]')) { if (!f._watched) { f._watched = true; f.addEventListener('load', () => { if (!f.hidden && !(window.WizBrowserBoundary?.owns(f) && f.hasAttribute('sandbox'))) bridgeFrame(f); }); } return; }
      if (f._watched) return; f._watched = true;
      // servicesAs: a companion view gets its owning installed app's Back/services.
      const w = appVars.W[f.closest('.win')?.dataset.win], a = w && APP[w.servicesAs || w.appId];
      if (a?.url) f._appDetach = window.WizAppServices?.attach(f, { appId: a.id, path: a.url, isFront: () => appVars.desks[appVars.idx].focus === w.id && appVars.desks[appVars.idx].wins.includes(w.id) && !appVars.sheet && !appVars.menuFor && !CHATS.isHosted(w.id) && !device.classList.contains('st-parked'), openThread: (sid, opts) => { const r = window.WosSkinHost?.routeOpen?.('thread', { sid, from: a.id }, () => { if (!CHATS.prepThread(sid, opts)) return false; closeSheets(true); openWizardThread(sid); return true; }); return r ? r.value === true : CHATS.openHosted(w.id, f, sid, opts); }, back: () => { if (appVars.desks[appVars.idx].focus !== w.id) return false; const did = backStep(w.id); if (did) { window.__backLog = (window.__backLog || []).concat('app-done:' + did).slice(-30); } return !!did; }, openContextDraft: (key, text) => { const go = () => { closeSheets(true); const cw = placeApp(mainChats, { app: 'chats', thread: null }, {}); if (!cw) throw new Error('Chats unavailable'); const receipt = CHATS.openContextDraft(cw.id, key, text); CHATS.renderChats(cw); return receipt; }; const r = window.WosSkinHost?.routeOpen?.('draft', { from: a.id }, go); if (r) { if (!r.value) throw new Error('Chats unavailable'); return r.value; } return go(); }, isVisible: () => appVars.desks[appVars.idx].wins.includes(w.id) && (!appVars.desks[appVars.idx].full || appVars.desks[appVars.idx].focus === w.id) && !appVars.sheet && !appVars.menuFor && !CHATS.isHosted(w.id) });
      watchEarly(f);
      const wrap = f.closest('.frame-wrap');
      if (f.dataset.probe) { wrap.classList.remove('loading'); wrap.classList.add('coming'); f.removeAttribute('src'); probeFrame(f, f.dataset.probe); }
      // The loading veil lifts when the app's page has loaded (or after 12 s, so a slow app is never hidden for good).
      const unveil = () => wrap?.classList.remove('loading'); setTimeout(unveil, 12000);
      f.addEventListener('load', () => {
        let ok = false, why = '';
        try { if (f.contentWindow.location.href !== 'about:blank') unveil(); } catch (e) { unveil(); }
        try { const doc = f.contentDocument; why = doc ? doc.location.href : 'nodoc'; ok = !!doc && doc.location.href !== 'about:blank'; } catch (e) { ok = false; why = 'x:' + e.name; }
        window.__frameLog = (window.__frameLog || []).concat(why).slice(-40); // bounded: the shell may run for weeks
        // Browser boundary: a sandboxed app is never readable, so unreadable is not refused. It talks by postMessage.
        if (window.WizBrowserBoundary?.enabled && f.hasAttribute('sandbox')) { wrap?.classList.remove('blocked'); return; }
        if (why === 'about:blank') {
          // A frame that had a real page and is back on blank was traversed by the Back key (cross-document, so no
          // popstate fires). That press belongs to the shell: take the step and restore the app in place.
          if (f._lastUrl) { const u = f._lastUrl; f._lastUrl = ''; onBack(); ensureGuard(true); try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.replace(u); } catch (e) {} }
          return;
        }
        if (ok) { try { f._lastUrl = f.contentWindow.location.href; } catch (e) {} }
        wrap?.classList.toggle('blocked', !ok);
        if (ok) bridgeFrame(f);
        if (ok) { const sec = f.closest('.desk'); if (sec && sec.dataset.did !== appVars.desks[appVars.idx]?.id) frameSetHidden(f, true); } // opened or reloaded off-screen: park at once
        if (ok) { try { const id = f.closest('.win')?.dataset.win, w = appVars.W[id], t = (f.contentDocument.title || '').trim(); if (w && w.appId === 'link' && t && t !== w.title) { w.title = t.slice(0, 60); save(); applyLayout(deskOf(id)); renderDots(); } } catch (e) {} }
      });
    });
  }
  function bridgeFrame(f) {
    const id = f.closest('.win')?.dataset.win; if (!id) return;
    let win; try { win = f.contentWindow; } catch (e) { return; }
    try { if (appVars.LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(win, (appVars.W[id] && (APP[appVars.W[id].appId]?.url || appVars.W[id].url)) || win.location.pathname, appVars.LINKS); } catch (e) {}
    try { if (appVars.W[id]) { const here = win.location.pathname + win.location.search + (appVars.W[id].appId === 'troubleshooter' ? win.location.hash : ''); const want = APP[appVars.W[id].appId]?.url || '';
      // Remember only pages inside this app (never the placeholder "/" or where it redirects), or a frame
      // painted before its app was known would stick on the wrong page for good.
      const home = (want.split(/[?#]/)[0] || '').replace(/[^/]*$/, '');
      if (home && home !== '/' && here.startsWith(home)) { appVars.W[id].url = here; save(); } } } catch (e) {}
    try { win.document.addEventListener('pointerdown', () => { focusWin(id); armBack(); }, true); } catch (e) {}
    // Hosted-app history is tamed; Back never becomes permission to leave Wizard.
    tameHistory(win);
    // A hosted app may push its own Back guard at boot (same URL) before the shell can tame it. Popping such an
    // entry is the user pressing Back: the shell takes that step and the app never sees it. Popping a real in-app
    // navigation (the URL changes) stays the app's own back step.
    try { win.__wosHref = win.location.href; } catch (e) {}
    try { win.addEventListener('popstate', e => {
      if (!f.isConnected || !appVars.W[id] || f.contentWindow !== win) return; // a removed preview owns no shell navigation
      if (win.WizardApp?.hosted && e.state?.__wizardApp?.version === 1) { takeSelfPop(win); return; }
      if (Date.now() < appVars.dropUntil) { e.stopImmediatePropagation(); appVars.ignorePop = 0; appVars.dropUntil = 0; return; } // the shell's guard drop landed here
      // The app (or the shell on its behalf) stepped back through the app's own entry: the app's step.
      if (takeSelfPop(win)) { try { win.__wosHref = win.location.href; } catch (x) {} return; }
      let same = false; try { same = win.location.href === win.__wosHref; win.__wosHref = win.location.href; } catch (x) {}
      // The app keeps its own back step only when it is the focused window on the desk in view, nothing is
      // open over it, and the pop really changed its page. Anything else (an app on another desk, a boot-time
      // guard, a stray hash entry) is the user's Back for the shell, so a Back is never silently swallowed.
      const wid = f.closest('.win')?.dataset.win;
      const mine = !same && wid && appVars.desks[appVars.idx]?.focus === wid && appVars.desks[appVars.idx].wins.includes(wid) && !appVars.sheet && !appVars.menuFor && V.state === 'idle' && !document.querySelector('.peek.open, .ov.open');
      if (mine) return;
      e.stopImmediatePropagation();
      appVars.guardOn = history.state?.wos === 'guard'; // the shell's own guard is still under the popped app entry
      onBack();
      ensureGuard(true);
    }, true); } catch (e) {}
    try { FIELDS?.bind(win.document); } catch (e) {}
    try { bindWinPinch(win.document, id); } catch (e) {}
    try { armFrameBack(f, win); } catch (e) {} // another origin (Troubleshooter's direct line) can't be read
    shareCutout();
    frameEdge(f); setTimeout(() => { if (f.isConnected) frameEdge(f); }, 800); // apps that paint their theme after boot
  }
  // Frame metadata never grants voice delivery. Installed capability + shared receiver own it.
  function frameNav(id) { try { return winEl(id)?.querySelector('iframe')?.contentWindow?.navigation || null; } catch (e) { return null; } }
  function frameHref(id) { try { const l = winEl(id)?.querySelector('iframe')?.contentWindow?.location; return l ? l.pathname + l.search : ''; } catch (e) { return ''; } }

  // A Chats window: the one on this desk, else any desk's (and go there).
  function chatsWinAny() {
    let wid = appVars.desks[appVars.idx].wins.find(x => mainChats(appVars.W[x])); if (wid) return wid;
    const d = appVars.desks.findIndex(dd => dd.wins.some(x => mainChats(appVars.W[x]))); if (d < 0) return '';
    goDesk(d, true); return appVars.desks[d].wins.find(x => mainChats(appVars.W[x]));
  }
  /* Open a real thread: in a Chats window on this desk, else any Chats window, else a new one here. */
  function openWizardThread(id, opts = {}) {
    if (!id) return;
    // Any agent's thread opens in the main Chats window, without changing its list Focus.
    const mine = x => mainChats(appVars.W[x]);
    let wid = appVars.desks[appVars.idx].wins.find(mine);
    if (!wid) { const d = appVars.desks.findIndex(dd => dd.wins.some(mine)); if (d >= 0) { wid = appVars.desks[d].wins.find(mine); goDesk(d, true); } }
    if (!wid) { const w = openWin({ app: 'chats', thread: null }, opts); if (!w) return; wid = w.id; }
    focusWin(wid); openChat(wid, id);
  }

  /* ---------------- window interactions ---------------- */
  // Focus follows the finger. Double-tap a title bar toggles full screen.
  let lastBarTap = { id: '', t: 0 };
  track.addEventListener('pointerdown', e => {
    const we = e.target.closest('.win'); if (we) focusWin(we.dataset.win);
  }, true);
  function ndFilter(input) {
    const nd = input.closest('.glance')?.querySelector('.new-desk'); if (!nd) return null;
    // Names first ("Wiza" finds the Wizard apps, not every app whose blurb says Wizard); descriptions only when no name fits.
    const n = norm(input.value); let first = null;
    const tiles = [...nd.querySelectorAll('.lapp')].map(t => { const a = APP[t.dataset.app || t.dataset.appinfo], nm = norm(t.querySelector('.nm')?.textContent);
      return { t, nm, byName: nm.split(' ').some(w => w.startsWith(n)) || nm.startsWith(n), byDesc: norm(a?.desc).includes(n) || nm.includes(n) }; });
    const named = tiles.some(x => x.byName);
    for (const x of tiles) {
      const hit = !n || (named ? x.byName : x.byDesc); x.t.hidden = !hit;
      if (hit && n && (!first || (x.nm.startsWith(n) && !first.s))) first = { t: x.t, s: x.nm.startsWith(n) };
    }
    for (const g of nd.querySelectorAll('.lgroup')) g.hidden = !!n && !g.querySelector('.lapp:not([hidden])');
    for (const fa of nd.querySelectorAll('.forag')) { fa.classList.toggle('searching', !!n); fa.hidden = !!n && !fa.querySelector('.lapp:not([hidden])'); }
    nd.querySelector('.nd-none').hidden = !n || !!first;
    nd.classList.toggle('nd-q', !!n);
    return first?.t || null;
  }
  track.addEventListener('input', e => { if (e.target.matches?.('[data-ndq]')) ndFilter(e.target); });
  track.addEventListener('submit', e => {
    const f = e.target.closest?.('[data-ndsearch]'); if (!f) return;
    e.preventDefault(); const inp = f.querySelector('[data-ndq]'); const t = ndFilter(inp); if (!t) return;
    inp.blur(); t.click();
  });
  track.addEventListener('click', e => {
    const say = e.target.closest('[data-say]'); if (say) return runUtterance(say.dataset.say, 'auto');
    const sk = e.target.closest('.new-desk [data-storekind]'); if (sk) return openStoreKind(sk.dataset.storekind);
    const info = e.target.closest('.new-desk [data-appinfo]'); if (info) return openAppInfo(info);
    const pick = e.target.closest('.new-desk [data-app]');
    if (pick) { tapOpen(APP[pick.dataset.app], pick); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'inbox') return openSheet('inbox');
    if (act === 'settings') return openSettings(false);
    if (act === 'unsent') return openSettings(true);
    if (act === 'ready') return openApp(APP.wizard);
    if (act === 'unread' || act === 'working') return openChatsFiltered(act, { card: true });
    if (act === 'side-button') return sideButtonTap(false);
    if (act === 'agents') return openApp(APP.agents);
    if (act === 'side-button-hide') { store.set('sideHidden', true); return refreshHome(true); }
    const we = e.target.closest('.win'); if (!we) return;
    const id = we.dataset.win, w = appVars.W[id]; if (!w) return;
    const wa = e.target.closest('[data-wact]')?.dataset.wact;
    if (wa === 'close') return closeWin(id);
    if (wa === 'pin') return pinWin(id);
    if (wa === 'detach') return detachBound(id);
    if (wa === 'reload') return reloadWin(id);
    if (wa === 'full') { const d = appVars.desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }

    if (e.target.closest('.wbar')) {
      // Use the input timestamp, not handling time: a busy page (an app loading in
      // another tile) must not turn a quick double-tap into two single taps.
      const now = e.timeStamp || performance.now();
      if (lastBarTap.id === id && now - lastBarTap.t < 450) { lastBarTap = { id: '', t: 0 }; const d = appVars.desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }
      lastBarTap = { id, t: now }; return;
    }
    if ((w.app === 'chats' || CHATS.isHosted(id)) && CHATS.click(e, id)) return;
  });
  track.addEventListener('dblclick', e => {
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]')) return;
    const id = bar.closest('.win')?.dataset.win; if (!id || lastBarTap.t === -1) return;
    const d = appVars.desks[deskOf(id)]; if (!d) return;
    // The click handler may already have toggled on the second tap; only act if it did not.
    if (!(d.full && d.focus === id) && performance.now() - appVars.fullAt > 600) setFull(id, true);
  });
  CHATS.bind(track);

  /* Window actions live in the title bar; desk arrangement lives in the overview. */
  const menuEl = $('#wmenu');
  return { editUnsent, foldOpen, frameHref, frameNav, homeLate, menuEl, newDesk, onUnsentChange, openAppInfo, openFilesScreen, openSettings, openStoreKind, openWizardThread, orbUpDesks, orbUpVar, paintHome, refreshHome, renderApp, renderEmpty, renderFrame, renderHome, renderSettings, selfPop, unsentAction, watchFrames, bindLate: v => { if ('armBack' in v) armBack = v.armBack; if ('armFrameBack' in v) armFrameBack = v.armFrameBack; if ('backStep' in v) backStep = v.backStep; if ('bindWinPinch' in v) bindWinPinch = v.bindWinPinch; if ('ensureGuard' in v) ensureGuard = v.ensureGuard; if ('FIELDS' in v) FIELDS = v.FIELDS; if ('onBack' in v) onBack = v.onBack; if ('openSheet' in v) openSheet = v.openSheet; if ('reloadWin' in v) reloadWin = v.reloadWin; if ('renderInbox' in v) renderInbox = v.renderInbox; if ('renderMoons' in v) renderMoons = v.renderMoons; if ('toast' in v) toast = v.toast; if ('V' in v) V = v.V; } };
};
