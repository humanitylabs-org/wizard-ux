/* Wizard UX phone shell › the Desks overview and the pill panel. Moved out of app.js
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
window.WizCore.appParts.overview = function ({ $, announce, APP, applyLayout, appVars, arrangeDesks, blank, CH, CHATS, clip, closeSheets, deskName, deskOf, deskSigil, device, esc, goDesk, MAXW, newId, ovCard, ovDeskApp, ovDl, overviewMode, renderDesk, renderDots, save, syncDesks, vib, winApp, winEl, winTitle }) {
  let armBack, newDesk, orbUpVar, toast; // late-bound: app.js declares these after the call, see bindLate
  function renderOverview() {
    const open = appVars.desks.filter(d => !d.home && d.wins.length).length;
    const inner = `<div class="ov-head"><b>Desks</b><span>${open} open</span><button class="ov-done" data-ovdone>Done</button></div>
      <div class="ov-grid">${appVars.desks.map((_, i) => ovCard(i)).join('')}<button class="ov-card ov-add" data-ovadd aria-label="New desk: pick an app"><span aria-hidden="true">＋</span><b>New desk</b></button></div>
      <p class="ov-hint">Hold and drag to reorder · pinch two desks together to merge · spread one apart to split</p>`;
    // Pill mode: the same content inside a panel that grows out of the bottom pill; the rest of the screen is a tap-to-close scrim.
    const keep = appVars.ovEl.querySelector('.ov-scroll')?.scrollTop || 0;
    // Pill mode is the dock itself with room to spare: the same desk icons and badges in a grid, an ✕ where the pill was.
    const cell = i => {
      const d = appVars.desks[i], here = i === appVars.idx, name = d.home ? 'Home' : deskName(i);
      return `<div class="ov-card ov-cell${here ? ' here' : ''}${d.home ? ' ov-home' : ''}" data-ov="${d.id}" role="button" tabindex="0"${here ? ' aria-current="true"' : ''} aria-label="${esc(name)}${here ? ', current desk' : ''}"><span class="ov-ic">${deskSigil(i)}</span><span class="ov-nm">${esc(name)}</span>${d.home ? '' : `<button class="ov-x" data-ovx="${d.id}" aria-label="Close ${esc(name)}">✕</button>${ovDl(d)}`}</div>`;
    };
    const pillInner = `<div class="ov-grid">${appVars.desks.map((_, i) => cell(i)).join('')}<button class="ov-card ov-cell ov-new" data-ovadd aria-label="New desk: pick an app"><span class="ov-ic"><span class="dsg"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3.2" stroke-dasharray="3.1 2.6"/></svg></span></span><span class="ov-nm">New desk</span></button></div>`;
    appVars.ovEl.innerHTML = appVars.ovEl.classList.contains('ov-pill') ? `<div class="ov-sheet"><div class="ov-scroll">${pillInner}</div><button class="ov-close" data-ovdone aria-label="Close desks"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` : inner;
    const sh = appVars.ovEl.querySelector('.ov-scroll'); if (sh) sh.scrollTop = keep;
  }
  /* Miguel's skins: swiping up on the orb opens this same overview as an extension of the bottom pill (mode 'pill'):
   * the pill grows upward into a panel holding every desk; the orb stays as its handle (tap or swipe down closes). */
  function openOverview(mode) {
    if (!appVars.ovEl) { appVars.ovEl = document.createElement('div'); appVars.ovEl.id = 'overview'; appVars.ovEl.className = 'ov'; device.appendChild(appVars.ovEl); bindOverview(appVars.ovEl); }
    closeSheets(true); if (appVars.LINKS && appVars.LINKS.isOpen()) appVars.LINKS.close();
    const pill = mode === 'pill' && orbUpVar() === 'pill';
    if (!appVars.ovEl.classList.contains('open')) { appVars.ovEl.classList.toggle('ov-pill', pill); device.classList.toggle('ov-pill-open', pill); }
    const wasOpen = appVars.ovEl.classList.contains('open');
    renderOverview(); void appVars.ovEl.offsetWidth;
    if (pill && !wasOpen) flyFromDock();
    appVars.ovEl.classList.add('open'); device.classList.add('ov-open');
    appVars.ovEl.querySelector('.ov-card.here')?.scrollIntoView({ block: pill ? 'nearest' : 'center' });
    armBack(); vib(14); window.__ovLog = (window.__ovLog || []).concat('open').slice(-30);
  }
  // Each desk icon rises out of its own spot in the pill (the orb for the desk in view) to its place in the grid.
  function flyFromDock() {
    appVars.ovEl.querySelectorAll('.ov-cell').forEach(c => {
      const i = c.dataset.ov ? posOf(c.dataset.ov) : -1, ic = c.querySelector('.ov-ic'); if (!ic) return;
      const src = i === appVars.idx ? $('#orbWrap') : i >= 0 ? document.querySelector(`#dock [data-goto="${i}"] .dsg`) : document.querySelector('#dock .dnew .dsg');
      const to = ic.getBoundingClientRect(); let dx = 0, dy = 0;
      if (src) { const f = src.getBoundingClientRect(); dx = f.left + f.width / 2 - (to.left + to.width / 2); dy = f.top + f.height / 2 - (to.top + to.height / 2); }
      else dy = 60;
      try { ic.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: src ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.9,.25,1)' }); } catch (_) {}
    });
  }
  function closeOverview() { if (!appVars.ovEl || !appVars.ovEl.classList.contains('open')) return false; appVars.ovEl.classList.remove('open'); device.classList.remove('ov-open', 'ov-pill-open'); appVars.ovEl.classList.remove('editing'); return true; }
  const pillOvOpen = () => !!(appVars.ovEl && appVars.ovEl.classList.contains('open') && appVars.ovEl.classList.contains('ov-pill'));
  window.addEventListener('wizard:app-counts', () => { if (appVars.ovEl && appVars.ovEl.classList.contains('open') && !appVars.OV) renderOverview(); });
  const openPeek = () => openOverview(), closePeek = () => closeOverview();
  const posOf = did => appVars.desks.findIndex(d => d.id === did);
  function ovLog(s) { window.__ovLog = (window.__ovLog || []).concat(s).slice(-30); }
  function bindOverview(el) {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('keydown', e => {
      const c = e.target.closest('[data-ov]');
      if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); c.click(); }
    });
    el.addEventListener('click', e => {
      if (Date.now() < appVars.ovTapBlock) return;
      if (e.target.closest('[data-ovdone]')) return closeOverview();
      const dl = e.target.closest('[data-ovdl]');
      if (dl) { if (overviewMode().appAction !== 'home-screen') return; const a = ovDeskApp(appVars.desks[posOf(dl.dataset.ovdl)]); if (a) window.WizHomeScreenApps?.offer(a); return; }
      const x = e.target.closest('[data-ovx]'); if (x) { closeDesk(posOf(x.dataset.ovx)); if (appVars.desks.length) renderOverview(); return; }
      if (e.target.closest('[data-ovadd]')) { closeOverview(); return newDesk(); }
      const c = e.target.closest('[data-ov]'); if (c) { const i = posOf(c.dataset.ov); closeOverview(); if (i >= 0) goDesk(i); return; }
      if (el.classList.contains('editing') && !e.target.closest('[data-ov]') && e.target !== el) { el.classList.remove('editing'); return; }
      if (e.target === el || e.target.classList.contains('ov-grid') || e.target.classList.contains('ov-scroll')) closeOverview();
    });
    const cardAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest('.ov-card[data-ov]') : null; };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        clearTimeout(appVars.OV?.hold); if (appVars.OV?.drag) endDrag(false);
        const [p, q] = e.touches, a = cardAt(p.clientX, p.clientY), b = cardAt(q.clientX, q.clientY);
        appVars.OV = { pinch: true, a, b, d0: dist(p, q), s: 1 }; return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0], c = cardAt(t.clientX, t.clientY);
      appVars.OV = { x: t.clientX, y: t.clientY, c, moved: false, drag: false };
      if (c && !c.classList.contains('ov-home') && !e.target.closest('.ov-x, .ov-dl')) appVars.OV.hold = setTimeout(() => { if (appVars.OV && !appVars.OV.moved && !appVars.OV.pinch) startDrag(c, t.clientX, t.clientY); }, 380);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!appVars.OV) return;
      if (appVars.OV.pinch && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        appVars.OV.s = dist(e.touches[0], e.touches[1]) / appVars.OV.d0;
        const same = appVars.OV.a && appVars.OV.a === appVars.OV.b;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (!same && appVars.OV.a && appVars.OV.b && appVars.OV.s < .85) { appVars.OV.a.classList.add('merging'); appVars.OV.b.classList.add('merging'); }
        if (same && appVars.OV.s > 1.15) appVars.OV.a.classList.add('splitting');
        return;
      }
      const t = e.touches[0]; if (!t) return;
      if (!appVars.OV.drag) { if (Math.hypot(t.clientX - appVars.OV.x, t.clientY - appVars.OV.y) > 9) { appVars.OV.moved = true; clearTimeout(appVars.OV.hold); } return; }
      if (e.cancelable) e.preventDefault();
      moveDrag(t.clientX, t.clientY);
    }, { passive: false });
    const end = e => {
      if (!appVars.OV) return;
      if (appVars.OV.pinch) {
        if (e.touches && e.touches.length) return; // wait for both fingers
        const q = appVars.OV; appVars.OV = null; appVars.ovTapBlock = Date.now() + 400;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (q.a && q.b && q.a !== q.b && q.s < .72) { mergeDesks(q.a.dataset.ov, q.b.dataset.ov); renderOverview(); }
        else if (q.a && q.a === q.b && q.s > 1.3) { splitDesk(q.a.dataset.ov); renderOverview(); }
        return;
      }
      clearTimeout(appVars.OV.hold);
      // Arrange/download tweak: held and let go in place just stays in arrange mode (✕ and download buttons), no sheet.
      if (arrangeDesks() && appVars.OV.drag && !appVars.OV.reordered) { endDrag(false); el.classList.add('editing'); appVars.ovTapBlock = Date.now() + 400; appVars.OV = null; return; }
      if (appVars.OV.drag && !appVars.OV.reordered && e.changedTouches?.[0] && Math.hypot(e.changedTouches[0].clientX - appVars.OV.dx, e.changedTouches[0].clientY - appVars.OV.dy) < 12) {
        // Held and let go in place: nothing moved, so offer Add to home screen for a one-app desk (drag still reorders).
        const d = appVars.desks[posOf(appVars.OV.card.dataset.ov)], w = d && d.wins.length === 1 ? appVars.W[d.wins[0]] : null, a = w?.app === 'frame' ? APP[w.appId] : null;
        endDrag(false); appVars.ovTapBlock = Date.now() + 400; appVars.OV = null;
        if (a) window.WizHomeScreenApps?.offer(a);
        return;
      }
      if (appVars.OV.drag) { endDrag(true); appVars.ovTapBlock = Date.now() + 400; }
      else if (el.classList.contains('ov-pill') && e.changedTouches?.[0]) {
        // Pill mode: a clear swipe down (list at its top) folds it back into the pill.
        const t = e.changedTouches[0], dy = t.clientY - appVars.OV.y, dx = t.clientX - appVars.OV.x, sc = el.querySelector('.ov-scroll');
        if (dy > 70 && dy > Math.abs(dx) * 1.3 && (!sc || sc.scrollTop <= 0)) { appVars.ovTapBlock = Date.now() + 400; appVars.OV = null; closeOverview(); return; }
      }
      appVars.OV = null;
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    function startDrag(c, x, y) {
      appVars.OV.drag = true; appVars.OV.card = c; appVars.OV.dx = x; appVars.OV.dy = y; appVars.OV.reordered = false; const r = c.getBoundingClientRect(); appVars.OV.ox = x - r.left; appVars.OV.oy = y - r.top;
      c.classList.add('drag'); el.classList.add('dragging', 'editing'); vib(16); ovLog('drag');
      appVars.OV.ghost = c.cloneNode(true); appVars.OV.ghost.classList.add('ghost'); appVars.OV.ghost.style.width = r.width + 'px'; appVars.OV.ghost.style.height = r.height + 'px'; el.appendChild(appVars.OV.ghost);
      moveDrag(x, y);
    }
    function moveDrag(x, y) {
      const dr = el.getBoundingClientRect();
      appVars.OV.ghost.style.transform = `translate(${x - appVars.OV.ox - dr.left}px, ${y - appVars.OV.oy - dr.top}px) scale(1.04)`;
      appVars.OV.ghost.style.visibility = 'hidden'; const over = cardAt(x, y); appVars.OV.ghost.style.visibility = '';
      if (over && over !== appVars.OV.card) {
        const grid = el.querySelector('.ov-grid'), cards = [...grid.querySelectorAll('.ov-card[data-ov]')];
        const a = cards.indexOf(appVars.OV.card), b = cards.indexOf(over);
        // Home stays first, but its drop zone means "first app", before Chats or any other tab.
        // Rejecting Home as a target made the left edge feel like a pinned Chats slot.
        const before = over.classList.contains('ov-home') || a < b ? over.nextSibling : over;
        if (before !== appVars.OV.card) { grid.insertBefore(appVars.OV.card, before); appVars.OV.reordered = true; vib(6); }
      }
      // Near the top or bottom edge: scroll so far desks can be reached while dragging.
      const sc = el.querySelector('.ov-scroll'), sr = sc ? sc.getBoundingClientRect() : dr, so = sc || el;
      if (y < sr.top + 50) so.scrollTop -= 12; else if (y > sr.bottom - 50) so.scrollTop += 12;
    }
    function endDrag(commit) {
      const c = appVars.OV.card; c.classList.remove('drag'); el.classList.remove('dragging'); appVars.OV.ghost?.remove();
      if (commit) reorderDesks([...el.querySelectorAll('.ov-grid .ov-card[data-ov]')].map(x => x.dataset.ov));
      renderOverview();
    }
  }
  function reorderDesks(order) {
    const cur = appVars.desks[appVars.idx]?.id, by = Object.fromEntries(appVars.desks.map(d => [d.id, d]));
    const next = [appVars.desks[0], ...order.filter(id => id !== appVars.desks[0].id && by[id]).map(id => by[id])];
    appVars.desks.forEach(d => { if (!next.includes(d)) next.push(d); });
    appVars.desks = next; appVars.idx = Math.max(0, posOf(cur)); syncDesks(); save(); ovLog('reorder');
  }
  // Drop desks that lost their last window and keep the same desk in front (or the one asked for).
  function pruneDesks(prefer) {
    const cur = appVars.desks[appVars.idx]?.id, at = appVars.idx;
    appVars.desks = appVars.desks.filter((d, i) => i === 0 || d.wins.length);
    let n = posOf(prefer || cur); if (n < 0) n = posOf(cur);
    if (n < 0) n = Math.max(0, Math.min(at - 1, appVars.desks.length - 1));
    appVars.idx = Math.min(appVars.idx, appVars.desks.length - 1); syncDesks(); goDesk(n, true); save();
  }
  function mergeDesks(aId, bId) {
    let a = posOf(aId), b = posOf(bId); if (a < 0 || b < 0 || a === b) return false;
    if (a > b) [a, b] = [b, a];
    if (appVars.desks[a].home || appVars.desks[b].home) { toast('⌂', 'Home stays on its own'); return false; }
    if (appVars.desks[a].wins.length + appVars.desks[b].wins.length > MAXW) { toast('▦', 'A desk holds up to four windows'); return false; }
    const keep = appVars.desks[a].id, cur = appVars.desks[appVars.idx].id === appVars.desks[b].id ? keep : appVars.desks[appVars.idx].id;
    appVars.desks[a].wins.push(...appVars.desks[b].wins); appVars.desks[a].full = false; appVars.desks[b].wins = [];
    renderDesk(a); pruneDesks(cur); vib([8, 30, 8]); ovLog('merge'); return true;
  }
  function splitDesk(did) {
    const i = posOf(did); if (i < 1) return false; const d = appVars.desks[i]; if (d.wins.length < 2) return false;
    const rest = d.wins.filter(id => id !== d.focus), first = d.focus && d.wins.includes(d.focus) ? d.focus : d.wins[0];
    d.wins = [first]; d.focus = first; d.full = false;
    rest.filter(id => id !== first).forEach((id, k) => appVars.desks.splice(i + 1 + k, 0, blank({ wins: [id], focus: id })));
    if (appVars.idx > i) appVars.idx += rest.length;
    renderDesk(i); syncDesks(); save(); vib([8, 30, 8]); ovLog('split'); return true;
  }
  function closeDesk(i) {
    const d = appVars.desks[i]; if (!d || d.home) return false;
    const name = deskName(i);
    [...d.wins].forEach(id => { closeAppPlayback(appVars.W[id]); delete appVars.W[id]; delete CH[id]; }); d.wins = [];
    renderDesk(i); pruneDesks(); toast('✕', `Closed ${esc(name)}`); ovLog('close'); return true;
  }

  /* The desk scrub's name label (the bar scrub above shows it); it takes no touches, the bar under it scrubs. */
  const scrub = document.createElement('div'); scrub.id = 'scrub'; scrub.className = 'scrub';
  scrub.innerHTML = '<span class="sc-label"></span>'; $('#dock').appendChild(scrub);
  const SC_STEP = 26;
  function scLabel(at) { scrub.querySelector('.sc-label').textContent = deskName(at); }

  /* ---------------- window operations ---------------- */
  /* Every new thing opens on its own desk, right beside the one in front (James, 12 Oct 2026: apps always open
   * in a new tab, as one shell rule, never a per-app setting). Only an explicit user placement (opts.desk from a
   * user aim, opts.here) may share an existing desk; app openers pass opts through and never pick a desk. */
  // Directly beside the desk in front, Home included (James, 11 Oct 2026: from Home, Yesterday and every other
  // app open on the desk right next to Home; Chats just moves one to the right).
  // With workspace sync on, desk order is shared by every device, so a phone-only placement reshuffles the owner's
  // other devices too (Miguel, 1 Nov 2026: Backup and Calendar kept jumping to desktops 1 and 2). Then a new app
  // opens on a new desk at the end, and an app already open opens on its desk where it is (bringBeside).
  const sharedDeskOrder = () => { const s = window.WosWorkspaceSync?.current; return !!s && s.on && !s.absent; };
  function insertPos() { return sharedDeskOrder() ? appVars.desks.length : appVars.idx + 1; }
  function openWin(obj, opts = {}) {
    if (obj.app === 'chats' && !obj.agent && !obj.chatsProvider) obj = { ...obj, chatsProvider: CHATS.views.defaultId() };
    const w = { id: newId(), ...obj }; appVars.W[w.id] = w;
    let t = opts.desk != null ? Math.max(0, Math.min(appVars.desks.length - 1, opts.desk)) : opts.here ? appVars.idx : -1;
    if (t >= 0 && (appVars.desks[t].home || appVars.desks[t].wins.length >= MAXW)) t = -1;
    if (t < 0 && !appVars.desks[appVars.idx].home && !appVars.desks[appVars.idx].wins.length) t = appVars.idx; // the empty desk in front takes it
    if (t < 0) { t = insertPos(); appVars.desks.splice(t, 0, blank({ wins: [w.id], focus: w.id })); syncDesks(); }
    else { const d = appVars.desks[t]; d.wins.push(w.id); d.focus = w.id; d.full = false; }
    renderDesk(t); save(); renderDots();
    if (opts.stay) return w; // opened beside, out of view (a bound view): the desk in front stays in front
    if (t !== appVars.idx) goDesk(t, true);
    announce(`Opened <b>${esc(winApp(w).name)}</b>`);
    return w;
  }
  function closeAppPlayback(w) {
    window.WizBackgroundAudio?.closeApp(w?.appId)?.catch(() => toast('♫', 'Audio could not stop. Pause it from the media controls.'));
  }
  function closeWin(id, quiet, preservePlayback = false) {
    if (appVars.W[id]?.app === 'pages' && !window.WosPages.canClose(winEl(id)?.querySelector('.pg-host'))) return;
    const i = deskOf(id); if (i < 0) return;
    const w = appVars.W[id], d = appVars.desks[i], name = winTitle(w);
    if (!CHATS.beforeLeave(id)) return;
    if (!preservePlayback) closeAppPlayback(w);
    CHATS.closeHosted(id); CHATS.forget(id);
    if (quiet) { d.wins = d.wins.filter(x => x !== id); delete appVars.W[id]; delete CH[id]; if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null; if (!d.wins.length) d.full = false; renderDesk(i); pruneDesks(); return; }
    // ✕ on a bound view: it stays closed for this reply (opening the thread again, or a new reply, binds again).
    if (w.bound) { appVars.boundOff[w.bound] = w.bsid + '|' + w.bkey; appVars.boundManager?.dismiss(w); }
    const back = w.from && i === appVars.idx && appVars.desks.some(x => x.id === w.from.desk) ? w.from : null;
    d.wins = d.wins.filter(x => x !== id); delete appVars.W[id]; delete CH[id];
    if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
    renderDesk(i); pruneDesks(back && !d.wins.length ? back.desk : null); vib(8);
    if (back && appVars.W[back.win] && deskOf(back.win) === appVars.idx) focusWin(back.win);
    if (back) announce(`Back to <b>${esc(clip(back.title || deskName(appVars.idx), 40))}</b>`); else toast('✕', `Closed ${esc(name)}`);
  }
  // Move a window onto another desk (to = a desk index), or onto a desk of its own (to = 'own').
  function moveWin(id, to) {
    const from = deskOf(id); if (from < 0) return false;
    if (to === 'own') {
      if (appVars.desks[from].wins.length < 2) return false;
      const f = appVars.desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      appVars.desks.splice(from + 1, 0, blank({ wins: [id], focus: id })); renderDesk(from); syncDesks(); renderDesk(from + 1); save(); goDesk(from + 1, true);
      announce(`<b>${esc(winApp(appVars.W[id]).name)}</b> has its own desk`); return true;
    }
    if (to < 1 || to >= appVars.desks.length || to === from) return false;
    if (appVars.desks[to].wins.length >= MAXW) { toast('▦', `${esc(deskName(to))} is full`); return false; }
    const f = appVars.desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) { f.focus = f.wins[f.wins.length - 1] || null; f.full = false; } if (!f.wins.length) f.full = false;
    const d = appVars.desks[to]; d.wins.push(id); d.focus = id; d.full = false;
    renderDesk(from); renderDesk(to); const dest = d.id; pruneDesks(dest);
    announce(`Moved to <b>${esc(deskName(appVars.idx))}</b>`);
    return true;
  }
  function focusWin(id) {
    const i = deskOf(id); if (i < 0 || appVars.desks[i].focus === id) return;
    appVars.desks[i].focus = id; applyLayout(i); save();
    window.WosSkinHost?.changed();
  }
  return { closeAppPlayback, closeDesk, closeOverview, closePeek, closeWin, focusWin, insertPos, mergeDesks, moveWin, openOverview, openPeek, openWin, pillOvOpen, posOf, renderOverview, reorderDesks, SC_STEP, scLabel, scrub, sharedDeskOrder, splitDesk, bindLate: v => { if ('armBack' in v) armBack = v.armBack; if ('newDesk' in v) newDesk = v.newDesk; if ('orbUpVar' in v) orbUpVar = v.orbUpVar; if ('toast' in v) toast = v.toast; } };
};
