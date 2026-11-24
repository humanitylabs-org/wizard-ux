/* Wizard UX desktop shell › the native bridge for Wizard for Mac, deep links, boot and workspace sync. Moved out of desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names desktop.js declares only further down are late-bound: desktop.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the window list W and the workspaces) stay in desktop.js;
 * this code reads and writes them as desktopVars.<name>, desktop.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before desktop.js. The body below keeps desktop.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.boot = function ({ $$, APP, appAt, appOf, APPS, ask, C, chanPost, CHATS, closeCurrent, closeDesktop, closePalette, closeSettings, closeWin, commandSnapshot, commandText, commandVoice, desktopBack, desktopHost, desktopVars, dictate, escapeBack, feedCarry, feedOpen, feedOpened, fields, findApp, findWin, focused, focusInside, focusWin, framePage, freshDesk, goHome, goWs, hudClose, hudDock, hudKey, hudOn, ico, keyHints, leaveHome, listW, listWin, LIVE, localCommand, log, mainChats, mainStd, MOD, moveDesk, moveWin, newChat, newDesktop, newWin, openAgentChats, openApp, openAppLink, openChatsList, openFiles, openPalette, openPicker, openSearch, openSettings, openThread, openUsage, orbTap, OUTBOX, pal, palToggle, paneClicks, panelAppW, panelBack, panelChat, panelClose, panelDock, panelKind, panelListW, panelMode, panelQuit, panelRunning, panelSlot, panelWin, panelWins, recordReply, render, save, setEl, setListW, sideMain, sideViewOn, stage, stepThread, syncChatsPane, talk, talkNew, toast, toggleKeys, uid, usageEl, viewContext, VOICE, winEl, winTitle }) {

  /* ---------------- native bridge (Wizard for Mac drives this by events) ---------------- */
  C.bridge.handle({
    orb: d => { const a = d.action || 'toggle'; return a === 'toggle' || a === 'start' ? orbTap(a) : talk(a); },
    open(path, d) {
      const sid = d.thread || (String(path).match(/[?&]session=([^&#]+)/) || [])[1];
      if (sid) return openThread(decodeURIComponent(sid));
      if (/^\/?apps\/?$/.test(path) || /^\/?search\/?$/.test(path)) return openPalette();
      if (/^\/?inbox\/?$/.test(path)) return openChatsList();
      if (d.app) return openApp(APP[d.app] || findApp(d.app));
      if (/^\/wizard\/?(\?.*)?$/.test(path)) return openApp(APP.wizard);
      const base = String(path).replace(/[#?].*$/, '');
      const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === base);
      if (a) return openApp(a);
      if (path && path.startsWith('/')) newWin({ app: 'frame', url: path, title: path });
    },
    dictation(text) {
      const fields = desktopVars.dictationFields || (desktopVars.dictationFields = window.WizCore.focusedField.create({
        frames: () => $$('iframe', stage).filter(f => { const w = desktopVars.W[f.closest('[data-win]')?.dataset.win]; return !!APP[w?.appId]; }),
        admit: (c, el) => { const win = c.frame?.closest('[data-win]') || el.closest('[data-win]'); return (!win || win.dataset.win === desktopVars.ws[desktopVars.cur].focus) && !!el.getClientRects().length; },
      }));
      const target = fields.capture();
      if (target) { fields.insert(target, text); target.release(); return; }
      const f = focused();
      if (f?.app === 'chats' && f.thread && CHATS.insertText(f.id, text)) return;
      if (f?.app === 'chats') { newChat(); setTimeout(() => CHATS.insertText(focused().id, text), 60); return; }
    },
    back() { const did = desktopBack(); log('native-back:' + (did || 'root')); },
  });

  /* ---------------- deep links + boot ---------------- */
  render();
  /* Workspace sync (core/workspace-sync.js): the same desktops on every device; layout and full screen stay here. */
  window.WosWorkspaceSync?.create({
    shell: 'desktop',
    title: w => appOf(w)?.name || w.title || w.appId,
    read: () => ({ desks: desktopVars.ws.map(d => ({ id: d.id, wins: d.wins.map(id => desktopVars.W[id]).filter(Boolean) })) }),
    apply(state, o = {}) {
      if (!state) { const i = desktopVars.ws.findIndex(d => d.id === o.focus); if (i >= 0) { closeSettings(); goWs(i); } return; }
      const here = desktopVars.ws[desktopVars.cur]?.id, at = desktopVars.cur;
      const r = window.WosWorkspaceSync.reconcile(desktopVars.ws, desktopVars.W, state, { fresh: id => ({ ...freshDesk(), id }) });
      r.removed.forEach(id => { desktopVars.boundManager?.dismiss(desktopVars.W[id]); if (desktopVars.W[id]?.app === 'chats') CHATS.saveDraft(id); delete desktopVars.W[id]; CHATS.forget(id); });
      desktopVars.ws = r.desks.length ? r.desks : [freshDesk()];
      desktopVars.ws.forEach(d => { d.mono = !!d.mono && d.wins.length > 0; });
      desktopVars.cur = desktopVars.ws.findIndex(d => d.id === here); if (desktopVars.cur < 0) desktopVars.cur = Math.max(0, Math.min(at, desktopVars.ws.length - 1));
      save(); render();
    },
  });
  // In-app browser (core/links.js): links tapped in Wizard open in a right-half pane.
  const LINKS = window.WizLinks ? window.WizLinks.mount({
    readerApp: () => APP.browser,
    parent: document.body, mode: 'pane',
    onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a, { fresh: false }); else { const o = appAt(url); newWin({ app: 'frame', url, title: o ? o.name : title, ...(o ? { appId: o.id } : {}) }); } },
    // A page preview opens as a window like any other (wizard-os#265 rule 7): ✕, ⌥W and Esc close it, Keep is not needed.
    asWindow: (url, title) => { const o = appAt(url), go = desk => { newWin({ app: 'frame', url, title: o ? o.name : title, preview: true, ...(o ? { appId: o.id } : {}) }, Number.isInteger(desk) && desktopVars.ws[desk] ? { ws: desk } : {}); return true; };
      return window.WosSkinHost?.routeOpen?.('link', { url, title: String(title || ''), app: o ? o.id : '' }, go) ? true : go(); },   // a layout placing opens: its panel
  }) : null;
  /* Links into installed apps and deep links on start: moved verbatim to desktop/desktop-links.js (issue 1665). */
  window.WizCore.desktopParts.links({ APP, appAt, C, CHATS, closeSettings, commandSnapshot, findApp, findWin, focused, goHome, LINKS, LIVE, localCommand, MOD, newChat, newWin, openAgentChats, openApp, openAppLink, openPicker, openSettings, openThread, syncChatsPane, toast, toggleKeys, winEl });
  window.WosScenery?.attach({ device: document.body, homeInView: () => (desktopVars.homeOpen || !desktopVars.ws[desktopVars.cur].wins.length) && setEl.hidden && pal.hidden && !keyHints.pinned() && usageEl.hidden && !window.WosResources?.state?.panel });
  new MutationObserver(() => window.WosScenery?.update()).observe(stage, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
  C.status?.attach({ openChats: openChatsList, current: () => { const f = focused(); return f?.app === 'chats' && f.thread !== '__new__' ? f.thread || '' : ''; } });

  /* "Update ready" pill in the top bar: the same banner as the phone (core/web-update.js), names the thread that made the
   * update with a Thread button that opens it in a window here; Reload is held while recording or uploading. */
  window.WizWebUpdate?.init({
    // Desktop applies a pending interface update by itself once the window is hidden or quiet (core/web-update.js).
    shell: 'desktop', autoApply: true, log: (...a) => { window.__wuxLog = (window.__wuxLog || []).concat(a.join(' ')).slice(-80); },
    mount: () => document.querySelector('#bar .bar-r') || document.body, prepend: true,
    openThread: sid => openThread(sid),
    busy: () => window.WizShareWizard?.busy || ((desktopVars.dictationFinishing || VOICE.state !== 'idle') && !(desktopVars.vHandedOff && !['listen', 'paused'].includes(VOICE.state) && OUTBOX.handedOff?.(desktopVars.vHandedOff))) || Object.values(desktopVars.W).some(win => (CHATS.ch(win.id)?.files || []).some(f => f.uploading)),
    beforeReload: () => { for (const el of document.querySelectorAll('[data-compose]')) el.dispatchEvent(new Event('input', { bubbles: true })); },
    toast,
  });
  fields();
  window.__wux = {
    get links() { return LINKS; },
    shell: 'desktop', get ws() { return desktopVars.ws; }, get voiceState() { return VOICE.state; },
 get wins() { return desktopVars.W; }, get cur() { return desktopVars.cur; }, live: LIVE, outbox: OUTBOX, chats: CHATS, canSearch: () => !!APP['wizard-search'],
    get homeOpen() { return desktopVars.homeOpen; }, goHome, get palMode() { return pal.hidden ? '' : desktopVars.palMode; },
    goWs, newDesktop, closeDesktop, closeCurrent, newWin, closeWin, focusWin, moveWin, openApp, openThread, newChat, openPalette, closePalette, openPicker, openChatsList, talk, ask, escStep: desktopBack, viewContext,
    openFiles, openUsage, recordReply, openSearch, localCommand, commandText, commandVoice, dictate, toast,
    pauseVoice: () => VOICE.state === 'paused' ? VOICE.resume() : VOICE.pause(),
    openSettings, closeSettings, stepThread, setListW, get listW() { return listW(); },
    get hud() { return desktopVars.hud ? { ...desktopVars.hud } : null; }, hudOn, hudDock, hudClose, hudKey,
    get voice() { return VOICE.state; }, get log() { return window.__wuxLog || []; },
  };
  /* Skin packages (core/skin-host.js) on desktop: the same narrow adapter the phone shell hands over, so a skin
   * declared when: 'always' runs its script here too. James's skins declare no package and load nothing. */
  const skinChatsWin = () => { const f = focused(); return f && f.app === 'chats' ? f : ((globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(x => x && x.app === 'chats') || null); };
  function skinShowChats() {
    const on = () => desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id]).find(mainChats) || null;
    const at = desktopVars.ws.findIndex(d => d.wins.some(x => mainChats(desktopVars.W[x])));
    if (at >= 0) goWs(at);
    else if (desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.ws.push(freshDesk()); openApp(APP.wizard, { ws: desktopVars.ws.length - 1 }); goWs(desktopVars.ws.length - 1); }
    else { if (desktopVars.homeOpen) leaveHome(); openApp(APP.wizard); }
    const w = on(); if (w) focusWin(w.id); return w;
  }
  window.WosSkinHost?.attach({
    route() { const w = desktopVars.homeOpen && !panelWin() ? null : skinChatsWin(); return { view: w ? (w.thread ? 'thread' : 'list') : 'desk', thread: w?.thread || null, desk: desktopVars.cur, home: desktopVars.homeOpen || !desktopVars.ws[desktopVars.cur].wins.length, panel: panelKind(panelChat() || panelAppW()), panelList: !!panelListW(), panelApp: panelAppW()?.appId || (panelAppW() ? panelAppW().app : null) }; },
    // No desks (core/skin-host.js api.panel): everything opens in one panel on the right over Home.
    panelMode: on => panelMode(!!on),
    panelClose: () => panelClose(),
    panelDock: on => panelDock(!!on),
    panelBack: () => panelBack(),
    // Kept running (api.panel.park): closing an app hides it; quit really closes it; running lists both.
    panelPark: on => { if (!globalThis.WosSkinHost?.panelMode) return false; desktopVars.panelParks = !!on; return true; },
    panelQuit: id => panelQuit(id),
    panelRunning: () => panelRunning(),
    // Which panel to close: 'chat' (the column beside the list) or 'app' (the right third, kept running when parked).
    panelCloseKind: kind => { const w = kind === 'app' ? panelAppW() : kind === 'chat' ? panelChat() : null; return w ? panelClose({ id: w.id }) : false; },
    // Geometry is the panels' resting place (offsets ignore their slide-in transform), in stage pixels.
    panelState: () => { const c = panelChat(), p = panelAppW(), l = panelListW(), w = c || p; if (!w && !l) return null; const el = w && winEl(w.id), le = l && winEl(l.id), ce = c && winEl(c.id), pe = p && winEl(p.id);
      return { kind: panelKind(w) || null, title: w ? winTitle(w) : '', width: el ? Math.max(0, Math.round(stage.clientWidth - el.offsetLeft)) : 0, back: panelSlot(w?.id)?.back.length || 0,
        list: l ? { width: le ? Math.max(0, Math.round(le.offsetLeft + le.offsetWidth)) : 0 } : null,
        chat: c ? { kind: panelKind(c), left: ce ? Math.round(ce.offsetLeft) : 0, right: ce ? Math.round(ce.offsetLeft + ce.offsetWidth) : 0 } : null,
        app: p ? { id: p.appId || p.app, title: winTitle(p), left: pe ? Math.round(pe.offsetLeft) : 0, right: pe ? Math.round(pe.offsetLeft + pe.offsetWidth) : 0 } : null }; },
    // Layouts (core/skin-host.js shellApi): mount on the stage, the orb's voice, Working / Ready rows with Chats' own
    // actions, the owner's quick apps (Home's app chips), Home and Settings.
    mountHost: () => stage,
    voiceState: () => ({ state: VOICE.state, command: !!desktopVars.commandTake, mode: desktopVars.vMode }),
    recordReply: (wid, sid) => {
      // Layouts may name only a genuine Chats composer, never an app's thread-like metadata.
      const w = desktopVars.W[wid];
      if (!w || !(w.app === 'chats' || CHATS.isHosted(wid)) || w.thread !== sid) return 'busy';
      return recordReply(wid, sid);
    },
    // Only an open Chats thread changes the ordinary orb's idle action: talk() pins
    // its reply target before capture. Lists, New chat, Home and other apps retain
    // the general new-chat action; an in-flight take retains its stop-only action.
    talk: () => { if (VOICE.state !== 'idle') return talk('send'); const f = focused(); return (f?.app === 'chats' || CHATS.isHosted(f?.id)) && f?.thread && f.thread !== '__new__' ? talk() : talkNew('Click the orb'); },
    voiceTap: () => talk('send'),
    voiceCancel: () => desktopVars.vMode === 'dictate' ? dictate('cancel') : talk('cancel'),
    command: () => commandVoice(),
    // An unmatched command's words, sent on as a new chat (the launcher's own ask path; the layout says so itself).
    askAgent: text => { void ask(text, 'an orb command with no local match, sent on as a message', null, null, true); return true; },
    agentHere: () => ({ id: '', label: window.WizConfig.agent(), main: true }),
    // Activity with Channels on (wizard-ux issue 1336): every agent's chats as Working, Ready, Recent, Snoozed, Archived.
    activityList: (o = {}) => window.WizChatsListModel.activityList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }, { order: o.order, older: !!o.older, now: Date.now() }),
    /* Working / Ready rows (the rest too, for the AI apps view's search), each with the actions Chats' own row offers
     * (Pin, Rename, Mark unread, Snooze, Done, Restore), acted on through Chats' own paths; the Orb view reads the same. */
    sessionList: () => window.WizChatsListModel.sessionList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }),
    // The thread's own actions (Chats threadAct: the snooze tweak's interception, toasts, optimistic list); Pin = the Pins
    // toggle; Rename = Chats' rename sheet, over the chat.
    sessionAct: (sid, act) => {
      // Move to channel… (wizard-ux issue 1292): Chats' own picker over the page, on the main Chats window (or the
      // sidebar's stand-in when there is none); nothing navigates, so the Activity row stays where it is.
      if (act === 'move') return !!CHATS.moveToChannel?.((findWin(mainChats) || sideMain())?.id, sid);
      if (act !== 'pin' && act !== 'rename') { const w = findWin(mainChats); CHATS.threadAct(w?.id || '', sid, act); return true; }
      if (act === 'pin') { const P = window.WosChatPins; if (!P) return false; const on = P.toggle(sid); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
      const w = skinShowChats(); if (!w) return false; CHATS.openRenameSheet(w.id, sid); return true;
    },
    // The AI apps sidebar's agent choices: the same agents and Focus the Classic Chats strip uses (setFocus / winAgent).
    // Picking one goes through openAgentChats (Chats' Focus on the main window); All clears that Focus.
    agentFocus: () => {
      const AG = window.WosAgents, w = findWin(mainChats);
      return { id: w ? CHATS.focusAgentId(w) : '', space: !!w && CHATS.focusOf(w)?.kind === 'space', agents: (AG?.visible?.() || []).map(a => ({ id: a.id, label: a.is_default ? (window.WizConfig.agent() || a.label || a.id) : (a.label || a.id), colour: AG.colour(a), private: a.privacy === 'private', main: !!a.is_default, status: a.status || '' })) };
    },
    agentFocusSet: id => { if (id) { void openAgentChats(id); return true; } const w = findWin(mainChats); return !!w && CHATS.setFocus(w, null); },
    // The same rows the AI apps sidebar draws, narrowed to what the main Chats' Focus shows (one agent's chats): Chats' own rule.
    sessionListFocused: () => window.WizChatsListModel.sessionList(LIVE?.ok ? LIVE.workGroups(CHATS.focusRows(findWin(mainChats))) : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }),
    // The AI apps view's main screen: the Chats desk in front as it is (its thread kept; opened if there is none), and
    // a New chat in it.
    showChats: () => !!skinShowChats(),
    newChat: () => { const w = skinShowChats(); if (!w) return false; newChat(); return true; },
    /* The AI apps sidebar's Channels pane (wizard-ux issue 1256): the main Chats window's own list
     * drawn into the layout's node as id::side (tabs, channels, a feed and its box; empty with the switch off). Its
     * clicks go through Chats' own handler; a post opens in the main Chats window like a sidebar row. */
    chatChannels: host => {
      if (!host || host.nodeType !== 1 || !stage.contains(host)) { host?.replaceChildren?.(); return false; }
      const w = sideMain(), id = w.id + '::side', fresh = host.dataset.chats !== id; desktopVars.sideHost = host;
      if (fresh) host.dataset.chats = id;   // a new window behind it (the stand-in handed over): painted at once
      if (w.chan) feedCarry(w);
      paneClicks(host);
      if (fresh || !host.contains(document.activeElement) || !host.firstElementChild) CHATS.renderChatList(listWin(w.id, 'side'), host);
      return !!host.firstElementChild;
    },
    /* The channel's feed in the AI apps main chat column (wizard-ux issue 1256, James 11 Nov 2026): the open channel's
     * header, Open / Needs you / All, its posts and its message box, drawn into the layout's node as feedBase's id::side
     * window. A post opens its thread in the main Chats window (the column), and Back there returns to this feed.
     * Returns the open channel ({ id, name }) or null (nothing open, or the switch off: the node is emptied). */
    chatFeed: host => {
      if (!host || host.nodeType !== 1 || !stage.contains(host)) { host?.replaceChildren?.(); return null; }
      const open = feedOpen(); if (!open) { if (host.firstElementChild) host.replaceChildren(); return null; }
      const id = desktopVars.feedBase.id + '::side', fresh = host.dataset.chats !== id; desktopVars.feedHost = host;
      if (fresh) host.dataset.chats = id;
      paneClicks(host);
      if (fresh || !host.contains(document.activeElement) || !host.firstElementChild) CHATS.renderChatList(listWin(desktopVars.feedBase.id, 'side'), host);
      return { id: open.id, name: open.name };
    },
    chatFeedOpen: () => { const o = feedOpen(); return o ? { id: o.id, name: o.name } : null; },
    /* The AI apps sidebar's list by the owner's Default Chats (wizard-ux issue 1443, switch wizard/sidebar-chats-view):
     * that installed provider mounted into the layout's node as a list region. False (node emptied) with the switch off,
     * built-in Chats picked, or the provider failed: the layout then draws its own rows. */
    chatsView: host => {
      const look = mainStd();
      if (look !== desktopVars.viewLook) { desktopVars.viewLook = look; for (const w of Object.values(desktopVars.W)) if (w.app === 'chats' && !w.agent) CHATS.renderChats(w); } // the main column: standard again, or its look back
      const id = sideViewOn() ? CHATS.views.defaultId() : 'wizard-chats';
      if (!host || host.nodeType !== 1 || !stage.contains(host) || id === 'wizard-chats' || !CHATS.views.usable?.(id)) {
        if (desktopVars.viewBase) { CHATS.forget(desktopVars.viewBase.id + '::side'); desktopVars.viewBase = null; }
        if (host?.dataset?.chats) { delete host.dataset.chats; host.replaceChildren?.(); }
        return false;
      }
      if (desktopVars.viewBase && desktopVars.viewBase.chatsProvider !== id) { CHATS.forget(desktopVars.viewBase.id + '::side'); desktopVars.viewBase = null; }
      if (!desktopVars.viewBase) desktopVars.viewBase = { id: 'cview-' + uid(), app: 'chats', thread: null, chatsProvider: id };
      const key = desktopVars.viewBase.id + '::side';
      host.dataset.chats = key;
      // (paint: Chats draws nothing here while the provider loads; after a failure it says so and the layout's own rows return)
      CHATS.views.mount(listWin(desktopVars.viewBase.id, 'side'), host, () => { host.replaceChildren(); if (!CHATS.views.usable?.(id) || CHATS.views.defaultId() !== id) queueMicrotask(() => { try { globalThis.dispatchEvent(new CustomEvent('wos:chats-view')); } catch (_) {} }); });
      return CHATS.views.usable(id);
    },
    // Back: the main column's feed closes first; then (a feed the earlier design left in the sidebar) the sidebar's own.
    chatChannelPost: () => chanPost(),
    chatChannelView: () => CHATS.chanView?.() || '',
    chatChannelBack: () => {
      if (desktopVars.feedBase && feedOpen()) { const ok = !!CHATS.channelBack(listWin(desktopVars.feedBase.id, 'side')); if (ok) feedOpened(desktopVars.feedBase.id + '::side'); return ok; }
      const w = desktopVars.sideBase || findWin(mainChats) ? sideMain() : null; return !!w && !!CHATS.channelBack(listWin(w.id, 'side'));
    },
    // The picker's Apps (no agents, connectors or test copies): the owner's quick apps first, then by name, system apps last.
    apps: () => { const AK = window.WosAppKinds, quick = window.WizLauncher?.get('desktopQuick') || [], rank = a => quick.includes(a.id) ? quick.indexOf(a.id) : AK?.isSystem?.(a) ? 2000 : 1000;
      return (AK ? AK.kinds(APPS, APP).apps : APPS.filter(a => a.url && !a.agent)).slice().sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name)).map(a => ({ id: a.id, name: a.name, icon: ico('span', 'ic', a), system: !!AK?.isSystem?.(a), dev: !!AK?.inDev?.(a), connector: !!AK?.isConnector?.(a), agent: !!a.agent || a.kind === 'chats' })); },
    openApp: id => desktopHost.openApp(id),
    // The Orb and Apps views' app sheet: every app by kind (core/app-kinds.js rows) and opening any of them
    appKinds: () => window.WosAppKinds?.rows ? window.WosAppKinds.rows(APPS, APP, a => ico('span', 'ic', a)) : null,
    openAnyApp: (id, open) => !!window.WosAppKinds?.openRow?.(APPS, APP, id, globalThis.WosSkinHost?.panelMode ? x => openApp(APP[x]) !== false : open),   // the Orb: in its panel
    // The Apps view: one entry per desk (the app in front on it; a Chats desk is 'wizard'), and opening an app on a desk
    // of its own (the current desk when it is empty, else a fresh one), never tiled beside another app.
    deskApps: () => desktopVars.ws.map((d, i) => { const w = d.wins.length ? desktopVars.W[d.focus] || desktopVars.W[d.wins[0]] : null; if (!w) return null; const a = appOf(w); return { desk: i, id: w.app === 'chats' && !w.agent ? 'wizard' : w.appId || a?.id || w.app || '', name: w.app === 'chats' && !w.agent ? 'Chats' : a?.name || winTitle(w) }; }).filter(Boolean),
    openAppDesk: (id, place = null) => { const a = APP[id]; if (!a) return false; const at = desktopVars.ws.findIndex(d => d.wins.some(x => desktopVars.W[x] && (id === 'wizard' ? desktopVars.W[x].app === 'chats' && !desktopVars.W[x].agent : desktopVars.W[x].appId === id))); if (at >= 0) { goWs(at); return true; }
      if (desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.ws.push(freshDesk()); const desk = desktopVars.ws.length - 1; return (place ? place(desk) : openApp(a, { ws: desk })) !== false; } return (place ? place(desktopVars.cur) : openApp(a)) !== false; },
    // A layout placing the shell's opens (apps.routeOpens): the app's window (the one in front first) at one of its own
    // pages, and one link page no app owns on a desk of its own, reused and taken to the next link (never a second).
    showAppPath: (id, path) => { let u; try { u = new URL(path, location.href); } catch (_) { return false; } const rel = u.pathname + u.search + u.hash;
      if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
      const mine = x => x?.app === 'frame' && x.appId === id, w = mine(desktopVars.W[desktopVars.ws[desktopVars.cur].focus]) ? desktopVars.W[desktopVars.ws[desktopVars.cur].focus] : desktopVars.ws[desktopVars.cur].wins.map(x => desktopVars.W[x]).find(mine) || findWin(mine); if (!w) return false;
      return framePage(w, rel); },
    openLinkDesk: (url, title) => { let u; try { u = new URL(url, location.href); } catch (_) { return false; } if (u.origin !== location.origin) return false; const rel = u.pathname + u.search + u.hash;
      const at = desktopVars.ws.findIndex(d => d.wins.some(x => desktopVars.W[x]?.app === 'frame' && desktopVars.W[x].appId === 'link'));
      if (at >= 0) { const w = desktopVars.W[desktopVars.ws[at].wins.find(x => desktopVars.W[x]?.app === 'frame' && desktopVars.W[x].appId === 'link')]; if (title) w.title = title; goWs(at); framePage(w, rel); return true; }
      const obj = { app: 'frame', appId: 'link', url: rel, title: title || u.pathname.split('/').filter(Boolean).pop() || 'Page' };
      if (desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.ws.push(freshDesk()); newWin(obj, { ws: desktopVars.ws.length - 1 }); return true; } newWin(obj); return true; },
    // The Orb and Apps views' app sheet: close an app (its desks; the Orb panel quits it), and an App Store page on a
    // desk of its own (the Store window opened before goes; the page's Get opens the app right after it installs).
    // The AI apps view's tab strip: a tab's ✕ = the stock close of that desk (round 13)
    closeDesk: i => Number.isInteger(i) && i >= 0 && i < desktopVars.ws.length ? closeDesktop(i) : false,
    // the stock arrange (a desk dragged along the bar, ⌥⇧[ / ⌥⇧]): the AI apps view's right column reorders the desks
    moveDesk: (from, to) => Number.isInteger(from) && Number.isInteger(to) ? moveDesk(from, to) : false,
    closeApp: id => { if (globalThis.WosSkinHost?.panelMode) return panelQuit(id); const home = desktopVars.homeOpen; let n = 0; for (let i = desktopVars.ws.length - 1; i >= 0; i--) if (desktopVars.ws[i].wins.some(x => desktopVars.W[x]?.appId === id) && closeDesktop(i)) n++; if (home && !desktopVars.homeOpen) goHome(); return n > 0; },   // closed from Home (the + sheet): stay Home
    openStore: id => { const S = APP['app-store']; if (!S?.url) return false; Object.keys(desktopVars.W).filter(x => desktopVars.W[x]?.appId === 'app-store').forEach(x => closeWin(x));
      const u = new URL(S.url, location.origin); u.searchParams.set('app', id); u.searchParams.set('open', '1'); const obj = { app: 'frame', appId: 'app-store', url: u.pathname + u.search };
      if (!globalThis.WosSkinHost?.panelMode && desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.ws.push(freshDesk()); newWin(obj, { ws: desktopVars.ws.length - 1 }); goWs(desktopVars.ws.length - 1); return true; } newWin(obj); return true; },
    openPicker: () => openPicker(),
    openPalette: () => palToggle('all'),   // ⌥Space / ⌘K search & launch
    home: () => goHome(),
    back: () => !!desktopBack(),
    escapeOverlay: close => escapeBack.push(close),
    appBack(id) {
      const w = Object.values(desktopVars.W).find(w => w.app === 'frame' && w.appId === id && winEl(w.id)?.getClientRects().length);
      if (!w) return false;
      window.WizAppServices?.back(winEl(w.id)?.querySelector('iframe'));
      return true; // atRoot/notReady never means close the app
    },
    layoutRecovery(on) {
      // Reuse the real Chats window, list renderer, delegates and live updates.
      // This is a minimal sidebar, not a switch to the Classic desktop. No
      // workspace, Look, thread, draft or layout choice is rewritten here.
      const root = document.documentElement;
      for (const el of document.querySelectorAll('[data-layout-recovery-chat]')) delete el.dataset.layoutRecoveryChat;
      if (!on) { delete root.dataset.layoutRecovery; return; }
      root.dataset.layoutRecovery = 'chats';
      let w = findWin(mainChats);
      if (!w) w = newWin({ app: 'chats', thread: null });
      if (!w) return;
      focusWin(w.id);
      const el = winEl(w.id); if (!el) return;
      el.dataset.layoutRecoveryChat = '';
      CHATS.renderChatList(listWin(w.id), el.querySelector(`[data-chats="${w.id}::list"]`));
      if (w.thread) CHATS.renderChats(w);
      syncChatsPane(w.id);
    },
    ownsChatList(on) {
      if (desktopVars.ownsChatList === !!on) return;
      desktopVars.ownsChatList = !!on;
      for (const w of Object.values(desktopVars.W)) if (w.app === 'chats') {
        const el = winEl(w.id); if (!el) continue;
        CHATS.renderChatList(listWin(w.id), el.querySelector(`[data-chats="${w.id}::list"]`));
        if (!w.thread) CHATS.renderChats(w);
        syncChatsPane(w.id);
      }
    },
    openList: () => { const w = skinChatsWin(); if (w) { CHATS.openChat(w.id, null); syncChatsPane(w.id); } },
    openThread: id => openThread(id),
    goDesk: i => goWs(i),
    sessions: () => { const G = LIVE?.ok ? LIVE.workGroups() : null; return G ? { working: (G.working || []).length, ready: C.workspaceNav.chatsCount(LIVE) } : null; },   // ready = unread, as the Ready pill
    openSessions: kind => { openApp(APP.wizard); const w = (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(x => x?.app === 'chats' && !x.agent); if (w) { if (kind === 'working') CHATS.setFilter(w, 'working'); else { if (w.thread) { CHATS.chatsBack(w); syncChatsPane(w.id); } CHATS.setFilter(w, ''); } } },  // Ready = the whole list, out of any open thread
    newThread: () => { const w = skinChatsWin(); if (w) CHATS.openChat(w.id, '__new__'); },
    openSettings: page => openSettings(page),
    // Inbox tweak: answer a notification in this Chats window (the Notifications Reply path); words send it at once.
    // Resolve this on the notification this window already shows sends in place: re-opening it hopped the window through
    // its list, and the AI apps layout then laid the chat out full width under the app panel (James, 6 Nov 2026).
    contextDraft: (key, item, words, draft) => { let w = desktopVars.homeOpen ? null : skinChatsWin(); if (!w) { openChatsList(); w = skinChatsWin(); } if (!w) return false; focusWin(w.id); const inPlace = !!words && !draft && String(key).startsWith('notifications:') && CHATS.notifOpen?.(w.id) === String(key).slice(14); if (!inPlace) { CHATS.openContextDraft(w.id, key, item, draft); CHATS.renderChats(w); syncChatsPane(w.id); } if (words) CHATS.sendChat(w.id, words, 'tapping Resolve this on a notification in Chats'); else setTimeout(() => focusInside(w.id), 30); return true; },
    models: () => { const w = skinChatsWin(); return w ? CHATS.tweakModels(w.id) : []; },
    model: (choice, alive) => { const w = skinChatsWin(); return w ? CHATS.tweakModel(w.id, choice, alive) : null; },
    deskCount: () => desktopVars.ws.length,
    root() { const w = skinChatsWin(); return w ? document.querySelector(`[data-chats="${w.id}"]`) : null; },
    dock: () => null,
    locked: () => false,
    toast: text => toast('◇', text, 2400),
    // Now playing (api.media): an app's own name and mark, and bringing that app to the front.
    mediaApp: id => { const a = APP[id]; return a ? { name: a.name || id, icon: ico('span', 'np-ic', a) } : null; },
    mediaOpen: id => !!window.WizOpenApp?.(id),
  });
  return { LINKS };
};
