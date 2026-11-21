/* Wizard UX core: Chats › row actions: the actions sheet shared by threads, alerts and channel lines, and what its
 * buttons do on a thread or a folded alert row. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.rowacts = function ({ ACT, actRestore, actUndo, BOOM, ch, CH, closeRowSheet, followUpActive, H, keepThreadOpen, leaveFinishedThread, LIVE, markDone, notifAct, openChannelSheet, openRowSheet, owner, paintListsNow, rowOf, threadBack, toast, vib, W }) {
  let renderChats; // late-bound: chats.js declares these after the call, see bindLate
  async function threadAct(wid, sid, a) {
    wid = owner(wid);
    const s = rowOf(wid, sid); if (sid === '__new__') { notifAct(wid, a); return; } if (a === 'markdone') { markDone(wid, sid); return; } if (!s || !ACT[a]) return;
    const w = W[wid];
    vib(8);
    if (a === 'unread') {
      closeRowSheet();
      // Hold an open reader's explicit unread marker until navigation; its live repaint must not consume it.
      for (const id of Object.keys(CH)) {
        const x = W[id]; if (!x || x.thread !== sid) continue;
        if (keepThreadOpen()) ch(id).unreadHold = { sid, nav: ch(id).readNav };
        else threadBack(x);
      }
      const write = LIVE.markUnread(sid); paintListsNow();
      const ok = await write;
      toast(ok ? '●' : '!', ok ? 'Marked unread' : 'Couldn’t mark unread', ok ? 1600 : 3200);
      for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
      return;
    }
    if (a === 'stop_watch') {
      closeRowSheet();
      const ok = await LIVE.stopWatching(sid, LIVE.ownerOf ? LIVE.ownerOf(s) : undefined);
      toast(ok ? '◉' : '!', ok ? 'Stopped watching' : 'Couldn’t stop watching', ok ? 1600 : 3200);
      for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
      return;
    }
    if (a === 'snooze' && window.WosSkinHost?.action('snooze', { sessionId: sid })) return;
    if (a === 'snooze') { const B = BOOM(); if (B) B.open({ sessionId: sid, targetKind: 'thread', title: s.title, context: s.title }, B.nextFor(sid)); else toast('!', 'Snooze is still loading', 1600); return; }
    // Archive of the open thread: desktop opens the next chat in the drawn list, the phone returns to the chats list
    // (James, 7 Nov 2026); Snooze lands the same way through the same helper.
    if (a === 'done' && w?.thread === sid) leaveFinishedThread(w, sid);
    else if (!keepThreadOpen() && a !== 'restore' && w && w.thread === sid) threadBack(w);
    const msg = { done: ['✓', followUpActive(s) ? 'Archived · still watching' : 'Archived'], file: ['▤', 'Filing…'], restore: ['↺', 'Restored to Work'] }[a];
    // With Channels on, an archive offers Undo for about five seconds (issue 1336), in place of the plain toast. Undo
    // waits for the archive's own write to settle (a restore while it is in flight is refused as busy), then restores.
    let archiving = null;
    if (!(a === 'done' && typeof actUndo === 'function' && actUndo(msg[1], () => actRestore(sid, archiving))))
      toast(msg[0], msg[1], 1600);
    // Same frame as the tap (James, 7 Nov 2026, reported again): LIVE patches its list synchronously and only then awaits
    // the write, so start it, paint every list now (open sheet / swipe / long-press holds must not defer it), reconcile after.
    const write = a === 'done' ? LIVE.archive(sid) : a === 'file' ? LIVE.archive(sid, { file: true }) : LIVE.restore(sid); archiving = write;
    paintListsNow();
    const ok = await write;
    if (ok && a === 'file') toast('▤', 'Filed in Archive', 1800);
    if (!ok) toast('!', { done: 'Couldn’t archive · thread restored', file: 'Couldn’t close & file · thread restored', restore: 'Couldn’t restore · thread kept where it was' }[a], 3200);
    for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
  }
  /* Threads and alerts share one actions sheet, dismissal and gesture ownership. */
  const ROW_MENU = '.ch-list [data-chopen], .ch-list .ch-notif-row[data-chnotif], .ch-list [data-chchan]';
  // A channel line opens the channel sheet; every other row its thread or alert sheet.
  const rowMenu = (wid, row) => row?.dataset.chchan ? openChannelSheet(wid, row.dataset.chchan, row) : openRowSheet(wid, row?.dataset.chopen, row?.dataset.chnotif);
  const NOTE_ACT = { done: ACT.done, snooze: { ...ACT.snooze, label: 'Snooze' }, unread: ACT.unread };
  // On a folded row (several from one app) every action covers the whole fold.
  async function noteRowAct(nid, a, ids) {
    const it = window.WosBell?.item?.(nid);
    if (!it || it.archived || !NOTE_ACT[a]) return;
    vib(8);
    ids = ids && ids.length ? ids : [nid];
    // The Notifications app has read / archived, not a separate done or flag state.
    // Archive marks the alert read and takes it out of Ready; Snooze marks it read and keeps it (the snoozed tail).
    const write = window.WosBell.mark(ids, a === 'unread' ? { read: false } : a === 'snooze' ? { read: true } : { read: true, archived: true });
    paintListsNow(); // mark() patches its items synchronously; the list follows on this frame, not on the 60 ms watcher
    const ok = await write;
    const many = ids.length > 1 ? `${ids.length} ` : '';
    // Archive offers Undo with Channels on (issue 1336): the alerts come back unarchived, still read.
    if (ok && a === 'done' && typeof actUndo === 'function' && actUndo(many ? `${ids.length} done` : 'Done', () => { void window.WosBell.mark(ids, { archived: false }); paintListsNow(); })) return;
    toast(ok ? '✓' : '!', ok ? (a === 'unread' ? `${many}Marked unread` : a === 'snooze' ? `${many}Snoozed` : many ? `${ids.length} done` : 'Done') : 'Couldn’t save · restored', ok ? 1600 : 3200);
  }
  return { NOTE_ACT, noteRowAct, ROW_MENU, rowMenu, threadAct, bindLate: v => { if ('renderChats' in v) renderChats = v.renderChats; } };
};
