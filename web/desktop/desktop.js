/* Wizard UX desktop shell.
 *
 * Omarchy's paradigm, made for Wizard: numbered workspaces along the top bar, windows that tile
 * themselves (one fills the workspace, two split side by side, more stack on the right), and a
 * keyboard for everything. No orb, no swipes. Voice is a key: tap Right ⌘ to talk to Archimedes, tap Right ⌥ to dictate.
 *
 * Shared with the phone (web/core/*, live.js, outbox.js): the app registry, the Chats client,
 * Wizard's live data and read state, the durable outbox, voice capture and the native bridge.
 *
 * Keys use ⌥ (Option/Alt) as the window-manager modifier, so they never fight the browser's ⌘ keys:
 *   ⌘K / ⌥Space   search and launch           ⌥` Home, ⌥1…⌥9 go to desktop
 *   ⌥Enter        new chat                    ⇧⌥1…9      send window to workspace
 *   Right ⌘ tap   talk (tap again to send)    ⌥↑↓ Ready chats
 *   Right ⌥ tap   dictate (tap again: insert at the cursor, else copy)
 *   ⌥I            Chats                       ⇧⌥←→       swap window
 *   ⌘W / ⌥W       close app                   ⌥F         full screen
 *   ⌥R            refresh the focused window (keeps it open, in place)
 *   ⌥/            all keys                    ⌥[ ⌥]      previous / next window, then desktop
 *   Esc           close the top layer (never leaves the app)
 */
(async () => {
  'use strict';
  /* Values this shell changes over time (wizard-ux issue 1665): the parts in desktop/desktop-*.js read and write them
   * as desktopVars.<name>, accessors on these same variables, so every read and write is live. */
  const desktopVars = {
    get afterRender() { return afterRender; }, set afterRender(v) { afterRender = v; },
    get barMics() { return barMics; }, set barMics(v) { barMics = v; },
    get boundManager() { return boundManager; }, set boundManager(v) { boundManager = v; },
    get commandTake() { return commandTake; }, set commandTake(v) { commandTake = v; },
    get cur() { return cur; }, set cur(v) { cur = v; },
    get desktop() { return desktop; }, set desktop(v) { desktop = v; },
    get dictationFields() { return dictationFields; }, set dictationFields(v) { dictationFields = v; },
    get dictationFinishing() { return dictationFinishing; }, set dictationFinishing(v) { dictationFinishing = v; },
    get dictTarget() { return dictTarget; }, set dictTarget(v) { dictTarget = v; },
    get feedBase() { return feedBase; }, set feedBase(v) { feedBase = v; },
    get feedHost() { return feedHost; }, set feedHost(v) { feedHost = v; },
    get homeOpen() { return homeOpen; }, set homeOpen(v) { homeOpen = v; },
    get hud() { return hud; }, set hud(v) { hud = v; },
    get lastWs() { return lastWs; }, set lastWs(v) { lastWs = v; },
    get ownsChatList() { return ownsChatList; }, set ownsChatList(v) { ownsChatList = v; },
    get palDesk() { return palDesk; }, set palDesk(v) { palDesk = v; },
    get palItems() { return palItems; }, set palItems(v) { palItems = v; },
    get palMode() { return palMode; }, set palMode(v) { palMode = v; },
    get palPrev() { return palPrev; }, set palPrev(v) { palPrev = v; },
    get palSel() { return palSel; }, set palSel(v) { palSel = v; },
    get panel() { return panel; }, set panel(v) { panel = v; },
    get panelApp() { return panelApp; }, set panelApp(v) { panelApp = v; },
    get panelDocked() { return panelDocked; }, set panelDocked(v) { panelDocked = v; },
    get panelFrontId() { return panelFrontId; }, set panelFrontId(v) { panelFrontId = v; },
    get panelList() { return panelList; }, set panelList(v) { panelList = v; },
    get panelParks() { return panelParks; }, set panelParks(v) { panelParks = v; },
    get settingsFocus() { return settingsFocus; }, set settingsFocus(v) { settingsFocus = v; },
    get settingsModal() { return settingsModal; }, set settingsModal(v) { settingsModal = v; },
    get settingsPromoted() { return settingsPromoted; }, set settingsPromoted(v) { settingsPromoted = v; },
    get settingsReturn() { return settingsReturn; }, set settingsReturn(v) { settingsReturn = v; },
    get sideBase() { return sideBase; }, set sideBase(v) { sideBase = v; },
    get sideHost() { return sideHost; }, set sideHost(v) { sideHost = v; },
    get spotNow() { return spotNow; }, set spotNow(v) { spotNow = v; },
    get spotPrev() { return spotPrev; }, set spotPrev(v) { spotPrev = v; },
    get spotQ() { return spotQ; }, set spotQ(v) { spotQ = v; },
    get strictReply() { return strictReply; }, set strictReply(v) { strictReply = v; },
    get vChanKey() { return vChanKey; }, set vChanKey(v) { vChanKey = v; },
    get vConversation() { return vConversation; }, set vConversation(v) { vConversation = v; },
    get vFeedback() { return vFeedback; }, set vFeedback(v) { vFeedback = v; },
    get vFiles() { return vFiles; }, set vFiles(v) { vFiles = v; },
    get vHandedOff() { return vHandedOff; }, set vHandedOff(v) { vHandedOff = v; },
    get viewBase() { return viewBase; }, set viewBase(v) { viewBase = v; },
    get viewLook() { return viewLook; }, set viewLook(v) { viewLook = v; },
    get vMode() { return vMode; }, set vMode(v) { vMode = v; },
    get vNewChat() { return vNewChat; }, set vNewChat(v) { vNewChat = v; },
    get vNewKey() { return vNewKey; }, set vNewKey(v) { vNewKey = v; },
    get voiceMenuBack() { return voiceMenuBack; }, set voiceMenuBack(v) { voiceMenuBack = v; },
    get vReply() { return vReply; }, set vReply(v) { vReply = v; },
    get vRoute() { return vRoute; }, set vRoute(v) { vRoute = v; },
    get vTarget() { return vTarget; }, set vTarget(v) { vTarget = v; },
    get vTimer() { return vTimer; }, set vTimer(v) { vTimer = v; },
    get W() { return W; }, set W(v) { W = v; },
    get ws() { return ws; }, set ws(v) { ws = v; },
  };
  await window.WizLauncher?.waitForShell?.();
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  const C = window.WizCore;
  const { esc, clip, norm, ago, emoOf } = C;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const { APPS, APP, findApp, appAt, appByName, searchApps, quickSearch, searchUrl } = C.apps('desktop');
  window.WizBackgroundAudio?.init(() => APP, f => window.WizAppServices?.authorized(f));
  const store = C.store('wux.desk.');
  const freshDesk = () => ({ id: 'd' + uid(), wins: [], focus: null, mono: false });
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = IS_MAC ? '⌥' : 'Alt+';
  const CMD = IS_MAC ? '⌘' : 'Ctrl+';

  /* ---------------- state ----------------
   * W: windows by id ({ id, app: 'chats'|'frame', appId, thread, url })
   * ws: workspaces [{ wins: [ids in tiling order], focus, mono }] */
  let W = store.get('wins', null), ws = store.get('ws', null), cur = store.get('cur', 0);
  if (!W || typeof W !== 'object' || Array.isArray(W) || !Array.isArray(ws) || !ws.length) {
    W = {}; ws = [freshDesk()];
    // First run: Chats on 1, so Wizard opens on the thing you use most.
    const id = uid(); W[id] = { id, app: 'chats', thread: null }; ws[0].wins.push(id); ws[0].focus = id;
  }
  window.WosFeatures.pruneWindows(W);
  for (const [id, w] of Object.entries(W)) if (w?.app === 'settings') delete W[id]; // Settings is a window, never restored
  /* Heads-up chat (HUD): one Chats window can float above every desk and Home, and fold into the orb. It lives
   * outside the desks (never tiled, never synced to other devices). r/b anchor its bottom-right corner in the stage. */
  const HUD_DEF = { r: 24, b: 24, w: 420, h: 600 };
  const HUD_GAP = 8, HUD_MIN = [300, 260];
  const hudLayerEl = () => document.getElementById('hudLayer') || document.getElementById('stage').appendChild(Object.assign(document.createElement('div'), { id: 'hudLayer', className: 'hud-layer' }));
  let hud = store.get('hud', null);
  if (!hud || typeof hud !== 'object' || typeof hud.id !== 'string' || W[hud.id]?.app !== 'chats' || ws.some(d => Array.isArray(d?.wins) && d.wins.includes(hud.id))) hud = null;
  else hud = { ...HUD_DEF, ...hud, open: true };
  const oldActive = ws[cur];
  ws = C.migrateChatsFocus(W, ws); cur = Math.max(0, ws.indexOf(oldActive));
  const placed = new Set(), deskIds = new Set();
  ws = ws.map(d => {
    d = d && typeof d === 'object' ? d : freshDesk();
    if (typeof d.id !== 'string' || !/^d[a-z0-9]+$/.test(d.id) || deskIds.has(d.id)) d.id = freshDesk().id;
    deskIds.add(d.id);
    d.wins = (Array.isArray(d.wins) ? d.wins : []).filter(id => W[id] && !placed.has(id) && placed.add(id));
    if (!d.wins.includes(d.focus)) d.focus = d.wins[0] || null;
    d.mono = !!d.mono && d.wins.length > 0; return d;
  });
  if (!Number.isInteger(cur) || cur < 0 || cur >= ws.length) cur = 0;
  // Migrate fixed workspaces once: retain every populated desktop and the active desktop.
  // Empty desktops deliberately created after this migration persist across reloads.
  if (store.get('layoutVersion', 0) < 2) {
    const active = ws[cur]; ws = ws.filter(d => d.wins.length || d === active); cur = ws.indexOf(active);
  }
  store.set('layoutVersion', 2);
  Object.keys(W).forEach(id => { if (id !== hud?.id && !ws.some(d => d.wins.includes(id))) delete W[id]; });
  if (!(cur >= 0 && cur < ws.length)) cur = 0;
  // Window ids: 'w' + 7 base-36 characters, from crypto rather than Math.random (CodeQL js/insecure-randomness).
  function uid() { return 'w' + Array.from(crypto.getRandomValues(new Uint8Array(7)), n => (n % 36).toString(36)).join(''); }
  let desktop = null;
  // The AI apps main column's open channel feed is saved too (wizard-ux issue 1339: a reload, an update's included,
  // brought the column back empty). feedBase is a var: this first runs before its line below (undefined = not yet read).
  const feedSaved = store.get('feed', null);
  const save = () => { store.set('wins', W); store.set('ws', ws); store.set('cur', cur); store.set('hud', hud); if (feedBase !== undefined) store.set('feed', feedBase?.chan ? { id: feedBase.id, chan: feedBase.chan, focus: feedBase.focus || null } : null); window.WosWorkspaceSync?.current?.changed(); desktop?.changed(); };
  const wsOf = id => ws.findIndex(d => d.wins.includes(id));
  /* No desks (a layout holds the panel, e.g. the Orb desktop): whatever opens shows in ONE panel on the right over
   * Home instead of on a desk. A chat panel's window lives outside the desks (never tiled, never synced); an app is a
   * desk of its own (below); opening another thing replaces it (a short Back list keeps the chats before). The desks are left exactly
   * as they were, so when the layout lets go they come straight back. Desk keys and desk moves do nothing meanwhile. */
  let panel = null;   // { id, back: [window objects], swap }: the chat panel (a thread; docked: a column beside the list)
  let panelApp = null;   // the same for an app: its own panel on the right, one app at a time (open beside a chat)
  /* Docked (a layout called api.panel.dock): the stock Chats list sits in its own panel on the LEFT for good (folded:
   * gone until unfolded); a thread picked in it opens in the panel on the right, which every finishing action closes. */
  let panelList = null, panelDocked = false, panelFrontId = null;   // panelList: { id }
  /* Apps are desks (Miguel, v8: "one-to-one with desks"). An app opened while a layout holds the panel (an installed
   * app's frame or a page) becomes a real desk of its own, one app per desk, so it is saved, synced and restored
   * exactly like any desk: looking away, a reload or another device's sync never closes it. The app panel only SHOWS
   * one desk's app; hiding it (✕, Esc) slides the panel away and the desk stays open, its window alive out of sight
   * (music keeps playing); panelQuit closes the desk. Every desk with an app is one running app (one per desk:
   * its focused app, else its first). Chats panels and built-in views (Settings) are not desks. panelParks
   * (api.panel.park) only decides whether an app that is NOT a desk hides instead of closing. */
  let panelParks = false;
  const panelDeskApp = w => !!w && (w.app === 'frame' || w.app === 'pages');
    const panelChat = () => panel && W[panel.id] ? W[panel.id] : null;   // the chat panel's window (a Chats window)
    const panelAppW = () => panelApp && W[panelApp.id] ? W[panelApp.id] : null;   // the app panel's window
    const panelListW = () => panelList && W[panelList.id] ? W[panelList.id] : null;
    const panelWins = () => [panelListW(), panelChat(), panelAppW()].filter(Boolean);
    // Windows on desks other than the current one that a layout shows on screen anyway (WosSkinHost.routeShows).
    const shownBeside = () => { const H0 = globalThis.WosSkinHost; if (!H0?.routeShows) return []; const out = []; ws.forEach((d, i) => { if (i !== cur && d.wins.length && H0.routeShows(i)) out.push(...d.wins); }); return out; };
    const panelHas = id => !!id && (panel?.id === id || panelApp?.id === id || panelList?.id === id);
    const panelSlot = id => !id ? null : panel?.id === id ? panel : panelApp?.id === id ? panelApp : null;
    // One app per desk: the desk's focused app, else its first app (the window the panel shows for that desk).
    const panelDeskRep = d => (panelDeskApp(W[d.focus]) ? W[d.focus] : d.wins.map(id => W[id]).find(panelDeskApp)) || null;
    const panelReps = () => ws.map(panelDeskRep).filter(Boolean);
    const panelParkedW = () => globalThis.WosSkinHost?.panelMode ? panelReps().filter(w => w.id !== panelApp?.id) : [];
    // The panel in front: the one holding the keyboard, else the one opened or clicked last, else the chat, the app.
    const panelWin = () => {
      const all = [panelChat(), panelAppW(), panelListW()].filter(Boolean); if (all.length < 2) return all[0] || null;
      const ae = document.activeElement;
      return all.find(w => stage.querySelector(`.win[data-win="${w.id}"]`)?.contains(ae)) || all.find(w => w.id === panelFrontId) || all[0];
    };

  let homeOpen = store.get('homeOpen', false) === true;
  // The keyboard in the heads-up chat makes it the window in front for keys, voice and chat actions.
  function hudHasFocus() { return !!hud?.open && !!W[hud.id] && !!document.getElementById('hudLayer')?.contains(document.activeElement); }
  const focused = () => hudHasFocus() ? W[hud.id] : (globalThis.WosSkinHost?.panelMode && panelWin()) || (homeOpen ? null : W[ws[cur].focus] || null);
  save(); // Persist normalization before the layout-version marker can affect another boot.

  /* ---------------- chats (shared core) ---------------- */
  const stage = $('#stage');
  const escapeBack = window.WizEscapeBack.create();
  var ownsChatList = !!globalThis.WosSkinHost?.chatsClaimed?.();   // a chat-owning layout decided at boot: the list never mounts first
  /* The AI apps sidebar's Channels pane (wizard-ux issue 1256) backs onto the main Chats window when there is one. With
   * none (a fresh desktop, or a restored one with no main Chats window) it backs onto this stand-in instead: a stock
   * list window kept off the desks and never saved, so the tabs show from the first paint. The first main Chats window
   * then takes over its open channel (sideMain). A post opened from it opens in the main Chats, as from any row. */
  let sideBase = null;
  /* A channel's feed opens in the AI apps main chat column, never in the sidebar (James, 11 Nov 2026: "Channels should
   * display in the chat list with the channel list remaining visible on the sidebar"). It is drawn by one more stand-in
   * list window of its own (feedBase, off the desks and never saved), so opening a channel never touches the Focus of
   * the window behind the sidebar: its channel list and Activity rows stay exactly as they were. */
  var feedBase = null;
  /* The AI apps sidebar's list drawn by another installed Chats look (Settings › Chats › Default Chats, switch
   * wizard/sidebar-chats-view, wizard-ux issue 1443): one more stand-in owner (off the desks, never saved) naming that
   * provider, so the main Chats window and its thread stay as they are. Its list window is viewBase.id + '::side'. */
  var viewBase = null, viewLook = false;
  /* The Default Chats look beside a layout that owns the chat list, and finding Chats windows; desktop/desktop-sideview.js. */
  const { CHATS, chatsWin, commandSaid, commandSnapshot, commandText, executeCommand, LOCAL_COMMANDS, localCommand, mainStd, openSearch, sideMainWin, sideViewOn, sideWin, bindLate: sideviewLate } = window.WizCore.desktopParts.sideview({ APP, appAt, appByName, desktopVars, findApp, focused, MOD, panelWin, panelWins, quickSearch, recordReply, save, searchUrl, shownBeside, stage, talk, threadShown, toast });
  let boundManager;
  function threadShown(wid,el) {
    if (wid.endsWith('::list') || wid.endsWith('::side')) return;
    boundManager ||= window.WosBoundView.create({ windows:()=>Object.values(W),win:id=>W[id],findApp,appAt,APP,linkTitle:u=>u.pathname.split('/').filter(Boolean).pop()||'Page',title:winTitle,
      visible:id=>(globalThis.WosSkinHost?.panelMode&&panelHas(id))||(!homeOpen&&wsOf(id)===cur), close:id=>closeWin(id,true),   // the Orb's chat panel is in view too
      open:(obj,origin)=>{const focus=ws[cur].focus;newWin(obj,{ws:wsOf(origin)});if(W[focus])focusWin(focus,{scroll:false});},
      reload:id=>{save();const f=winEl(id)?.querySelector('iframe');if(f)f.src=f.src;}
    }); boundManager.shown(wid,el);
  }

  /* ---------------- windows ---------------- */
  // App icons are sigils (core/sigils.js): one silhouette, one bite, one colour per app.
  const ico = (tag, cls, a, extra) => window.WizSigil ? window.WizSigil.box(tag, cls, a, extra) : `<${tag} class="${cls}" style="--g1:${a.g?.[0]};--g2:${a.g?.[1]}">${a.icon || '◇'}${extra || ''}</${tag}>`;
  /* Agents MVP: a Chats window pinned to a non-default agent (w.agent) wears that agent's sigil and name. */
  const agentWin = w => !!(w && w.app === 'chats' && w.agent);
  const mainChats = w => !!(w && w.app === 'chats' && !w.agent && (typeof mainStd === 'function' && mainStd() ? w === sideMainWin() : CHATS.views.providerFor(w) === CHATS.views.defaultId()));
  function agentApp(w) {
    const AG = window.WosAgents, a = AG?.get(w.agent) || { id: w.agent, label: w.agent, appearance: {}, privacy: 'standard' };
    const g = AG ? AG.glyph(a) : '', c = AG ? AG.colour(a) : '#b99bff';
    return { id: 'agent:' + a.id, name: a.label, icon: '✦', g: [c, c], sgc: c, sgh: window.WizSigil ? window.WizSigil.named(g || a.label.charAt(0).toUpperCase()) : '', agent: a.id, private: a.privacy === 'private' };
  }
  function appOf(w) {
    if (!w) return null;
    if (agentWin(w)) return agentApp(w);
    if (w.app === 'settings') return { id: 'settings', name: 'Settings', icon: '⚙', g: ['#5b5578', '#2a2640'] };
    if (w.app === 'chats') return { ...APP.wizard, sgc: window.WosAgents?.colour(window.WosAgents.get(window.WosAgents.defaultId())) || '#C1AAFF' };
    return APP[w.appId] || { name: w.title || w.url || 'App', icon: '◇', g: ['#444a60', '#22263a'], url: w.url };
  }
  /* Window titles, private agent names and opening a new window; desktop/desktop-windows.js. */
  const { canLeave, closedWins, closeWin, newWin, rememberClosed, removeWin, reopenClosed, viewContext, winTitle, bindLate: windowsLate } = window.WizCore.desktopParts.windows({ agentApp, agentWin, appOf, C, CHATS, desktopVars, freshDesk, LIVE, OUTBOX, panelDeskApp, panelHas, render, save, store, threadShown, toast, uid, wsOf });
  sideviewLate({ closeWin, newWin, viewContext, winTitle });
  /* ⌥Z: back to where you were just before (window, desk or Home); again flips back. Like Omarchy's last workspace. */
  let spotNow = null, spotPrev = null, spotQ = false;
  /* Resizing and splitting windows, spots on a desk and the light/dark flip; desktop/desktop-resize.js. */
  const { barHtml, closePreview, closeWorkflow, desktopHost, editUnsent, findWin, flipLight, focusInside, focusWin, framePage, hostedOpenable, jumpBack, listWins, moveWin, newChat, noteSpot, openAgentChats, openApp, openAppLink, openChatsList, openThread, resizable, resizeFocused, sidePanes, splitOf, spotLive, swapWin, threadFromApp, toggleMono, winEl, winHtml, wsEl, bindLate: resizeLate } = window.WizCore.desktopParts.resize({ APP, appAt, appOf, C, CHATS, closeWin, desktopVars, esc, focused, hudHasFocus, ico, IS_MAC, LIVE, mainChats, MOD, newWin, OUTBOX, panelHas, panelWins, render, save, shownBeside, stage, store, toast, winTitle, wsOf });
  sideviewLate({ editUnsent, hostedOpenable, moveWin, openApp, openAppLink, openChatsList, openThread, toggleMono });
  windowsLate({ focusWin, winEl });
  let sideHost = null, feedHost = null; // the layout's Channels pane (chatChannels) and channel feed (chatFeed), repainted with the lists on live changes
  /* The Chats list window, its side pane and the channel feed pane; desktop/desktop-lists.js. */
  const { chatsUpDown, feedCarry, feedOpen, feedOpened, feedPane, feedPaneFor, listRows, listW, listWin, paneClicks, readyRows, setListW, sideMain, stepThread, syncChatsPane, viewKey, bindLate: listsLate } = window.WizCore.desktopParts.lists({ $$, APP, CHATS, desktopVars, feedSaved, findWin, focused, focusInside, focusWin, listWins, mainChats, newChat, openApp, openThread, panelWins, save, sidePanes, sideWin, stage, store, toast, uid, winEl, winTitle });
  sideviewLate({ feedOpen, feedOpened, feedPane, feedPaneFor, listWin, sideMain, syncChatsPane, viewKey });
  resizeLate({ listW, syncChatsPane });
  function mountWin(w, host) {
    const el = document.createElement('section');
    el.className = 'win'; el.dataset.win = w.id; el.tabIndex = -1; el.setAttribute('aria-label', winTitle(w));
    el.innerHTML = winHtml(w); host.appendChild(el);
    if (w.app === 'chats') {
      const surface = CHATS.surface(w.id);
      surface.mount(el.querySelector('.pane-main'));
      CHATS.surface(w.id + '::list').mount(el.querySelector('.pane-list'));
      CHATS.renderChatList(listWin(w.id), el.querySelector(`[data-chats="${w.id}::list"]`));
      if (w.thread) CHATS.renderChats(w);
      syncChatsPane(w.id);
    } else if (w.app === 'pages') window.WosPages.mount(el.querySelector('.pg-host'),{slug:w.pageSlug || '',close:() => closeWin(w.id)});
    else if (w.app === 'feature') window.WosFeatures.mount(w.featureId,el.querySelector('.shared-feature'),w.featureOptions);
    else if (w.app === 'settings') afterRender?.();
    else { window.WizReach?.mountRecovery(el.querySelector('[data-recovery]'), w.url); watchFrame(el.querySelector('iframe'), el); }
    return el;
  }
  /* Watching an app frame for refusal and its services; desktop/desktop-frames.js. */
  const { watchFrame, bindLate: framesLate } = window.WizCore.desktopParts.frames({ APP, CHATS, closePreview, closeWorkflow, desktopHost, desktopVars, fields, findWin, focusInside, focusWin, mainChats, newWin, panelHas, panelWins, syncChatsPane, threadFromApp, wsOf });
  function render() {
    // Stable desktop IDs preserve hosted apps, composers and scroll when desktop indices shift.
    $$('.win:not(.panel-out)', stage).forEach(el => { if (!W[el.dataset.win]) { el.querySelector('iframe')?._appDetach?.(); el.remove(); } });
    for (let i = 0; i < ws.length; i++) {
      const host = wsEl(i), d = ws[i];
      // Keep live windows (iframes keep their state); add new ones, drop closed ones.
      // Move surviving DOM nodes between hosts rather than remounting an iframe or draft.
      // A layout holding the panel: each desk's app lives in the panel layer (shown there, or alive out of sight).
      const lay = globalThis.WosSkinHost?.panelMode ? panelLayerEl(d) : null, rep = lay && panelDeskRep(d);
      for (const id of d.wins) { const to = rep?.id === id ? lay : host, ex = stage.querySelector(`.win[data-win="${id}"]`); if (!ex) mountWin(W[id], to); else if (ex.parentNode !== to) to.appendChild(ex); }
      host.hidden = homeOpen || i !== cur;
      let home = host.querySelector('.home');
      if (!d.wins.length) { if (!home) { home = document.createElement('div'); home.className = 'home'; home.tabIndex = -1; home.setAttribute('role', 'region'); host.appendChild(home); } home.setAttribute('aria-label', `Empty desktop ${C.workspaceNav.slot(i)}`); paintHome(home, homeHtml(i)); }
      else if (home) home.remove();
    }
    $$('.wsp', stage).forEach(el => { if (!ws.some(d => d.id === el.dataset.desk)) el.remove(); });
    hudMount(); if (globalThis.WosSkinHost?.panelMode) panelMount();
    const home = $('#desktopHome');
    home.hidden = !homeOpen;
    if (homeOpen) paintHome(home, homeHtml(null));
    layout(); paintBar(); paintFocus();
    // The selector a new desktop opened belongs to that empty desktop: once an app lands there, or the
    // desktop is left or closed, it steps aside and focus goes where the shell now points.
    if (!pal.hidden && palDesk && (homeOpen || ws[cur].id !== palDesk || ws[cur].wins.length)) { closePalette({ restore: false }); restFocus(); }
    window.WosSkinHost?.changed(); // a layout hears Home come and go (route().home)
    queueMicrotask(() => window.WosResources?.sync());
    afterRender?.();
    desktop.changed();
  }
  let afterRender = null; // Settings' window hosts the one Settings panel (set below, once it exists)
  /* Tiling windows, full screen and the floating panel; desktop/desktop-tiling.js. */
  const { clampN, hudBack, hudBar, hudClose, hudDock, hudFocus, hudKey, hudMount, hudOn, hudPaint, layout, paintFocus, PANEL_BACK, panelBack, panelBar, panelClose, panelDeskClose, panelDock, panelEsc, panelForward, panelKind, panelLayerEl, panelMode, panelMount, panelOpen, panelQuit, panelRunning, panelSnap, panelThreadLeft, bindLate: tilingLate } = window.WizCore.desktopParts.tiling({ $, $$, barHtml, C, canLeave, CHATS, desktopVars, esc, findWin, focused, focusInside, freshDesk, HUD_DEF, HUD_GAP, HUD_MIN, hudHasFocus, hudLayerEl, ico, listWin, mainChats, MOD, mountWin, newWin, noteSpot, panelAppW, panelChat, panelDeskApp, panelDeskRep, panelHas, panelListW, panelParkedW, panelReps, panelSlot, panelWin, panelWins, rememberClosed, removeWin, render, save, splitOf, stage, store, syncChatsPane, threadShown, toast, toggleMono, uid, winEl, winTitle, wsEl, wsOf });
  windowsLate({ hudClose, panelClose, panelDeskClose, panelOpen });
  resizeLate({ clampN, hudBar, hudFocus, layout, paintFocus, PANEL_BACK, panelBar, panelSnap });
  listsLate({ panelForward, panelThreadLeft });
  /* Stepping along desks and windows, the bar and usage; desktop/desktop-steps.js. */
  const { closeCurrent, closeDesktop, goHome, goWs, homeHtml, leaveHome, moveDesk, newDesktop, nextStop, paintBar, paintHome, pal, palCard, palIn, palList, reloadable, reloadCurrent, removeDesktop, stepDesk, stepWin, bindLate: stepsLate } = window.WizCore.desktopParts.steps({ $, $$, ago, APP, appOf, APPS, C, canLeave, CHATS, closeWin, desktopHost, desktopVars, dictate, emoOf, esc, focused, focusInside, focusWin, freshDesk, hudClose, hudDock, hudOn, ico, layout, listRows, listWin, LIVE, MOD, mountWin, moveWin, openApp, openChatsList, openThread, OUTBOX, panelBack, panelClose, panelWins, removeWin, render, save, stage, store, syncChatsPane, talk, toast, toggleMono, winEl, winTitle, wsEl });
  sideviewLate({ closeDesktop, goHome, goWs, stepDesk });
  windowsLate({ goHome, goWs, leaveHome, removeDesktop });
  resizeLate({ goHome, goWs, leaveHome, paintBar, reloadable });
  framesLate({ pal });
  tilingLate({ goWs, paintBar });
  let palItems = [], palSel = 0, palMode = 'all', palDesk = null, palPrev = null;
  /* Painting the command palette and the agent name labels; desktop/desktop-palpaint.js. */
  const { commands, palPaint, bindLate: palpaintLate } = window.WizCore.desktopParts.palpaint({ $, APP, closeCurrent, desktopVars, dictate, flipLight, goHome, hudKey, jumpBack, MOD, newChat, newDesktop, openApp, openChatsList, pal, palCard, palIn, palList, reloadCurrent, reopenClosed, resizeFocused, stepDesk, stepWin, talk, toggleMono });
  function palBuild(q) {
    const n = norm(q), out = [];
    const apps = (n ? searchApps(q) : APPS.filter(a => a.kind !== 'view' && a.id !== 'agents')).filter(a => a.kind !== 'native' && a.id !== 'agents' && !C.isMaintenanceApp(a)).slice(0, n ? 8 : 12)
      .map(a => ({ kind: 'app', app: a, name: a.name, sub: a.desc, icon: a.icon, g: a.g, run: o => openApp(a, o) }));
    const sessions = LIVE?.ok ? LIVE.sessions.filter(s => !s.hidden) : [];
    let threads;
    if (n) threads = sessions.map(s => { const t = norm(s.title), p = norm(s.preview); const sc = t.startsWith(n) ? 3 : t.includes(n) ? 2 : p.includes(n) ? 1 : 0; return [sc, s]; }).filter(x => x[0]).sort((a, b) => b[0] - a[0] || Date.parse(LIVE.cardAt(b[1])) - Date.parse(LIVE.cardAt(a[1]))).slice(0, 8).map(x => x[1]);
    else { const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] }; threads = [...L.needs, ...L.ready, ...L.working].slice(0, 6); }
    const th = threads.map(s => ({ kind: 'thread', name: s.title, sub: ago(LIVE.cardAt(s)) + (LIVE.isNew(s) ? ' · unread' : !s.archived && WORKING_ST.has(s.status) ? ' · working' : ''), icon: emoOf(s.id), run: o => openThread(s.id, o) }));
    const cmds = commands().filter(c => !n || norm(c.name).includes(n));
    // Quick search: web + AI overview, or images, in the right-half link pane (no new thread).
    let searchGrp = null;
    if (n && searchUrl(q)) {
      const qs = quickSearch(q) || { query: q, tab: 'all' };
      const go = tab => () => { const u = searchUrl(qs.query, tab); if (u && LINKS) LINKS.open(u); };
      const items = [{ kind: 'search', name: `Search: “${clip(qs.query, 70)}”`, sub: 'AI overview + web results', icon: '⌕', g: ['#8f63ff', '#2a1a66'], run: go('all') },
        { kind: 'search', name: `Image search: “${clip(qs.query, 70)}”`, sub: 'Images', icon: '▦', g: ['#ff5ccf', '#5c3bff'], run: go('images') }];
      if (qs.tab === 'images') items.reverse();
      searchGrp = { grp: 'Search', items, strong: !!quickSearch(q)?.strong };
    }
    // With a query, apps lead (James: "music" → Wizard Music first, under the cursor), then threads,
    // then commands; "Ask" goes last unless nothing else matched. With no query, attention threads lead.
    if (n) {
      if (apps.length) out.push({ grp: 'Apps', items: apps });
      if (th.length) out.push({ grp: 'Threads', items: th });
    } else {
      if (th.length) out.push({ grp: 'Needs you · unread · working', items: th });
      if (apps.length) out.push({ grp: 'Apps', items: apps });
    }
    if (cmds.length) out.push({ grp: 'Commands', items: cmds });
    if (n) out.push({ grp: 'Ask', items: [{ kind: 'ask', name: `Ask ${window.WizConfig.agent()}: “${clip(q, 70)}”`, icon: '✦', keys: `${CMD}Enter`, run: () => ask(q) }] });
    // "image search …" / "search the web …" leads; otherwise Search sits just above Ask.
    if (searchGrp) { if (searchGrp.strong) out.unshift(searchGrp); else out.splice(Math.max(0, out.length - 1), 0, searchGrp); }
    return out;
  }
  /* The app selector list and its ranking; desktop/desktop-picker.js. */
  const { palMark, pickMove, pickRender, WORKING_ST } = window.WizCore.desktopParts.picker({ APPS, C, clip, desktopVars, esc, ico, norm, openApp, palIn, palList, searchApps });
  function palRender() {
    if (palMode === 'apps') return pickRender();
    const groups = palBuild(palIn.value); palItems = groups.flatMap(g => g.items); palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let k = 0;
    palList.innerHTML = groups.map((g, gi) => `<div role="group" aria-labelledby="pal-g${gi}"><div class="pal-grp" id="pal-g${gi}">${esc(g.grp)}</div>` + g.items.map(it => { const i = k++; return `<button type="button" class="pal-it${i === palSel ? ' sel' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-selected="${i === palSel}">${it.app ? ico('span', 'ic', it.app) : `<span class="ic" style="--g1:${it.g?.[0] || '#3a2a6a'};--g2:${it.g?.[1] || '#241a44'}">${it.kind === 'ask' ? window.WizBrand.html : it.icon || '◇'}</span>`}<span class="nm">${esc(it.name)}${it.sub ? `<small>${esc(clip(it.sub, 60))}</small>` : ''}</span>${it.keys ? `<span class="hint"><kbd>${esc(it.keys)}</kbd></span>` : ''}</button>`; }).join('') + '</div>').join('') || '<div class="pal-empty">Nothing yet.</div>';
    palMark(palSel);
  }
  /* Opening, toggling and closing the palette, and where focus rests; desktop/desktop-palopen.js. */
  const { ask, closePalette, closeUsage, openFiles, openPalette, openPicker, openUsage, paintUsage, palToggle, restFocus, setEl, usageEl } = window.WizCore.desktopParts.palopen({ $, CHATS, desktopVars, findWin, focused, focusInside, focusWin, homeHtml, mainChats, newWin, OUTBOX, paintHome, pal, palIn, palList, palMark, palPaint, palRender, panelWins, pickMove, toast, viewContext, wsEl });
  sideviewLate({ openPalette });
  windowsLate({ closePalette, closeUsage });
  resizeLate({ closePalette, closeUsage, setEl });
  tilingLate({ closePalette });
  stepsLate({ closePalette, closeUsage, openPalette, openPicker, paintUsage, usageEl });
  palpaintLate({ openFiles, openPicker, openUsage });
  let settingsFocus = null, settingsReturn = '';
  let barMics = null;  // the one-mic bar choice, set once the mic exists (below)
  const settingsView = window.WosSettings.mount($('#settingsBody'), {
    shell: 'desktop', barMics: () => barMics, outbox: OUTBOX, live: LIVE, ago, toast, visible: () => !setEl.hidden,
    helpSub: 'Keyboard shortcuts, desks and Back',
    openThread: id => { closeSettings(); openThread(id); },
    editUnsent: it => { closeSettings(); editUnsent(it); },
    openLink: (url, title) => { closeSettings(); return openAppLink(url, title); },
    openStore: id => { closeSettings(); newWin({ app: 'frame', appId: 'app-store', url: '/wizard-os-home/store/index.html' + (id ? '?app=' + encodeURIComponent(id) : '') }); },
    chatsChanged: id => { for (const w of Object.values(W)) if (w.app === 'chats' && !w.agent) { w.chatsProvider = id; CHATS.renderChats(w); const list = winEl(w.id)?.querySelector(`[data-chats="${w.id}::list"]`); if (list) CHATS.renderChatList(listWin(w.id), list); syncChatsPane(w.id); } save();
      try { globalThis.dispatchEvent(new CustomEvent('wos:chats-view')); } catch (_) {} }, // the AI apps sidebar follows (issue 1443)
    openSub: id => {
      closeSettings(); settingsReturn = id;
      if (id === 'files') openFiles();
      if (id === 'help') toggleKeys(true);
    },
  });
  function renderSettings() { settingsView.render(); }
  /* Settings is a normal window (APP-DESIGN-RULES.md rule 7, wizard-os#265): the same title bar as any app, closed by
   * its ✕, ⌥W, Esc or ⌥, like every window. There is still one Settings panel (setEl); the window hosts it, and when
   * the window goes (however it goes) the panel is hidden and parked on <body>. */
  const settingsWin = () => Object.values(W).find(w => w?.app === 'settings') || null;
  // From Home, Settings opens as a centred panel over Home instead of a window on a desk (Home is not a desk).
  let settingsModal = false, settingsPromoted = false;
  /* Moving the Settings host between the modal and a window; desktop/desktop-settingshost.js. */
  const { hostSettings, scrim, settingsFocused, showSettingsModal, bindLate: settingshostLate } = window.WizCore.desktopParts.settingshost({ desktopVars, focused, focusInside, setEl, settingsWin, winEl });
  resizeLate({ hostSettings });
  let voiceMenuBack = () => false;  // set once the one-mic menu exists
  /* Opening, closing and toggling Settings; desktop/desktop-settings.js. */
  const { closeSettings, cogLate, glow, mic, nativeDesktop, openSettings, pill, replayTour, returnToSettings, settingsOver, toggleKeys, toggleSettings } = window.WizCore.desktopParts.settings({ $, C, closePalette, closeWin, desktopVars, focusWin, hostSettings, newWin, OUTBOX, renderSettings, scrim, setEl, settingsFocused, settingsView, settingsWin, showSettingsModal });
  sideviewLate({ openSettings });
  windowsLate({ closeSettings, toggleKeys });
  resizeLate({ closeSettings, toggleKeys });
  stepsLate({ closeSettings, openSettings, settingsOver, toggleKeys });
  palpaintLate({ openSettings, toggleKeys });
  settingshostLate({ closeSettings, settingsOver });
  let vTarget = null, vConversation = null, vTimer = 0, vMode = 'talk', dTarget = null, vReply = null, vNewChat = false, vChanKey = false, vNewKey = `${MOD}V`, vContext = '', vRoute = null, vRouteAt = null, vSnapshot = null, vFeedback = null, vFiles = null, commandTake = false, strictReply = false, vSpace = null, vBox;
  let vHandedOff = null; // a sent take the outbox can finish after a reload
  /* The voice chords, screen speech and new voice chats; desktop/desktop-voicekeys.js. */
  const { chanFront, chanPost, chanRoute, chanTalk, closeVoiceMenu, commandVoice, loadVoiceModels, paintVoiceFiles, speakScreen, talkNew, VOICE, voiceMenu } = window.WizCore.desktopParts.voicekeys({ $, C, CHATS, chatsWin, clip, desktopVars, dictate, esc, feedOpen, fields, focused, glow, LIVE, mic, MOD, nativeDesktop, pill, recordReply, store, talk, toast, winTitle });
  sideviewLate({ VOICE });
  palpaintLate({ chanPost, talkNew });
  /* The orb tapped from outside the page (Wizard for Mac's orb and Right ⌘ send wizard:orb) or by the page's own Right ⌘:
   * when a layout's orb sits in a thread's message box, the new take is a reply there, as that orb's click makes it,
   * even while an app beside it has keyboard focus (wizard-ux issue 1547). Otherwise the shell's talk, as before. */
  async function orbTap(action = 'toggle') {
    const r = VOICE.state === 'idle' ? window.WosSkinHost?.deskOrbTap?.() : undefined;
    if (r === undefined) return talk(action);
    const st = await r; return st === 'recording' ? 'voice' : st;
  }
  async function talk(action = 'toggle', forceNew = false, newKey = `${MOD}V`) {
    if (VOICE.state === 'idle' && CHATS.incognitoActive(focused()?.id)) { toast('!', 'Incognito is text only · finish it before recording', 2600); return 'busy'; }
    if (dictationFinishing || VOICE.state === 'think') return 'busy';
    if (action === 'cancel') { commandTake = false; if (VOICE.state !== 'idle') { vFiles?.close();vReply = null; const kept = VOICE.cancel(); toast('✕', kept ? 'Cancelled · kept in Settings → Cancelled recordings' : 'Cancelled', kept ? 2600 : 1000); } return 'none'; }
    if (VOICE.state !== 'idle' && vMode === 'dictate') return 'busy';
    if (VOICE.state === 'idle') {
      if (action === 'send') return 'none';
      // ⌥S, Right ⌘, the orb: a feed in the AI apps main column is a channel too (the classic feed is handled below).
      if (action === 'toggle' && !forceNew) { const c = chanFront(); if (c && c.wid !== focused()?.id && c.sid === '__new__') return chanTalk(c, ''); }
      commandTake = false; strictReply = false; vMode = 'talk'; vNewChat = forceNew; vChanKey = false; vNewKey = newKey;
      const f = focused(); vSnapshot = commandSnapshot();
      vFeedback = !forceNew && f?.from?.sid ? {thread:f.from.sid,title:f.from.title,url:f.url,context:viewContext(f.id,'feedback on the bound page')} : null;
      vFiles?.close(); vFiles = window.WosCaptureTools.take(CHATS.uploadFile, paintVoiceFiles); paintVoiceFiles();
      vTarget = (f?.app === 'chats' || (!forceNew && CHATS.isHosted(f?.id))) ? f.id : null;
      if (forceNew && vTarget) vSnapshot.thread = '__new__';
      // A channel feed in front: the take is filed into that channel, wherever James is by Send.
      vSpace = !forceNew && vTarget ? CHATS.chanSpaceOf?.(W[vTarget]) ?? null : null; vBox = typeof vSpace === 'string' ? CHATS.chanBox?.(vTarget) || '' : undefined;
      const capability = window.WizAppServices?.voiceInput, app = APP[f?.appId];
      vConversation = !forceNew && !CHATS.isHosted(f?.id) ? (capability ? capability.pin(winEl(f?.id)?.querySelector('iframe'), app?.id)
        : app?.receives_voice_input === true ? { appId: app.id, token: 'unavailable', label: app.name } : null) : null;
      vReply = !forceNew && vTarget && f.thread && f.thread !== '__new__' ? { wid: f.id, sid: f.thread, steerRunId: CHATS.isWorking(LIVE.session(f.thread)) ? LIVE.session(f.thread)?.runId || '' : '' } : null;
      vContext = forceNew ? 'Explicit general-agent voice request. No foreground app or private thread context shared.' : viewContext(vTarget, 'voice, aimed at this thread');
      dictationFinishing = true; // model options may not have loaded while an app is foreground
      try {
        const resolveRoute = () => vFeedback ? window.WosModels.snapshot(vFeedback.thread) : CHATS.modelRoute(forceNew && f?.app === 'chats' ? f.id : vTarget, forceNew || vTarget ? (forceNew ? '__new__' : vSnapshot.thread || '__new__') : '', forceNew ? undefined : vBox || undefined);
        vRoute = vConversation ? null : resolveRoute(); vRouteAt = vConversation ? null : resolveRoute; // re-read at Send (wizard-ux#1218)
        if (vRouteAt && typeof vSpace === 'string') vRouteAt = chanRoute(resolveRoute, () => vRoute); // a channel take keeps its agent
        if (!vConversation && !vRoute) { await loadVoiceModels(); vRoute = resolveRoute(); }
        if (!vConversation && !vRoute?.model) throw Error('Model route unavailable · recording has not started');
      } catch(e) { toast('!',String(e.message || e),2600);return 'busy'; }
      finally { dictationFinishing = false; }
      $('#voiceTime').textContent = '0:00';
      try { await VOICE.start(); } catch (e) { toast('🎙', e.code === 'update_busy' ? e.message : 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
      return 'voice';
    }
    if (action === 'start') return 'voice';
    // Uploads in progress never hold a send (they finish behind it); only a failed file with no bytes left blocks.
    if (vFiles?.files.some(f => f.error && !f.local)) { toast('!', 'Remove the failed upload before sending · take kept', 2600); return 'busy'; }
    if (commandTake) {
      dictationFinishing = true; const snap = vSnapshot;
      try { const r=await VOICE.finish({transcribe:false}); if(!r?.blob)return 'none'; const take=await OUTBOX.retainDictation(r.blob,r.captureId); const it=await OUTBOX.transcribeDictation(take.id);
        // A silent command never happened: nothing to recover. A failed transcription keeps its recording.
        // A layout that draws the command take itself (the Orbs view orb) gets the result instead of a toast.
        const owned=!!window.WosSkinHost?.commandUi, said=ev=>window.WosSkinHost?.commandResult?.(ev);
        if(!it?.text&&/^No speech detected/.test(it?.error||'')&&await OUTBOX.completeLocal(it.id)){if(owned)said({result:'silent',text:''});else toast('◌','No speech heard · nothing sent',1800);return 'none';}
        if(!it?.text){if(owned)said({result:'kept',text:''});return 'retained';}
        // A command take is never a message: executed or unmatched, its custody finishes here.
        // Music settles on the player's done receipt; a failure keeps the recording.
        const cmd=await LOCAL_COMMANDS.confirm(LOCAL_COMMANDS.parse(it.text,snap,'command'),it.text,snap,'command'); const music=/^(music|play_music)$/.test(cmd?.action||'');
        const ok=cmd && executeCommand(cmd,it.text,snap,music?(done=>{if(done)OUTBOX.completeLocal(it.id);}):undefined);
        if(!music || !ok) await OUTBOX.completeLocal(it.id);
        commandSaid(ok,cmd,it.text,music);return ok?'local':'none';
      } finally { commandTake=false;dictationFinishing=false; }
    }
    if (forceNew) { vConversation = null; vTarget = null; vNewChat = true; }
    if (vConversation) {
      const conversation = vConversation; // sealed at recording START, never from current focus
      dictationFinishing = true; // keep the logical voice lock through STT/admission
      try {
        const r = await VOICE.finish({ transcribe: false });
        if (!r?.blob) { toast('🎙', r?.error || 'Didn’t catch that', 1600); return 'none'; }
        const item = await OUTBOX.sendConversation({ conversation, audio: r.blob, captureId: r.captureId, files: vFiles?.files || [], source: 'orb' });
        toast(item?.state === 'sent' ? '✦' : '!', item?.state === 'sent' ? 'Sent to ' + conversation.label : item?.error || 'Manager recording kept below', 5000);
        return item?.state === 'sent' ? 'sent' : 'retained';
      } finally { dictationFinishing = false; vConversation = null; }
    }
    const rp = vReply; vReply = null; // the thread a composer-mic take belongs to, fixed before anything else runs
    // The thread in front at the send key, before any await; an agent's Chats list takes it as a new chat with that agent.
    const aimSid = vFeedback?.thread || rp?.sid || (vTarget && vSnapshot?.view?.kind === 'chat thread' ? vSnapshot.thread : '') || (vTarget ? '__new__' : '');
    // Text, photos and voice go as ONE message (legacy H4): that thread's composer, taken at the send key.
    const sealAt = vFeedback || vNewChat ? null : rp ? rp : aimSid ? { wid: vTarget, sid: aimSid, box: aimSid === '__new__' ? vBox : undefined } : null;
    let modelRoute;
    // The destination stays pinned to where the take started; the model is read at the Send key, so a model picked
    // while recording is the one that answers (wizard-ux#1218). The recording-start route stays only when the
    // selector can't be read right now (catalogue still loading).
    try { const live = vConversation ? null : vRouteAt?.(); if (live?.model && live?.provider) vRoute = live; modelRoute = vRoute; if (!modelRoute) throw Error('Recording-start model unavailable · take kept'); }
    catch (e) { vReply = rp; toast('!', String(e.message || e), 2400); return 'busy'; }
    const t = sealAt ? CHATS.takeComposer(sealAt.wid, sealAt.sid, sealAt.box) : null;
    const sealed = t && (t.text || t.files.length || t.reply) ? t : false;
    vHandedOff = null; dictationFinishing = true;
    try {
    const r = await VOICE.finish({ transcribe: false });
    if ((!r || !r.blob) && sealed) sealed.putBack();
    if (!r || !r.blob) { toast('🎙', r?.error || 'Didn’t catch that', 1600); return 'none'; }
    // Files still uploading go as pending placeholders the outbox completes behind the message (never a wait gate).
    const extraFiles = (vFiles?.files || []).map(f=>window.WizUploads?.pending?.ref(f) || (f.id && !f.uploading ? {id:f.id,name:f.name,mime:f.mime,bytes:f.bytes} : null)).filter(f=>f&&f.id);
    if (vFeedback) { const staged=await OUTBOX.stage({kind:'reply',sessionId:vFeedback.thread,...vRoute,audio:r.blob,captureId:r.captureId,files:extraFiles}); const item=await window.WosBoundView.feedback(OUTBOX,{...vFeedback,route:vRoute,custodyId:staged.id},'',r.blob,extraFiles); if(!item){await OUTBOX.transition(staged.id,'held','Feedback unavailable · original kept');toast('!','Feedback kept for its original thread',2600);return 'retained';} toast('✦','Feedback kept · waiting to send',1800);return 'sent'; }
    // Orb dump (wizard/agent-inbox, issue 1588): an idle take (no thread in front, or a new voice chat over a Chats list
    // that is no channel) may become a background task; it then goes through the outbox, never opened in a window.
    const dumpIt = !sealed && !extraFiles.length && (aimSid === '' || (aimSid === '__new__' && vNewChat && typeof vSpace !== 'string')) && typeof dumpTake === 'function' && dumpTake('', rp);
    let stagedId = null, transcript = '';
    if (!strictReply && !forceNew && !vNewChat && !sealed?.text && !sealed?.files?.length && !sealed?.reply && !extraFiles.length) {
      // The microphone journal remains until staging owns the final chunk and the frozen destination.
      {
        const staged = await OUTBOX.stage({kind:aimSid && aimSid!=='__new__'?'reply':'new',sessionId:aimSid==='__new__'?'':aimSid||'',steerRunId:rp?.steerRunId || '',...vRoute,audio:r.blob,captureId:r.captureId,instructions:vContext,how:'voice, aimed at this thread',source:'orb'});
        stagedId=staged.id;
        // The outbox owns transcription and delivery from here, so Reload no longer waits for either one.
        vHandedOff = !commandTake && await OUTBOX.handOff?.(stagedId) ? stagedId : null;
      }
    }
    const w = vTarget && W[vTarget];
    if (rp) { CHATS.sendVoiceTo(rp.wid, rp.sid, r.blob, extraFiles, sealed, modelRoute, stagedId, stagedId ? null : r.captureId, rp.steerRunId, transcript, rp.space); toast('✦', 'Voice reply · waiting to send', 1400); syncChatsPane(rp.wid); return 'sent'; }
    // A dump candidate is a new main-agent take through the outbox, never opened in a window (it may never be a thread).
    if (dumpIt) { await OUTBOX.enqueue({ ...modelRoute, dump: true, custodyId: stagedId, captureId: stagedId ? null : r.captureId, kind: 'new', sessionId: '', audio: r.blob, text: transcript, instructions: vContext, how: 'voice, aimed at this thread', source: 'orb' }); toast('✦', 'Recording kept · waiting to send', 1400); return 'sent'; }
    if (w && aimSid) CHATS.sendChat(w.id, transcript, 'voice, aimed at this thread', r.blob, { custodyId: stagedId, captureId: stagedId ? null : r.captureId, sid: aimSid, seal: sealed, route: modelRoute, files: extraFiles, ...(aimSid === '__new__' && !rp && typeof vSpace === 'string' ? { space: vSpace } : {}) });
    else {
      const item = await OUTBOX.enqueue({ ...modelRoute, custodyId: stagedId, captureId: stagedId ? null : r.captureId, sealKey: sealed?.key, typed: sealed?.text || '', ...(sealed?.reply ? { reply: sealed.reply } : {}), files: [...(sealed?.files || []), ...extraFiles], kind: aimSid && aimSid !== '__new__' ? 'reply' : 'new', sessionId: aimSid && aimSid !== '__new__' ? aimSid : '', audio: r.blob, text: transcript, instructions: vContext, how: 'voice, aimed at this thread', source: 'orb' });
      sealed?.done?.(item);
    }
    toast('✦', 'Recording kept · waiting to send', 1400);
    return 'sent';
    } finally { dictationFinishing = false; }
  }

  // Composer mic: tap to record a reply to this thread, tap again (or Right ⌘) to send it there. The thread is
  // fixed when recording starts, so switching threads mid-take can't send it somewhere else.
  async function recordReply(wid, sid) {
    if (CHATS.incognitoActive(wid)) { toast('!', 'Incognito is text only · finish it before recording', 2600); return 'busy'; }
    if (dictationFinishing || VOICE.state === 'think') return 'busy';
    if (['listen','paused'].includes(VOICE.state)) { if (vReply) return talk('send'); return 'busy'; } // sends to the thread it was started in
    if (!sid) return 'busy';
    strictReply = true; vConversation = null; vFeedback = null; commandTake = false; vSnapshot = commandSnapshot();
    dictationFinishing = true;
    const box = sid === '__new__' ? CHATS.chanBox?.(wid) || '' : '';
    try { vRouteAt = () => CHATS.modelRoute(wid,sid,box || undefined); vRoute = vRouteAt(); if (box) vRouteAt = chanRoute(vRouteAt, () => vRoute); if(!vRoute){await loadVoiceModels();vRoute=CHATS.modelRoute(wid,sid);} if(!vRoute?.model)throw Error('Model route unavailable · recording has not started'); }
    catch(e) { toast('!',String(e.message||e),2600);return 'busy'; }
    finally { dictationFinishing = false; }
    vFiles?.close(); vFiles = window.WosCaptureTools.take(CHATS.uploadFile,paintVoiceFiles); paintVoiceFiles();
    const space = sid === '__new__' ? CHATS.chanSpaceOf?.(chatsWin(wid)) : null; // the AI apps feed is no desk window
    vMode = 'talk'; vNewChat = false; vChanKey = false; vTarget = wid; vReply = { wid, sid, steerRunId: CHATS.isWorking(LIVE.session(sid)) ? LIVE.session(sid)?.runId || '' : '', ...(sid === '__new__' ? { box, ...(typeof space === 'string' ? { space } : {}) } : {}) }; vContext = viewContext(wid, 'voice, aimed at this thread');
    $('#voiceTime').textContent = '0:00';
    try { await VOICE.start(); } catch (e) { vReply = null; toast('🎙', e.code === 'update_busy' ? e.message : 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
    return 'recording';
  }

  // Dictation (Right ⌥): speech to text where you're typing. In a text field the words go in at the cursor;
  // anywhere else they land on the clipboard. (Wizard for Mac does this in every app, natively.)
  let dictTarget = null, dictationFields = null;
  function fields() { return dictationFields ||= C.focusedField.create({
    frames: () => $$('iframe',stage).filter(f => !!APP[W[f.closest('[data-win]')?.dataset.win]?.appId]),
    admit: (c,el) => { const w=c.frame?.closest('[data-win]')||el.closest('[data-win]');return (!w||w.dataset.win===ws[cur].focus)&&!!el.getClientRects().length; },
    controls: el => !!el?.closest('#voicePill,#micBtn,#dictateBtn,.voice-menu')  // the one-mic menu keeps the field Dictate will write into
  }); }
  /* Retained recordings card: moved verbatim to desktop/desktop-recovery.js (issue 1665). */
  window.WizCore.desktopParts.recovery({ esc, LIVE, OUTBOX, toast });
  let dictationFinishing = false;
  async function dictate(action = 'toggle') {
    if (VOICE.state === 'idle' && (CHATS.incognitoActive(focused()?.id) || document.activeElement?.closest?.('[data-incog-thread]'))) { toast('!', 'Incognito is text only · finish it before recording', 2600); return 'busy'; }
    if (dictationFinishing || VOICE.state === 'think') return 'busy';
    if (VOICE.state !== 'idle' && vMode === 'talk') return 'busy';
    if (action === 'cancel') { if (VOICE.state !== 'idle') { dictTarget?.release();dictTarget=null;const kept = VOICE.cancel(); toast('✕', kept ? 'Cancelled · kept in Settings → Cancelled recordings' : 'Cancelled', kept ? 2600 : 1000); } return 'none'; }
    if (VOICE.state === 'idle') {
      vFiles?.close(); vFiles = null; paintVoiceFiles();
      vMode = 'dictate'; vNewChat = false; vTarget = null;
      dictTarget = fields().capture();
      $('#voiceTime').textContent = '0:00';
      try { await VOICE.start(); } catch (e) { vMode = 'talk'; toast('🎙', e.code === 'update_busy' ? e.message : 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
      return 'dictating';
    }
    dictationFinishing = true;
    const target = dictTarget;
    try {
      const r = await VOICE.finish({ transcribe: false });
      if (!r?.blob) { toast('🎙', r?.error || 'Didn’t catch that', 2200); return 'none'; }
      const O = window.WosOutbox;
      const take = await O.retainDictation(r.blob, r.captureId);
      const it = await O.transcribeDictation(take.id);
      const text = it?.text || '';
      if (!text) { toast('🎙', 'Transcription failed · recording kept below', 2600); return 'retained'; }
      window.__wuxLastDictation = text;
      if (await fields().insert(target, text)) { if (it.durable) O.remove(it.id); return 'inserted'; }
      try {
        await navigator.clipboard.writeText(text);
        if (it.durable) O.remove(it.id);
        toast('📋', `Copied: “${clip(text, 60)}” · ⌘V to paste`, 2600); return 'copied';
      } catch (e) { toast('✎', 'Transcript and recording kept below', 2600); return 'retained'; }
    } finally { target?.release(); if(dictTarget===target)dictTarget=null;vMode = 'talk'; dictationFinishing = false; }
  }
  /* Right ⌘ / Right ⌥ tap keys: moved verbatim to desktop/desktop-tapkeys.js (issue 1665). */
  const { keyField, textField, typing, bindLate: tapkeysLate } = window.WizCore.desktopParts.tapkeys({ dictate, orbTap });
  let lastWs = cur;
  /* Back, Esc, moving between windows and the keys guide; desktop/desktop-keys.js. */
  const { desktopBack, dirFocus, keyHints } = window.WizCore.desktopParts.keys({ $, $$, C, CHATS, closedWins, closeWin, closeWorkflow, cogLate, desktopVars, dictate, esc, escapeBack, focused, focusWin, hudBack, IS_MAC, listWin, mainChats, MOD, nativeDesktop, nextStop, panelEsc, panelWin, readyRows, replayTour, resizable, spotLive, syncChatsPane, talk, toggleMono, VOICE, winEl, wsOf });
  framesLate({ keyHints });
  /* Pick anything, live data and the orb dump; desktop/desktop-pickany.js. */
  const { dumpTake, log, onKey, bindLate: pickanyLate } = window.WizCore.desktopParts.pickany({ $, C, chanPost, CHATS, chatsUpDown, closeCurrent, closePalette, closeSettings, closeUsage, closeVoiceMenu, commandVoice, desktopBack, desktopHost, desktopVars, dictate, dirFocus, escapeBack, fields, flipLight, focused, focusInside, focusWin, freshDesk, goHome, goWs, homeHtml, hudKey, hudPaint, IS_MAC, jumpBack, keyField, keyHints, leaveHome, listRows, listWin, LIVE, mainChats, MOD, moveDesk, moveWin, newChat, newDesktop, openChatsList, OUTBOX, paintBar, paintHome, pal, palToggle, panelHas, panelWins, reloadCurrent, reopenClosed, resizeFocused, restFocus, returnToSettings, settingsFocused, settingsView, speakScreen, stage, stepThread, stepWin, swapWin, syncChatsPane, talkNew, tapkeysLate, textField, toast, toggleKeys, toggleMono, toggleSettings, typing, usageEl, VOICE, voiceMenu, winEl, wsEl });
  windowsLate({ log });
  resizeLate({ log });
  listsLate({ log });
  framesLate({ onKey });
  tilingLate({ log });
  stepsLate({ log });

  /* ---------------- toast ---------------- */
  let toastT = 0;
  function toast(icon, text, ms = 2000) { const t = $('#toast'); t.classList.remove('got-it'); t.innerHTML = `<span>${window.WizBrand.icon(esc(icon))}</span><span>${esc(text)}</span>`; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
  /* The native bridge for Wizard for Mac, deep links, boot and workspace sync; desktop/desktop-boot.js. */
  const { LINKS } = window.WizCore.desktopParts.boot({ $$, APP, appAt, appOf, APPS, ask, C, chanPost, CHATS, closeCurrent, closeDesktop, closePalette, closeSettings, closeWin, commandSnapshot, commandText, commandVoice, desktopBack, desktopHost, desktopVars, dictate, escapeBack, feedCarry, feedOpen, feedOpened, fields, findApp, findWin, focused, focusInside, focusWin, framePage, freshDesk, goHome, goWs, hudClose, hudDock, hudKey, hudOn, ico, keyHints, leaveHome, listW, listWin, LIVE, localCommand, log, mainChats, mainStd, MOD, moveDesk, moveWin, newChat, newDesktop, newWin, openAgentChats, openApp, openAppLink, openChatsList, openFiles, openPalette, openPicker, openSearch, openSettings, openThread, openUsage, orbTap, OUTBOX, pal, palToggle, paneClicks, panelAppW, panelBack, panelChat, panelClose, panelDock, panelKind, panelListW, panelMode, panelQuit, panelRunning, panelSlot, panelWin, panelWins, recordReply, render, save, setEl, setListW, sideMain, sideViewOn, stage, stepThread, syncChatsPane, talk, talkNew, toast, toggleKeys, uid, usageEl, viewContext, VOICE, winEl, winTitle });
  framesLate({ LINKS });
  stepsLate({ LINKS });
  pickanyLate({ LINKS });
  // Cold links use the same registered app-open router as later clicks.
  // Wait for static view setup only, never backend data.
  await window.WosExperience?.whenReady?.();
  await window.WosSkinHost?.whenLayoutReady?.();
  C.deeplink.consume();
  // First run is the Welcome modal (core/welcome.js): connect an AI, pick a look, send a first message. It replaces
  // the automatic Setup window and the composer guide (Miguel, 29 Oct 2026); ?view=tour still opens the guide.
  window.WosWelcome?.boot({ app: id => APP[id] || findApp(id, true) || null, openStore: () => openApp(APP['app-store']),
    deeplinked: () => (window.__deeplinkLog || []).length > 0, busy: () => VOICE.state !== 'idle',
    // Say hello's mic (issue 1730): the dictate key's own take, into the focused box.
    voice: () => ({ state: dictationFinishing ? 'think' : VOICE.state, kind: vMode === 'dictate' ? 'dictation' : '' }),
    dictate: () => { if (VOICE.state !== 'idle' && vMode !== 'dictate') return false; if (VOICE.state === 'idle' && !fields().refresh()) return false; dictate(); return true; },
    dictateCancel: () => { if (vMode === 'dictate' && VOICE.state !== 'idle' && !dictationFinishing) dictate('cancel'); },
    // One main Chats window (reused wherever it is), and the new thread opens in it as soon as it is saved.
    send: async text => { const w = findWin(mainChats) || newWin({ app: 'chats', thread: null }); const it = await CHATS.sendChat(w.id, text, 'the first message, from the Welcome screen', null, { sid: '__new__', away: true }); if (!it) return null; focusWin(w.id); if (it.sessionId) window.WosWelcome.whenThreadExists(it.sessionId, sid => openThread(sid)); return it; } });
  const f0 = focused(); if (f0) setTimeout(() => focusInside(f0.id), 50);

  // Closed means closed: an app with no window left on any desktop stops its microphone (take saved for recovery).
  window.WizAppServices?.trackOpenApps?.(() => [...ws.flatMap(d => d.wins), ...(panel ? [panel.id] : []), ...(panelApp ? [panelApp.id] : [])].map(id => W[id]).filter(Boolean).flatMap(w => [w.appId, w.servicesAs]));
  window.WizAppServices?.guardBack(() => {
    const did = desktopBack(); log('back:' + (did || 'root'));
    if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    return true;
  }, toast);
})();
