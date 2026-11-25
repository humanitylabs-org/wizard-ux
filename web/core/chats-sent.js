/* Wizard UX core: Chats › the Sent tab and the bottom tabs Inbox · Tags · Sent (wizard-ux issue 1778, on for
 * everyone; the shell half of wizard-agent-service issue 607). createChats
 * (core/chats.js) calls this once with the closure names it reads. Loaded before chats.js by both shells. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.sent = function ({ ago, ch, CH, CHAN_VIEW_KEY, chanElsewhere, chanSide, chatVars, clip, elOf, esc, H, LIVE, openChat, renderChatList, rerenderList, toast, W, winAgent }) {
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
  function sentHead(w) {
    const st = LIVE.sentLog?.state(), n = st?.ok ? st.rows.filter(r => r.state === 'running').length : 0, f = ch(w.id).sentFilter === 'working' ? 'working' : 'all';
    const pill = (k, label) => `<button type="button" data-chsentfilter="${k}" aria-pressed="${f === k}"${f === k ? ' class="on"' : ''}>${label}</button>`;
    return `<div class="ch-chan-h ch-sent-h" data-morph-key="sent-head"><button type="button" class="ch-chan-back" data-chsentback aria-label="Back to Inbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>Sent</b></div>`
      + `<div class="ch-chan-tabs ch-sent-filter" data-morph-key="sent-filter"><div class="ch-rdy-bar" role="group" aria-label="Show">${pill('all', 'All')}${pill('working', `Working${n ? ` <small>${n}</small>` : ''}`)}</div></div>`;
  }
  function sentBody(w) {
    const st = LIVE.sentLog?.state(), working = ch(w.id).sentFilter === 'working';
    if (!st?.ok) return '<div class="ch-empty">Checking what you sent…</div>';
    if (st.gone) return '<div class="ch-empty">Your Wizard keeps no Sent log yet.</div>';
    const rows = working ? st.rows.filter(r => r.state === 'running') : st.rows;
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
    return false;
  }
  return { sentBack, sentBar, sentBody, sentClick, sentHead, sentOpen, sentTabsOn };
};
