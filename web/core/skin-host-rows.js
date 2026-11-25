/* Wizard UX skin host › the app the Add to home screen sheet may offer, notification rows in sessions.list() (one
 * row per app) and the orb swipe map. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before core/skin-host.js. The body below keeps
 * skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.rows = function ({ isDoc }) {
  let inboxThreads; // late-bound: skin-host.js declares these after the call, see bindLate
  // The registered app the stock Add to home screen sheet may offer (Desks: a frontend app, never a system one).
  function homeScreenApp(id) {
    const H = isDoc ? window.WizHomeScreenApps : null, C = isDoc ? window.WizCore : null;
    if (!H || typeof id !== 'string' || !id || typeof C?.apps !== 'function') return null;
    for (const k of ['mobile', 'desktop']) { let x = null; try { x = C.apps(k)?.APP?.[id]; } catch (_) {} if (x && !x.system && H.canOffer(x)) return x; }
    return null;
  }
  const SESSION_ACTS = Object.freeze(['snooze', 'done', 'unread', 'restore', 'pin', 'rename', 'move', 'markdone']);
  /* Notification rows in sessions.list() (round 5): the items Chats lists while a package shows the inbox as threads
   * (host.inboxList), as Ready rows. New = unread (Snooze, Archive), snoozed = read (Restore, Archive), the actions the
   * inbox's handler takes; open = the notification as a chat (its Badge | Chats picker above it). */
  const NOTE_ID = 'notif:', NOTE_ID_OPEN = 'open', NOTE_ACTS = Object.freeze(['snooze', 'restore', 'done']);
  const notePlain = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, '$1').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
  /* One row per app (Miguel, 3 Nov 2026: a noisy app is one row, not 50; the same rule as Chats' own list): two or more
   * waiting items from one app (or Wizard's own alerts) fold into one row named for the app with its count, opening the
   * newest (Chats lists the rest under it). Priority 4+ never folds. A fold's Snooze / Archive / Restore cover it all. */
  const NOTE_FOLD = new Map();   // row id → every item id it stands for
  const noteTitle = it => (notePlain(it.title) || notePlain(String(it.message || '').split('\n').find(l => l.trim())) || 'Notification');
  function noteRows() {
    NOTE_FOLD.clear();
    if (!isDoc || !inboxList()) return [];
    const all = (window.WosBell?.items?.() || []).filter(i => i && i.id && !i.archived), by = new Map(), sets = [];
    for (const it of all) {
      if (Number(it.priority) >= 4) { sets.push([it]); continue; }
      const k = (it.app || it.from || 'notifications') + (it.read ? ':later' : ':new'); if (!by.has(k)) by.set(k, []); by.get(k).push(it);
    }
    for (const l of by.values()) if (l.length < 2) sets.push(l); else sets.push(l.slice().sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0)));
    return sets.map(l => {
      const it = l[0], row = window.WizChatsListModel.notificationRow(it, l), n = l.length, from = it.app ? String(it.appName || it.app) : it.from ? String(it.fromName || it.from) : (window.WizConfig?.agent?.() || 'Wizard');
      if (n > 1) NOTE_FOLD.set(NOTE_ID + it.id, l.map(i => i.id));
      return { id: NOTE_ID + it.id, title: (n > 1 ? `${from} (${n}) · ${l.slice(0, 3).map(noteTitle).join(' · ')}` : `${from} · ${noteTitle(it)}`).slice(0, 160),
        kind: 'ready', note: true, sortTitle: row.sortTitle, rank: row.rank, app: String(it.app || it.from || ''), appName: String(it.appName || it.fromName || ''), at: new Date((Number(it.time) || 0) * 1000).toISOString(),
        unread: !it.read, snoozed: !!it.read, pinned: false, needs: row.rank === 1, from, count: n, actions: it.read ? ['restore', 'done'] : ['snooze', 'done'] };
    });
  }
  // A folded row's action covers every item in it (the inbox marks them together); a single row goes through the inbox.
  function noteAct(id, action) {
    const ids = NOTE_FOLD.get(id);
    if (!ids || !window.WosBell?.mark) return inboxAct(action, id.slice(NOTE_ID.length));
    void window.WosBell.mark(ids, action === 'restore' ? { archived: false, read: false } : action === 'snooze' ? { read: true } : { read: true, archived: true });
    return true;
  }
  const READY_ORDER_KEY = 'wos.chats.readyOrder.v1', READY_ORDERS = ['newest', 'oldest', 'priority', 'subject'];   // core/chats.js's
  function readWorkingOrder() { return window.WizLive?.workingOrder?.() || 'alphabetical'; }
  function readReadyOrder() { try { const v = localStorage.getItem(READY_ORDER_KEY); return READY_ORDERS.includes(v) ? v : 'newest'; } catch (_) { return 'newest'; } }
  function activityRows(l) {
    if (!l) return null;
    const M = window.WizChatsListModel, o = structuredClone(l), order = readReadyOrder();
    const notes = noteRows().map(r => ({ ...r, mark: r.snoozed ? '' : r.rank === 1 ? 'needs' : 'new' }));
    o.ready = M.activitySort([...(o.ready || []), ...notes.filter(r => !r.snoozed)], order);
    // Inbox until archived (wizard-ux issue 1810): no Recent; a read (kept) alert waits with the snoozed chats, as in Classic.
    if (window.WizCore?.inboxKeep?.()) o.snoozed = M.activitySort([...(o.snoozed || []), ...notes.filter(r => r.snoozed)], 'newest');
    else o.recent = M.activitySort([...(o.recent || []), ...notes.filter(r => r.snoozed)], 'newest');
    return o;
  }
  function withNoteRows(ready) {
    return window.WizChatsListModel.readySort([...ready, ...noteRows()], readReadyOrder());
  }
  const inboxList = () => { for (const h of inboxThreads.values()) if (h.list) return true; return false; };
  function inboxAct(action, id) { for (const h of inboxThreads.values()) { h.act(String(action), String(id)); return true; } return false; }
  const panelHolders = new Set();   // layouts that asked for the one right-side panel instead of desks
  const orbSwipeHolders = new Map();      // layout → its dock-orb swipe map (api.phone.swipes); none = the stock swipes
  // up: 'home' (go Home) or 'new' (a New chat, the cursor in its composer: the AI apps view, round 5)
  const ORB_SWIPE_ACTS = { up: ['home', 'new'], side: [], down: [] };
  function orbSwipeMap(map) {
    const o = {};
    for (const k of Object.keys(ORB_SWIPE_ACTS)) {
      if (!(k in map) || map[k] === 'stock') continue;
      o[k] = ORB_SWIPE_ACTS[k].includes(map[k]) ? map[k] : null;
    }
    return Object.freeze(o);
  }
  const commandUis = new Set(), orbTaps = new Set(), keyHandlers = new Set(), keyGuides = new Set();   // layout-only: api.voice.onCommand/onTap, api.keys
  return { activityRows, commandUis, homeScreenApp, inboxAct, keyGuides, keyHandlers, NOTE_ACTS, NOTE_ID, NOTE_ID_OPEN, noteAct, orbSwipeHolders, orbSwipeMap, orbTaps, panelHolders, readReadyOrder, readWorkingOrder, READY_ORDER_KEY, SESSION_ACTS, withNoteRows, bindLate: v => { if ('inboxThreads' in v) inboxThreads = v.inboxThreads; } };
};
