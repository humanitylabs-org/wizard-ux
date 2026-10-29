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
 *   Right ⌘ tap   talk (tap again to send)    ⌥←↑→↓/HJKL focus window
 *   Right ⌥ tap   dictate (tap again: insert at the cursor, else copy)
 *   ⌥I            Chats                       ⇧⌥←→       swap window
 *   ⌘W / ⌥W       close app                   ⌥F         full screen
 *   ⌥R            refresh the focused window (keeps it open, in place)
 *   ⌥/            all keys                    ⌥[ ⌥]      previous / next window, then desktop
 *   Esc           close the top layer (never leaves the app)
 */
(async () => {
  'use strict';
  if (window.WizLauncher?.ready) await window.WizLauncher.ready;
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
  function uid() { return 'w' + Math.random().toString(36).slice(2, 9); }
  const save = () => { store.set('wins', W); store.set('ws', ws); store.set('cur', cur); store.set('hud', hud); window.WosWorkspaceSync?.current?.changed(); };
  const wsOf = id => ws.findIndex(d => d.wins.includes(id));
  let homeOpen = store.get('homeOpen', false) === true;
  // The keyboard in the heads-up chat makes it the window in front for keys, voice and chat actions.
  function hudHasFocus() { return !!hud?.open && !!W[hud.id] && !!document.getElementById('hudLayer')?.contains(document.activeElement); }
  const focused = () => hudHasFocus() ? W[hud.id] : homeOpen ? null : W[ws[cur].focus] || null;
  save(); // Persist normalization before the layout-version marker can affect another boot.

  /* ---------------- chats (shared core) ---------------- */
  const stage = $('#stage');
  const CHATS = window.WizChatsHost.create({
    win: id => W[id] || (/::list$/.test(id) && W[id.slice(0, -6)] ? listWin(id.slice(0, -6)) : undefined),
    root: () => stage,
    save,
    layout: id => { syncChatsPane(id); },
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    visible: () => [...(homeOpen ? [] : ws[cur].wins), ...(hud?.open ? [hud.id] : [])],
    front: () => homeOpen ? null : ws[cur].focus,
    editUnsent: it => editUnsent(it),
    recoverUnsent: id => { openSettings('unsent'); window.WosSettings.focusUnsent(id); },
    openUnsent: () => openSettings('unsent'),
    newChatHint: `Type below and press Enter, or press ${MOD}V for a new voice chat.`,
    newChatKeys: [{ keys: ['Enter'], label: 'send' }, { keys: [MOD.replace('+', ''), 'V'], label: 'new voice chat' }],
    threadShown: (wid, el) => threadShown(wid, el),
    dictationField: () => vMode === 'dictate' && (VOICE.state !== 'idle' || dictationFinishing) ? dictTarget?.el : null,
    owner: id => String(id).replace(/::list$/, ''),
    // The composer's mic (#13): the same recorder as Right ⌘, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    captureBusy: () => VOICE.state !== 'idle' || dictationFinishing || !!window.WizAppCapture?.getState?.()?.active,
    recordingFor: () => (vReply && ['listen','paused'].includes(VOICE.state) ? vReply.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (['listen','paused'].includes(VOICE.state) && vMode === 'talk' ? (vReply?.sid || (vTarget && W[vTarget]?.thread) || '') : ''),
    finishVoice: () => talk('send'),
    // A private-origin link in a message opens as a window on this workspace; the shell never navigates away.
    openLink: (url, title) => openAppLink(url, title),
    changed: () => { for (const id of Object.keys(W)) if (W[id].app === 'chats') syncChatsPane(id); },
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
    return window.WosCommands.execute(c,text,{search:openSearch,settings:openSettings,focused:()=>snap?.id?W[snap.id]:focused(),chats:CHATS,chatList:openChatsList,launcher:openPalette,findApp,openApp,musicDone,
      layout(c) { const f=snap?.id?W[snap.id]:focused();
        if(c.action==='desk') { if(c.to==='home') goHome(); else c.to==='next'?stepDesk(1):c.to==='prev'?stepDesk(-1):goWs(+c.to-1); return true; }
        if(c.action==='close_window') { if(!f)return false;closeWin(f.id);return true; }
        if(c.action==='fullscreen') { if(!f)return false;if(ws[cur].mono!==(c.on!==false))toggleMono();return true; }
        if(c.action==='move_window') { if(!f)return false;moveWin(f.id,c.to==='prev'?cur-1:cur+1);return true; }
        if(c.action==='clear_desk') { closeDesktop(cur);return true; }
        return false;
      }});
  }
  function localCommand(text, snap=commandSnapshot()) { const c=LOCAL_COMMANDS.parse(text,snap,'command');return c ? executeCommand(c,text,snap) : false; }
  let boundManager;
  function threadShown(wid,el) {
    if (wid.endsWith('::list')) return;
    boundManager ||= window.WosBoundView.create({ windows:()=>Object.values(W),win:id=>W[id],findApp,appAt,APP,linkTitle:u=>u.pathname.split('/').filter(Boolean).pop()||'Page',title:winTitle,
      visible:id=>!homeOpen&&wsOf(id)===cur, close:id=>closeWin(id,true),
      open:(obj,origin)=>{const focus=ws[cur].focus;newWin(obj,{ws:wsOf(origin)});if(W[focus])focusWin(focus,{scroll:false});},
      reload:id=>{save();const f=winEl(id)?.querySelector('iframe');if(f)f.src=f.src;}
    }); boundManager.shown(wid,el);
  }

  /* ---------------- windows ---------------- */
  // App icons are sigils (core/sigils.js): one silhouette, one bite, one colour per app.
  const ico = (tag, cls, a, extra) => window.WizSigil ? window.WizSigil.box(tag, cls, a, extra) : `<${tag} class="${cls}" style="--g1:${a.g?.[0]};--g2:${a.g?.[1]}">${a.icon || '◇'}${extra || ''}</${tag}>`;
  /* Agents MVP: a Chats window pinned to a non-default agent (w.agent) wears that agent's sigil and name. */
  const agentWin = w => !!(w && w.app === 'chats' && w.agent);
  const mainChats = w => !!(w && w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === CHATS.views.defaultId());
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
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats' && !w.thread) { const title = CHATS.listTitle?.(w); if (title) return title; }
    if (w.app === 'chats') {
      if (w.thread === '__new__') return 'New chat';
      if (w.thread) return LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread';
      return agentWin(w) ? `${agentApp(w).name} · Chats` : 'Chats';
    }
    return appOf(w).name;
  }
  function viewContext(id, how = 'typing') {
    // A private agent's window is named, never read: its thread titles stay with that agent.
    // Unified Chats: a private agent's thread open in the main Chats is named like its own Chats, never by title.
    const privThread = x => !!(x && x.app === 'chats' && x.thread && LIVE?.isPrivate?.(x.thread));
    const priv = x => (agentWin(x) && agentApp(x).private) || privThread(x);
    const privName = x => privThread(x) && !agentWin(x) ? 'A private agent’s thread' : `${agentApp(x).name} chats (private agent)`;
    const w = homeOpen && !id ? null : W[id || ws[cur].focus], others = homeOpen ? [] : ws[cur].wins.filter(x => x !== w?.id).map(x => priv(W[x]) ? privName(W[x]) : winTitle(W[x]));
    const a = appOf(w);
    return [
      `[Wizard OS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their desktop (${homeOpen ? 'Home' : 'workspace ' + C.workspaceNav.slot(cur)}).`,
      w ? `Window in front: ${priv(w) ? privName(w) : winTitle(w)}${a?.url ? ` (${a.url})` : ''}.` : homeOpen ? 'Home screen in front.' : 'No window was open.',
      (s => s ? `Visible on screen: ${s}` : '')(w && w.app !== 'chats' ? (window.WizScreen?.read(winEl(w.id)) || '') : ''),
      others.length ? `Also open on this workspace: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }

  function newWin(obj, opts = {}) {
    if (obj.app === 'chats' && !obj.agent && !obj.chatsProvider) obj = { ...obj, chatsProvider: CHATS.views.defaultId() };
    leaveHome();
    const t = Number.isInteger(opts.ws) && ws[opts.ws] ? opts.ws : cur;
    const id = uid(); W[id] = { id, ...obj };
    const d = ws[t];
    // New windows go next to the focused one, like a tiling WM.
    const at = d.focus ? d.wins.indexOf(d.focus) + 1 : d.wins.length;
    d.wins.splice(at, 0, id); d.focus = id; d.mono = false;
    save();
    if (t !== cur) goWs(t); else render();
    return W[id];
  }
  // A window may refuse to close (an in-progress recording or temporary chat asks first).
  function canLeave(id) { return CHATS.beforeLeave?.(id) ?? true; }
  // One cleanup path for a window close and a whole-desktop close. The caller owns
  // leave checks, pruning and the final render (which detaches closed app frames).
  function removeWin(id, internal = false) {
    if (!W[id]) return;
    if (!internal) {
      boundManager?.dismiss(W[id]);
      window.WizBackgroundAudio?.closeApp(W[id]?.appId)?.catch(() => toast('♫','Audio could not stop. Pause it from the media controls.'));
    }
    const t = wsOf(id); if (t < 0) return;
    if (W[id]?.app === 'chats') threadShown(id,null);
    const d = ws[t], i = d.wins.indexOf(id);
    CHATS.saveDraft(id);
    d.wins.splice(i, 1); delete W[id]; CHATS.forget(id);
    if (d.focus === id) d.focus = d.wins[Math.min(i, d.wins.length - 1)] || null;
    if (d.wins.length < 2) d.mono = false;
  }
  function closeWin(id, internal = false) {
    if (!internal && !canLeave(id)) return;
    if (hud?.id === id) { hudClose(); return; }
    const t = wsOf(id); if (t < 0) return;
    const d = ws[t];
    removeWin(id, internal);
    if (!internal && !d.wins.length && ws.length > 1) removeDesktop(d);
    else { save(); render(); }
  }
  function focusWin(id, { scroll = true } = {}) {
    if (hud?.id === id) { hudFocus(); return; }
    const t = wsOf(id); if (t < 0) return;
    const fromHome = homeOpen, switched = t !== cur;
    leaveHome();
    if (switched) goWs(t);
    // goWs may prune an empty desktop and reindex the destination; use its new
    // current index, not the pre-navigation index of this stable window ID.
    if (wsOf(id) !== cur) return; // navigation was refused by an in-progress recording
    // A cross-desktop return target needs real keyboard focus, even though render
    // has already painted it as the focused window on its destination desktop.
    if (!switched && !fromHome && ws[cur].focus === id && document.querySelector(`.win[data-win="${id}"].focus`)) return;
    ws[cur].focus = id; save(); paintFocus(); paintBar();
    if (scroll) focusInside(id);
    CHATS.markVisibleThreadsSeen();
  }
  function focusInside(id) {
    if (homeOpen) return;
    const el = winEl(id); if (!el) return;
    const w = W[id];
    if (w.app === 'chats') {
      const ta = el.querySelector('.pane-main textarea');
      if (w.thread && ta) { ta.focus({ preventScroll: true }); return; }
      const s = el.querySelector('[data-chsearch]'); if (s && !w.thread) return; // don't steal focus into search
    }
    el.focus({ preventScroll: true });
  }
  function moveWin(id, t) {
    const from = wsOf(id); if (from < 0 || t === from || t < 0 || t >= ws.length) return;
    const d = ws[from]; d.wins = d.wins.filter(x => x !== id); if (d.focus === id) d.focus = d.wins[0] || null; if (d.wins.length < 2) d.mono = false;
    ws[t].wins.push(id); ws[t].focus = id;
    save(); render(); toast('→', `Moved to desktop ${C.workspaceNav.slot(t)}`, 1000);
  }
  function swapWin(dir) {
    const d = ws[cur], i = d.wins.indexOf(d.focus), j = i + dir;
    if (i < 0 || j < 0 || j >= d.wins.length) return;
    [d.wins[i], d.wins[j]] = [d.wins[j], d.wins[i]]; save(); layout();
  }
  function toggleMono() {
    if (homeOpen || hudHasFocus()) return; // Home must not alter a parked desktop's fullscreen preference; nor the HUD.
    const d = ws[cur]; if (!d.wins.length) return;
    d.mono = !d.mono; save(); layout();
    if (d.mono && !store.get('fullHint', false)) {
      store.set('fullHint', true); toast('⤢', `${MOD}F, Esc or Back leaves full screen`, 2200);
    }
  }

  /* Open an app the desktop way: Chats and apps already open get focused, not duplicated. */
  // Hosted Wizard apps (App Store) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  window.WizAppOpen = id => Object.values(W).some(w => w && w.appId === id);
  function closeWorkflow(w) {
    if (!w?.workflow || W[w.id] !== w) return false;
    const origin = w.returnWid; closeWin(w.id);
    if (W[origin]) focusWin(origin);
    return true;
  }
  window.WizOpenApp = (id, path = '') => {
    const x = hostedOpenable(id); if (!x) return false;
    if (!path) return openApp(x);
    let u; try { u = new URL(path, location.href); } catch (_) { return false; }
    const rel = u.pathname + u.search + u.hash;
    if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
    return !!newWin({ app: 'frame', appId: id, url: rel, workflow: true, returnWid: ws[cur].focus });
  };
  // Only trusted system windows may ask; check the actual sender frame, never a claimed app id.
  addEventListener('message', async e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['app-store', 'agents', 'setup'].includes(w.appId)) return;
    // Setup may have just installed it: apps-changed is asynchronous. Wait for the registry, not a guessed delay.
    if (!hostedOpenable(d.id)) await window.WizCore.refreshApps?.();
    if (!host.isConnected || W[host.dataset.win] !== w) return;
    const a = hostedOpenable(d.id); if (a) openApp(a);
  });
  /* App → agent binding: an app's settings sheet (core/app-route.js). Its Agents button opens the Agents app
   * at that agent; Agents frames may ask for an app's sheet. */
  window.WosAppRoute?.init({ openAgents: (id, o = {}) => { openApp(APP.agents); const msg = o.newPreset ? { type: 'wizard:agents-new', preset: o.newPreset } : id ? { type: 'wizard:agents-show', id } : null; if (msg) [400, 1100, 2200].forEach(t => setTimeout(() => { for (const f of document.querySelectorAll('iframe[title="Agents"]')) f.contentWindow?.postMessage(msg, location.origin); }, t)); } });
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:app-route' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['agents', 'app-store'].includes(w.appId)) return;
    window.WosAppRoute?.request(d);
  });
  // The Agents app opens an agent's own Chats. Only those frames may ask; the agent must exist.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-agent-chats' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['agents'].includes(w.appId)) return;
    openAgentChats(d.id, { thread: d.thread === '__new__' ? '__new__' : '' });
  });
  async function openAgentChats(id, o = {}) {
    const AG = window.WosAgents; if (!AG || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ''))) return false;
    if (!AG.get(id)) await AG.load(true);
    if (!AG.get(id)) { toast('!', 'That agent isn’t on this Wizard', 2000); return false; }
    let w = findWin(mainChats);
    if (w) focusWin(w.id); else w = newWin({ app: 'chats', thread: null });
    CHATS.setFocus(w, { kind: 'agent', key: id });
    if (o.thread === '__new__') { CHATS.openNewDraft(w.id, ''); syncChatsPane(w.id); }
    LIVE?.refreshAgents?.().then(() => LIVE.emit());
    return true;
  }
  window.WizOpenAgentChats = openAgentChats;
  // Keep deep app links on the same admission path as Home and the launcher.
  function openAppLink(url, title, setupChecked = false) {
    const a = appAt(url);
    if (a && !setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openAppLink(url, title, true));
    return !!newWin({ app: 'frame', appId: a ? a.id : 'link', url, title: a ? a.name : title });
  }
  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focused()?.appId === id });
  function openApp(a, opts = {}) {
    if (!a) return false;
    if (a.url && !opts.setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openApp(a, { ...opts, setupChecked: true }));
    if (a.kind === 'chats') {
      if (a.agent) return openAgentChats(a.agent);
      const chatsProvider = a.chatsProvider || CHATS.views.defaultId();
      const ex = !opts.fresh && findWin(w => w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === chatsProvider);
      if (ex) { focusWin(ex.id); return true; }
      newWin({ app: 'chats', thread: null, chatsProvider }, opts); return true;
    }
    if (a.url) {
      const ex = !opts.fresh && findWin(w => w.app === 'frame' && w.appId === a.id);
      if (ex) { focusWin(ex.id); return true; }
      newWin({ app: 'frame', appId: a.id }, opts); return true;
    }
    if (a.href) { window.open(a.href, '_blank', 'noopener'); return true; }
    return false;
  }
  // Prefer this workspace, then any.
  function findWin(fn) {
    const here = ws[cur].wins.map(id => W[id]).find(fn); if (here) return here;
    return Object.values(W).find(w => w.id !== hud?.id && fn(w)) || null; // the heads-up chat is never reused as a desk window
  }
  function openThread(sid, opts = {}) {
    if (!sid) return;
    // Any agent's thread opens in the main Chats window, without changing its list Focus.
    const mine = mainChats;
    let w = !opts.fresh && (ws[cur].wins.map(id => W[id]).find(mine) || findWin(mine));
    if (!w) w = newWin({ app: 'chats', thread: null }, opts);
    focusWin(w.id); CHATS.openChat(w.id, sid);
    setTimeout(() => focusInside(w.id), 30);
  }
  function openChatsList() {
    window.WosResources?.back(); closeSettings(); closePalette();
    openApp(APP.wizard);
    const w = focused();
    if (w?.app === 'chats' && w.thread) { CHATS.chatsBack(w); syncChatsPane(w.id); }
  }
  function newChat(opts = {}) {
    // ⌘Enter in an agent's Chats starts a chat with that agent; anywhere else, with the main agent.
    const f0 = focused();
    let w = !opts.fresh && (f0?.app === 'chats' ? f0 : ws[cur].wins.map(id => W[id]).find(mainChats));
    if (!w) w = newWin({ app: 'chats', thread: null, ...(f0?.app === 'chats' && f0.focus ? { focus: { ...f0.focus } } : {}) }, opts);
    focusWin(w.id); CHATS.openNewDraft(w.id, '');
    syncChatsPane(w.id); setTimeout(() => focusInside(w.id), 30);
    return w;
  }
  function editUnsent(it) {
    if (it.state === 'unconfirmed' || OUTBOX?.quarantined(it.id)) { toast('!', it.error || 'Waiting for device storage verification · original kept', 3200); return; }
    if (it.body) { toast('!', 'Delivery is uncertain · retry this submission to reconcile before editing', 3000); return; }
    const known = it.kind === 'reply' || LIVE?.session(it.sessionId);
    let w;
    if (known) { openThread(it.sessionId); w = focused(); }
    else { w = newWin({ app: 'chats', thread: null, ...(it.agent ? { agent: it.agent } : {}) }); focusWin(w.id); CHATS.openChat(w.id, '__new__'); syncChatsPane(w.id); }
    if (!w) return;
    if (!window.WosSettings.moveDraft({ chats: CHATS, wid: w.id, item: it, outbox: OUTBOX, toast })) return; CHATS.renderChats(w); syncChatsPane(w.id);
  }

  /* ---------------- rendering ---------------- */
  const winEl = id => stage.querySelector(`.win[data-win="${id}"]`);
  function wsEl(i) {
    const d = ws[i]; if (!d) return null;
    let el = stage.querySelector(`.wsp[data-desk="${d.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'wsp'; el.dataset.desk = d.id; stage.appendChild(el); }
    el.dataset.ws = i; return el;
  }
  function winHtml(w) { return `${barHtml(w)}
      <div class="wbody">${bodyHtml(w)}</div>${hud?.id === w.id ? '<div class="hud-grip" data-hudgrip title="Drag to resize" aria-hidden="true"></div>' : ''}`; }
  const HUD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="15.5" cy="14.5" r="2.6" fill="currentColor"/></svg>';
  const DESK1_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M10.6 9.6 12.6 8v8"/></svg>';
  function barHtml(w) {
    const a = appOf(w);
    if (hud?.id === w.id) return `<div class="wbar" data-drag title="Drag to move">${window.WosAgents.titlebar(w.agent || '', 'ic', 't')}
      <button data-wact="hud-home" title="Back to desktop 1 (${MOD}P)" aria-label="Back to desktop 1" aria-keyshortcuts="Alt+P">${DESK1_ICON}</button>
      <button data-wact="close" title="Close" aria-label="Close window">✕</button></div>`;
    return `<div class="wbar" data-drag>${w.app === 'chats' ? window.WosAgents.titlebar(w.agent || '', 'ic', 't') : `${ico('span', 'ic', a)}<span class="t">${esc(winTitle(w))}</span>`}
      ${window.WosBoundView.badge(w)}${w.app === 'frame' ? window.WosOwnViews?.marker(a) || '' : ''}${w.app === 'frame' && window.WosAppRoute ? window.WosAppRoute.slot(w.appId) : ''}${a.url ? `<button data-wact="pop" title="Open in a browser tab" aria-label="Open in a browser tab">↗</button>` : ''}
      ${reloadable(w) ? `<button data-wact="reload" title="Refresh (${MOD}R)" aria-label="Refresh window">↻</button>` : ''}
      ${w.app === 'chats' ? `<button data-wact="hud" title="Float over every desk (${MOD}P)" aria-label="Float over every desk" aria-keyshortcuts="Alt+P">${HUD_ICON}</button>` : ''}
      <button data-wact="mono" title="Full screen (${MOD}F)" aria-label="Full screen">⤢</button>
      <button data-wact="close" title="Close app (${MOD}W)" aria-label="Close window">✕</button></div>`;
  }
  function bodyHtml(w) {
    if (w.app === 'feature') return '<div class="shared-feature"></div>';
    if (w.app === 'settings') return '<div class="settings-host"></div>';
    if (w.app === 'chats') return `<div class="dchats" data-thread="${esc(w.thread || '')}" style="--list-w:${listW()}px"><div class="pane-list"><div class="chats" data-chats="${w.id}::list"></div></div>
      <div class="pane-split" data-split role="separator" aria-orientation="vertical" aria-label="Resize the thread list" tabindex="0" title="Drag to resize · double-click to reset"></div>
      <div class="pane-main"><div class="chats" data-chats="${w.id}"></div><div class="pane-empty"><div><b>Your conversations, side by side.</b><br>Choose a chat on the left, or start one.<br><button type="button" class="pane-newchat" data-panenew>Start a new chat</button><br><kbd>${MOD}↓</kbd> top ready chat · <kbd>${MOD}N</kbd> new chat · <kbd>${MOD}V</kbd> new voice chat · hold <kbd>${IS_MAC ? '⌥' : 'Alt'}</kbd> for every key</div></div></div></div>`;
    const a = appOf(w), url = window.WosOwnViews?.frameUrl(a, w.url) || w.url || a.url || '/';
    return `${window.WosOwnViews?.noteHtml(a) || ''}<iframe data-own-app="${esc(a.id || '')}" src="${esc(url)}" title="${esc(a.name)}" allow="microphone; clipboard-read; clipboard-write; autoplay; fullscreen"></iframe>
      <div class="frame-fallback"><div><b>${esc(a.name)} can’t show in a window</b><a href="${esc(url)}" target="_blank" rel="noopener">Open it in a tab ↗</a></div></div>`;
  }
  /* Chats on the desktop: list on the left, thread on the right, both from the shared Chats client.
   * The list pane is a second Chats "window" (id::list) that always shows the list. */
  const listWins = {};
  function listWin(id) { return listWins[id] || (listWins[id] = { id: id + '::list', get thread() { return null; }, set thread(v) { if (v) { const w = W[id]; if (w) { w.thread = v; save(); CHATS.renderChats(w); syncChatsPane(id); } } } }); }
  function syncChatsPane(id) {
    const base = String(id).replace(/::list$/, ''); const w = W[base]; if (!w || w.app !== 'chats') return;
    const el = winEl(base); if (!el) return;
    const box = el.querySelector('.dchats'); if (box) box.dataset.thread = w.thread || '';
    $$('.ch-row', el).forEach(r => r.classList.toggle('cur', r.dataset.chopen === w.thread));
    window.WosAgents.refreshTitlebars();
    el.setAttribute('aria-label', winTitle(w));
    if (focused()?.id === base) document.title = `${winTitle(w)} · Wizard`;
  }
  /* ---- the list/thread divider: drag, arrow keys, double-click to reset; one width for every Chats window ---- */
  const LIST_W = [220, 640, 340];
  function listW() { const v = +store.get('listW', LIST_W[2]); return v >= LIST_W[0] && v <= LIST_W[1] ? v : LIST_W[2]; }
  function setListW(px) { px = Math.round(Math.max(LIST_W[0], Math.min(LIST_W[1], px))); store.set('listW', px); $$('.dchats', stage).forEach(b => b.style.setProperty('--list-w', px + 'px')); return px; }
  let split = null;
  stage.addEventListener('pointerdown', e => {
    const s = e.target.closest('[data-split]'); if (!s || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const box = s.closest('.dchats'); split = { box, left: box.getBoundingClientRect().left };
    s.setPointerCapture?.(e.pointerId); document.documentElement.classList.add('splitting');
  });
  addEventListener('pointermove', e => { if (split) setListW(e.clientX - split.left); });
  addEventListener('pointerup', () => { if (!split) return; split = null; document.documentElement.classList.remove('splitting'); });
  stage.addEventListener('dblclick', e => { if (e.target.closest('[data-split]')) { e.stopPropagation(); setListW(LIST_W[2]); } }, true);
  stage.addEventListener('keydown', e => {
    if (!e.target.matches?.('[data-split]')) return;
    const d = { ArrowLeft: -24, ArrowRight: 24 }[e.key]; if (!d) return;
    e.preventDefault(); e.stopPropagation(); setListW(listW() + d);
  });
  /* ---- keyboard through the thread list: ↑/↓ (or j/k) open the previous/next chat, / searches ---- */
  function listRows(id) { return $$('.pane-list .ch-row[data-chopen], .pane-list .ch-row[data-chdraft]', winEl(id) || document.createElement('div')).filter(r => r.getClientRects().length).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); }
  // ⌥↓ / ⌥↑: walk the Ready chats only (Working and the rest are skipped), top first, from anywhere.
  // Rows are taken in on-screen order so "top" is what the owner sees at the top of Ready.
  // Notifications shown as rows (inbox tweak, [data-chnotif]) count too, wherever Chats shows them (one list holds
  // them): new ones before the Ready chats, so ⌥↓ from elsewhere lands on the top notification; snoozed ones after.
  const byTop = (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  const readyRows = id => {
    const threads = $$('.pane-list .ch-sec[data-sec="ready"] .ch-row[data-chopen]', winEl(id) || document.createElement('div')).filter(r => r.getClientRects().length).sort(byTop);
    // Listed among the chats (inbox list mode): the list's own rows, in on-screen order with everything else.
    const own = $$('.pane-list .ch-sec[data-sec="ready"] .ch-notif-row[data-chnotif]', winEl(id) || document.createElement('div')).filter(r => r.getClientRects().length);
    if (own.length) return [...threads, ...own].sort(byTop);
    const notes = $$('.pane-list .ch-sec[data-sec="ready"] [data-chnotif]', document).filter(r => r.getClientRects().length).sort(byTop);
    const end = r => r.closest('[data-slot]')?.dataset.slot === 'ready-end';
    return [...notes.filter(r => !end(r)), ...threads, ...notes.filter(end)];
  };

  function stepReady(dir, tries = 0) {
    let f = focused();
    const fresh = tries > 0 || homeOpen || !mainChats(f); // arriving from elsewhere always starts at the top
    if (homeOpen || !mainChats(f)) {
      const w = ws[cur].wins.map(x => W[x]).find(mainChats);
      if (w && !homeOpen) { focusWin(w.id); f = w; return setTimeout(() => stepReady(0, 1), 0); }
      if (!tries) { openApp(APP.wizard); return setTimeout(() => stepReady(0, 1), 80); }
    }
    f = focused(); if (!f || f.app !== 'chats') return false;
    const rows = readyRows(f.id);
    if (!rows.length) {
      const sec = winEl(f.id)?.querySelector('.pane-list [data-sectoggle="ready"][aria-expanded="false"]');
      if (sec && tries < 2) { sec.click(); return setTimeout(() => stepReady(dir, tries + 1), 60); }
      if (tries < 8 && !winEl(f.id)?.querySelector('.pane-list .ch-sec')) return setTimeout(() => stepReady(dir, tries + 1), 80);
      toast('✓', 'Nothing ready right now', 1400); return false;
    }
    const keyOf = r => r.dataset.chopen || 'n:' + r.dataset.chnotif, here = f.thread === '__new__' && CHATS.notifOpen?.(f.id) ? 'n:' + CHATS.notifOpen(f.id) : f.thread;
    const i = fresh ? -1 : rows.findIndex(r => keyOf(r) === here);
    const j = i < 0 ? 0 : (i + (dir || 0) + rows.length) % rows.length, r = rows[j]; // wraps: past the last goes back to the top
    if (i >= 0 && dir > 0 && j === 0) toast('↺', 'Back to the top of Ready', 1000);
    if (i >= 0 && j === i) return true;
    if (!r.dataset.chopen) { r.click(); log('ready:notification'); return true; } // the package opens it in this window
    CHATS.openChat(f.id, r.dataset.chopen); syncChatsPane(f.id);
    const again = winEl(f.id)?.querySelector(`.pane-list .ch-row[data-chopen="${CSS.escape(r.dataset.chopen)}"]`);
    $$('.pane-list .ch-row.kbd', winEl(f.id)).forEach(x => x.classList.remove('kbd'));
    if (again) { again.classList.add('kbd'); again.scrollIntoView({ block: 'nearest' }); }
    setTimeout(() => { const row = winEl(f.id)?.querySelector(`.pane-list .ch-row[data-chopen="${CSS.escape(r.dataset.chopen)}"]`); focusInside(f.id); }, 30); // straight into the message box: type to reply, or ⌥↓ again for the next one
    log('ready:' + r.dataset.chopen);
    return true;
  }
  // ⌥↓ / ⌥↑ always walk Ready, wherever you are (Miguel, 27 Oct 2026: one key, no list/composer sides).
  function chatsUpDown(dir) { return stepReady(dir); }
  // After a send (Enter, or a Right ⌘ / mic voice reply) the window goes back to a focused New chat:
  // type a new one straight away, or ⌥↓ to the next Ready chat.
  function toNewChat(wid, why) {
    const w = W[wid]; if (hud?.id === wid || !mainChats(w) || homeOpen || focused()?.id !== wid) return; // the HUD stays on its chat
    CHATS.openNewDraft(wid, ''); syncChatsPane(wid); setTimeout(() => focusInside(wid), 30); log('send:new-chat:' + why);
  }
  stage.addEventListener('submit', e => {
    const form = e.target.closest?.('[data-chform]'), ta = form?.querySelector('textarea'); if (!ta?.value.trim()) return;
    const wel = form.closest('.win'), wid = wel?.dataset.win, w = W[wid]; if (!mainChats(w)) return;
    setTimeout(() => {
      if (W[wid] !== w || (document.activeElement && document.activeElement !== document.body && !wel.contains(document.activeElement))) return;
      toNewChat(wid, 'text');
    }, 180);
  }, true);
  function stepThread(id, dir) {
    const w = W[id]; if (!w || w.app !== 'chats') return false;
    const rows = listRows(id); if (!rows.length) return false;
    let i = rows.findIndex(r => r.classList.contains('kbd'));
    if (i < 0) i = rows.findIndex(r => r.dataset.chopen && r.dataset.chopen === w.thread);
    const j = i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + dir));
    const r = rows[j]; if (!r) return false;
    if (r.dataset.chopen) CHATS.openChat(id, r.dataset.chopen); else CHATS.openNewDraft(id, r.dataset.chdraft);
    syncChatsPane(id);
    const again = listRows(id)[j]; if (again) { $$('.pane-list .ch-row.kbd', winEl(id)).forEach(x => x.classList.remove('kbd')); again.classList.add('kbd'); again.focus({ preventScroll: true }); again.scrollIntoView({ block: 'nearest' }); }
    log('list:' + (r.dataset.chopen || r.dataset.chdraft));
    return true;
  }
  function mountWin(w, host) {
    const el = document.createElement('section');
    el.className = 'win'; el.dataset.win = w.id; el.tabIndex = -1; el.setAttribute('aria-label', winTitle(w));
    el.innerHTML = winHtml(w); host.appendChild(el);
    if (w.app === 'chats') {
      CHATS.renderChatList(listWin(w.id), el.querySelector(`[data-chats="${w.id}::list"]`));
      if (w.thread) CHATS.renderChats(w);
      syncChatsPane(w.id);
    } else if (w.app === 'feature') window.WosFeatures.mount(w.featureId,el.querySelector('.shared-feature'),w.featureOptions);
    else if (w.app === 'settings') afterRender?.();
    else watchFrame(el.querySelector('iframe'), el);
    return el;
  }
  function watchFrame(f, el) {
    if (!f) return;
    // servicesAs: a companion view gets its owning installed app's Back/services.
    const w = W[el.dataset.win], a = w && APP[w.servicesAs || w.appId];
    if (a?.url) f._appDetach = window.WizAppServices?.attach(f, { appId: a.id, path: a.url, back: () => closeWorkflow(w), openThread: (sid, opts) => CHATS.openHosted(w.id, f, sid, opts), openContextDraft: (key, text) => { let cw = ws[cur].wins.map(id => W[id]).find(mainChats); if (!cw) cw = newWin({ app: 'chats', thread: null }); focusWin(cw.id); const receipt = CHATS.openContextDraft(cw.id, key, text); CHATS.renderChats(cw); syncChatsPane(cw.id); setTimeout(() => focusInside(cw.id), 30); return receipt; }, isVisible: () => !homeOpen && ws[cur].wins.includes(w.id) && (!ws[cur].mono || ws[cur].focus === w.id) && pal.hidden && !CHATS.isHosted(w.id) });
    f.addEventListener('load', () => {
      // A refused frame (CSP frame-ancestors / X-Frame-Options) lands on an unreadable error document.
      let bad = false;
      try { const d = f.contentDocument; bad = !d || /^chrome-error:|^about:blank/.test(d.URL || '') && f.getAttribute('src') !== 'about:blank'; } catch (e) { bad = true; }
      el.querySelector('.frame-fallback')?.classList.toggle('on', bad);
      // Clicking inside a same-origin app focuses its window; Esc inside it still reaches the shell.
      try {
        const doc = f.contentDocument; if (!doc || doc.__wuxHooked) return; doc.__wuxHooked = true;
        fields().bind(doc);
        doc.addEventListener('pointerdown', () => focusWin(el.dataset.win, { scroll: false }), true);
        doc.addEventListener('keydown', e => onKey(e, true), true); doc.addEventListener('keyup', e => keyHints.up(e), true);
        try { const w0 = W[el.dataset.win]; if (LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(f.contentWindow, (w0 && ((APP[w0.appId] || {}).url || w0.url)) || f.contentWindow.location.pathname, LINKS); } catch (e) {}
      } catch (e) {}
    });
  }
  function render() {
    // Stable desktop IDs preserve hosted apps, composers and scroll when desktop indices shift.
    $$('.win', stage).forEach(el => { if (!W[el.dataset.win]) { el.querySelector('iframe')?._appDetach?.(); el.remove(); } });
    for (let i = 0; i < ws.length; i++) {
      const host = wsEl(i), d = ws[i];
      // Keep live windows (iframes keep their state); add new ones, drop closed ones.
      // Move surviving DOM nodes between hosts rather than remounting an iframe or draft.
      for (const id of d.wins) { const ex = stage.querySelector(`.win[data-win="${id}"]`); if (!ex) mountWin(W[id], host); else if (ex.parentNode !== host) host.appendChild(ex); }
      host.hidden = homeOpen || i !== cur;
      let home = host.querySelector('.home');
      if (!d.wins.length) { if (!home) { home = document.createElement('div'); home.className = 'home'; home.tabIndex = -1; home.setAttribute('role', 'region'); host.appendChild(home); } home.setAttribute('aria-label', `Empty desktop ${C.workspaceNav.slot(i)}`); paintHome(home, homeHtml(i)); }
      else if (home) home.remove();
    }
    $$('.wsp', stage).forEach(el => { if (!ws.some(d => d.id === el.dataset.desk)) el.remove(); });
    hudMount();
    const home = $('#desktopHome');
    home.hidden = !homeOpen;
    if (homeOpen) paintHome(home, homeHtml(null));
    layout(); paintBar(); paintFocus();
    // The selector a new desktop opened belongs to that empty desktop: once an app lands there, or the
    // desktop is left or closed, it steps aside and focus goes where the shell now points.
    if (!pal.hidden && palDesk && (homeOpen || ws[cur].id !== palDesk || ws[cur].wins.length)) { closePalette({ restore: false }); restFocus(); }
    queueMicrotask(() => window.WosResources?.sync());
    afterRender?.();
  }
  let afterRender = null; // Settings' window hosts the one Settings panel (set below, once it exists)
  /* Tiling: capped windows form a centered group; 2 split; 3+ = master + stack.
   * Host-window fullscreen keeps this readable width; explicit monocle remains immersive. */
  function layout() {
    const host = wsEl(cur), d = ws[cur];
    // Apply chrome before measuring, including a single app, reload and workspace switches.
    const full = !homeOpen && !!d.mono && !!d.wins.length;
    document.body.classList.toggle('desktop-fullscreen', full);
    // Opinionated: a visible way out of full screen (the title bar and its ⤢ are hidden there).
    let ex = document.getElementById('exitFull');
    if (!ex) { ex = document.createElement('button'); ex.id = 'exitFull'; ex.type = 'button'; ex.className = 'exit-full'; ex.title = `Exit full screen (Esc / ${MOD}F)`; ex.setAttribute('aria-label', 'Exit full screen');
      ex.innerHTML = '⤡<span>Exit full screen</span>'; ex.addEventListener('click', () => { if (ws[cur].mono) toggleMono(); }); document.body.appendChild(ex); }
    ex.hidden = !full;
    const W_ = host.clientWidth, H_ = host.clientHeight, g = full ? 0 : 8;
    const n = d.wins.length;
    const rects = {};
    if (!n || homeOpen) return;
    const configuredMax = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-window-max-width'));
    const maxWidth = configuredMax > 0 ? configuredMax : 1200;
    // Columns on request: a window that sets `share` (Video Editor's video + Feedback pair) lays the desktop out as
    // side-by-side columns in window order; windows without a share split what is left equally.
    const shared = !d.mono && n >= 2 && n <= 4 && d.wins.some(id => W[id]?.share > 0);
    if (d.mono) d.wins.forEach(id => { rects[id] = id === d.focus || n === 1 ? [g, g, W_ - 2 * g, H_ - 2 * g] : null; });
    else if (shared) {
      const avail = Math.max(0, W_ - (n + 1) * g), asked = d.wins.reduce((t, id) => t + (W[id]?.share > 0 ? W[id].share : 0), 0);
      const rest = d.wins.filter(id => !(W[id]?.share > 0)).length, scale = rest ? Math.min(1, 0.8 / asked) : 1 / asked;
      const free = rest ? (1 - asked * scale) / rest : 0;
      let x = g; for (const id of d.wins) { const w = Math.round(avail * (W[id]?.share > 0 ? W[id].share * scale : free)); rects[id] = [x, g, w, H_ - 2 * g]; x += w + g; }
    } else if (n === 1) {
      const width = Math.min(maxWidth, Math.max(0, W_ - 2 * g));
      rects[d.wins[0]] = [(W_ - width) / 2, g, width, H_ - 2 * g];
    } else if (n === 2) {
      const half = Math.min(maxWidth, Math.max(0, (W_ - 3 * g) / 2));
      const left = (W_ - 2 * half - g) / 2;
      rects[d.wins[0]] = [left, g, half, H_ - 2 * g]; rects[d.wins[1]] = [left + g + half, g, half, H_ - 2 * g];
    } else {
      const available = Math.max(0, W_ - 3 * g);
      const naturalMaster = Math.round(available * 0.56);
      const mw = Math.min(maxWidth, naturalMaster), sw = Math.min(maxWidth, available - naturalMaster);
      const left = (W_ - mw - sw - g) / 2, k = n - 1, sh = (H_ - (k + 1) * g) / k;
      rects[d.wins[0]] = [left, g, mw, H_ - 2 * g];
      d.wins.slice(1).forEach((id, j) => { rects[id] = [left + g + mw, g + j * (sh + g), sw, sh]; });
    }
    for (const id of d.wins) {
      const el = winEl(id); if (!el) continue; const r = rects[id];
      el.classList.toggle('gone', !r);
      el.classList.toggle('full', full && id === d.focus);
      if (r) Object.assign(el.style, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' });
    }
  }
  /* ---- heads-up chat (HUD): a Chats window floating over every desk and Home; folds into the orb ---- */
  function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function hudMount() {
    const hudLayer = hudLayerEl();
    $$('.win.hud', stage).forEach(el => { if (el.dataset.win !== hud?.id) el.classList.remove('hud'); });
    if (hudLayer.nextSibling) stage.appendChild(hudLayer); // above every desk and Home
    if (!hud || !W[hud.id]) { if (hud) hud = null; hudPaint(); return; }
    let el = winEl(hud.id);
    if (!el) el = mountWin(W[hud.id], hudLayer); else if (el.parentNode !== hudLayer) hudLayer.appendChild(el);
    el.classList.add('hud'); el.classList.remove('gone', 'full', 'focus', 'drag');
    hudPaint();
  }
  // Re-draw a window's title bar for its place (desk or HUD); the body, thread and draft stay mounted.
  function hudBar(id) {
    const el = winEl(id), w = W[id]; if (!el || !w) return;
    el.querySelector(':scope > .wbar')?.remove(); el.insertAdjacentHTML('afterbegin', barHtml(w));
    el.querySelector(':scope > .hud-grip')?.remove();
    if (hud?.id === id) el.insertAdjacentHTML('beforeend', '<div class="hud-grip" data-hudgrip title="Drag to resize" aria-hidden="true"></div>');
    window.WosAgents.refreshTitlebars(); syncChatsPane(id);
  }
  function hudPaint() {
    const hudLayer = hudLayerEl();
    hudLayer.hidden = !hud;
    if (!hud) return;
    const SW = stage.clientWidth, SH = stage.clientHeight, el = winEl(hud.id);
    const w = Math.round(clampN(hud.w, HUD_MIN[0], Math.max(HUD_MIN[0], SW - 2 * HUD_GAP))), h = Math.round(clampN(hud.h, HUD_MIN[1], Math.max(HUD_MIN[1], SH - 2 * HUD_GAP)));
    if (el) {
      el.hidden = false;
      const r = clampN(hud.r, HUD_GAP, Math.max(HUD_GAP, SW - w - HUD_GAP)), b = clampN(hud.b, HUD_GAP, Math.max(HUD_GAP, SH - h - HUD_GAP));
      Object.assign(el.style, { left: (SW - r - w) + 'px', top: (SH - b - h) + 'px', width: w + 'px', height: h + 'px' });
    }
  }
  function hudFocus() {
    if (!hud?.open) return;
    const el = winEl(hud.id); if (!el) return;
    const ta = W[hud.id].thread && el.querySelector('.pane-main textarea');
    (ta && ta.getClientRects().length ? ta : el).focus({ preventScroll: true });
  }
  function hudOn(id) {
    const w = W[id]; if (w?.app !== 'chats') return false;
    if (hud?.id === id) return true;
    if (hud) hudDock({ focus: false });
    const t = wsOf(id); if (t < 0) return false;
    const d = ws[t], i = d.wins.indexOf(id);
    d.wins.splice(i, 1);
    if (d.focus === id) d.focus = d.wins[Math.min(i, d.wins.length - 1)] || null;
    if (d.wins.length < 2) d.mono = false;
    hud = { ...HUD_DEF, ...(store.get('hudPlace', null) || {}), id, open: true };
    save(); render(); hudBar(id);
    CHATS.markVisibleThreadsSeen();
    setTimeout(hudFocus, 30);
    if (!store.get('hudHint', false)) { store.set('hudHint', true); toast('◉', `Floats over every desk · ${MOD}P puts it back on desktop 1`, 2600); }
    log('hud:on');
    return true;
  }
  function hudKeepPlace() { if (hud) store.set('hudPlace', { r: hud.r, b: hud.b, w: hud.w, h: hud.h }); }
  // Put the HUD window back as a normal window on the desk in front (Home: the last desk).
  // Put the HUD window back as a normal window: on the desk in front (Home: the last desk), or on desk `to`
  // (⌥B and the 1 button: desktop 1, Chats' usual place), which then comes to the front.
  function hudDock({ focus = true, to = null } = {}) {
    if (!hud) return false;
    const id = hud.id; hudKeepPlace(); hud = null;
    if (!W[id]) { save(); render(); return false; }
    // Back to desktop 1: Chats gets desktop 1 to itself. Anything already there moves one desk to the right,
    // with every other desk (Miguel, 28 Oct 2026).
    if (to === 0 && ws[0]?.wins.length) { ws.unshift(freshDesk()); cur += 1; lastWs += 1; }
    const t = Number.isInteger(to) && ws[to] ? to : cur;
    const d = ws[t], at = d.focus ? d.wins.indexOf(d.focus) + 1 : d.wins.length;
    d.wins.splice(at, 0, id); d.focus = id; d.mono = false;
    const el = winEl(id); if (el) el.hidden = false;
    if (t !== cur) { save(); render(); goWs(t); } else if (homeOpen) { homeOpen = false; store.set('homeOpen', false); }
    save(); render(); hudBar(id);
    if (focus) { paintFocus(); paintBar(); setTimeout(() => focusInside(id), 30); }
    log('hud:dock' + (to != null ? ':' + (t + 1) : ''));
    return true;
  }
  // ⌥P: float the Chats window in front (or this desk's, or the main one, or a new one); floating, put it back on desktop 1.
  function hudKey() {
    if (hud) return hudDock({ to: 0 });
    const f = focused();
    // Any Chats window on this desk (main or an agent's) floats as it is; elsewhere only the main Chats is borrowed.
    let w = f?.app === 'chats' ? f : !homeOpen ? ws[cur].wins.map(x => W[x]).find(x => x?.app === 'chats') : null;
    if (!w) w = findWin(mainChats) || newWin({ app: 'chats', thread: null });
    return hudOn(w.id);
  }
  // Back / Esc inside the floating chat: thread → its list. On the list it stays floating (⌥P or 1 put it away).
  function hudBack() {
    if (!hudHasFocus()) return '';
    const f = W[hud.id]; if (!f?.thread) return '';
    const r = CHATS.threadBack(f); syncChatsPane(f.id); hudFocus();
    return r || 'hud';
  }
  function hudClose() {
    if (!hud) return false;
    const id = hud.id; hudKeepPlace(); hud = null;
    if (W[id]) { threadShown(id, null); CHATS.saveDraft(id); delete W[id]; CHATS.forget(id); }
    save(); render(); log('hud:close');
    return true;
  }
  // Move by the title bar; resize by the top-left grip (the bottom-right corner stays put).
  let hudDrag = null;
  stage.addEventListener('pointerdown', e => {
    if (!hud || e.button !== 0) return;
    const grip = e.target.closest('[data-hudgrip]');
    const bar = !grip && e.target.closest('.win.hud > .wbar');
    if (!grip && (!bar || e.target.closest('[data-wact]'))) return;
    e.preventDefault(); e.stopPropagation();
    hudDrag = { size: !!grip, x: e.clientX, y: e.clientY, r: hud.r, b: hud.b, w: hud.w, h: hud.h, on: false };
  }, true);
  addEventListener('pointermove', e => {
    if (!hudDrag || !hud) return;
    const dx = e.clientX - hudDrag.x, dy = e.clientY - hudDrag.y;
    if (!hudDrag.on && Math.hypot(dx, dy) < 5) return;
    if (!hudDrag.on) { hudDrag.on = true; hudLayerEl().classList.add('moving'); }
    if (hudDrag.size) { hud.w = Math.max(HUD_MIN[0], hudDrag.w - dx); hud.h = Math.max(HUD_MIN[1], hudDrag.h - dy); }
    else { hud.r = hudDrag.r - dx; hud.b = hudDrag.b - dy; }
    hudPaint();
  });
  addEventListener('pointerup', () => {
    if (!hudDrag) return; const d = hudDrag; hudDrag = null; hudLayerEl().classList.remove('moving');
    if (!hud) return;
    if (d.on) {
      const SW = stage.clientWidth, SH = stage.clientHeight, sz = [Math.min(hud.w, SW - 2 * HUD_GAP), Math.min(hud.h, SH - 2 * HUD_GAP)];
      hud.w = Math.round(clampN(hud.w, HUD_MIN[0], Math.max(HUD_MIN[0], SW - 2 * HUD_GAP))); hud.h = Math.round(clampN(hud.h, HUD_MIN[1], Math.max(HUD_MIN[1], SH - 2 * HUD_GAP)));
      hud.r = Math.round(clampN(hud.r, HUD_GAP, Math.max(HUD_GAP, SW - sz[0] - HUD_GAP))); hud.b = Math.round(clampN(hud.b, HUD_GAP, Math.max(HUD_GAP, SH - sz[1] - HUD_GAP)));
      save(); hudPaint();
    }
  });
  addEventListener('resize', () => hudPaint());
  function paintFocus() {
    const d = ws[cur];
    $$('.win', stage).forEach(el => el.classList.toggle('focus', el.dataset.win === d.focus));
    const f = focused(); document.title = f ? `${winTitle(f)} · Wizard` : 'Wizard';
    if (d.mono) layout();
  }
  // ⌥[ / ⌥]: one step left or right along the bar, no wrapping (Miguel, 27 Oct 2026). Left of desktop 1 is Home;
  // nothing is left of Home and nothing right of the last desktop.
  function stepDesk(dir) {
    if (homeOpen) { if (dir > 0 && ws.length) { lastWs = cur; goWs(0); if (cur === 0 && homeOpen) leaveHome(); } return; }
    if (dir < 0 && cur === 0) { lastWs = cur; goHome(); return; }
    const t = cur + dir; if (t < 0 || t >= ws.length) return;
    lastWs = cur; goWs(t);
  }
  // ⌥] / ⌥[ (Miguel, 28 Oct 2026): walk this desk's windows left to right first (the order H J K L use), and only
  // past the last (or first) one step on to the next (or previous) desk. Chats with a chat open is two stops: the
  // chat list, then the message box. Arriving on a desk with ] starts at its leftmost stop, with [ at its rightmost.
  // ⌥← / ⌥→ stay Snooze / Done on an open chat.
  function chatsZone(f) {
    const el = winEl(f.id), a = document.activeElement;
    if (a && el?.contains(a)) { if (a.closest('.pane-list')) return 'list'; if (a.closest('.pane-main')) return 'thread'; }
    return 'list';
  }
  const shown = n => !!n && !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const twoSides = w => !!(w && w.app === 'chats' && w.thread && shown(winEl(w.id)?.querySelector('.pane-list')) && shown(winEl(w.id)?.querySelector('.pane-main textarea')));
  // Put the keyboard on one side of a Chats window: the open chat's row in the list, or the message box.
  function chatsSide(f, side) {
    const el = winEl(f.id); if (!el) return false;
    if (side === 'thread') { const ta = el.querySelector('.pane-main textarea'); if (!ta) return false; ta.focus({ preventScroll: true }); return true; }
    const row = el.querySelector(`.pane-list .ch-row[data-chopen="${CSS.escape(f.thread || '')}"]`) || el.querySelector('.pane-list .ch-row.kbd') || listRows(f.id)[0];
    if (!row) return false;
    $$('.pane-list .ch-row.kbd', el).forEach(x => x.classList.remove('kbd')); row.classList.add('kbd');
    row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); return true;
  }
  function deskStops() {
    const d = ws[cur]; if (homeOpen || !d) return [];
    const mid = id => { const r = winEl(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const ids = d.mono ? d.wins.filter(id => winEl(id)) // full screen: the others are hidden; keep the tiling order
      : d.wins.filter(id => winEl(id) && !winEl(id).classList.contains('gone')).map(id => [id, mid(id)]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(x => x[0]);
    return ids.flatMap(id => twoSides(W[id]) ? [[id, 'list'], [id, 'thread']] : [[id, '']]);
  }
  // The stop ⌥] (dir 1) or ⌥[ (dir -1) goes to on this desk, or null when it goes on to the next/previous desk.
  function nextStop(dir) {
    const stops = deskStops(), f = focused(); if (!stops.length) return null;
    const i = f ? stops.findIndex(([id, s]) => id === f.id && (!s || s === chatsZone(f))) : -1;
    if (i < 0) return f && stops.some(([id]) => id === f.id) ? null : stops[dir > 0 ? 0 : stops.length - 1];
    return stops[i + dir] || null;
  }
  function goStop([id, side]) {
    focusWin(id, { scroll: false });
    if (!(side && chatsSide(W[id], side))) focusInside(id);
    log('step:' + (W[id]?.app || id) + (side ? ':' + side : ''));
  }
  function stepWin(dir) {
    const st = !homeOpen && nextStop(dir); if (st) return goStop(st);
    const from = ws[cur], wasHome = homeOpen; stepDesk(dir); // by desk, not index: leaving an empty desk prunes it
    if (homeOpen || (ws[cur] === from && !wasHome)) return;
    const stops = deskStops(); if (stops.length) goStop(stops[dir > 0 ? 0 : stops.length - 1]);
  }
  function goWs(i, { from } = {}) {
    window.WosResources?.back();
    if (!Number.isInteger(i) || i < 0 || i >= ws.length) return;
    if (i !== cur && !CHATS.beforeNavigate(ws[i].wins)) return;
    if (i === cur) { if (homeOpen) { leaveHome(); if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); } return; }
    homeOpen = false; store.set('homeOpen', false);
    // Preserve the later-approved empty-desktop pruning contract.
    const target = ws[i], left = ws[cur], prune = !left.wins.length && ws.length > 1;
    const prev = cur;
    if (prune) { ws.splice(cur, 1); i = ws.indexOf(target); }
    lastWs = prune ? i : prev; cur = i; save();
    const el = wsEl(i); el.classList.add(i >= prev ? 'from-r' : 'from-l');
    render(); requestAnimationFrame(() => el.classList.remove('from-r', 'from-l'));
    CHATS.markVisibleThreadsSeen();
  }

  // A new desktop opens with the app selector over it: an empty desktop is a place to open something.
  // An empty current desktop is reused rather than stacked, so repeated ⌘T / + never leaves blanks behind.
  function newDesktop() {
    if (ws[cur].wins.length) { ws.push(freshDesk()); goWs(ws.length - 1); } else if (homeOpen) leaveHome();
    openPicker({ desk: ws[cur].id });
    return ws[cur];
  }
  function removeDesktop(d) {
    const i = ws.indexOf(d); if (i < 0 || ws.length === 1) return false;
    const current = ws[cur], previous = ws[lastWs], active = current === d;
    ws.splice(i, 1);
    cur = active ? Math.max(0, i - 1) : ws.indexOf(current);
    lastWs = Math.max(0, ws.indexOf(previous === d ? ws[cur] : previous));
    if (active) { homeOpen = false; store.set('homeOpen', false); }
    save(); render();
    if (active) { if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); }
    return true;
  }
  function closeDesktop(i = cur) {
    const d = ws[i]; if (!d) return false;
    // Check every window before destroying any: a recording can refuse the close.
    if (!d.wins.every(canLeave)) return false;
    const names = [...new Set(d.wins.map(id => appOf(W[id])?.name).filter(Boolean))].join(', ');
    [...d.wins].forEach(id => removeWin(id));
    if (!removeDesktop(d)) { save(); render(); goHome(); }
    toast('✕', `Closed ${names || 'desktop'}`); return true;
  }
  /* Refresh what is in front, in place: app frames reload at the page they are on, Chats refetches its list and open
   * thread, built-in views remount, and Home refetches its data. Nothing closes or moves. */
  const reloadable = w => !!w;
  function refreshData() { window.WizCore.refreshApps?.(); return Promise.resolve(LIVE?.refresh?.()).catch(() => {}); }
  function reloadWin(id) {
    const w = W[id], el = winEl(id); if (!reloadable(w) || !el) return false;
    if (w.app === 'chats' || CHATS.isHosted(id)) {
      refreshData().then(() => {
        if (!W[id]) return;
        if (W[id].thread && W[id].thread !== '__new__') CHATS.loadThread(W[id], true);
        const lp = winEl(id)?.querySelector(`[data-chats="${id}::list"]`); if (lp) CHATS.renderChatList(listWin(id), lp);
        syncChatsPane(id);
      });
      if (w.app === 'chats') { toast('↻', `Refreshed ${winTitle(w)}`, 900); return true; }
    }
    const f = el.querySelector('.wbody iframe');
    if (f) {
      // Same-origin apps reload where they are; a cross-origin page can only restart at its start page.
      try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; toast('↻', `Restarted ${winTitle(w)}`, 1100); return true; }
    } else { save(); const host = el.parentNode, next = el.nextSibling, fresh = mountWin(w, host); host.insertBefore(fresh, next); el.remove(); render(); }
    toast('↻', `Refreshed ${winTitle(w)}`, 900);
    return true;
  }
  function refreshHome() {
    refreshData().then(() => render());
    window.WosUsage?.load?.(true)?.then?.(() => { if (!usageEl.hidden) paintUsage(); });
    render(); toast('↻', 'Refreshed Home', 900); return true;
  }
  function reloadCurrent() { if (homeOpen || !ws[cur].wins.length) return refreshHome(); const f = focused(); return f ? reloadWin(f.id) : refreshHome(); }
  function closeCurrent() { const f = focused(); if (f) { closeWin(f.id); return 'app'; } if (homeOpen) return 'root'; return closeDesktop() ? 'desktop' : 'root'; }

  /* ---------------- top bar ---------------- */
  addEventListener('wizard:app-counts', () => paintBar());
  addEventListener('wizard:notifications', () => render());
  function paintBar() {
    window.WosBell?.paint?.();
    const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] };
    C.workspaceNav.setCount(APP.wizard?.id || 'wizard', (LIVE?.ok ? (LIVE.workGroups().ready || []).length : 0) + (window.WosBell?.readyCount?.() || 0));
    $('#logo').setAttribute('aria-current', homeOpen ? 'page' : 'false');
    $('#logo').innerHTML = C.workspaceNav.icon({ home: true }, W, appOf);
    if (!$('#wsList').classList.contains('arranging')) $('#wsList').innerHTML = ws.map((d, i) => {
      const hot = d.wins.some(id => { const w = W[id]; if (w?.app !== 'chats' || !w.thread) return false; const s = LIVE?.session(w.thread); return s && LIVE.isNew(s); });
      const names = d.wins.map(id => winTitle(W[id])).join(', ');
      return `<button class="ws${!homeOpen && i === cur ? ' cur' : ''}${d.wins.length ? ' used' : ''}${hot ? ' hot' : ''}" data-ws="${i}" aria-label="${esc(names || 'Empty desktop')} · Desktop ${C.workspaceNav.slot(i)}" aria-current="${!homeOpen && i === cur ? 'page' : 'false'}"${C.workspaceNav.slot(i) <= 9 ? ` aria-keyshortcuts="Alt+${C.workspaceNav.slot(i)}"` : ''} title="${esc(names || 'Empty desktop')}${C.workspaceNav.slot(i) <= 9 ? ` (${MOD}${C.workspaceNav.slot(i)})` : ''}">${C.workspaceNav.icon(d, W, appOf)}${d.wins.length || ws.length > 1 ? `<span class="ws-close" role="button" data-wsclose="${i}" tabindex="-1" aria-label="Close desktop ${C.workspaceNav.slot(i)}" title="Close desktop">✕</span>` : ''}</button>`;
    }).join('') + `<button class="ws ws-add" data-newdesk aria-label="New desktop" title="New desktop (${MOD}T${C.workspaceNav.slot(ws.length) <= 9 ? ` / ${MOD}${C.workspaceNav.slot(ws.length)}` : ''})">+</button>`;
    const st = $('#status');
    if (!LIVE?.ok) st.innerHTML = `<span class="off">${LIVE?.error === 'access' ? 'Sign in to Wizard' : 'Connecting…'}</span>`;
    else st.innerHTML = `${L.needs.length ? `<span title="Needs you"><i class="st needs"></i>${L.needs.length}</span>` : ''}<span title="Unread"><i class="st unread"></i>${L.ready.length}</span>${L.working.length ? `<span title="Working"><i class="st working"></i>${L.working.length}</span>` : ''}`;
  }
  function tickClock() { const C = window.WizConfig; $('#clock').textContent = C.dateLabel() + '  ' + C.hm(); }
  setInterval(tickClock, 15000); tickClock(); window.addEventListener('wizard:config', tickClock);
  $('#wsList').addEventListener('click', e => {
    const close = e.target.closest('[data-wsclose]');
    if (close) { e.preventDefault(); e.stopPropagation(); return closeDesktop(+close.dataset.wsclose); }
    if (e.target.closest('[data-newdesk]')) return newDesktop();
    const b = e.target.closest('[data-ws]'); if (b) goWs(+b.dataset.ws);
  });
  function desktopMenu(b, x, y) {
    const d = ws[+b.dataset.ws]; if (!d) return;
    window.WosContextMenu.open({ anchor: b, x, y, label: 'Desktop actions',
      // Keep the stable desktop, not its index: a reorder must not close another desk.
      items: [{ label: 'Close desktop', action: () => closeDesktop(ws.indexOf(d)) }] });
  }
  $('#wsList').addEventListener('contextmenu', e => {
    const b = e.target.closest('.ws[data-ws]'); if (!b) return;
    e.preventDefault(); desktopMenu(b, e.clientX, e.clientY);
  });
  $('#wsList').addEventListener('keydown', e => {
    const b = e.target.closest('.ws[data-ws]'); if (!b) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); desktopMenu(b); }
    else if (e.target.matches('[data-wsclose]') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); closeDesktop(+e.target.dataset.wsclose); }
  });
  /* Arrange desktops: drag one along the top bar (touch: press and hold, then drag), or ⌥⇧[ / ⌥⇧] for the one in
   * front. Desks keep their stable IDs, so open apps never remount; the new order syncs like any desk change. */
  function moveDesk(from, to) {
    if (from === to || !ws[from] || to < 0 || to >= ws.length) return false;
    const curD = ws[cur], lastD = ws[lastWs];
    ws.splice(to, 0, ws.splice(from, 1)[0]);
    cur = ws.indexOf(curD); lastWs = Math.max(0, ws.indexOf(lastD)); save(); render(); return true;
  }
  {
    const list = $('#wsList'), slots = () => $$('.ws[data-ws]', list);
    let dd = null, swallow = 0;
    const start = () => { dd.on = true; dd.b.classList.add('ws-moving'); list.classList.add('arranging'); try { list.setPointerCapture(dd.id); } catch (e) { /* already released */ } navigator.vibrate?.(8); };
    list.addEventListener('pointerdown', e => {
      const b = e.target.closest('.ws[data-ws]'); if (!b || e.target.closest('[data-wsclose]') || e.button !== 0 || ws.length < 2) return;
      dd = { from: +b.dataset.ws, b, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, touch: e.pointerType !== 'mouse' };
      if (dd.touch) dd.hold = setTimeout(() => { if (dd && !dd.on) start(); }, 400);
    });
    list.addEventListener('pointermove', e => {
      if (!dd || e.pointerId !== dd.id) return;
      const far = Math.hypot(e.clientX - dd.x, e.clientY - dd.y) > 6;
      if (!dd.on) { if (!far) return; if (dd.touch) { clearTimeout(dd.hold); dd = null; return; } start(); }
      e.preventDefault();
      const next = slots().find(x => x !== dd.b && (r => e.clientX < r.left + r.width / 2)(x.getBoundingClientRect()));
      const ref = next || list.querySelector('[data-newdesk]');
      if (dd.b.nextElementSibling !== ref) list.insertBefore(dd.b, ref);
    });
    const end = () => {
      if (!dd) return; const d = dd; dd = null; clearTimeout(d.hold);
      if (!d.on) return;
      swallow = Date.now() + 400;
      d.b.classList.remove('ws-moving'); list.classList.remove('arranging');
      const to = d.b.isConnected ? slots().indexOf(d.b) : -1;
      if (!moveDesk(d.from, to)) paintBar();
    };
    list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
    list.addEventListener('click', e => { if (Date.now() < swallow) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }
  $('#logo').addEventListener('click', () => goHome());
  $('#searchBtn').addEventListener('click', () => openPalette());
  $('#status').addEventListener('click', () => openChatsList());
  $('#clock').addEventListener('click', () => goHome());
  $('#keysBtn').addEventListener('click', () => toggleKeys());
  $('#micBtn').addEventListener('click', () => talk());
  $('#voiceCancel').addEventListener('click', () => vMode === 'dictate' ? dictate('cancel') : talk('cancel'));
  // No transcriber on this Wizard: the mic button hides (the outbox still keeps typed messages safe).
  // Capability changes include background native Parakeet preparation, not just bootstrap.
  const paintVoiceCapability = () => { $('#micBtn').hidden = !window.WizConfig.has('voice'); };
  window.WizConfig?.ready.then(paintVoiceCapability);
  window.addEventListener('wizard:config', paintVoiceCapability);

  /* Home is a root view, separate from desktops: every open app and draft stays mounted. */
  function leaveHome() {
    window.WosResources?.back();
    if (!homeOpen) return;
    homeOpen = false; store.set('homeOpen', false); render();
  }
  function goHome() {
    if (!CHATS.beforeNavigate([])) return;
    window.WosResources?.back();
    for (const id of Object.keys(W)) if (W[id].app === 'chats') CHATS.saveDraft(id);
    closePalette(); toggleKeys(false); closeSettings(); closeUsage();
    window.WizWebUpdate?.back(); // Preserve the accepted shared banner; fold its navigation list.
    LINKS?.close();
    for (let i = 0; i < 20 && CHATS.closeOverlay(); i++) { /* Close navigation sheets, never the recorder. */ }
    homeOpen = true; store.set('homeOpen', true); render();
    $('#desktopHome').focus({ preventScroll: true });
  }

  /* ---------------- home (root / empty workspace) ---------------- */
  /* Miguel's skins: the desktop Home is the phone Home at desktop size (Miguel, 24 Oct 2026): resource dials on top, Ready
   * and Working as the same dot counters. Settings stays in the top bar (one gear). No clock, thread lists, app chips or key hints. */
  function mineHomeDots(kind, n) {
    const icon = kind === 'ready' ? '<path d="M5 12.5l4.5 4.5L19 7"/>' : '<path d="M12 3a9 9 0 1 0 9 9"/>';
    const shown = Math.min(n, 12), dots = Array.from({ length: shown }, (_, k) => `<i style="--n:${k}"></i>`).join('');
    return `<span class="nc-vis${n ? '' : ' nc-zero'}" aria-hidden="true"><svg class="nc-ic" viewBox="0 0 24 24">${icon}</svg>${dots}${n > shown ? '<em>+</em>' : ''}</span>`;
  }
  function mineHomeHtml() {
    const G = LIVE?.ok ? LIVE.workGroups() : {}, ready = (G.ready || []).length + (window.WosBell?.readyCount?.() || 0), working = (G.working || []).length;
    const pending = OUTBOX?.unsent() || [];
    return `<div class="home-in mine-home"><div data-slot="home-main" hidden></div>
      <div class="mh-res">${window.WosResources?.home() || ''}</div>
      <div class="mh-gap"></div>
      ${LIVE?.ok ? '' : '<div class="home-line">Connecting to Wizard…</div>'}
      <div class="constellation">
        <button class="now-card wz-home-widget" style="--c:var(--green)" data-home-act="ready" aria-label="Ready ${ready}"><span class="meta"><span class="k">Ready</span></span><span class="n">${ready}</span>${mineHomeDots('ready', ready)}</button>
        <button class="now-card wz-home-widget" style="--c:var(--violet-2)" data-home-act="working" aria-label="Working ${working}"><span class="meta"><span class="k">Working</span></span><span class="n">${working}</span>${mineHomeDots('working', working)}</button>
      </div>
      ${pending.length ? `<button class="home-unsent" data-home-unsent>${pending.length} ${pending.some(u => u.state === 'failed') ? 'not sent' : 'waiting to send'} · View unsent messages</button>` : ''}
    </div>`;
  }
  // Home repaints go through the skin host so a tweak's home-main mount survives (plain innerHTML without one).
  function paintHome(el, html) { if (window.WosSkinHost?.paintHome) window.WosSkinHost.paintHome(el, html); else el.innerHTML = html; }
  function homeHtml(i) {
    if (mine()) return mineHomeHtml();
    const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] };
    const pending = OUTBOX?.unsent() || [];
    const working = LIVE?.ok ? LIVE.workGroups().working || [] : [];
    const rows = list => list.slice(0, 6).map(s => `<button class="home-row" data-thread="${esc(s.id)}"><span class="emo">${emoOf(s.id)}</span><span class="nm">${esc(s.title)}</span><time>${esc(ago(LIVE.cardAt(s)))}</time></button>`).join('') || '<div class="home-none">Nothing here.</div>';
    const quick = (window.WizLauncher?.get('desktopQuick') || []).flatMap(id => id === 'wizard' ? [id, ...APPS.filter(a => a.agent).map(a => a.id)] : [id]).map(id => APP[id]).filter(Boolean);
    return `<div class="home-in"><div data-slot="home-main" hidden></div>
      <nav class="home-tools" aria-label="System and settings"><button data-home-settings>Settings</button></nav>
      <div class="home-time">${window.WizConfig.hm()}</div>
      <div class="home-date">${window.WizConfig.dateLabel(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}${i == null ? '' : ` · Desktop ${C.workspaceNav.slot(i)}`}</div>
      <div class="home-line">${LIVE?.ok ? `<b>${L.needs.length} need${L.needs.length === 1 ? 's' : ''} you</b>, ${L.ready.length} unread, ${working.length} working.` : 'Connecting to Wizard…'}</div>
      <div class="home-cols"><div class="home-card"><h4>Needs you · Unread</h4>${rows(L.needs.concat(L.ready))}</div><div class="home-card"><h4>Working</h4>${rows(working)}</div></div>
      ${pending.length ? `<button class="home-unsent" data-home-unsent>${pending.length} ${pending.some(u => u.state === 'failed') ? 'not sent' : 'waiting to send'} · View unsent messages</button>` : ''}
      <h3 class="home-resources-title">Resources</h3>${window.WosResources?.home() || ''}
      <div class="home-apps">${quick.map(a => `<button class="app-chip" data-app="${a.id}">${ico('i', '', a)}${esc(a.name)}</button>`).join('')}</div>
      <div class="home-keys"><span><kbd>${MOD}\`</kbd> Home</span><span><kbd>${MOD}O</kbd> open an app</span><span><kbd>${MOD}Space</kbd> search</span><span><kbd>${MOD}N</kbd> new chat</span><span><kbd>${MOD}V</kbd> new voice chat</span><span><kbd>${MOD}T</kbd> new desktop</span><span><kbd>${MOD}/</kbd> all keys</span></div>
    </div>`;
  }
  stage.addEventListener('click', e => {
    if (e.target.closest('[data-home-settings]')) return openSettings();
    if (e.target.closest('[data-home-unsent]')) return openSettings('unsent');
    const ha = e.target.closest('.home [data-home-act]')?.dataset.homeAct;
    if (ha) { openApp(APP.wizard); const w = ws[cur].wins.map(id => W[id]).find(x => x?.app === 'chats' && !x.agent); if (w) { if (ha === 'working') CHATS.setFilter(w, 'working'); else CHATS.clearFilter?.(w); } return; }
    const hr = e.target.closest('.home [data-thread]'); if (hr) return openThread(hr.dataset.thread);
    const ap = e.target.closest('.home [data-app]'); if (ap) return openApp(APP[ap.dataset.app]);
  });

  /* ---------------- window interactions ---------------- */
  stage.addEventListener('pointerdown', e => { const el = e.target.closest('.win'); if (el) focusWin(el.dataset.win, { scroll: false }); }, true);
  stage.addEventListener('click', e => {
    const el = e.target.closest('.win'); if (!el) return;
    const id = el.dataset.win, w = W[id];
    const act = e.target.closest('[data-wact]')?.dataset.wact;
    if (act === 'hud') return hudOn(id);
    if (act === 'hud-home') return hudDock({ to: 0 });
    if (act === 'close' && hud?.id === id) return CHATS.beforeLeave(id) && hudClose();
    if (act === 'close') return closeWin(id);
    if (act === 'reload') return reloadWin(id);
    if (act === 'mono') return toggleMono();
    if (act === 'pop') { const a = appOf(w); let href = a.url; try { href = el.querySelector('iframe').contentWindow.location.href; } catch (err) {} return window.open(href, '_blank', 'noopener'); }
    if (w?.app === 'chats' || CHATS.isHosted(id)) {
      // Topic emoji taps belong to shared Chats; do not let the desktop pane adapter open the row first.
      if (e.target.closest('[data-chpick]')) { const cid = e.target.closest('[data-chats]')?.dataset.chats; if (cid && CHATS.click(e, cid)) { e.stopPropagation(); syncChatsPane(id); return; } }
      // Rows in the list pane open in this window's thread pane.
      const row = e.target.closest('[data-chopen]');
      if (row && e.target.closest('.pane-list') && CHATS.justPressed()) { e.stopPropagation(); return; } // a long-press/right-click just opened the actions sheet
      if (row && e.target.closest('.pane-list') && !e.target.closest('.ch-sheet')) { e.stopPropagation(); CHATS.openChat(id, row.dataset.chopen); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      if (e.target.closest('.pane-list [data-chnew]') || e.target.closest('[data-panenew]')) { e.stopPropagation(); CHATS.openNewDraft(id, ''); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      const dr = e.target.closest('.pane-list [data-chdraft]'); if (dr && !e.target.closest('[data-chdraftx]')) { e.stopPropagation(); CHATS.openNewDraft(id, dr.dataset.chdraft); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      const cid = e.target.closest('[data-chats]')?.dataset.chats; if (cid && CHATS.click(e, cid)) { syncChatsPane(id); return; }
    }
  });
  stage.addEventListener('dblclick', e => { if (e.target.closest('.wbar') && !e.target.closest('[data-wact]') && !e.target.closest('.win.hud')) toggleMono(); });
  CHATS.bind(stage);
  // List pane search lives on the ::list window; keep thread selection painted after it re-renders.
  stage.addEventListener('input', e => { if (e.target.matches('[data-chsearch]')) { const id = e.target.closest('.win')?.dataset.win; if (id) syncChatsPane(id); } });

  /* Drag a window by its title bar: drop on another window to swap, or on a workspace number to move it. */
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]') || e.button !== 0) return;
    drag = { id: bar.closest('.win').dataset.win, x: e.clientX, y: e.clientY, on: false };
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { drag.on = true; winEl(drag.id)?.classList.add('drag'); }
    if (!drag.on) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    $$('.drop-target, .ws.drop').forEach(x => x.classList.remove('drop-target', 'drop'));
    const over = t?.closest('.win'); if (over && over.dataset.win !== drag.id) over.classList.add('drop-target');
    const wsb = t?.closest('.ws'); if (wsb) wsb.classList.add('drop');
  });
  addEventListener('pointerup', e => {
    if (!drag) return; const d = drag; drag = null;
    winEl(d.id)?.classList.remove('drag');
    const t = d.on ? document.elementFromPoint(e.clientX, e.clientY) : null;
    $$('.drop-target, .ws.drop').forEach(x => x.classList.remove('drop-target', 'drop'));
    if (!t) return;
    const wsb = t.closest('.ws'); if (wsb) return moveWin(d.id, +wsb.dataset.ws);
    const over = t.closest('.win');
    if (over && over.dataset.win !== d.id) { const L = ws[cur].wins, a = L.indexOf(d.id), b = L.indexOf(over.dataset.win); if (a >= 0 && b >= 0) { [L[a], L[b]] = [L[b], L[a]]; save(); layout(); } }
  });
  addEventListener('resize', () => layout());

  /* ---------------- palette: one box for apps, threads, commands and asking Archimedes ----------------
   * Two modes of the same box. 'all' (⌘K): apps, threads, commands, Search and Ask, as a list.
   * 'apps' (⌘O, and every new desktop): the app selector, the apps alone as square tiles like the
   * phone's launcher, search focused; ←↑↓→ move through the grid, ↵ opens, ⌘K widens to 'all'.
   * Opening remembers what had focus; Esc, Back or a click outside puts it back. Nothing is written. */
  const pal = $('#palette'), palCard = $('.pal-card', pal), palIn = $('#palInput'), palList = $('#palList');
  let palItems = [], palSel = 0, palMode = 'all', palDesk = null, palPrev = null;
  // The agent's name comes from Wizard OS settings; keep static labels in step with it.
  function palPaint() {
    const apps = palMode === 'apps';
    pal.dataset.mode = palMode;
    palCard.setAttribute('aria-label', apps ? 'Open an app' : 'Search and launch');
    palList.setAttribute('aria-label', apps ? 'Apps' : 'Results');
    palIn.placeholder = apps ? 'Search apps' : `Open an app, find a thread, or ask ${window.WizConfig.agent()}…`;
    palIn.setAttribute('aria-label', apps ? 'Search apps' : `Search apps, threads and commands, or ask ${window.WizConfig.agent()}`);
  }
  const nameLabels = () => {
    palPaint();
    document.querySelectorAll('[data-agent-name]').forEach(el => { el.textContent = window.WizConfig.agent(); });
  };
  nameLabels(); window.addEventListener('wizard:config', nameLabels);
  function commands() {
    return [
      { kind: 'cmd', name: 'Home', icon: '⌂', keys: `${MOD}\``, run: () => goHome() },
      { kind: 'cmd', name: 'Open an app', icon: '▦', keys: `${MOD}O`, run: () => openPicker() },
      ...(window.WosResources ? [{ kind: 'cmd', name: 'Resources', icon: '◔', run: () => { goHome(); $('#desktopHome [data-res-open="server"]')?.click(); } }] : []),
      { kind: 'cmd', name: 'Get apps', icon: '+', run: () => openApp(APP['app-store']) },
      { kind: 'cmd', name: 'New desktop', icon: '+', keys: `${MOD}T`, run: () => newDesktop() },
      { kind: 'cmd', name: 'Next window', icon: '→', keys: `${MOD}]`, run: () => stepWin(1) },
      { kind: 'cmd', name: 'Previous window', icon: '←', keys: `${MOD}[`, run: () => stepWin(-1) },
      { kind: 'cmd', name: 'Next desktop', icon: '→', run: () => stepDesk(1) },
      { kind: 'cmd', name: 'Previous desktop', icon: '←', run: () => stepDesk(-1) },
      { kind: 'cmd', name: 'New chat', icon: '✎', keys: `${MOD}N`, run: () => newChat({ fresh: true }) },
      { kind: 'cmd', name: 'New voice chat', icon: '🎙', keys: `${MOD}V`, run: () => talkNew() },
      { kind: 'cmd', name: `Talk to ${window.WizConfig.agent()}`, icon: '🎙', keys: 'Right ⌘', run: () => talk() },
      { kind: 'cmd', name: 'Dictate', icon: '✎', keys: 'Right ⌥', run: () => dictate() },
      { kind: 'cmd', name: 'Chats', icon: '⬇', keys: `${MOD}I`, run: () => openChatsList() },
      ...(window.WosFiles ? [{ kind: 'cmd', name: 'Files', icon: '▤', run: () => openFiles() }] : []),
      ...(window.WosUsage ? [{ kind: 'cmd', name: 'AI usage', icon: '◔', run: () => openUsage() }] : []),
      { kind: 'cmd', name: 'Close app / empty desktop', icon: '✕', keys: `${MOD}W`, run: () => closeCurrent() },
      { kind: 'cmd', name: hud ? 'Chat back to desktop 1' : 'Float chat over every desk', icon: hud ? '1' : '◉', keys: `${MOD}P`, run: () => hudKey() },
      { kind: 'cmd', name: 'Full screen', icon: '⤢', keys: `${MOD}F`, run: () => toggleMono() },
      { kind: 'cmd', name: 'Refresh window', icon: '↻', keys: `${MOD}R`, run: () => reloadCurrent() },
      { kind: 'cmd', name: 'Keys guide', icon: '⌨', keys: `${MOD}/`, run: () => toggleKeys(true) },
      { kind: 'cmd', name: 'Settings', icon: '⚙', keys: `${MOD},`, run: () => openSettings() },
      { kind: 'cmd', name: 'Use the phone layout here', icon: '📱', run: () => { location.href = './?shell=phone'; } },
      { kind: 'cmd', name: 'Reset desktop layout', icon: '↺', run: () => { Object.keys(localStorage).filter(k => k.startsWith('wux.desk.')).forEach(k => localStorage.removeItem(k)); location.reload(); } },
    ];
  }
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
  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);
  // The app selector's apps: Chats first, installed apps in registry order, then the system apps.
  // A query ranks them like ⌘K's Apps group does.
  const SYS_APPS = ['agents', 'app-store'];
  const pickRank = a => a.kind === 'chats' ? 0 : SYS_APPS.includes(a.id) ? 3 : 1;
  function pickBuild(q) {
    const list = norm(q) ? searchApps(q) : APPS.slice().sort((a, b) => pickRank(a) - pickRank(b) || SYS_APPS.indexOf(a.id) - SYS_APPS.indexOf(b.id));
    return list.filter(a => a.kind !== 'native' && a.id !== 'agents' && !C.isMaintenanceApp(a)).map(a => ({ kind: 'app', app: a, name: a.name, sub: a.desc, run: o => openApp(a, o) }));
  }
  /* Miguel's skins (Dark, Light, Landscapes): the selector is the phone launcher at desktop size (core/app-kinds.js): Apps with
   * system apps first and ringed, "+ Get apps", then one folded "For agents" row holding Agent apps, Agents (with
   * "+ Build agents") and Connectors, each ending in its own "+ Get ..." tile. Search stays one flat list. */
  const mine = () => ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'].includes(document.documentElement.dataset.skin || ''); // Miguel's skins
  let palFold = false;
  function openStoreKind(kind) {
    const url = window.WosAppKinds.storeUrl(kind);
    const ex = findWin(w => w.app === 'frame' && w.appId === 'app-store');
    if (ex) { ex.url = url; const f = winEl(ex.id)?.querySelector('iframe'); if (f) f.src = url; focusWin(ex.id); save(); return; }
    newWin({ app: 'frame', appId: 'app-store', url });
  }
  function pickKinds() {
    const AK = window.WosAppKinds, K = AK.kinds(APPS, APP), out = [];
    const app = a => ({ kind: 'app', app: a, name: a.name, sub: a.desc, sys: AK.isSystem(a), run: o => a.url || a.kind !== 'wizard' ? openApp(a, o) : window.WosAppRoute?.open(a.id, { name: a.name }) });
    const get = k => ({ kind: 'app', get: true, name: AK.GET[k][1], run: () => openStoreKind(AK.GET[k][0]) });
    const group = (k, list, extra = []) => out.push({ head: AK.LABELS[k], items: [...AK.sysFirst(list).map(app), ...extra, get(k)] });
    group('apps', K.apps);
    const n = K.wiz.length + K.agents.length + K.conns.length;
    out.push({ fold: true, n });
    if (palFold) {
      group('wiz', K.wiz);
      group('agents', K.agents, K.builder ? [{ kind: 'app', get: true, name: 'Build agents', run: o => openApp(K.builder, o) }] : []);
      group('conns', K.conns);
    }
    return out;
  }
  function pickRender() {
    palItems = pickBuild(palIn.value); palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    if (mine() && !norm(palIn.value) && window.WosAppKinds) {
      const blocks = pickKinds(); palItems = []; const html = [];
      const tile = it => { const i = palItems.push(it) - 1;
        const ic = it.get ? '<span class="ic pal-plus">+</span>' : ico('span', 'ic', it.app);
        return `<button type="button" class="pal-app${it.sys ? ' pal-sys' : ''}${it.get ? ' pal-get' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-selected="false" title="${esc(it.sub ? `${it.name} · ${it.sub}` : it.name)}">${ic}<span class="nm">${esc(it.name)}</span></button>`; };
      for (const b of blocks) {
        if (b.fold) { const i = palItems.push({ kind: 'fold', name: 'For agents', run: () => { palFold = !palFold; pickRender(); palIn.focus(); } }) - 1;
          html.push(`<button type="button" class="pal-fold${palFold ? ' open' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-expanded="${palFold}"><span>For agents</span><small>${b.n}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`); continue; }
        html.push(`<div class="pal-grp pal-kind" role="presentation">${esc(b.head)}</div>` + b.items.map(tile).join(''));
      }
      palList.innerHTML = html.join(''); palSel = Math.min(palSel, palItems.length - 1);
      return palMark(palSel);
    }
    palList.innerHTML = palItems.map((it, i) => `<button type="button" class="pal-app${i === palSel ? ' sel' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-selected="${i === palSel}" title="${esc(it.sub ? `${it.name} · ${it.sub}` : it.name)}">${ico('span', 'ic', it.app)}<span class="nm">${esc(it.name)}</span></button>`).join('')
      || `<div class="pal-empty">No app called “${esc(clip(palIn.value.trim(), 40))}”.<br><kbd>↵</kbd> searches threads and commands too</div>`;
    palMark(palSel);
  }
  // Move the selection without rebuilding the list, so a hovered or arrowed tile never flickers.
  function palMark(i) {
    palSel = i;
    for (const b of palList.querySelectorAll('[data-i]')) { const on = +b.dataset.i === i; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); }
    if (palItems.length) palIn.setAttribute('aria-activedescendant', `pal-o${i}`); else palIn.removeAttribute('aria-activedescendant');
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  // Grid arrows are spatial: ←/→ step one tile, ↑/↓ one row; ↓ from a row above a short last row lands on its last tile.
  function pickMove(key) {
    const n = palItems.length; if (!n) return;
    if (palList.querySelector('.pal-kind, .pal-fold')) {   // grouped: rows differ in length, so move by position on screen
      const tiles = [...palList.querySelectorAll('[data-i]')], cur = tiles[palSel];
      if (key === 'ArrowRight') return palMark(Math.min(n - 1, palSel + 1));
      if (key === 'ArrowLeft') return palMark(Math.max(0, palSel - 1));
      const down = key === 'ArrowDown', rows = tiles.filter(t => down ? t.offsetTop > cur.offsetTop : t.offsetTop < cur.offsetTop);
      if (!rows.length) return;
      const y = down ? Math.min(...rows.map(t => t.offsetTop)) : Math.max(...rows.map(t => t.offsetTop));
      const row = rows.filter(t => t.offsetTop === y);
      const best = row.reduce((a, b) => Math.abs(b.offsetLeft - cur.offsetLeft) < Math.abs(a.offsetLeft - cur.offsetLeft) ? b : a);
      return palMark(+best.dataset.i);
    }
    const tiles = palList.querySelectorAll('[data-i]'), top = tiles[0].offsetTop;
    let cols = 0; while (cols < tiles.length && tiles[cols].offsetTop === top) cols++;
    const i = palSel, row = Math.floor(i / cols), last = Math.floor((n - 1) / cols);
    const j = key === 'ArrowRight' ? Math.min(n - 1, i + 1) : key === 'ArrowLeft' ? Math.max(0, i - 1)
      : key === 'ArrowDown' ? (row < last ? Math.min(n - 1, i + cols) : i) : (row > 0 ? i - cols : i);
    palMark(j);
  }
  function palRender() {
    if (palMode === 'apps') return pickRender();
    const groups = palBuild(palIn.value); palItems = groups.flatMap(g => g.items); palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let k = 0;
    palList.innerHTML = groups.map((g, gi) => `<div role="group" aria-labelledby="pal-g${gi}"><div class="pal-grp" id="pal-g${gi}">${esc(g.grp)}</div>` + g.items.map(it => { const i = k++; return `<button type="button" class="pal-it${i === palSel ? ' sel' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-selected="${i === palSel}">${it.app ? ico('span', 'ic', it.app) : `<span class="ic" style="--g1:${it.g?.[0] || '#3a2a6a'};--g2:${it.g?.[1] || '#241a44'}">${it.kind === 'ask' ? window.WizBrand.html : it.icon || '◇'}</span>`}<span class="nm">${esc(it.name)}${it.sub ? `<small>${esc(clip(it.sub, 60))}</small>` : ''}</span>${it.keys ? `<span class="hint"><kbd>${esc(it.keys)}</kbd></span>` : ''}</button>`; }).join('') + '</div>').join('') || '<div class="pal-empty">Nothing yet.</div>';
    palMark(palSel);
  }
  // mode 'all' is ⌘K; 'apps' is the app selector. o.desk ties a selector to the empty desktop it opened on.
  function openPalette(q = '', mode = 'all', o = {}) {
    window.WosResources?.back(); // after Resources hands focus back to its opener, so that is what Esc restores
    const a = document.activeElement;
    if (pal.hidden) palPrev = a && a !== document.body && !pal.contains(a) ? a : null;
    palDesk = o.desk || null; palMode = mode; palPaint();
    pal.hidden = false; palIn.value = q; palSel = 0; palRender(); palIn.focus(); palIn.select();
    window.WizCore.refreshApps?.({afterPending:true}); // also refresh after a pending pre-opening snapshot
  }
  const openPicker = (o = {}) => openPalette('', 'apps', o);
  // ⌘K and ⌘O switch an open box between its modes, keeping the query; the same key again closes it.
  function palToggle(mode) {
    if (pal.hidden) return openPalette('', mode);
    if (palMode === mode) return closePalette();
    palMode = mode; palPaint(); palSel = 0; palRender(); palIn.focus();
    window.WizCore.refreshApps?.({afterPending:true});
  }
  function closePalette({ restore = true } = {}) {
    if (pal.hidden) return;
    pal.hidden = true; palDesk = null;
    const prev = palPrev; palPrev = null;
    if (!restore) return;
    if (prev?.isConnected && prev.getClientRects().length) prev.focus({ preventScroll: true }); else restFocus();
  }
  // Where focus rests with no layer open: the focused app, else Home, else this empty desktop's surface.
  function restFocus() {
    const f = focused(); if (f) return focusInside(f.id);
    (homeOpen ? $('#desktopHome') : wsEl(cur)?.querySelector(':scope > .home'))?.focus({ preventScroll: true });
  }
  function palRun(i, o = {}) {
    const it = palItems[i]; if (!it) return;
    if (it.kind === 'fold') return it.run();
    // An app takes focus where it opens; anything else returns focus first, then runs (it may open its own layer).
    if (it.kind === 'app') { closePalette({ restore: false }); it.run(o); restFocus(); return; }
    closePalette(); it.run(o);
  }
  window.addEventListener('wizard:apps', () => {
    if (!pal.hidden) palRender();
    if (homeOpen) paintHome($('#desktopHome'), homeHtml(null));
    const h = wsEl(cur)?.querySelector('.home'); if (h) paintHome(h, homeHtml(cur));
  });
  palIn.addEventListener('input', () => { palSel = 0; palRender(); });
  palIn.addEventListener('keydown', e => {
    const n = Math.max(1, palItems.length);
    if (palMode === 'apps') {
      if (e.altKey) return; // window-manager chords belong to the shell
      if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return pickMove(e.key); }
      if (e.ctrlKey && (e.key === 'n' || e.key === 'p')) { e.preventDefault(); return palMark((palSel + (e.key === 'n' ? 1 : -1) + n) % n); }
      if (e.key === 'Enter') {
        e.preventDefault();
        // No app by that name: widen to ⌘K with the same words (threads, commands, Search, Ask).
        if (!palItems.length) { if (palIn.value.trim()) palToggle('all'); return; }
        return palRun(palSel, { fresh: e.shiftKey });
      }
      return;
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); palMark((palSel + 1) % n); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); palMark((palSel - 1 + n) % n); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && palIn.value.trim()) { const q = palIn.value; closePalette(); return ask(q); }
      palRun(palSel, { fresh: e.shiftKey });
    }
  });
  palList.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) palRun(+b.dataset.i, { fresh: e.shiftKey }); });
  /* Keyboard containment (the card is aria-modal). The search box is the box's one tab stop: options are
   * tabindex=-1 and followed by aria-activedescendant, so Tab and ⇧Tab keep focus on the search box and never
   * reach the page behind. An option focused by a click or script stays a native button (↵/Space activate it),
   * takes the selection, and hands arrows and Tab back to the search box. ⌘K, ⌘O, ⌥ chords and Esc are handled
   * before this, on the shell's capture listener (onKey). */
  pal.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); palIn.focus({ preventScroll: true });
  });
  palList.addEventListener('focusin', e => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== palSel) palMark(+b.dataset.i); });
  palList.addEventListener('keydown', e => {
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !e.target.closest('[data-i]')) return;
    e.preventDefault(); palIn.focus({ preventScroll: true });
    if (palMode === 'apps') pickMove(e.key);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') palMark((palSel + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, palItems.length)) % Math.max(1, palItems.length));
  });
  palList.addEventListener('pointermove', e => { const b = palMode === 'apps' && e.target.closest('[data-i]'); if (b && +b.dataset.i !== palSel) palMark(+b.dataset.i); });
  pal.addEventListener('pointerdown', e => { if (e.target === pal) closePalette(); });

  /* Ask Archimedes from anywhere: a new thread, through the durable outbox, delegated in the background.
   * Nothing opens or takes focus; the thread shows up in Chats when James wants it. */
  async function ask(text, how = 'typing in the desktop launcher', audio = null, route = null) {
    text = String(text || '').trim(); if (!text && !audio) return;
    const ctx = viewContext(null, how);
    await OUTBOX.enqueue({ ...(route || {}), kind: 'new', text, audio, instructions: ctx, source: 'orb', how });
    if (!audio) toast('✦', `New thread started · ${window.WizConfig.agent()} is on it`, 1600);
  }

  /* Wizard Files (#23): the shared Files sheet, in a Chats window (attaches to its open thread, else starts a new chat). */
  function openFiles() {
    let w = ws[cur].wins.map(id => W[id]).find(mainChats) || findWin(mainChats);
    if (!w) w = newWin({ app: 'chats', thread: null });
    focusWin(w.id);
    setTimeout(() => CHATS.PW?.openFiles(w.thread ? w.id : w.id + '::list'), 30);
  }
  /* AI usage (#24): the same panel as the phone's Settings, in a card. */
  const usageEl = document.createElement('div');
  usageEl.className = 'keys usage-ov'; usageEl.hidden = true;
  usageEl.innerHTML = '<div class="keys-card" role="dialog" aria-label="AI usage"><div class="keys-head"><b>AI usage</b><small>Quota left on each subscription, and when it resets.</small><button class="x" data-close="usage" aria-label="Close">✕</button></div><div class="usage-body" data-usage-host></div></div>';
  document.body.appendChild(usageEl);
  const paintUsage = () => { if (!usageEl.hidden) usageEl.querySelector('[data-usage-host]').innerHTML = window.WosUsage.html(); };
  function openUsage() { window.WosResources?.back(); usageEl.hidden = false; paintUsage(); window.WosUsage.load(Date.now() - (window.WosUsage.at || 0) > 60e3).then(paintUsage); }
  function closeUsage() { if (usageEl.hidden) return false; usageEl.hidden = true; return true; }
  usageEl.addEventListener('click', e => {
    if (e.target === usageEl || e.target.closest('[data-close]')) return closeUsage();
    if (e.target.closest('[data-usage-refresh]')) { window.WosUsage.load(true).then(paintUsage); paintUsage(); }
  });

  /* Shared responsive feature surface; this adapter owns only desktop navigation and focus. */
  const setEl = document.createElement('section');
  setEl.id = 'dsettings'; setEl.className = 'dsettings'; setEl.hidden = true;
  setEl.setAttribute('role', 'region'); setEl.setAttribute('aria-label', 'Settings');
  setEl.innerHTML = '<button class="st-close" data-close aria-label="Close settings">✕</button><div id="settingsBody"></div>';
  document.body.appendChild(setEl);
  let settingsFocus = null, settingsReturn = '';
  const settingsView = window.WosSettings.mount($('#settingsBody'), {
    shell: 'desktop', outbox: OUTBOX, live: LIVE, ago, toast, visible: () => !setEl.hidden,
    helpSub: 'Keyboard shortcuts, desks and Back',
    openThread: id => { closeSettings(); openThread(id); },
    editUnsent: it => { closeSettings(); editUnsent(it); },
    openLink: (url, title) => { closeSettings(); return openAppLink(url, title); },
    openStore: id => { closeSettings(); newWin({ app: 'frame', appId: 'app-store', url: '/wizard-os-home/store/index.html' + (id ? '?app=' + encodeURIComponent(id) : '') }); },
    chatsChanged: id => { for (const w of Object.values(W)) if (w.app === 'chats' && !w.agent) { w.chatsProvider = id; CHATS.renderChats(w); const list = winEl(w.id)?.querySelector(`[data-chats="${w.id}::list"]`); if (list) CHATS.renderChatList(listWin(w.id), list); syncChatsPane(w.id); } save(); },
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
  const settingsFocused = () => !homeOpen && focused()?.app === 'settings';
  function hostSettings() {
    const w = settingsWin(), host = w && winEl(w.id)?.querySelector('.settings-host');
    if (host) { if (setEl.parentNode !== host) host.appendChild(setEl); return; }
    if (w) return;
    if (setEl.parentNode !== document.body) document.body.appendChild(setEl);
    if (setEl.hidden) return;
    setEl.hidden = true;
    if (settingsFocus?.isConnected && settingsFocus.getClientRects().length) settingsFocus.focus({ preventScroll: true });
    else if (focused()) focusInside(focused().id);
    window.WosScenery?.update();
  }
  afterRender = hostSettings;
  function openSettings(focus) {
    window.WosResources?.back(); closePalette(); toggleKeys(false);
    const w = settingsWin();
    if (w) focusWin(w.id); else { settingsFocus = document.activeElement; newWin({ app: 'settings' }); }
    setEl.hidden = false; settingsReturn = '';
    renderSettings(); settingsView.focus(focus); window.WosScenery?.update();
  }
  function closeSettings() { const w = settingsWin(); if (w) closeWin(w.id); else hostSettings(); }
  function toggleSettings() { if (settingsFocused()) closeSettings(); else openSettings(); }
  function returnToSettings() { if (!settingsReturn) return; const from = settingsReturn; openSettings(); setEl.querySelector(`[data-st="${from}"]`)?.focus({ preventScroll: true }); }
  setEl.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSettings(); });
  $('#settingsBtn').addEventListener('click', () => openSettings());
  C.voiceStatus?.onChange(() => renderSettings());
  OUTBOX?.onChange(() => renderSettings());


  /* Top-bar hover tips: a short line under every bar control, shown right away (native titles wait ~1s). */
  (() => {
    const bar = $('#bar'); if (!bar) return;
    const tip = document.createElement('div'); tip.className = 'bar-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip);
    let on = null;
    const hide = () => { if (on?.dataset.tip != null) { on.title = on.dataset.tip; delete on.dataset.tip; } on = null; tip.hidden = true; };
    bar.addEventListener('pointerover', e => {
      const el = e.target.closest('#bar button[title], #bar button[aria-label], #bar [data-tip]');
      if (el === on) return; hide(); if (!el || el.id === 'clock') return;
      const text = el.dataset.tip || el.title || el.getAttribute('aria-label'); if (!text) return;
      on = el; if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
      tip.textContent = text; tip.hidden = false;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.top = (r.bottom + 6) + 'px';
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    });
    bar.addEventListener('pointerleave', hide); bar.addEventListener('pointerdown', hide);
  })();
  /* ---------------- keys sheet ---------------- */
  // Grouped by what you want to do: speak/ask first, then switch what you see, then arrange.
  // The keys guide is the hold-⌥ overlay (keyHints below); ⌥/ and the bar's ⌥/ button pin it open.
  const keysEl = $('#keys');
  const nativeDesktop = !!window.webkit?.messageHandlers?.wizardNative;
  function toggleKeys(on) { const want = on == null ? !keyHints.pinned() : !!on; if (want) { window.WosResources?.back(); keyHints.show(true); } else keyHints.hide(); }
  function replayTour() { toggleKeys(false); settingsReturn = ''; window.WosTour?.desk?.start('help'); }

  /* ---------------- voice: Right ⌘ talk, Right ⌥ dictate (taps), mic button ----------------
   * Tap to start, tap again to send (never hold). Lands in the focused thread when one is open,
   * otherwise starts a new thread. Audio goes through the durable outbox: transcribed there,
   * kept as a voice note, retried if the network drops. */
  const pill = $('#voicePill'), mic = $('#micBtn');
  document.body.appendChild(pill); // Fixed capture controls must not be clipped by the narrow toolbar scroller.
  const glow = document.createElement('div'); glow.id = 'voiceGlow'; glow.setAttribute('aria-hidden', 'true'); document.body.appendChild(glow); // edge light; never resizes the stage
  let vTarget = null, vConversation = null, vTimer = 0, vMode = 'talk', dTarget = null, vReply = null, vNewChat = false, vNewKey = `${MOD}V`, vContext = '', vRoute = null, vSnapshot = null, vFeedback = null, vFiles = null, commandTake = false, strictReply = false;
  let vHandedOff = null; // a sent take the outbox can finish after a reload
  const VOICE = C.voice({
    onState: st => {
      window.WosCaptureTools.awake(st !== 'idle');
      $('#voicePause').textContent = st === 'paused' ? 'Resume' : 'Pause';
      $('#voicePause').disabled = !['listen','paused'].includes(st);
      $('#voiceAttach').disabled = $('#voiceScreenshot').disabled = vMode === 'dictate' || commandTake || !['listen','paused'].includes(st);
      pill.hidden = st === 'idle'; pill.classList.toggle('think', st === 'think'); mic.classList.toggle('on', st !== 'idle');
      const rootCls = document.documentElement.classList; rootCls.toggle('voice-on', st !== 'idle'); rootCls.toggle('voice-paused', st === 'paused'); rootCls.toggle('voice-think', st === 'think'); if (st === 'idle') glow.style.setProperty('--vglow-lvl', '0');
      CHATS.PW?.paintMic(['listen','paused'].includes(st) && !!vReply, vReply?.sid || '');
      $('#clock').hidden = st !== 'idle';
      pill.classList.toggle('dict', vMode === 'dictate');
      pill.classList.toggle('app-voice', vMode === 'talk' && !!vConversation);
      $('#voiceKey').textContent = vMode === 'dictate' ? `${MOD}D` : commandTake ? `${MOD}C` : vNewChat ? vNewKey : nativeDesktop ? 'Right ⌘' : `${MOD}S`;
      $('#voiceAct').textContent = vMode === 'dictate' ? 'insert' : commandTake ? 'run locally' : 'send';
      $('#voiceText').textContent = vMode === 'dictate' ? (st === 'think' ? 'Transcribing…' : 'Dictating')
        : st === 'think' ? 'Sending…' : commandTake ? 'Local command · nothing sent to agent' : vConversation ? 'Listening · ' + vConversation.label : vFeedback ? 'Feedback · '+clip(vFeedback.title || vFeedback.thread,28) : vTarget ? `Listening · to “${clip(winTitle(W[vTarget]), 28)}”` : 'Listening · new chat';
      clearInterval(vTimer);
      if (st === 'listen') vTimer = setInterval(() => { const s = Math.floor(VOICE.elapsed() / 1000); $('#voiceTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    },
    onLevel: l => { $('#voiceLvl').style.width = Math.round(l * 100) + '%'; glow.style.setProperty('--vglow-lvl', Math.min(1, l * 1.6).toFixed(2)); },
  });
  function paintVoiceFiles() {
    const root=$('#voiceFiles'); if (!root) return;
    root.innerHTML=(vFiles?.files||[]).map((f,i)=>`<div>${esc(f.name||f.filename)} ${f.uploading?'Uploading…':f.error?'Upload failed':''} ${f.error?`<button data-vretry="${i}">Retry</button>`:''}${!f.uploading?`<button data-vremove="${i}">Remove</button>`:''}</div>`).join('');
  }
  async function commandVoice() { if(VOICE.state==='idle') { const r=await talk('start'); if(r==='voice'){commandTake=true;vConversation=null;$('#voiceKey').textContent=`${MOD}C`;$('#voiceText').textContent='Local command · nothing sent to agent';$('#voiceAct').textContent='run locally';$('#voiceAttach').disabled=$('#voiceScreenshot').disabled=true;}return r; } if(commandTake)return talk('send');return 'busy'; }
  $('#voicePause').onclick=()=>VOICE.state==='paused'?VOICE.resume():VOICE.pause();
  $('#voiceSend').onclick=()=>vMode==='dictate'?dictate():talk('send');
  $('#commandBtn').onclick=()=>commandVoice();
  $('#dictateBtn').onpointerdown=e=>{fields().refresh();e.preventDefault();};
  $('#dictateBtn').onclick=()=>dictate();
  $('#voiceAttach').onclick=()=>$('#voiceFileInput').click();
  $('#voiceFileInput').onchange=e=>{for(const file of e.target.files)vFiles?.add(file);e.target.value='';};
  $('#voiceScreenshot').hidden=!window.WosCaptureTools.screenshotAvailable();
  $('#voiceScreenshot').onclick=()=>vFiles?.screenshot(()=>{pill.style.visibility='hidden';return ()=>pill.style.visibility='';}).catch(e=>toast('!',e.message,2600));
  $('#voiceFiles').onclick=e=>{const b=e.target.closest('button');if(!b)return;const t=vFiles;if(b.dataset.vretry!=null)t.retry(t.files[+b.dataset.vretry]);if(b.dataset.vremove!=null)t.remove(t.files[+b.dataset.vremove]);};

  // ⌥S: starts screen speech / a reply; again sends only that kind of take, never a ⌥V or ⌥C one.
  function speakScreen() {
    if (VOICE.state === 'idle') return talk();
    if (['listen','paused'].includes(VOICE.state) && vMode === 'talk' && !vNewChat && !commandTake) return talk('send');
    toast('🎙', 'Finish the current recording first', 2000);
    return 'busy';
  }
  // A separate chord always starts a new thread, even with an existing thread focused.
  // Never retarget an in-flight reply/dictation or discard it when the new-voice chord is pressed.
  function talkNew(key = `${MOD}V`) {
    if (VOICE.state === 'idle') return talk('start', true, key);
    if (['listen','paused'].includes(VOICE.state) && vMode === 'talk' && vNewChat) return talk('send');
    toast('🎙', 'Finish the current recording before starting a new voice chat', 2400);
    return 'busy';
  }
  const generalVoice = document.createElement('button');
  generalVoice.id = 'generalVoice'; generalVoice.className = 'general-voice';
  const paintGeneralVoice = () => { const l = 'New voice chat; shares nothing from this screen (⌥V)'; generalVoice.className = 'mic general-voice-ic'; generalVoice.innerHTML = '<svg viewBox="0 0 24 24"><path d="M10 13a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Zm-5.5-3a5.5 5.5 0 0 0 11 0M10 15.5V19M19 4v6M16 7h6"/></svg>'; generalVoice.setAttribute('aria-label', l); generalVoice.title = l; };
  paintGeneralVoice(); window.addEventListener('wizard:config', paintGeneralVoice);
  mic.insertAdjacentElement('afterend', generalVoice);
  generalVoice.addEventListener('click', () => talkNew('Tap to send'));
  async function loadVoiceModels() {
    let timer; toast('◷', 'Loading voice model…', 1800);
    try { await Promise.race([window.WosModels.load(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Models unavailable · recording has not started')), 8000); })]); }
    finally { clearTimeout(timer); }
  }
  async function talk(action = 'toggle', forceNew = false, newKey = `${MOD}V`) {
    if (VOICE.state === 'idle' && CHATS.incognitoActive(focused()?.id)) { toast('!', 'Incognito is text only · finish it before recording', 2600); return 'busy'; }
    if (dictationFinishing || VOICE.state === 'think') return 'busy';
    if (action === 'cancel') { commandTake = false; if (VOICE.state !== 'idle') { vFiles?.close();vReply = null; const kept = VOICE.cancel(); toast('✕', kept ? 'Cancelled · kept in Settings → Cancelled recordings' : 'Cancelled', kept ? 2600 : 1000); } return 'none'; }
    if (VOICE.state !== 'idle' && vMode === 'dictate') return 'busy';
    if (VOICE.state === 'idle') {
      if (action === 'send') return 'none';
      commandTake = false; strictReply = false; vMode = 'talk'; vNewChat = forceNew; vNewKey = newKey;
      const f = focused(); vSnapshot = commandSnapshot();
      vFeedback = !forceNew && f?.from?.sid ? {thread:f.from.sid,title:f.from.title,url:f.url,context:viewContext(f.id,'feedback on the bound page')} : null;
      vFiles?.close(); vFiles = window.WosCaptureTools.take(CHATS.uploadFile, paintVoiceFiles); paintVoiceFiles();
      vTarget = (f?.app === 'chats' || (!forceNew && CHATS.isHosted(f?.id))) ? f.id : null;
      if (forceNew && vTarget) vSnapshot.thread = '__new__';
      const capability = window.WizAppServices?.voiceInput, app = APP[f?.appId];
      vConversation = !forceNew && !CHATS.isHosted(f?.id) ? (capability ? capability.pin(winEl(f?.id)?.querySelector('iframe'), app?.id)
        : app?.receives_voice_input === true ? { appId: app.id, token: 'unavailable', label: app.name } : null) : null;
      vReply = !forceNew && vTarget && f.thread && f.thread !== '__new__' ? { wid: f.id, sid: f.thread, steerRunId: CHATS.isWorking(LIVE.session(f.thread)) ? LIVE.session(f.thread)?.runId || '' : '' } : null;
      vContext = forceNew ? 'Explicit general-agent voice request. No foreground app or private thread context shared.' : viewContext(vTarget, 'voice, aimed at this thread');
      dictationFinishing = true; // model options may not have loaded while an app is foreground
      try {
        const resolveRoute = () => vFeedback ? window.WosModels.snapshot(vFeedback.thread) : CHATS.modelRoute(forceNew && f?.app === 'chats' ? f.id : vTarget, forceNew || vTarget ? (forceNew ? '__new__' : vSnapshot.thread || '__new__') : '');
        vRoute = vConversation ? null : resolveRoute();
        if (!vConversation && !vRoute) { await loadVoiceModels(); vRoute = resolveRoute(); }
        if (!vConversation && !vRoute?.model) throw Error('Model route unavailable · recording has not started');
      } catch(e) { toast('!',String(e.message || e),2600);return 'busy'; }
      finally { dictationFinishing = false; }
      $('#voiceTime').textContent = '0:00';
      try { await VOICE.start(); } catch (e) { toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
      return 'voice';
    }
    if (action === 'start') return 'voice';
    // Uploads in progress never hold a send (they finish behind it); only a failed file with no bytes left blocks.
    if (vFiles?.files.some(f => f.error && !f.local)) { toast('!', 'Remove the failed upload before sending · take kept', 2600); return 'busy'; }
    if (commandTake) {
      dictationFinishing = true; const snap = vSnapshot;
      try { const r=await VOICE.finish({transcribe:false}); if(!r?.blob)return 'none'; const take=await OUTBOX.retainDictation(r.blob,r.captureId); const it=await OUTBOX.transcribeDictation(take.id);
        // A silent command never happened: nothing to recover. A failed transcription keeps its recording.
        if(!it?.text&&/^No speech detected/.test(it?.error||'')&&await OUTBOX.completeLocal(it.id)){toast('◌','No speech heard · nothing sent',1800);return 'none';}
        if(!it?.text)return 'retained';
        // A command take is never a message: executed or unmatched, its custody finishes here.
        // Music settles on the player's done receipt; a failure keeps the recording.
        const cmd=LOCAL_COMMANDS.parse(it.text,snap,'command'); const music=/^(music|play_music)$/.test(cmd?.action||'');
        const ok=cmd && executeCommand(cmd,it.text,snap,music?(done=>{if(done)OUTBOX.completeLocal(it.id);}):undefined);
        if(!music || !ok) await OUTBOX.completeLocal(it.id);
        toast(ok?'⚡':'!',ok?'Command handled on-device':'No command matched · nothing sent',2600);return ok?'local':'none';
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
    const sealAt = vFeedback || vNewChat ? null : rp ? rp : aimSid ? { wid: vTarget, sid: aimSid } : null;
    let modelRoute;
    try { modelRoute = vRoute; if (!modelRoute) throw Error('Recording-start model unavailable · take kept'); }
    catch (e) { vReply = rp; toast('!', String(e.message || e), 2400); return 'busy'; }
    const t = sealAt ? CHATS.takeComposer(sealAt.wid, sealAt.sid) : null;
    const sealed = t && (t.text || t.files.length || t.reply) ? t : false;
    vHandedOff = null; dictationFinishing = true;
    try {
    const r = await VOICE.finish({ transcribe: false });
    if ((!r || !r.blob) && sealed) sealed.putBack();
    if (!r || !r.blob) { toast('🎙', r?.error || 'Didn’t catch that', 1600); return 'none'; }
    // Files still uploading go as pending placeholders the outbox completes behind the message (never a wait gate).
    const extraFiles = (vFiles?.files || []).map(f=>window.WizUploads?.pending?.ref(f) || (f.id && !f.uploading ? {id:f.id,name:f.name,mime:f.mime,bytes:f.bytes} : null)).filter(f=>f&&f.id);
    if (vFeedback) { const staged=await OUTBOX.stage({kind:'reply',sessionId:vFeedback.thread,...vRoute,audio:r.blob,captureId:r.captureId,files:extraFiles}); const item=await window.WosBoundView.feedback(OUTBOX,{...vFeedback,route:vRoute,custodyId:staged.id},'',r.blob,extraFiles); if(!item){await OUTBOX.transition(staged.id,'held','Feedback unavailable · original kept');toast('!','Feedback kept for its original thread',2600);return 'retained';} toast('✦','Feedback kept · waiting to send',1800);return 'sent'; }
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
    if (rp) { CHATS.sendVoiceTo(rp.wid, rp.sid, r.blob, extraFiles, sealed, modelRoute, stagedId, stagedId ? null : r.captureId, rp.steerRunId, transcript); toast('✦', 'Voice reply · waiting to send', 1400); setTimeout(() => toNewChat(rp.wid, 'voice'), 180); return 'sent'; }
    if (w && aimSid) CHATS.sendChat(w.id, transcript, 'voice, aimed at this thread', r.blob, { custodyId: stagedId, captureId: stagedId ? null : r.captureId, sid: aimSid, seal: sealed, route: modelRoute, files: extraFiles });
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
    try { vRoute = CHATS.modelRoute(wid,sid); if(!vRoute){await loadVoiceModels();vRoute=CHATS.modelRoute(wid,sid);} if(!vRoute?.model)throw Error('Model route unavailable · recording has not started'); }
    catch(e) { toast('!',String(e.message||e),2600);return 'busy'; }
    finally { dictationFinishing = false; }
    vFiles?.close(); vFiles = window.WosCaptureTools.take(CHATS.uploadFile,paintVoiceFiles); paintVoiceFiles();
    vMode = 'talk'; vNewChat = false; vTarget = wid; vReply = { wid, sid, steerRunId: CHATS.isWorking(LIVE.session(sid)) ? LIVE.session(sid)?.runId || '' : '' }; vContext = viewContext(wid, 'voice, aimed at this thread');
    $('#voiceTime').textContent = '0:00';
    try { await VOICE.start(); } catch (e) { vReply = null; toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
    return 'recording';
  }

  // Dictation (Right ⌥): speech to text where you're typing. In a text field the words go in at the cursor;
  // anywhere else they land on the clipboard. (Wizard for Mac does this in every app, natively.)
  let dictTarget = null, dictationFields = null;
  function fields() { return dictationFields ||= C.focusedField.create({
    frames: () => $$('iframe',stage).filter(f => !!APP[W[f.closest('[data-win]')?.dataset.win]?.appId]),
    admit: (c,el) => { const w=c.frame?.closest('[data-win]')||el.closest('[data-win]');return (!w||w.dataset.win===ws[cur].focus)&&!!el.getClientRects().length; },
    controls: el => !!el?.closest('#voicePill,#micBtn,#dictateBtn')
  }); }
  // Recovery is a view of the existing outbox, not a second recorder/store/native pipeline.
  const recovery = document.createElement('section');
  recovery.id = 'recordingRecovery'; recovery.className = 'recording-recovery';
  recovery.setAttribute('aria-label', 'Retained recordings'); recovery.hidden = true;
  document.body.appendChild(recovery);
  function recordingMeta(it) {
    const thread = it.kind === 'dictation' ? 'Dictation'
      : it.kind === 'new' ? 'New chat'
      : LIVE?.session?.(it.sessionId)?.title || (it.sessionId ? 'Existing chat' : 'Voice message');
    const at = Number(it.createdAt) || 0;
    const stamp = at ? new Date(at).toLocaleString() : '';
    const bytes = Number(it.audio?.size) || 0;
    const size = bytes ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : '';
    return [thread, stamp, size].filter(Boolean).join(' · ');
  }
  function paintRecordings() {
    const takes = window.WosOutbox?.recordings() || [];
    recovery.hidden = !takes.length;
    recovery.innerHTML = takes.map(it => `<article>
      <strong>${it.kind === 'dictation' ? 'Dictation' : 'Voice recording'} kept</strong>
      <p class="recording-meta">${esc(recordingMeta(it))}</p>
      <p role="status">${esc(it.storageError ? (it.durable ? 'Device save failed · complete backup kept; retrying.' : 'Device save failed · not saved. Keep this tab open; download before reload.') : (it.durable ? 'Saved on this device · available after reload.' : 'Saving recording…'))}</p>
      <p>${esc(it.state === 'transcribing' ? 'Transcribing…' : it.error || ((it.recoveryText || it.text) ? 'Transcript ready · copy it below.' : 'Ready to retry transcription.'))}</p>
      ${it.recoveryText || it.text ? `<textarea readonly aria-label="Recovered transcript">${esc(it.recoveryText || it.text)}</textarea><button data-record-copy="${esc(it.id)}">Copy transcript</button>` : ''}
      <button data-record-retry="${esc(it.id)}" ${['transcribing', 'sending'].includes(it.state) ? 'disabled' : ''}>${it.kind === 'conversation' ? 'Retry original to app' : OUTBOX.canRetry(it) ? 'Retry send' : 'Transcribe only'}</button>
      <button data-record-download="${esc(it.id)}">Download audio</button>
      <button data-record-discard="${esc(it.id)}" ${it.state === 'transcribing' ? 'disabled' : ''}>Discard</button>
    </article>`).join('');
  }
  recovery.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const O = window.WosOutbox;
    const id = b.dataset.recordRetry || b.dataset.recordDownload || b.dataset.recordCopy || b.dataset.recordDiscard;
    const it = O.get(id); if (!it) return;
    if (b.dataset.recordRetry) {
      if (it.kind === 'conversation') await O.retryConversation(id);
      else if (O.canRetry(it)) toast('↻', O.retryFeedback(O.retry(id)), 2400); else await O.transcribeRecording(id);
    } else if (b.dataset.recordDownload) {
      if (!(it.audio instanceof Blob) || !it.audio.size) { toast('!', 'Audio is unavailable · keep this tab open', 3200); return; }
      let url = '';
      try {
        url = URL.createObjectURL(it.audio);
        const a = document.createElement('a');
        const ext = /mp4|m4a/.test(it.audioType) ? 'm4a' : /ogg/.test(it.audioType) ? 'ogg' : /wav/.test(it.audioType) ? 'wav' : 'webm';
        a.href = url; a.download = `wizard-recording-${id}.${ext}`; a.rel = 'noopener'; a.hidden = true;
        document.body.appendChild(a); a.click(); a.remove();
        toast('↓', 'Audio download requested · check Downloads', 2600);
      } catch (error) {
        console.error('Retained recording download failed', error);
        toast('!', 'Audio download failed · recording is still kept', 3200);
      }
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else if (b.dataset.recordCopy) {
      try { await navigator.clipboard.writeText(it.recoveryText || it.text); toast('📋', 'Transcript copied · recording kept until you discard it', 2600); }
      catch (e) { toast('!', 'Select and copy the transcript above', 2600); }
    } else if (confirm('Discard this retained recording and transcript?')) O.remove(id);
  });
  window.WosOutbox?.onChange(paintRecordings);
  window.WosOutbox?.load().then(paintRecordings);
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
      try { await VOICE.start(); } catch (e) { vMode = 'talk'; toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
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
      if (fields().insert(target, text)) { if (it.durable) O.remove(it.id); return 'inserted'; }
      try {
        await navigator.clipboard.writeText(text);
        if (it.durable) O.remove(it.id);
        toast('📋', `Copied: “${clip(text, 60)}” · ⌘V to paste`, 2600); return 'copied';
      } catch (e) { toast('✎', 'Transcript and recording kept below', 2600); return 'retained'; }
    } finally { target?.release(); if(dictTarget===target)dictTarget=null;vMode = 'talk'; dictationFinishing = false; }
  }

  // Right ⌘ / Right ⌥ as tap keys: press and release alone, quickly (a chord like ⌘C never counts).
  // Inside Wizard for Mac the native app owns these keys system-wide and sends wizard:orb, so the page stands down.
  const NATIVE_KEYS = !!window.webkit?.messageHandlers?.wizardNative;
  let tapKey = null, tapAt = 0, tapChord = false;
  addEventListener('keydown', e => {
    if (NATIVE_KEYS) return;
    // Pause PWA dictation so the system's Right Option voice tool owns the key.
    // Reversible desktop switches are staged separately; native/OS bindings stay intact.
    if (e.code === 'MetaRight' && !e.repeat) {
      const others = (e.code === 'MetaRight' ? e.altKey : e.metaKey) || e.ctrlKey || e.shiftKey;
      tapKey = e.code; tapAt = performance.now(); tapChord = others; return;
    }
    if (tapKey) tapChord = true;
  }, true);
  addEventListener('keyup', e => {
    if (NATIVE_KEYS || e.code !== tapKey) return;
    const ok = !tapChord && performance.now() - tapAt < 450; tapKey = null;
    if (!ok) return;
    e.preventDefault();
    if (e.code === 'MetaRight') { log('key:right-cmd'); talk(); } else { log('key:right-opt'); dictate(); }
  }, true);
  addEventListener('blur', () => { tapKey = null; });

  /* ---------------- keyboard ---------------- */
  const typing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  let lastWs = cur;
  function dirFocus(dx, dy) {
    const d = ws[cur]; if (d.wins.length < 2) return;
    const me = winEl(d.focus)?.getBoundingClientRect(); if (!me) return;
    const cx = me.left + me.width / 2, cy = me.top + me.height / 2;
    let best = null, bs = Infinity;
    for (const id of d.wins) {
      if (id === d.focus) continue; const r = winEl(id)?.getBoundingClientRect(); if (!r || winEl(id).classList.contains('gone')) continue;
      const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      if ((dx && Math.sign(x) !== dx) || (dy && Math.sign(y) !== dy)) continue;
      const s = Math.abs(dx ? x : y) + Math.abs(dx ? y : x) * 2; if (s < bs) { bs = s; best = id; }
    }
    if (!best && d.mono) { const i = d.wins.indexOf(d.focus); best = d.wins[(i + (dx || dy) + d.wins.length) % d.wins.length]; }
    if (best) focusWin(best);
  }
  // Esc peels one layer: palette → keys → voice → thread → (nothing: stays put, never leaves).
  function escStep() {
    if (window.WosContextMenu?.back()) return 'context-menu';
    if (window.WizShareWizard?.back()) return 'share-wizard';
    { const sh = window.WosShareSheet?.back(); if (sh) return sh; } // the share sheet sits above everything, incl. the selection menu
    if (window.WosSelMenu?.back()) return 'selection';
    if (window.WosBoomerang?.back()) return 'boomerang'; // the Boomerang picker sits above the thread it was opened from
    if (!pal.hidden) { closePalette(); return 'palette'; }
    if (window.WosAppRoute?.back()) return 'app-route'; // an app's settings sheet
    if (window.WosAppSetup?.back()) return 'app-setup';
    if (window.WizWebUpdate?.back()) return 'update-list'; // the update card's thread list folds first
    if (CHATS.KIT?.viewer?.isOpen() && CHATS.KIT.viewer.close()) return 'viewer'; // an image opened from a link sits above the sheet
    if (LINKS && LINKS.isOpen()) { LINKS.back(); return 'link'; }
    if (keyHints.pinned()) { toggleKeys(false); returnToSettings(); return 'keys'; }
    if (window.WosSkinHost?.back?.()) return 'tweak-overlay'; // a package's own sheet (api.back.push)
    if (window.WosResources?.back()) return 'resources';
    if (closeUsage()) return 'usage';
    if (settingsReturn === 'files') { const nested = CHATS.closeOverlay(); if (nested) { returnToSettings(); return nested; } settingsReturn = ''; }
    if (settingsFocused()) { if (settingsView.back()) return 'settings-page'; closeSettings(); return 'settings'; }
    const ov = CHATS.closeOverlay(); if (ov) return ov; // media viewer, then the thread actions sheet
    if (window.WosSkinFrame?.back()) return 'skin-controls';
    // The first-message guide: once nothing sits above it, Esc/Back dismisses it (= Skip tour) before any navigation.
    if (window.WosTour?.desk?.active) { window.WosTour.desk.finish('skip'); return 'tour'; }
    // The floating chat, when the keyboard is in it, walks back from its open thread before anything behind it.
    { const hb = hudBack(); if (hb) return hb; }
    // Leave fullscreen before navigating the app underneath; preserve its thread and draft.
    if (homeOpen) return '';
    if (focused() && CHATS.isHosted(focused().id)) return CHATS.threadBack(focused());
    if (ws[cur].mono) { toggleMono(); return 'mono'; }
    // Back navigates while recording; only the explicit Cancel control may discard audio.
    const f = focused();
    if (f?.app === 'feature') { closeWin(f.id);return 'view'; }
    if (f?.app === 'chats' && f.thread) { const r = CHATS.threadBack(f); syncChatsPane(f.id); winEl(f.id)?.focus({ preventScroll: true }); return r; }
    if (f?.app === 'frame') {
      const result = window.WizAppServices?.back(winEl(f.id)?.querySelector('iframe'));
      if (['handled', 'pending', 'stay'].includes(result)) return 'hosted';
      if (f.workflow && closeWorkflow(f)) return 'workflow';
      if (f.preview) { closeWin(f.id); return 'preview'; }
    }
    if (f && window.WizCompanionPane?.back(f.id)) return 'companion-back';
    if (f?.appId === 'app-store') {
      if (!ws[cur].mono) { closeWin(f.id); return 'store-parent'; }
    }
    return '';
  }
  /* ---------------- hold left ⌥ / Alt: the keys guide ----------------
   * The one keys guide. Holding left ⌥ alone for a moment labels every bar control with its key and lays the
   * keys out where they act: speaking under the speak buttons, switching under the desktops, window keys on the
   * focused window. Each key has a name and a one-line meaning. Letting go hides it; ⌥/ or the bar's ⌥/ button
   * pins it open until Esc or a click. */
  const keyHints = (() => {
    const el = document.createElement('div'); el.id = 'keyHints'; el.className = 'key-hints'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keys guide');
    document.body.appendChild(el);
    let timer = 0, armed = false, pinned = false;
    const ALT = IS_MAC ? '⌥' : 'Alt';
    const SPEAK = [
      ['S', 'Talk about this', 'Ask about this window, or reply to the open chat'],
      ['V', 'New voice chat', 'A fresh start; nothing on screen is shared'],
      ['C', 'Tell the computer', 'Say “calendar”, “next desk”, “full screen”, “go home”. Stays on this box'],
      ['D', 'Type with your voice', 'Your words go into the box you’re typing in'],
    ];
    const TYPE = [['N', 'New chat', 'Type a new message'], ['␣', 'Search', 'Apps, chats and commands'], ['I', 'Inbox', 'All your chats']];
    const READY = [['↓', 'Next ready chat', 'From anywhere. Opens it ready to reply'], ['→  ←', 'Done / Snooze', 'The open chat'], ['X', 'Resolve this', 'An open notification: stop these or fix the cause']];
    const GO = [['G', 'Pick anything', 'Letters appear on every button, app and chat; type them to click'], ['`', 'Home', 'Again to go back'], ['1–9', 'Desktop 1 to 9', 'Jump straight to it'], ['T', 'New desktop', ''], ['⇧ [ ]', 'Move desktop left / right', ''], ['O', 'Open an app', '']];
    const WIN = [['P', 'Float chat', 'Over every desk; again puts it back on desktop 1'], ['F', 'Full screen', ''], ['W', 'Close', ''], ['R', 'Refresh window', ''], ['H J K L', 'Window to the left, below, above, right', ''], [']', 'Next window', 'Past the last one: the next desktop'], ['[', 'Previous window', 'Past the first one: the previous desktop'], ['⇧ ← →', 'Swap places', ''], ['⇧ 1–9', 'Send to a desktop', '']];
    const vis = n => n && !n.hidden && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
    // Every key is a small chip on the thing it acts on (Miguel, 27 Oct 2026: no boxes to read). Only the four
    // Speak keys carry a word, since their buttons don't say what they do. The lists above name each chip for
    // screen readers.
    const NAMES = Object.fromEntries([...SPEAK, ...TYPE, ...READY, ...GO, ...WIN].map(([k, n]) => [k, n]));
    function chip(n, label, at = 'below', word = '') {
      const r = n.getBoundingClientRect();
      // Only on things you can see right now: not scrolled away, not under another window.
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return null;
      const hitEl = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      if (!hitEl || (hitEl !== n && !n.contains(hitEl) && !hitEl.contains(n) && !el.contains(hitEl))) return null;
      const c = document.createElement('b');
      c.className = 'kh-chip' + (word ? ' kh-lab' : ''); c.innerHTML = word ? `<kbd>${esc(label)}</kbd>${esc(word)}` : esc(label);
      c.setAttribute('aria-label', `${ALT} ${label}: ${NAMES[label] || word || label}`); el.appendChild(c);
      const w = c.offsetWidth, h = c.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.bottom + 24 > innerHeight ? r.top - h - 3 : r.bottom + 3; // near the bottom: above it
      if (at === 'inside') { x = r.right - w - 8; y = r.top + r.height / 2 - h / 2; }
      if (at === 'start') { x = r.left - w - 4; y = r.top + r.height / 2 - h / 2; if (x < 4) x = r.left + 4; }
      if (at === 'inside-2') { x = r.right - w - 8 - 76; y = r.top + r.height / 2 - h / 2; }
      if (at === 'above') y = r.top - h - 3 < 4 ? r.bottom + 3 : r.top - h - 3;
      if (at === 'corner') { x = r.left - 4; y = r.top - 4; }
      if (at === 'bottom-in') { x = r.left + r.width / 2 - w / 2; y = r.bottom - h - 6; }
      if (at && typeof at === 'object') { x = at.x - w; y = at.y; at.x = x - 6; } // Speak words: one row, right to left, ending under the last speak button
      x = Math.round(Math.max(4, Math.min(innerWidth - w - 4, x))); y = Math.round(Math.max(4, y));
      // Never on top of another chip: step down until clear.
      const taken = [...el.querySelectorAll('.kh-chip')].filter(o => o !== c).map(o => o.getBoundingClientRect());
      for (let k = 0; k < 8 && taken.some(o => x < o.right + 2 && x + w > o.left - 2 && y < o.bottom + 2 && y + h > o.top - 2); k++) y += h + 3;
      c.style.left = x + 'px'; c.style.top = y + 'px';
      return c;
    }
    function show(pin = pinned) {
      pinned = !!pin;
      el.innerHTML = ''; el.hidden = false; el.classList.toggle('pinned', pinned); // visible first, so chips can be measured
      // Top bar: Home, desktops, new desktop, and the Speak buttons with their one-word meaning.
      // [ ] sit on where they go: the next window or Chats side on this desk (left to right), else the desk one
      // step left / right (Home left of desktop 1; nothing past either end).
      const winL = nextStop(-1), winR = nextStop(1);
      const stepL = winL ? null : homeOpen ? null : cur === 0 ? $('#logo') : $(`#wsList .ws[data-ws="${cur - 1}"]`);
      const stepR = winR ? null : homeOpen ? $('#wsList .ws[data-ws="0"]') : $(`#wsList .ws[data-ws="${cur + 1}"]`);
      const marks = [['#searchBtn', '␣'], ['#status', 'I'], ['#settingsBtn', ','], ['#keysBtn', '/'], ['#logo', '`']];
      for (const [q, l] of marks) { const n = $(q); if (vis(n)) chip(n, l); }
      $$('#wsList .ws[data-ws]').forEach(n => { const slot = C.workspaceNav.slot(+n.dataset.ws); if (slot <= 9 && vis(n)) chip(n, String(slot)); });
      const add = $('#wsList [data-newdesk]'); if (vis(add)) chip(add, 'T');
      // Their own chip on a second row under the neighbour's key, so it reads as "either 2 or ]", not one combo.
      if (vis(stepL)) chip(stepL, '['); if (vis(stepR)) chip(stepR, ']');
      // Home: ↓ on the Ready count (Miguel's skins) or the first unread row (stock Home): ⌥↓ opens it from here.
      if (homeOpen) { const r = $('#desktopHome [data-home-act="ready"]') || $('#desktopHome .home-card .home-row'); if (vis(r)) chip(r, '↓', 'inside'); }
      // [ ] on the desktops either side of this one (they wrap), under their numbers.
      // While recording: the same key again sends, Esc cancels, right on the pill.
      if (VOICE.state !== 'idle') { const send = $('#voiceSend'), cancel = $('#voiceCancel'); if (vis(send)) chip(send, ($('#voiceKey')?.textContent || '').replace(MOD, '') || 'S'); if (vis(cancel)) chip(cancel, 'Esc'); }
      const f = !homeOpen && focused(), d = ws[cur];
      // Chats: ↓ sits on the Ready chat it opens next; → ← on Done / Snooze; ↵ on Send; / on search; N on New chat.
      const cw = !homeOpen && (f?.app === 'chats' ? f : d.wins.map(x => W[x]).find(mainChats));
      if (cw) {
        const wel = winEl(cw.id), rows = readyRows(cw.id), i = cw === f ? rows.findIndex(r => (r.dataset.chopen || 'n:' + r.dataset.chnotif) === (cw.thread === '__new__' && CHATS.notifOpen?.(cw.id) ? 'n:' + CHATS.notifOpen(cw.id) : cw.thread)) : -1;
        const next = rows.length && (i < 0 ? rows[0] : rows[(i + 1) % rows.length]);
        const prev = i > 0 && rows.length > 2 ? rows[i - 1] : null; // ⌥↑ goes back one Ready chat
        if (prev && vis(prev)) { const lr = wel.querySelector('.pane-list')?.getBoundingClientRect(), pr = prev.getBoundingClientRect(); if (!lr || (pr.top >= lr.top && pr.bottom <= lr.bottom - 4)) chip(prev, '↑', 'inside'); }
        if (next && (i < 0 || next !== rows[i]) && vis(next)) {
          // Scrolled out of the list: the chip goes on the Ready heading instead, so it never hangs off the edge.
          const lr = wel.querySelector('.pane-list')?.getBoundingClientRect(), nr = next.getBoundingClientRect();
          const head = wel.querySelector('.pane-list [data-sectoggle="ready"]');
          const pl = wel.querySelector('.pane-list');
          if (!lr || (nr.top >= lr.top && nr.bottom <= lr.bottom - 4)) chip(next, '↓', 'inside'); else if (!(vis(head) && chip(head, '↓', 'inside')) && pl) chip(pl, '↓', 'bottom-in');
        }
        if (cw === f) {
          // → ← on the Done / Snooze buttons; scrolled out of sight, they sit on the chat's header with their word.
          if (f.thread && (f.thread !== '__new__' || CHATS.notifOpen?.(f.id))) for (const [q, l, word] of [['[data-chact="done"]', '→', 'Done'], ['[data-chact="snooze"]', '←', 'Snooze'], ['[data-chact="resolve"]', 'X', 'Resolve']]) {
            const on = [...wel.querySelectorAll(q)].filter(vis).map(n => chip(n, l, 'above')).some(Boolean);
            const head = wel.querySelector('.pane-main .ch-head');
            if (!on && wel.querySelector(q) && vis(head)) chip(head, l, l === '→' ? 'inside' : 'inside-2', word);
          }
          const send = wel.querySelector('.pane-main .ch-send'); if (f.thread && vis(send)) chip(send, '↵', 'start');
          // ⌥I opens the chat list; pressed again it searches chats and messages.
          const srch = wel.querySelector('[data-chsearch]'); if (vis(srch) && document.activeElement !== srch) chip(srch, 'I', 'inside');
          const fab = wel.querySelector('.pane-list [data-chfab]'); if (vis(fab)) chip(fab, 'N', 'corner');
        }
      }
      // Heads-up chat: P on the float button, or (floating) on Back to desktop 1.
      if (hud && W[hud.id]) { const n = winEl(hud.id)?.querySelector('.wbar [data-wact="hud-home"]'); if (vis(n)) chip(n, 'P'); }
      else {
        const fw = f?.app === 'chats' ? f : !homeOpen && d.wins.map(x => W[x]).find(mainChats);
        const n = fw && winEl(fw.id)?.querySelector('.wbar [data-wact="hud"]'); if (vis(n)) chip(n, 'P');
      }
      // The window in front: F W R on its own buttons; H J K L on the windows they jump to.
      if (f) {
        const wel = winEl(f.id);
        for (const [q, l] of [['[data-wact="mono"]', 'F'], ['[data-wact="close"]', 'W'], ['[data-wact="reload"]', 'R']]) { const n = wel?.querySelector(`.wbar ${q}`); if (vis(n)) chip(n, l); }
        const me = wel?.getBoundingClientRect(), best = {};
        if (me) for (const id of d.wins) {
          if (id === f.id) continue; const o = winEl(id), r = o?.getBoundingClientRect(); if (!r || o.classList.contains('gone')) continue;
          const dx = r.left + r.width / 2 - (me.left + me.width / 2), dy = r.top + r.height / 2 - (me.top + me.height / 2);
          const k = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'H' : 'L') : (dy < 0 ? 'K' : 'J'), dist = Math.hypot(dx, dy);
          if (!best[k] || dist < best[k].dist) best[k] = { o, dist };
        }
        for (const [k, { o }] of Object.entries(best)) { const t = o.querySelector('.wbar .t') || o.querySelector('.wbar'); if (vis(t)) chip(t, k, 'start'); }
      }
      // ] and [ inside this desk: on the title of the window they go to, or on the Chats side (list / message box).
      for (const [st, l] of [[winR, ']'], [winL, '[']]) {
        if (!st) continue; const o = winEl(st[0]);
        const t = st[1] === 'thread' ? o?.querySelector('.pane-main textarea') : st[1] === 'list' ? o?.querySelector('.pane-list') : (o?.querySelector('.wbar .t') || o?.querySelector('.wbar'));
        if (vis(t)) chip(t, l, st[1] ? 'corner' : 'start');
      }
      // Speak keys last: their words step around anything already placed.
      const speak = [['#micBtn', 'S', 'Talk about this'], ['#generalVoice', 'V', 'New voice chat'], ['#commandBtn', 'C', 'Tell the computer'], ['#dictateBtn', 'D', 'Dictate']]
        .map(([q, l, w]) => [$(q), l, w]).filter(([n]) => vis(n)).sort((x, y) => x[0].getBoundingClientRect().left - y[0].getBoundingClientRect().left);
      // Speak keys: the letter under each button like every bar key, and their meaning as one line inside the bar,
      // just left of them, so nothing covers a window. Too narrow for that: the words drop under the buttons.
      if (speak.length) {
        speak.forEach(([n, l]) => chip(n, l));
        const sb = $('#searchBtn'), bar = $('#bar')?.getBoundingClientRect(), wl = $('#wsList')?.getBoundingClientRect();
        const end = (vis(sb) ? sb : speak[0][0]).getBoundingClientRect().left - 10, min = (wl?.right || 0) + 12;
        const leg = document.createElement('div'); leg.className = 'kh-legend';
        leg.innerHTML = [['G', 'Pick anything'], ...speak.map(([, l, w]) => [l, w])].map(([l, w]) => `<span><kbd>${esc(l)}</kbd>${esc(w)}</span>`).join(''); el.appendChild(leg);
        const lw = leg.offsetWidth, lh = leg.offsetHeight;
        if (bar && end - lw >= min) { leg.style.left = Math.round(end - lw) + 'px'; leg.style.top = Math.round(bar.top + (bar.height - lh) / 2) + 'px'; leg.classList.add('in-bar'); }
        else { const last = speak[speak.length - 1][0].getBoundingClientRect(); leg.style.left = Math.round(Math.max(4, last.right - lw)) + 'px'; leg.style.top = Math.round(last.bottom + 24) + 'px'; }
      }
      // One quiet line for the keys that have no single place: pick anything, keep this open.
      if (!pinned && el.querySelector('.kh-legend.in-bar')) { document.documentElement.classList.add('key-hints-on'); return; } // the bar line already says G
      const foot = document.createElement('div'); foot.className = 'kh-foot' + (pinned ? ' pinned' : '');
      foot.innerHTML = (pinned ? `<span><kbd>Esc</kbd> close</span>` : `<span><kbd>G</kbd> letters on everything</span><span><kbd>/</kbd> keep open</span>`)
        + (pinned && nativeDesktop ? `<span>Any Mac app: <kbd>Caps Lock</kbd> search · <kbd>Right ⌘</kbd> talk · <kbd>Right ⌥</kbd> dictate</span>` : '')
        + (pinned && window.WosTour?.desk ? `<button type="button" data-keystour>Show me the tour again</button>` : '');
      el.appendChild(foot);
      document.documentElement.classList.add('key-hints-on');
    }
    function hide() { clearTimeout(timer); armed = false; pinned = false; if (el.hidden) return; el.hidden = true; el.innerHTML = ''; el.classList.remove('pinned'); document.documentElement.classList.remove('key-hints-on'); }
    el.addEventListener('click', e => { if (e.target.closest('[data-keystour]')) replayTour(); else if (pinned) hide(); });
    return {
      hide, show, pinned: () => pinned, mine: t => !!t?.closest?.('#keyHints, #keysBtn'),
      down(e) {
        if (e.code === 'AltLeft' || e.code === 'AltRight' || e.key === 'Alt') {
          if (pinned || e.repeat || e.code !== 'AltLeft' || e.metaKey || e.ctrlKey || e.shiftKey) return;
          hide(); armed = true; timer = setTimeout(() => { if (armed) show(false); }, 300); return;
        }
        if (pinned && e.altKey && e.code === 'Slash') return; // ⌥/ closes it via toggleKeys
        hide();
      },
      up(e) { if (pinned) return; if (e.code === 'AltLeft' || e.key === 'Alt') { const was = !el.hidden; hide(); if (was) e.preventDefault(); } },
    };
  })();

  /* ⌥G Pick anything (Miguel, 27 Oct 2026: "never touch the trackpad"): every visible button, link, field, app tile
   * and chat row on screen, the bar and same-origin app windows included, gets a letter chip. Type the letters
   * (with or without ⌥ still held) to click or focus it; Backspace undoes a letter; Esc, a click or a scroll cancels. */
  const pick = (() => {
    const layer = document.createElement('div'); layer.id = 'pickHints'; layer.className = 'pick-hints'; layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer);
    const SEL = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="option"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[data-chopen],[data-chdraft],[tabindex]:not([tabindex="-1"])';
    const KEYS = 'asdfjklghqwertyuiopzxcvbnm';
    let items = [], typed = '', on = false;
    function shown(n, view) {
      if (n.disabled || n.closest('[hidden],[inert],#pickHints,#keyHints')) return null;
      const r = n.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
      const cs = n.ownerDocument.defaultView.getComputedStyle(n); if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.pointerEvents === 'none') return null;
      const x = r.left + view.x, y = r.top + view.y;
      if (x + r.width < view.l || y + r.height < view.t || x > view.r || y > view.b) return null;
      // Something else painted over its centre (a covered window or a closed sheet) is not pickable.
      const cx = Math.min(r.right - 1, Math.max(r.left + 1, r.left + r.width / 2)), cy = Math.min(r.bottom - 1, Math.max(r.top + 1, r.top + r.height / 2));
      const top = n.ownerDocument.elementFromPoint(cx, cy); if (top && top !== n && !n.contains(top) && !top.contains(n)) return null;
      return { x: Math.max(view.l, x), y: Math.max(view.t, y) };
    }
    function collect() {
      const out = [], seen = new Set();
      const scan = (doc, view) => {
        for (const n of doc.querySelectorAll(SEL)) {
          if (seen.has(n) || (n.parentElement?.closest(SEL) && !n.matches('[data-chopen],[data-chdraft]') && n.parentElement.closest(SEL).matches('a[href],button'))) continue;
          const at = shown(n, view); if (!at) continue; seen.add(n); out.push({ n, ...at });
        }
        for (const f of doc.querySelectorAll('iframe')) {
          let d = null; try { d = f.contentDocument; } catch (_) {} if (!d || !d.body) continue;
          const fr = f.getBoundingClientRect(); if (!fr.width || !fr.height || !shown(f, view)) continue;
          scan(d, { x: view.x + fr.left + f.clientLeft, y: view.y + fr.top + f.clientTop, l: Math.max(view.l, view.x + fr.left), t: Math.max(view.t, view.y + fr.top), r: Math.min(view.r, view.x + fr.right), b: Math.min(view.b, view.y + fr.bottom) });
        }
      };
      scan(document, { x: 0, y: 0, l: 0, t: 0, r: innerWidth, b: innerHeight });
      return out.sort((a, b) => (a.y - b.y) || (a.x - b.x)).slice(0, KEYS.length * KEYS.length);
    }
    function labels(n) {
      if (n <= KEYS.length) return [...KEYS].slice(0, n);
      const out = []; for (const a of KEYS) for (const b of KEYS) out.push(a + b); return out.slice(0, n);
    }
    function paint() {
      for (const it of items) {
        const hit = it.label.startsWith(typed); it.chip.hidden = !hit;
        if (hit) it.chip.innerHTML = `<u>${typed}</u>${it.label.slice(typed.length)}`.toUpperCase();
      }
    }
    function stop() { if (!on) return; on = false; typed = ''; items = []; layer.hidden = true; layer.innerHTML = ''; document.documentElement.classList.remove('pick-on'); }
    function start() {
      closePalette(); toggleKeys(false);
      const found = collect(); if (!found.length) { toast('◌', 'Nothing to pick here', 1200); return false; }
      const names = labels(found.length); layer.innerHTML = ''; layer.hidden = false; on = true; typed = '';
      items = found.map((it, i) => { const c = document.createElement('b'); c.className = 'pick-chip'; layer.appendChild(c);
        c.style.left = Math.min(innerWidth - 30, it.x) + 'px'; c.style.top = Math.min(innerHeight - 18, it.y) + 'px'; return { ...it, label: names[i], chip: c }; });
      paint(); document.documentElement.classList.add('pick-on'); log('pick:' + items.length); return true;
    }
    function act(n) {
      const doc = n.ownerDocument, win = (doc === document ? n : doc.defaultView.frameElement)?.closest?.('[data-win]');
      if (win && W[win.dataset.win]) focusWin(win.dataset.win, { scroll: false });
      const field = n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) && !/^(button|submit|checkbox|radio|reset|file)$/.test(n.type);
      try { n.focus({ preventScroll: true }); } catch (_) {}
      if (!field) n.click();
      log('pick:act:' + (n.getAttribute('aria-label') || n.textContent || n.tagName).trim().slice(0, 40));
    }
    function key(e) {
      e.preventDefault(); e.stopPropagation();
      if (/^(Alt|Shift|Meta|Control)/.test(e.code)) return;
      if (e.key === 'Escape') return stop();
      if (e.key === 'Backspace') { typed = typed.slice(0, -1); return paint(); }
      const m = /^Key([A-Z])$/.exec(e.code); if (!m) return stop();
      const next = typed + m[1].toLowerCase(), left = items.filter(it => it.label.startsWith(next));
      if (!left.length) return; typed = next;
      const exact = left.length === 1 && left[0].label === typed ? left[0] : null;
      if (exact) { stop(); act(exact.n); } else paint();
    }
    addEventListener('pointerdown', stop, true); addEventListener('resize', stop); addEventListener('wheel', stop, { capture: true, passive: true });
    return { start, stop, key, active: () => on };
  })();
  const NATIVE_MENU = !!window.webkit?.messageHandlers?.wizardNative;
  const vis0 = n => !!n && !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  function onKey(e, fromFrame = false) {
    if (pick.active()) return pick.key(e);
    if (e.key === 'Escape' && keyHints.pinned()) { e.preventDefault(); e.stopPropagation(); toggleKeys(false); returnToSettings(); return; }
    keyHints.down(e);
    const k = e.key, code = e.code, alt = e.altKey && !e.metaKey && !e.ctrlKey, shift = e.shiftKey;
    const digit = /^Digit([1-9])$/.exec(code);
    const hit = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
    // One base key for everything: ⌥ (Option / Alt). macOS and browsers own ⌘ and Ctrl, Omarchy owns Super.
    // Inside the Wizard Mac app only, its own menu items (⌘N, ⌘T, ⌘W, ⌘,) forward here with their usual Mac meaning.
    const menu = NATIVE_MENU && e.metaKey && !e.ctrlKey && !e.altKey && !shift;
    if (code === 'Comma' && !shift && (alt || menu)) return hit(toggleSettings);
    // Home is ⌥` (the key left of 1, like the Home icon left of the desks); desktops are ⌥1…9 left to right.
    // ⌥` again from Home goes back to the desktop you were on.
    if (alt && !shift && code === 'KeyG') return hit(() => { if (!e.repeat) pick.start(); });
    if (alt && !shift && code === 'Backquote') return hit(() => { if (e.repeat) return; if (homeOpen) { leaveHome(); log('home:back'); } else { goHome(); log('home'); } });
    if ((menu || alt) && !shift && code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    if ((menu || alt) && !shift && code === 'KeyT') return hit(() => { if (!e.repeat) { closePalette(); toggleKeys(false); closeSettings(); closeUsage(); newDesktop(); } });
    if (alt && !shift && (code === 'ArrowUp' || code === 'ArrowDown')) return hit(() => { if (!e.repeat || focused()?.app === 'chats') { closePalette(); toggleKeys(false); chatsUpDown(code === 'ArrowDown' ? 1 : -1); } });
    // ⌥N new chat; ⌥V new voice chat (⌥V again sends).
    if ((menu || alt) && !shift && code === 'KeyN') return hit(() => { if (e.repeat) return; closePalette(); toggleKeys(false); closeSettings(); closeUsage(); newChat({ fresh: true }); });
    if (alt && !shift && code === 'Enter') return hit(() => { if (!e.repeat) newChat(); });
    if (alt && code === 'KeyV') return hit(() => { if (e.repeat) return; closePalette(); toggleKeys(false); closeSettings(); closeUsage(); talkNew(`${MOD}V`); });
    // ⌥→ Done, ⌥← Snooze (Miguel, 27 Oct 2026): with a chat open in Chats, the arrows act on it, also from an EMPTY
    // message box (the Ready loop). Once there is text in the box, ⌥←/→ jump words as usual: an accidental ⌥→ while
    // typing archived a chat. The hidden duplicates ⌥E / ⌥Z are gone (Miguel: only the keys the guide shows).
    const chatOpen = () => { const f = focused(); return !homeOpen && f?.app === 'chats' && f.thread && (f.thread !== '__new__' || !!CHATS.notifOpen?.(f.id)); };
    const midText = typing(e.target) && String(e.target.value ?? e.target.textContent ?? '').trim() !== '';
    if (alt && !shift && (code === 'ArrowLeft' || code === 'ArrowRight') && chatOpen() && !midText) return hit(() => { if (!e.repeat) chatAct(code === 'ArrowRight' ? 'done' : 'snooze', code === 'ArrowRight' ? '→' : '←'); });
    // ⌥X Resolve this: an open notification goes to the agent to stop these or fix the cause.
    if (alt && !shift && code === 'KeyX') return hit(() => { if (!e.repeat) chatAct('resolve', 'X'); });
    function chatAct(act, keyName) {
      const f0 = focused(), f = f0?.app === 'chats' ? f0 : ws[cur].wins.map(x => W[x]).find(mainChats);
      const name = act === 'done' ? 'Done' : act === 'resolve' ? 'Resolve this' : 'Snooze';
      if (homeOpen || !f?.thread || (f.thread === '__new__' && !CHATS.notifOpen?.(f.id))) return toast('✓', `Open a chat first, then ${MOD}${keyName} = ${name}`, 1800);
      if (!winEl(f.id)?.querySelector(`[data-chact="${act}"]`)) return toast('◷', act === 'resolve' ? 'Resolve this is for an open notification' : `${name} appears once the reply is in`, 1800);
      CHATS.threadAct(f.id, f.thread, act);
    }
    // ⌥S speak about this screen (replies to the open chat), ⌥C speak a local command, ⌥D dictate into the text box.
    // Same key again sends. Like ⌥V these work from anywhere, even while typing.
    if (alt && !shift && (code === 'KeyS' || code === 'KeyC' || code === 'KeyD')) return hit(() => {
      if (e.repeat) return;
      if (code === 'KeyD') { // in Chats, dictation always lands in the open chat's message box, even from the list
        const f = focused(), ta = !homeOpen && mainChats(f) && f.thread && winEl(f.id)?.querySelector('.pane-main textarea');
        if (ta && VOICE.state === 'idle' && document.activeElement !== ta) { ta.focus({ preventScroll: true }); fields().refresh?.(); }
        return dictate();
      }
      closePalette(); toggleKeys(false); closeSettings(); closeUsage();
      code === 'KeyS' ? speakScreen() : commandVoice();
    });
    // ⌥Space search everything, ⌥O open an app: from anywhere, even while typing.
    if (alt && !shift && code === 'Space') return hit(() => palToggle('all'));
    if (alt && !shift && code === 'KeyO') return hit(() => { if (!e.repeat) palToggle('apps'); });
    // ⌥P float the chat over every desk; again, put it back on desktop 1. Even while typing.
    if (alt && !shift && code === 'KeyP') return hit(() => { if (!e.repeat) { closePalette({ restore: false }); hudKey(); } });
    // Link pane: ⌘Enter keeps it as a window, ⌘⇧Enter opens it in the browser.
    if (LINKS && LINKS.isOpen() && (e.metaKey || e.ctrlKey) && k === 'Enter') return hit(() => LINKS.el.querySelector(shift ? '[data-ls="out"]' : '[data-ls="keep"]')?.click());
    // Escape while recording cancels the take first (James, 19 Oct); the next Escape navigates. Only the
    // keyboard does this: Back (escStep via history/native) still navigates and keeps recording.
    if (k === 'Escape' && !e.repeat && VOICE.state !== 'idle' && pal.hidden && !window.WosSelMenu?.state?.open) return hit(() => { vMode === 'dictate' ? dictate('cancel') : talk('cancel'); log('esc:voice-cancel'); });
    if (k === 'Escape' && LINKS && LINKS.isOpen() && fromFrame) { const did = escStep(); if (did) { e.preventDefault(); e.stopPropagation(); } return; }
    if (k === 'Escape') { const did = escStep(); if (did || fromFrame) { e.preventDefault(); e.stopPropagation(); } log('esc:' + (did || 'root')); return; }
    if (!pal.hidden) {
      // ⌘K's palette owns the keyboard while open. The app selector lets the window manager's ⌥ chords
      // through (⌥Enter, ⌥1…9, ⌥[ ], ⌥W…), stepping aside first, so a fresh desktop never traps them.
      if (palMode !== 'apps' || !alt || !/^(Digit[1-9]|Key[GIWFHJKLNTVP]|Slash|Comma|Bracket(Left|Right))$/.test(code)) return;
      closePalette({ restore: false });
      queueMicrotask(() => { const a = document.activeElement; if (!a || a === document.body || !a.getClientRects().length) restFocus(); });
    }
    if (settingsFocused() && !e.altKey) return; // the Settings window keeps its plain keys; ⌥ window keys work as in any window
    // Chats: ↑/↓ or j/k walk the thread list (from the list, the search box or an empty thread pane), / focuses search.
    {
      const f = focused(), plain = !e.altKey && !e.metaKey && !e.ctrlKey;
      const inList = !!e.target.closest?.('.pane-list'), inSearch = e.target.matches?.('[data-chsearch]');
      if (f?.app === 'chats' && !keyHints.pinned() && plain && !fromFrame) {
        const free = !typing(e.target) || inSearch;
        if (free && (inList || inSearch || !f.thread || e.target === winEl(f.id)) && (k === 'ArrowDown' || k === 'ArrowUp' || (!inSearch && (k === 'j' || k === 'k')))) { if (stepThread(f.id, k === 'ArrowDown' || k === 'j' ? 1 : -1)) return hit(() => {}); }
        if (k === '/' && !typing(e.target)) return hit(() => { const s = winEl(f.id)?.querySelector('[data-chsearch]'); if (s) { s.focus(); s.select(); } });
        if (k === 'Enter' && inSearch) { const r = listRows(f.id)[0]; if (r) return hit(() => { stepThread(f.id, 1); focusInside(f.id); }); }
      }
    }
    if (!e.altKey || e.metaKey || e.ctrlKey) {
      return;
    }
    // ⌥ (Option/Alt) keys. Use e.code: on a Mac, ⌥ turns e.key into symbols (⌥V = √).
    // The next visible slot adds a desktop; shifted slots move a window.
    // Home is never a window target and digits beyond the + slot stay inert.
    if (digit) return hit(() => {
      const target = C.workspaceNav.digitTarget(+digit[1], ws.length);
      if (!target || target.kind === 'home' || e.repeat) return;
      if (shift) { const f = focused(); if (!f || homeOpen) return; if (target.kind === 'new') ws.push(freshDesk()); moveWin(f.id, target.index); }
      else if (target.kind === 'new') newDesktop();
      else { lastWs = cur; goWs(target.index); }
    });
    // ⌥I: the chat list; again (list already in front): search chats and messages.
    if (code === 'KeyI') return hit(() => {
      const f = focused(), s = !homeOpen && f?.app === 'chats' && !f.thread && winEl(f.id)?.querySelector('[data-chsearch]');
      if (s && vis0(s) && document.activeElement !== s && !e.repeat) { s.focus(); s.select(); log('key:search-chats'); return; }
      openChatsList();
    });
    if (code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    if (code === 'KeyF') return hit(() => { if (!e.repeat) toggleMono(); });
    if (code === 'KeyR' && !shift) return hit(() => { if (!e.repeat) reloadCurrent(); });
    if (code === 'Slash') return hit(() => toggleKeys());
    if (code === 'Comma') return hit(toggleSettings);
    // ⌥] / ⌥[ next / previous window on this desk (Chats: list, then message box), then on to the next / previous desk.
    if (code === 'BracketLeft') return hit(() => { if (shift) return moveDesk(cur, cur - 1); stepWin(-1); });
    if (code === 'BracketRight') return hit(() => { if (shift) return moveDesk(cur, cur + 1); stepWin(1); });
    const dir = { ArrowLeft: [-1, 0], KeyH: [-1, 0], ArrowRight: [1, 0], KeyL: [1, 0], ArrowUp: [0, -1], KeyK: [0, -1], ArrowDown: [0, 1], KeyJ: [0, 1] }[code];
    // ⌥ arrows are word/paragraph jumps while typing on a Mac: leave them to the text field (⌥HJKL still move focus).
    if (dir && /^Arrow/.test(code) && typing(e.target)) return;
    if (dir) return hit(() => { if (shift && dir[0]) swapWin(dir[0]); else dirFocus(dir[0], dir[1]); });
  }
  addEventListener('keydown', e => onKey(e), true);
  addEventListener('keyup', e => keyHints.up(e), true);
  addEventListener('blur', () => keyHints.hide());
  addEventListener('pointerdown', e => { if (!keyHints.mine(e.target)) keyHints.hide(); }, true);
  // Composer: ⌘/Ctrl+Enter sends (shared Chats binds it); Enter stays a newline, as in the phone.
  const log = s => { window.__wuxLog = (window.__wuxLog || []).concat(s).slice(-40); };

  /* ---------------- browser Back never leaves the app ----------------
   * The desktop has Esc for layers, but a mouse back button or ⌘[ still fires popstate. Keep one guard
   * entry and treat Back as Esc; at the root it stays put and says so. */
  // AppServices owns the single history guard when available. Running both guards
  // peeled two layers and appended a second entry on every Back.
  // Keep the boot sentinel: a direct Home entry must survive Back before the
  // first pointer gesture arms AppServices. Only one popstate consumer is installed.
  if (history.state?.wux !== 'guard') { history.replaceState({ wux: 'root' }, ''); history.pushState({ wux: 'guard' }, ''); }
  if (!window.WizAppServices?.guardBack) {
    addEventListener('popstate', () => {
      const did = escStep(); log('back:' + (did || 'root'));
      history.pushState({ wux: 'guard' }, '');
      if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    });
  }

  /* ---------------- live data ---------------- */
  if (LIVE) LIVE.onChange(() => {
    paintBar(); CHATS.markVisibleThreadsSeen();
    for (const id of Object.keys(W)) {
      const w = W[id]; if (w.app !== 'chats' && !CHATS.isHosted(id)) continue;
      const el = winEl(id); if (!el) continue;
      const lp = el.querySelector(`[data-chats="${id}::list"]`);
      if (lp && !lp.contains(document.activeElement) && !CHATS.holdList(id + '::list')) CHATS.renderChatList(listWin(id), lp);
      if (w.thread) CHATS.loadThread(w);
      syncChatsPane(id);
    }
    const d = ws[cur]; if (!d.wins.length) { const h = wsEl(cur).querySelector('.home'); if (h) paintHome(h, homeHtml(cur)); }
    if (homeOpen) paintHome($('#desktopHome'), homeHtml(null));
    hudPaint();
  });
  OUTBOX?.onChange(() => { if (homeOpen) paintHome($('#desktopHome'), homeHtml(null)); else if (!ws[cur].wins.length) { const h = wsEl(cur).querySelector('.home'); if (h) paintHome(h, homeHtml(cur)); } for (const id of [...ws[cur].wins, ...(hud?.open ? [hud.id] : [])]) { const w = W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread) { const el = stage.querySelector(`[data-chats="${id}"]`); if (el) CHATS.renderThread(w, el); } } });
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (res.steered) toast('✦', 'Sent · steering the live run', 1600);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(W)) if ((W[id].app === 'chats' || CHATS.isHosted(id)) && W[id].thread === it.sessionId) setTimeout(() => W[id] && CHATS.loadThread(W[id], true), 1500);
  });
  // Open threads poll a little faster while Archimedes works.
  setInterval(() => { if (document.hidden) return; for (const id of [...ws[cur].wins, ...(hud?.open ? [hud.id] : [])]) { const w = W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread && w.thread !== '__new__') CHATS.loadThread(w); } }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE?.refresh(); CHATS.markVisibleThreadsSeen(); } });

  /* ---------------- toast ---------------- */
  let toastT = 0;
  function toast(icon, text, ms = 2000) { const t = $('#toast'); t.innerHTML = `<span>${window.WizBrand.icon(esc(icon))}</span><span>${esc(text)}</span>`; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

  /* ---------------- native bridge (Wizard for Mac drives this by events) ---------------- */
  C.bridge.handle({
    orb: d => talk(d.action || 'toggle'),
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
      const fields = dictationFields || (dictationFields = window.WizCore.focusedField.create({
        frames: () => $$('iframe', stage).filter(f => { const w = W[f.closest('[data-win]')?.dataset.win]; return !!APP[w?.appId]; }),
        admit: (c, el) => { const win = c.frame?.closest('[data-win]') || el.closest('[data-win]'); return (!win || win.dataset.win === ws[cur].focus) && !!el.getClientRects().length; },
      }));
      const target = fields.capture();
      if (target) { fields.insert(target, text); target.release(); return; }
      const f = focused();
      if (f?.app === 'chats' && f.thread && CHATS.insertText(f.id, text)) return;
      if (f?.app === 'chats') { newChat(); setTimeout(() => CHATS.insertText(focused().id, text), 60); return; }
    },
    back() { const did = escStep(); log('native-back:' + (did || 'root')); },
  });

  /* ---------------- deep links + boot ---------------- */
  render();
  /* Workspace sync (core/workspace-sync.js): the same desktops on every device; layout and full screen stay here. */
  window.WosWorkspaceSync?.create({
    shell: 'desktop',
    title: w => appOf(w)?.name || w.title || w.appId,
    read: () => ({ desks: ws.map(d => ({ id: d.id, wins: d.wins.map(id => W[id]).filter(Boolean) })) }),
    apply(state, o = {}) {
      if (!state) { const i = ws.findIndex(d => d.id === o.focus); if (i >= 0) { closeSettings(); goWs(i); } return; }
      const here = ws[cur]?.id, at = cur;
      const r = window.WosWorkspaceSync.reconcile(ws, W, state, { fresh: id => ({ ...freshDesk(), id }) });
      r.removed.forEach(id => { boundManager?.dismiss(W[id]); if (W[id]?.app === 'chats') CHATS.saveDraft(id); delete W[id]; CHATS.forget(id); });
      ws = r.desks.length ? r.desks : [freshDesk()];
      ws.forEach(d => { d.mono = !!d.mono && d.wins.length > 0; });
      cur = ws.findIndex(d => d.id === here); if (cur < 0) cur = Math.max(0, Math.min(at, ws.length - 1));
      save(); render();
    },
  });
  // In-app browser (core/links.js): links tapped in Wizard open in a right-half pane.
  const LINKS = window.WizLinks ? window.WizLinks.mount({
    parent: document.body, mode: 'pane',
    onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a, { fresh: false }); else { const o = appAt(url); newWin({ app: 'frame', url, title: o ? o.name : title, ...(o ? { appId: o.id } : {}) }); } },
    // A page preview opens as a window like any other (wizard-os#265 rule 7): ✕, ⌥W and Esc close it, Keep is not needed.
    asWindow: (url, title) => { const o = appAt(url); newWin({ app: 'frame', url, title: o ? o.name : title, preview: true, ...(o ? { appId: o.id } : {}) }); return true; },
  }) : null;
  // A link to a page inside an installed app opens as that app's window (its services: shared microphone,
  // Back, theme), not in the plain link pane (James, 19 Oct 2026: Outline said "not connected to Wizard").
  if (LINKS) LINKS.route = href => {
    let u; try { u = new URL(href, location.href); } catch (e) { return false; }
    const a = u.origin === location.origin && appAt(u.href); if (!a) return false;
    const rel = u.pathname + u.search + u.hash, same = new URL(a.url, location.href);
    if (same.pathname + same.search === u.pathname + u.search) { openApp(a, { fresh: false }); return true; }
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
        openApp(APP['app-store']);
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
  C.deeplink.consume();
  window.WosScenery?.attach({ device: document.body, homeInView: () => (homeOpen || !ws[cur].wins.length) && setEl.hidden && pal.hidden && !keyHints.pinned() && usageEl.hidden && !window.WosResources?.state?.panel });
  new MutationObserver(() => window.WosScenery?.update()).observe(stage, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
  window.WosSetupLaunch?.boot({ open: id => { const a = APP[id]; if (a) openApp(a); }, alongsideOnly: true,
    firstRunTour: !!DESK_TOUR && !window.WosTour.done(), tour: why => DESK_TOUR?.start(why), markTour: () => window.WosTour?.mark(),
    busy: () => VOICE.state !== 'idle' || !setEl.hidden || !pal.hidden || [...document.querySelectorAll('.ch-compose textarea')].some(t => t.value.trim()) }); // Setup opens itself on first run
  C.status?.attach({ openChats: openChatsList, current: () => { const f = focused(); return f?.app === 'chats' && f.thread !== '__new__' ? f.thread || '' : ''; } });
  const f0 = focused(); if (f0) setTimeout(() => focusInside(f0.id), 50);

  /* "Update ready" pill in the top bar: the same banner as the phone (core/web-update.js), names the thread that made the
   * update with a Thread button that opens it in a window here; Reload is held while recording or uploading. */
  window.WizWebUpdate?.init({
    shell: 'desktop', log: (...a) => { window.__wuxLog = (window.__wuxLog || []).concat(a.join(' ')).slice(-80); },
    mount: () => document.querySelector('#bar .bar-r') || document.body, prepend: true,
    openThread: sid => openThread(sid),
    busy: () => window.WizShareWizard?.busy || ((dictationFinishing || VOICE.state !== 'idle') && !(vHandedOff && !['listen', 'paused'].includes(VOICE.state) && OUTBOX.handedOff?.(vHandedOff))) || Object.values(W).some(win => (CHATS.ch(win.id)?.files || []).some(f => f.uploading)),
    beforeReload: () => { for (const el of document.querySelectorAll('[data-compose]')) el.dispatchEvent(new Event('input', { bubbles: true })); },
    toast,
  });
  fields();
  window.__wux = {
    get links() { return LINKS; },
    shell: 'desktop', get ws() { return ws; }, get voiceState() { return VOICE.state; },
 get wins() { return W; }, get cur() { return cur; }, live: LIVE, outbox: OUTBOX, chats: CHATS, canSearch: () => !!APP['wizard-search'],
    get homeOpen() { return homeOpen; }, goHome, get palMode() { return pal.hidden ? '' : palMode; },
    goWs, newDesktop, closeDesktop, closeCurrent, newWin, closeWin, focusWin, moveWin, openApp, openThread, newChat, openPalette, closePalette, openPicker, openChatsList, talk, ask, escStep, viewContext,
    openFiles, openUsage, recordReply, openSearch, localCommand, commandVoice, dictate, toast,
    pauseVoice: () => VOICE.state === 'paused' ? VOICE.resume() : VOICE.pause(),
    openSettings, closeSettings, stepThread, setListW, get listW() { return listW(); },
    get hud() { return hud ? { ...hud } : null; }, hudOn, hudDock, hudClose, hudKey,
    get voice() { return VOICE.state; }, get log() { return window.__wuxLog || []; },
  };
  /* Skin packages (core/skin-host.js) on desktop: the same narrow adapter the phone shell hands over, so a skin
   * declared when: 'always' runs its script here too. James's skins declare no package and load nothing. */
  const skinChatsWin = () => { const f = focused(); return f && f.app === 'chats' ? f : (ws[cur].wins.map(id => W[id]).find(x => x && x.app === 'chats') || null); };
  window.WosSkinHost?.attach({
    route() { const w = homeOpen ? null : skinChatsWin(); return { view: w ? (w.thread ? 'thread' : 'list') : 'desk', thread: w?.thread || null, desk: cur }; },
    back: () => !!escStep(),
    openList: () => { const w = skinChatsWin(); if (w) { CHATS.openChat(w.id, null); syncChatsPane(w.id); } },
    openThread: id => openThread(id),
    goDesk: i => goWs(i),
    newThread: () => { const w = skinChatsWin(); if (w) CHATS.openChat(w.id, '__new__'); },
    // Inbox tweak: answer a notification in this Chats window (the Notifications Reply path); words send it at once.
    contextDraft: (key, item, words) => { const w = skinChatsWin(); if (!w) return false; focusWin(w.id); CHATS.openContextDraft(w.id, key, item); CHATS.renderChats(w); syncChatsPane(w.id); if (words) CHATS.sendChat(w.id, words, 'tapping Resolve this on a notification in Chats'); else setTimeout(() => focusInside(w.id), 30); return true; },
    models: () => { const w = skinChatsWin(); return w ? CHATS.tweakModels(w.id) : []; },
    model: (choice, alive) => { const w = skinChatsWin(); return w ? CHATS.tweakModel(w.id, choice, alive) : null; },
    deskCount: () => ws.length,
    root() { const w = skinChatsWin(); return w ? document.querySelector(`[data-chats="${w.id}"]`) : null; },
    dock: () => null,
    locked: () => false,
    toast: text => toast('◇', text, 2400),
  });
  // Closed means closed: an app with no window left on any desktop stops its microphone (take saved for recovery).
  window.WizAppServices?.trackOpenApps?.(() => ws.flatMap(d => d.wins).map(id => W[id]).filter(Boolean).flatMap(w => [w.appId, w.servicesAs]));
  window.WizAppServices?.guardBack(() => {
    const did = escStep(); log('back:' + (did || 'root'));
    if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    return true;
  }, toast);
})();
