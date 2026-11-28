/* Wizard UX core: Chats › status marks: the agent's status line for a thread (Needs you, Your call, Done, Snoozed),
 * the shared status icons, loading placeholders and the New chat face. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.status = function ({ agentName, agentRec, AGS, esc, H, handledNow, isWorking }) {
  let snoozeLast; // late-bound: chats.js declares these after the call, see bindLate
  const SEC_PAGE = 40;
  // The agent's status line for a finished thread (live.js attention): what it asks of James.
  const ATT = { needs_you: { cls: 'needs', label: 'Needs you' }, check: { cls: 'check', label: 'Your call' }, done: { cls: 'done', label: 'Done' }, fyi: { cls: 'fyi', label: '' } };
  const deferredOf = s => !!s.deferred && !s.archived && !(Date.parse(s.lastUserAt) > Date.parse(s.deferredAt));
  const attOf = s => (s.attention && (!isWorking(s) || ['needs_you', 'check'].includes(s.attention.state)) && s.status !== 'waiting_for_approval' && s.status !== 'failed' && s.status !== 'interrupted') && !(['needs_you', 'check'].includes(s.attention.state) && typeof handledNow === 'function' && handledNow(s)) ? s.attention : null;
  const svg = b => `<svg viewBox="0 0 24 24" aria-hidden="true">${b}</svg>`;
  const STI = {
    needs: svg('<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
    check: svg('<path d="M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.6a1 1 0 0 0 .9 1.4h12.8a1 1 0 0 0 .9-1.4l-5.1-10.2a2 2 0 0 1-.2-.9V2M8.5 2h7M7 16h10"/>'),
    done: svg('<circle class="f" cx="12" cy="12" r="10"/><path class="k" d="m7.5 12.3 3 3 6-6.3"/>'),
    fyi: svg('<circle class="f" cx="12" cy="12" r="10"/><path class="k" d="M12 11v5.5"/><circle class="kd" cx="12" cy="7.6" r="1.35"/>'),
    deferred: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
    held: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
    approval: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
    failed: svg('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3M12 9v4M12 17h.01"/>'),
    working: '<i class="spin" aria-hidden="true"></i>',
    offline: svg('<path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0"/><path d="m2 2 20 20"/>'),
    none: '<i class="dot" aria-hidden="true"></i>',
  };
  const STI_LAB = { needs: 'Needs you', check: 'Your call', done: 'Done', fyi: 'FYI', deferred: 'Snoozed', approval: 'Needs approval', failed: 'Error' };
  const STI_TIP = { deferred: 'Snoozed', needs: 'Needs you', check: 'Your call: see if it is what you meant', done: 'Done', fyi: 'FYI', approval: 'Approval needed', failed: 'Stopped with an error', working: 'Working', offline: 'Offline · will retry', held: 'Saved · sends after Wizard restarts', none: 'No status' };
  // One status for a thread, shared by its list row and its open header (James, 25 Oct 2026: the open thread shows
  // the same raised hand / tick as its row, so a thread that needs him says so while he reads it).
  function stiKind(s) {

    const working = isWorking(s), needs = ['waiting_for_approval', 'unknown', 'failed', 'interrupted'].includes(s.status);
    // Personal Snooze lowers effective priority, not just list position. Keep the underlying
    // attention/status intact so Restore (or a newer reply) recovers it, including approvals/errors.
    if (snoozeLast() && deferredOf(s) && !working) return 'deferred';
    const def = deferredOf(s) && !working && !needs, at = def ? null : attOf(s);
    // A send a graceful restart holds (wizard-ux issue 1362; WizReach.restartHeld: queued, on its way, or a 202 held
    // for the restart) is saved, not working yet, also while the service is down for the restart itself.
    return working ? (globalThis.WizReach?.restartHeld?.(s) ? 'held' : s.pend === 'waiting' ? 'offline' : 'working') : (s.status === 'failed' || s.status === 'interrupted' || s.queueReason === 'provider_access') && !window.WosErrors?.dismissed?.(s) ? 'failed' : ['waiting_for_approval', 'unknown'].includes(s.status) ? 'approval' : def ? 'deferred' : at ? (at.state === 'needs_you' ? 'needs' : at.state) : 'none';
  }
  const stiBadge = (s, cls = '') => { const k = stiKind(s); return `<span class="emo sti ${k}${cls}" title="${STI_TIP[k]}" aria-label="${STI_TIP[k]}">${STI[k]}</span>`; };
  // Loading placeholders: quiet rows/bubbles shaped like the real ones, with a soft shimmer.
  function skelRows(label) {
    const row = (w1, w2) => `<div class="ch-skel-row"><i class="ch-sk av"></i><span class="bd"><i class="ch-sk" style="width:${w1}%"></i><i class="ch-sk sm" style="width:${w2}%"></i></span></div>`;
    return `<div class="ch-skel" role="status" aria-label="${esc(label)}…">${row(46, 78)}${row(62, 70)}${row(38, 84)}${row(54, 66)}${row(44, 74)}</div>`;
  }
  /* New chat, Miguel's skins only (Obsidian, Obsidian Light, Landscapes; core/chats.css): the agent's mark, a
   * time-of-day greeting and key chips. Every other skin keeps the boxed "New chat" (.nc-classic) unchanged. */
  function newChatHtml(TAG) {
    const hr = (window.WizConfig.dayParts?.() || { h: new Date().getHours() }).h;
    const part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const who = (window.WizConfig.owner?.() || '').split(/\s+/)[0];
    const priv = TAG && AGS()?.isPrivate(agentRec(TAG));
    const hint = H.newChatKeys ? H.newChatKeys.map(k => `<span class="nc-key">${k.keys.map(x => `<kbd>${esc(x)}</kbd>`).join('')}<small>${esc(k.label)}</small></span>`).join('') : `<span class="nc-tip">${esc(H.newChatHint || 'Type below.')}</span>`;
    return `<div class="ch-newchat" role="note"><span class="nc-mark" aria-hidden="true"><i class="sgi ${priv ? 'sg-hat-private' : 'sg-hat'}"></i></span><b class="nc-hi">${esc(part)}${who ? `, ${esc(who)}` : ''}</b><span class="nc-sub">What should ${esc(agentName(TAG))} work on${priv ? ' privately' : ''}?</span><span class="nc-keys">${hint}</span></div>`;
  }
  /* Quick links on a new chat (wizard-ux issue 1965, on for everyone): an ordered list of {label, prompt},
   * drawn right above the message box while the chat is new and empty. One tap sends the prompt as the owner's message
   * (core/chats-bind.js [data-chquick]); "catch me up" runs the built catch-up (wizard-agent-service issue 668) and the
   * Agent Service tells every agent how to answer the other two. Add a chip here. */
  const QUICK_LINKS = [
    { label: 'Catch me up', prompt: 'catch me up' },
    { label: 'What’s waiting on me', prompt: "What's waiting on me?" },
    { label: 'Plan my day', prompt: 'Plan my day' },
  ];
  const quickLinksHtml = () => `<div class="ch-quick" role="group" aria-label="Quick links">${QUICK_LINKS.map(q => `<button type="button" data-chquick="${esc(q.prompt)}">${esc(q.label)}</button>`).join('')}</div>`;
  function skelThread() {
    return `<div class="ch-skel thread" role="status" aria-label="Loading thread…"><i class="ch-sk bub u" style="width:52%"></i><span class="ch-skel-a"><i class="ch-sk" style="width:92%"></i><i class="ch-sk" style="width:84%"></i><i class="ch-sk" style="width:58%"></i></span><i class="ch-sk bub u" style="width:36%"></i><span class="ch-skel-a"><i class="ch-sk" style="width:88%"></i><i class="ch-sk" style="width:64%"></i></span></div>`;
  }
  return { ATT, attOf, deferredOf, newChatHtml, QUICK_LINKS, quickLinksHtml, SEC_PAGE, skelRows, skelThread, STI, STI_LAB, STI_TIP, stiBadge, stiKind, bindLate: v => { if ('snoozeLast' in v) snoozeLast = v.snoozeLast; } };
};
