/* Wizard UX core: Chats › a channel's read place on this device and on the box, its new-post counts and their
 * repaint. Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.chanread = function ({ CH, CHAN_GENERAL, CHAN_READ_KEY, CHAN_READ_MAX, CHAN_READ_MS, CHAN_READ_UP_MS, chanActs, chanAt, chanOpen, chanStore, chatVars, focusAgentId, handledNow, isWorking, LIVE, owner, renderChatList, rowOf, storeAgent, W }) {
  let deferredOf, elOf, holdList, snoozeLast; // late-bound: chats.js declares these after the call, see bindLate
  let chanReadUpAt = -Infinity;
  // The box's marks (key -> ms) while Channels are on and the box keeps them, else null.
  const chanReadBox = () => {
    const box = (typeof LIVE !== 'undefined' && LIVE.chanReads?.marks?.()) || null;
    if (box && Date.now() - chanReadUpAt >= CHAN_READ_UP_MS) chanReadUp(box);
    return box;
  };
  /* This device's marks that are ahead of the box's go up: after each local write, and at most every CHAN_READ_UP_MS
   * when the box answers, so a write that failed (offline, busy) or one made while the switch was off still reaches
   * the box later. Once the box has them nothing is sent. */
  function chanReadUp(box) {
    chanReadUpAt = Date.now();
    const up = Object.entries(chanReads().at).filter(([k, t]) => !(box[k] >= t)).sort((x, y) => y[1] - x[1]).slice(0, 300);
    if (up.length) LIVE.chanReads.push(Object.fromEntries(up));
  }
  function chanReadParse() {
    let v = null; try { v = JSON.parse(localStorage.getItem(CHAN_READ_KEY) || 'null'); } catch (_) {}
    if (!v || typeof v !== 'object' || !Number.isFinite(v.since) || !v.at || typeof v.at !== 'object') return null;
    return { since: v.since, at: Object.fromEntries(Object.entries(v.at).filter(([, t]) => Number.isFinite(t))) };
  }
  function chanReads() {
    if (chatVars.chanReadDoc) return chatVars.chanReadDoc;
    const v = chanReadParse(); chatVars.chanReadDoc = v || { since: Date.now(), at: {} };
    if (!v) chanReadSave(true); // since is kept at once: it must not move on the next load
    return chatVars.chanReadDoc;
  }
  // Written with the newer of each mark (another tab of this device may have moved one meanwhile), newest kept.
  function chanReadSave(now = false) {
    const put = () => {
      clearTimeout(chatVars.chanReadT); chatVars.chanReadT = 0; const d = chatVars.chanReadDoc; if (!d) return;
      const was = chanReadParse(); if (was) { d.since = Math.min(d.since, was.since); for (const [k, t] of Object.entries(was.at)) if (!(d.at[k] >= t)) d.at[k] = t; }
      const at = Object.entries(d.at).sort((a, b) => b[1] - a[1]).slice(0, CHAN_READ_MAX); d.at = Object.fromEntries(at);
      try { localStorage.setItem(CHAN_READ_KEY, JSON.stringify({ since: d.since, at: d.at })); } catch (_) {}
      // The same marks to the box (issue 471): every one this device holds ahead of it.
      const box = chanReadBox(); if (box) chanReadUp(box);
    };
    if (now) put(); else if (!chatVars.chanReadT) chatVars.chanReadT = setTimeout(put, CHAN_READ_MS);
  }
  try {
    window.addEventListener('pagehide', () => { if (chatVars.chanReadT) chanReadSave(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && chatVars.chanReadT) chanReadSave(true); });
    window.addEventListener('storage', e => { if (e.key === CHAN_READ_KEY && !chatVars.chanReadT) { chatVars.chanReadDoc = null; chanReadPaint(); } });
  } catch (_) {}
  // A channel is its agent and id. General focused on one agent shows only that agent's posts, so it has its own mark
  // (general|<agent>); the All General covers every agent's, so reading it to a time reads each focused one too.
  const chanReadKey = (c, gAg = '') => !c || c.agentFeed ? '' : c.general || c.id === CHAN_GENERAL ? (gAg ? 'general|' + storeAgent(gAg) : 'general') : storeAgent(c.agent) + '|' + c.id;
  const chanReadOwn = key => { const d = chanReads(), box = chanReadBox(), own = d.at[key] ?? d.since; return box && Number.isFinite(box[key]) ? Math.max(own, box[key]) : own; };
  const chanReadAt = key => { const own = chanReadOwn(key); return key.startsWith('general|') ? Math.max(own, chanReadOwn('general')) : own; };
  const chanGenAgent = w => { try { return focusAgentId(W[owner(w.id)] || w) || ''; } catch (_) { return ''; } };
  // Changed after the mark. A working post waits for its reply; a Done or snoozed-last one is not new (Activity's rule).
  const chanChanged = (s, mark) => !isWorking(s) && !s.archived && !(snoozeLast() && deferredOf(s)) && chanAt(s) > mark && !(typeof handledNow === 'function' && handledNow(s));
  const chanNewCount = (c, rows, gAg = '') => { const mark = chanReadAt(chanReadKey(c, gAg)); return rows.filter(s => chanChanged(s, mark)).length; };
  // Only ever forward. The channel lists on screen (the phone's list, the desktop's sidebar pane) show it at once.
  function chanReadTo(key, t) {
    if (!key || !Number.isFinite(t)) return false;
    const d = chanReads(); if (t <= chanReadOwn(key)) return false;
    d.at[key] = t; chanReadSave();
    clearTimeout(chatVars.chanReadPaintT); chatVars.chanReadPaintT = setTimeout(chanReadPaint, 120);
    return true;
  }
  function chanReadPaint() { for (const id of Object.keys(CH)) { const x = W[id]; if (!x || x.thread || chanOpen(x) || holdList(id)) continue; const el = elOf(id); if (el) renderChatList(x, el); } }
  // Issue 1380: the box's channel list changed (right after Channels turns on, its first answer brings Alerts): the
  // lists on screen show it at once, also one the shells' Live repaint skips while focus sits inside it.
  let chanListSig = '';
  LIVE?.onChange?.(() => {
    // every field the list shows or sorts by (another device's sort, pin order or reorder too, Codex P2)
    const st = chanStore(), sig = st ? JSON.stringify([st.sort, st.channels]) : '';
    if (sig === chanListSig) return;
    chanListSig = sig; clearTimeout(chatVars.chanReadPaintT); chatVars.chanReadPaintT = setTimeout(chanReadPaint, 120);
  });
  /* How far the owner has read a feed: every post whose top is above the bottom of his view, but never past a post of
   * the channel that changed and he has not seen: one still below the view, or one the feed's filter (Open, Needs you)
   * leaves out (the mark is a time and the feed is in posting order: a new reply on an old post must not read a newer
   * post he has not reached). At the end of an unfiltered feed that is its newest post. */
  function chanReadFeed(wid, sc, feed) {
    const w = W[wid], open = w && chanOpen(w), m = chanActs[wid];
    if (!open || !m || m.key !== chanReadKey(open, open.general ? chanGenAgent(w) : '') || !sc?.clientHeight || !feed) return false;
    const mark = chanReadAt(m.key), edge = sc.getBoundingClientRect().top + sc.clientHeight, past = new Set();
    for (const n of feed.querySelectorAll('[data-morph-key]')) if (n.getBoundingClientRect().top < edge) { past.add(n.dataset.morphKey); if (n.dataset.chrow) past.add('row:' + n.dataset.chrow); }
    let seen = -Infinity, cap = Infinity;
    for (const p of m.rows) {
      if (p.shown && (past.has('row:' + p.row) || past.has(p.post))) seen = Math.max(seen, p.at);
      else if (p.changed && p.at > mark) cap = Math.min(cap, p.at - 1);
    }
    return chanReadTo(m.key, Math.min(seen, cap));
  }
  // Opening a post marks it read (LIVE.markSeen). The desktop keeps the feed on screen beside the thread, and its
  // list pane skips Live repaints while focus is inside it (the tapped post), so the feed is painted here at once:
  // the line and the channel are already read when Back lands on them, never a frame late.
  // The row to mark read when a thread opens from a window: with Channels on, the window's own row (rowOf: a routed
  // channel's post can share its id with a main thread, and the id-only lookup would mark the main one), else the id.
  function chanSeenRow(wid, sid) {
    const r = rowOf(wid, sid);
    return r && r !== LIVE.session(sid) ? r : sid;
  }
  return { chanChanged, chanGenAgent, chanNewCount, chanReadAt, chanReadFeed, chanReadKey, chanReadPaint, chanReadTo, chanSeenRow, bindLate: v => { if ('deferredOf' in v) deferredOf = v.deferredOf; if ('elOf' in v) elOf = v.elOf; if ('holdList' in v) holdList = v.holdList; if ('snoozeLast' in v) snoozeLast = v.snoozeLast; } };
};
