/* Wizard UX core: Chats › Ready's orders and order bar, Working's order, notifications listed in Ready and Back
 * to Newest. Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.readylist = function ({ agentName, agentRec, ago, AGS, attOf, byStatus, ch, CH, chanArchived, chanOpen, chatsBack, chatVars, clip, dailyLate, deferredOf, draftKey, esc, focusAgents, focusedAgent, focusOf, H, isWorking, KIT, leaveFinishedThread, LIVE, matchesFocus, openChat, OUTBOX, owner, pinsOn, reachLabel, READY_ORDER_KEY, READY_ORDER_LABEL, READY_ORDERS, rememberedFocus, renderChatList, renderThread, renderThreadLive, renderThreadNow, saveDraft, scrollBox, setFocus, setupLate, spaceAgent, spaces, statusEntries, statusLate, stiKind, syncDocumentThread, threadViewportTop, toast, TOPIC, topicOn, toTurns, track, troubleshoot, vib, visibleSpaces, W, winAgent }) {
  let elOf, holdList, PHONE, refreshReply, renderChats; // late-bound: chats.js declares these after the call, see bindLate
  window.addEventListener('wos:prefs', () => {
    try { const v = localStorage.getItem(READY_ORDER_KEY); if (READY_ORDERS.includes(v) || v === 'oldest') chatVars.readyOrder = v; } catch (e) {}
    for (const id of Object.keys(CH)) if (W[id]) renderChats(W[id]);
  });
  /* Shell events, after-actions, Auto-archive picker and Working order; core/chats-events.js. */
  const { archSel, keepThreadOpen, showBoomMessage, waitsOn, workingOrdered, bindLate: eventsLate } = window.WizCore.chatsParts.events({ attOf, ch, CH, deferredOf, H, holdList: (...a) => holdList(...a), isWorking, leaveFinishedThread, LIVE, renderThreadNow, toast, topicOn, W });
  const readyOrdered = list => window.WizChatsListModel.orderSessions(list, chatVars.readyOrder, { at: s => LIVE.cardAt(s), rank: sesRank });
  // List mode can end while no list is on screen (a thread, search): let the watcher go on the host's change event too.
  window.addEventListener('wos:prefs', () => { if (notesOff && !window.WosSkinHost?.inboxList) { notesOff(); notesOff = null; } });
  function readyBody(list, rowFn, nt = null, sec = 'ready') {
    const later = nt ? window.WizChatsListModel.sortNotes(nt.later, chatVars.readyOrder).map(noteRow).join('') : '', awake = nt ? nt.awake : [];
    // Subject grouping must not pull a snoozed row ahead of another subject's awake rows.
    // Keep one order bar, then all awake groups, then the snoozed tail (no new category).
    if (snoozeLast() && list.some(deferredOf)) return readyBody(list.filter(s => !deferredOf(s)), rowFn, nt && { awake, later: [] }, sec) + withNotes(list.filter(deferredOf), nt ? nt.later : [], rowFn, true);
    const bar = orderBar('Order Ready', 'data-rdyorder', READY_ORDERS, chatVars.readyOrder, o => READY_ORDER_LABEL[o]);
    // Yesterday and Past week follow Ready's order but carry no controls: the order bar and subject moves live on Ready
    // only, so a move never rewrites the saved subject order from a partial list.
    const top = sec === 'ready' ? bar : '', mk = k => sec === 'ready' ? `subj:${k}` : `subj:${sec}:${k}`;
    if (chatVars.readyOrder === 'priority') return top + priorityGroups(list, awake, rowFn, sec) + later;
    if (chatVars.readyOrder !== 'subject') return top + withNotes(list, awake, rowFn) + later;
    const groups = window.WizChatsListModel.subjectGroups(list, awake, { subject: s => attOf(s)?.subject, waits: waitsOn, saved: subjOrder() });
    const ar = (dir, k, off, label, glyph) => `<button type="button" data-subjmove="${dir}" data-subjkey="${esc(k)}" aria-label="${label} ${esc(k)}"${off ? ' disabled' : ''}>${glyph}</button>`;
    return top + groups.map((g, i) => { const k = g.key, l = g.rows, wN = g.waiting, last = i === groups.length - 1;
      return `<div class="ch-subj" data-morph-key="${esc(mk(k))}"><span>${esc(k)}</span><small>${wN ? `${wN} waiting · ` : ''}${window.WizChatsListModel.unreadThreads(l, s => LIVE.isNew(s), g.notes) || ''}</small>${sec === 'ready' ? `<span class="ch-subj-mv" role="group" aria-label="Reorder ${esc(k)}">${ar('top', k, !i, 'Move to top', '<span class="ch-subj-2up" aria-hidden="true"><i>↑</i><i>↑</i></span>')}${ar('up', k, !i, 'Move up', '↑')}${ar('down', k, last, 'Move down', '↓')}</span>` : ''}</div>` + withNotes(l, g.notes, rowFn); }).join('') + later;
  }
  /* One order bar for Ready and Working (same pills, classes and behaviour): Newest is one button, and tapping it
   * again flips it to Oldest (label shows Oldest). Declared here so the readyBody block carries it. */
  function orderBar(label, attr, orders, cur, word) {
    return `<div class="ch-rdy-bar" role="group" aria-label="${label}">${orders.map(o => { const on = cur === o || (o === 'newest' && cur === 'oldest'); return `<button type="button" ${attr}="${o}" aria-pressed="${on}"${on ? ' class="on"' : ''}>${o === 'newest' && cur === 'oldest' ? 'Oldest' : word(o)}</button>`; }).join('')}</div>`;
  }
  function nextOrder(cur, o, orders) { return o === 'newest' && (cur === 'newest' || cur === 'oldest') ? (cur === 'newest' ? 'oldest' : 'newest') : orders.includes(o) ? o : cur; }
  // Working reuses Ready's bar: A to Z · Newest (tap again: Oldest). The value is the shared Working preference.
  const WORKING_ORDERS = ['alphabetical', 'newest'], WORKING_ORDER_LABEL = { alphabetical: 'A to Z', newest: 'Newest' };
  function workingOrderBar() { return orderBar('Order Working', 'data-workorder', WORKING_ORDERS, LIVE.workingOrder?.() || 'alphabetical', o => WORKING_ORDER_LABEL[o]); }
  /* Notifications listed in Ready like any chat (a live package holds WosSkinHost.inboxList): unread ones are awake
   * rows that Newest / Oldest place by when they arrived, Priority by their own priority (4–5 beside Needs you, 3
   * beside Test this, the rest with everything else) and By subject under their own "Notifications" subject. Read
   * and kept (snoozed) ones join the snoozed tail. A tap opens one in the chat window (the package's act('open')). */
  let notesOff = null, notesT = 0;
  function notes() {
    const on = !!window.WosSkinHost?.inboxList;
    if (on && !notesOff && window.WosBell?.watch) notesOff = window.WosBell.watch(() => { clearTimeout(notesT); notesT = setTimeout(() => { for (const id of Object.keys(CH)) { const w = W[id]; if (w && !w.thread && !holdList(id)) renderChats(w); } }, 60); });
    else if (!on && notesOff) { notesOff(); notesOff = null; }
    if (!on) return null;
    const all = (window.WosBell?.items?.() || []).filter(i => i && i.id && !i.archived);
    return { awake: fold(all.filter(i => !i.read)), later: fold(all.filter(i => i.read)) };
  }
  /* Notification rows and Priority groups; core/chats-notes.js. */
  const { fold, noteAt, noteIcon, notePlain, noteRow, noteSiblings, noteSrcName, noteTitle, priorityGroups, sesRank, bindLate: notesLate } = window.WizCore.chatsParts.notes({ ago, clip, esc, LIVE, stiKind, withNotes });
  // The snoozed tail is one time-ordered run (Oldest reverses it), snoozed notes included, whatever the order.
  function withNotes(list, nts, rowFn, timeOnly = false) {
    return window.WizChatsListModel.mixedRows(list, nts, chatVars.readyOrder, { at: s => LIVE.cardAt(s), rank: sesRank }, { timeOnly })
      .map(r => r.note ? noteRow(r.value) : rowFn(r.value)).join('');
  }
  /* Android Back on the list puts Ready back to Newest, the default (James, 12 Oct 2026: "go back to the default
   * thread list, which is sequential", so no reach to the top bar). Runs after search and filter chips come off. */
  function readyBack() {
    if (chatVars.readyOrder === 'newest') return false;
    chatVars.readyOrder = 'newest'; try { localStorage.setItem(READY_ORDER_KEY, chatVars.readyOrder); } catch (e) {} LIVE.putPrefs?.({ readyOrder: chatVars.readyOrder });
    for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); }
    return true;
  }
  /* By subject order, drafts and notification threads; core/chats-drafts.js. */
  const { draftRow, moveSubject, newDrafts, noteMoreHtml, noteRouteHtml, noteStackHtml, noteTactsHtml, notifAct, notifDoneAll, notifOf, notifRoute, openContextDraft, openNewDraft, openTextDraft, sendPill, subjOrder, workLabel, bindLate: draftsLate } = window.WizCore.chatsParts.drafts({ ago, ch, CH, chatsBack, clip, elOf: (...a) => elOf(...a), esc, H, holdList: (...a) => holdList(...a), keepThreadOpen, KIT, LIVE, noteAt, notePlain, noteQuiet: (...a) => noteQuiet(...a), noteSiblings, noteSrcName, noteTitle, openChat, OUTBOX, owner: (...a) => owner(...a), PHONE: (...a) => PHONE(...a), reachLabel, renderChatList, renderChats: (...a) => renderChats(...a), saveDraft, setFocus, toast, TOPIC, topicOn, troubleshoot, vib, W, winAgent });
  /* Thread tracker (Reply, go to a message), reply summary, Compact list and the Filter sheet's Focus; core/chats-tracker.js. */
  const { CHEV_SVG, COG_SVG, COMPACT_KEY, compactOn, discardDraft, filterSheet, focusLabel, focusOption, focusOptions, jumpToMessage, leadText, listTitle, noteQuiet, quoteMessage, regenOn, replyBubble, replyCard, setSummaryOpen, snoozeLast, summaryOf, summaryStartsOpen, syncListTitle, bindLate: trackerLate } = window.WizCore.chatsParts.tracker({ agentName: (...a) => agentName(...a), agentRec, AGS: (...a) => AGS(...a), byStatus, ch, CH, chanArchived, chanOpen, clip, draftKey: (...a) => draftKey(...a), elOf: (...a) => elOf(...a), esc, focusAgents, focusedAgent, focusOf, focusUseful, holdList: (...a) => holdList(...a), KIT, LIVE, matchesFocus, notifOf, owner: (...a) => owner(...a), pinsOn, refreshReply: (...a) => refreshReply(...a), rememberedFocus, renderChatList, renderThread, renderThreadLive, renderThreadNow, saveDraft, scrollBox, spaceAgent, spaces, statusEntries, syncDocumentThread, threadViewportTop, toast, toTurns, track, visibleSpaces, W });
  eventsLate({ snoozeLast });
  statusLate({ snoozeLast });
  notesLate({ snoozeLast });
  setupLate({ snoozeLast });
  dailyLate({ snoozeLast });
  /* Focus only appears once there is something to switch between (James, 24 Oct 2026): a second agent, or an
   * owner-made Space. A one-agent install sees no strip and no Focus section. */
  function focusUseful() { return focusAgents().length > 1 || visibleSpaces().length > 0; }
  function focusStrip(w) {
    const opts = focusOptions(), solo = focusAgents().length === 1;
    return focusUseful() ? `<nav class="ch-focus-strip" aria-label="Chats focus">${opts.filter(o => o.kind === 'all' || o.kind === (solo ? 'space' : 'agent')).map(o => focusOption(w, o, true)).join('')}${solo ? '<button type="button" class="ch-focus-tab" data-chspacenew aria-label="New channel" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true">＋</span></button>' : ''}</nav>` : '';
  }
  return { archSel, CHEV_SVG, COG_SVG, COMPACT_KEY, compactOn, discardDraft, draftRow, draftsLate, eventsLate, filterSheet, focusLabel, focusOptions, focusStrip, jumpToMessage, keepThreadOpen, leadText, listTitle, moveSubject, newDrafts, nextOrder, noteAt, noteIcon, noteMoreHtml, notePlain, noteQuiet, noteRouteHtml, noteRow, notes, noteSiblings, noteSrcName, noteStackHtml, noteTactsHtml, notifAct, notifDoneAll, notifOf, notifRoute, openContextDraft, openNewDraft, openTextDraft, orderBar, quoteMessage, readyBack, readyBody, readyOrdered, regenOn, replyBubble, replyCard, sendPill, setSummaryOpen, showBoomMessage, snoozeLast, summaryOf, summaryStartsOpen, syncListTitle, trackerLate, WORKING_ORDERS, workingOrderBar, workingOrdered, workLabel, bindLate: v => { if ('elOf' in v) elOf = v.elOf; if ('holdList' in v) holdList = v.holdList; if ('PHONE' in v) PHONE = v.PHONE; if ('refreshReply' in v) refreshReply = v.refreshReply; if ('renderChats' in v) renderChats = v.renderChats; } };
};
