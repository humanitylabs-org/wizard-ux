/* Wizard UX core: Chats › swipe and long-press on a thread row (the swipe tray and its gestures).
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Values chats.js changes over time (its
 * reassigned lets) stay in chats.js; this code reads and writes them as chatVars.<name>, chats.js's get/set
 * accessors on the same variables, so every read and write is live. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.swipe = function ({ ACT, addFiles, BOOM, ch, CH, chanScrolled, chatVars, CHECK_SVG, esc, eventsLate, flushHeld, H, INC, isWorking, KIT, LIVE, loadApproval, md, MIC_SVG, needsLand, openRowSheet, OUTBOX, paintFeedJump, PEND, queueListPlace, reach, reachLabel, readGuard, renderChatList, renderLive, renderThread, renderThreadLive, repaintList, replyCard, ROW_MENU, rowactsLate, rowMenu, rowOf, scheduleHeld, SCROLL_IDLE, SEL, setupLate, streamLate, syncListTitle, threadAct, threadActions, toast, toTurns, TOUCH, track, troubleshoot, userMedia, vib, W }) {
  let elOf, idOf; // late-bound: chats.js declares these after the call, see bindLate
  const SWIPE_W = 148;
  const ownerSwipe = () => document.documentElement.dataset.shell === 'phone' && ['novairecito', 'sepia'].includes(document.documentElement.dataset.skin || '');
  function swipeActs(sid) {
    const s = LIVE.session(sid), acts = threadActions(s, null);
    const file = acts.includes('done') ? 'done' : acts.includes('restore') ? 'restore' : '';
    return { recall: !!BOOM(), file };
  }
  function swipeTray(wrap, sid) {
    let tray = wrap.querySelector(':scope > .ch-swipe-acts'); if (tray) return tray;
    const a = swipeActs(sid), s = LIVE.session(sid), t = esc(s?.title || 'chat');
    const btn = (k, cls, glyph, label, aria) => `<button type="button" class="ch-swipe-act ${cls}" data-chswipe="${k}" aria-label="${aria} ${t}" tabindex="-1">${glyph}<span>${label}</span></button>`;
    wrap.insertAdjacentHTML('afterbegin', `<div class="ch-swipe-acts" aria-hidden="true">${a.recall ? btn('recall', 'recall', '<i aria-hidden="true">🪄</i>', 'Recall', 'Recall') : ''}${a.file ? btn(a.file, a.file, ACT[a.file].icon, ACT[a.file].label, ACT[a.file].hint + ':') : ''}</div>`);
    tray = wrap.firstElementChild; tray.style.setProperty('--n', String((a.recall ? 1 : 0) + (a.file ? 1 : 0)) || '1');
    return tray;
  }
  function swipeA11y(wrap, open) {
    const tray = wrap?.querySelector(':scope > .ch-swipe-acts'); if (!tray) return;
    tray.setAttribute('aria-hidden', open ? 'false' : 'true');
    for (const b of tray.querySelectorAll('button')) b.tabIndex = open ? 0 : -1;
    if (!open && tray.contains(document.activeElement)) wrap.querySelector('.ch-row')?.focus?.({ preventScroll: true });
  }
  function closeSwipe(instant) {
    if (!chatVars.swipeOpen) return false;
    const { wrap, wid } = chatVars.swipeOpen; chatVars.swipeOpen = null;
    const row = wrap.querySelector('.ch-row'); swipeA11y(wrap, false);
    if (row) { if (instant) row.style.transition = 'none'; row.style.transform = ''; if (instant) requestAnimationFrame(() => { row.style.transition = ''; }); }
    wrap.style.setProperty('--sw', '0px');
    wrap.classList.remove('swiping', 'swiped');
    setTimeout(() => { if (chatVars.swipeOpen?.wrap !== wrap) wrap.querySelector(':scope > .ch-swipe-acts')?.remove(); }, instant ? 0 : 180);
    const c = CH[wid]; if (c?.heldList) setTimeout(() => repaintList(wid), 200);
    return true;
  }
  // Long-press / swipe / right-click on rows, and paste-to-attach; bound to each shell's root in bind().
  function bindGestures(root) {
    root.addEventListener('touchstart', e => {
      const node = e.target.closest?.('.ch-msgs, .ch-scroll'); if (!node) return;
      const g = readGuard(node); g.at = Date.now();
      for (const t of e.changedTouches) { g.touches.add(t.identifier); TOUCH.set(t.identifier, g); }
    }, { capture: true, passive: true });
    root.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) { const g = TOUCH.get(t.identifier); if (g) g.at = Date.now(); }
    }, { capture: true, passive: true });
    root.addEventListener('scroll', e => {
      if (!e.target.matches?.('.ch-msgs, .ch-scroll')) return;
      if (e.target.matches('.ch-list > .ch-scroll')) { const id = idOf(e.target); if (id) { queueListPlace(id); if (typeof chanScrolled === 'function') chanScrolled(id, e.target); } }
      if (chatVars.swipeOpen) closeSwipe(true);
      if (typeof paintFeedJump === 'function' && e.target.matches('.ch-list > .ch-scroll')) { const id = idOf(e.target); if (id) paintFeedJump(id, e.target); } // issue 1440: the feed's pills
      const g = readGuard(e.target); g.until = Date.now() + SCROLL_IDLE; scheduleHeld();
    }, { capture: true, passive: true });
    // A finger on the messages holds background re-renders (see selectingIn) until it lifts.
    root.addEventListener('pointerdown', e => { const m = e.target.closest?.('.ch-msgs'); if (m && e.button <= 0) Object.assign(SEL, { down: m, at: Date.now(), x: e.clientX, y: e.clientY }); }, true);
    const lift = () => { if (!SEL.down) return; SEL.down = null; clearTimeout(chatVars.selT); chatVars.selT = setTimeout(flushHeld, 350); };
    // A quick tap away from the selected words clears the selection, as anywhere on Android (WebView keeps it when
    // the tap lands on the non-selectable shell around the bubbles).
    root.addEventListener('pointerup', e => {
      const quick = SEL.down && Date.now() - SEL.at < 450 && Math.hypot(e.clientX - SEL.x, e.clientY - SEL.y) < 10;
      const s = window.getSelection?.();
      if (quick && s && !s.isCollapsed && s.rangeCount && !e.target.closest?.('button, a, textarea, input')) {
        const r = s.getRangeAt(0), anchor = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
        const hit = [...r.getClientRects()].some(b => e.clientX >= b.left - 4 && e.clientX <= b.right + 4 && e.clientY >= b.top - 4 && e.clientY <= b.bottom + 4);
        if (!hit && anchor && root.contains(anchor) && anchor.closest('.ch-msgs')) s.removeAllRanges();
      }
      lift();
    }, true);
    root.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') lift(); }, true);
    // Speed: pointing at (desktop) or touching a row starts its history read; the open joins that request.
    root.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const row = e.target.closest?.('.ch-list [data-chopen]'); if (row && row !== root._warmRow) { root._warmRow = row; clearTimeout(root._warmT); root._warmT = setTimeout(() => LIVE.warm?.(row.dataset.chopen), 90); } });
    root.addEventListener('pointerdown', e => {
      const row = e.target.closest(ROW_MENU); if (!row || e.button > 0) return;
      if (row.dataset.chopen) LIVE.warm?.(row.dataset.chopen);
      const wid = idOf(row);
      const wrap = row.closest('.ch-row-wrap');
      // A touch on another row (or the open one) first closes an open swipe, like Gmail.
      const wasOpen = chatVars.swipeOpen && chatVars.swipeOpen.wrap === wrap;
      if (chatVars.swipeOpen && !wasOpen) closeSwipe();
      const swipe = !!row.dataset.chopen && e.pointerType !== 'mouse' && ownerSwipe();
      chatVars.lp = { row, wrap, wid, sid: row.dataset.chopen, nid: row.dataset.chnotif, swipe, page: e.pointerType === 'touch' && !!row.dataset.chchan && !!row.closest('.ch-list')?.querySelector('.ch-chan-tabs [data-chview]'), base: swipe && wasOpen ? -SWIPE_W : 0, pid: e.pointerId, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moved: false, t: setTimeout(() => { if (!chatVars.lp || chatVars.lp.moved || window.WosSkinHost?.claimed(chatVars.lp.pid)) return; chatVars.lpUntil = Date.now() + 700; if (chatVars.swipeOpen) closeSwipe(true); chatVars.lpHeld = chatVars.lp.pid; rowMenu(chatVars.lp.wid, chatVars.lp.row); chatVars.lp = null; }, 480) };
    });
    root.addEventListener('pointermove', e => {
      if (!chatVars.lp) return;
      if (window.WosSkinHost?.claimed(e.pointerId)) { clearTimeout(chatVars.lp.t); chatVars.lp.row.style.transform = ''; chatVars.lp = null; return; } // a skin gesture owns this finger
      const dx = e.clientX - chatVars.lp.x, dy = e.clientY - chatVars.lp.y;
      if (!chatVars.lp.swipe) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(chatVars.lp.t); chatVars.lp.row.style.transform = ''; chatVars.lp = null; return; }
        if (Math.abs(dx) > 10) clearTimeout(chatVars.lp.t);
        // A channel row on the Channels page leaves a sideways touch to the page swipe (issue 1467: Channels → Activity).
        if (dx < 0 && !chatVars.lp.page) { chatVars.lp.dx = dx; chatVars.lp.row.style.transform = `translateX(${Math.max(dx, -90)}px)`; }
        return;
      }
      if (!chatVars.lp.moved && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(chatVars.lp.t); if (!chatVars.lp.base) chatVars.lp.row.style.transform = ''; chatVars.lp = null; return; }
      if (Math.abs(dx) > 10) { clearTimeout(chatVars.lp.t); if (!chatVars.lp.moved) { chatVars.lp.moved = true; swipeTray(chatVars.lp.wrap, chatVars.lp.sid); chatVars.lp.wrap.classList.add('swiping'); chatVars.lp.row.style.transition = 'none'; try { chatVars.lp.row.setPointerCapture?.(chatVars.lp.pointerId); } catch (_) {} } }
      if (!chatVars.lp.moved) return;
      const w = chatVars.lp.wrap.clientWidth || 360, off = Math.min(0, Math.max(chatVars.lp.base + dx, -w * 0.9));
      chatVars.lp.dx = off; chatVars.lp.row.style.transform = `translateX(${off}px)`; chatVars.lp.wrap.style.setProperty('--sw', `${-off}px`);
      chatVars.lp.wrap.classList.toggle('commit', off < -w * 0.5);
    });
    const lpEnd = () => {
      if (chatVars.lpHeld !== null) { chatVars.lpHeld = null; chatVars.lpUntil = Date.now() + 700; }
      if (!chatVars.lp) return; const q = chatVars.lp; chatVars.lp = null; clearTimeout(q.t);
      if (!q.swipe) {
        q.row.style.transform = '';
        // Preserve the stock gesture outside Novairecito phone skins and on desktop.
        if (q.dx < -60 && q.row.dataset.quiet === '1' && threadActions(rowOf(q.wid, q.sid), null).includes('done')) { chatVars.lpUntil = Date.now() + 700; threadAct(q.wid, q.sid, 'done'); }
        else if (q.dx < -60) { chatVars.lpUntil = Date.now() + 700; if (!q.row.dataset.chchan && !q.row.dataset.chsent && !q.row.dataset.chsentthread) openRowSheet(q.wid, q.sid, q.nid); else rowMenu(q.wid, q.row); }
        return;
      }
      if (!q.moved) return;
      try { q.row.releasePointerCapture?.(q.pointerId); } catch (_) {}
      q.row.style.transition = ''; chatVars.lpUntil = Date.now() + 500;
      if (q.dx < -SWIPE_W * 0.4) { q.row.style.transform = `translateX(${-SWIPE_W}px)`; q.wrap.style.setProperty('--sw', `${SWIPE_W}px`); q.wrap.classList.add('swiped'); chatVars.swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; swipeA11y(q.wrap, true); vib(6); return; }
      chatVars.swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; closeSwipe();
    };
    const lpCancel = () => {
      if (chatVars.lpHeld !== null) { chatVars.lpHeld = null; chatVars.lpUntil = Date.now() + 700; }
      if (!chatVars.lp) return; const q = chatVars.lp; chatVars.lp = null; clearTimeout(q.t);
      try { q.row.releasePointerCapture?.(q.pointerId); } catch (_) {}
      q.row.style.transition = ''; q.row.style.transform = q.base ? `translateX(${-SWIPE_W}px)` : '';
      if (q.base) { q.wrap.style.setProperty('--sw', `${SWIPE_W}px`); q.wrap.classList.remove('swiping'); q.wrap.classList.add('swiped'); chatVars.swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; swipeA11y(q.wrap, true); }
      else { q.wrap.style.setProperty('--sw', '0px'); q.wrap.classList.remove('swiping', 'swiped'); q.wrap.querySelector(':scope > .ch-swipe-acts')?.remove(); }
    };
    root.addEventListener('pointerup', lpEnd); root.addEventListener('pointercancel', lpCancel);
    // Right-click (a mouse) opens the same sheet; a touch long-press already did.
    root.addEventListener('contextmenu', e => { const row = e.target.closest(ROW_MENU); if (!row) return; e.preventDefault(); if (!chatVars.rowSheet && !chatVars.lp) { chatVars.lpUntil = Date.now() + 700; rowMenu(idOf(row), row); } });
    // Paste, drag/drop and the Enter policy come from the shared WizComposerInput (web/core/composer-input.js), the
    // same implementation apps get as WizardApp.composer: files go to addFiles (the paperclip upload path), text
    // pastes insert from the event snapshot (dictation-app safe), an empty paste explains how to get the take back.
    window.WizComposerInput.bind(root, {
      field: '.ch-compose textarea', zone: '.ch-compose',
      onFiles: (files, ta) => addFiles(idOf(ta), files),
      notice: msg => toast('!', msg, 4200),
    });
  }
  /* Durable outbox and reading a thread: core/chats-outbox.js. */
  const { echoed, loadThread, localSent, pendingFor, pendingHtml, reconcileSent, renderChats, retryShown, threadAlive, threadErrHtml, turnsCurrent } = window.WizCore.chatsParts.outbox({ ch, CH, CHECK_SVG, elOf: (...a) => elOf(...a), esc, H, INC, isWorking, KIT, LIVE, loadApproval, md, MIC_SVG, needsLand, OUTBOX, PEND, reach, reachLabel, renderChatList, renderLive, renderThread, renderThreadLive, replyCard, rowOf, syncListTitle, toTurns, track, troubleshoot, userMedia, W });
  eventsLate({ renderChats });
  streamLate({ loadThread });
  rowactsLate({ renderChats });
  setupLate({ renderChats });
  return { bindGestures, closeSwipe, echoed, loadThread, localSent, pendingFor, pendingHtml, reconcileSent, renderChats, retryShown, threadAlive, threadErrHtml, turnsCurrent, bindLate: v => { if ('elOf' in v) elOf = v.elOf; if ('idOf' in v) idOf = v.idOf; } };
};
