/* Wizard UX desktop shell › stepping along desks and windows, the bar and usage. Moved out of desktop.js
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
window.WizCore.desktopParts.steps = function ({ $, $$, ago, APP, appOf, APPS, C, canLeave, CHATS, closeWin, desktopHost, desktopVars, dictate, emoOf, esc, focused, focusInside, focusWin, freshDesk, hudClose, hudDock, hudOn, ico, layout, listRows, listWin, LIVE, MOD, mountWin, moveWin, openApp, openChatsList, openThread, OUTBOX, panelBack, panelClose, panelWins, removeWin, render, save, stage, store, syncChatsPane, talk, toast, toggleMono, winEl, winTitle, wsEl }) {
  let closePalette, closeSettings, closeUsage, LINKS, log, openPalette, openPicker, openSettings, paintUsage, settingsOver, toggleKeys, usageEl; // late-bound: desktop.js declares these after the call, see bindLate
  // ⌥[ / ⌥]: one step left or right along the bar, no wrapping (Miguel, 27 Oct 2026). Left of desktop 1 is Home;
  // nothing is left of Home and nothing right of the last desktop.
  function stepDesk(dir) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    if (desktopVars.homeOpen) { if (dir > 0 && desktopVars.ws.length) { desktopVars.lastWs = desktopVars.cur; goWs(0); if (desktopVars.cur === 0 && desktopVars.homeOpen) leaveHome(); } return; }
    if (dir < 0 && desktopVars.cur === 0) { desktopVars.lastWs = desktopVars.cur; goHome(); return; }
    const t = desktopVars.cur + dir; if (t < 0 || t >= desktopVars.ws.length) return;
    desktopVars.lastWs = desktopVars.cur; goWs(t);
  }
  // ⌥] / ⌥[ (Miguel, 28 Oct 2026): walk this desk's windows left to right first (left to right), and only
  // past the last (or first) one step on to the next (or previous) desk. Chats with a chat open is two stops: the
  // chat list, then the message box. Arriving on a desk with ] starts at its leftmost stop, with [ at its rightmost.
  // Plain ⌥← / ⌥→ belong to native word navigation, never thread actions.
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
    const d = desktopVars.ws[desktopVars.cur]; if (desktopVars.homeOpen || !d) return [];
    const mid = id => { const r = winEl(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const ids = d.mono ? d.wins.filter(id => winEl(id)) // full screen: the others are hidden; keep the tiling order
      : d.wins.filter(id => winEl(id) && !winEl(id).classList.contains('gone')).map(id => [id, mid(id)]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(x => x[0]);
    return ids.flatMap(id => twoSides(desktopVars.W[id]) ? [[id, 'list'], [id, 'thread']] : [[id, '']]);
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
    if (!(side && chatsSide(desktopVars.W[id], side))) focusInside(id);
    log('step:' + (desktopVars.W[id]?.app || id) + (side ? ':' + side : ''));
  }
  function stepWin(dir) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const st = !desktopVars.homeOpen && nextStop(dir); if (st) return goStop(st);
    const from = desktopVars.ws[desktopVars.cur], wasHome = desktopVars.homeOpen; stepDesk(dir); // by desk, not index: leaving an empty desk prunes it
    if (desktopVars.homeOpen || (desktopVars.ws[desktopVars.cur] === from && !wasHome)) return;
    const stops = deskStops(); if (stops.length) goStop(stops[dir > 0 ? 0 : stops.length - 1]);
  }
  function goWs(i, { from } = {}) {
    if (globalThis.WosSkinHost?.panelMode) return; // no desks while a layout holds the panel
    window.WosResources?.back();
    if (!Number.isInteger(i) || i < 0 || i >= desktopVars.ws.length) return;
    if (i !== desktopVars.cur && !CHATS.beforeNavigate(desktopVars.ws[i].wins)) return;
    if (i === desktopVars.cur) { if (desktopVars.homeOpen) { leaveHome(); if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); } return; }
    desktopVars.homeOpen = false; store.set('homeOpen', false);
    // Preserve the later-approved empty-desktop pruning contract.
    const target = desktopVars.ws[i], left = desktopVars.ws[desktopVars.cur], prune = !left.wins.length && desktopVars.ws.length > 1;
    const prev = desktopVars.cur;
    if (prune) { desktopVars.ws.splice(desktopVars.cur, 1); i = desktopVars.ws.indexOf(target); }
    desktopVars.lastWs = prune ? i : prev; desktopVars.cur = i; save();
    const el = wsEl(i); el.classList.add(i >= prev ? 'from-r' : 'from-l');
    render(); requestAnimationFrame(() => el.classList.remove('from-r', 'from-l'));
    CHATS.markVisibleThreadsSeen();
  }

  // A new desktop opens with the app selector over it: an empty desktop is a place to open something.
  // An empty current desktop is reused rather than stacked, so repeated ⌘T / + never leaves blanks behind.
  function newDesktop() {
    if (globalThis.WosSkinHost?.panelMode) { openPicker(); return desktopVars.ws[desktopVars.cur]; } // no desks here: ⌥T just offers the apps (they open in the panel)
    if (desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.ws.push(freshDesk()); goWs(desktopVars.ws.length - 1); } else if (desktopVars.homeOpen) leaveHome();
    openPicker({ desk: desktopVars.ws[desktopVars.cur].id });
    return desktopVars.ws[desktopVars.cur];
  }
  function removeDesktop(d) {
    const i = desktopVars.ws.indexOf(d); if (i < 0 || desktopVars.ws.length === 1) return false;
    const current = desktopVars.ws[desktopVars.cur], previous = desktopVars.ws[desktopVars.lastWs], active = current === d;
    desktopVars.ws.splice(i, 1);
    desktopVars.cur = active ? Math.max(0, i - 1) : desktopVars.ws.indexOf(current);
    desktopVars.lastWs = Math.max(0, desktopVars.ws.indexOf(previous === d ? desktopVars.ws[desktopVars.cur] : previous));
    if (active) { desktopVars.homeOpen = false; store.set('homeOpen', false); }
    save(); render();
    if (active) { if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); }
    return true;
  }
  function closeDesktop(i = desktopVars.cur) {
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    const d = desktopVars.ws[i]; if (!d) return false;
    // Check every window before destroying any: a recording can refuse the close.
    if (!d.wins.every(id => canLeave(id, true))) return false;
    const names = [...new Set(d.wins.map(id => appOf(desktopVars.W[id])?.name).filter(Boolean))].join(', ');
    [...d.wins].forEach(id => removeWin(id));
    if (!removeDesktop(d)) { save(); render(); goHome(); }
    toast('✕', `Closed ${names || 'desktop'}`); return true;
  }
  /* Refresh what is in front, in place: app frames reload at the page they are on, Chats refetches its list and open
   * thread, built-in views remount, and Home refetches its data. Nothing closes or moves. */
  const reloadable = w => !!w;
  function refreshData() { window.WizCore.refreshApps?.(); return Promise.resolve(LIVE?.refresh?.()).catch(() => {}); }
  function reloadWin(id) {
    const w = desktopVars.W[id], el = winEl(id); if (!reloadable(w) || !el) return false;
    if (w.appId === 'troubleshooter') { el.querySelector('[data-recovery-check]')?.click(); window.WizReach?.reloadRepair(el.querySelector('iframe')); return true; }
    if (w.app === 'chats' || CHATS.isHosted(id)) {
      refreshData().then(() => {
        if (!desktopVars.W[id]) return;
        if (desktopVars.W[id].thread && desktopVars.W[id].thread !== '__new__') CHATS.loadThread(desktopVars.W[id], true);
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
  function reloadCurrent() { if (desktopVars.homeOpen || !desktopVars.ws[desktopVars.cur].wins.length) return refreshHome(); const f = focused(); return f ? reloadWin(f.id) : refreshHome(); }
  function closeCurrent() { const f = focused(); if (f) { closeWin(f.id); return 'app'; } if (desktopVars.homeOpen) return 'root'; return closeDesktop() ? 'desktop' : 'root'; }

  /* ---------------- top bar ---------------- */
  addEventListener('wizard:app-counts', () => paintBar());
  addEventListener('wizard:notifications', () => render());
  function paintBar() {
    window.WosBell?.paint?.();
    const A = LIVE?.ok ? C.activityHome?.(LIVE) : null, L = LIVE?.ok ? { ...LIVE.groups(), ...A } : { needs: [], ready: [], working: [] }; // needs = Activity's with Channels on (issue 1517)
    C.workspaceNav.refreshChats(LIVE, APP.wizard?.id || 'wizard');
    $('#logo').setAttribute('aria-current', desktopVars.homeOpen ? 'page' : 'false');
    $('#logo').innerHTML = C.workspaceNav.icon({ home: true }, desktopVars.W, appOf);
    if (!$('#wsList').classList.contains('arranging')) $('#wsList').innerHTML = desktopVars.ws.map((d, i) => {
      const hot = d.wins.some(id => { const w = desktopVars.W[id]; if (w?.app !== 'chats' || !w.thread) return false; const s = LIVE?.session(w.thread); return s && LIVE.isNew(s); });
      const names = d.wins.map(id => winTitle(desktopVars.W[id])).join(', ');
      return `<button class="ws${!desktopVars.homeOpen && i === desktopVars.cur ? ' cur' : ''}${d.wins.length ? ' used' : ''}${hot ? ' hot' : ''}" data-ws="${i}" aria-label="${esc(names || 'Empty desktop')} · Desktop ${C.workspaceNav.slot(i)}" aria-current="${!desktopVars.homeOpen && i === desktopVars.cur ? 'page' : 'false'}"${C.workspaceNav.slot(i) <= 9 ? ` aria-keyshortcuts="Alt+${C.workspaceNav.slot(i)}"` : ''} title="${esc(names || 'Empty desktop')}${C.workspaceNav.slot(i) <= 9 ? ` (${MOD}${C.workspaceNav.slot(i)})` : ''}">${C.workspaceNav.icon(d, desktopVars.W, appOf)}${d.wins.length || desktopVars.ws.length > 1 ? `<span class="ws-close" role="button" data-wsclose="${i}" tabindex="-1" aria-label="Close desktop ${C.workspaceNav.slot(i)}" title="Close desktop">✕</span>` : ''}</button>`;
    }).join('') + `<button class="ws ws-add" data-newdesk aria-label="New desktop" title="New desktop (${MOD}T${C.workspaceNav.slot(desktopVars.ws.length) <= 9 ? ` / ${MOD}${C.workspaceNav.slot(desktopVars.ws.length)}` : ''})">+</button>`;
    const st = $('#status'), unread = C.workspaceNav.chatsCount(LIVE);
    if (!LIVE?.ok) st.innerHTML = `<span class="off">${LIVE?.error === 'access' ? 'Sign in to Wizard' : 'Connecting…'}</span>`;
    else st.innerHTML = `${L.needs.length ? `<span title="Needs you"><i class="st needs"></i>${L.needs.length}</span>` : ''}${unread ? `<span title="${C.workspaceNav.readyWord(LIVE) === 'ready' ? 'Ready' : 'Unread'}"><i class="st unread"></i>${C.workspaceNav.label(APP.wizard?.id || 'wizard')}</span>` : ''}${L.working.length ? `<span title="Working"><i class="st working"></i>${L.working.length}</span>` : ''}`;
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
    const d = desktopVars.ws[+b.dataset.ws]; if (!d) return;
    window.WosContextMenu.open({ anchor: b, x, y, label: 'Desktop actions',
      // Keep the stable desktop, not its index: a reorder must not close another desk.
      items: [{ label: 'Close desktop', action: () => closeDesktop(desktopVars.ws.indexOf(d)) }] });
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
    if (globalThis.WosSkinHost?.panelMode) return false; // no desks while a layout holds the panel
    if (from === to || !desktopVars.ws[from] || to < 0 || to >= desktopVars.ws.length) return false;
    const curD = desktopVars.ws[desktopVars.cur], lastD = desktopVars.ws[desktopVars.lastWs];
    desktopVars.ws.splice(to, 0, desktopVars.ws.splice(from, 1)[0]);
    desktopVars.cur = desktopVars.ws.indexOf(curD); desktopVars.lastWs = Math.max(0, desktopVars.ws.indexOf(lastD)); save(); render(); return true;
  }
  {
    const list = $('#wsList'), slots = () => $$('.ws[data-ws]', list);
    let dd = null, swallow = 0;
    const start = () => { dd.on = true; dd.b.classList.add('ws-moving'); list.classList.add('arranging'); try { list.setPointerCapture(dd.id); } catch (e) { /* already released */ } navigator.vibrate?.(8); };
    list.addEventListener('pointerdown', e => {
      const b = e.target.closest('.ws[data-ws]'); if (!b || e.target.closest('[data-wsclose]') || e.button !== 0 || desktopVars.ws.length < 2) return;
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
  $('#voiceCancel').addEventListener('click', () => desktopVars.vMode === 'dictate' ? dictate('cancel') : talk('cancel'));
  // No transcriber on this Wizard: the mic button hides (the outbox still keeps typed messages safe).
  // Capability changes include background native Parakeet preparation, not just bootstrap.
  const paintVoiceCapability = () => { $('#micBtn').hidden = !window.WizConfig.has('voice'); };
  window.WizConfig?.ready.then(paintVoiceCapability);
  window.addEventListener('wizard:config', paintVoiceCapability);

  /* Home is a root view, separate from desktops: every open app and draft stays mounted. */
  function leaveHome() {
    window.WosResources?.back();
    if (!desktopVars.homeOpen || globalThis.WosSkinHost?.panelMode) return;
    // A view with Settings over every page may prepare Chats behind the picker when it mounts.
    // Keep that modal (and its Look page) open; ordinary Home navigation still closes it.
    if (desktopVars.settingsModal && !settingsOver()) closeSettings();
    desktopVars.homeOpen = false; store.set('homeOpen', false); render();
  }
  function goHome() {
    if (!CHATS.beforeNavigate([])) return;
    window.WosResources?.back();
    for (const id of Object.keys(desktopVars.W)) if (desktopVars.W[id].app === 'chats') CHATS.saveDraft(id);
    closePalette(); toggleKeys(false); closeSettings(); closeUsage();
    window.WizWebUpdate?.back(); // Preserve the accepted shared banner; fold its navigation list.
    LINKS?.close();
    for (let i = 0; i < 20 && CHATS.closeOverlay(); i++) { /* Close navigation sheets, never the recorder. */ }
    if (globalThis.WosSkinHost?.panelMode && (desktopVars.panel || desktopVars.panelApp)) { panelClose({ paint: false }); panelClose({ paint: false }); } // Home (⌥`) with no desks: the chat and the app slide away (a docked list stays)
    desktopVars.homeOpen = true; store.set('homeOpen', true); render();
    $('#desktopHome').focus({ preventScroll: true });
  }
  /* Home: moved verbatim to desktop/desktop-home.js (issue 1665). */
  const { homeHtml, paintHome } = window.WizCore.desktopParts.home({ ago, APP, APPS, C, emoOf, esc, ico, LIVE, MOD, OUTBOX });
  stage.addEventListener('click', e => {
    if (e.target.closest('[data-home-settings]')) return openSettings();
    if (e.target.closest('[data-home-unsent]')) return openSettings('unsent');
    const ha = e.target.closest('.home [data-home-act]')?.dataset.homeAct;
    if (ha) { openApp(APP.wizard); const w = (globalThis.WosSkinHost?.panelMode ? panelWins() : desktopVars.ws[desktopVars.cur].wins.map(id => desktopVars.W[id])).find(x => x?.app === 'chats' && !x.agent); if (w) { if (ha === 'working') CHATS.setFilter(w, 'working'); else CHATS.clearFilter?.(w); } return; }
    const hr = e.target.closest('.home [data-thread]'); if (hr) return openThread(hr.dataset.thread);
    const ap = e.target.closest('.home [data-app]'); if (ap) return openApp(APP[ap.dataset.app]);
  });

  /* ---------------- window interactions ---------------- */
  stage.addEventListener('pointerdown', e => { const el = e.target.closest('.win'); if (el) desktopHost.focus(el.dataset.win, { scroll: false }); }, true);
  stage.addEventListener('click', e => {
    const el = e.target.closest('.win'); if (!el) return;
    const id = el.dataset.win, w = desktopVars.W[id];
    const act = e.target.closest('[data-wact]')?.dataset.wact;
    if (act === 'hud') return hudOn(id);
    if (act === 'hud-home') return hudDock({ to: 0 });
    if (act === 'panel-back') return panelBack(id);
    if (act === 'close' && desktopVars.hud?.id === id) return canLeave(id) && hudClose();
    if (act === 'close') return desktopHost.close(id);
    if (act === 'reload') return reloadWin(id);
    if (act === 'mono') return toggleMono();
    if (act === 'pop') { const a = appOf(w); let href = a.url; try { href = el.querySelector('iframe').contentWindow.location.href; } catch (err) {} return window.open(href, '_blank', 'noopener'); }
    if (w?.app === 'chats' || CHATS.isHosted(id)) {
      // Topic emoji taps belong to shared Chats; do not let the desktop pane adapter open the row first.
      if (e.target.closest('[data-chpick]')) { const cid = e.target.closest('[data-chats]')?.dataset.chats; if (cid && CHATS.click(e, cid)) { e.stopPropagation(); syncChatsPane(id); return; } }
      // Rows in the list pane open in this window's thread pane.
      const row = !e.target.closest('.ch-post-t a[href]') && e.target.closest('[data-chopen]'); // a link in a post is the link (ux#1287)
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
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]') || e.target.closest('.win.panel') || e.button !== 0) return;
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
    if (over && over.dataset.win !== d.id) { const L = desktopVars.ws[desktopVars.cur].wins, a = L.indexOf(d.id), b = L.indexOf(over.dataset.win); if (a >= 0 && b >= 0) { [L[a], L[b]] = [L[b], L[a]]; save(); layout(); } }
  });
  // Tiles follow the window when it is resized natively (Mac window drag, zoom, full screen). WKWebView can send
  // resize before the stage has its new bounds, and can pause CSS transitions while the window is behind another
  // app, so: lay out again when the stage itself changes size, and turn the geometry transitions off while resizing.
  let resizeSettled;
  function resizeTiles() {
    document.body.classList.add('desktop-resizing');
    layout();
    clearTimeout(resizeSettled);
    resizeSettled = setTimeout(() => document.body.classList.remove('desktop-resizing'), 200);
  }
  addEventListener('resize', resizeTiles);
  if (window.ResizeObserver) new ResizeObserver(resizeTiles).observe(stage);

  /* ---------------- palette: one box for apps, threads, commands and asking Archimedes ----------------
   * Two modes of the same box. 'all' (⌘K): apps, threads, commands, Search and Ask, as a list.
   * 'apps' (⌘O, and every new desktop): the app selector, the apps alone as square tiles like the
   * phone's launcher, search focused; ←↑↓→ move through the grid, ↵ opens, ⌘K widens to 'all'.
   * Opening remembers what had focus; Esc, Back or a click outside puts it back. Nothing is written. */
  const pal = $('#palette'), palCard = $('.pal-card', pal), palIn = $('#palInput'), palList = $('#palList');
  return { closeCurrent, closeDesktop, goHome, goWs, homeHtml, leaveHome, moveDesk, newDesktop, nextStop, paintBar, paintHome, pal, palCard, palIn, palList, reloadable, reloadCurrent, removeDesktop, stepDesk, stepWin, bindLate: v => { if ('closePalette' in v) closePalette = v.closePalette; if ('closeSettings' in v) closeSettings = v.closeSettings; if ('closeUsage' in v) closeUsage = v.closeUsage; if ('LINKS' in v) LINKS = v.LINKS; if ('log' in v) log = v.log; if ('openPalette' in v) openPalette = v.openPalette; if ('openPicker' in v) openPicker = v.openPicker; if ('openSettings' in v) openSettings = v.openSettings; if ('paintUsage' in v) paintUsage = v.paintUsage; if ('settingsOver' in v) settingsOver = v.settingsOver; if ('toggleKeys' in v) toggleKeys = v.toggleKeys; if ('usageEl' in v) usageEl = v.usageEl; } };
};
