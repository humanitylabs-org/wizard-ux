/* Wizard UX core: Chats › Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows, off by default). With it on,
 * the Inbox tab holds only what needs the owner, drawn as Signal / Telegram chat rows: a round avatar (the first tag's
 * emoji, else the agent's icon), the sender line (the first tag, else the agent's name) with the time, the title with
 * the unread / needs-you mark (no working mark: a run he started is in Sent, issue 1829), and one line of the latest agent message. Each row keeps an Archive button;
 * rows stay until archived (nothing drops into Recent). Today's Daily and anything tagged #priority or said urgent are
 * pinned on top. The box's background tasks that wait on him or failed (agent inbox records, kind needs_you) are rows
 * too: their hidden worker thread opens by id, Archive archives the record. Who belongs here is one pure rule in the
 * list model (WizChatsListModel.inboxWants), so the header count, the badges and the AI apps sidebar agree.
 * createChats (core/chats.js) calls this once with the closure names it reads. Loaded before chats.js by both shells. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.inboxrows = function ({ actMark, actNeeds, actUnread, AGS, agentName, agentRec, ago, attOf, chanAt, chanFace, chanStore, chatVars, ch, clip, elOf, esc, isWorking, LIVE, noteAt, noteRow, PIN, renderChatList, rowAgent, spacesOf, threadAct, toast, W, winAgent }) {
  const IB_SWITCH = 'wizard/inbox-rows';
  function inboxRowsOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(IB_SWITCH); } catch (_) { return false; } }
  // Sent's thread rows (wizard-ux issue 1880) carry the same Archive button.
  // (Smart inbox, wizard-ux issue 1883, shows Sent as threads too.)
  function ibSentThreads() { try { const t = (document.documentElement.dataset.tweaks || '').split(' '); return t.includes('wizard/sent-threads') || t.includes('wizard/smart-inbox'); } catch (_) { return false; } }
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
  /* Pin to top (wizard-ux issue 1887, switch wizard/inbox-pin-top, off by default, with Inbox rows on): the threads in
   * the owner's pin list (core/chat-pins.js: the box's ui-preferences pinnedChats, the same on every device; the row
   * menu's Pin to top writes it, and an agent adds to it with PATCH /wizard/v1/ui-preferences
   * {"ops":[{"op":"add","key":"pinnedChats","item":"<thread id>"}]}) rank above today's Daily, in the order pinned.
   * Null while off, or while Pins are hidden in the Filter sheet. */
  const IB_PIN_TOP = 'wizard/inbox-pin-top';
  function ibPinTopOn() { try { return inboxRowsOn() && (document.documentElement.dataset.tweaks || '').split(' ').includes(IB_PIN_TOP); } catch (_) { return false; } }
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
  // The box's waiting background tasks for this list's agent whose thread is not a row already.
  function ibRecs(w, rows) {
    const listed = new Set((rows || []).filter(s => !s.hidden).map(s => s.id));
    return (LIVE.agentInbox?.needs?.(winAgent(w) || 'hermes') || []).filter(r => !listed.has(r.thread));
  }
  // The shell's count and badges (core/chats-ready.js) read the same rule.
  // (Guarded: tests run slices of createChats in a bare vm without window.)
  try { window.WizCore.inboxRowsFacts = () => inboxRowsOn() ? { ...ibFacts(), extra: rows => ibRecs({}, rows).length } : null; } catch (_) {}
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
  /* The one Signal-style row: Inbox's threads and waiting tasks, and Sent's sends (wizard-ux issue 1814, switch
   * wizard/sent-rows: James, 25 Nov 2026, "let's give the same design to sent"), so the two can't drift apart. Every
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
  function ibThreadRow(s, pin, sent = null) {
    // No working mark in Inbox (wizard-ux issue 1829): a run he started is in Sent › Working, not here.
    const m0 = actMark(s), m = sent?.working ? 'working' : m0 === 'working' ? (actNeeds(s) ? 'needs' : actUnread(s) ? 'new' : '') : m0, f = ibFace(s), unread = m === 'new';
    return ibRow({ key: `row:${esc(s.id)}`, wrap: `${pin ? ' pinned' : ''}${sent ? ' ch-st-wrap' : ''}`, cls: `${unread ? ' unread' : ''}${m === 'needs' ? ' needs' : ''}${sent ? ' ch-st-row' : ''}`, open: `data-chopen="${esc(s.id)}"${sent ? ` data-chsentthread="${esc(sent.key)}"` : ''} aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`, tip: 'Open thread · hold or open the context menu for actions',
      av: f.av, from: esc(f.from), pin, time: esc(ago(LIVE.cardAt(s))), title: esc(s.title || 'New chat'), mark: ibMark(m), line: esc(clip(ibLine(s), 160)),
      after: `<button type="button" class="ch-ib-arch" data-chibarch="${esc(s.id)}" aria-label="Archive: ${esc(s.title || 'New chat')}" title="Archive">${IB_ARCH_SVG}</button>` });
  }
  function ibRecRow(r) {
    return ibRow({ key: `ibrec:${esc(r.id)}`, cls: ' needs', open: `data-chrunopen="${esc(r.thread)}"`, tip: 'Open thread', av: ibSig(r.agent),
      from: esc(agentName(r.agent === (AGS()?.defaultId?.() || 'hermes') ? '' : r.agent)), time: esc(r.updatedAt ? ago(new Date(r.updatedAt).toISOString()) : ''),
      title: esc(r.title || 'Background task'), mark: ibMark('needs'), line: `${r.failed ? '<em class="att failed">Failed:</em> ' : ''}${esc(clip(r.ask || '', 160))}`,
      after: `<button type="button" class="ch-ib-arch" data-chibrec="${esc(r.id)}" aria-label="Archive: ${esc(r.title || 'Background task')}" title="Archive">${IB_ARCH_SVG}</button>` });
  }
  /* The list body with the switch on: Inbox (pinned first, then threads, waiting tasks and Chats alerts in the one sort),
   * then Snoozed and Archived folded at the bottom as before. Working threads that never got an answer are in Sent. */
  function inboxRowsBody(w, rows, nt, drafts = 0) {
    const L = ibModel(), c = ch(w.id), order = L.activitySortOf(chatVars.readyOrder), fx = ibFacts();
    const g = L.activityGroups(LIVE.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }, { order, now: Date.now(), inbox: fx, place: window.WizCore.inboxPlace?.() || null });
    const items = g.ready.map(s => ({ id: s.id, s, at: chanAt(s), needs: actNeeds(s), pin: fx.pin(s) }))
      .concat(ibRecs(w, rows).map(r => ({ id: 'ibrec:' + r.id, r, at: r.updatedAt, needs: true, pin: 0 })))
      .concat((nt?.awake || []).map(v => ({ id: 'notif:' + v.id, n: v, at: noteAt(v), needs: L.notificationRow(v).rank === 1, pin: 0 })));
    const sorted = L.activitySort(items.filter(x => !x.pin), order, { at: x => x.at, needs: x => x.needs });
    const inbox = items.filter(x => x.pin).sort((a, b) => a.pin - b.pin).concat(sorted);
    const snoozed = L.activitySort(g.snoozed.map(v => ({ id: v.id, v, at: chanAt(v) })).concat((nt?.later || []).map(v => ({ id: 'notif:' + v.id, n: v, at: noteAt(v) }))), 'newest', { at: x => x.at });
    const row = x => x.r ? ibRecRow(x.r) : x.n ? noteRow(x.n) : ibThreadRow(x.s || x.v, x.pin);
    const SEC_PAGE = 50, page = (k, list) => { const shown = c.more?.[k] ? list : list.slice(0, SEC_PAGE); return shown.map(row).join('') + (list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''); };
    // The title bar (wizard-ux issue 1836) names Inbox and carries its count, sort and search: no section row, no fold.
    const ibTitled = c.tbar === 'inbox';
    // Pin to top: a read thread that is here only because it is pinned is not counted (issue 1887).
    const ibSkip = g.counted ? new Set(g.ready.filter(s => !g.counted.includes(s)).map(s => s.id)) : null, inboxN = ibSkip ? inbox.filter(x => !ibSkip.has(x.id)).length : inbox.length;
    if (ibTitled) c.inboxN = inboxN;
    const sec = (k, label, n, inner, open, main = k === 'ready') => ibTitled && main ? `<section class="ch-sec ch-act ch-ib ch-tb-main open" data-sec="${k}"><div class="ch-sec-b">${inner()}</div></section>` : `<section class="ch-sec ch-act${main ? ' ch-ib' : ''}${open ? ' open' : ''}" data-sec="${k}">${main ? `<div class="ch-sec-hl"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${n ? `<small>${n}</small>` : ''}<i aria-hidden="true"></i></button>${sortSel}</div>` : `<button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${n ? `<small>${n}</small>` : ''}<i aria-hidden="true"></i></button>`}${open ? `<div class="ch-sec-b">${inner()}</div>` : ''}</section>`;
    const sortSel = `<label class="ch-act-sort"><select data-chactorder aria-label="Sort Inbox">${L.ACTIVITY_SORTS.map(([v, l]) => `<option value="${v}"${order === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const empty = '<div class="ch-empty ch-ib-empty"><b>Nothing needs you</b><span>Replies and asks land here. What you sent is in Sent.</span></div>';
    if (!inbox.length && !snoozed.length && !g.archive.length) return drafts ? '' : empty;
    return (inbox.length ? sec('ready', 'Inbox', inboxN, () => page('ready', inbox), chatVars.secOpen.ready !== false) : drafts ? '' : empty)
      + (snoozed.length ? sec('snoozed', 'Snoozed', snoozed.length, () => page('snoozed', snoozed), !!chatVars.secOpen.snoozed) : '')
      + (g.archive.length ? sec('archived', 'Archived', g.archive.length, () => g.archive.slice(0, 200).map(s => ibThreadRowPlain(s)).join(''), !!chatVars.secOpen.archived) : '');
  }
  // Archived rows: the same look without the Archive button.
  function ibThreadRowPlain(s) { return ibThreadRow(s, 0).replace(/<button type="button" class="ch-ib-arch"[^]*?<\/button><\/div>$/, '</div>'); }
  // The row's Archive: a thread archives as from its actions (Undo while it shows); a waiting task archives its record.
  function inboxRowsClick(e, w) {
    if (!w || w.thread || !(inboxRowsOn() || ibSentThreads())) return false;
    const a = e.target.closest('[data-chibarch]');
    if (a) { threadAct(w.id, a.dataset.chibarch, 'done'); return true; }
    const r = e.target.closest('[data-chibrec]');
    if (r) {
      const id = r.dataset.chibrec; r.disabled = true;
      Promise.resolve(LIVE.agentInbox?.archive?.(id)).then(() => toast('✓', 'Archived', 1600), () => toast('!', 'Couldn’t archive · it stays in Inbox', 3200))
        .finally(() => { for (const x of Object.keys(W)) { const ww = W[x], el = ww && !ww.thread && elOf(x); if (el && el.querySelector?.('.ch-ib')) renderChatList(ww, el); } });
      return true;
    }
    return false;
  }
  // The list model's inbox facts for a layout that draws its own list (CHATS.inboxRows), null with the switch off.
  function inboxRowsFacts() { return inboxRowsOn() ? ibFacts() : null; }
  // The row menu's word for a thread's pin (core/chats.js openRowSheet): Pin to top while the switch is on.
  function ibPinWord(pinned) { return pinned ? 'Unpin' : ibPinTopOn() ? 'Pin to top' : 'Pin'; }
  return { ibMark, ibPinTopOn, ibPinWord, ibRow, ibTagFace, ibThreadRow, inboxRowsOn, inboxRowsBody, inboxRowsClick, inboxRowsFacts };
};
