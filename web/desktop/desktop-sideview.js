/* Wizard UX desktop shell › the Default Chats look beside a layout that owns the chat list, and finding Chats windows. Moved out of desktop.js
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
window.WizCore.desktopParts.sideview = function ({ APP, appAt, appByName, desktopVars, findApp, focused, MOD, panelWin, panelWins, quickSearch, recordReply, save, searchUrl, shownBeside, stage, talk, threadShown, toast }) {
  let closeDesktop, closeWin, editUnsent, feedOpen, feedOpened, feedPane, feedPaneFor, goHome, goWs, hostedOpenable, listWin, moveWin, newWin, openApp, openAppLink, openChatsList, openPalette, openSettings, openThread, sideMain, stepDesk, syncChatsPane, toggleMono, viewContext, viewKey, VOICE, winTitle; // late-bound: desktop.js declares these after the call, see bindLate
  /* Where a layout owns the chat list (AI apps) and another look is picked as Default Chats, the main Chats window is
   * the one the layout docks in its chat column: the first desk whose front window is a Chats window (deskApps'
   * 'wizard'), whatever look it was opened with, drawn as standard Chats. With the switch on or off (wizard-ux issue
   * 1460: off, a sidebar tap went to a second Chats window on a desk of its own, and the main column stayed blank). */
  function mainStd() { return !!desktopVars.ownsChatList && CHATS.views.defaultId() !== 'wizard-chats'; }
  function sideMainWin() {
    // (on that desk, the first Chats window in window order: the one the layout's mainChatWindow draws, even when a
    // second Chats window on the same desk has the focus)
    for (const d of desktopVars.ws) { const w = d.wins.length ? desktopVars.W[d.focus] || desktopVars.W[d.wins[0]] : null; if (w && w.app === 'chats' && !w.agent) return Object.values(desktopVars.W).find(x => x.app === 'chats' && !x.agent && d.wins.includes(x.id)) || w; }
    return null;
  }
  const sideWin = id => (desktopVars.sideBase && desktopVars.sideBase.id === id ? desktopVars.sideBase : desktopVars.feedBase && desktopVars.feedBase.id === id ? desktopVars.feedBase : typeof desktopVars.viewBase !== 'undefined' && desktopVars.viewBase && desktopVars.viewBase.id === id ? desktopVars.viewBase : undefined);
  // Any Chats window by id: a desk window, the sidebar's stand-in or the feed, or one of their list panes (id::list/side).
  const chatsWin = id => desktopVars.W[id] || sideWin(id) || (/::(list|side)$/.test(id) && (desktopVars.W[id.slice(0, -6)] || sideWin(id.slice(0, -6))) ? listWin(id.slice(0, -6), id.slice(-4)) : undefined);
  const CHATS = window.WizChatsHost.create({
    ownsChatList: () => desktopVars.ownsChatList,
    // The sidebar look's taps (wizard-ux issue 1443): a thread opens in the main chat, as from a stock sidebar row.
    viewOpen: (key, sid) => { if (!viewKey(key)) return false; openThread(sid); return true; },
    viewTarget: key => (viewKey(key) ? sideMain().id : ''),
    // With the look in the sidebar, the main chat column stays standard Chats (its list and thread); other windows keep theirs.
    mainLook: w => (mainStd() && desktopVars.W[w?.id] === w && w === sideMainWin() ? 'wizard-chats' : ''),
    win: chatsWin,
    root: () => stage,
    save,
    layout: id => { syncChatsPane(id); },
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    // (plus the windows of any other desk a layout shows on screen beside the current one, e.g. the AI apps view's chat
    // docked beside an app panel: on screen = Chats places, saves and restores its reading spot there too)
    visible: () => [...(desktopVars.homeOpen ? [] : desktopVars.ws[desktopVars.cur].wins), ...(desktopVars.hud?.open ? [desktopVars.hud.id] : []), ...(globalThis.WosSkinHost?.panelMode ? panelWins().map(w => w.id) : []), ...(desktopVars.homeOpen ? [] : shownBeside())],
    front: () => desktopVars.homeOpen ? (globalThis.WosSkinHost?.panelMode && panelWin()?.id) || null : desktopVars.ws[desktopVars.cur].focus,
    // Desktop readers stay on their thread through sends and state/actions; Back remains explicit.
    keepThreadOpen: true,
    // A new chat sent from the Chats window a layout docks beside an app (AI apps: Resolve this on a notification) stays
    // in that column, never the list / Home laid out full width under the app panel (James, 6 Nov 2026).
    // Every New chat sent on the desktop stays open in its new thread (wizard-ux issue 1311, James 12 Nov 2026), in the
    // classic desks and the AI apps column alike (it used to leave to the list, which AI apps draws as its background).
    keepNewOpen: () => true,
    editUnsent: it => editUnsent(it),
    recoverUnsent: id => { openSettings('unsent'); window.WosSettings.focusUnsent(id); },
    openUnsent: () => openSettings('unsent'),
    newChatHint: `Type below and press Enter, or press ${MOD}V for a new voice chat.`,
    newChatKeys: [{ keys: ['Enter'], label: 'send' }, { keys: [MOD.replace('+', ''), 'V'], label: 'new voice chat' }],
    threadShown: (wid, el) => threadShown(wid, el),
    dictationField: () => desktopVars.vMode === 'dictate' && (VOICE.state !== 'idle' || desktopVars.dictationFinishing) ? desktopVars.dictTarget?.el : null,
    owner: id => String(id).replace(/::(list|side)$/, ''),
    // The sidebar's Channels pane opens a channel in the main column's feed window (wizard-ux issue 1256); every other
    // window opens it in place. Opening it there repaints the sidebar (its open channel marked) and tells the layout.
    channelWin: w => feedPaneFor(w),
    channelsElsewhere: w => feedPane(w),
    channelCurrent: () => feedOpen()?.id || '',
    channelOpened: id => feedOpened(id),
    // The AI apps sidebar's Chats pane (its id::side window) while it is on screen, for the Running view (wizard-ux issue
    // 1599); null on every other layout or while a Default Chats look holds the sidebar.
    runningPane: () => {
      const h = desktopVars.sideHost; if (!desktopVars.ownsChatList || !h?.isConnected || h.closest('[hidden]')) return null;
      const w = sideMain(); return h.dataset.chats === w.id + '::side' ? listWin(w.id, 'side') : null;
    },
    // The composer's mic (#13): the same recorder as Right ⌘, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    captureBusy: () => VOICE.state !== 'idle' || desktopVars.dictationFinishing || !!window.WizAppCapture?.getState?.()?.active,
    recordingFor: () => (desktopVars.vReply && ['listen','paused'].includes(VOICE.state) ? desktopVars.vReply.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (['listen','paused'].includes(VOICE.state) && desktopVars.vMode === 'talk' ? (desktopVars.vReply?.sid || (desktopVars.vTarget && desktopVars.W[desktopVars.vTarget]?.thread) || '') : ''),
    finishVoice: () => talk('send'),
    // A private-origin link in a message opens as a window on this workspace; the shell never navigates away.
    openLink: (url, title) => openAppLink(url, title),
    changed: () => { for (const id of Object.keys(desktopVars.W)) if (desktopVars.W[id].app === 'chats') syncChatsPane(id); },
    openThread: (sid, options) => openThread(sid, options),
  });

  function openSearch(query, tab='all') {
    const a=APP['wizard-search'],url=searchUrl(query,tab);
    if(!a||!url){toast('⌕','Search app is not installed',1800);return false;}
    newWin({app:'frame',appId:a.id,url});return true;
  }
  function commandSnapshot() { const w=focused(); return {id:w?.id,thread:w?.thread,view:{appId:w?.appId,kind:w?.app==='chats' ? w.thread ? 'chat thread' : 'thread list' : 'app'}}; }
  const LOCAL_COMMANDS = window.WosCommands.create({CHATS,APP,findApp,appByName,quickSearch,sendSnap:commandSnapshot});
  function executeCommand(c,text,snap,musicDone) {
    return window.WosCommands.execute(c,text,{search:openSearch,settings:openSettings,focused:()=>snap?.id?desktopVars.W[snap.id]:focused(),chats:CHATS,chatList:openChatsList,launcher:openPalette,findApp,openApp,openAppRoute:(id,url)=>{const a=hostedOpenable(id);return !!a&&appAt(url)?.id===id&&openApp(a,{path:url})!==false;},musicDone,
      layout(c) { const f=snap?.id?desktopVars.W[snap.id]:focused();
        if(c.action==='desk') { if(c.to==='home') goHome(); else c.to==='next'?stepDesk(1):c.to==='prev'?stepDesk(-1):goWs(+c.to-1); return true; }
        if(c.action==='close_window') { if(!f)return false;closeWin(f.id);return true; }
        if(c.action==='fullscreen') { if(!f)return false;if(desktopVars.ws[desktopVars.cur].mono!==(c.on!==false))toggleMono();return true; }
        if(c.action==='move_window') { if(!f)return false;moveWin(f.id,c.to==='prev'?desktopVars.cur-1:desktopVars.cur+1);return true; }
        if(c.action==='clear_desk') { closeDesktop(desktopVars.cur);return true; }
        return false;
      }});
  }
  // A command take's result: to a layout that draws it (the Orbs view orb), else the usual toast.
  function commandSaid(ok,cmd,text,music) {
    if(window.WosSkinHost?.commandUi){const app=ok&&/open|launch|app/.test(cmd.action)?findApp(cmd.app||cmd.target)?.id||'':'';window.WosSkinHost.commandResult({result:ok?'done':'miss',text,action:cmd?.action||'',app,music:!!(ok&&music)});}
    else toast(ok?'⚡':'!',ok?'Command handled on-device':'No command matched · nothing sent',2600);
  }
  // The words of a finished command take, as if just transcribed (QA seam: headless has no microphone).
  async function commandText(text, snap=commandSnapshot()) { const cmd=await LOCAL_COMMANDS.confirm(LOCAL_COMMANDS.parse(text,snap,'command'),text,snap,'command'), music=/^(music|play_music)$/.test(cmd?.action||''); const ok=!!cmd && !!executeCommand(cmd,text,snap); commandSaid(ok,cmd,text,music); return ok?'local':'none'; }
  function localCommand(text, snap=commandSnapshot()) { const c=LOCAL_COMMANDS.parse(text,snap,'command');
    // A declared route opens only once the box's fresh app list confirms it (commands.js confirm).
    if (c?.action==='open_app_route') return LOCAL_COMMANDS.confirm(c,text,snap,'command').then(x=>x ? executeCommand(x,text,snap) : false);
    return c ? executeCommand(c,text,snap) : false; }
  return { CHATS, chatsWin, commandSaid, commandSnapshot, commandText, executeCommand, LOCAL_COMMANDS, localCommand, mainStd, openSearch, sideMainWin, sideWin, bindLate: v => { if ('closeDesktop' in v) closeDesktop = v.closeDesktop; if ('closeWin' in v) closeWin = v.closeWin; if ('editUnsent' in v) editUnsent = v.editUnsent; if ('feedOpen' in v) feedOpen = v.feedOpen; if ('feedOpened' in v) feedOpened = v.feedOpened; if ('feedPane' in v) feedPane = v.feedPane; if ('feedPaneFor' in v) feedPaneFor = v.feedPaneFor; if ('goHome' in v) goHome = v.goHome; if ('goWs' in v) goWs = v.goWs; if ('hostedOpenable' in v) hostedOpenable = v.hostedOpenable; if ('listWin' in v) listWin = v.listWin; if ('moveWin' in v) moveWin = v.moveWin; if ('newWin' in v) newWin = v.newWin; if ('openApp' in v) openApp = v.openApp; if ('openAppLink' in v) openAppLink = v.openAppLink; if ('openChatsList' in v) openChatsList = v.openChatsList; if ('openPalette' in v) openPalette = v.openPalette; if ('openSettings' in v) openSettings = v.openSettings; if ('openThread' in v) openThread = v.openThread; if ('sideMain' in v) sideMain = v.sideMain; if ('stepDesk' in v) stepDesk = v.stepDesk; if ('syncChatsPane' in v) syncChatsPane = v.syncChatsPane; if ('toggleMono' in v) toggleMono = v.toggleMono; if ('viewContext' in v) viewContext = v.viewContext; if ('viewKey' in v) viewKey = v.viewKey; if ('VOICE' in v) VOICE = v.VOICE; if ('winTitle' in v) winTitle = v.winTitle; } };
};
