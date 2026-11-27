/* Wizard UX core: Chats › notification rows: one row per app, the Priority groups, and how an app's item reads in
 * the list (its mark, name and title). Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.notes = function ({ ago, clip, esc, LIVE, stiKind, withNotes }) {
  let snoozeLast; // late-bound: chats.js declares these after the call, see bindLate
  /* One row per app (Miguel, 3 Nov 2026: a noisy app is one row in Chats, not 50). Two or more waiting items from the
   * same place (an app, or Wizard's own alerts) fold into one row: its mark, its name, how many, the newest first.
   * Opening it opens the newest, with the rest listed under it and Done all. Anything that needs you (priority 4+)
   * keeps its own row, so it is never buried in a fold. The Chats badge still counts every item (badge == items). */
  // A Notifications item about an app (tagged app:<id>, WosBell's `from`) is that app's, not the agent's.
  const noteSrc = it => it.app || it.from || 'notifications';
  const noteSrcName = it => it.app ? (it.appName || it.app) : it.from ? (it.fromName || it.from) : (window.WizConfig?.agent?.() || 'Wizard');
  const noteFolds = it => !it.group && (Number(it.priority) || 3) < 4;
  function fold(list) {
    const by = new Map(), out = [];
    for (const it of list) { if (!noteFolds(it)) { out.push(it); continue; } const k = noteSrc(it); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    for (const [k, l] of by) {
      if (l.length < 2) { out.push(l[0]); continue; }
      const items = l.slice().sort((a, b) => noteAt(b) - noteAt(a)), top = items[0];
      out.push(Object.freeze({ ...top, group: k, items, time: top.time, priority: Math.max(...items.map(i => Number(i.priority) || 3)), read: items.every(i => i.read) }));
    }
    return out;
  }
  // The open item's place: everything else waiting from the same app (what Done all clears with it).
  function noteSiblings(it) {
    if (!it || !noteFolds(it)) return [];
    const k = noteSrc(it);
    return (window.WosBell?.items?.() || []).filter(i => i && i.id && !i.archived && i.id !== it.id && noteFolds(i) && noteSrc(i) === k).sort((a, b) => noteAt(b) - noteAt(a));
  }
  const noteAt = it => (Number(it.time) || 0) * 1000;
  const sesRank = s => window.WizChatsListModel.sessionRank(s, { snoozeLast: snoozeLast(), failed: stiKind(s) === 'failed' });
  /* Priority shows its groups (Miguel, 29 Oct 2026: "they're not grouped properly … it doesn't really change from
   * newest"): a small header per status, most urgent first, newest first inside each. Notifications join the group of
   * their own priority (4–5 Needs you, 3 Your call, the rest FYI). */
  const PRI_LABEL = { 0: 'Needs approval', 1: 'Needs you', 2: 'Your call', 3: 'FYI', 4: 'Done', 5: 'No status', 9: 'Snoozed' };
  function priorityGroups(list, awake, rowFn, sec) {
    return window.WizChatsListModel.priorityGroups(list, awake, sesRank).map(g => { const r = g.rank, n = window.WizChatsListModel.unreadThreads(g.rows, s => LIVE.isNew(s), g.notes);
      return `<div class="ch-subj ch-pri" data-pri="${r}" data-morph-key="${esc(sec === 'ready' ? `pri:${r}` : `pri:${sec}:${r}`)}"><span>${PRI_LABEL[r] || 'Other'}</span><small>${n || ''}</small></div>` + withNotes(g.rows, g.notes, rowFn); }).join('');
  }
  const notePlain = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, '$1').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
  // An app's item (Settings › Notifications set to Chats) wears that app's own mark as its avatar; Notifications keeps the bell.
  function noteIcon(it) {
    const app = it.app || it.from;
    if (!app || !window.WizSigil) return window.WosBell?.icon || '';
    try { const meta = window.WizCore?.appMetadata?.(app) || { id: app, name: it.appName || it.fromName || app }; return window.WizSigil.html(meta); } catch (e) { return window.WosBell?.icon || ''; }
  }
  const noteTitle = it => notePlain(it.title) || notePlain(String(it.message || '').split('\n').find(l => l.trim())) || 'Notification';
  const NOTE_BELL = '<span class="ch-al-mk" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg></span>';
  // The unread / needs-you dot where a thread row has it (core/chats-daily.js actRowMark's markup).
  function noteInd(it) {
    const m = it.read ? '' : window.WizChatsListModel?.notificationRow?.(it)?.rank === 1 ? 'needs' : 'new';
    return m === 'needs' ? '<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"></i></span>'
      : m === 'new' ? '<span class="ch-act-ind"><i class="ch-chan-dot new" role="img" aria-label="Unread"></i></span>' : '<span class="ch-act-ind" aria-hidden="true"></span>';
  }
  function noteRow(it) {
    const later = !!it.read, from = noteSrcName(it), n = it.group ? it.items.length : 0;
    const title = n ? it.items.slice(0, 4).map(noteTitle).join(' · ') : noteTitle(it);
    const pv = (it.source === 'cron' && !n ? 'Scheduled job · ' : '') + clip(notePlain(it.message), 160);
    const lbl = n ? `${from}: ${n} waiting · newest ${noteTitle(it)}` : `${from}: ${noteTitle(it)}`;
    // Plain alert rows (wizard-ux issue 1941, on for everyone): a chat row like the threads around it (the same status
    // tile, the source where a thread names its channel), marked only by a small bell before the source name (Inbox
    // rows draw theirs in core/chats-inboxrows.js ibNoteRow). No amber card, pill, tile or time.
    return `<div class="ch-row-wrap ch-al-wrap${later ? ' later' : ''}" data-morph-key="${n ? `notifg:${esc(it.group)}:${later ? 'l' : 'a'}` : `notif:${esc(it.id)}`}"><button type="button" class="ch-row ch-notif-row ch-al-row${later ? ' deferred' : ' unread'}" data-chnotif="${esc(it.id)}"${it.app ? ` data-chnotif-app="${esc(it.app)}"` : ''}${n ? ` data-chnotif-group="${esc(it.group)}"` : ''} aria-label="${esc(clip('Alert from ' + lbl, 200))}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10" title="${n ? 'Open the newest · the rest are listed under it' : 'Open'} · hold or open the context menu for actions"><span class="emo sti ch-al-ic" aria-hidden="true">${noteIcon(it)}</span>
      <span class="bd"><span class="tp"><b>${esc(clip(title, 160))}</b>${n ? `<span class="ch-al-n">${n > 99 ? '99+' : n}</span>` : ''}<time>${esc(ago(new Date(noteAt(it)).toISOString()))}</time></span><span class="ch-chan-line ch-al-from">${NOTE_BELL}${esc(clip(from, 40))}</span><span class="pv"><span class="ch-chan-tag ch-al-from">${NOTE_BELL}${esc(clip(from, 40))}</span> · ${esc(pv)}</span></span>${noteInd(it)}</button></div>`;
  }
  return { fold, noteAt, noteIcon, notePlain, noteRow, noteSiblings, noteSrcName, noteTitle, priorityGroups, sesRank, bindLate: v => { if ('snoozeLast' in v) snoozeLast = v.snoozeLast; } };
};
