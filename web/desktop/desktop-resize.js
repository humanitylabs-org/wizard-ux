/* Wizard UX desktop shell › resizing and splitting windows, spots on a desk and the light/dark flip. Moved out of desktop.js
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
window.WizCore.desktopParts.resize = function ({ APP, appAt, appOf, C, CHATS, closeWin, desktopVars, esc, focused, hudHasFocus, ico, IS_MAC, LIVE, mainChats, MOD, newWin, OUTBOX, panelHas, panelWins, render, save, shownBeside, stage, store, toast, winTitle, wsOf }) {
  let clampN, closePalette, closeSettings, closeUsage, goHome, goWs, hostSettings, hudBar, hudFocus, layout, leaveHome, listW, log, paintBar, paintFocus, PANEL_BACK, panelBar, panelSnap, reloadable, setEl, syncChatsPane, toggleKeys; // late-bound: desktop.js declares these after the call, see bindLate
  function noteSpot() {
    if (desktopVars.spotQ) return; desktopVars.spotQ = true;
    queueMicrotask(() => { desktopVars.spotQ = false; const s = desktopVars.homeOpen ? 'home' : desktopVars.ws[desktopVars.cur] ? desktopVars.ws[desktopVars.cur].focus || 'd:' + desktopVars.ws[desktopVars.cur].id : null; if (s && s !== desktopVars.spotNow) { if (desktopVars.spotNow) desktopVars.spotPrev = desktopVars.spotNow; desktopVars.spotNow = s; } });
  }
  function spotLive(s) {
    if (s === 'home') return true;
    if (s?.startsWith('d:')) return desktopVars.ws.some(d => d.id === s.slice(2));
    return !!s && !!desktopVars.W[s] && wsOf(s) >= 0;
  }
  function jumpBack() {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const s = desktopVars.spotPrev;
    if (!spotLive(s)) return toast('↩', 'Nowhere to go back to yet', 1500);
    closePalette({ restore: false }); toggleKeys(false); closeSettings(); closeUsage();
    if (s === 'home') { desktopVars.lastWs = desktopVars.cur; goHome(); }
    else if (s.startsWith('d:')) { const i = desktopVars.ws.findIndex(d => d.id === s.slice(2)); if (i !== desktopVars.cur) desktopVars.lastWs = desktopVars.cur; goWs(i); if (desktopVars.homeOpen) leaveHome(); }
    else { if (wsOf(s) !== desktopVars.cur) desktopVars.lastWs = desktopVars.cur; focusWin(s); }
    log('jump-back');
  }
  function flipLight() {
    const tw = window.WosSkin?.twin?.();
    if (!tw) return toast('◐', 'This skin has no light / dark version', 1600);
    window.WosSkin.set(tw.id); toast('◐', tw.name, 1000); log('skin:' + tw.id);
  }
  /* ⌥− / ⌥= (Omarchy's resize): the window in front gets narrower / wider. Each desk keeps its own split. */
  const SPLIT = [0.25, 0.75];
  const splitOf = C.panes.splitOf;
  function resizable(d) { return !desktopVars.homeOpen && !d.mono && d.wins.length >= 2 && !(d.wins.length <= 4 && d.wins.some(id => desktopVars.W[id]?.share > 0)); }
  function resizeFocused(dir) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const d = desktopVars.ws[desktopVars.cur], f = focused();
    if (!f || desktopVars.hud?.id === f.id || !resizable(d)) return toast('⇔', `Two windows side by side: ${MOD}− narrower · ${MOD}= wider`, 1800);
    const n = d.wins.length, v = splitOf(d, n) + (d.wins[0] === f.id ? dir : -dir) * 0.08;
    d.split = Math.round(clampN(v, SPLIT[0], SPLIT[1]) * 100) / 100; save(); layout();
  }
  function focusWin(id, { scroll = true } = {}) {
    if (desktopVars.hud?.id === id) { hudFocus(); return; }
    if (globalThis.WosSkinHost?.panelMode) { if (panelHas(id)) { desktopVars.panelFrontId = id; if (scroll) focusInside(id); CHATS.markVisibleThreadsSeen(); } return; } // no desks: only the panels' windows
    const t = wsOf(id); if (t < 0) return;
    const fromHome = desktopVars.homeOpen, switched = t !== desktopVars.cur;
    leaveHome();
    if (switched) goWs(t);
    // goWs may prune an empty desktop and reindex the destination; use its new
    // current index, not the pre-navigation index of this stable window ID.
    if (wsOf(id) !== desktopVars.cur) return; // navigation was refused by an in-progress recording
    // A cross-desktop return target needs real keyboard focus, even though render
    // has already painted it as the focused window on its destination desktop.
    if (!switched && !fromHome && desktopVars.ws[desktopVars.cur].focus === id && document.querySelector(`.win[data-win="${id}"].focus`)) return;
    desktopVars.ws[desktopVars.cur].focus = id; save(); paintFocus(); paintBar();
    if (scroll) focusInside(id);
    CHATS.markVisibleThreadsSeen();
  }
  function focusInside(id) {
    if (desktopVars.homeOpen && !(globalThis.WosSkinHost?.panelMode && panelHas(id))) return;
    const el = winEl(id); if (!el) return;
    const w = desktopVars.W[id];
    if (w.app === 'chats') {
      const ta = el.querySelector('.pane-main textarea');
      if (w.thread && ta) { ta.focus({ preventScroll: true }); return; }
      const s = el.querySelector('[data-chsearch]'); if (s && !w.thread) return; // don't steal focus into search
    }
    el.focus({ preventScroll: true });
  }
  function moveWin(id, t) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const from = wsOf(id); if (from < 0 || t === from || t < 0 || t >= desktopVars.ws.length) return;
    const d = desktopVars.ws[from]; d.wins = d.wins.filter(x => x !== id); if (d.focus === id) d.focus = d.wins[0] || null; if (d.wins.length < 2) d.mono = false;
    desktopVars.ws[t].wins.push(id); desktopVars.ws[t].focus = id;
    save(); render(); toast('→', `Moved to desktop ${C.workspaceNav.slot(t)}`, 1000);
  }
  function swapWin(dir) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const d = desktopVars.ws[desktopVars.cur], i = d.wins.indexOf(d.focus), j = i + dir;
    if (i < 0 || j < 0 || j >= d.wins.length) return;
    [d.wins[i], d.wins[j]] = [d.wins[j], d.wins[i]]; save(); layout();
  }
  function toggleMono() {
    if (desktopVars.homeOpen || hudHasFocus() || globalThis.WosSkinHost?.panelMode) return; // Home must not alter a parked desktop's fullscreen preference; nor the HUD.
    const d = desktopVars.ws[desktopVars.cur]; if (!d.wins.length) return;
    d.mono = !d.mono; save(); layout();
    if (d.mono && !store.get('fullHint', false)) {
      store.set('fullHint', true); toast('⤢', `${MOD}F, Esc or Back leaves full screen`, 2200);
    }
  }

  /* Open an app the desktop way: Chats and apps already open get focused, not duplicated. */
  // Hosted Wizard apps (App Store) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  window.WizAppOpen = id => Object.values(desktopVars.W).some(w => w && w.appId === id);
  // Take a frame window to another page (its saved url too); an app page at the same address stays as it is.
  function framePage(w, rel) {
    w.url = rel; save();
    const f = winEl(w.id)?.querySelector('iframe'); if (!f) { render(); return true; }
    let now = ''; try { const l = f.contentWindow.location; now = l.pathname + l.search + l.hash; } catch (_) {}
    // (replace: a page change never adds a Back step of its own)
    if (now !== rel) { const url = window.WosOwnViews?.frameUrl(appOf(w), rel) || rel; try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.replace(url); } catch (_) { f.src = url; } }
    return true;
  }
  function closeWorkflow(w) {
    if (!w?.workflow || desktopVars.W[w.id] !== w) return false;
    const origin = w.returnWid; closeWin(w.id);
    if (desktopVars.W[origin]) focusWin(origin);
    return true;
  }
  // A link's preview window whose app says it is done (WizardApp.nav.back, e.g. Reader after handing a page it
  // cannot read to the owner's browser) closes, as Esc closes it; installed apps' own windows never close this way.
  function closePreview(w) {
    if (!w?.preview || desktopVars.W[w.id] !== w) return false;
    closeWin(w.id); return true;
  }
  window.WizOpenApp = (id, path = '') => {
    const x = hostedOpenable(id); if (!x) return false;
    if (!path) return openApp(x);
    let u; try { u = new URL(path, location.href); } catch (_) { return false; }
    const rel = u.pathname + u.search + u.hash;
    if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
    const go = () => !!newWin({ app: 'frame', appId: id, url: rel, workflow: true, returnWid: desktopVars.ws[desktopVars.cur].focus });
    // a layout placing the shell's opens (apps.routeOpens): the app where it shows apps, at that page
    const r = window.WosSkinHost?.routeOpen?.('app', { id, path: rel }, go); if (r) return true;
    return go();
  };
  // An app the Store just installed may still be starting: core/apps.js waits for its page, saying so (issue 1651).
  const whenOpenable = (id, hint) => window.WizCore.whenOpenable(id, { openable: hostedOpenable, name: id => APP[id]?.name || (typeof hint === 'string' ? hint.slice(0, 80) : ''), say: t => toast('◌', t, 4000) });
  // Only trusted system windows may ask; check the actual sender frame, never a claimed app id.
  addEventListener('message', async e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && desktopVars.W[host.dataset.win]; if (!w || !['app-store', 'agents', 'setup'].includes(w.appId)) return;
    // A just-installed app may still be starting: say so and open it once the registry has its page.
    const a = await whenOpenable(d.id, d.name); if (!a) return;
    const here = host.isConnected && desktopVars.W[host.dataset.win] === w;
    if (openApp(a) !== false && here && d.replace === true && w.appId === 'app-store') closeWin(host.dataset.win);   // Get more: the app takes the Store's place
  });
  /* App → agent binding: an app's settings sheet (core/app-route.js). Its Agents button opens the Agents app
   * at that agent; Agents frames may ask for an app's sheet. */
  window.WosAppRoute?.init({ openAgents: (id, o = {}) => { openApp(APP.agents); const msg = o.newPreset ? { type: 'wizard:agents-new', preset: o.newPreset } : id ? { type: 'wizard:agents-show', id } : null; if (msg) [400, 1100, 2200].forEach(t => setTimeout(() => { for (const f of document.querySelectorAll('iframe[title="Agents"]')) f.contentWindow?.postMessage(msg, location.origin); }, t)); } });
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:app-route' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && desktopVars.W[host.dataset.win]; if (!w || !['agents', 'app-store'].includes(w.appId)) return;
    window.WosAppRoute?.request(d);
  });
  // The Agents app opens an agent's own Chats. Only those frames may ask; the agent must exist.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-agent-chats' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && desktopVars.W[host.dataset.win]; if (!w || !['agents'].includes(w.appId)) return;
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
    return o.share ? { id: w.id, agentId: id } : true;
  }
  window.WizOpenAgentChats = openAgentChats;
  // Keep deep app links on the same admission path as Home and the launcher.
  function openAppLink(url, title, setupChecked = false) {
    const a = appAt(url);
    if (a && !setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openAppLink(url, title, true));
    const go = desk => !!newWin({ app: 'frame', appId: a ? a.id : 'link', url, title: a ? a.name : title }, Number.isInteger(desk) && desktopVars.ws[desk] ? { ws: desk } : {});
    const r = window.WosSkinHost?.routeOpen?.('link', { url, title: String(title || ''), app: a ? a.id : '' }, go); if (r) return true;
    return go();
  }
  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focused()?.appId === id });
  function openApp(a, opts = {}) {
    if (!a) return false;
    if (a.id === 'setup' && window.WosWelcome && window.WosWelcome.takesSetup !== false) { window.WosWelcome.open(); return true; } // Setup is the Welcome modal now
    if (a.id === 'pages') { const ex = !opts.fresh && findWin(w => w.app === 'pages'); if (ex) focusWin(ex.id); else newWin({app:'pages',appId:'pages'}, opts); return true; }
    // A launcher link to one of the agent's Pages opens in the Pages window: a page is a sandboxed (opaque-origin)
    // document, so a plain app frame can't read it and wrongly shows "can't show in a window".
    const pageSlug = a.url && window.WosPages?.match(a.url);
    if (pageSlug) { const ex = !opts.fresh && findWin(w => w.app === 'pages' && w.pageSlug === pageSlug); if (ex) focusWin(ex.id); else newWin({app:'pages',appId:'pages',pageSlug}, opts); return true; }
    // a layout placing the shell's opens (apps.routeOpens) puts an app where it shows apps (a desk given is stock's)
    if (a.url && a.kind !== 'chats' && opts.ws == null && !opts.fresh && window.WosSkinHost?.routeOpen?.('app', { id: a.id, path: opts.path || '' }, desk => openApp(a, { ...opts, ...(Number.isInteger(desk) && desktopVars.ws[desk] ? { ws: desk } : {}) }))) return true;
    if (a.id !== 'troubleshooter' && a.url && !opts.setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openApp(a, { ...opts, setupChecked: true }));
    if (a.kind === 'chats') {
      if (a.agent) return openAgentChats(a.agent);
      const chatsProvider = a.chatsProvider || CHATS.views.defaultId();
      const ex = !opts.fresh && findWin(w => w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === chatsProvider);
      if (ex) { focusWin(ex.id); return true; }
      newWin({ app: 'chats', thread: null, chatsProvider }, opts); return true;
    }
    // opts.path: one of the app's own pages (a spoken declared route), opened exactly like a tap, then at that page.
    if (a.url) {
      const ex = !opts.fresh && findWin(w => w.app === 'frame' && w.appId === a.id);
      if (ex) { focusWin(ex.id); if (opts.path) framePage(ex, opts.path); return true; }
      newWin({ app: 'frame', appId: a.id, ...(opts.path ? { url: opts.path } : {}) }, opts); return true;
    }
    if (a.href) { window.open(a.href, '_blank', 'noopener'); return true; }
    return false;
  }
  // Prefer this workspace, then any.
  function findWin(fn) {
    if (globalThis.WosSkinHost?.panelMode) return panelWins().find(fn) || null;
    const here = desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id]).find(fn); if (here) return here;
    return Object.values(desktopVars.W).find(w => w.id !== desktopVars.hud?.id && fn(w)) || null; // the heads-up chat is never reused as a desk window
  }
  function openThread(sid, opts = {}) {
    if (!sid) return;
    // Any agent's thread opens in the main Chats window, without changing its list Focus.
    const mine = mainChats;
    let w = !opts.fresh && ((globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(mine) || findWin(mine));
    if (!w) w = newWin({ app: 'chats', thread: null }, opts);
    else if (globalThis.WosSkinHost?.panelMode && desktopVars.panel?.id === w.id && w.thread && w.thread !== sid) { const k = panelSnap(w); if (k) { desktopVars.panel.back = [...desktopVars.panel.back, k].slice(-PANEL_BACK); hudBar(w.id); } } // the panel's Back returns to it
    focusWin(w.id); CHATS.openChat(w.id, sid);
    setTimeout(() => focusInside(w.id), 30);
  }
  // An app's chat (its Reply on a thread) in the main Chats, for a layout that keeps chats apart from apps (routeOpens)
  function threadFromApp(sid, opts = {}) { if (!CHATS.prepThread(sid, opts)) return false; openThread(sid); return true; }
  function openChatsList() {
    window.WosResources?.back(); closeSettings(); closePalette();
    openApp(APP.wizard);
    const w = focused();
    if (w?.app === 'chats' && w.thread) { CHATS.chatsBack(w); syncChatsPane(w.id); }
  }
  function newChat(opts = {}) {
    // ⌘Enter in an agent's Chats starts a chat with that agent; anywhere else, with the main agent.
    const f0 = focused();
    let w = !opts.fresh && (f0?.app === 'chats' ? f0 : (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(mainChats));
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
  // One lifecycle implementation, shared by Classic's controls and future native
  // layouts. Do not expose W/ws or Classic container elements to consumers.
  desktopVars.desktop = window.WizDesktop.attach({
    has: id => Object.hasOwn(desktopVars.W, id),
    windows: () => {
      const front = focused()?.id, beside = new Set(desktopVars.homeOpen ? [] : shownBeside());
      return Object.values(desktopVars.W).map(w => {
        const at = wsOf(w.id), d = desktopVars.ws[at];
        return { id: w.id, kind: w.app, appId: w.appId || '', desk: at, deskId: d?.id || null,
          title: winTitle(w), thread: w.thread || null, focused: front === w.id,
          tiled: !!d && (!d.mono || d.focus === w.id) && desktopVars.hud?.id !== w.id && !(globalThis.WosSkinHost?.panelMode && panelHas(w.id)),
          visible: !!(desktopVars.hud?.open && desktopVars.hud.id === w.id) || !!(globalThis.WosSkinHost?.panelMode && panelHas(w.id))
            || !desktopVars.homeOpen && (at === desktopVars.cur || beside.has(w.id)) && (!d?.mono || d.focus === w.id),
        };
      });
    },
    frame: id => winEl(id)?.querySelector('iframe') || null,
    // A shell whose app services predate layout-owned toolbars still starts the layout: no tools, no crash (James, 6 Nov 2026).
    renderTools: (frame, slot) => window.WizAppServices?.titlebar?.render?.(frame, slot) === true,
    openApp: id => Object.hasOwn(APP, id) && openApp(APP[id]) !== false,
    focus: (id, opts) => {
      // A layout already chose the visible panes. Keyboard focus is not a
      // second Classic navigation (cur/save/goWs/route) behind that renderer.
      if (globalThis.WosSkinHost?.layoutState?.active && !WosSkinHost.panelMode) {
        if (!desktopHost.windows().some(w => w.id === id && w.visible)) return false;
        if (opts.scroll) focusInside(id);
        return true;
      }
      focusWin(id, opts); return focused()?.id === id;
    },
    close: id => { closeWin(id); return !desktopVars.W[id]; },
    chats: id => CHATS.surface(id),
    // The desks' placement containers (Classic's own markup stays here).
    placements: () => [...stage.children].filter(n => n.classList?.contains('wsp')).map(n => ({ desk: Number(n.dataset.ws), node: n, shown: !n.hidden })),
    settings: () => ({ isOpen: !setEl.hidden && setEl.parentNode === document.body, closePart: setEl.querySelector('.st-close') }),
    closeSettings: () => { const open = !setEl.hidden; if (open) closeSettings(); return open && setEl.hidden; },
    settingsOverlay: () => {
      const had = document.documentElement.hasAttribute('data-settings-over');
      document.documentElement.setAttribute('data-settings-over', ''); hostSettings();
      let released = false;
      return () => {
        if (released) return; released = true;
        if (!had) document.documentElement.removeAttribute('data-settings-over');
        hostSettings();
      };
    },
    panes: C.panes,
  });
  const desktopHost = desktopVars.desktop.host;
  window.addEventListener('wizard:app-tools', desktopVars.desktop.changed);
  function wsEl(i) {
    const d = desktopVars.ws[i]; if (!d) return null;
    let el = stage.querySelector(`.wsp[data-desk="${d.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'wsp'; el.dataset.desk = d.id; stage.appendChild(el); }
    el.dataset.ws = i; return el;
  }
  function winHtml(w) { return `${barHtml(w)}
      <div class="wbody">${bodyHtml(w)}</div>${desktopVars.hud?.id === w.id ? '<div class="hud-grip" data-hudgrip title="Drag to resize" aria-hidden="true"></div>' : ''}`; }
  const HUD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="15.5" cy="14.5" r="2.6" fill="currentColor"/></svg>';
  const DESK1_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M10.6 9.6 12.6 8v8"/></svg>';
  function barHtml(w) {
    const a = appOf(w);
    if (globalThis.WosSkinHost?.panelMode && panelHas(w.id)) return panelBar(w, a);
    if (desktopVars.hud?.id === w.id) return `<div class="wbar" data-drag title="Drag to move">${window.WosAgents.titlebar(w.agent || '', 'ic', 't')}
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
    if (w.app === 'pages') return '<div class="pg-host"></div>';
    if (w.app === 'feature') return '<div class="shared-feature"></div>';
    if (w.app === 'settings') return '<div class="settings-host"></div>';
    if (w.app === 'chats') return `<div class="dchats" data-thread="${esc(w.thread || '')}" style="--list-w:${listW()}px"><div class="pane-list"><div class="chats" data-chats="${w.id}::list"></div></div>
      <div class="pane-split" data-split role="separator" aria-orientation="vertical" aria-label="Resize the thread list" tabindex="0" title="Drag to resize · double-click to reset"></div>
      <div class="pane-main"><div class="chats" data-chats="${w.id}"></div><div class="pane-empty"><div><b>Your conversations, side by side.</b><br>Choose a chat on the left, or start one.<br><button type="button" class="pane-newchat" data-panenew>Start a new chat</button><br><kbd>${MOD}↓</kbd> top ready chat · <kbd>${MOD}N</kbd> new chat · <kbd>${MOD}V</kbd> new voice chat · hold <kbd>${IS_MAC ? '⌥' : 'Alt'}</kbd> for every key</div></div></div></div>`;
    if (w.appId === 'troubleshooter') return window.WizReach.recoveryHtml();
    const a = appOf(w), url = window.WosOwnViews?.frameUrl(a, w.url) || w.url || a.url || '/';
    // Browser boundary: an app that can't run in a sandboxed window (Files, wizard-os#942) opens as its own tab.
    if (window.WizBrowserBoundary?.ownTab?.(a.id, url)) return `<div class="frame-fallback on" data-own-tab="${esc(a.id || '')}"><div><b>${esc(a.name)} opens in its own tab</b>It can’t run inside a Wizard window.<br><a href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(a.name)} ↗</a></div></div>`;
    return `${window.WosOwnViews?.noteHtml(a) || ''}<iframe data-own-app="${esc(a.id || '')}"${window.WizBrowserBoundary?.enabled ? ' ' + window.WizBrowserBoundary.frameAttributes(url, a.id) : ''} src="${esc(url)}" title="${esc(a.name)}" allow="${esc(window.WizCore?.frameAllow?.('microphone; clipboard-read; clipboard-write; autoplay; fullscreen', { id: a.id }) || 'microphone; clipboard-read; clipboard-write; autoplay; fullscreen; geolocation \'none\'')}"></iframe>
      <div class="frame-fallback"><div><b>${esc(a.name)} can’t show in a window</b><a href="${esc(url)}" target="_blank" rel="noopener">Open it in a tab ↗</a></div></div>`;
  }
  /* Chats on the desktop: list on the left, thread on the right, both from the shared Chats client.
   * The list pane is a second Chats "window" (id::list) that always shows the list. */
  const listWins = {}, sidePanes = new WeakSet();
  return { barHtml, closePreview, closeWorkflow, desktopHost, editUnsent, findWin, flipLight, focusInside, focusWin, framePage, hostedOpenable, jumpBack, listWins, moveWin, newChat, noteSpot, openAgentChats, openApp, openAppLink, openChatsList, openThread, resizable, resizeFocused, sidePanes, splitOf, spotLive, swapWin, threadFromApp, toggleMono, winEl, winHtml, wsEl, bindLate: v => { if ('clampN' in v) clampN = v.clampN; if ('closePalette' in v) closePalette = v.closePalette; if ('closeSettings' in v) closeSettings = v.closeSettings; if ('closeUsage' in v) closeUsage = v.closeUsage; if ('goHome' in v) goHome = v.goHome; if ('goWs' in v) goWs = v.goWs; if ('hostSettings' in v) hostSettings = v.hostSettings; if ('hudBar' in v) hudBar = v.hudBar; if ('hudFocus' in v) hudFocus = v.hudFocus; if ('layout' in v) layout = v.layout; if ('leaveHome' in v) leaveHome = v.leaveHome; if ('listW' in v) listW = v.listW; if ('log' in v) log = v.log; if ('paintBar' in v) paintBar = v.paintBar; if ('paintFocus' in v) paintFocus = v.paintFocus; if ('PANEL_BACK' in v) PANEL_BACK = v.PANEL_BACK; if ('panelBar' in v) panelBar = v.panelBar; if ('panelSnap' in v) panelSnap = v.panelSnap; if ('reloadable' in v) reloadable = v.reloadable; if ('setEl' in v) setEl = v.setEl; if ('syncChatsPane' in v) syncChatsPane = v.syncChatsPane; if ('toggleKeys' in v) toggleKeys = v.toggleKeys; } };
};
