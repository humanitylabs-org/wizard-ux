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
  function activityReady(live) { const r = activityReadyRows(live); return r ? r.length : null; }
  function activityReadyRows(live) {
    const L = live || LIVE, M = window.WizChatsListModel;
    if (!L?.ok || !M?.activityGroups) return null;
    const rows = (L.sessionsFor ? L.sessionsFor('') : L.unified()).filter(s => !s.hidden);
    return M.activityGroups(L.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }).ready;
  }
  /* Home's "N need you" and its Needs you · Unread card (wizard-ux issue 1517): with Channels on, the same split as
   * Activity's Ready (amber = actNeeds, the rest green), so an amber thread already opened still counts as needing you.
   * Null with Channels off: Home keeps LIVE.groups(). */
  function activityHome(live) {
    const r = activityReadyRows(live); if (!r) return null;
    return { needs: r.filter(actNeeds), ready: r.filter(s => !actNeeds(s)) };
  }
  window.WizCore.activityReady = activityReady;
  window.WizCore.activityHome = activityHome;
  /* Activity with Channels on (wizard-ux issue 1336; James, 12 Nov 2026: "I'm not really going to archive threads
   * anymore"): a short what-needs-me list. Working as today; Ready holds amber (waiting on the owner, until addressed)
   * and green (finished, unread, until opened) mixed in the one sort; Recent is everything else, newest first, about a
   * week back, then Show older within the live window; Snoozed and Archived fold at the very bottom. The one sort menu
   * sits on Ready (Newest first, Oldest first, Needs you first), stored as Chats' own Ready order. */
  const ACT_SORTS = () => window.WizChatsListModel.ACTIVITY_SORTS;
  return { ACT_SORTS, listSaveT, queueListPlace, storedListPlace };
};
