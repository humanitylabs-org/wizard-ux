/* Wizard UX core: Chats › thread actions: Snooze / Archive on a thread (settled or still working) and the shared action icons.
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.threadacts = function ({ isWorking, LIVE, WORKING_ST }) {
  /* Thread actions: Snooze / Archive on a settled thread with an answer (Close & file retired with Helm).
   * A durable follow-up adds an explicit Stop action; Archive becomes "Archive for now" and never cancels it. */
  const followUpActive = s => s?.followUp?.active === true && Number(s.followUp.count) > 0;
  const workingNow = s => isWorking(s) || !!globalThis.WizChatsListModel?.isListWorking?.(s);
  function threadActions(s, turns) {
    if (!s || LIVE.busy(s.id)) return [];
    const watching = followUpActive(s);
    // A watcher check really running (quiet, so its thread may stay archived): Stop watching is the only action.
    if (watching && (WORKING_ST.has(s.status) || ['waiting_for_approval', 'unknown'].includes(s.status))) return ['stop_watch'];
    const inArchive = s.archived || LIVE.workGroups([s]).archive.length > 0;
    if (inArchive) return watching ? ['restore', 'snooze', 'stop_watch'] : ['restore', 'snooze'];
    // An approval wait keeps its approval card as the only control (Archive there could lose the pending approval).
    if (['waiting_for_approval', 'unknown'].includes(s.status)) return [];
    if (s.deferred) return watching ? ['restore', 'snooze', 'stop_watch', 'done'] : ['restore', 'snooze', 'done'];
    // Still working (its run, or a helper finishing it): Snooze and Archive too, beside Stop (wizard-ux issue 1997).
    // Archive never cancels the run; the Agent Service brings the thread back to Inbox with its visible reply.
    if (workingNow(s)) return watching ? ['snooze', 'stop_watch', 'done'] : ['snooze', 'done'];
    // A run James stopped (or one that died) before any answer still needs a way out: Done files it.
    if (turns && !turns.some(t => t.a || t.media.length)) return ['cancelled', 'failed', 'interrupted'].includes(s.status) ? (watching ? ['stop_watch', 'done'] : ['done']) : [];
    return watching ? ['snooze', 'stop_watch', 'done'] : ['snooze', 'done'];
  }
  const ACT = {
    unread: { label: 'Mark unread', icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 7 7 5 7-5"/></svg>', hint: 'Mark unread' },
    done: { label: 'Archive', icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="4" rx="1.2"/><path d="M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>', hint: 'Archive' },
    file: { label: 'Close & file', icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="4" rx="1.2"/><path d="M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>', hint: 'Close and file thread' },
    snooze: { label: 'Snooze', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/></svg>', hint: 'Snooze: bring this thread back later' },
    stop_watch: { label: 'Stop watching', icon: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><path d="m4 4 16 16"/></svg>', hint: 'Stop watching this follow-up' },
    restore: { label: 'Restore', icon: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/></svg>', hint: 'Restore to Work' },
  };
  return { ACT, followUpActive, threadActions, workingNow };
};
