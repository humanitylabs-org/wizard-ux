/* Wizard UX core: Chats › the Sent tab and the bottom tabs Inbox · Tags · Sent (wizard-ux issue 1778, on for
 * everyone; the shell half of wizard-agent-service issue 607). createChats
 * (core/chats.js) calls this once with the closure names it reads. Loaded before chats.js by both shells. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.sent = function ({ ago, ch, CH, CHAN_VIEW_KEY, chanElsewhere, chanSide, chatVars, clip, closeRowSheet, elOf, esc, H, ibMark, ibRow, ibTagFace, ibThreadRow, LIVE, openChat, renderChatList, rerenderList, toast, W, winAgent }) {
  /* The main agent's Chats list gets three tabs at the bottom: Inbox (today's Activity list, until wizard-ux issue 1779
   * gives it its own rows), Tags (today's Channels view, until wizard-agent-service issue 608) and Sent. Sent lists every
   * capture the owner sent, newest first (LIVE.sentLog: GET /wizard/v1/sent): the first line of his words, when, where
   * it went (Background / Thread / Command / Reminder, or Reply for a message typed in a thread he had, with the
   * agent's one-line answer: wizard-ux issue 1808), its state (running, done, needs you, failed) and why ("you said
   * reply", "model", "your earlier correction", "fallback"). A tap opens the thread it ran in (a hidden worker thread
   * opens by id, as from the Running view); Should have replied / Didn't need a reply correct the routing in place
   * (POST /wizard/v1/sent/<id>/correct). Working is Sent's filter for what still runs; the Running row above Ready goes
   * away. Back from Sent returns to Inbox (channelBack). */
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
  // `thread`: a reply he typed inside a thread he already had (wizard-ux issue 1808).
  const ROUTE = { dump: 'Background', agent: 'Thread', command: 'Command', reminder: 'Reminder', thread: 'Reply' };
  const STATE = { routing: ['Routing', '…'], running: ['Running', ''], done: ['Done', '✓'], needs_you: ['Needs you', '!'], failed: ['Failed', '✕'], unknown: ['', '·'] };
  const FALLBACK = { router_not_configured: 'no router', router_timeout: 'router timed out', router_error: 'router error', capture_failed: 'couldn’t start in the background', unsure: 'model unsure', no_answer: 'no answer' };
  // Why the row went where it went, in a few plain words.
  function sentWhy(r) {
    // A reply: whether his words asked for an answer; a quiet one needed nothing and stayed out of Inbox.
    if (r.route === 'thread') return r.quiet ? 'nothing needed from you' : r.wantsReply ? 'you asked' : '';
    const first = r.rules[0] || '';
    let why = '';
    if (r.decidedBy === 'owner_words') {
      const said = /^(?:no_reply|wants_reply):(.+)$/.exec(first);
      why = said ? `you said ${said[1]}` : first === 'typed' ? 'you typed it' : first === 'new_chat' ? 'a new chat' : first === 'greeting' ? 'a greeting' : first === 'reminder' ? 'a reminder' : first === 'task_verb' ? 'a task' : first === 'short_question' ? 'a short question' : 'your words';
    } else if (r.decidedBy === 'model') why = 'model';
    else if (r.decidedBy === 'correction') why = 'your earlier correction';
    else if (r.decidedBy === 'fallback') { const k = r.rules.find(x => FALLBACK[x]); why = k ? `fallback: ${FALLBACK[k]}` : 'fallback'; }
    return why;
  }
  const BG = new Set(['dump', 'reminder']), SENT_BUSY = new Set(); // SENT_BUSY: rows with a correction on its way
  function sentRow(r) {
    const [label, mark] = STATE[r.state] || STATE.unknown, line = (r.text.split('\n').find(x => x.trim()) || r.text || '').trim();
    const why = sentWhy(r), route = r.route ? ROUTE[r.route] : 'Routing…';
    const would = r.source === 'typed' && r.wouldRoute && (BG.has(r.wouldRoute) !== BG.has(r.route || 'agent')) ? (BG.has(r.wouldRoute) ? 'would have gone to background' : 'would have opened a thread') : '';
    const fixed = r.corrected ? (r.corrected.shouldReply ? 'reply' : 'quiet') : '';
    const busy = SENT_BUSY.has(r.id);
    const tags = r.tags.length ? `<span class="ch-sent-tags">${r.tags.map(t => `#${esc(t)}`).join(' ')}</span>` : '';
    return `<div class="ch-sent-row st-${esc(r.state)}" data-morph-key="sent:${esc(r.id)}"><button type="button" class="ch-sent-open" data-chsentopen="${esc(r.id)}" title="Open the thread it ran in">`
      + `<span class="ch-sent-st" role="img" aria-label="${esc(label || 'State unknown')}" title="${esc(label)}">${r.state === 'running' ? '<i class="ch-spin" aria-hidden="true"></i>' : esc(mark)}</span>`
      + `<span class="bd"><span class="tp"><b>${esc(clip(line, 120))}</b><time>${esc(r.at ? ago(r.at) : '')}</time></span>`
      + `<span class="ch-sent-meta"><span class="ch-sent-route">${esc(route)}</span>${label && r.state !== 'unknown' ? ` · <span class="ch-sent-state">${esc(label)}</span>` : ''}${why ? ` · <span class="ch-sent-why">${esc(why)}</span>` : ''}${r.urgent ? ' · <span class="ch-sent-urgent">urgent</span>' : ''}${tags ? ' · ' + tags : ''}</span>`
      + `${would ? `<span class="ch-sent-would">${esc(would)}</span>` : ''}${r.route === 'thread' && r.answer ? `<span class="ch-sent-answer">${esc(clip(r.answer, 140))}</span>` : ''}</span></button>`
      // A reply stays in the thread it was typed in: nothing to move, so no correction.
      + (r.route === 'thread' ? '' : `<div class="ch-sent-fix" role="group" aria-label="Correct the routing"><button type="button" data-chsentfix="reply" data-id="${esc(r.id)}" aria-pressed="${fixed === 'reply'}"${busy ? ' disabled' : ''}>Should have replied</button><button type="button" data-chsentfix="quiet" data-id="${esc(r.id)}" aria-pressed="${fixed === 'quiet'}"${busy ? ' disabled' : ''}>Didn’t need a reply</button></div>`) + '</div>';
  }
  /* Inbox or Sent (wizard-ux issue 1829; James, 25 Nov 2026: "Things should be in one or the other"): while Inbox keeps
   * threads (inbox-until-archived or Inbox rows), a send whose thread is in Inbox (it needs him, or he asked and it
   * answered) is not listed here; the Inbox list decides (list model placeOf), so the two never both show a thread. */
  function sentRows(st) {
    const ids = window.WizCore?.inboxIds?.(LIVE), M = window.WizChatsListModel;
    return ids && M?.sentShown ? M.sentShown(st.rows, ids) : st.rows;
  }
  /* Sent rows (wizard-ux issue 1814, switch wizard/sent-rows, off by default; James, 25 Nov 2026: "Why is this UX so
   * ugly, vs having a nice UX like the rest of the app", then "let's give the same design to sent"). With it on, each
   * send is drawn by the new Inbox's own row renderer (core/chats-inboxrows.js ibRow, the Signal / Telegram rows), so
   * Inbox and Sent can't drift apart: the avatar and sender line (its first tag, else the agent) with the time, the
   * first line of his words with the working / needs-you mark, then one line in plain words (where it went · what
   * happened). One list with two section headers like Inbox's: Working (running) then Processed (finished); no back
   * row, no filter. The two corrections leave the row: long-press, left swipe, right-click or Shift+F10 open the row
   * actions sheet (ROW_MENU in core/chats-rowacts.js) with why it went where it went, Open, and the two corrections
   * (the same POST /wizard/v1/sent/<id>/correct). Off: the cards above, unchanged. */
  const SR_SWITCH = 'wizard/sent-rows';
  function sentRowsOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(SR_SWITCH); } catch (_) { return false; } }
  const SR_WHERE = { dump: 'Ran quietly', agent: 'Replied in chat', command: 'Ran as a command', reminder: 'Set a reminder' };
  const SR_STATE = { routing: 'Working', running: 'Working', done: 'Done', needs_you: 'Needs you · in Inbox', failed: 'Failed · in Inbox' };
  // The Inbox rows' mark: the spinner while it runs, the amber dot when it needs him or failed (as Inbox marks a failure).
  const SR_MARK = { routing: 'working', running: 'working', needs_you: 'needs', failed: 'needs' };
  const srRunning = r => r.state === 'running' || r.state === 'routing';
  const srFirst = r => (r.text.split('\n').find(x => x.trim()) || r.text || '').trim();
  // Where it went, in his words: a reply in a thread he had stays in that chat.
  function srWhere(r) { return r.route === 'thread' ? (r.quiet ? 'Noted in its chat' : 'Replied in its chat') : SR_WHERE[r.route] || 'Just sent'; }
  // The line under his words: where · what happened [· Urgent] [· Corrected]. Never routing internals.
  function srLine(r) {
    const st = SR_STATE[r.state] || '';
    return `${srWhere(r)}${st ? ' · ' + st : ''}${r.urgent ? ' · Urgent' : ''}${r.corrected ? ' · Corrected' : ''}`;
  }
  // Why it went where it went, one plain sentence for the actions sheet.
  const SR_FALLBACK = { router_not_configured: 'deciding isn’t set up on this Wizard', router_timeout: 'deciding took too long', router_error: 'deciding failed', capture_failed: 'it couldn’t start in the background', unsure: 'Wizard wasn’t sure', no_answer: 'no answer came' };
  function srWhy(r) {
    const where = srWhere(r);
    if (r.route === 'thread') return r.quiet ? `${where}: nothing was needed from you, so it stayed out of Inbox.` : r.wantsReply ? `${where} because you asked.` : `${where}.`;
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
  // One send as an Inbox row (ibRow): no Archive button (a send is not something to archive).
  function srRow(r) {
    const m = SR_MARK[r.state] || '', f = ibTagFace(r.tags[0] || ''); // the main agent's sends
    return ibRow({ key: `sent:${esc(r.id)}`, wrap: ' ch-sr-wrap', cls: ` ch-sr-row st-${esc(r.state)}${m === 'needs' ? ' needs' : ''}`, open: `data-chsent="${esc(r.id)}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10"`,
      tip: 'Open the chat it ran in · hold or open the context menu for actions', av: f.av, from: esc(f.from), time: esc(r.at ? ago(r.at) : ''), title: esc(clip(srFirst(r), 120)), mark: ibMark(m), line: esc(srLine(r)) });
  }
  // Working then Processed, each under Inbox's own section header (folds like Inbox's); an empty one has no header.
  function srBody(st) {
    const sec = (k, label, list) => {
      if (!list.length) return '';
      const open = chatVars.secOpen?.[k] !== false;
      return `<section class="ch-sec ch-act ch-ib ch-sr${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${list.length}</small><i aria-hidden="true"></i></button>${open ? `<div class="ch-sec-b">${list.map(srRow).join('')}</div>` : ''}</section>`;
    };
    const rows = sentRows(st); // (Inbox or Sent, issue 1829: none whose thread is in Inbox)
    return sec('sentWorking', 'Working', rows.filter(srRunning)) + sec('sentProcessed', 'Processed', rows.filter(r => !srRunning(r)))
      + (st.next ? '<button type="button" class="ch-more" data-chsentmore>Show older</button>' : '');
  }
  const SR_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const SR_REPLY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>';
  const SR_QUIET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z"/></svg>';
  // The row's actions sheet (the thread rows' `.ch-sheet` markup): why, Open, and the two corrections.
  function sentSheet(wid, id) {
    const r = LIVE.sentLog?.state()?.rows.find(x => x.id === id), el = elOf(wid);
    if (!r || !el || !(sentRowsOn() || sentThreadsOn())) return false;
    closeRowSheet?.();
    const trigger = Array.from(el.querySelectorAll('[data-chsent]')).find(b => b.dataset.chsent === id) || null;
    const fixed = r.corrected ? (r.corrected.shouldReply ? 'reply' : 'quiet') : '', busy = SENT_BUSY.has(r.id);
    const fix = (k, svg, label) => `<button type="button" data-rssentfix="${k}" aria-pressed="${fixed === k}"${busy ? ' disabled' : ''}>${svg}${label}${fixed === k ? ' · your correction' : ''}</button>`;
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Sent actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(clip(srFirst(r), 120))}</div>`
      + `<p class="ch-sheet-n ch-sr-why">${esc(srWhy(r))}</p><button type="button" data-rssentopen>${SR_OPEN_SVG}Open chat</button>`
      // A reply stays in the thread it was typed in: nothing to move, so no correction (as on the card).
      + (r.route === 'thread' ? '' : fix('reply', SR_REPLY_SVG, 'Should have replied') + fix('quiet', SR_QUIET_SVG, 'Didn’t need a reply'))
      + (sentThreadsOn() ? stSendsHtml(stKeyOf(r), false) : '') + '</div></div>');
    chatVars.rowSheet = { wid, sent: id, trigger };
    el.querySelector('.ch-sheet button')?.focus?.({ preventScroll: true });
    return true;
  }
  /* Sent as threads (wizard-ux issue 1880, switch wizard/sent-threads, off by default; James, 26 Nov 2026: "The sent box
   * should have the same threads as the inbox. This should look like email, where I can identify the same thread
   * between my inbox and my sent box."). With it on, Sent lists threads, not sends: the Sent log grouped by the thread
   * each send ran in (WizChatsListModel.sentThreads), one row per thread drawn by Inbox's own thread row (ibThreadRow:
   * the thread's avatar or tag, its title, its last message, its time, Archive), under Working (it still runs) then
   * Processed. A thread Inbox shows is not here (the one-place rule, placeOf, is on with this switch), so it moves
   * between the two and is never in both. A send whose thread isn't loaded yet (a background task's hidden worker, or
   * one still being routed) gets the same row with its task's title, else its words. His sends stay in the thread and
   * in the row's actions sheet ("Sent from you", with the two corrections), never as list rows. */
  const ST_SWITCH = 'wizard/sent-threads';
  // Smart inbox (wizard-ux issue 1883, switch wizard/smart-inbox) shows Sent as threads too.
  function sentThreadsOn() { try { const t = (document.documentElement.dataset.tweaks || '').split(' '); return t.includes(ST_SWITCH) || t.includes(SMART_SWITCH); } catch (_) { return false; } }
  /* Smart inbox (wizard-ux issue 1883, switch wizard/smart-inbox, off by default): Inbox holds only what blocks him, so
   * every other thread is here, also one with no Sent row (a watch, a schedule, a helper result, a thread older than
   * the log): WizChatsListModel.sentRest adds those, under Working while they run and Processed when done. */
  const SMART_SWITCH = 'wizard/smart-inbox';
  function smartOn() { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(SMART_SWITCH); } catch (_) { return false; } }
  // The send's state in plain words, without "in Inbox": a row here is not in Inbox.
  const ST_STATE = { ...SR_STATE, needs_you: 'Needs you', failed: 'Failed' };
  function stLine(r) {
    const st = ST_STATE[r.state] || '';
    return `${srWhere(r)}${st ? ' · ' + st : ''}${r.urgent ? ' · Urgent' : ''}${r.corrected ? ' · Corrected' : ''}`;
  }
  const stKeyOf = r => r.thread || (r.record ? 'rec:' + r.record : 'send:' + r.id);
  function stGroups(st) {
    const M = window.WizChatsListModel; if (!M?.sentThreads) return [];
    const ids = window.WizCore?.inboxIds?.(LIVE) || null;
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
    const fixable = fixes ? rows.find(r => r.route !== 'thread') : null, busy = fixable && SENT_BUSY.has(fixable.id);
    const fixed = fixable?.corrected ? (fixable.corrected.shouldReply ? 'reply' : 'quiet') : '';
    const fix = (k, svg, label) => `<button type="button" data-rssentfix="${k}" data-id="${esc(fixable.id)}" aria-pressed="${fixed === k}"${busy ? ' disabled' : ''}>${svg}${label}${fixed === k ? ' · your correction' : ''}</button>`;
    return `<div class="ch-st-sends" data-part="sent-sends"><p class="ch-sheet-n">Sent from you · ${rows.length}</p><ul>`
      + rows.slice(0, 20).map(r => `<li data-sentid="${esc(r.id)}"><b>${esc(clip(srFirst(r), 120))}</b><small>${esc(r.at ? ago(r.at) : '')} · ${esc(stLine(r))}</small></li>`).join('') + '</ul>'
      + (fixable ? `<p class="ch-sheet-n ch-sr-why">${esc(srWhy(fixable))}</p>` + fix('reply', SR_REPLY_SVG, 'Should have replied') + fix('quiet', SR_QUIET_SVG, 'Didn’t need a reply') : '') + '</div>';
  }
  // A Sent thread row's actions sheet is the thread's own (rowMenu opens it); this adds its sends under the title.
  function sentSends(wid, key) {
    if (!sentThreadsOn() || !key) return false;
    const b = elOf(wid)?.querySelector?.('.ch-sheet .ch-sheet-b'), html = stSendsHtml(key);
    if (!b || !html) return false;
    const t = b.querySelector('.ch-sheet-t');
    if (t) t.insertAdjacentHTML('afterend', html); else b.insertAdjacentHTML('afterbegin', html);
    return true;
  }
  // `titled`: the title bar (issue 1836) already says Sent, so no back row.
  function sentHead(w, titled = false) {
    if (sentRowsOn() || sentThreadsOn()) return ''; // the bottom tabs are the navigation: no back row, no filter (issues 1814, 1880)
    const st = LIVE.sentLog?.state(), n = st?.ok ? sentRows(st).filter(r => r.state === 'running').length : 0, f = ch(w.id).sentFilter === 'working' ? 'working' : 'all';
    const pill = (k, label) => `<button type="button" data-chsentfilter="${k}" aria-pressed="${f === k}"${f === k ? ' class="on"' : ''}>${label}</button>`;
    return (titled ? '' : `<div class="ch-chan-h ch-sent-h" data-morph-key="sent-head"><button type="button" class="ch-chan-back" data-chsentback aria-label="Back to Inbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>Sent</b></div>`)
      + `<div class="ch-chan-tabs ch-sent-filter" data-morph-key="sent-filter"><div class="ch-rdy-bar" role="group" aria-label="Show">${pill('all', 'All')}${pill('working', `Working${n ? ` <small>${n}</small>` : ''}`)}</div></div>`;
  }
  function sentBody(w) {
    const st = LIVE.sentLog?.state(), working = ch(w.id).sentFilter === 'working';
    if (!st?.ok) return '<div class="ch-empty">Checking what you sent…</div>';
    if (st.gone) return '<div class="ch-empty">Your Wizard keeps no Sent log yet.</div>';
    if (sentThreadsOn()) return stBody(st); // threads, not sends (issue 1880)
    if (sentRowsOn() && st.rows.length && sentRows(st).length) return srBody(st);
    const all = sentRows(st), rows = working ? all.filter(r => r.state === 'running') : all;
    if (!rows.length && !working && st.rows.length) return '<div class="ch-empty">Nothing here now. What you sent that needs you is in Inbox.</div>';
    if (!rows.length) return `<div class="ch-empty">${working ? 'Nothing is running.' : 'Nothing sent yet. What you say to the orb, start in a new chat or reply in a thread shows here.'}</div>`;
    return `<section class="ch-sec open ch-sent" data-sec="sent"><div class="ch-sec-b">${rows.map(sentRow).join('')}</div></section>${st.next && !working ? '<button type="button" class="ch-more" data-chsentmore>Show older</button>' : ''}`;
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
    if (e.target.closest('[data-chsentback]')) { sentBack(w); return true; }
    const f = e.target.closest('[data-chsentfilter]'); if (f) { ch(w.id).sentFilter = f.dataset.chsentfilter === 'working' ? 'working' : 'all'; rerenderList(w); return true; }
    const x = e.target.closest('[data-chsentfix]'); if (x) { if (!x.disabled) sentFix(x.dataset.id, x.dataset.chsentfix === 'reply'); return true; }
    if (e.target.closest('[data-chsentmore]')) { LIVE.sentLog?.more?.().then(sentRepaint, () => toast('!', 'Couldn’t read older ones', 2400)); return true; }
    const o = e.target.closest('[data-chsentopen]'); if (o) { sentOpenRow(id, o.dataset.chsentopen); return true; }
    // Sent rows (issue 1814): a row opens its chat; its actions sheet's Open and corrections.
    const so = e.target.closest('[data-chsent]'); if (so) { sentOpenRow(id, so.dataset.chsent); return true; }
    // A thread's actions sheet in Sent (issue 1880) names the send it corrects on the button.
    const sf = e.target.closest('[data-rssentfix]'); if (sf && (chatVars.rowSheet?.sent || sf.dataset.id)) { const sid = sf.dataset.id || chatVars.rowSheet.sent; if (!sf.disabled) { closeRowSheet?.(); sentFix(sid, sf.dataset.rssentfix === 'reply'); } return true; }
    if (e.target.closest('[data-rssentopen]') && chatVars.rowSheet?.sent) { const { wid, sent } = chatVars.rowSheet; closeRowSheet?.(); sentOpenRow(wid, sent); return true; }
    return false;
  }
  /* The title bar (wizard-ux issue 1836, switch wizard/chats-title-bar, off by default; James, 25 Nov 2026: "Also remove
   * these, collapse into bar above, change \"all chats\" to Inbox"). With it on, the list's own header (.ch-top, the one
   * every shell draws: phone, the Classic desktop panel, a full Chats window) is a title bar naming the bottom tab,
   * Inbox (with its count pill), Tags or Sent, then the search and filter icons; the search field opens under it only
   * while searching or filtering. Inbox's own section row (fold + sort) goes: the sort is in the filter sheet. */
  const TB_SWITCH = 'wizard/chats-title-bar', TB_TITLE = { inbox: 'Inbox', tags: 'Tags', sent: 'Sent' };
  // The tab this list's title bar names, or '' (switch off, or not the main agent's tabbed list).
  function titleBarTab(w) {
    try { if (!(document.documentElement.dataset.tweaks || '').split(' ').includes(TB_SWITCH)) return ''; } catch (_) { return ''; }
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
  return { sentBack, sentBar, sentBody, sentClick, sentHead, sentOpen, sentRowsOn, sentSends, sentSheet, sentTabsOn, sentThreadsOn, titleBar, titleBarTab };
};
