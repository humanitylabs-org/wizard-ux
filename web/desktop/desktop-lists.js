/* Wizard UX desktop shell › the Chats list window, its side pane and the channel feed pane. Moved out of desktop.js
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
window.WizCore.desktopParts.lists = function ({ $$, APP, CHATS, desktopVars, feedSaved, findWin, focused, focusInside, focusWin, listWins, mainChats, newChat, openApp, openThread, panelWins, save, sidePanes, sideWin, stage, store, toast, uid, winEl, winTitle }) {
  let log, panelForward, panelThreadLeft; // late-bound: desktop.js declares these after the call, see bindLate
  // A reload (an update's too) opens the channel feed the main column showed (wizard-ux issue 1339); Chats still decides
  // whether it holds (the switch on, the channel still there).
  { const f = feedSaved, k = v => !!v && typeof v === 'object' && typeof v.kind === 'string' && typeof v.key === 'string';
    if (f && typeof f === 'object' && /^feed-[a-z0-9]+$/.test(String(f.id)) && f.chan && typeof f.chan.id === 'string')
      desktopVars.feedBase = { id: f.id, app: 'chats', thread: null, focus: k(f.focus) ? { kind: f.focus.kind, key: f.focus.key } : null, chan: { id: f.chan.id, prev: k(f.chan.prev) ? { kind: f.chan.prev.kind, key: f.chan.prev.key } : null } }; }
  // (a layout's sidebar pane is one more such list window, id::side: the AI apps Channels pane, wizard-ux issue 1256)
  function listWin(id, kind = 'list') { const k = kind === 'side' ? id + '::side' : id; return listWins[k] || (listWins[k] = { id: id + '::' + (kind === 'side' ? 'side' : 'list'), get thread() { return null; }, set thread(v) { if (v) { const w = desktopVars.W[id]; if (w) { w.thread = v; save(); CHATS.renderChats(w); syncChatsPane(id); } else if (sideWin(id)) { if (v === '__new__') newChat(); else openThread(v); } } } }); }
  // The window behind the sidebar's Channels pane: the main Chats window, else the stand-in (created on demand). When a
  // main Chats window shows up, it takes over the stand-in's open channel (its feed stays on screen) and its filter.
  function sideMain() {
    const w = findWin(mainChats);
    if (!w) return desktopVars.sideBase || (desktopVars.sideBase = { id: 'side-' + uid(), app: 'chats', thread: null });
    if (desktopVars.sideBase) {
      const sb = desktopVars.sideBase; desktopVars.sideBase = null;
      if (sb.chan && !w.chan) { w.chan = { ...sb.chan, prev: w.focus || null }; w.focus = sb.focus || null; save(); }
      const f = CHATS.ch(sb.id).chanFilter; if (f && !CHATS.ch(w.id).chanFilter) CHATS.ch(w.id).chanFilter = f;
      CHATS.forget(sb.id); CHATS.forget(sb.id + '::side');
    }
    return w;
  }
  // The main column's feed window: the sidebar's pane opens channels there (null for every other window).
  // The sidebar look's list window (issue 1443).
  const viewKey = key => !!desktopVars.viewBase && String(key) === desktopVars.viewBase.id + '::side';
  const feedPane = w => { const id = String(w?.id || ''); return !!desktopVars.ownsChatList && /::side$/.test(id) && !(desktopVars.feedBase && id === desktopVars.feedBase.id + '::side'); };
  function feedPaneFor(w) {
    if (!feedPane(w)) return null;
    const id = String(w.id), base = desktopVars.W[id.slice(0, -6)] || sideWin(id.slice(0, -6)); if (!base) return null;
    if (!desktopVars.feedBase) desktopVars.feedBase = { id: 'feed-' + uid(), app: 'chats', thread: null, focus: null };
    // A fresh open starts from the sidebar's own Focus (General shows the agent it lists), never a Space it held.
    const f = CHATS.focusOf(base); desktopVars.feedBase.chan = null; CHATS.ch(desktopVars.feedBase.id).chanFilter = CHATS.ch(desktopVars.feedBase.id).chanFilter || CHATS.ch(base.id).chanFilter;
    desktopVars.feedBase.focus = f?.kind === 'space' ? { kind: 'agent', key: CHATS.focusAgentId(base) } : f ? { ...f } : null;
    if (desktopVars.feedBase.focus && !desktopVars.feedBase.focus.key) desktopVars.feedBase.focus = null;
    return listWin(desktopVars.feedBase.id, 'side');
  }
  const feedOpen = () => (desktopVars.feedBase ? CHATS.chanOpen(listWin(desktopVars.feedBase.id, 'side')) : null);
  function feedOpened(id) {
    if (!desktopVars.feedBase || id !== desktopVars.feedBase.id + '::side') return;
    if (desktopVars.sideHost?.isConnected) { const w = sideMain(); CHATS.renderChatList(listWin(w.id, 'side'), desktopVars.sideHost); }
    if (desktopVars.feedHost?.isConnected && desktopVars.feedHost.dataset.chats === id) CHATS.renderChatList(listWin(desktopVars.feedBase.id, 'side'), desktopVars.feedHost);
    try { globalThis.dispatchEvent(new CustomEvent('wos:channel-feed', { detail: { open: feedOpen() } })); } catch (_) {}
  }
  // The sidebar pane's and the feed's clicks: a post opens in the main Chats like a sidebar row; the rest is Chats' own.
  function paneClicks(host) {
    if (sidePanes.has(host)) return; sidePanes.add(host);
    host.addEventListener('click', e => {
      const sid = host.dataset.chats || '', base = sid.replace(/::side$/, ''); if (!desktopVars.W[base] && !sideWin(base)) return;
      const row = !e.target.closest('.ch-post-t a[href]') && e.target.closest('[data-chopen]'); // a link in a post is the link (ux#1287)
      if (row && CHATS.justPressed()) { e.stopPropagation(); return; }
      if (row && !e.target.closest('.ch-sheet')) { e.stopPropagation(); openThread(row.dataset.chopen); return; }
      if (CHATS.click(e, sid)) { e.stopPropagation(); syncChatsPane(base); if (desktopVars.feedBase && base === desktopVars.feedBase.id) feedOpened(sid); }
    });
  }
  // A feed left open in the sidebar by the earlier design (saved on the main Chats window): it moves to the main column.
  function feedCarry(w) {
    const pane = listWin(w.id, 'side'), open = w.chan && CHATS.chanOpen(pane); if (!open) return;
    const to = feedPaneFor(pane); if (!to) return;
    desktopVars.feedBase.focus = w.focus ? { ...w.focus } : null; desktopVars.feedBase.chan = { ...w.chan, prev: desktopVars.feedBase.focus };
    CHATS.channelBack(pane); feedOpened(to.id);
  }
  function syncChatsPane(id) {
    const base = String(id).replace(/::list$/, ''); const w = desktopVars.W[base]; if (!w || w.app !== 'chats') return;
    if (globalThis.WosSkinHost?.panelMode && desktopVars.panelDocked) { const sid = w.thread; if (sid && desktopVars.panelList?.id === base) queueMicrotask(() => panelForward(base, sid)); else if (sid && desktopVars.panel?.id === base) desktopVars.panel.held = true; else if (!sid && desktopVars.panel?.id === base && desktopVars.panel.held) queueMicrotask(() => panelThreadLeft(base)); }
    const el = winEl(base); if (!el) return;
    for (const n of el.querySelectorAll('.pane-list, .pane-split, .pane-empty')) { n.hidden = desktopVars.ownsChatList; n.style.display = desktopVars.ownsChatList ? 'none' : ''; }
    const box = el.querySelector('.dchats'); if (box) box.dataset.thread = w.thread || '';
    $$('.ch-row', el).forEach(r => r.classList.toggle('cur', r.dataset.chopen === w.thread));
    window.WosAgents.refreshTitlebars();
    el.setAttribute('aria-label', winTitle(w));
    if (focused()?.id === base) document.title = `${winTitle(w)} · Wizard`;
  }
  /* The Chats list/thread divider: moved verbatim to desktop/desktop-divider.js (issue 1665). */
  const { listRows, listW, readyRows, setListW } = window.WizCore.desktopParts.divider({ $$, stage, store, winEl });

  function stepReady(dir, tries = 0) {
    let f = focused();
    const atHome = desktopVars.homeOpen && !(globalThis.WosSkinHost?.panelMode && panelWins().some(mainChats)); // a Chats panel counts as open, over Home
    const fresh = tries > 0 || atHome || !mainChats(f); // arriving from elsewhere always starts at the top
    if (atHome || !mainChats(f)) {
      const w = (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(x => desktopVars.W[x])).find(mainChats);
      if (w && !atHome) { focusWin(w.id); f = w; return setTimeout(() => stepReady(0, 1), 0); }
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
  function stepThread(id, dir) {
    const w = desktopVars.W[id]; if (!w || w.app !== 'chats') return false;
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
  return { chatsUpDown, feedCarry, feedOpen, feedOpened, feedPane, feedPaneFor, listRows, listW, listWin, paneClicks, readyRows, setListW, sideMain, stepThread, syncChatsPane, viewKey, bindLate: v => { if ('log' in v) log = v.log; if ('panelForward' in v) panelForward = v.panelForward; if ('panelThreadLeft' in v) panelThreadLeft = v.panelThreadLeft; } };
};
