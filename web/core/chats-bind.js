/* Wizard UX core: Chats › presence and seen marks, clicks inside a Chats window, the delegated composer events,
 * text from outside and forgetting a window. Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.bind = function ({ activityClick, actSetOrder, AGS, alertFeedback, bindGestures, bindPull, BOOM, byStatus, ch, CH, chanDropSending, chanEditUnsent, channelClick, channelSend, chanRepaint, chanRowAgent, chanSeenRow, chanSetEmoji, chatsBack, chatVars, chooseApproval, clearAll, clearReading, closeHosted, closeRowSheet, closeSpacePicker, closeStream, closeSwipe, COMPACT_KEY, compactOn, dailyClick, desks, discardDraft, draftKey, focusAgents, focusedAgent, focusOf, growTa, H, idx, inboxMove, INC, isHosted, jumpGo, jumpToMessage, keepThreadOpen, KIT, listSaveT, LIVE, loadThread, markDone, moveSubject, nextOrder, noteRowAct, notifDoneAll, notifRoute, openChat, openEmojiSheet, openLengthSheet, openMedia, openNewDraft, openRenameSheet, openSpacePicker, OUTBOX, owner, PAGE, paintPins, PHONE, picker, PIN, PINS_KEY, pinsOn, quoteMessage, readingIn, READY_ORDER_KEY, READY_ORDERS, refreshCompose, refreshReply, rememberedFocus, renderChatList, renderChats, renderEmojiSearch, renderThread, renderThreadLive, renderThreadNow, replyStd, rerenderList, resumeTracked, ROW_MENU, rowMenu, runningBack, runningGo, runningOn, runningSideGo, saveDraft, sendChat, sentClick, setDraft, setFocus, setSummaryOpen, showBoomMessage, SPACE, spaceMember, spaces, stopPendingSend, stopTapped, submitChannelRename, submitRename, sweepAnswer, sweepLater, sweepYesToAll, syncSend, threadAct, threadBack, toast, toggleSection, toggleVoice, TOPIC, topicOn, typedInto, UPLOAD_ABORT, vib, W, winAgent, WORKING_ORDERS }) {
  let PW; // late-bound: chats.js declares these after the call, see bindLate
  // While a thread is on screen AND James is at that screen, new replies count as read (same rule as Wizard).
  // "At the screen" = the page was opened, brought to the front, touched, clicked, typed in or scrolled within
  // ATTEND_MS. A window left open on a thread (James, 14 Oct 2026: a Mac tab sat on "Our PRs" and marked its new
  // reply read while he was on his phone) keeps the reply unread everywhere until he comes back: his first input
  // there re-runs this check, so the thread he is actually looking at still clears at once.
  const ATTEND_MS = 60e3;
  let lastPresence = Date.now();
  const attended = () => !document.hidden && Date.now() - lastPresence < ATTEND_MS;
  function presence() {
    const wasAway = Date.now() - lastPresence >= ATTEND_MS; lastPresence = Date.now();
    if (wasAway) setTimeout(markVisibleThreadsSeen, 0);
  }
  // Real input only: a 'scroll' event also fires when a new reply auto-scrolls the thread, which is not James.
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, presence, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastPresence = Date.now(); }, true);
  const MARKED = new Map(); // window id -> the thread change markVisibleThreadsSeen last marked read (wizard-os issue 1020)
  function markVisibleThreadsSeen() {
    if (!LIVE?.ok || !attended()) return;
    for (const id of desks[idx].wins) {
      const w = W[id]; if ((w?.app !== 'chats' && !isHosted(id)) || !w.thread || w.thread === '__new__') continue;
      const hold = ch(id).unreadHold; if (hold?.sid === w.thread && hold.nav === ch(id).readNav) continue;
      const r = typeof chanSeenRow === 'function' ? chanSeenRow(id, w.thread) : w.thread, s = typeof r === 'object' ? r : LIVE.session(w.thread); if (!s || !LIVE.isNew(s)) continue;
      // Once per change of the thread (wizard-os issue 1020): this runs on every Live repaint, so a read that did not
      // stick wrote PUT /wizard/thread-seen each time (21 a minute on a desktop) until the write guard paused it. A new
      // reply, another device's unread mark or a newer list row changes the stamp and marks it read again.
      const rec = LIVE.seenRecord?.(s), stamp = JSON.stringify([s.id, s.agent || '', s.updatedAt, s.lastAssistantAt, s.previewAt, s.messageCount, s.status, s.preview, rec?.unreadAt]);
      if (MARKED.get(id) === stamp) continue;
      MARKED.set(id, stamp); LIVE.markSeen(r);
    }
    for (const k of [...MARKED.keys()]) if (!W[k]) MARKED.delete(k);
  }

  const elOf = id => H.root().querySelector(`[data-chats="${id}"]`);
  const idOf = t => t.closest('[data-chats]')?.dataset.chats || '';
  /* Clicks inside a Chats window. Returns true when it handled the click. */
  function click(e, id) {
    if (INC?.click(id, e)) return true;
    if (e.target.closest('.ch-back[data-incog-close]')) { chatsBack(W[id]); return true; }
    if (e.target.closest('[data-incog-close]')) { if (INC?.close(id)) renderChats(W[id]); return true; }
    if (e.target.closest('[data-incog-off]')) { INC?.close(id); renderChats(W[id]); return true; }
    if (e.target.closest('[data-incog-start]')) { const w = W[id]; if (!w || w.thread !== '__new__') return true; if (H.captureBusy?.()) { renderChats(w); toast('!', 'Finish recording before starting Incognito', 2600); return true; } const c = ch(id), agentId = winAgent(w) || c.newModel?.agent; const a = AGS()?.get(agentId); if (window.WizCore.incognitoOptIn?.enabled(a)) { saveDraft(id); void INC?.start(id, a); } return true; }
    if (e.target.closest('[data-chtroubleshoot]')) { window.WizReach?.open(); return true; }
    const w = H.win(id); if (!w) return false;
    // A tweak card's switch: flips on this frame, Settings › Look's toggle underneath (core/settings.js tweakCardTap).
    const twk = e.target.closest('[data-chat-tweak]'); if (twk) { window.WosSettings?.tweakCardTap?.(twk, (i, t) => toast(i, t, 2400)); return true; }
    // An app's action card (wizard-ux issue 1463, core/action-cards.js): Approve, Edit, Open in app, Reject.
    const act = e.target.closest('[data-action-card] [data-act]'); if (act) { window.WosActionCards?.tap?.(act, (i, t) => toast(i, t, 3200)); return true; }
    // A button inside a reply (wizard-ux issue 1889, core/action-cards.js replyTap): picked on this frame, sent as one
    // owner message a few seconds after the last tap, through this thread's own send path (never the composer).
    const rbt = e.target.closest('.ch-rb [data-rb]');
    if (rbt && w.thread && w.thread !== '__new__') {
      // The thread's own agent, the way rowOf scopes it: the window's agent when it lists this id, else the id's owner.
      const wa = winAgent(W[owner(id)] || w), sid = w.thread, how = 'tapping a button in a reply';
      const agent = (wa && LIVE.sessionFor && LIVE.sessionFor(sid, wa) ? wa : '') || (LIVE.agentOf && LIVE.agentOf(sid)) || '';
      const repaint = () => { const ww = H.win(id); if (ww && ww.thread === sid) renderThreadNow(ww); };
      if (window.WosActionCards?.replyTap?.(rbt, { sid, toast: (i, t) => toast(i, t, 3200), repaint,
        send: text => sendChat(id, text, how, null, { sid, away: true, ...(agent ? { agent } : {}) }) })) return true;
    }
    // Thread tracker: the strip's own taps, Reply on a message, and the quote header's jump (all inert with the tweak off).
    if (globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '')) {
      const resume = text => resumeTracked(id, w, text);
      if (globalThis.WosThreadTracker.click(e, { sid: w.thread, agent: LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '', jump: a => jumpToMessage(id, a), resume })) return true;
      const mq = e.target.closest('[data-mquote]'); if (mq) { quoteMessage(w, mq.closest('.msg')); return true; }
    }
    // Issue 1331: Reply on any message in the main agent's threads, and the thread's own Mark done.
    if (typeof replyStd === 'function' && replyStd(LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '')) { const mq = e.target.closest('[data-mquote]'); if (mq) { quoteMessage(w, mq.closest('.msg')); return true; } }
    if (e.target.closest('[data-chmarkdone]') && w.thread) { markDone(id, w.thread, true); return true; }
    const jp = e.target.closest('[data-chjump]'); if (jp && w.thread && typeof jumpGo === 'function') { jumpGo(id, jp.dataset.chjump); return true; } // issue 1359
    const qj = e.target.closest('[data-ttjump]'); if (qj) { jumpToMessage(id, { message_id: qj.dataset.ttjump || null, at: +qj.dataset.ttjumpAt || 0 }); return true; }
    const hc = e.target.closest('[data-helper-continue]');
    if (hc) {
      if (hc.disabled) return true; hc.disabled=true; hc.textContent='Resuming…';
      fetch(hc.dataset.preview ? '/wizard/preview/helper-continue' : '/wizard/helper-continue', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:w.thread})})
        .then(async r=>{ if(!r.ok) throw new Error(r.status===409 ? 'Already active or no longer resumable' : 'Could not resume'); await LIVE.refresh(); toast('↻','Continuing the same request',1800); })
        .catch(err=>{ hc.disabled=false; hc.textContent=hc.dataset.preview ? 'Try Continue · example only' : 'Continue'; toast('!',''+err.message,2600); });
      return true;
    }
    const failedDismiss = e.target.closest('[data-obdismissfailed]'); if (failedDismiss) {
      if (failedDismiss.disabled) return true;
      failedDismiss.disabled = true;
      const gone = OUTBOX.get?.(failedDismiss.dataset.obdismissfailed);
      Promise.resolve(OUTBOX.dismissFailed(failedDismiss.dataset.obdismissfailed)).then(ok => {
        if (!ok) failedDismiss.disabled = false;
        // A dismissed channel post leaves its feed now (issue 1293), not when its "Sending…" post times out.
        if (ok && gone?.kind === 'new' && typeof chanDropSending === 'function' && chanDropSending(gone)) chanRepaint();
        // A pressed desktop list temporarily holds background paints. An explicit
        // dismissal must update its own pill now, rather than wait for a later poll.
        const current = H.win(id);
        if (ok && current && !current.thread) renderChatList(current, elOf(id));
        H.toast(ok ? '✓' : '!', ok ? 'Dismissed · original kept in Unsent messages' : 'Could not save dismissal · original kept', 2400);
      }).catch(() => { failedDismiss.disabled = false; H.toast('!', 'Could not save dismissal · original kept', 2400); });
      return true;
    }
    // Errors-section voice rows own their Dismiss (confirm → delete).
    const dismiss = !e.target.closest('[data-errob]') && e.target.closest('[data-obdismiss]'); if (dismiss) {
      const sent = OUTBOX.get(dismiss.dataset.obdismiss)?.state === 'sent';
      Promise.resolve(OUTBOX.dismissBubble(dismiss.dataset.obdismiss)).then(ok => {
        H.toast(ok ? '✓' : '!', ok ? (sent ? 'Sent bubble dismissed · message stays in this chat' : 'Bubble dismissed · recording kept in Unsent messages') : 'Could not save dismissal · original kept', 2400);
      }); return true;
    }
    const discard = e.target.closest('[data-obdiscard]'); if (discard) {
      if (discard.disabled) return true;
      const item = OUTBOX.get(discard.dataset.obdiscard);
      if (!item?.lateHeld || item.state !== 'held') return true;
      discard.disabled = true;
      const sid = w.thread, nav = ch(id).readNav;
      Promise.resolve(OUTBOX.remove(item.id)).then(ok => {
        if (!ok) { discard.disabled = false; H.toast('!', 'Could not save discard · original kept', 2400); return; }
        if ((!PHONE() || !keepThreadOpen()) && H.win(id) === w && w.thread === sid && ch(id).readNav === nav && sid) threadBack(w);
      }).catch(() => { discard.disabled = false; H.toast('!', 'Could not save discard · original kept', 2400); });
      return true;
    }
    const recovery = e.target.closest('[data-obrecover]'); if (recovery) { H.recoverUnsent?.(recovery.dataset.obrecover); return true; }
    const rb = e.target.closest('[data-obretry]'); if (rb) { H.toast('↻', OUTBOX.retryFeedback(OUTBOX.retry(rb.dataset.obretry)), 2400); return true; }
    if (e.target.closest('[data-chunsent]')) { H.openUnsent?.(); return true; }
    if (e.target.closest('[data-chsent]') && justPressed()) return true; // a long-press/swipe just opened a Sent row's sheet (issue 1814)
    // The ghost click of that same press must not land on a button of the sheet it opened (issue 1880: the sheet's sends move them under the finger).
    if (e.target.closest('[data-rssentfix], [data-rssentopen]') && justPressed()) return true;
    if (/::side$/.test(String(id)) && ch(id).running && e.target.closest('[data-chtab]')) ch(id).running = false; // a tab leaves the sidebar's Running view (wizard-ux issue 1599)
    if (typeof sentClick === 'function' && sentClick(e, id, w)) return true; // the Sent tab and the bottom tabs (wizard-ux issue 1778)
    if (e.target.closest('[data-chrunning]')) { runningGo(w, true); return true; }
    if (e.target.closest('[data-chrunback]')) { runningBack(w); return true; }
    const ro = e.target.closest('[data-chrunopen]'); if (ro) { openChat(id, ro.dataset.chrunopen); return true; }
    const io = e.target.closest('[data-chinboxopen]'); if (io) { inboxMove('open', io.dataset.chinboxopen, { title: io.dataset.title || '', ...(io.dataset.agent ? { agent: io.dataset.agent } : {}) }); return true; }
    const swb = e.target.closest('[data-chsweep]'); if (swb) { if (!swb.disabled) sweepAnswer(swb.dataset.card, swb.dataset.chsweep, swb.dataset.opt); return true; }
    // Running on the sweep card: the desktop's list pane (id::list) shows the Running view next to the thread; with one
    // pane (phone) the thread steps back to the list first.
    if (e.target.closest('[data-chsweeprunning]')) {
      if (typeof runningSideGo === 'function' && runningSideGo()) return true; // the AI apps sidebar (wizard-ux issue 1599, switch on)
      const o = W[owner(w.id)] || w, lw = W[o.id + '::list'];
      if (lw && runningOn(lw)) runningGo(lw, true); else if (runningOn(o)) { chatsBack(o); runningGo(o, true); } else H.toast('·', 'The Running view is in the Chats window', 2000);
      return true;
    }
    const swa = e.target.closest('[data-chsweepall]'); if (swa) { if (!swa.disabled) sweepYesToAll(swa.dataset.chsweepall); return true; }
    const swl = e.target.closest('[data-chsweeplater]'); if (swl) { sweepLater(swl.dataset.chsweeplater); return true; }
    const afb = e.target.closest('[data-chalertfb]'); if (afb) { if (!afb.disabled) alertFeedback(afb.dataset.id, afb.dataset.chalertfb, !!afb.closest('.ch-al-i.collapsed')); return true; }
    if (window.WizAppExtensions?.handle(e)) return true;
    if (e.target.closest('[data-obretryall]')) { H.toast('↻', OUTBOX.retryFeedback(OUTBOX.retryAll(winAgent(w))), 2400); return true; }
    const eb = e.target.closest('[data-obedit]'); if (eb) { const it = OUTBOX.get(eb.dataset.obedit); if (it && !(typeof chanEditUnsent === 'function' && chanEditUnsent(id, it))) H.editUnsent(it); return true; }
    if (PW && PW.click(e, id)) return true;
    const sw = e.target.closest('[data-chswipe]');
    if (sw && chatVars.swipeOpen) { const { wid: rw, sid } = chatVars.swipeOpen, k = sw.dataset.chswipe; closeSwipe(true);
      if (k === 'recall') { const s = LIVE.session(sid); BOOM()?.open({ sessionId: sid, targetKind: 'thread', context: s?.title || 'This thread', note: s?.attention?.ask || '' }); }
      else threadAct(rw, sid, k); return true; }
    if (justPressed() && e.target.closest('[data-chopen], [data-chnotif], [data-chchan]')) return true; // a long-press/swipe just opened the actions sheet
    if (chatVars.swipeOpen) { closeSwipe(); if (e.target.closest('.ch-list')) return true; } // a tap anywhere closes an open swipe first
    const pick = topicOn() && e.target.closest('[data-chpick]'); if (pick) { const key = pick.dataset.chpick, sid = key.startsWith('thread:') ? key.slice(7) : '', s = sid && LIVE.session(sid); openEmojiSheet(id, key, s?.title || 'Draft emoji'); return true; }
    const pn = e.target.closest('[data-chpin]'); if (pn) { const on = PIN.toggle(pn.dataset.chpin); vib(8); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    const nr = e.target.closest('.ch-list .ch-notif-row[data-chnotif]'); if (nr) { window.WosSkinHost?.inboxAct?.('open', nr.dataset.chnotif); return true; }
    if (typeof channelClick === 'function' && channelClick(e, id, w)) return true;
    // A link inside a channel post (issue 1287) is the link, not a tap on the post: it takes the link paths below.
    const o = e.target.closest('[data-chopen]'); if (o && !e.target.closest('.ch-post-t a[href]')) { openChat(id, o.dataset.chopen); return true; }
    if (typeof dailyClick === 'function' && dailyClick(e, id, w)) return true;
    if (e.target.closest('[data-chback]')) { threadBack(w); return true; }
    if (e.target.closest('[data-chretry]')) { const c = ch(id); clearTimeout(c.retryT); c.failN = 1; renderThreadLive(w); loadThread(w, true); return true; }
    if (e.target.closest('[data-chcarryx]')) { ch(id).carry = null; renderThreadNow(w); return true; }
    if (e.target.closest('[data-chreplyx]')) { saveDraft(id); KIT.drafts.setReply(draftKey(w), null); refreshReply(id); elOf(id)?.querySelector('.ch-compose textarea')?.focus({ preventScroll: true }); return true; }
    if (e.target.closest('[data-chnew]')) { const c = ch(id), text = (c.q || '').trim(); c.q = ''; c.focus = false; window.WizCore.chatSearch?.cancel(id); const o = owner(id); openNewDraft(o, '');
      if (text) { setDraft(o, text, []); setTimeout(() => { const ta = elOf(o)?.querySelector('.ch-compose textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 60); } return true; }
    const dx = e.target.closest('[data-chdraftx]'); if (dx) { discardDraft(dx.dataset.chdraftx); renderChatList(w, elOf(id)); return true; }
    const dr = e.target.closest('[data-chdraft]'); if (dr) { openNewDraft(owner(id), dr.dataset.chdraft); return true; }
    if (e.target.closest('[data-chbsmore]')) { window.WizCore.chatSearch?.more(id); renderChatList(w, elOf(id)); return true; }
    const cx = e.target.closest('[data-chchipx]'); if (cx) { const c = ch(id); c.filter = ''; c.filterFrom = null; c.coach = false; rerenderList(w); return true; }
    const newSpace = e.target.closest('[data-chspacenew]');
    if (newSpace) { openSpacePicker(w, focusAgents()[0].id, newSpace, { naming: true }); return true; }
    const fp = e.target.closest('[data-chfocusopt]'); if (fp) {
      if (Date.now() < chatVars.focusHoldUntil) return true;
      const [kind, ...parts] = fp.dataset.chfocusopt.split(':'), key = parts.join(':');
      if (fp.classList.contains('ch-focus-tab') && kind === 'agent' && focusedAgent(focusOf(w)) === key) openSpacePicker(w, key, fp);
      else setFocus(w, kind === 'agent' ? rememberedFocus(w, key) : { kind, key });
      return true;
    }
    // The title bar's search icon and the filter sheet's sort (wizard-ux issue 1836).
    if (e.target.closest('[data-chtbsearch]')) { const c = ch(id), open = !(c.tsearch || c.q || c.focus); c.tsearch = open; c.sheet = false;
      if (!open) { c.q = ''; c.focus = false; window.WizCore.chatSearch?.cancel(id); } renderChatList(w, elOf(id)); if (open) elOf(id)?.querySelector('[data-chsearch]')?.focus(); return true; }
    const fso = e.target.closest('[data-chfsort]'); if (fso) { ch(id).sheet = false; if (typeof actSetOrder === 'function') actSetOrder(fso.dataset.chfsort); rerenderList(w); return true; }
    if (e.target.closest('[data-chfbtn]')) { const c = ch(id); c.sheet = c.sheet === 'status' ? false : 'status'; c.focus = false; rerenderList(w); return true; }
    if (e.target.closest('[data-chfclear]')) { const c = ch(id); c.sheet = false; c.coach = false; clearAll(w); return true; }
    if (e.target.closest('[data-chpins]')) { const on = !pinsOn(); try { localStorage.setItem(PINS_KEY, on ? '1' : '0'); } catch (err) {} paintPins(); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    if (e.target.closest('[data-chcompact]')) { const on = !compactOn(); try { localStorage.setItem(COMPACT_KEY, on ? '1' : '0'); } catch (err) {} LIVE.putPrefs?.({ compact: on }); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    const fo = e.target.closest('[data-chfopt]'); if (fo) { const c = ch(id), [k, ...r] = fo.dataset.chfopt.split(':'), key = r.join(':'); c.sheet = false; c.coach = false;
      if (k === 'status') { c.filter = c.filter === key ? '' : key; c.filterFrom = null; }
      c.lastChip = k; rerenderList(w); return true; }
    if (e.target.closest('[data-chfsheet]') && !e.target.closest('.ch-fcard')) { ch(id).sheet = false; rerenderList(w); return true; }
    const sg = e.target.closest('[data-chsug]'); if (sg) { const c = ch(id), [k, ...r] = sg.dataset.chsug.split(':'), key = r.join(':'); c.q = ''; c.focus = false; c.coach = false;
      if (k === 'status') { c.filter = key; c.filterFrom = null; } else setFocus(w, { kind: k, key }); c.lastChip = k; window.WizCore.chatSearch?.cancel(id); rerenderList(w); return true; }
    if (e.target.closest('[data-chsclear]')) { ch(id).q = ''; window.WizCore.chatSearch?.cancel(id); renderChatList(w, elOf(id)); elOf(id)?.querySelector('[data-chsearch]')?.focus(); return true; }
    if (typeof activityClick === 'function' && activityClick(e, w)) return true;
    const sec = e.target.closest('[data-sectoggle]'); if (sec) { toggleSection(w, sec.dataset.sectoggle); return true; }
    const sm = e.target.closest('[data-subjmove]');
    if (sm) { const shown = [...(sm.closest('[data-sec]') || document).querySelectorAll('[data-subjmove="up"]')].map(b => b.dataset.subjkey);
      if (!sm.disabled && moveSubject(sm.dataset.subjkey, sm.dataset.subjmove, shown)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return true; }
    const wo = e.target.closest('[data-workorder]');
    if (wo) { const cur = LIVE.workingOrder?.() || 'alphabetical'; LIVE.setWorkingOrder?.(nextOrder(cur, wo.dataset.workorder, WORKING_ORDERS)); return true; }
    const rg = e.target.closest('[data-rdyorder]');
    if (rg) { chatVars.readyOrder = nextOrder(chatVars.readyOrder, rg.dataset.rdyorder, READY_ORDERS); try { localStorage.setItem(READY_ORDER_KEY, chatVars.readyOrder); } catch (err) {} LIVE.putPrefs?.({ readyOrder: chatVars.readyOrder }); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return true; }
    const more = e.target.closest('[data-secmore]'); if (more) { const c = ch(id); c.more = { ...(c.more || {}), [more.dataset.secmore]: true }; renderChatList(w, elOf(id)); return true; }
    // Android app: Camera / Photo or video / File menu (ux#1634); elsewhere the plain file dialog.
    const att = e.target.closest('[data-chattach]');
    if (att) { chatVars.pickFor = id; if (window.WosContextMenu?.attach) window.WosContextMenu.attach(picker, att, { label: 'Attach pictures or files' }); else { picker.accept = ''; picker.click(); } return true; }
    const rm = e.target.closest('[data-attrm]'); if (rm) { const c = ch(id); UPLOAD_ABORT.get(rm.dataset.attrm)?.abort(); c.files = (c.files || []).filter(f => f.key !== rm.dataset.attrm); refreshCompose(id); saveDraft(id); return true; }
    const rsa = e.target.closest('[data-rsact]'); if (rsa && chatVars.rowSheet) { const { wid: rw, sid, nid, grp } = chatVars.rowSheet; closeRowSheet(); if (nid) void noteRowAct(nid, rsa.dataset.rsact, grp); else threadAct(rw, sid, rsa.dataset.rsact); return true; }
    if (e.target.closest('[data-chemoclear]') && chatVars.rowSheet?.emoji) { const sheet = e.target.closest('.ch-emoji-sheet'), input = sheet?.querySelector('[data-chemosearch]'); if (input) { input.value = ''; renderEmojiSearch(sheet, ''); input.focus(); } return true; }
    const emoji = e.target.closest('[data-chtopicemoji]'); if (emoji && chatVars.rowSheet?.emoji && String(chatVars.rowSheet.key).startsWith('chanemoji:')) { const cid = chatVars.rowSheet.key.slice(10); closeRowSheet(); chanSetEmoji(cid, emoji.dataset.chtopicemoji); return true; }
    if (emoji && chatVars.rowSheet?.emoji) { const { key } = chatVars.rowSheet; if (TOPIC.set(key, emoji.dataset.chtopicemoji)) { closeRowSheet(); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) renderChats(ww); } toast(emoji.dataset.chtopicemoji, 'Topic emoji saved', 1400); } return true; }
    if (e.target.closest('[data-rsemo]') && chatVars.rowSheet?.sid) { const { wid: rw, sid } = chatVars.rowSheet, s = LIVE.session(sid); openEmojiSheet(rw, `thread:${sid}`, s?.title || 'Choose emoji'); return true; }
    if (e.target.closest('[data-rsspacepicker]') && chatVars.rowSheet?.sid) {
      const { sid, trigger } = chatVars.rowSheet; closeRowSheet();
      openSpacePicker(w, LIVE.agentOf(sid) || AGS()?.defaultId() || 'hermes', trigger, { sid }); return true;
    }
    const rsSpace = e.target.closest('[data-rsspace]');
    if (rsSpace && chatVars.rowSheet?.sid) { const { sid } = chatVars.rowSheet, add = rsSpace.dataset.add === 'true', name = spaces().find(x => x.id === rsSpace.dataset.rsspace)?.name || (SPACE.ch ? 'channel' : SPACE.one); const rag = typeof chanRowAgent === 'function' ? chanRowAgent(chatVars.rowSheet.wid, sid) : undefined; closeRowSheet(); if (spaceMember(rsSpace.dataset.rsspace, sid, add, rag)) toast('✓', `${add ? 'Added to' : 'Removed from'} ${name}`, 2000); return true; }
    if (e.target.closest('[data-rsmarkdone]') && chatVars.rowSheet?.sid) { const { wid: rw, sid } = chatVars.rowSheet; closeRowSheet(); markDone(rw, sid); return true; }
    if (e.target.closest('[data-rsinbox]') && chatVars.rowSheet?.sid) { const { sid } = chatVars.rowSheet, r = LIVE.session(sid); closeRowSheet(); inboxMove('send', sid, { title: r?.title || '', utterance: [r?.firstRequest, r?.request].find(x => typeof x === 'string' && x.trim()) || '' }); return true; }
    if (e.target.closest('[data-rspin]') && chatVars.rowSheet?.sid) { const { sid } = chatVars.rowSheet, on = PIN.toggle(sid); closeRowSheet(); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    if (e.target.closest('[data-rsrename]') && chatVars.rowSheet) { const { wid: rw, sid } = chatVars.rowSheet; openRenameSheet(rw, sid); return true; }
    if (e.target.closest('[data-rncancel]') && chatVars.rowSheet) { closeRowSheet(); return true; }
    if (e.target.closest('[data-chrename]') && w.thread && w.thread !== '__new__' && LIVE.session(w.thread)) { openRenameSheet(id, w.thread); return true; }
    if (e.target.closest('[data-rsopen]') && chatVars.rowSheet?.nid) { const { nid } = chatVars.rowSheet; closeRowSheet(); window.WosSkinHost?.inboxAct?.('open', nid); return true; }
    // The lift that ends a long-press can land on the sheet's backdrop (the row sat under it): keep the sheet open.
    if (chatVars.rowSheet && e.target.closest('.ch-sheet') && !e.target.closest('.ch-sheet-b')) { if (e.detail === 0 || chatVars.rowSheet.outsidePress) closeRowSheet(); return true; }
    if (e.target.closest('[data-boom-id]') && w.thread) { const el = elOf(id); void BOOM()?.handle(e.target, r => { if (!showBoomMessage(el, r.anchor_at)) toast('!', 'That message is no longer in this thread', 2200); }); return true; }
    const ngo = e.target.closest('.ch-notif-more [data-chnotif-go]'); if (ngo && w.thread) { window.WosSkinHost?.inboxAct?.('open', ngo.dataset.chnotifGo); return true; }
    const nda = e.target.closest('.ch-notif-more [data-chnotif-doneall]'); if (nda && w.thread) { void notifDoneAll(id, nda.dataset.chnotifDoneall); return true; }
    const nrm = e.target.closest('.ch-notif-route [data-notify-menu]'); if (nrm) { const m = nrm.nextElementSibling; if (m) { m.hidden = !m.hidden; nrm.setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) m.querySelector('[aria-checked="true"], button')?.focus?.({ preventScroll: true }); } return true; }
    const nrt = e.target.closest('.ch-notif-route [data-notify-route]'); if (nrt && w.thread) { if (!nrt.disabled) notifRoute(id, nrt.dataset.notifyRoute, nrt.dataset.notifyTo); return true; }
    const ca = e.target.closest('[data-chact]'); if (ca && w.thread) { threadAct(id, w.thread, ca.dataset.chact); return true; }
    if (e.target.closest('[data-chstop]')) { const s = LIVE.session(w.thread), sb = e.target.closest('[data-chstop]'); stopTapped(sb); if (s && LIVE.cancelSend) { stopPendingSend(w, w.thread, s.runId || ''); } else if (s?.runId) { toast('■', 'Stopping…', 1400); LIVE.stop(s.runId).catch(() => { toast('!', 'Couldn’t stop · try again', 2600); renderThreadNow(w); }); } return true; }
    // A tap-to-pick reply (wizard-agent-service issue 650): sends its words as the owner's answer in this thread, once.
    const chPick = e.target.closest('[data-chchoice]'); if (chPick && w.thread) { if (!chPick.disabled) { chPick.closest('.ch-choices')?.querySelectorAll('button').forEach(b => { b.disabled = true; }); void sendChat(id, chPick.dataset.chchoice, 'tapping a reply button'); } return true; }
    // A new chat's quick link (wizard-ux issue 1965): sends its prompt at once, only while the message box is empty.
    const qk = e.target.closest('[data-chquick]'); if (qk && w.thread === '__new__') { const f = qk.closest('.ch-thread')?.querySelector('.ch-compose textarea'); if (!qk.disabled && !(f && f.value.trim()) && !(ch(id).files || []).length) { qk.closest('.ch-quick')?.querySelectorAll('button').forEach(b => { b.disabled = true; }); void sendChat(id, qk.dataset.chquick, 'tapping a new chat quick link'); } return true; }
    const apb = e.target.closest('[data-approve]'); if (apb) { chooseApproval(id, apb.dataset.approve, apb.dataset.controlKey, apb.closest('.appr')?.querySelector('[data-clarify-answer]')?.value); return true; }
    // Short answer ⇄ full reply. Only its own two buttons toggle, so links and text selection in the reply never do.
    // The choice is kept per reply (ch(id).rsum), so live repaints keep it.
    const rlb = e.target.closest('[data-reply-length]'); if (rlb) { openLengthSheet(id, rlb); return true; }
    const rln = e.target.closest('[data-rslen]'); if (rln && chatVars.rowSheet?.rlen) { window.WosSkinHost?.replySummary?.set({ length: rln.dataset.rslen }); closeRowSheet(); toast('✓', 'New replies use this length', 1600); return true; }
    const rsb = e.target.closest('[data-reply-summary]');
    if (rsb) { const msg = rsb.closest('.msg.a.has-rsum'); if (!msg) return true; const open = !msg.classList.contains('rsum-open'), c = ch(id);
      (c.rsum = c.rsum || new Map()).set(rsb.dataset.replySummary, open); setSummaryOpen(msg, open);
      if (e.detail === 0) msg.querySelector(open ? '.rless' : '.bub > .rsum')?.focus({ preventScroll: true }); return true; }
    if (e.target.closest('[data-chearlier]')) { const c = ch(id), el = elOf(id); c.show = (c.show || PAGE) + PAGE; renderThread(w, el, true); return true; }
    const mdl = e.target.closest('[data-mdl]'); if (mdl) { e.preventDefault(); const m = ch(id).media?.[+mdl.dataset.mdl]; if (m) KIT.download(m); return true; }
    const mi = e.target.closest('[data-mi]'); if (mi) { e.preventDefault(); openMedia(id, +mi.dataset.mi); return true; }
    const ml = e.target.closest('a[data-mlink]'); if (ml) { e.preventDefault(); const u = ml.dataset.mlink; KIT.viewer.open([{ url: u, name: ml.textContent.trim() || 'File', kind: 'file', mime: '' }]); return true; }
    const sl = e.target.closest('a[data-session]'); if (sl) { e.preventDefault(); openChat(owner(id), sl.dataset.session, { via: 'link' }); return true; }
    // A private-origin link (a report, a hosted app) opens in a window of this shell: the shell never navigates away.
    const al = e.target.closest('.bub a[href], .ch-post-t a[href]');
    // A link to this app itself (…/wizard-os-home/?session=…, ?view=…, ?video=…) opens in place, never reloads.
    { const DL = window.WizCore.deeplink, href = al?.getAttribute('href'); let u = null; try { u = href ? new URL(href, location.href) : null; } catch (err) {}
      const d = u && DL?.isOwn(u) ? DL.parse(u.href) : null; // a thread link to this app's own page: same trail as a session link
      if (d?.session && !d.video) { e.preventDefault(); openChat(owner(id), d.session, { via: 'link' }); return true; } }
    if (al && window.WizCore.deeplink?.route(al.getAttribute('href'), al)) { e.preventDefault(); return true; }
    if (al && H.openLink) { let u = null; try { u = new URL(al.getAttribute('href'), location.href); } catch (err) {}
      if (u && (window.WosChat?.isHomeUrl ? window.WosChat.isHomeUrl(u) : u.origin === location.origin) && !u.pathname.startsWith('/wizard-os-home')) { e.preventDefault(); H.openLink(u.pathname + u.search + u.hash, (al.textContent || '').trim().slice(0, 40) || u.pathname); return true; } }
    const qc = e.target.closest('[data-quotecopy]');
    if (qc) {
      const text = qc.closest('blockquote[data-quote-source]')?.dataset.quoteSource || '';
      (KIT.copyRich || KIT.copyText)(text).then(ok => { qc.textContent = ok ? 'Copied' : 'Couldn’t copy'; setTimeout(() => { qc.textContent = 'Copy'; }, 1500); });
      return true;
    }
    const qs = e.target.closest('[data-quoteshare]');
    if (qs) {
      const text = qs.closest('blockquote[data-quote-source]')?.dataset.quoteSource || '';
      (qs.closest('.msg.u') ? KIT.shareText(text) : KIT.shareAssistantText(text)).then(r => {
        if (r === 'copied') toast('⧉', 'Copied · sharing isn’t available here', 1800);
        else if (r === 'unsupported' || r === 'failed') toast('!', 'Couldn’t share', 1800);
      }).catch(() => toast('!', 'Couldn’t share', 1800));
      return true;
    }
    const cc = e.target.closest('[data-codecopy]'); if (cc) { const t = cc.closest('.code')?.querySelector('pre')?.textContent || ''; KIT.copyText(t).then(ok => { cc.textContent = ok ? 'Copied' : 'Couldn’t copy'; setTimeout(() => { cc.textContent = 'Copy'; }, 1500); }); return true; }
    const cs = e.target.closest('[data-codeshare]'); if (cs) { const t = cs.closest('.code')?.querySelector('pre')?.textContent || ''; (cs.closest('.msg.u') ? KIT.shareText(t) : KIT.shareAssistantText(t)).then(r => r === 'copied' && toast('⧉', 'Copied · sharing isn’t available here', 1800)); return true; }
    const mc = e.target.closest('[data-mcopy]'); if (mc) { const t = ch(id).texts?.[+mc.dataset.mcopy] ?? ''; (KIT.copyRich || KIT.copyText)(t).then(ok => toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400)); return true; }
    const ms = e.target.closest('[data-mshare]'); if (ms) { const t = ch(id).texts?.[+ms.dataset.mshare] ?? ''; KIT.shareAssistantText(t).then(r => r === 'copied' ? toast('⧉', 'Copied · sharing isn’t available here', 1800) : r === 'failed' && toast('!', 'Couldn’t share', 1800)); return true; }
    const v = e.target.closest('.vnote[data-vnote]'); if (v) { e.preventDefault(); toggleVoice(v.dataset.vnote); return true; }
    return false;
  }
  /* Submit, search-as-you-type, drafts and ⌘/Ctrl+Enter, delegated from the shell's root. */
  function bind(root) {
    // A new press on the backdrop is Back immediately, even just after a hold.
    // The opening press began on the row, so its retargeted release is not a new backdrop press.
    root.addEventListener('pointerdown', e => { if (chatVars.rowSheet) chatVars.rowSheet.outsidePress = e.isTrusted && e.target.classList?.contains('ch-sheet'); }, true);
    root.addEventListener('pointercancel', () => { if (chatVars.rowSheet) chatVars.rowSheet.outsidePress = false; }, true);
    root.addEventListener('submit', e => {
      if (e.target.matches('[data-incog-form]')) { e.preventDefault(); const id = idOf(e.target), field = e.target.querySelector('textarea'), text = field.value; field.value = ''; void INC?.send(id, text); return; }
      const rn = e.target.closest('[data-rnform]'); if (rn) { e.preventDefault(); submitRename(rn); return; }
      const crn = e.target.closest('[data-chrnform]'); if (crn) { e.preventDefault(); submitChannelRename(crn); return; }
      const cf = e.target.closest('[data-chchanform]'); if (cf) { e.preventDefault(); void channelSend(idOf(cf), cf); return; }
      const f = e.target.closest('[data-chform]'); if (!f) return;
      e.preventDefault(); const id = idOf(f); const ta = f.querySelector('textarea');
      const text = ta.value; const c = ch(id);
      // A voice take into this thread is recording: Send finishes it, and the words and files here go with it.
      const into = H.voiceInto?.(); if (into && into === H.win(id)?.thread && H.finishVoice) { H.finishVoice(); return; }
      if (!text.trim() && !(c.files || []).some(f => f.id || f.uploading)) return;
      ta.value = ''; syncSend(f, c); sendChat(id, text);
    });
    root.addEventListener('focusin', e => {
      if (!e.target.matches('[data-chsearch]')) return;
      const id = idOf(e.target), c = ch(id); if (c.focus) return; c.focus = true; c.sheet = false; const el = elOf(id);
      if (el?.querySelector('.ch-scroll')) { renderChatList(H.win(id), el); const inp = el.querySelector('[data-chsearch]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    root.addEventListener('focusout', e => {
      if (!e.target.matches('[data-chsearch]')) return;
      const id = idOf(e.target), c = ch(id);
      // A tap on a suggestion blurs the field first: let the tap land, then hide the empty-field suggestions.
      setTimeout(() => { const el = elOf(id), inp = el?.querySelector('[data-chsearch]'); if (!c.focus || (inp && document.activeElement === inp)) return; c.focus = false; if (!c.q && c.tsearch) c.tsearch = false; if (!c.q && el?.querySelector('.ch-sug, .ch-tbar-find')) renderChatList(H.win(id), el); }, 260);
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-incog-field]')) { INC?.input(idOf(e.target), e.target); return; }
      if (e.target.matches('[data-chemosearch]')) renderEmojiSearch(e.target.closest('.ch-emoji-sheet'), e.target.value);
      if (e.target.matches('[data-chsearch]')) {
        const id = idOf(e.target); ch(id).q = e.target.value; ch(id).coach = false; const el = elOf(id);
        if (el?.querySelector('.ch-scroll')) { renderChatList(H.win(id), el); const inp = el.querySelector('[data-chsearch]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }
      if (e.target.matches('[data-clarify-answer]')) { const c = ch(idOf(e.target)); if (c.approval?.kind === 'clarify') c.approval.answer = e.target.value; }
      if (e.target.matches('.ch-compose textarea')) { growTa(e.target); const id = idOf(e.target); typedInto(id, e.target); syncSend(e.target.form, ch(id)); }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-archafter]')) { LIVE.archiveAfterDays = +e.target.value; for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } }
      if (e.target.matches('[data-chactorder]') && typeof actSetOrder === 'function') actSetOrder(e.target.value);
    });
    root.addEventListener('keydown', e => {
      if (e.target.matches('[data-chemosearch]')) { e.stopPropagation(); if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; renderEmojiSearch(e.target.closest('.ch-emoji-sheet'), ''); } return; }
      if (chatVars.rowSheet && e.key === 'Escape') { e.preventDefault(); closeRowSheet(); return; }
      if (e.key === 'Escape' && globalThis.WosThreadTracker?.isOpen()) { e.preventDefault(); globalThis.WosThreadTracker.close(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-tt-row], [data-ttjump]') && !e.target.closest('button')) { e.preventDefault(); e.target.click(); return; }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const row = e.target.closest(ROW_MENU);
        if (row) { e.preventDefault(); rowMenu(idOf(row), row); return; }
      }
      // Enter / Shift+Enter / Ctrl+Enter in the composer: WizComposerInput (bound with the paste and drop handlers).
    });
    bindGestures(root); bindPull(root);
    PW?.bind(root);
  }
  /* Words from outside (dictation, a native shell) go in at the composer's cursor. */
  function insertText(id, text) {
    const ta = elOf(id)?.querySelector('.ch-compose textarea'); if (!ta || !text) return false;
    if (INC?.active(id)) { window.WizComposerInput.insertText(ta, text); INC.input(id, ta); return true; }
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); ta.focus();
    ta.setSelectionRange(a + text.length, a + text.length); typedInto(id, ta); growTa(ta); syncSend(ta.form, ch(id));
    return true;
  }
  const forget = id => { INC?.close(id, true); const c = CH[id]; if (c) { closeStream(c); for (const t of [c.retryT, c.sentTimer, c.ptrT, listSaveT[id]]) clearTimeout(t); delete listSaveT[id]; } closeHosted(id); clearReading(id); delete CH[id]; };
  function justPressed() { return chatVars.lpHeld !== null || Date.now() < chatVars.lpUntil; }
  // A list must not re-render under an open actions sheet or a finger mid-press.
  const holdList = id => {
    if (chatVars.paintForced) return false;
    const el = elOf(id), hold = chatVars.rowSheet?.wid === id || (!!chatVars.lp && chatVars.lp.wid === id) || (!!chatVars.swipeOpen && chatVars.swipeOpen.wid === id && chatVars.swipeOpen.wrap.isConnected) || !!PW?.holds(id) || (!!el && readingIn(el));
    if (hold) ch(id).heldList = true;
    return hold;
  };
  // Back / Esc: the media viewer, then the actions sheet. Returns what it closed, or ''.
  function closeFilterSheet() { for (const id of Object.keys(CH)) { const c = CH[id]; if (c.sheet) { c.sheet = false; const w = H.win(id); if (w) rerenderList(w); return true; } } return false; }
  const closeOverlay = () => (closeSwipe() ? 'row-swipe' : null) || (closeSpacePicker() ? 'space-picker' : null) || (closeFilterSheet() ? 'filter-sheet' : null) || (window.WizCore.status?.back() || (KIT.viewer.close() ? 'viewer' : closeRowSheet() ? 'thread-actions' : PW?.closeSheet() ? 'chat-sheet' : ''));
  function registerBack(stack, after) {
    // Each activity has its own recency, not one fixed-priority closeOverlay bucket.
    const owners = [
      ['row-swipe', () => chatVars.swipeOpen, closeSwipe],
      ['space-picker', () => chatVars.spacePicker, closeSpacePicker],
      ['filter-sheet', () => Object.values(CH).find(c => c.sheet), closeFilterSheet],
      ['thread-actions', () => chatVars.rowSheet, closeRowSheet],
      ['chat-sheet', () => PW?.sheetOpen(), () => PW.closeSheet()],
    ];
    return owners.map(([name, active, back]) => stack.watch(active, () => { back(); after?.(); }, name));
  }
  return { bind, click, closeFilterSheet, closeOverlay, elOf, forget, holdList, idOf, insertText, justPressed, markVisibleThreadsSeen, registerBack, bindLate: v => { if ('PW' in v) PW = v.PW; } };
};
