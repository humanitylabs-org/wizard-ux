/* Wizard UX core: Chats › shell events the list follows (skin switch, pins, drafts storage full, Snooze and
 * Boomerang), the after-action setting, the Auto-archive picker and the Working order. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.events = function ({ attOf, ch, CH, deferredOf, H, holdList, isWorking, leaveFinishedThread, LIVE, renderThreadNow, toast, topicOn, W }) {
  let renderChats, snoozeLast; // late-bound: chats.js declares these after the call, see bindLate
  // Switching to or from Novairecito swaps topic emojis and status icons without a reload.
  if (typeof MutationObserver === 'function') {
    let wasTopic = topicOn();
    new MutationObserver(() => { const on = topicOn(); if (on === wasTopic) return; wasTopic = on; for (const id of Object.keys(CH)) if (W[id] && !W[id].thread) renderChats(W[id]); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
  }
  // A pin changed here, on another tab, or on another device (pulled through the shared preferences).
  // The device refused to store drafts (storage full): say so, the words stay in the box on screen (issue 1444).
  window.addEventListener('wos:drafts-unsaved', () => toast('!', 'Couldn’t save your draft on this device · storage is full, keep this box open or send it', 4200));
  window.addEventListener('wos:chat-pins', () => { for (const id of Object.keys(CH)) { const w = W[id]; if (w && !w.thread && !holdList(id)) renderChats(w); } });
  // The Snooze toast carries the return time. After-actions (keepThreadOpen) governs send, unread, restore and filing;
  // Archive and Snooze share leaveFinishedThread instead.
  const keepThreadOpen = () => H.keepThreadOpen || window.WizConfig?.chatAfterAction?.() !== 'list';
  window.addEventListener('wos:boomerang-set', e => {
    toast('◷', e.detail.label, 3200);
    leaveSnoozed(e.detail.session);
  });
  window.addEventListener('wos:snooze-someday', e => {
    if (!e.detail.quiet) leaveSnoozed(e.detail.session); // a timed Snooze already left the thread on wos:boomerang-set
    if (!e.detail.quiet) toast('◷', snoozeLast() ? 'Snoozed · bottom of Ready' : 'Snoozed · out of your list', 2400); H.changed?.();
  });
  // Snooze of an open thread lands exactly where Archive does (James, 8 Nov 2026): same leaveFinishedThread, any setting, either shell.
  const leaveSnoozed = sid => { if (sid) for (const id of Object.keys(CH)) leaveFinishedThread(W[id], sid); };
  window.addEventListener('wos:snooze-chosen', e => leaveSnoozed(e.detail.session)); // the commit tap itself, before any request returns
  // A scheduled Snooze was set, changed or came back: list markers, the thread banner and the Ready place follow.
  let boomPaint = 0;
  window.addEventListener('wos:boomerang', () => { clearTimeout(boomPaint); boomPaint = setTimeout(() => { for (const id of Object.keys(CH)) { const w = W[id]; if (!w) continue; if (w.thread) { if (!ch(id).held) renderThreadNow(w); } else if (!holdList(id)) renderChats(w); } }, 60); });
  // Show the exact message a Boomerang was set on: scroll it into the middle and mark it briefly.
  function showBoomMessage(el, at) {
    const m = el?.querySelector(`.ch-msgs [data-boom-at="${CSS.escape(String(at))}"]`); if (!m) return false;
    m.scrollIntoView({ block: 'center' }); m.classList.add('boom-flash'); setTimeout(() => m.classList.remove('boom-flash'), 2400); return true;
  }
  window.addEventListener('wos:prefs-error', () => toast('!', 'Saved on this device only — box preferences unavailable', 4000));
  const waitsOn = s => !window.WizChatsListModel.isListWorking(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)) && (['waiting_for_approval', 'unknown'].includes(s.status) || (!deferredOf(s) && ['needs_you', 'check'].includes(attOf(s)?.state)));
  // Every Sort uses the same row model; By subject orders its rows by Priority.
  const ARCH_OPTS = [[1, '1 day'], [3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month'], [0, 'Never']];
  const archSel = () => { const cur = LIVE.archiveAfterDays; return `<label class="ch-arch-sel">Auto-archive after <select data-archafter>${ARCH_OPTS.map(([d, l]) => `<option value="${d}"${d === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`; };
  // Opinionated: tapping Newest again flips it to Oldest (same button, no fourth option).
  const workingOrdered = list => window.WizChatsListModel.workingSort((list || []).map(s => ({ title: s.title || 'New chat', at: window.WizChatsListModel.workingAt(s, LIVE), value: s })), LIVE.workingOrder?.()).map(r => r.value);
  return { archSel, keepThreadOpen, showBoomMessage, waitsOn, workingOrdered, bindLate: v => { if ('renderChats' in v) renderChats = v.renderChats; if ('snoozeLast' in v) snoozeLast = v.snoozeLast; } };
};
