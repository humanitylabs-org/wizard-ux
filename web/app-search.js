/* Wizard UX phone shell › the Review coach, quick search and placing an app in a window. Moved out of app.js
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
window.WizCore.appParts.search = function ({ APP, appAt, appVars, blank, CHATS, clip, closeSheets, closeWin, deskOf, device, esc, focusedWin, focusWin, fromOf, goDesk, HOME, insertPos, LIVE, mainChats, mountLinks, openWin, renderDesk, save, searchUrl, setFull, sharedDeskOrder, sideButtonTap, store, syncDesks, vib, winApp, winEl }) {
  let toast; // late-bound: app.js declares these after the call, see bindLate
  function closeReviewCoach() { if (!appVars.rvCoach) return false; const el = appVars.rvCoach; appVars.rvCoach = null; el.classList.remove('open'); setTimeout(() => el.remove(), 240); return true; }
  function showReviewCoach(f) {
    if (appVars.rvCoach || store.get('rvCoached', false)) return;
    store.set('rvCoached', true);
    appVars.rvCoach = document.createElement('div'); appVars.rvCoach.className = 'rv-coach'; appVars.rvCoach.setAttribute('role', 'dialog'); appVars.rvCoach.setAttribute('aria-label', 'Review mode');
    appVars.rvCoach.innerHTML = `<div class="rv-card"><div class="rv-h"><i></i>Review mode</div>
      <p><b>Tap the orb and talk.</b> Your feedback goes to <b>${esc(clip(LIVE?.session(f.from.sid)?.title || (f.from.title !== 'Thread' && f.from.title) || 'the thread you came from', 48))}</b>.</p>
      <p><b>Open app</b> keeps the app on its own desk${f.bound ? ", while this review stays with the thread" : ""}.</p>
      <p>${f.bound ? "<b>Tap the left edge</b> or swipe right on the bottom bar to return to the thread. <b>Back</b> returns too; leaving the thread closes its review view." : "<b>Back</b> or <b>✕</b> closes the review and takes you back."}</p>
      <button class="rv-ok" type="button">Got it</button></div>`;
    appVars.rvCoach.addEventListener('click', () => closeReviewCoach());
    device.appendChild(appVars.rvCoach); void appVars.rvCoach.offsetWidth; appVars.rvCoach.classList.add('open');
  }
  function syncReviewChip() {
    const f = appVars.desks[appVars.idx] ? appVars.W[appVars.desks[appVars.idx].focus] : null, on = !!(f && f.from && f.from.sid);
    device.classList.toggle('reviewing', on);
    if (on) showReviewCoach(f); else closeReviewCoach();
  }
  /* Quick search: results open in the link sheet over whatever James is doing (no thread, no desk change). */
  function openSearch(query, tab) {
    const url = searchUrl(query, tab); if (!url) return false;
    closeSheets(true); mountLinks(); if (!appVars.LINKS) return false;
    appVars.LINKS.open(url); return true;
  }
  /* opening: moved to app-opening.js (wizard-ux issue 1665), called once here */
  const { framePage, openingEnd, openingReady, tapOpen } = window.WizCore.appParts.opening({ closeSheets, openApp, save, store, vib, winApp, winEl });
  function placeApp(mine, obj, opts = {}, refresh) {
    const here = opts.desk == null ? Object.keys(appVars.W).find(id => deskOf(id) >= 0 && mine(appVars.W[id])) : null;
    openingReady();
    if (!here) { const w = openWin(obj, opts); openingEnd(); return w; }
    delete appVars.W[here].seed; // the owner opened it himself: a starter app becomes one of his open apps (and syncs)
    if (appVars.W[here].app !== 'chats' || appVars.W[here].agent) bringBeside(here);
    const t = deskOf(here);
    if (refresh) refresh(appVars.W[here], t);
    if (t !== appVars.idx) goDesk(t, true);
    focusWin(here); save(); openingEnd();
    return appVars.W[here];
  }
  // Hosted Wizard apps (App Store, System) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  window.WizAppOpen = id => Object.values(appVars.W).some(w => w && w.appId === id);
  window.WizOpenApp = (id, path = '') => {
    const x = hostedOpenable(id); if (!x) return false;
    if (!path) { const r = window.WosSkinHost?.routeOpen?.('app', { id, path: '' }, () => openApp(x)); return r ? true : openApp(x); }
    let u; try { u = new URL(path, location.href); } catch (_) { return false; }
    const rel = u.pathname + u.search + u.hash;
    if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
    // An explicit repair action is an app workflow, not a page sent for review.
    const go = () => !!openWin({ app: 'frame', appId: id, url: rel, from: { ...fromOf(appVars.desks[appVars.idx].focus), sid: '' }, workflow: true });
    // a layout placing the shell's opens (apps.routeOpens): the app where it shows apps, at that page
    return window.WosSkinHost?.routeOpen?.('app', { id, path: rel }, go) ? true : go();
  };
  // An app the Store just installed may still be starting: core/apps.js waits for its page, saying so (issue 1651).
  const whenOpenable = (id, hint) => window.WizCore.whenOpenable(id, { openable: hostedOpenable, name: id => APP[id]?.name || (typeof hint === 'string' ? hint.slice(0, 80) : ''), say: t => toast('◌', esc(t), 4000) });
  // Only trusted system windows may ask; check the actual sender frame, never a claimed app id.
  addEventListener('message', async e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && appVars.W[host.dataset.win]; if (!w || !['app-store', 'agents', 'setup'].includes(w.appId)) return;
    // A just-installed app may still be starting: say so and open it once the registry has its page.
    const a = await whenOpenable(d.id, d.name); if (!a) return;
    const here = host.isConnected && appVars.W[host.dataset.win] === w;
    if (openApp(a) !== false && here && d.replace === true && w.appId === 'app-store') closeWin(host.dataset.win, true);   // Get more: the app takes the Store's place
  });
  /* App → agent binding: an app's settings sheet (core/app-route.js). Its Agents button opens the Agents app
   * at that agent; Agents frames may ask for an app's sheet. */
  window.WosAppRoute?.init({ openAgents: (id, o = {}) => { openApp(APP.agents); const msg = o.newPreset ? { type: 'wizard:agents-new', preset: o.newPreset } : id ? { type: 'wizard:agents-show', id } : null; if (msg) [400, 1100, 2200].forEach(t => setTimeout(() => { for (const f of document.querySelectorAll('iframe[title="Agents"]')) f.contentWindow?.postMessage(msg, location.origin); }, t)); } });
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:app-route' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && appVars.W[host.dataset.win]; if (!w || !['agents', 'app-store'].includes(w.appId)) return;
    window.WosAppRoute?.request(d);
  });
  /* The Agents app opens an agent's own Chats. Only those frames may ask; the agent must exist. */
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-agent-chats' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && appVars.W[host.dataset.win]; if (!w || !['agents'].includes(w.appId)) return;
    openAgentChats(d.id, { backTo: w.id, thread: d.thread === '__new__' ? '__new__' : '' });
  });
  /* Agent shortcuts select Focus in the main Chats window; no per-agent window or desk. */
  async function openAgentChats(id, o = {}) {
    const AG = window.WosAgents; if (!AG || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ''))) return false;
    if (!AG.get(id)) await AG.load(true);
    if (!AG.get(id)) { toast('!', 'That agent isn’t on this Wizard', 2000); return false; }
    closeSheets(true);
    const w = placeApp(mainChats, { app: 'chats', thread: null });
    if (!w) return false;
    // Chats on its Activity list (the phone's Inbox) shows every agent and drops an agent Focus on its next paint
    // (actAllAgents), so the agent's own list opens there the way the Chats switcher opens it (ux#1989).
    if (!(CHATS.chanView?.() === 'activity' && CHATS.switcher?.go?.(w, '#@agent:' + id))) CHATS.setFocus(w, { kind: 'agent', key: id });
    if (w && o.thread === '__new__') CHATS.openNewDraft(w.id, '');
    LIVE?.refreshAgents?.().then(() => LIVE.emit());
    return o.share ? { id: w.id, agentId: id } : true;
  }
  window.WizOpenAgentChats = openAgentChats;
  // The agent-locked Chats window (w.agent: that agent's list, new chats and replies) an agent tile opens in the Apps
  // section. It is an app window like any other: it stays through a reload (app-seed.js keeps agent windows).
  async function openAgentWin(id, opts = {}) {
    const AG = window.WosAgents; if (!AG || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ''))) return false;
    if (!AG.get(id)) await AG.load(true);
    if (!AG.get(id)) { toast('!', 'That agent isn’t on this Wizard', 2000); return false; }
    closeSheets(true);
    const w = placeApp(x => x.app === 'chats' && x.agent === id && !x.from && !x.bound, { app: 'chats', agent: id, thread: null }, opts);
    LIVE?.refreshAgents?.().then(() => LIVE.emit());
    return !!w;
  }
  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focusedWin()?.appId === id });
  function openApp(a, extra = {}, opts = {}) {
    if (!a) return false;
    if (a.id === 'pages') { closeSheets(true); placeApp(w => w.app === 'pages' && !w.from, {app:'pages', appId:'pages'}, opts); return true; }
    // A launcher link to one of the agent's Pages opens in the Pages window (pages are sandboxed, opaque-origin documents).
    const pageSlug = a.url && window.WosPages?.match(a.url);
    if (pageSlug) { closeSheets(true); placeApp(w => w.app === 'pages' && w.pageSlug === pageSlug, {app:'pages', appId:'pages', pageSlug}, opts); return true; }
    if (a.id !== 'troubleshooter' && a.kind === 'wizard' && a.url && !opts.setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openApp(a, extra, { ...opts, setupChecked: true }), { settled: () => openingEnd(a.id) });
    if (a.id === 'side-button') { closeSheets(true); if (appVars.idx !== HOME) goDesk(HOME); sideButtonTap(true); return true; }
    if (a.kind === 'chats') {
      // An agent's tile (the Apps panel, the Apps sheet, voice) opens like any app: its own window, locked to that
      // agent, in the Apps section; the main Chats window keeps its list, Focus and thread (ux#2007). The Chats
      // switcher, the Agents app and links still focus the agent in Chats (openAgentChats).
      if (a.agent) return openAgentWin(a.agent, opts);
      const chatsProvider = a.chatsProvider || CHATS.views.defaultId();
      placeApp(w => w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === chatsProvider, { app: 'chats', thread: null, chatsProvider }, opts);
      return true;
    }
    if (a.kind === 'wizard' && a.url && opts.from) {
      // Opened from a link in a thread (James, 12 Oct 2026): Back closes it and lands on that thread again,
      // exactly like any other link. A copy already opened from a link is reused; a normal desk of the app is left alone.
      placeApp(w => w.app === 'frame' && w.appId === a.id && w.from, { app: 'frame', appId: a.id, from: opts.from }, {}, w => { w.from = opts.from; });
      return true;
    }
    // extra.path: one of the app's own pages (a spoken declared route), opened exactly like a tap, then at that page.
    if (a.kind === 'wizard' && a.url) { const path = extra.path || ''; placeApp(w => w.app === 'frame' && w.appId === a.id && !w.from, { app: 'frame', appId: a.id, ...(path ? { url: path } : {}) }, opts, path ? w => framePage(w, path) : null); return true; }
    const q = extra.query || '';
    placeApp(w => w.app === 'app' && w.appId === a.id, { app: 'app', appId: a.id, query: q }, opts, q ? (w, t) => { w.query = q; renderDesk(t); } : null);
    return true;
  }
  /* Move an open window to where a new app would open (insertPos: right beside this desk, Home included.
   * A window alone on its desk takes its whole desk along; one sharing a desk gets a desk of its own. */
  function bringBeside(id) {
    if (sharedDeskOrder()) return;
    const from = deskOf(id); if (from < 0 || from === appVars.idx) return;
    const t = insertPos(); if (from === t) return;
    if (appVars.desks[from].wins.length === 1) {
      const [d] = appVars.desks.splice(from, 1); appVars.desks.splice(from < t ? t - 1 : t, 0, d);
      if (appVars.idx > from && appVars.idx <= t) appVars.idx--; // keep the desk in front (Home) the same desk
    } else {
      const f = appVars.desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      appVars.desks.splice(t, 0, blank({ wins: [id], focus: id })); renderDesk(from);
    }
    syncDesks(); save();
  }
  /* Notifications = the Chats list itself: unfiltered, out of any thread, scrolled to the top (Working, Ready). */
  function openChatsList() {
    closeSheets(true);
    let here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard); here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0); }
    if (!here) return;
    const t = deskOf(here); if (t !== appVars.idx) goDesk(t, true);
    focusWin(here); const w = appVars.W[here], d = appVars.desks[t]; if (d.full && d.focus !== here) setFull(d.focus, false);
    const c = CHATS.ch(here); c.q = ''; c.sheet = false; c.fromCard = false; c.coach = false; c.filterFrom = null;
    if (!CHATS.setFilter(w, '')) CHATS.renderChats(w);
    requestAnimationFrame(() => { const sc = winEl(here)?.querySelector('.ch-scroll'); if (sc) sc.scrollTop = 0; });
  }
  // The Chats window in front as it is (its thread kept; opened if there is none): the AI apps view's main screen.
  function showChats() {
    // A layout's deferred Home -> Chats preparation is not an owner navigation.
    // Keep the same Settings sheet/page over the new view, without closing,
    // reopening, or parking it back on the Home desk we are preparing behind it.
    const keepSettings = appVars.sheet === 'settings';
    if (!keepSettings) closeSheets(true);
    let here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard, {}, { stay: keepSettings }); here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0); }
    if (!here) return null;
    const t = deskOf(here); if (t !== appVars.idx) goDesk(t, true, keepSettings);
    focusWin(here); return appVars.W[here];
  }
  /* Home's Unread and Working cards: the Chats window, filtered to just those threads. Back clears the filter
   * and returns to the desk the card was tapped on. */
  function openChatsFiltered(f, opts = {}) {
    closeSheets(true);
    const from = appVars.desks[appVars.idx].id;
    let here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard); here = Object.keys(appVars.W).find(id => mainChats(appVars.W[id]) && deskOf(id) >= 0); }
    if (!here) return;
    const t = deskOf(here); if (t !== appVars.idx) goDesk(t, true);
    focusWin(here); const w = appVars.W[here], d = appVars.desks[t]; if (d.full && d.focus !== here) setFull(d.focus, false);
    const c = CHATS.ch(here); c.q = ''; c.sheet = false; c.lastChip = 'status';
    // The chip is the same one James can add himself from the filter button; the first time, one coach line.
    c.coach = !store.get('chipCoached', false); store.set('chipCoached', true);
    c.fromCard = !!opts.card;
    c.filter = ''; CHATS.setFilter(w, f); c.filterFrom = opts.from === undefined ? from : opts.from;
  }

  /* ---------------- side button (WizardOS Android app only) ----------------
   * The switch lives on Home. One tap: WizardOS asks for the microphone in place, then opens the one system page
   * Android keeps for itself (pick WizardOS as the assistant). Back in WizardOS, the app pushes the new state to
   * window.__wosSideButton and the card turns green on its own. Once the side button has really reached Wizard
   * OS, the card disappears. */
  const NATIVE = () => window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function';
  return { bringBeside, closeReviewCoach, framePage, hostedOpenable, NATIVE, openAgentChats, openApp, openChatsFiltered, openChatsList, openSearch, placeApp, showChats, syncReviewChip, tapOpen, bindLate: v => { if ('toast' in v) toast = v.toast; } };
};
