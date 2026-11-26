/* Wizard UX core: Chats › the Daily view (earlier days, folding a day, Earlier days), channel and Activity unread
 * marks, Activity as a short what-needs-me list and draft marks. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.daily = function ({ agentName, AGS, CH, chanElsewhere, chanNeeds, chanOpen, clip, DAILY_HIST, DAILY_OPEN, dailyOn, dailyPin, dailyState, deferredOf, elOf, esc, holdList, isWorking, KIT, LIVE, renderChatList, renderThread, rowAgent, toTurns, W }) {
  let snoozeLast, turnHtml; // late-bound: chats.js declares these after the call, see bindLate
  const DAILY_FMT = (() => { try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch (_) { return null; } })();
  const dailyDay = day => { const t = Date.parse(day + 'T12:00:00Z'); return DAILY_FMT && isFinite(t) ? DAILY_FMT.format(t) : day; };
  const dailyLine = t => String(t || '').replace(/\s+/g, ' ').trim();
  // One earlier day's history through the normal read (LIVE.messages), kept for this page.
  async function dailyLoad(wid, sid) {
    const h = DAILY_HIST.get(sid); if (h?.busy || h?.turns) return;
    DAILY_HIST.set(sid, { busy: true });
    try { DAILY_HIST.set(sid, { turns: toTurns(await LIVE.messages(sid)) }); }
    catch (e) { DAILY_HIST.set(sid, { err: e?.status === 404 ? 'gone' : 'net' }); }
    const w = W[wid], el = elOf(wid); if (w && w.thread && el && dailyOn(w)) renderThread(w, el, true);
  }
  // What renderThread draws above the open thread (the earlier days) and below it (an empty Today), or null.
  function dailyHtml(w, c) {
    const st = dailyState(w); if (!st) return null;
    const open = DAILY_OPEN.get(w.id) || new Set(), at = st.days.findIndex(d => d.sessionId === w.thread);
    const earlier = (at >= 0 ? st.days.slice(at + 1) : st.days.filter(d => d.sessionId !== w.thread)).slice().reverse();
    const more = st.next ? `<button type="button" class="ch-dday-more" data-chddaymore data-morph-key="dday:more"${st.more ? ' disabled' : ''}>${st.more ? 'Loading earlier days…' : 'Earlier days'}</button>` : '';
    const fold = list => list.map(d => {
      const on = open.has(d.day), h = on ? DAILY_HIST.get(d.sessionId) : null;
      const opener = clip(dailyLine(String(d.opener || '').split('\n').find(l => l.trim()) || '').replace(/[*_`#>]+/g, '').trim(), 90), n = d.count;
      const body = !on ? '' : h?.turns ? `<div class="ch-dday-b">${h.turns.length ? h.turns.map(tn => turnHtml(c, tn, false, false, '', false, false, '')).join('') : '<p class="ch-dday-none">Nothing was said this day.</p>'}</div>`
        : h?.err ? `<div class="ch-dday-b"><button type="button" class="ch-dday-retry" data-chddayretry="${esc(d.day)}">${h.err === 'gone' ? 'This day’s thread is no longer here' : 'Couldn’t load this day · Try again'}</button></div>`
        : '<div class="ch-dday-b"><p class="ch-dday-none" role="status">Loading…</p></div>';
      return `<section class="ch-dday${on ? ' open' : ''}" data-morph-key="dday:${esc(d.day)}"><button type="button" class="ch-dday-h" data-chdday="${esc(d.day)}" aria-expanded="${on}"><b>${esc(dailyDay(d.day))}</b>${opener ? `<span class="ch-dday-o">${esc(opener)}</span>` : ''}<small>${n} ${n === 1 ? 'message' : 'messages'}</small><i aria-hidden="true"></i></button>${body}</section>`;
    }).join('');
    // Before today's first post the open thread is an earlier day's: an empty Today line follows it. A newer day (the
    // view stayed open across the boundary, or another device started it) folds below, never hidden.
    const today = w.thread === '__new__' || (!st.today && at === 0) ? '<div class="ch-day ch-dday-today" data-morph-key="dday:today"><span>Today</span></div>' : '';
    return { above: more + fold(earlier), below: fold(at > 0 ? st.days.slice(0, at).reverse() : []) + today };
  }
  // Taps inside the Daily view: a day's header folds or unfolds it, Earlier days reads the next page.
  function dailyClick(e, id, w) {
    if (!w?.thread || !dailyOn(w)) return false;
    const el = elOf(id), st = dailyState(w);
    const hd = e.target.closest('[data-chdday]');
    if (hd) {
      const day = hd.dataset.chdday, d = st.days.find(x => x.day === day); if (!d) return true;
      const open = DAILY_OPEN.get(id) || new Set(); DAILY_OPEN.set(id, open);
      if (open.has(day)) open.delete(day); else { open.add(day); dailyPin(d.sessionId, w.daily.agent); dailyLoad(id, d.sessionId); }
      if (el) renderThread(w, el, true);
      return true;
    }
    const rt = e.target.closest('[data-chddayretry]');
    if (rt) { const d = st.days.find(x => x.day === rt.dataset.chddayretry); if (d && DAILY_HIST.get(d.sessionId)?.err !== 'gone') { DAILY_HIST.delete(d.sessionId); dailyLoad(id, d.sessionId); if (el) renderThread(w, el, true); } return true; }
    if (e.target.closest('[data-chddaymore]')) { dailyMore(w); return true; }
    return false;
  }
  function dailyMore(w) {
    const d = w?.daily; if (!d || !dailyOn(w)) return;
    Promise.resolve(LIVE.chanDaily.more(d.id)).catch(() => {}).then(() => { const el = elOf(w.id); if (W[w.id] === w && w.daily && el) renderThread(w, el, true); });
  }
  // The top of the Daily view reads older days once Earlier days scrolls into view. Watched against what really scrolls
  // (issue 1882): the thread box, or the page itself in the Android app's document scrolling, where the box never scrolls
  // and a box root saw the button "in view" on every open and re-read the days above the reader.
  function dailyWatch(w, el) {
    const b = el?.querySelector?.('[data-chddaymore]:not([disabled])'); if (!b || typeof IntersectionObserver !== 'function') return;
    if (el._dailyIo) el._dailyIo.disconnect();
    const nb = el.querySelector('.ch-msgs'), oy = nb && typeof getComputedStyle === 'function' ? getComputedStyle(nb).overflowY : '';
    el._dailyIo = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { el._dailyIo.disconnect(); el._dailyIo = null; dailyMore(w); } }, { root: /auto|scroll/.test(oy) ? nb : null });
    el._dailyIo.observe(b);
  }
  // A link to one of Daily's earlier days from inside the Daily view unfolds that day instead of leaving.
  function dailyLinkTo(w, sid) {
    const st = dailyState(w), d = st && sid !== w.thread && st.days.find(x => x.sessionId === sid); if (!d) return false;
    const open = DAILY_OPEN.get(w.id) || new Set(); DAILY_OPEN.set(w.id, open); open.add(d.day);
    dailyLoad(w.id, sid); const el = elOf(w.id); if (el) renderThread(w, el, true);
    requestAnimationFrame(() => elOf(w.id)?.querySelector(`[data-morph-key="dday:${d.day}"]`)?.scrollIntoView?.({ block: 'start' }));
    return true;
  }
  // Unread (wizard-ux issue 1259): the per-chat read state Activity already keeps (LIVE.isNew, synced by thread-seen),
  // never a tracker of its own, so reading a chat in either view clears it in both. A post is unread on the rule an
  // Activity row is bold by (not working; a snoozed-last row waits), and a channel counts unread posts with Activity's
  // own tally (WizChatsListModel.unreadThreads), so the two numbers can never disagree.
  const chanUnread = s => !isWorking(s) && !s.archived && !!LIVE.isNew?.(s) && !(snoozeLast() && deferredOf(s));
  const chanUnreadN = rows => window.WizChatsListModel?.unreadThreads ? window.WizChatsListModel.unreadThreads(rows, chanUnread) : rows.filter(chanUnread).length;
  /* Activity as a short "what needs me" list (wizard-ux issue 1336, the same switch; James, 12 Nov 2026: "Could we put
   * this in the same toggle as the channels"). Three markers, one meaning each, on every surface: the spinner (working),
   * amber (waiting on the owner: stays until it is addressed, the one Needs you rule above) and green (finished and
   * unread: clears when the thread opens, Activity's own read state). Amber wins over green. The purple unread dot goes. */
  const actNeeds = s => !!s && chanNeeds(s);
  const actUnread = s => !!s && chanUnread(s);
  const actMark = s => window.WizChatsListModel.activityMark({ working: isWorking(s), needs: actNeeds(s), unread: actUnread(s) });
  /* Draft marks (wizard-ux issue 1445; on for everyone since issue 1604, it was the wizard/draft-marks switch): an Activity row whose thread has a saved, unsent draft
   * (words, a file or a reply card: KIT.drafts.keys) says "✎ Draft" ahead of its preview, and a Channels line whose box has
   * one wears the same pencil. Shown and cleared live (chat-kit fires wos:drafts-keys when a key gains or loses its draft);
   * rows never move or count differently because of it. */
  const draftAt = k => { try { return !!k && !!KIT.drafts.keys?.().has(k); } catch (_) { return false; } };
  const rowDraft = s => !!s && draftAt('direct:' + s.id);
  // A channel's box key is chanDraftKey's: chan:<the channel's agent, else the list's agent>:<channel id>.
  const chanLineDraft = (c0, ag = '') => !!c0 && draftAt(`chan:${c0.agent || ag || ''}:${c0.id}`);
  const draftTag = s => rowDraft(s) ? '<span class="ch-draft-tag"><span aria-hidden="true">✎</span> Draft</span> · ' : '';
  // The pencil says "Draft" too (wizard-ux issue 1709), as the Activity rows do.
  const chanDraftMark = (c0, ag) => chanLineDraft(c0, ag) ? '<span class="ch-chan-draft" title="Unsent draft"><span aria-hidden="true">✎</span> Draft</span>' : '';
  // The lists repaint when a draft appears or goes. A window drawing a channel's feed (its box is the one being typed in)
  // waits for a channel box's draft; a thread's draft (direct:<id>) repaints it, so its post card follows (issue 1709).
  window.addEventListener?.('wos:drafts-keys', e => {
    const thread = (e?.detail?.keys || []).some(k => String(k).startsWith('direct:'));
    for (const id of Object.keys(CH)) {
      const x = W[id]; if (!x || x.thread || (!thread && chanOpen(x) && !chanElsewhere(x)) || holdList(id)) continue;
      const el = elOf(id); if (el) renderChatList(x, el);
    }
  });
  // A row's marker, drawn just left of its title (wizard-ux issue 1497, James: "move the dots to the left of the title";
  // the one-line phone list has no status icon, so its spinner shows here too). A row with no marker keeps an empty slot
  // of the same width, so titles stay in one column.
  function actRowMark(s) {
    const m = actMark(s);
    return m === 'working' ? '<span class="ch-act-ind"><i class="ch-spin" role="img" aria-label="Working"></i></span>'
      : m === 'needs' ? '<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"></i></span>'
      : m === 'new' ? '<span class="ch-act-ind"><i class="ch-chan-dot new" role="img" aria-label="Unread"></i></span>' : '<span class="ch-act-ind" aria-hidden="true"></span>';
  }
  // A thread of an agent other than the main one names it after its channel ("# WizardOS Chats · Philosopher"): words,
  // never a coloured dot, so it never competes with the status dots. '' for the main agent.
  const agentLabelOf = s => { if (!s) return ''; const a = rowAgent(s); return a && AGS()?.isOther?.(a) ? (typeof agentName === 'function' ? agentName(a) : a) : ''; };
  return { actMark, actNeeds, actRowMark, actUnread, agentLabelOf, chanDraftMark, chanUnread, chanUnreadN, dailyClick, dailyHtml, dailyLinkTo, dailyWatch, draftTag, rowDraft, bindLate: v => { if ('snoozeLast' in v) snoozeLast = v.snoozeLast; if ('turnHtml' in v) turnHtml = v.turnHtml; } };
};
