/* Wizard UX phone shell › who the agent orb talks to, and the app window in front. Moved out of app.js
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
window.WizCore.appParts.agentorb = function ({ $, agentInfo, APP, appAt, APPS, appVars, backStep, cancelVoice, CHATS, CHATS_APP, closeDesk, closeWin, deskOf, device, esc, FIELDS, framePage, goDesk, HOME, ico, LIVE, mainChats, openAgentChats, openApp, openChatsFiltered, openChatsList, openSettings, openWin, openWizardThread, orbTapBusy, orbWrap, overviewAdapter, phoneBack, secOf, showChats, startVoice, syncImmersive, toast, track, V, winApp, windowRefreshAdapter }) {
  /* Who the agent orb sends to, from what is in front: an agent's Chats, a thread that belongs to an agent,
   * an app bound to an agent (Agents › app bindings), else the main agent. */
  function agentHere() {
    const AG = window.WosAgents, def = AG?.defaultId() || 'hermes';
    const f = appVars.desks[appVars.idx]?.focus, w = f && appVars.W[f];
    let id = '', why = 'main', app = '';
    if (w && w.app === 'chats' && (!w.thread || w.thread === '__new__') && CHATS.winAgent(w)) { id = CHATS.winAgent(w); why = 'chats'; }
    else if (w && (w.app === 'chats' || CHATS.isHosted(f)) && w.thread && AG?.isOther(LIVE?.agentOf?.(w.thread))) { id = LIVE.agentOf(w.thread); why = 'thread'; }
    else if (w?.appId) {
      const b = AG?.binding?.(w.appId);
      if (b?.agent && AG.isOther(b.agent) && AG.get(b.agent)) { id = b.agent; why = 'app'; app = APP[w.appId]?.name || w.appId; }
    }
    const a = AG?.get(id || def) || { id: id || def, label: window.WizConfig?.agent() || 'Hermes', is_default: !id, appearance: {} };
    return { ...agentInfo(a), why, app };
  }
  /* The agent orb's tap / pick. No pick = the screen's own destination (the classic tap). */
  function talkTo(id) {
    if (V.state !== 'idle') return orbTapBusy();
    const AG = window.WosAgents, here = agentHere();
    const target = id || here.id;
    if (target === here.id && here.why !== 'app') return startVoice('auto');
    if (!AG?.isOther(target)) return startVoice('general');
    return startVoice('general', { agent: target });
  }
  const skinChatsWin = () => { const f = appVars.desks[appVars.idx]?.focus; if (appVars.W[f]?.app === 'chats') return appVars.W[f]; const id = appVars.desks[appVars.idx]?.wins.find(x => appVars.W[x]?.app === 'chats'); return id ? appVars.W[id] : null; };
  window.WosSkinHost?.attach({
    overview: overviewAdapter,
    windowRefresh: windowRefreshAdapter,
    route() { const w = skinChatsWin(), f = appVars.W[appVars.desks[appVars.idx]?.focus]; let ag = ''; try { ag = agentHere().id; } catch (_) {} return { view: w ? (w.thread ? 'thread' : 'list') : 'desk', thread: w?.thread || null, desk: appVars.idx, app: f ? (f.appId || f.app || null) : null, agent: ag || null, beside: device.classList.contains('bound-peeking') ? 1 : device.classList.contains('bound-view-peeking') ? -1 : 0, home: appVars.idx === HOME }; },
    back: () => backStep(), escapeOverlay: close => phoneBack.push(close),
    openList: () => openChatsList(),
    openThread: id => openWizardThread(id),
    goDesk: i => goDesk(i),
    // Ready / Working counts as Home shows them, and the same lists their cards open (data.read.sessions).
    sessions: () => { const G = LIVE && LIVE.ok ? LIVE.workGroups() : null; return G ? { working: (G.working || []).length, ready: window.WizCore.workspaceNav.chatsCount(LIVE) } : null; },   // ready = unread, as Home's Ready card
    openSessions: kind => (kind === 'working' ? openChatsFiltered('working', { card: true }) : openChatsList()),  // Ready = the whole list, any old filter cleared
    newThread: () => { const w = skinChatsWin(); if (w) CHATS.openChat(w.id, '__new__'); },
    openSettings: page => openSettings(page),
    // Inbox tweak: answer a notification in this Chats window (the Notifications Reply path); words send it at once.
    contextDraft: (key, item, words, draft) => { let w = skinChatsWin(); if (!w) { openChatsList(); w = skinChatsWin(); } if (!w) return false; CHATS.openContextDraft(w.id, key, item, draft); CHATS.renderChats(w); if (words) CHATS.sendChat(w.id, words, 'tapping Resolve this on a notification in Chats'); return true; },
    models: () => { const w = skinChatsWin(); return w ? CHATS.tweakModels(w.id) : []; },
    model: (choice, alive) => { const w = skinChatsWin(); return w ? CHATS.tweakModel(w.id, choice, alive) : null; },
    deskCount: () => appVars.desks.length,
    root() { const w = skinChatsWin(); return w ? track.querySelector(`[data-chats="${w.id}"]`) : null; },
    dock: () => $('#dock'),
    locked: pointerId => !!(appVars.DS && appVars.DS.id === pointerId && appVars.DS.h),
    // Skin scripts pass plain text (file names, error messages): escaped, like the desktop toast.
    toast: text => toast('◇', esc(String(text ?? '')), 2400),
    // Layouts (two-orb): who the screen routes to, and the orb's recorder.
    agents: () => (window.WosAgents?.visible?.() || window.WosAgents?.list || []).map(agentInfo),
    agentHere: () => agentHere(),
    agentSigil: id => { const AG = window.WosAgents, a = AG?.get(id); return a ? AG.sigil(a, 'ag-sig') : ''; },
    openAgent: id => openAgentChats(id),
    voiceState: () => ({ state: V.state, kind: V.kind || '', agent: V.state === 'idle' ? '' : (V.snap?.route?.agent || V.snap?.view?.agent || (V.replyTo?.sid && LIVE?.agentOf?.(V.replyTo.sid)) || window.WosAgents?.defaultId() || '') }),
    talk: id => talkTo(id),
    voiceTap: () => (V.state === 'idle' ? talkTo('') : orbTapBusy()),
    dictate: () => { if (V.state !== 'idle' || !FIELDS?.refresh()) return false; startVoice('dictation'); return true; },
    voiceCancel: () => cancelVoice(),
    relayout: () => { try { syncImmersive(); } catch (_) {} },
    /* Layouts on the phone (skin layout API; the Orb and Apps views that used most of it went in issue 1338): the apps (the same rows and kinds as the
     * desktop's), opening one (its desk, or a new one), what is running (the app on each desk, one per app: the Orbs
     * satellites), the Home desk's section and the dock orb's box. */
    apps: () => { const AK = window.WosAppKinds; return (AK ? AK.kinds(APPS, APP).apps : APPS.filter(a => a.url && !a.agent)).slice().sort((x, y) => x.name.localeCompare(y.name)).map(a => ({ id: a.id, name: a.name, icon: ico('span', 'ic', a), system: !!AK?.isSystem?.(a), dev: !!AK?.inDev?.(a), connector: !!AK?.isConnector?.(a), agent: !!a.agent || a.kind === 'chats' })); },
    openApp: id => !!APP[id] && openApp(APP[id]) !== false,
    // The Orb and Apps views' app sheet: every app by kind (core/app-kinds.js rows) and opening any of them
    appKinds: () => window.WosAppKinds?.rows ? window.WosAppKinds.rows(APPS, APP, a => ico('span', 'ic', a)) : null,
    openAnyApp: (id, open) => !!window.WosAppKinds?.openRow?.(APPS, APP, id, open),
    panelRunning: () => { const run = new Map(); appVars.desks.forEach((d, i) => { if (d.home || !d.wins.length) return; const w = appVars.W[d.focus] || appVars.W[d.wins[0]], id = w && (w.appId || winApp(w).id); if (id && !run.get(id)?.open) run.set(id, { id, open: i === appVars.idx, playing: false }); }); return [...run.values()]; },
    // The Orb and Apps views' app sheet: close an app (every desk showing it), and an App Store page on a desk of its own.
    closeApp: id => { let n = 0; for (let i = appVars.desks.length - 1; i >= 0; i--) { const d = appVars.desks[i]; if (!d.home && d.wins.some(x => appVars.W[x] && (appVars.W[x].appId || winApp(appVars.W[x]).id) === id) && closeDesk(i)) n++; } return n > 0; },
    openStore: id => { const S = APP['app-store']; if (!S?.url) return false; Object.keys(appVars.W).filter(x => appVars.W[x]?.appId === 'app-store' && deskOf(x) >= 0).forEach(x => closeWin(x, true));
      const u = new URL(S.url, location.origin); u.searchParams.set('app', id); u.searchParams.set('open', '1'); return !!openWin({ app: 'frame', appId: 'app-store', url: u.pathname + u.search }); },
    homeHost: () => secOf(HOME),
    orbHost: () => orbWrap,
    chatsSurfaces: () => Object.keys(appVars.W).filter(id => appVars.W[id]?.app === 'chats').map(id => CHATS.surface(id)).filter(Boolean),
    // The Apps view's Home grid: one entry per desk (each desk is one app), in desk order, with the app it shows.
    // A layout placing the shell's opens (apps.routeOpens): the app's own window at one of its own pages
    showAppPath: (id, path) => { let u; try { u = new URL(path, location.href); } catch (_) { return false; } const rel = u.pathname + u.search + u.hash;
      if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
      const mine = x => x?.app === 'frame' && x.appId === id && !x.from, w = mine(appVars.W[appVars.desks[appVars.idx].focus]) ? appVars.W[appVars.desks[appVars.idx].focus] : Object.values(appVars.W).find(x => mine(x) && deskOf(x.id) >= 0); if (!w) return false;
      return framePage(w, rel); },
    phoneDesks: () => appVars.desks.map((d, i) => { if (d.home || !d.wins.length) return null; const w = appVars.W[d.focus] || appVars.W[d.wins[0]]; if (!w) return null; const a = winApp(w); return { desk: i, id: w.appId || a.id || '', name: a.name || w.title || '' }; }).filter(Boolean),
    // An app's mark exactly as the dock draws it (its logo or sigil, its colour): the Apps view's icons.
    phoneMark: id => { const a = id === CHATS_APP.id ? { app: 'chats' } : APP[id] ? { app: 'frame', appId: id } : null; return a ? window.WizCore.workspaceNav.icon({ wins: ['m'], focus: 'm' }, { m: a }, winApp) : ''; },
    /* The AI apps view (layouts/ai-apps): its drawer's chats (Working, Ready; the rest for its search), each with the
     * actions Chats' row sheet offers, acted on through Chats' own paths; the Chats window as it is; a New chat in it. */
    // Activity with Channels on (wizard-ux issue 1336): every agent's chats as Working, Ready, Recent, Snoozed, Archived.
    activityList: (o = {}) => window.WizChatsListModel.activityList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }, { order: o.order, older: !!o.older, now: Date.now() }),
    sessionList: () => window.WizChatsListModel.sessionList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }),
    sessionAct: (sid, act) => {
      // Move to channel… (wizard-ux issue 1292): Chats' own picker, over the view as it is (no trip to Chats).
      if (act === 'move') { const find = () => Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0); let here = find();
        // No Chats yet: open one beside, out of view (stay), so the view in front stays in front.
        if (!here) { openApp(APP.wizard, {}, { stay: true }); here = find(); }
        return !!here && !!CHATS.moveToChannel?.(here, sid); }
      if (act === 'pin') { const P = window.WosChatPins; if (!P) return false; const on = P.toggle(sid); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
      if (act === 'markdone') return !!CHATS.markDone?.(Object.keys(appVars.W).find(id => mainChats(appVars.W[id])) || '', sid); // in place (issue 1317)
      const w = showChats(); if (!w) return false;
      if (act === 'rename') { CHATS.openRenameSheet(w.id, sid); return true; }
      CHATS.threadAct(w.id, sid, act); return true;
    },
    showChats: () => !!showChats(),
    newChat: () => { const w = showChats(); if (!w) return false; CHATS.openChat(w.id, '__new__'); return true; },
    // New chat with a channel's feed in front (wizard-ux issue 1291): that feed's own box, never General.
    chatChannelPost: () => { const w = appVars.W[appVars.desks[appVars.idx]?.focus]; return w?.app === 'chats' && !w.thread && !!CHATS.chanCompose?.(w.id); },
    // The Chats list's tab: 'activity' or 'channels' ('' with the switch off). It decides what + does (issue 1310).
    chatChannelView: () => CHATS.chanView?.() || '',
    appOrb: () => { const f = frontAppFrame(); return f ? window.WizAppServices?.orb?.of(f) || null : null; },
    appOrbTap: () => { const f = frontAppFrame(); return !!f && !!window.WizAppServices?.orb?.tap(f); },
    // Now playing (api.media): an app's own name and mark, and bringing that app to the front.
    mediaApp: id => { const a = APP[id]; return a ? { name: a.name || id, icon: ico('span', 'np-ic', a) } : null; },
    mediaOpen: id => !!window.WizOpenApp?.(id),
  });
  // The app window in front (no sheet over it): the only app that may wear the agent orb.
  function frontAppFrame() {
    const f = appVars.desks[appVars.idx]?.focus, w = f && appVars.W[f];
    if (!w?.appId || appVars.sheet || appVars.menuFor || CHATS.isHosted(f)) return null;
    return track.querySelector(`.win[data-win="${f}"] iframe.appframe`);
  }
  return {  };
};
