/* Wizard UX core: Chats › the Sent tab and the bottom tabs Inbox · Tags · Sent (wizard-ux issue 1778, on for
 * everyone; the shell half of wizard-agent-service issue 607). createChats
 * (core/chats.js) calls this once with the closure names it reads. Loaded before chats.js by both shells. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.sent = function ({ ago, ch, CH, CHAN_VIEW_KEY, chanElsewhere, chanSide, chatVars, clip, closeRowSheet, elOf, esc, H, ibMark, ibRow, ibTagFace, ibThreadRow, LIVE, openChat, renderChatList, rerenderList, toast, W, winAgent }) {
  /* The main agent's Chats list gets three tabs at the bottom: Inbox, Tags (the Channels view) and Sent. Sent lists the
   * threads the owner sent into, one row per thread (Sent as threads below), from the box's Sent log (LIVE.sentLog:
   * GET /wizard/v1/sent). A tap opens the thread; the row's actions sheet holds his sends and the two routing
   * corrections (POST /wizard/v1/sent/<id>/correct). Back from Sent returns to Inbox (channelBack). */
  // The tabs: the main agent's own Chats list (phone, Classic desktop and the AI apps sidebar pane, its id::side window
  // whose channels open elsewhere: wizard-ux issue 1807), never a routed agent's list or the main column's feed window.
  function sentTabsOn(w) { return !!w && !winAgent(w) && !!LIVE.sentLog && !(typeof chanSide === 'function' && chanSide(w) && !(typeof chanElsewhere === 'function' && chanElsewhere(w))); }
  function sentOpen(w) { return !!w && !!ch(w.id).sent && sentTabsOn(w); }
  function sentTab(w) { return sentOpen(w) ? 'sent' : chatVars.chanView === 'channels' ? 'tags' : 'inbox'; }
  const TAB_SVG = {
    inbox: '<path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z"/>',
    tags: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
    sent: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  };
  function sentBar(w) {
    const cur = sentTab(w), tab = (k, label) => `<button type="button" role="tab" data-chtab="${k}" aria-selected="${cur === k}"${cur === k ? ' class="on"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_SVG[k]}</svg><span>${label}</span></button>`;
    return `<nav class="ch-tabbar" role="tablist" aria-label="Chats" data-morph-key="tabbar">${tab('inbox', 'Inbox')}${tab('tags', 'Tags')}${tab('sent', 'Sent')}</nav>`;
  }
  const SENT_BUSY = new Set(); // rows with a correction on its way
  /* How a send is described (wizard-ux issue 1814): where it went and what happened, in plain words, for the actions
   * sheet and a thread row whose thread isn't loaded yet. */
  const SR_WHERE = { dump: 'Ran quietly', agent: 'Replied in chat', command: 'Ran as a command', reminder: 'Set a reminder' };
  // The Inbox rows' mark: the spinner while it runs, the amber dot when it needs him or failed (as Inbox marks a failure).
  const SR_MARK = { routing: 'working', running: 'working', needs_you: 'needs', failed: 'needs' };
  const srFirst = r => (r.text.split('\n').find(x => x.trim()) || r.text || '').trim();
  // Where it went, in his words: a reply in a thread he had stays in that chat.
  function srWhere(r) { return r.route === 'thread' ? (r.quiet ? 'Noted in its chat' : 'Replied in its chat') : SR_WHERE[r.route] || 'Just sent'; }
  // Why it went where it went, one plain sentence for the actions sheet.
  const SR_FALLBACK = { router_not_configured: 'deciding isn’t set up on this Wizard', router_timeout: 'deciding took too long', router_error: 'deciding failed', capture_failed: 'it couldn’t start in the background', unsure: 'Wizard wasn’t sure', no_answer: 'no answer came' };
  function srWhy(r) {
    const where = srWhere(r);
    if (r.route === 'thread') return r.quiet && smartOn() ? `${where}: nothing was needed from you, so it stayed out of Inbox.` : r.wantsReply ? `${where} because you asked.` : `${where}.`;
    const first = r.rules[0] || '';
    let why = '';
    if (r.decidedBy === 'owner_words') {
      const said = /^(?:no_reply|wants_reply):(.+)$/.exec(first);
      why = said ? `you said “${said[1]}”` : first === 'typed' ? 'you typed it in a chat' : first === 'new_chat' ? 'you started a new chat' : first === 'greeting' ? 'it was a greeting' : first === 'reminder' ? 'it was a reminder' : first === 'task_verb' ? 'it was a task' : first === 'short_question' ? 'it was a short question' : 'of how you put it';
    } else if (r.decidedBy === 'model') why = 'Wizard judged it from your words';
    else if (r.decidedBy === 'correction') why = 'you corrected one like it before';
    else if (r.decidedBy === 'fallback') { const k = r.rules.find(x => SR_FALLBACK[x]); why = `Wizard couldn’t decide (${k ? SR_FALLBACK[k] : 'no answer came'}), so it took the safe way`; }
    return why ? `${where} because ${why}.` : `${where}.`;
  }
  const SR_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const SR_REPLY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>';
  const SR_QUIET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z"/></svg>';
  // The row's actions sheet (the thread rows' `.ch-sheet` markup): why, Open, and the two corrections.
  function sentSheet(wid, id) {
    const r = LIVE.sentLog?.state()?.rows.find(x => x.id === id), el = elOf(wid);
    if (!r || !el) return false;
    closeRowSheet?.();
    const trigger = Array.from(el.querySelectorAll('[data-chsent]')).find(b => b.dataset.chsent === id) || null;
    const fixed = r.corrected ? (r.corrected.shouldReply ? 'reply' : 'quiet') : '', busy = SENT_BUSY.has(r.id);
    const fix = (k, svg, label) => `<button type="button" data-rssentfix="${k}" aria-pressed="${fixed === k}"${busy ? ' disabled' : ''}>${svg}${label}${fixed === k ? ' · your correction' : ''}</button>`;
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Sent actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(clip(srFirst(r), 120))}</div>`
      + `<p class="ch-sheet-n ch-sr-why">${esc(srWhy(r))}</p><button type="button" data-rssentopen>${SR_OPEN_SVG}Open chat</button>`
      // A reply stays in the thread it was typed in: nothing to move, so no correction. The corrections teach the triage,
      // so they are there only with Smart inbox on (wizard-ux issue 1962).
      + (r.route === 'thread' || !smartOn() ? '' : fix('reply', SR_REPLY_SVG, 'Should have replied') + fix('quiet', SR_QUIET_SVG, 'Didn’t need a reply'))
      + stSendsHtml(stKeyOf(r), false) + '</div></div>');
    chatVars.rowSheet = { wid, sent: id, trigger };
    el.querySelector('.ch-sheet button')?.focus?.({ preventScroll: true });
    return true;
  }
  /* Sent as threads (wizard-ux issue 1880, on for everyone since James's yes, 27 Nov 2026; James, 26 Nov 2026: "The
   * sent box should have the same threads as the inbox. This should look like email, where I can identify the same
   * thread between my inbox and my sent box."). Sent lists threads, not sends: the Sent log grouped by the thread each
   * send ran in (WizChatsListModel.sentThreads), one row per thread drawn by Inbox's own thread row (ibThreadRow: the
   * thread's avatar or tag, its title, its last message, its time, Archive), under Working (it still runs) then
   * Processed. With Smart inbox on, a thread Inbox shows is not here (the one-place rule, placeOf), so it moves between
   * the two and is never in both; off (everyone's default, issue 1962) nothing leaves Inbox and a thread can be in both. A send whose thread isn't loaded yet (a background task's hidden worker, or one still being routed) gets
   * the same row with its task's title, else its words. His sends stay in the thread and in the row's actions sheet
   * ("Sent from you", with the two corrections), never as list rows. Which threads are kept out of Inbox at all is the
   * triage, and that stays behind Smart inbox (below). */
  /* Smart inbox (wizard-ux issue 1883, switch wizard/smart-inbox, off by default): Inbox holds only what blocks him, so
   * every other thread is here, also one with no Sent row (a watch, a schedule, a helper result, a thread older than
   * the log): WizChatsListModel.sentRest adds those, under Working while they run and Processed when done. */
  const SMART_SWITCH = 'wizard/smart-inbox';
  function smartOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(SMART_SWITCH); } catch (_) { return false; } }
  // The send's state in plain words, without "in Inbox": a row here is not in Inbox.
  const ST_STATE = { routing: 'Working', running: 'Working', done: 'Done', needs_you: 'Needs you', failed: 'Failed' };
  function stLine(r) {
    const st = ST_STATE[r.state] || '';
    return `${srWhere(r)}${st ? ' · ' + st : ''}${r.urgent ? ' · Urgent' : ''}${r.corrected ? ' · Corrected' : ''}`;
  }
  const stKeyOf = r => r.thread || (r.record ? 'rec:' + r.record : 'send:' + r.id);
  function stGroups(st) {
    const M = window.WizChatsListModel; if (!M?.sentThreads) return [];
    // Smart inbox off (wizard-ux issue 1962): nothing is routed out of Inbox, so Sent keeps every thread he sent into,
    // also one Inbox shows (a thread can be in both). On: a thread Inbox shows is not here.
    const ids = smartOn() ? window.WizCore?.inboxIds?.(LIVE) || null : null;
    const facts = { session: id => LIVE.session?.(id) || null, working: s => !!M.isListWorking?.(s), at: s => Date.parse(LIVE.cardAt?.(s) || '') || 0 };
    const groups = M.sentThreads(st.rows, ids, facts);
    if (!smartOn() || !M.sentRest || !ids) return groups;
    const rows = (LIVE.sessionsFor ? LIVE.sessionsFor('') : LIVE.unified?.() || []).filter(x => x && !x.hidden);
    const rest = M.sentRest(rows, ids, new Set(groups.map(g => g.thread).filter(Boolean)), { ...facts, held: x => !!globalThis.WizReach?.restartHeld?.(x) });
    return [...groups, ...rest].sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1));
  }
  // A thread's title when its row isn't loaded: its hidden worker's, else its task record's, else his words.
  function stTitle(g) {
    const rec = g.record ? (LIVE.agentInbox?.records?.('hermes') || []).find(x => x?.id === g.record) : null;
    return g.session?.title || rec?.title || srFirst(g.sends[0]) || 'New chat';
  }
  function stRow(g) {
    const s = g.session;
    if (s && !s.hidden && typeof ibThreadRow === 'function') return ibThreadRow(s, 0, { key: g.key, working: g.working });
    // A thread with no Sent row (Smart inbox, issue 1883) opens itself.
    if (!g.sends.length) return s ? ibRow({ key: `sent:${esc(g.key)}`, wrap: ' ch-st-wrap', cls: ' ch-st-row', open: `data-chopen="${esc(s.id)}" data-chsentthread="${esc(g.key)}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`,
      tip: 'Open thread · hold or open the context menu for actions', av: ibTagFace('').av, from: esc(ibTagFace('').from), time: esc(g.at ? ago(g.at) : ''), title: esc(clip(s.title || 'New chat', 120)), mark: ibMark(g.working ? 'working' : ''), line: esc(clip(s.preview || '', 160)) }) : '';
    const r = g.sends[0], m = g.working ? 'working' : SR_MARK[r.state] || '', f = ibTagFace(r.tags[0] || '');
    return ibRow({ key: `sent:${esc(g.key)}`, wrap: ' ch-st-wrap', cls: ` ch-st-row st-${esc(r.state)}${m === 'needs' ? ' needs' : ''}`, open: `data-chsent="${esc(r.id)}" data-chsentthread="${esc(g.key)}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`,
      tip: 'Open thread · hold or open the context menu for actions', av: f.av, from: esc(f.from), time: esc(g.at ? ago(g.at) : ''), title: esc(clip(stTitle(g), 120)), mark: ibMark(m), line: esc(clip(s?.preview || stLine(r), 160)) });
  }
  /* Typed messages (wizard-agent-service issue 669, same switch): one line on how often the box's guess for a typed task
   * matched what he did, and whether typed tasks now run in the background. The numbers are the box's (sent log
   * typed_routing); a box without them shows nothing. */
  function stTyped(st) {
    const t = smartOn() ? st.typed : null;
    if (!t || (!t.judged && !t.on)) return '';
    const pct = t.rate != null ? ` (${Math.round(t.rate * 100)}%)` : '';
    const line = t.on ? `Typed tasks now run in the background: Wizard guessed ${t.matched} of ${t.judged} right${pct}.`
      : `Typed tasks open a chat until Wizard guesses ${Math.round(t.need * 100)}% of ${t.min} right: ${t.matched} of ${t.judged} so far${pct}.`;
    return `<p class="ch-st-typed" data-part="typed-routing" data-on="${t.on ? '1' : '0'}">${esc(line)}</p>`;
  }
  function stBody(st) {
    const groups = stGroups(st), typed = stTyped(st);
    if (!groups.length) return typed + (st.rows.length ? '<div class="ch-empty">Nothing here now. What you sent that needs you is in Inbox.</div>' : '<div class="ch-empty">Nothing sent yet. What you say to the orb, start in a new chat or reply in a thread shows here.</div>');
    const sec = (k, label, list) => {
      if (!list.length) return '';
      const open = chatVars.secOpen?.[k] !== false;
      return `<section class="ch-sec ch-act ch-ib ch-sr ch-st${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${list.length}</small><i aria-hidden="true"></i></button>${open ? `<div class="ch-sec-b">${list.map(stRow).join('')}</div>` : ''}</section>`;
    };
    return typed + sec('sentWorking', 'Working', groups.filter(g => g.working)) + sec('sentProcessed', 'Processed', groups.filter(g => !g.working))
      + (st.next ? '<button type="button" class="ch-more" data-chsentmore>Show older</button>' : '');
  }
  // "Sent from you": the thread's sends, newest first, and the corrections for the newest one that went somewhere.
  function stSendsHtml(key, fixes = true) {
    const st = LIVE.sentLog?.state?.(), rows = (st?.ok ? st.rows : []).filter(r => stKeyOf(r) === key).sort((a, b) => b.at - a.at);
    if (!rows.length) return '';
    const fixable = fixes && smartOn() ? rows.find(r => r.route !== 'thread') : null, busy = fixable && SENT_BUSY.has(fixable.id);
    const fixed = fixable?.corrected ? (fixable.corrected.shouldReply ? 'reply' : 'quiet') : '';
    const fix = (k, svg, label) => `<button type="button" data-rssentfix="${k}" data-id="${esc(fixable.id)}" aria-pressed="${fixed === k}"${busy ? ' disabled' : ''}>${svg}${label}${fixed === k ? ' · your correction' : ''}</button>`;
    return `<div class="ch-st-sends" data-part="sent-sends"><p class="ch-sheet-n">Sent from you · ${rows.length}</p><ul>`
      + rows.slice(0, 20).map(r => `<li data-sentid="${esc(r.id)}"><b>${esc(clip(srFirst(r), 120))}</b><small>${esc(r.at ? ago(r.at) : '')} · ${esc(stLine(r))}</small></li>`).join('') + '</ul>'
      + (fixable ? `<p class="ch-sheet-n ch-sr-why">${esc(srWhy(fixable))}</p>` + fix('reply', SR_REPLY_SVG, 'Should have replied') + fix('quiet', SR_QUIET_SVG, 'Didn’t need a reply') : '') + '</div>';
  }
  // A Sent thread row's actions sheet is the thread's own (rowMenu opens it); this adds its sends under the title.
  function sentSends(wid, key) {
    if (!key) return false;
    const b = elOf(wid)?.querySelector?.('.ch-sheet .ch-sheet-b'), html = stSendsHtml(key);
    if (!b || !html) return false;
    const t = b.querySelector('.ch-sheet-t');
    if (t) t.insertAdjacentHTML('afterend', html); else b.insertAdjacentHTML('afterbegin', html);
    return true;
  }
  // The bottom tabs are the navigation: Sent has no back row and no filter (issues 1814, 1880).
  function sentBody(w) {
    const st = LIVE.sentLog?.state();
    if (!st?.ok) return '<div class="ch-empty">Checking what you sent…</div>';
    if (st.gone) return '<div class="ch-empty">Your Wizard keeps no Sent log yet.</div>';
    return stBody(st);
  }
  function sentGo(w, tab) {
    if (!w) return false;
    if (tab === 'sent') { ch(w.id).sent = true; LIVE.sentLog?.fresh?.(); LIVE.sentLog?.read?.()?.then?.(sentRepaint, () => {}); }
    else {
      ch(w.id).sent = false;
      chatVars.chanView = tab === 'tags' ? 'channels' : 'activity';
      try { localStorage.setItem(CHAN_VIEW_KEY, chatVars.chanView); } catch (_) {}
    }
    rerenderList(w); return true;
  }
  // Back from Sent: Inbox (channelBack calls this first, so phone Back and desktop Esc both land there).
  function sentBack(w) {
    if (!w || w.thread || !ch(w.id).sent) return false;
    const was = sentOpen(w); ch(w.id).sent = false;
    if (!was) return false;
    chatVars.chanView = 'activity';
    try { localStorage.setItem(CHAN_VIEW_KEY, chatVars.chanView); } catch (_) {}
    rerenderList(w); return true;
  }
  // New rows, a state change or a correction repaint every open Sent view in place (scroll kept). The shells' own live
  // repaint skips a list that holds focus, and a tapped tab or button keeps it, so Sent repaints itself.
  function sentRepaint() { for (const id of Object.keys(CH)) { const x = H.win(id), el = x && !x.thread && ch(id).sent && sentOpen(x) ? elOf(id) : null; if (el) renderChatList(x, el); } }
  try { LIVE.onChange?.(() => sentRepaint()); } catch (_) {}
  async function sentFix(id, shouldReply) {
    if (SENT_BUSY.has(id) || !LIVE.sentLog) return;
    SENT_BUSY.add(id); sentRepaint();
    try {
      const { changed } = await LIVE.sentLog.correct(id, shouldReply);
      toast(shouldReply ? '↥' : '↧', !changed ? 'Noted' : shouldReply ? 'In Chats now · it replies there' : 'Sent to the background', 2200);
      if (changed) { LIVE.agentInbox?.fresh?.(); LIVE.refresh?.(); }
    } catch (e) {
      toast('!', e?.status === 409 ? 'Still on its way · try again in a moment' : 'Couldn’t correct it · try again', 3200);
    } finally { SENT_BUSY.delete(id); sentRepaint(); }
  }
  // A row's thread: its own, else (a background task) the one its agent inbox record names.
  async function sentOpenRow(wid, id) {
    const r = LIVE.sentLog?.state().rows.find(x => x.id === id);
    if (!r) return;
    let thread = r.thread;
    if (!thread && r.record) {
      try { const res = await fetch(`/wizard/v1/agent-inbox/${encodeURIComponent(r.record)}`, { cache: 'no-store', credentials: 'same-origin' }); if (res.ok) { const j = await res.json(); thread = (j?.record || j)?.thread_id || null; } } catch (_) {}
    }
    if (typeof thread !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(thread)) { toast('·', 'No thread for this one yet', 2200); return; }
    const w = W[wid]; if (!w || !ch(wid).sent) return; // the owner moved on while it was read
    openChat(wid, thread);
  }
  // The Sent taps; false = not a Sent control.
  function sentClick(e, id, w) {
    if (!w || w.thread) return false;
    const t = e.target.closest('[data-chtab]'); if (t) { sentGo(w, t.dataset.chtab); return true; }
    if (e.target.closest('[data-chsentmore]')) { LIVE.sentLog?.more?.().then(sentRepaint, () => toast('!', 'Couldn’t read older ones', 2400)); return true; }
    // A Sent row whose thread isn't loaded yet opens its chat; its actions sheet's Open and corrections.
    const so = e.target.closest('[data-chsent]'); if (so) { sentOpenRow(id, so.dataset.chsent); return true; }
    // A thread's actions sheet in Sent (issue 1880) names the send it corrects on the button.
    const sf = e.target.closest('[data-rssentfix]'); if (sf && (chatVars.rowSheet?.sent || sf.dataset.id)) { const sid = sf.dataset.id || chatVars.rowSheet.sent; if (!sf.disabled) { closeRowSheet?.(); sentFix(sid, sf.dataset.rssentfix === 'reply'); } return true; }
    if (e.target.closest('[data-rssentopen]') && chatVars.rowSheet?.sent) { const { wid, sent } = chatVars.rowSheet; closeRowSheet?.(); sentOpenRow(wid, sent); return true; }
    return false;
  }
  /* The title bar (wizard-ux issue 1836, on for everyone; James, 25 Nov 2026: "Also remove these, collapse into bar
   * above, change \"all chats\" to Inbox"). The list's own header (.ch-top, the one every shell draws: phone, the Classic
   * desktop panel, a full Chats window) is a title bar naming the bottom tab, Inbox (with its count pill), Tags or Sent,
   * then the search and filter icons; the search field opens under it only while searching or filtering. Inbox has no
   * section row (fold + sort): the sort is in the filter sheet. */
  const TB_TITLE = { inbox: 'Inbox', tags: 'Tags', sent: 'Sent' };
  // The tab this list's title bar names, or '' (not the main agent's tabbed list).
  function titleBarTab(w) {
    return sentTabsOn(w) && !(typeof chanSide === 'function' && chanSide(w)) ? sentTab(w) : '';
  }
  const TB_FIND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const TB_FILT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
  // `n` the Inbox count (its pill), `tools` false on Sent (its log has no search), `searching` the field is open,
  // `filtered` a filter is set, `sheet` the filter sheet is open.
  function titleBar(tab, { n = 0, tools = true, searching = false, filtered = false, sheet = false } = {}) {
    const t = TB_TITLE[tab] || 'Inbox';
    return `<div class="ch-top ch-tbar" data-morph-key="tbar"><h2 class="ch-tbar-t"><span>${t}</span>${tab === 'inbox' && n ? `<small class="ch-tbar-n" aria-label="${n} in ${t}">${n}</small>` : ''}</h2>`
      + (tools ? `<button type="button" class="ch-tbar-b${searching ? ' on' : ''}" data-chtbsearch aria-label="Search chats" aria-pressed="${searching}">${TB_FIND_SVG}</button>`
        + `<button type="button" class="ch-tbar-b ch-fbtn${filtered ? ' on' : ''}" data-chfbtn aria-label="Filter and sort" aria-expanded="${sheet ? 'true' : 'false'}">${TB_FILT_SVG}</button>` : '')
      + '</div>';
  }
  return { sentBack, sentBar, sentBody, sentClick, sentOpen, sentSends, sentSheet, sentTabsOn, titleBar, titleBarTab };
};
