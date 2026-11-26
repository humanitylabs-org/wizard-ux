/* Wizard UX core: Chats › list places kept on this device, and Activity's Ready and Needs you counts for the orb
 * badge, the desk marks and Home. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.ready = function ({ actNeeds, actUnread, CH, chanAt, elOf, H, LIST_PLACE_KEY, LIST_PLACE_TTL, listPlace, listSig, LIVE, W }) {
  function readListPlaces() { try { return JSON.parse(localStorage.getItem(LIST_PLACE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function storeListPlace(wid) {
    const w = W[wid], c = CH[wid], el = elOf(wid), sc = el?.querySelector('.ch-list > .ch-scroll');
    // A list without layout (hidden, parked desk, mid-transition) reads 0: that is not where James is.
    if (!w || w.thread || !c || c.listPending || !sc || !sc.isConnected || !sc.clientHeight) return;
    const place = listPlace(el); if (!place) return;
    const all = readListPlaces(), now = Date.now();
    for (const k of Object.keys(all)) if (!(now - (all[k]?.at || 0) < LIST_PLACE_TTL)) delete all[k];
    all[wid] = { ...place, sig: listSig(w), at: now };
    try { localStorage.setItem(LIST_PLACE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function storedListPlace(w) {
    const r = readListPlaces()[w.id];
    return r && Date.now() - (r.at || 0) < LIST_PLACE_TTL && r.sig === listSig(w) ? { top: r.top, rows: r.rows || [] } : null;
  }
  const listSaveT = {};
  function queueListPlace(wid) { clearTimeout(listSaveT[wid]); listSaveT[wid] = setTimeout(() => storeListPlace(wid), 200); }
  function flushListPlaces() { for (const wid of Object.keys(listSaveT)) { clearTimeout(listSaveT[wid]); delete listSaveT[wid]; } for (const el of H.root().querySelectorAll('[data-chats]')) storeListPlace(el.dataset.chats); }
  window.addEventListener('pagehide', flushListPlaces);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushListPlaces(); });
  /* Activity's Ready as one number for the orb badge, the desk marks and Home's Ready card (wizard-ux issue 1504): the
   * same rows and rule activityBody draws for the main list (needs you OR unread, never snoozed), so the badges can never
   * disagree with the list. Notifications set to Chats are added by the badge itself (WosBell.unreadCount). Null with
   * Channels off: the badges keep their unread tally there. */
  // Pin to top (issue 1887): a read thread that is in Inbox only because it is pinned is not counted (`counted`).
  function activityReady(live) { const g = activityReadyGroups(live); return g ? (g.counted || g.ready).length + inboxExtra(live) : null; }
  function activityReadyRows(live) { return activityReadyGroups(live)?.ready || null; }
  function activityReadyGroups(live) {
    const L = live || LIVE, M = window.WizChatsListModel;
    if (!L?.ok || !M?.activityGroups) return null;
    const rows = (L.sessionsFor ? L.sessionsFor('') : L.unified()).filter(s => !s.hidden);
    // Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows): the Inbox's own rule, plus the waiting background tasks.
    const ib = window.WizCore.inboxRowsFacts?.() || null;
    return M.activityGroups(L.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }, { keep: inboxKeep(), inbox: ib, place: inboxPlace(L) });
  }
  /* Inbox or Sent (wizard-ux issue 1829): while Inbox keeps threads (inboxKeep), the list model's placeOf decides where
   * each thread is from the box's Sent log (which thread he sent into, how that ended), the quiet-reply mark and the
   * graceful-restart hold. Null with both switches off: the lists are today's. */
  function inboxPlace(live) {
    const L = live || LIVE, M = window.WizChatsListModel;
    if (!inboxKeep() || !M?.sentIndex) return null;
    const st = L?.sentLog?.state?.();
    return { sent: M.sentIndex(st?.ok ? st.rows : []), quiet: s => !!L?.quietReply?.(s), held: s => !!globalThis.WizReach?.restartHeld?.(s) };
  }
  /* What the Inbox shows right now: its thread ids plus, with Inbox rows, the waiting background tasks (thread and record
   * ids). The Sent tab leaves those out (WizChatsListModel.sentShown), so the two lists can't disagree. Null when off. */
  function inboxIds(live) {
    const L = live || LIVE; if (!inboxKeep()) return null;
    const out = new Set((activityReadyRows(L) || []).map(s => s.id));
    if (window.WizCore.inboxRowsFacts?.()) for (const r of L?.agentInbox?.needs?.('hermes') || []) { if (r?.id) out.add(r.id); if (r?.thread) out.add(r.thread); }
    return out;
  }
  // The waiting background tasks the Inbox shows as rows of their own (issue 1779): they count as well.
  function inboxExtra(live) {
    const ib = window.WizCore.inboxRowsFacts?.(), L = live || LIVE; if (!ib?.extra || !L?.ok) return 0;
    try { return ib.extra((L.sessionsFor ? L.sessionsFor('') : L.unified()).filter(s => !s.hidden)); } catch (_) { return 0; }
  }
  /* Home's "N need you" and its Needs you · Unread card (wizard-ux issue 1517): with Channels on, the same split as
   * Activity's Ready (amber = actNeeds, the rest green), so an amber thread already opened still counts as needing you.
   * Null with Channels off: Home keeps LIVE.groups(). */
  function activityHome(live) {
    const r = activityReadyRows(live); if (!r) return null;
    return { needs: r.filter(actNeeds), ready: r.filter(s => !actNeeds(s)) };
  }
  /* Inbox until archived (wizard-ux issue 1810, switch wizard/inbox-until-archived): every thread stays in Inbox until it
   * is archived, so Ready, its count and the badges are the Inbox. Read from the root's data-tweaks (the list model is pure). */
  // Inbox rows (wizard-ux issue 1779) keep every Inbox row until it is archived too, so the shells read it as Inbox.
  // Sent as threads (wizard-ux issue 1880) needs the one-place rule as well: a thread is in Inbox or in Sent, never both.
  function inboxKeep() { try { const t = document.documentElement.dataset.tweaks, M = window.WizChatsListModel; return !!(M?.inboxKeep?.(t) || M?.inboxRowsOn?.(t) || M?.sentThreadsOn?.(t)); } catch (_) { return false; } }
  window.WizCore.inboxKeep = inboxKeep;
  window.WizCore.inboxPlace = inboxPlace;
  window.WizCore.inboxIds = inboxIds;
  // A thread can move between Inbox and Sent with no session change (the Sent log landing, a send's outcome): layouts
  // that draw their own Inbox (the AI apps sidebar re-reads on a Chats paint) are told once whenever Inbox's ids change.
  let placeSig = '';
  try {
    LIVE?.onChange?.(() => {
      const ids = inboxIds(), sig = ids ? [...ids].sort().join('\n') : '';
      if (sig === placeSig) return; const had = placeSig; placeSig = sig;
      if (had || sig) window.WosSkinHost?.rendered?.('list', null);
    });
  } catch (_) {}
  window.WizCore.activityReady = activityReady;
  window.WizCore.activityHome = activityHome;
  /* Activity with Channels on (wizard-ux issue 1336; James, 12 Nov 2026: "I'm not really going to archive threads
   * anymore"): a short what-needs-me list. Working as today; Ready holds amber (waiting on the owner, until addressed)
   * and green (finished, unread, until opened) mixed in the one sort; Recent is everything else, newest first, about a
   * week back, then Show older within the live window; Snoozed and Archived fold at the very bottom. The one sort menu
   * sits on Ready (Newest first, Oldest first, Needs you first), stored as Chats' own Ready order. */
  const ACT_SORTS = () => window.WizChatsListModel.ACTIVITY_SORTS;
  return { ACT_SORTS, inboxKeep, inboxPlace, listSaveT, queueListPlace, storedListPlace };
};
