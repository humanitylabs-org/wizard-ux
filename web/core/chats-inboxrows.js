/* Wizard UX core: Chats › Inbox rows (wizard-ux issue 1779; on for everyone since James's yes, 27 Nov 2026). The
 * Inbox tab holds only what needs the owner, drawn as Signal / Telegram chat rows: a round avatar (the first tag's
 * emoji, else the agent's icon), the sender line (the first tag, else the agent's name) with the time, the title with
 * the unread / needs-you mark (no working mark: a run he started is in Sent, issue 1829), and one line of the latest agent message. Each row keeps an Archive button;
 * rows stay until archived (nothing drops into Recent). Today's Daily and anything tagged #priority or said urgent are
 * pinned on top. The box's background tasks that wait on him or failed (agent inbox records, kind needs_you) are rows
 * too: their hidden worker thread opens by id, Archive archives the record. Who belongs here is one pure rule in the
 * list model (WizChatsListModel.inboxWants), so the header count, the badges and the AI apps sidebar agree.
 * createChats (core/chats.js) calls this once with the closure names it reads. Loaded before chats.js by both shells. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.inboxrows = function ({ actMark, actNeeds, actUnread, AGS, agentName, agentRec, ago, attOf, chanAt, chanFace, chanStore, chatVars, ch, clip, draftTag, elOf, esc, isWorking, LIVE, noteAt, noteIcon, notePlain, noteRow, noteRowAct, noteSrcName, PIN, renderChatList, rowAgent, spacesOf, threadAct, toast, W, winAgent }) {
  // Sent's thread rows (wizard-ux issues 1880, 1883) carry the same Archive button (inboxRowsClick).
  const ibModel = () => window.WizChatsListModel;
  const ibQuiet = s => !!LIVE.quietReply?.(s);
  const ibBare = t => String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
  // The thread's tags (its channels), first one first; General is no tag.
  const ibTags = s => { try { return (spacesOf(s.id) || []).filter(sp => sp && sp.name); } catch (_) { return []; } };
  // Today's Daily thread (the sweep card lives in it): the box's `today` of the Daily channel, null before its first post.
  function ibDailyToday() {
    const st = typeof chanStore === 'function' ? chanStore() : null, c = st?.channels?.find(x => x.kind === 'daily' && !x.archived);
    return c ? LIVE.chanDaily?.state?.(c.id)?.today || null : null;
  }
  // Said urgent: the Sent log's row for the thread says so (the box reads the owner's words).
  function ibUrgent() {
    const st = LIVE.sentLog?.state?.(); const out = new Set();
    for (const r of st?.ok ? st.rows : []) if (r.urgent && r.thread) out.add(r.thread);
    return out;
  }
  /* Pin to top (wizard-ux issue 1887, switch wizard/inbox-pin-top, off by default): the threads in
   * the owner's pin list (core/chat-pins.js: the box's ui-preferences pinnedChats, the same on every device; the row
   * menu's Pin to top writes it, and an agent adds to it with PATCH /wizard/v1/ui-preferences
   * {"ops":[{"op":"add","key":"pinnedChats","item":"<thread id>"}]}) rank above today's Daily, in the order pinned.
   * Null while off, or while Pins are hidden in the Filter sheet. */
  const IB_PIN_TOP = 'wizard/inbox-pin-top';
  function ibPinTopOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(IB_PIN_TOP); } catch (_) { return false; } }
  function ibTops() {
    if (!ibPinTopOn()) return null;
    try {
      if (typeof PIN !== 'undefined' && PIN?.on?.() === false) return null;
      return new Map((window.WosChatPins?.ids?.() || []).map((id, i) => [id, (i + 1) / 1000]));
    } catch (_) { return null; }
  }
  // Pin rank: 1 today's Daily, 2 #priority / urgent / a critical ask, 0 not pinned; a pinned-to-top thread is a fraction
  // below 1 (its place in the pin list). Read once per paint (ibPins).
  function ibPinFacts() {
    const today = ibDailyToday(), urgent = ibUrgent(), tops = ibTops();
    const base = s => !s ? 0 : s.id === today ? 1 : (s.critical || urgent.has(s.id) || ibTags(s).some(sp => ibBare(chanFace(sp.name).label || sp.name) === 'priority')) ? 2 : 0;
    if (!tops) return { pin: base };
    return { pin: s => s && tops.has(s.id) ? tops.get(s.id) : base(s), top: s => !!s && tops.has(s.id), base };
  }
  function ibPins() { return ibPinFacts().pin; }
  const ibFacts = () => ({ quiet: ibQuiet, ...ibPinFacts() });
  /* A waiting record's own thread (wizard-ux issue 1928). A background task's worker thread is hidden, so the list never
   * carries it: the shell's row once it was opened here (LIVE.session, archived on the tap frame), else the thread read
   * by id (LIVE.peekSession), again at most once a minute so an archive on another device or by the agent shows up.
   * `undefined` while the first read is out, `null` when it failed (the record shows, as before). */
  const IB_PEEK_MS = 60e3, ibPeeked = new Map();
  function ibThreadOf(id) {
    const own = LIVE.session?.(id); if (own) return own;
    if (typeof LIVE.peekSession !== 'function') return null;
    let e = ibPeeked.get(id);
    if (!e || (!e.busy && Date.now() - e.at >= IB_PEEK_MS)) {
      e = { s: e ? e.s : undefined, at: Date.now(), busy: true }; ibPeeked.set(id, e);
      const mine = e;
      Promise.resolve().then(() => LIVE.peekSession(id)).then(s => { mine.s = s || null; }, () => { if (mine.s === undefined) mine.s = null; })
        .finally(() => { mine.busy = false; mine.at = Date.now(); try { LIVE.emit?.(); } catch (_) {} });
    }
    return e.s;
  }
  function ibSmartOn() { try { return !!window.WizChatsListModel?.smartInboxOn?.(document.documentElement.dataset.tweaks); } catch (_) { return false; } }
  // Does this record still wait on him: its thread is not archived or snoozed, and with Smart inbox on its status line
  // is not a check ("Your call" waits for catch me up, issue 1883). Hidden while its thread's first read is out.
  function ibRecWaits(r) {
    const s = ibThreadOf(r.thread);
    if (s === undefined) return false;
    if (!s) return true;
    // Snoozed: the box's snooze record (this device or another) is newer than what this copy of the thread knows.
    const d = LIVE.dispositionOf?.(s), v = d ? { ...s, deferred: !!d.deferred, deferredAt: d.deferred ? d.updatedAt : s.deferredAt } : s;
    if (s.archived || window.WizChatsListModel?.deferred?.(v)) return false;
    return !(ibSmartOn() && !r.failed && attOf(s)?.state === 'check');
  }
  // The box's waiting background tasks for this list's agent whose thread is not a row already.
  function ibRecs(w, rows) {
    const listed = new Set((rows || []).filter(s => !s.hidden).map(s => s.id));
    return (LIVE.agentInbox?.needs?.(winAgent(w) || 'hermes') || []).filter(r => !listed.has(r.thread) && ibRecWaits(r));
  }
  /* A task row whose thread was just archived or snoozed (from inside it, another device, the agent) leaves every drawn
   * Inbox at once, as the row's own Archive does. The row tapped to open the thread may still hold focus in a list that
   * holds its paint while focused (the desktop's list pane): it is a dead row now, so it lets go, then the lists repaint.
   * Only a row leaving does this, once per record; nothing new jumps in under a finger. */
  let ibDrawn = new Set(), ibGonePaint = 0;
  const ibKicked = new Set();
  function ibRepaintAll() { for (const x of Object.keys(W)) { const ww = W[x], el = ww && !ww.thread && elOf(x); if (el && el.querySelector?.('.ch-ib')) renderChatList(ww, el); } }
  try {
    LIVE.onChange?.(() => {
      if (!ibDrawn.size || ibGonePaint) return;
      const gone = (LIVE.agentInbox?.needs?.('hermes') || []).filter(r => ibDrawn.has(r.id) && !ibKicked.has(r.id) && !ibRecWaits(r));
      if (!gone.length) return;
      for (const r of gone) ibKicked.add(r.id);
      ibGonePaint = setTimeout(() => {
        ibGonePaint = 0;
        try { const a = document.activeElement; if (a && gone.some(r => a.closest?.(`[data-morph-key="ibrec:${r.id}"]`))) a.blur(); } catch (_) {}
        ibRepaintAll(); try { LIVE.emit?.(); } catch (_) {}
      }, 0);
    });
  } catch (_) {}
  // The shell's count and badges (core/chats-ready.js) read the same rule.
  // (Guarded: tests run slices of createChats in a bare vm without window.)
  try { window.WizCore.inboxRowsFacts = () => ({ ...ibFacts(), extra: rows => ibRecs({}, rows).length, recs: rows => ibRecs({}, rows) }); } catch (_) {}
  const ibSig = ag => `<span class="ch-ib-av ch-ib-ag" aria-hidden="true">${AGS()?.sigil?.(agentRec(ag)) || ''}</span>`;
  // The avatar and sender line for a tag name, else the agent (Sent rows name their first tag the same way: issue 1814).
  function ibTagFace(name, ag = AGS()?.defaultId?.() || 'hermes') {
    const f = name ? chanFace(name) : null;
    return { av: f && f.own ? `<span class="ch-ib-av" aria-hidden="true">${esc(f.emoji)}</span>` : ibSig(ag), from: f ? (f.label || name) : agentName(ag === (AGS()?.defaultId?.() || 'hermes') ? '' : ag) };
  }
  function ibFace(s) { return ibTagFace(ibTags(s)[0]?.name, rowAgent(s)); }
  function ibMark(m) {
    return m === 'working' ? '<span class="ch-ib-mk"><i class="ch-spin" role="img" aria-label="Working"></i></span>'
      : m === 'needs' ? '<span class="ch-ib-mk"><i class="ch-chan-dot" role="img" aria-label="Needs you"></i></span>'
      : m === 'new' ? '<span class="ch-ib-mk"><i class="ch-chan-dot new" role="img" aria-label="Unread"></i></span>' : '';
  }
  // One line of the latest agent message: the ask while it waits on him, the failure, else the newest agent words.
  function ibLine(s) {
    const a = attOf(s);
    if (a && ['needs_you', 'check'].includes(a.state) && a.ask) return a.ask;
    // Smart inbox (wizard-ux issue 1883): a failure in Inbox says why when the box knows (the named reason).
    if (['failed', 'interrupted'].includes(s.status)) return window.WosModels?.smartFail?.(s)?.line || window.WosModels?.runError?.(s)?.line || 'Didn’t finish · open it to retry';
    return s.previewRole === 'user' ? 'You: ' + (s.preview || '') : s.preview || '';
  }
  const IB_ARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v3H4zM6 10v9h12v-9M10 14h4"/></svg>';
  const IB_PIN_MARK = '<span class="ch-ib-pin" aria-label="Pinned">📌</span>';
  /* The one Signal-style row: Inbox's threads and waiting tasks, and Sent's sends (wizard-ux issue 1814, on
   * for everyone: James, 25 Nov 2026, "let's give the same design to sent"), so the two can't drift apart. Every
   * part comes in as HTML the caller escaped: `key` the morph key, `wrap` / `cls` extra classes, `open` the row button's
   * attributes, `tip` its title, `av` the avatar, `from` the sender, `time`, `title`, `mark`, `line` the one line under
   * the title, `after` what follows the row button (Archive). */
  function ibRow({ key, wrap = '', cls = '', open, tip, av, from, pin = 0, time, title, mark, line, after = '' }) {
    return `<div class="ch-row-wrap ch-ib-wrap${wrap}" data-morph-key="${key}"><button type="button" data-part="thread-row" class="ch-row ch-ib-row${cls}" ${open} title="${tip}">${av}`
      + `<span class="ch-ib-bd"><span class="ch-ib-l1"><span class="ch-ib-from">${pin ? IB_PIN_MARK : ''}${from}</span><time>${time}</time></span>`
      + `<span class="ch-ib-l2"><b class="ch-ib-t">${title}</b>${mark}</span><span class="ch-ib-pv">${line}</span></span></button>`
      + `${after}</div>`;
  }
  // `sent`: the row as Sent draws it (wizard-ux issue 1880, switch wizard/sent-threads): the same row, with its Sent key
  // for the actions sheet's sends and the spinner while it runs.
  // `run`: the row in Inbox › Working (wizard-ux issue 1810), with its spinner.
  function ibThreadRow(s, pin, sent = null, run = false) {
    // An Inbox row has no working mark (wizard-ux issue 1829): a run he started is in Sent › Working, one the agent
    // started is in Inbox › Working (`run`).
    const m0 = actMark(s), m = sent?.working || run ? 'working' : m0 === 'working' ? (actNeeds(s) ? 'needs' : actUnread(s) ? 'new' : '') : m0, f = ibFace(s), unread = m === 'new';
    return ibRow({ key: `row:${esc(s.id)}`, wrap: `${pin ? ' pinned' : ''}${sent ? ' ch-st-wrap' : ''}`, cls: `${unread ? ' unread' : ''}${m === 'needs' ? ' needs' : ''}${sent ? ' ch-st-row' : ''}`, open: `data-chopen="${esc(s.id)}"${sent ? ` data-chsentthread="${esc(sent.key)}"` : ''} aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`, tip: 'Open thread · hold or open the context menu for actions',
      av: f.av, from: esc(f.from), pin, time: esc(ago(LIVE.cardAt(s))), title: esc(s.title || 'New chat'), mark: ibMark(m),
      // A saved, unsent draft says "✎ Draft" ahead of the line (wizard-ux issues 1445, 1604), as every Chats row does.
      line: (typeof draftTag === 'function' ? draftTag(s) : '') + esc(clip(ibLine(s), 160)),
      after: `<button type="button" class="ch-ib-arch" data-chibarch="${esc(s.id)}" aria-label="Archive: ${esc(s.title || 'New chat')}" title="Archive">${IB_ARCH_SVG}</button>` });
  }
  function ibRecRow(r) {
    return ibRow({ key: `ibrec:${esc(r.id)}`, cls: ' needs', open: `data-chrunopen="${esc(r.thread)}"`, tip: 'Open thread', av: ibSig(r.agent),
      from: esc(agentName(r.agent === (AGS()?.defaultId?.() || 'hermes') ? '' : r.agent)), time: esc(r.updatedAt ? ago(new Date(r.updatedAt).toISOString()) : ''),
      title: esc(r.title || 'Background task'), mark: ibMark('needs'), line: `${r.failed ? '<em class="att failed">Failed:</em> ' : ''}${esc(clip(r.ask || '', 160))}`,
      after: `<button type="button" class="ch-ib-arch" data-chibrec="${esc(r.id)}" aria-label="Archive: ${esc(r.title || 'Background task')}" title="Archive">${IB_ARCH_SVG}</button>` });
  }
  /* Plain alert rows (wizard-ux issue 1941, switch wizard/plain-alert-rows, off by default; James, 27 Nov 2026: "they
   * should be normal threads in the inbox that are marked alerts"): a Chats alert (a Notifications item routed to Chats)
   * is the same ibRow as the threads around it: the app's mark or the agent's as the avatar, a small bell before the
   * source name on the label line (the one alert marker), the title, the message as the preview line, the time, the
   * dot and an Archive button. The row button keeps the alert's own attributes, so open, the Alert actions sheet and
   * the folded count work as before. A snoozed (read) alert is a read row, still with the bell. */
  const IB_ALERT = 'wizard/plain-alert-rows';
  function ibAlertOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(IB_ALERT); } catch (_) { return false; } }
  const IB_BELL = '<span class="ch-al-mk" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg></span>';
  // (the alert's title as Chats' own alert rows read it: core/chats-notes.js noteTitle)
  const ibNoteTitle = it => notePlain(it.title) || notePlain(String(it.message || '').split('\n').find(l => l.trim())) || 'Notification';
  function ibNoteRow(it) {
    const later = !!it.read, n = it.group ? it.items.length : 0, from = noteSrcName(it);
    const title = n ? it.items.slice(0, 4).map(ibNoteTitle).join(' · ') : ibNoteTitle(it);
    const line = (it.source === 'cron' && !n ? 'Scheduled job · ' : '') + clip(notePlain(it.message), 160);
    const lbl = `Alert from ${n ? `${from}: ${n} waiting · newest ${ibNoteTitle(it)}` : `${from}: ${ibNoteTitle(it)}`}`;
    const needs = !later && window.WizChatsListModel?.notificationRow?.(it)?.rank === 1, m = later ? '' : needs ? 'needs' : 'new';
    const av = (it.app || it.from) ? `<span class="ch-ib-av ch-al-av" aria-hidden="true">${noteIcon(it)}</span>` : ibSig(AGS()?.defaultId?.() || 'hermes');
    const ids = n ? it.items.map(i => i.id) : [it.id];
    return ibRow({ key: n ? `notifg:${esc(it.group)}:${later ? 'l' : 'a'}` : `notif:${esc(it.id)}`, wrap: ` ch-al-wrap${later ? ' later' : ''}`, cls: ` ch-notif-row${m === 'new' ? ' unread' : ''}${m === 'needs' ? ' needs' : ''}`,
      open: `data-chnotif="${esc(it.id)}"${it.app ? ` data-chnotif-app="${esc(it.app)}"` : ''}${n ? ` data-chnotif-group="${esc(it.group)}"` : ''} aria-label="${esc(clip(lbl, 200))}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`,
      tip: `${n ? 'Open the newest · the rest are listed under it' : 'Open'} · hold or open the context menu for actions`, av, from: `${IB_BELL}${esc(clip(from, 40))}`, time: esc(ago(new Date(noteAt(it)).toISOString())),
      title: esc(clip(title, 160)), mark: `${n ? `<span class="ch-al-n" aria-label="${n} alerts">${n > 99 ? '99+' : n}</span>` : ''}${ibMark(m)}`, line: esc(line),
      after: `<button type="button" class="ch-ib-arch" data-chibnote="${esc(ids.join(' '))}" aria-label="Archive: ${esc(clip(title, 120))}" title="Archive">${IB_ARCH_SVG}</button>` });
  }
  /* The Inbox tab's list body: Working on top (wizard-ux issue 1810: a running thread no Sent row names, one the agent
   * started), then Inbox (pinned first, then threads, waiting tasks and Chats alerts in the one sort), then Snoozed and
   * Archived folded at the bottom as before. A run he started is in Sent › Working (issue 1829). */
  function inboxRowsBody(w, rows, nt, drafts = 0) {
    const L = ibModel(), c = ch(w.id), order = L.activitySortOf(chatVars.readyOrder), fx = ibFacts();
    ibDrawn = new Set();
    const g = L.activityGroups(LIVE.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }, { order, now: Date.now(), inbox: fx, place: window.WizCore.inboxPlace?.() || null });
    const items = g.ready.map(s => ({ id: s.id, s, at: chanAt(s), needs: actNeeds(s), pin: fx.pin(s) }))
      .concat(ibRecs(w, rows).map(r => (ibDrawn.add(r.id), ibKicked.delete(r.id), { id: 'ibrec:' + r.id, r, at: r.updatedAt, needs: true, pin: 0 })))
      .concat((nt?.awake || []).map(v => ({ id: 'notif:' + v.id, n: v, at: noteAt(v), needs: L.notificationRow(v).rank === 1, pin: 0 })));
    const sorted = L.activitySort(items.filter(x => !x.pin), order, { at: x => x.at, needs: x => x.needs });
    const inbox = items.filter(x => x.pin).sort((a, b) => a.pin - b.pin).concat(sorted);
    const snoozed = L.activitySort(g.snoozed.map(v => ({ id: v.id, v, at: chanAt(v) })).concat((nt?.later || []).map(v => ({ id: 'notif:' + v.id, n: v, at: noteAt(v) }))), 'newest', { at: x => x.at });
    const alertRows = ibAlertOn();
    // Sends a graceful restart holds are not live work (wizard-ux issue 1362): not under Working.
    const work = g.working.filter(s => !globalThis.WizReach?.restartHeld?.(s));
    const row = x => x.r ? ibRecRow(x.r) : x.n ? (alertRows ? ibNoteRow(x.n) : noteRow(x.n)) : ibThreadRow(x.s || x.v, x.pin);
    const SEC_PAGE = 50, page = (k, list) => { const shown = c.more?.[k] ? list : list.slice(0, SEC_PAGE); return shown.map(row).join('') + (list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''); };
    // The title bar (wizard-ux issue 1836) names Inbox and carries its count, sort and search: no section row, no fold.
    const ibTitled = c.tbar === 'inbox';
    // Pin to top: a read thread that is here only because it is pinned is not counted (issue 1887).
    const ibSkip = g.counted ? new Set(g.ready.filter(s => !g.counted.includes(s)).map(s => s.id)) : null, inboxN = ibSkip ? inbox.filter(x => !ibSkip.has(x.id)).length : inbox.length;
    if (ibTitled) c.inboxN = inboxN;
    const sec = (k, label, n, inner, open, main = k === 'ready') => ibTitled && main && !work.length ? `<section class="ch-sec ch-act ch-ib ch-tb-main open" data-sec="${k}"><div class="ch-sec-b">${inner()}</div></section>` : `<section class="ch-sec ch-act${main ? ' ch-ib' : ''}${open ? ' open' : ''}" data-sec="${k}">${main ? `<div class="ch-sec-hl"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${n ? `<small>${n}</small>` : ''}<i aria-hidden="true"></i></button>${sortSel}</div>` : `<button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${n ? `<small>${n}</small>` : ''}<i aria-hidden="true"></i></button>`}${open ? `<div class="ch-sec-b">${inner()}</div>` : ''}</section>`;
    const sortSel = `<label class="ch-act-sort"><select data-chactorder aria-label="Sort Inbox">${L.ACTIVITY_SORTS.map(([v, l]) => `<option value="${v}"${order === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    // A box with no chats at all (wizard-ux issue 1731): one deliberate empty state with a way to start a chat.
    const fresh = !(rows || []).length && !(nt?.awake || []).length && !(nt?.later || []).length;
    const empty = fresh ? '<div class="ch-empty ch-act-empty"><b>No chats yet</b><span>Tap + to start one, or tap the orb and talk.</span><button type="button" class="ch-fclear" data-chnew data-chemptynew>New chat</button></div>'
      : '<div class="ch-empty ch-ib-empty"><b>Nothing needs you</b><span>Replies and asks land here. What you sent is in Sent.</span></div>';
    if (!work.length && !inbox.length && !snoozed.length && !g.archive.length) return drafts ? '' : empty;
    return (work.length ? sec('working', 'Working', work.length, () => work.map(s => ibThreadRow(s, 0, null, true)).join(''), chatVars.secOpen.working !== false, false) : '')
      + (inbox.length ? sec('ready', 'Inbox', inboxN, () => page('ready', inbox), chatVars.secOpen.ready !== false) : drafts ? '' : empty)
      + (snoozed.length ? sec('snoozed', 'Snoozed', snoozed.length, () => page('snoozed', snoozed), !!chatVars.secOpen.snoozed) : '')
      + (g.archive.length ? sec('archived', 'Archived', g.archive.length, () => g.archive.slice(0, 200).map(s => ibThreadRowPlain(s)).join(''), !!chatVars.secOpen.archived) : '');
  }
  // Archived rows: the same look without the Archive button.
  function ibThreadRowPlain(s) { return ibThreadRow(s, 0).replace(/<button type="button" class="ch-ib-arch"[^]*?<\/button><\/div>$/, '</div>'); }
  // The row's Archive: a thread archives as from its actions (Undo while it shows); a waiting task archives its record.
  function inboxRowsClick(e, w) {
    if (!w || w.thread) return false;
    const a = e.target.closest('[data-chibarch]');
    if (a) { threadAct(w.id, a.dataset.chibarch, 'done'); return true; }
    // An alert row's Archive (issue 1941): the alert, or every alert in its folded row, as the Alert actions' Archive.
    const nb = e.target.closest('[data-chibnote]');
    if (nb) { const ids = String(nb.dataset.chibnote || '').split(' ').filter(Boolean); if (ids.length && typeof noteRowAct === 'function') void noteRowAct(ids[0], 'done', ids); return true; }
    const r = e.target.closest('[data-chibrec]');
    if (r) {
      const id = r.dataset.chibrec; r.disabled = true;
      Promise.resolve(LIVE.agentInbox?.archive?.(id)).then(() => toast('✓', 'Archived', 1600), () => toast('!', 'Couldn’t archive · it stays in Inbox', 3200))
        .finally(ibRepaintAll);
      return true;
    }
    return false;
  }
  // The list model's inbox facts for a layout that draws its own list (CHATS.inboxRows).
  function inboxRowsFacts() { return ibFacts(); }
  // The row menu's word for a thread's pin (core/chats.js openRowSheet): Pin to top while the switch is on.
  function ibPinWord(pinned) { return pinned ? 'Unpin' : ibPinTopOn() ? 'Pin to top' : 'Pin'; }
  return { ibMark, ibPinTopOn, ibPinWord, ibRow, ibTagFace, ibThreadRow, inboxRowsBody, inboxRowsClick, inboxRowsFacts };
};
