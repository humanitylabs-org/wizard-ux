/* Wizard UX core: Chats › one thread row in a list (its agent, privacy and status marks).
 * Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.rows = function ({ actRowMark, agentLabelOf, ago, AGS, ATT, attOf, BOOM, ch, CH, chanName, channelsLate, chanStore, chanTitle, chatVars, clip, deferredOf, draftTag, esc, feedLate, H, isWorking, KIT, LIVE, paintListsNow, PIN, PIN_SVG, renderThreadNow, rerenderList, STI, STI_LAB, STI_TIP, stiKind, storeAgent, subjectOf, toast, TOPIC, topicOn, W, winAgent }) {
  let snoozeLast, workLabel; // late-bound: chats.js declares these after the call, see bindLate
  // " · Philosopher" after a row's channel for a thread of another agent (issue 1336; tests slice rows without it).
  const agentTail = s => { const l = typeof agentLabelOf === 'function' ? agentLabelOf(s) : ''; return l ? ' · ' + esc(l) : ''; };
  const privRow = s => !chatVars.rowListAgent && !!LIVE.isPrivate?.(s.id);
  function chatRow(s, snip, searchStatus = '') {
    const working = isWorking(s), unread = !working && LIVE.isNew(s), needs = ['waiting_for_approval', 'unknown'].includes(s.status) || s.status === 'failed' || s.status === 'interrupted';
    // Deferred (bottom of Ready): the status reads Deferred in place of Needs you / Your call, then its one line.
    const def = deferredOf(s) && !working && (snoozeLast() || !needs);
    const at = def ? null : attOf(s), A = at && ATT[at.state], quiet = !!at && (at.state === 'done' || at.state === 'fyi');
    // The row icon says what the thread wants from James (replaced the per-thread ✦ star, 10 Oct 2026).
    // Bold means unread once a thread is Ready; Working stays regular even when new activity is accumulating.
    const kind = stiKind(s);
    // The icon's meaning in words, in the icon's colour, at the preview's own weight (James, 10 Oct 2026:
    // "most people won't know what those icons mean … same color as the icon … don't make it any brighter or bolder").
    const lab = s.status === 'unknown' && !def ? '<em class="att approval">Needs recovery:</em> ' : STI_LAB[kind] ? `<em class="att ${kind}">${STI_LAB[kind]}:</em> ` : '';
    // Working rows: no background-helper pill (the spinner already says it) and, with the thread tracker on, no
    // 'Needs you:' line either: the tracker's dots carry the asks (James, 7 Nov 2026). Tracker off keeps the line.
    const inWorking = working || !!window.WizChatsListModel?.isListWorking(s); // a background helper is Working too
    const trackedAsk = inWorking && at && ['needs_you', 'check'].includes(at.state) && !!globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf ? LIVE.agentOf(s.id) : ''); // main agent only
    // The named failure reason (wizard/failure-reason tweak, core/chat-models.js runError) replaces "Error: <your message>".
    // (Smart inbox, wizard-ux issue 1883: a failed thread in Inbox says why, WosModels.smartFail.)
    const rerr = needs && !working ? window.WosModels?.smartFail?.(s) || window.WosModels?.runError?.(s) : null;
    // Issue 1799: the sign-in line and button only while that subscription still reads signed out (WosModels.reconnect).
    const liveRc = window.WosModels?.reconnect ? window.WosModels.reconnect(s) : s.reconnect;
    const pv = trackedAsk ? workLabel(s) + ' · ' + esc(clip((working && s.pendText) || s.preview || '', 110))
      : working && at && ['needs_you', 'check'].includes(at.state) ? `<em class="att ${A.cls}">${A.label}:</em> ` + esc(clip(at.ask, 140)) : liveRc && needs ? esc(liveRc.name) + ' sign-in expired' : rerr ? esc(rerr.line) : working ? workLabel(s) + ' · ' + esc(clip((working && s.pendText) || s.preview || '', 110))
      : needs ? lab + esc(clip(s.preview || '', 110))
      : def ? lab + esc(clip(attOf(s)?.ask || s.preview || '', 140))
      : at ? lab + esc(clip(at.ask, 140))
      : esc(clip(s.preview || '', 110));
    const priv = privRow(s), plock = priv ? `<i class="ch-plock" title="Private agent" aria-label="Private">${AGS()?.lock?.() || ''}</i>` : '';
    const stock = `<span class="emo sti ${kind}" title="${STI_TIP[kind]}" aria-label="${STI_TIP[kind]}">${STI[kind]}</span>`;
    const topic = topicOn() && TOPIC.get(`thread:${s.id}`, [subjectOf(s), s.title, s.preview].filter(Boolean).join(' '));
    const mark = !topic ? stock : `<span class="ch-topic-mark" data-chpick="thread:${esc(s.id)}" title="Choose topic emoji"><span class="ch-topic-emoji" aria-hidden="true">${topic}</span><span class="emo sti ${kind} ch-topic-status" title="${STI_TIP[kind]}" aria-label="${STI_TIP[kind]}">${STI[kind]}</span></span>`;
    const pinned = PIN.has(s.id), boom = BOOM()?.dueFor(s.id).length ? ' due' : BOOM()?.nextFor(s.id) ? ' set' : '';
    return `<div class="ch-row-wrap${liveRc && needs ? ' diagnosed' : ''}${pinned ? ' pinned' : ''}" data-morph-key="row:${esc(s.id)}"><button data-part="thread-row" class="ch-row${unread ? ' unread' : ''}${snip ? ' bodyhit' : ''}${at ? ' att-' + A.cls : ''}${def ? ' deferred' : ''}${priv ? ' private' : ''}" data-chopen="${esc(s.id)}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10" title="Open thread · hold or open the context menu for actions"${quiet ? ' data-quiet="1"' : ''}${priv ? ' data-wiz-private=""' : ''}>${mark}
      <span class="bd"><span class="tp"><b>${plock}${esc(s.title)}</b>${globalThis.WosThreadTracker?.on() ? globalThis.WosThreadTracker.dots(s.id, LIVE.agentOf ? LIVE.agentOf(s.id) : '') : ''}<time>${esc(ago(LIVE.cardAt(s)))}</time></span>
      ${typeof chatVars.rowChan !== 'undefined' && chatVars.rowChan ? `<span class="ch-chan-line">${typeof draftTag === 'function' ? draftTag(s) : ''}${esc(typeof chanTitle === 'function' ? chanTitle(chanName(s)) : '# ' + chanName(s))}${typeof agentTail === 'function' ? agentTail(s) : ''}${rerr?.smart ? ` · <em class="att failed">${esc(rerr.line)}</em>` : ''}</span>` : ''}${snip ? `<span class="pv snip" data-chsnip>${snip.html}</span>` : `<span class="pv">${typeof chatVars.rowChan !== 'undefined' && chatVars.rowChan ? `<span class="ch-chan-tag">${esc(typeof chanTitle === 'function' ? chanTitle(chanName(s)) : '# ' + chanName(s))}${typeof agentTail === 'function' ? agentTail(s) : ''}</span> · ` : ''}${typeof chatVars.rowChan !== 'undefined' && chatVars.rowChan && typeof draftTag === 'function' ? draftTag(s) : ''}${pv}</span>`}${searchStatus ? `<span class="ch-search-status">${esc(searchStatus)}</span>` : ''}</span>${boom ? `<i class="ch-boom${boom}" title="${boom === ' due' ? 'Back for you' : 'Snoozed'}" aria-label="${boom === ' due' ? 'Back for you' : 'Snoozed'}">◷</i>` : ''}${typeof chatVars.rowChan !== 'undefined' && chatVars.rowChan && typeof actRowMark === 'function' ? actRowMark(s) : ''}</button>${liveRc && needs ? `<button type="button" class="ch-row-signin" data-chreconnect="${esc(liveRc.appId)}" data-recovery-run="${esc(liveRc.runId || '')}">Sign in</button>` : ''}${PIN.on?.() !== false ? `<button type="button" data-part="pin-button" class="ch-pin-toggle" data-chpin="${esc(s.id)}" aria-label="${pinned ? 'Unpin' : 'Pin'} chat: ${esc(s.title)}" aria-pressed="${pinned}" title="${pinned ? 'Unpin' : 'Pin'}">${PIN_SVG}</button>` : ''}</div>`;
  }
  /* Agent inbox: Running view, Open / Send to inbox, sweep card, alert feedback; core/chats-running.js. */
  const { alertFeedback, alertsHtml, INBOX_SVG, inboxCanSend, inboxHeadHtml, inboxMove, runningBack, runningBody, runningGo, runningHead, runningOn, runningOpen, runningRow, runningSideGo, sweepAnswer, sweepHtml, sweepLater, sweepYesToAll } = window.WizCore.chatsParts.running({ ago, ch, CH, chanStore, clip, esc, H, KIT, LIVE, paintListsNow, PIN, renderThreadNow, rerenderList, STI, storeAgent, toast, W, winAgent });
  feedLate({ alertsHtml });
  channelsLate({ runningBack });
  /* Ready has three orders (James, 10 Oct 2026): Newest (pure recency, labels don't move rows), Priority
   * (needs you, then test this, then the rest) and By subject (the roundup, kept live). */
  const READY_ORDER_KEY = 'wos.chats.readyOrder.v1', READY_ORDERS = ['newest', 'priority', 'subject'];
  const READY_ORDER_LABEL = { newest: 'Newest', priority: 'Priority', subject: 'By subject' };
  return { alertFeedback, chatRow, INBOX_SVG, inboxCanSend, inboxHeadHtml, inboxMove, READY_ORDER_KEY, READY_ORDER_LABEL, READY_ORDERS, runningBack, runningBody, runningGo, runningHead, runningOn, runningOpen, runningRow, runningSideGo, sweepAnswer, sweepHtml, sweepLater, sweepYesToAll, bindLate: v => { if ('snoozeLast' in v) snoozeLast = v.snoozeLast; if ('workLabel' in v) workLabel = v.workLabel; } };
};
