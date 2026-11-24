/* Wizard UX desktop shell › tiling windows, full screen and the floating panel. Moved out of desktop.js
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
window.WizCore.desktopParts.tiling = function ({ $, $$, barHtml, C, canLeave, CHATS, desktopVars, esc, findWin, focused, focusInside, freshDesk, HUD_DEF, HUD_GAP, HUD_MIN, hudHasFocus, hudLayerEl, ico, listWin, mainChats, MOD, mountWin, newWin, noteSpot, panelAppW, panelChat, panelDeskApp, panelDeskRep, panelHas, panelListW, panelParkedW, panelReps, panelSlot, panelWin, panelWins, rememberClosed, removeWin, render, save, splitOf, stage, store, syncChatsPane, threadShown, toast, toggleMono, uid, winEl, winTitle, wsEl, wsOf }) {
  let closePalette, goWs, log, paintBar; // late-bound: desktop.js declares these after the call, see bindLate
  /* Tiling: capped windows form a centered group; 2 split; 3+ = master + stack.
   * Host-window fullscreen keeps this readable width; explicit monocle remains immersive. */
  function layout() {
    const d = desktopVars.ws[desktopVars.cur];
    // Apply chrome before measuring, including a single app, reload and workspace switches.
    const full = !desktopVars.homeOpen && !!d.mono && !!d.wins.length;
    document.body.classList.toggle('desktop-fullscreen', full);
    // Opinionated: a visible way out of full screen (the title bar and its ⤢ are hidden there).
    let ex = document.getElementById('exitFull');
    if (!ex) { ex = document.createElement('button'); ex.id = 'exitFull'; ex.type = 'button'; ex.className = 'exit-full'; ex.title = `Exit full screen (Esc / ${MOD}F)`; ex.setAttribute('aria-label', 'Exit full screen');
      ex.innerHTML = '⤡<span>Exit full screen</span>'; ex.addEventListener('click', () => { if (desktopVars.ws[desktopVars.cur].mono) toggleMono(); }); document.body.appendChild(ex); }
    ex.hidden = !full;
    const configuredMax = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-window-max-width'));
    const maxWidth = configuredMax > 0 ? configuredMax : 1200;
    // Hidden desks retain layout boxes. Size their apps before first load, in the chrome mode
    // they will have when selected, rather than inheriting the foreground desk's stage height.
    const barHeight = $('#bar').getBoundingClientRect().height;
    const sizes = desktopVars.ws.map((dk, i) => {
      if (!dk.wins.length) return null;
      const host = wsEl(i), deskFull = !!dk.mono;
      return [host.clientWidth, host.clientHeight + (deskFull ? barHeight : 0) - (full ? barHeight : 0), deskFull];
    });
    desktopVars.ws.forEach((dk, i) => { if (sizes[i]) tile(dk, ...sizes[i], maxWidth); });
  }
  function tile(d, W_, H_, full, maxWidth) {
    const g = full ? 0 : 8, n = d.wins.length;
    const rects = {};
    // Columns on request: a window that sets `share` (Video Editor's video + Feedback pair) lays the desktop out as
    // side-by-side columns in window order; windows without a share split what is left equally.
    const shared = !d.mono && n >= 2 && n <= 4 && d.wins.some(id => desktopVars.W[id]?.share > 0);
    if (d.mono) d.wins.forEach(id => { rects[id] = id === d.focus || n === 1 ? [g, g, W_ - 2 * g, H_ - 2 * g] : null; });
    else if (shared) {
      const cols = C.panes.columns(W_, d.wins.map(id => desktopVars.W[id]?.share), g);
      d.wins.forEach((id, j) => { rects[id] = [cols[j].x, g, cols[j].width, H_ - 2 * g]; });
    } else if (n === 1) {
      const width = Math.min(maxWidth, Math.max(0, W_ - 2 * g));
      rects[d.wins[0]] = [(W_ - width) / 2, g, width, H_ - 2 * g];
    } else if (n === 2) {
      const avail2 = Math.max(0, W_ - 3 * g), sp = splitOf(d, 2); // ⌥− / ⌥= move the split
      const lw = sp === 0.5 ? Math.min(maxWidth, avail2 / 2) : Math.min(maxWidth, avail2 * sp), rw = sp === 0.5 ? lw : Math.min(maxWidth, avail2 - avail2 * sp);
      const left = (W_ - lw - rw - g) / 2;
      rects[d.wins[0]] = [left, g, lw, H_ - 2 * g]; rects[d.wins[1]] = [left + g + lw, g, rw, H_ - 2 * g];
    } else {
      const available = Math.max(0, W_ - 3 * g);
      const naturalMaster = Math.round(available * splitOf(d, n));
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
    $$('.win.hud', stage).forEach(el => { if (el.dataset.win !== desktopVars.hud?.id) el.classList.remove('hud'); });
    if (hudLayer.nextSibling) stage.appendChild(hudLayer); // above every desk and Home
    if (!desktopVars.hud || !desktopVars.W[desktopVars.hud.id]) { if (desktopVars.hud) desktopVars.hud = null; hudPaint(); return; }
    let el = winEl(desktopVars.hud.id);
    if (!el) el = mountWin(desktopVars.W[desktopVars.hud.id], hudLayer); else if (el.parentNode !== hudLayer) hudLayer.appendChild(el);
    el.classList.add('hud'); el.classList.remove('gone', 'full', 'focus', 'drag');
    hudPaint();
  }
  // Re-draw a window's title bar for its place (desk or HUD); the body, thread and draft stay mounted.
  function hudBar(id) {
    const el = winEl(id), w = desktopVars.W[id]; if (!el || !w) return;
    el.querySelector(':scope > .wbar')?.remove(); el.insertAdjacentHTML('afterbegin', barHtml(w));
    el.querySelector(':scope > .hud-grip')?.remove();
    if (desktopVars.hud?.id === id) el.insertAdjacentHTML('beforeend', '<div class="hud-grip" data-hudgrip title="Drag to resize" aria-hidden="true"></div>');
    window.WosAgents.refreshTitlebars(); syncChatsPane(id);
  }
  function hudPaint() {
    const hudLayer = hudLayerEl();
    hudLayer.hidden = !desktopVars.hud;
    if (!desktopVars.hud) return;
    const SW = stage.clientWidth, SH = stage.clientHeight, el = winEl(desktopVars.hud.id);
    const w = Math.round(clampN(desktopVars.hud.w, HUD_MIN[0], Math.max(HUD_MIN[0], SW - 2 * HUD_GAP))), h = Math.round(clampN(desktopVars.hud.h, HUD_MIN[1], Math.max(HUD_MIN[1], SH - 2 * HUD_GAP)));
    if (el) {
      el.hidden = false;
      const r = clampN(desktopVars.hud.r, HUD_GAP, Math.max(HUD_GAP, SW - w - HUD_GAP)), b = clampN(desktopVars.hud.b, HUD_GAP, Math.max(HUD_GAP, SH - h - HUD_GAP));
      Object.assign(el.style, { left: (SW - r - w) + 'px', top: (SH - b - h) + 'px', width: w + 'px', height: h + 'px' });
    }
  }
  function hudFocus() {
    if (!desktopVars.hud?.open) return;
    const el = winEl(desktopVars.hud.id); if (!el) return;
    const ta = desktopVars.W[desktopVars.hud.id].thread && el.querySelector('.pane-main textarea');
    (ta && ta.getClientRects().length ? ta : el).focus({ preventScroll: true });
  }
  function hudOn(id) {
    const w = desktopVars.W[id]; if (w?.app !== 'chats' || globalThis.WosSkinHost?.panelMode) return false;
    if (desktopVars.hud?.id === id) return true;
    if (desktopVars.hud) hudDock({ focus: false });
    const t = wsOf(id); if (t < 0) return false;
    const d = desktopVars.ws[t], i = d.wins.indexOf(id);
    d.wins.splice(i, 1);
    if (d.focus === id) d.focus = d.wins[Math.min(i, d.wins.length - 1)] || null;
    if (d.wins.length < 2) d.mono = false;
    desktopVars.hud = { ...HUD_DEF, ...(store.get('hudPlace', null) || {}), id, open: true };
    save(); render(); hudBar(id);
    CHATS.markVisibleThreadsSeen();
    setTimeout(hudFocus, 30);
    if (!store.get('hudHint', false)) { store.set('hudHint', true); toast('◉', `Floats over every desk · ${MOD}P puts it back on desktop 1`, 2600); }
    log('hud:on');
    return true;
  }
  function hudKeepPlace() { if (desktopVars.hud) store.set('hudPlace', { r: desktopVars.hud.r, b: desktopVars.hud.b, w: desktopVars.hud.w, h: desktopVars.hud.h }); }
  // Put the HUD window back as a normal window on the desk in front (Home: the last desk).
  // Put the HUD window back as a normal window: on the desk in front (Home: the last desk), or on desk `to`
  // (⌥B and the 1 button: desktop 1, Chats' usual place), which then comes to the front.
  function hudDock({ focus = true, to = null } = {}) {
    if (!desktopVars.hud || globalThis.WosSkinHost?.panelMode) return false;
    const id = desktopVars.hud.id; hudKeepPlace(); desktopVars.hud = null;
    if (!desktopVars.W[id]) { save(); render(); return false; }
    // Back to desktop 1: Chats gets desktop 1 to itself. Anything already there moves one desk to the right,
    // with every other desk (Miguel, 28 Oct 2026).
    if (to === 0 && desktopVars.ws[0]?.wins.length) { desktopVars.ws.unshift(freshDesk()); desktopVars.cur += 1; desktopVars.lastWs += 1; }
    const t = Number.isInteger(to) && desktopVars.ws[to] ? to : desktopVars.cur;
    const d = desktopVars.ws[t], at = d.focus ? d.wins.indexOf(d.focus) + 1 : d.wins.length;
    d.wins.splice(at, 0, id); d.focus = id; d.mono = false;
    const el = winEl(id); if (el) el.hidden = false;
    if (t !== desktopVars.cur) { save(); render(); goWs(t); } else if (desktopVars.homeOpen) { desktopVars.homeOpen = false; store.set('homeOpen', false); }
    save(); render(); hudBar(id);
    if (focus) { paintFocus(); paintBar(); setTimeout(() => focusInside(id), 30); }
    log('hud:dock' + (to != null ? ':' + (t + 1) : ''));
    return true;
  }
  // ⌥P: float the Chats window in front (or this desk's, or the main one, or a new one); floating, put it back on desktop 1.
  function hudKey() {
    if (globalThis.WosSkinHost?.panelMode) return false;
    if (desktopVars.hud) return hudDock({ to: 0 });
    const f = focused();
    // Any Chats window on this desk (main or an agent's) floats as it is; elsewhere only the main Chats is borrowed.
    let w = f?.app === 'chats' ? f : !desktopVars.homeOpen ? desktopVars.ws[desktopVars.cur].wins.map(x => desktopVars.W[x]).find(x => x?.app === 'chats') : null;
    if (!w) w = findWin(mainChats) || newWin({ app: 'chats', thread: null });
    return hudOn(w.id);
  }
  // Back / Esc inside the floating chat: thread → its list. On the list it stays floating (⌥P or 1 put it away).
  function hudBack() {
    if (!hudHasFocus()) return '';
    const f = desktopVars.W[desktopVars.hud.id]; if (!f?.thread) return '';
    const r = CHATS.threadBack(f); syncChatsPane(f.id); hudFocus();
    return r || 'hud';
  }
  function hudClose() {
    if (!desktopVars.hud) return false;
    const id = desktopVars.hud.id; hudKeepPlace(); desktopVars.hud = null;
    if (desktopVars.W[id]) { threadShown(id, null); CHATS.saveDraft(id); delete desktopVars.W[id]; CHATS.forget(id); }
    save(); render(); log('hud:close');
    return true;
  }
  // Move by the title bar; resize by the top-left grip (the bottom-right corner stays put).
  let hudDrag = null;
  stage.addEventListener('pointerdown', e => {
    if (!desktopVars.hud || e.button !== 0) return;
    const grip = e.target.closest('[data-hudgrip]');
    const bar = !grip && e.target.closest('.win.hud > .wbar');
    if (!grip && (!bar || e.target.closest('[data-wact]'))) return;
    e.preventDefault(); e.stopPropagation();
    hudDrag = { size: !!grip, x: e.clientX, y: e.clientY, r: desktopVars.hud.r, b: desktopVars.hud.b, w: desktopVars.hud.w, h: desktopVars.hud.h, on: false };
  }, true);
  addEventListener('pointermove', e => {
    if (!hudDrag || !desktopVars.hud) return;
    const dx = e.clientX - hudDrag.x, dy = e.clientY - hudDrag.y;
    if (!hudDrag.on && Math.hypot(dx, dy) < 5) return;
    if (!hudDrag.on) { hudDrag.on = true; hudLayerEl().classList.add('moving'); }
    if (hudDrag.size) { desktopVars.hud.w = Math.max(HUD_MIN[0], hudDrag.w - dx); desktopVars.hud.h = Math.max(HUD_MIN[1], hudDrag.h - dy); }
    else { desktopVars.hud.r = hudDrag.r - dx; desktopVars.hud.b = hudDrag.b - dy; }
    hudPaint();
  });
  addEventListener('pointerup', () => {
    if (!hudDrag) return; const d = hudDrag; hudDrag = null; hudLayerEl().classList.remove('moving');
    if (!desktopVars.hud) return;
    if (d.on) {
      const SW = stage.clientWidth, SH = stage.clientHeight, sz = [Math.min(desktopVars.hud.w, SW - 2 * HUD_GAP), Math.min(desktopVars.hud.h, SH - 2 * HUD_GAP)];
      desktopVars.hud.w = Math.round(clampN(desktopVars.hud.w, HUD_MIN[0], Math.max(HUD_MIN[0], SW - 2 * HUD_GAP))); desktopVars.hud.h = Math.round(clampN(desktopVars.hud.h, HUD_MIN[1], Math.max(HUD_MIN[1], SH - 2 * HUD_GAP)));
      desktopVars.hud.r = Math.round(clampN(desktopVars.hud.r, HUD_GAP, Math.max(HUD_GAP, SW - sz[0] - HUD_GAP))); desktopVars.hud.b = Math.round(clampN(desktopVars.hud.b, HUD_GAP, Math.max(HUD_GAP, SH - sz[1] - HUD_GAP)));
      save(); hudPaint();
    }
  });
  addEventListener('resize', () => hudPaint());
  /* ---- the panel (no desks): one window on the right over Home; see `panel` above ---- */
  const PANEL_BACK = 6;
  const panelKind = (w = panelWin()) => !w ? null : w.app === 'chats' ? (w.thread ? 'thread' : 'list') : 'app';
  const panelSnap = w => { try { const { id, ...rest } = JSON.parse(JSON.stringify(w)); return rest; } catch (_) { return null; } };
  const panelDockList = w => !!w && desktopVars.panelList?.id === w.id;   // the docked Chats list on the left
  // The panel's title bar: a quiet Back when something was open before, the app's own tools, and ✕ (Esc).
  // The docked Chats list has none: it never closes (the layout folds it).
  function panelBar(w, a) {
    if (panelDockList(w)) return '<div class="wbar panel-dockbar"></div>';
    const back = panelSlot(w.id)?.back || [];
    return `<div class="wbar">${back.length ? `<button data-wact="panel-back" class="panel-back" title="Back" aria-label="Back to what was open before"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg></button>` : ''}${w.app === 'chats' ? window.WosAgents.titlebar(w.agent || '', 'ic', 't') : `${ico('span', 'ic', a)}<span class="t">${esc(winTitle(w))}</span>`}
      ${w.app === 'frame' && a.url ? `<button data-wact="pop" title="Open in a browser tab" aria-label="Open in a browser tab">↗</button>` : ''}${w.app === 'frame' ? `<button data-wact="reload" title="Refresh (${MOD}R)" aria-label="Refresh window">↻</button>` : ''}
      <button data-wact="close" title="Close (Esc)" aria-label="Close">✕</button></div>`;
  }
  // The panel layer (made on first use; a desk with an app needs it even before anything is shown).
  function panelLayerEl(d) {
    let layer = document.getElementById('panelLayer');
    if (!layer && (!d || panelDeskRep(d))) { layer = Object.assign(document.createElement('div'), { id: 'panelLayer', className: 'panel-layer' }); stage.appendChild(layer); }
    return layer;
  }
  function panelMount() {
    const layer = desktopVars.panel || desktopVars.panelApp || desktopVars.panelList || panelReps().length ? panelLayerEl() : document.getElementById('panelLayer'); if (!layer) return;
    if (!panelChat()) desktopVars.panel = null;
    if (!panelAppW() || (panelDeskApp(panelAppW()) && !panelReps().includes(panelAppW()))) desktopVars.panelApp = null;
    if (!panelListW()) desktopVars.panelList = null;
    layer.classList.toggle('on', !!(desktopVars.panel || desktopVars.panelApp || desktopVars.panelList));
    for (const w of panelParkedW()) { const el = winEl(w.id); if (el) { el.classList.add('panel', 'panel-parked'); el.classList.remove('panel-out', 'panel-swap'); el.dataset.panel = 'app'; el.dataset.side = 'right'; el.inert = true; } }
    for (const [slot, w] of [[desktopVars.panelList, panelListW()], [desktopVars.panel, panelChat()], [desktopVars.panelApp, panelAppW()]]) {
      if (!w) continue;
      let el = winEl(w.id);
      if (!el) { el = mountWin(w, layer); el.classList.add('panel'); if (slot.swap) el.classList.add('panel-swap'); }
      else if (el.parentNode !== layer) layer.appendChild(el);
      if (el.classList.contains('panel-parked')) { el.classList.remove('panel-parked'); el.inert = false; }
      el.classList.add('panel');
      el.dataset.panel = panelKind(w) === 'app' ? 'app' : 'chat';
      el.dataset.side = panelDockList(w) ? 'left' : slot === desktopVars.panel && desktopVars.panelDocked ? 'beside' : 'right';   // docked: a chat opens beside the list
      el.toggleAttribute('data-dock', panelDockList(w));
    }
  }
  // One window out of the panel: the same cleanup as a closed window; it slides away unless another takes its place.
  function panelDrop(id, { swap = false } = {}) {
    const w = desktopVars.W[id]; if (!w) return;
    desktopVars.boundManager?.dismiss(w);
    window.WizBackgroundAudio?.closeApp(w.appId)?.catch(() => toast('♫', 'Audio could not stop. Pause it from the media controls.'));
    if (w.app === 'chats') { threadShown(id, null); CHATS.saveDraft(id); }
    delete desktopVars.W[id]; CHATS.forget(id);
    const el = winEl(id); if (!el) return;
    el.querySelector('iframe')?._appDetach?.();
    if (swap || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
    el.classList.add('panel-out'); el.inert = true; setTimeout(() => el.remove(), 420);
  }
  // Two content panels: a Chats window opens in the chat panel, anything else in the app panel; each holds one thing
  // at a time (the one before is kept for a quiet Back) and both can be open together.
  function panelOpen(obj, { fromBack = false } = {}) {
    window.WosResources?.back(); closePalette({ restore: false });
    const isApp = obj?.app !== 'chats', slot = isApp ? desktopVars.panelApp : desktopVars.panel;
    const prev = isApp ? panelAppW() : panelChat(); let back = slot?.back || [];
    if (isApp && panelDeskApp(obj)) {   // an app is a desk: the one in front goes out of sight alive (its desk stays)
      if (prev && !panelDeskApp(prev)) panelDrop(prev.id, { swap: true });
      return panelDeskShow(obj);
    }
    if (isApp && prev && panelDeskApp(prev)) desktopVars.panelApp = null;   // a built-in view over a desk's app: that app only hides
    else if (prev) { if (!fromBack) { const keep = panelSnap(prev); if (keep) back = [...back, keep].slice(-PANEL_BACK); } panelDrop(prev.id, { swap: true }); }
    const id = uid(); desktopVars.W[id] = { id, ...obj };
    const next = { id, back, swap: !!prev }; if (isApp) desktopVars.panelApp = next; else desktopVars.panel = next; desktopVars.panelFrontId = id;
    save(); render(); log('panel:' + panelKind(desktopVars.W[id]));
    return desktopVars.W[id];
  }
  // Show an app's desk in the app panel: its open desk if it has one (brought back exactly as it was), else a new
  // desk of its own (one app per desk, added after the others; the desk in Desks view stays the current one).
  function panelDeskShow(obj) {
    const same = w => w.app === obj.app && (w.appId || '') === (obj.appId || '') && (obj.appId || obj.app === 'pages' ? (w.pageSlug || '') === (obj.pageSlug || '') : (w.url || '') === (obj.url || ''));
    let w = Object.values(desktopVars.W).find(x => panelDeskApp(x) && wsOf(x.id) >= 0 && same(x)) || null;
    if (w) desktopVars.ws[wsOf(w.id)].focus = w.id;
    else { const id = uid(); desktopVars.W[id] = { id, ...obj }; w = desktopVars.W[id]; desktopVars.ws.push({ ...freshDesk(), wins: [id], focus: id }); }
    const swap = !!panelAppW() && panelAppW().id !== w.id;
    desktopVars.panelApp = { id: w.id, back: [], swap }; desktopVars.panelFrontId = w.id;
    save(); render(); log('panel:desk'); setTimeout(() => focusInside(w.id), 30);
    return w;
  }
  // Closing: the content panel in front (Esc, ✕, a finished thread: the chat first, then the app), or the window asked
  // for. The docked list never closes.
  function panelClose({ paint = true, id = '', quit = false } = {}) {
    const f = panelWin(), front = f && panelSlot(f.id) ? f : panelChat() || panelAppW();
    const w = id ? (panelSlot(id) ? desktopVars.W[id] : null) : front;
    if (!w) { if (!panelChat()) desktopVars.panel = null; if (!panelAppW()) desktopVars.panelApp = null; return false; }
    const wasApp = desktopVars.panelApp?.id === w.id, park = wasApp && (desktopVars.panelParks || panelDeskApp(w)) && !quit;
    if (!park && !canLeave(w.id)) return false;
    if (park) panelPark(w.id); else if (wasApp && panelDeskApp(w)) { panelDeskClose(w.id); desktopVars.panelApp = null; } else { panelDrop(w.id); if (wasApp) desktopVars.panelApp = null; else desktopVars.panel = null; }
    const c = wasApp && panelChat();   // an app closed beside an open chat: the keyboard goes back to the chat
    if (paint) { save(); render(); const l = panelListW(); if (c) { desktopVars.panelFrontId = c.id; focusInside(c.id); } else if (l) { desktopVars.panelFrontId = l.id; winEl(l.id)?.focus({ preventScroll: true }); } else $('#desktopHome')?.focus({ preventScroll: true }); } // the keyboard goes back to the list (⌥↓ goes on from there)
    log('panel:close'); return true;
  }
  // Out of sight, still running (kept-running mode): it slides away like a close and keeps its frame alive.
  // An app that is not a desk (a built-in view) and is asked to hide: it closes (only desks keep running).
  function panelPark(id) {
    if (!desktopVars.W[id]) return;
    if (desktopVars.panelApp?.id === id) desktopVars.panelApp = null;
    if (!panelDeskApp(desktopVars.W[id])) { panelDrop(id); log('panel:park-drop'); return; }
    const el = winEl(id); if (el) { el.classList.add('panel-parked'); el.inert = true; }
    log('panel:park');
  }
  // Close an app's desk: its window goes like any closed window (reopenable with ⌥⇧W in Desks), and the desk with it
  // when nothing else is on it. Desks view's current desk stays current; Home stays in front.
  function panelDeskClose(id) {
    const t = wsOf(id); if (t < 0) { panelDrop(id); return; }
    const d = desktopVars.ws[t]; rememberClosed(id, t);
    const el = winEl(id); removeWin(id);
    if (el) { el.querySelector('iframe')?._appDetach?.(); el.classList.add('panel-out'); el.inert = true; setTimeout(() => el.remove(), 420); }
    if (!d.wins.length && desktopVars.ws.length > 1) { const here = desktopVars.ws[desktopVars.cur], prev = desktopVars.ws[desktopVars.lastWs]; desktopVars.ws.splice(desktopVars.ws.indexOf(d), 1); desktopVars.cur = Math.max(0, desktopVars.ws.indexOf(here)); desktopVars.lastWs = Math.max(0, desktopVars.ws.indexOf(prev)); }
  }
  // Really close an app the panel holds (shown or kept running): its desk closes.
  function panelQuit(appId) {
    const w = [panelAppW(), ...panelParkedW()].find(x => x && (x.appId || x.app) === appId); if (!w) return false;
    if (!canLeave(w.id)) return false;
    if (desktopVars.panelApp?.id === w.id) return panelClose({ id: w.id, quit: true });
    if (panelDeskApp(w)) panelDeskClose(w.id); else panelDrop(w.id);
    save(); render(); log('panel:quit'); return true;
  }
  // Apps the panel holds: the one shown and the ones kept running; playing = a same-origin media element is playing.
  function panelRunning() {
    const playing = w => { try { const d = winEl(w.id)?.querySelector('iframe')?.contentDocument; return !!d && [...d.querySelectorAll('audio,video')].some(m => !m.paused && !m.muted); } catch (_) { return false; } };
    const a = panelAppW(), seen = new Set(), one = r => !seen.has(r.id) && seen.add(r.id);   // one per app
    return [...(a ? [{ id: a.appId || a.app, open: true, playing: playing(a) }] : []), ...panelParkedW().map(w => ({ id: w.appId || w.app, open: false, playing: playing(w) }))].filter(one);
  }
  // The quiet Back in a panel's title bar: the thing shown there before this one.
  function panelBack(id = '') {
    const slot = panelSlot(id) || panelSlot(panelWin()?.id) || desktopVars.panel;
    const b = slot?.back; if (!b?.length) return false;
    const obj = b[b.length - 1]; slot.back = b.slice(0, -1);
    const thread = obj.app === 'chats' ? obj.thread : null;
    const w = panelOpen(thread ? { ...obj, thread: null } : obj, { fromBack: true });
    if (thread) { CHATS.openChat(w.id, thread); syncChatsPane(w.id); }
    setTimeout(() => focusInside(w.id), 30);
    return true;
  }
  /* Docked (api.panel.dock): the stock Chats list stays in its own panel on the left; dock(false) folds it away. */
  function panelDock(on) {
    if (!globalThis.WosSkinHost?.panelMode) return false;
    desktopVars.panelDocked = true;
    if (on && !panelListW()) { const id = uid(); desktopVars.W[id] = { id, app: 'chats', thread: null, chatsProvider: CHATS.views.defaultId() }; desktopVars.panelList = { id }; }
    else if (!on && panelListW()) { panelDrop(desktopVars.panelList.id); desktopVars.panelList = null; }
    save(); render(); log('panel:dock:' + (on ? 'on' : 'off'));
    return true;
  }
  /* The docked list only lists: a thread (or a new chat, or a notification) picked in it, by a click or a key, opens in
   * the panel on the right instead; that panel closes when its thread is finished (Done, Snooze, a send, its ‹). */
  function panelForward(listId, sid) {
    const lw = desktopVars.W[listId]; if (!lw || desktopVars.panelList?.id !== listId || lw.thread !== sid) return;
    CHATS.chatsBack(lw); syncChatsPane(listId);
    let w = panelChat();
    if (!mainChats(w)) w = panelOpen({ app: 'chats', thread: null, chatsProvider: CHATS.views.defaultId() });
    else if (w.thread && w.thread !== sid) { const k = panelSnap(w); if (k) { desktopVars.panel.back = [...desktopVars.panel.back, k].slice(-PANEL_BACK); hudBar(w.id); } }
    desktopVars.panelFrontId = w.id; CHATS.openChat(w.id, sid); syncChatsPane(w.id);
    setTimeout(() => focusInside(w.id), 30); log('panel:thread');
  }
  function panelThreadLeft(id) {
    const w = desktopVars.W[id]; if (!w || desktopVars.panel?.id !== id || w.app !== 'chats' || w.thread) return;
    panelClose({ id }); log('panel:thread-done');
  }
  // Esc in the panels: in the list, its search / chips clear first; then the panel on the right slides away.
  function panelEsc() {
    const w = panelWin();
    if (panelDockList(w)) { const did = CHATS.clearFilter(listWin(w.id)); if (did) { syncChatsPane(w.id); return did === 'search' ? 'search' : 'filter'; } }
    return panelClose() ? 'panel' : 'panel-stay';
  }
  stage.addEventListener('pointerdown', e => { const el = e.target.closest?.('.panel-layer > .win.panel'); if (el && panelHas(el.dataset.win)) desktopVars.panelFrontId = el.dataset.win; }, true);
  // A layout took or let go of the panel: Home stays in front while it holds it; letting go puts back what was there.
  function panelMode(on) {
    if (on) {
      if (store.get('panelPrevHome', null) === null) store.set('panelPrevHome', desktopVars.homeOpen);
      closePalette({ restore: false });
      if (!desktopVars.homeOpen) { desktopVars.homeOpen = true; store.set('homeOpen', true); }
      render(); return;
    }
    // The desks' apps stay open: back on their desks (render moves them home); only the panels' own windows close.
    for (const w of panelWins()) if (!panelDeskApp(w) || wsOf(w.id) < 0) panelDrop(w.id, { swap: true });
    for (const el of $$('#panelLayer > .win', stage)) if (desktopVars.W[el.dataset.win] && wsOf(el.dataset.win) >= 0) { el.classList.remove('panel', 'panel-parked', 'panel-swap', 'panel-out'); el.inert = false; delete el.dataset.panel; delete el.dataset.side; }
    desktopVars.panel = null; desktopVars.panelApp = null; desktopVars.panelList = null; desktopVars.panelDocked = false; desktopVars.panelParks = false;
    const was = store.get('panelPrevHome', null); store.set('panelPrevHome', null);
    if (was === false && desktopVars.ws[desktopVars.cur].wins.length) { desktopVars.homeOpen = false; store.set('homeOpen', false); }
    save(); render();
    if (!desktopVars.homeOpen && focused()) focusInside(focused().id);
  }
  function paintFocus() {
    const d = desktopVars.ws[desktopVars.cur]; noteSpot();
    const front = globalThis.WosSkinHost?.panelMode && panelWin() ? panelWin().id : d.focus; // no desks: the panel's window is the one in front
    $$('.win', stage).forEach(el => el.classList.toggle('focus', el.dataset.win === front));
    const f = focused(); document.title = f ? `${winTitle(f)} · Wizard` : 'Wizard';
    if (d.mono) layout();
  }
  return { clampN, hudBack, hudBar, hudClose, hudDock, hudFocus, hudKey, hudMount, hudOn, hudPaint, layout, paintFocus, PANEL_BACK, panelBack, panelBar, panelClose, panelDeskClose, panelDock, panelEsc, panelForward, panelKind, panelLayerEl, panelMode, panelMount, panelOpen, panelQuit, panelRunning, panelSnap, panelThreadLeft, bindLate: v => { if ('closePalette' in v) closePalette = v.closePalette; if ('goWs' in v) goWs = v.goWs; if ('log' in v) log = v.log; if ('paintBar' in v) paintBar = v.paintBar; } };
};
