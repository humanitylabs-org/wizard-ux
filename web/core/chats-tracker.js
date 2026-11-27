/* Wizard UX core: Chats › thread tracker, reply summary and Focus: Reply on a message and going to a message (a
 * tracker row, or the header of a quote), the reply summary and quiet-note looks a skin asks for, the Compact list,
 * and the Filter sheet with its Focus options and strip. Moved verbatim out of
 * core/chats.js (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats
 * (core/chats.js) calls this once, where the code used to be, with the closure names it reads, and keeps the
 * functions it returns under their old names. Names chats.js declares only further down are late-bound: chats.js
 * hands them over through bindLate right after it declares them, before anything here can run. Loaded before
 * chats.js by both shells. The body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.tracker = function ({ agentName, agentRec, AGS, byStatus, ch, CH, chanArchived, chanOpen, clip, draftKey, elOf, esc, focusAgents, focusedAgent, focusOf, focusUseful, holdList, KIT, LIVE, matchesFocus, notifOf, owner, pinsOn, refreshReply, rememberedFocus, renderChatList, renderThread, renderThreadLive, renderThreadNow, saveDraft, scrollBox, spaceAgent, spaces, statusEntries, syncDocumentThread, threadViewportTop, toast, toTurns, track, visibleSpaces, W }) {
  let PAGE, PW; // late-bound: chats.js declares these after the call, see bindLate
  /* Thread tracker: Reply on a message, and going to a message (a tracker row, or the header of a quote). */
  function quoteMessage(w, node) {
    if (!w || !node) return;
    const mine = node.classList.contains('u'), mid = node.dataset.mid || '', at = +node.dataset.mat || 0;
    const clone = node.querySelector('.bub')?.cloneNode(true); if (clone) clone.querySelectorAll('.ch-rq, .rsum, .rtools, button, details').forEach(n => n.remove());
    const excerpt = clip(((clone?.textContent) || '').replace(/\s+/g, ' ').trim(), 200) || 'Photo or file';
    const agent = LIVE.agentOf ? LIVE.agentOf(w.thread) : '';
    const item = !mine ? globalThis.WosThreadTracker?.itemFor(w.thread, agent, { message_id: mid, at })?.id || null : null;
    const safe = (mid || String(at)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) || String(at);
    const r = KIT.reply.clean({ key: `quote:${mid ? 'm' : 't'}${safe}`, title: mine ? 'You' : agentName(agent), message: excerpt, quote: { message_id: mid || null, at, item, role: mine ? 'user' : 'assistant' } });
    if (!r) return;
    saveDraft(w.id); KIT.drafts.setReply(draftKey(w), r); refreshReply(w.id);
    elOf(w.id)?.querySelector('.ch-compose textarea')?.focus({ preventScroll: true });
  }
  async function jumpToMessage(wid, a) {
    const w = W[wid]; if (!w || !w.thread || !a) return false;
    const c = ch(wid);
    const exact = t => [t.u, t.a].some(m => m && ((a.message_id && m.id != null && String(m.id) === String(a.message_id)) || (!a.message_id && a.at && Math.abs((m.at || 0) - a.at) < 1500)));
    const find = turns => {
      let i = turns.findIndex(exact);
      if (i < 0 && a.at) { // the nearest reply at or after that moment (an older row id, or a reply that was merged)
        const after = turns.map((t, k) => ({ k, at: t.a?.at })).filter(x => x.at != null && x.at >= a.at - 1500).sort((x, y) => x.at - y.at)[0];
        i = after ? after.k : -1;
      }
      return i;
    };
    let turns = c.turns || [], idx = find(turns);
    if (idx < 0) { // not loaded yet (a long thread, or opened from a link): read the history up to it first
      try { const next = toTurns(await LIVE.messages(w.thread)); const j = find(next); if (j >= 0) { c.turns = turns = next; idx = j; } } catch (_) { /* offline */ }
    }
    if (idx < 0) { toast('!', 'That message is no longer in this thread', 2200); return false; }
    c.showFor = w.thread;
    if ((c.show || PAGE) < turns.length - idx) { c.show = turns.length - idx; const el0 = elOf(wid); if (el0) renderThread(w, el0, true); }
    const t = turns[idx], m = (exact(t) ? [t.u, t.a].find(x => x && ((a.message_id && x.id != null && String(x.id) === String(a.message_id)) || (!a.message_id && a.at && Math.abs((x.at || 0) - a.at) < 1500))) : t.a) || t.u || t.a;
    // A message sent again shows as a "Sent again" line (chats-attach.js), not a .msg bubble.
    const q = m?.id != null && a.message_id ? `:is(.msg, .ch-again)[data-mid="${CSS.escape(String(m.id))}"]` : `:is(.msg, .ch-again)[data-mat="${m?.at}"]`;
    const go = tries => {
      const node = elOf(wid)?.querySelector(q) || (m?.at != null && elOf(wid)?.querySelector(`:is(.msg, .ch-again)[data-mat="${m.at}"]`));
      if (!node) { if (tries > 0) requestAnimationFrame(() => go(tries - 1)); return; }
      // Far away: land there at once (a long smooth scroll hides the highlight); near: glide. Highlight once it has settled.
      const far = Math.abs(node.getBoundingClientRect().top - innerHeight / 2) > innerHeight * 1.5;
      const calm = far || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const nb = node.closest('.ch-msgs'), tracker = globalThis.WosThreadTracker;
      if (nb && tracker?.on() && nb.closest('.ch-thread')?.querySelector('[data-tt-strip]')) {
        const sc = scrollBox(nb), base = sc === nb ? nb.getBoundingClientRect().top : nb.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom;
        sc.scrollTo({ top: sc.scrollTop + node.getBoundingClientRect().top - threadViewportTop(nb, base) - 8, behavior: calm ? 'auto' : 'smooth' });
      } else node.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
      let last = NaN, still = 0, frames = 0;
      const settle = () => { const t = node.getBoundingClientRect().top; still = Math.abs(t - last) < 1 ? still + 1 : 0; last = t; if (still >= 3 || ++frames > 90 || !node.isConnected) globalThis.WosThreadTracker?.flash(elOf(wid)?.querySelector(q) || node); else requestAnimationFrame(settle); };
      requestAnimationFrame(settle);
    };
    requestAnimationFrame(() => go(8));
    return true;
  }
  function replyBubble(r) {
    if (!r) return '';
    const pv = KIT.reply.preview(r, 180);
    if (r.quote) return `<div class="ch-reply ch-reply-q" data-chreply role="group" aria-label="Replying to a message"><span class="ch-reply-t"><b>${esc(clip(r.title || 'Message', 60))}</b>${pv ? `<span>${esc(pv)}</span>` : ''}</span><button type="button" class="ch-reply-x" data-chreplyx aria-label="Remove quoted message from this reply" title="Remove">×</button></div>`;
    return `<div class="ch-reply" data-chreply role="group" aria-label="Replying to a quoted item"><span class="ch-reply-t"><b>${esc(clip(r.title || pv || 'Notification', 120))}</b>${r.title && pv ? `<span>${esc(pv)}</span>` : ''}</span><button type="button" class="ch-reply-x" data-chreplyx aria-label="Remove quoted item from this reply" title="Remove">×</button></div>`;
  }
  // The same item, read back from a sent message: a quiet card above his own words.
  function replyCard(r) {
    if (!r) return '';
    const pv = KIT.reply.preview(r, 180);
    if (r.quote) return `<div class="ch-rq ch-rq-q" role="button" tabindex="0" data-ttjump="${esc(r.quote.message_id || '')}" data-ttjump-at="${r.quote.at || ''}" aria-label="Go to the quoted message"><b>${esc(clip(r.title || 'Message', 60))}</b>${pv ? `<span>${esc(pv)}</span>` : ''}</div>`;
    return `<div class="ch-rq" role="note" aria-label="Reply to a quoted item"><b>${esc(clip(r.title || pv || 'Notification', 120))}</b>${r.title && pv ? `<span>${esc(pv)}</span>` : ''}</div>`;
  }
  function discardDraft(key) { KIT.drafts.clear(key); toast('✕', 'Draft discarded', 1400); }
  // The tracker (or a poll) changed: add or drop the strip and the row dots where they now belong.
  window.addEventListener('wos:thread-tracker', e => {
    const toggled = typeof e?.detail?.enabled === 'boolean';
    for (const wid of Object.keys(CH)) {
      const w = W[wid], el = w && elOf(wid); if (!el) continue;
      if (w.thread) {
        const agent = LIVE.agentOf ? LIVE.agentOf(w.thread) : '';
        if (toggled && e.detail.enabled) globalThis.WosThreadTracker.load(w.thread, agent);
        const oldStrip = el.querySelector('[data-tt-strip]'), html = globalThis.WosThreadTracker.stripHtml(w.thread, agent);
        if (!!oldStrip !== !!html) {
          // Chrome-only paint: never wait on the text-selection/scroll render guard,
          // and never replace the reply or composer under the owner's finger.
          const nb = el.querySelector('.ch-msgs'), root = nb?.closest('.ch-thread');
          if (root) {
            PW?.capture(nb);
            if (oldStrip) oldStrip.remove();
            else root.querySelector('.ch-head')?.insertAdjacentHTML('afterend', html);
            syncDocumentThread();
            PW?.resume(nb); // recompute the shared eye-line in this frame
          }
        }
        if (toggled) renderThreadLive(w);
      } else if (!holdList(wid)) renderChatList(w, el);
    }
  });
  // Changed elsewhere (Settings, another tab): an open notification's picker shows the new choice.
  window.addEventListener('wizard:notify-route', () => { for (const id of Object.keys(CH)) { const x = W[id]; if (x && x.thread === '__new__' && notifOf(x)) renderThreadNow(x); } });

  // Opinionated: Compact list (titles only, no previews), chosen in the Filter sheet, cached per device and persisted by Agent Service.
  const COMPACT_KEY = 'wos.chats.compact.v1';
  // Regenerate sits under the last reply only for a skin (or My skin) that asks: `html[data-skin] { --wos-reply-regenerate: on; }`.
  const regenOn = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-reply-regenerate').trim() === 'on'; } catch (_) { return false; } };
  // Reply summary (off by default): a skin, tweak or My skin that sets `--wos-reply-summary: on` gets every long reply
  // led by its own plain-words ask (the agent's status line) with the full text folded under Details.
  // Quiet notification threads (off by default; the AI apps view asks with `--wos-note-quiet: on`): the source's icon,
  // name and time in the header, the note as the agent's first message, a muted 'From X · shows in Chats ▾' line with
  // the routing choices in a small menu (instead of the segmented control), 'Resolve' in place of 'Resolve this'.
  const noteQuiet = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-note-quiet').trim() === 'on'; } catch (_) { return false; } };
  const summaryOn = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-reply-summary').trim() === 'on'; } catch (_) { return false; } };
  const SUMMARY_WORDS = 120;
  const summaryOf = a => a && a.ask && !a.failed && a.final !== false && summaryOn() && String(a.plainText ?? a.text ?? '').split(/\s+/).filter(Boolean).length > SUMMARY_WORDS ? a.ask : '';
  // The short answer is the toggle: tap it and the full reply takes its place; Show less folds it back. Collapsed unless the
  // owner chose expanded (box-wide, WosSkinHost.replySummary). A tap on one reply wins over that default.
  const summaryStartsOpen = () => window.WosSkinHost?.replySummary?.get().start === 'expanded';
  // The lead reads as a sentence: asks are written chat-list style, often without a final stop.
  const leadText = s => /[.!?…"'”’»]$/u.test(s) ? s : `${s}.`;
  const COG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const CHEV_SVG = '<svg class="rsum-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const setSummaryOpen = (msg, open) => {
    msg.classList.toggle('rsum-open', open);
    const lead = msg.querySelector('.bub > .rsum'), full = msg.querySelector('.bub > .rdet');
    if (lead) lead.hidden = open; if (full) full.hidden = !open;
  };
  // A tweak asked the skin host for Snooze = lowest priority, bottom of Ready (api.nav.snoozeOrder('last'); docs/snooze-last.md).
  const snoozeLast = () => window.WosSkinHost?.snoozeOrder === 'last';
  const compactOn = () => { try { const v = localStorage.getItem(COMPACT_KEY); return v === '1'; } catch (e) { return false; } };
  // `top`: a group drawn first (the Inbox sort while the title bar is on, wizard-ux issue 1836).
  function filterSheet(w, c, top = '') {
    const opt = (k, key, label, on) => `<button type="button" class="ch-fopt${on ? ' on' : ''}" data-chfopt="${k}:${esc(key)}"><i class="ch-fdot ${k === 'status' ? key : 'subject'}"></i>${esc(label)}${on ? '<b>✓</b>' : ''}</button>`;
    return `<div class="ch-fsheet" data-chfsheet><div class="ch-fcard" role="dialog" aria-label="Filter chats"><div class="ch-fh"><b>Filter</b>${c.filter ? '<button type="button" data-chfclear>Clear</button>' : ''}</div>
      ${top}<h5>Status</h5><div class="ch-fopts">${statusEntries().map(([k, f]) => opt('status', k, f.label, c.filter === k)).join('')}</div>
      ${focusSection(w)}
      <h5>View</h5><div class="ch-fopts"><button type="button" class="ch-fopt${compactOn() ? ' on' : ''}" data-chcompact>Compact · titles only${compactOn() ? '<b>✓</b>' : ''}</button><button type="button" class="ch-fopt${pinsOn() ? ' on' : ''}" data-chpins>Pins${pinsOn() ? '<b>✓</b>' : ''}</button></div>
      </div></div>`;
  }
  function focusLabel(w) { const f = focusOf(w); return !f ? 'All' : f.kind === 'agent' ? agentRec(f.key).label : spaces().find(s => s.id === f.key)?.name || 'All'; }
  function listTitle(w) { return focusAgents().length === 1 && focusOf(w)?.kind === 'space' && !(typeof chanOpen === 'function' && chanOpen(w)) ? focusLabel(w) : ''; }
  function syncListTitle(w) {
    const o = W[owner(w.id)] || w;
    AGS()?.setTitlebarLabel(track.querySelector(`[data-win="${o.id}"] [data-agent-titlebar]`), !o.thread ? listTitle(o) : '');
  }
  // One stable option order for strip and Filter; the strip shows the level with a choice.
  function focusOptions() {
    const all = LIVE.unified().filter(s => !s.hidden);
    const stats = (kind, key, label, badge = '') => {
      // A Space counts its explicit members, including ones hydrated beyond the global archive window.
      const members = kind === 'space' && LIVE.spaceSessions ? LIVE.spaceSessions(spaces().find(s => s.id === key)?.threads || [], { peek: true, agent: spaceAgent(spaces().find(s => s.id === key)) }).rows.filter(s => !s.hidden) : null;
      const rows = members || (kind === 'all' ? all : all.filter(s => matchesFocus({ kind, key }, s)));
      // Counts exclude Archive (James, 25 Oct 2026). Unloaded Space members sit beyond the archive window, so they are archived too.
      return { kind, key, label, badge, count: rows.length - LIVE.workGroups(rows).archive.length, unread: LIVE.visibleUnread ? LIVE.visibleUnread(rows).length : rows.filter(s => LIVE.isNew(s)).length,
        recent: rows.reduce((n, s) => Math.max(n, Date.parse(s.activityAt || s.updatedAt || '') || 0), 0) };
    };
    const opts = focusAgents().map(a => stats('agent', a.id, a.label, (AGS()?.sigil(a) || '') + (AGS()?.isPrivate(a) ? AGS().lock() : '')))
      .concat(visibleSpaces().filter(s => !(typeof chanArchived === 'function' && chanArchived(s.id))).map(s => stats('space', s.id, s.name))); // an archived channel leaves the focus chips
    return [stats('all', '', 'All'), ...opts];
  }
  function focusOption(w, o, strip = false) {
    const f = focusOf(w), on = o.kind === 'all' ? !f : strip && o.kind === 'agent' ? focusedAgent(f) === o.key : f?.kind === o.kind && f.key === o.key;
    // A channel is a feed, not a Focus: the tab always names the agent (wizard-ux issue 1340).
    const label = o.label;
    const caret = strip && on && o.kind === 'agent' ? '<i class="ch-focus-caret" aria-hidden="true">⌄</i>' : '';
    return `<button type="button" class="${strip ? 'ch-focus-tab' : 'ch-fopt'}${on ? ' on' : ''}" data-chfocusopt="${o.kind}:${esc(o.key)}" aria-pressed="${on}"${strip && o.kind === 'agent' ? ' aria-haspopup="dialog" aria-expanded="false"' : ''}${strip && o.kind === 'agent' ? ` style="--ch-agent-colour:${AGS()?.colour(agentRec(o.key)) || ''}"` : ''}${strip ? ` aria-label="${esc(label !== o.label ? o.label + ' · ' + label : o.label)}${o.unread ? ` · ${o.unread} unread` : ''}"` : ''}>${o.badge}<span>${esc(label)}</span>${caret}${strip ? o.unread ? '<i class="ch-focus-dot" aria-hidden="true"></i>' : '' : `<small>${o.unread || ''}</small>${on ? '<b>✓</b>' : ''}`}</button>`;
  }
  function focusSection(w) {
    if (!focusUseful()) return '';
    const opts = focusOptions();
    return `<h5>Focus</h5><div class="ch-fopts">${focusOption(w, opts[0])}</div>${opts.filter(o => o.kind === 'agent').map(a => `<div class="ch-focus-group"><div class="ch-fopts">${focusOption(w, a)}</div><div class="ch-fopts ch-space-nested">${opts.filter(o => o.kind === 'space' && spaceAgent(spaces().find(s => s.id === o.key)) === a.key).map(o => focusOption(w, o)).join('')}</div></div>`).join('')}`;
  }
  return { CHEV_SVG, COG_SVG, COMPACT_KEY, compactOn, discardDraft, filterSheet, focusLabel, focusOption, focusOptions, jumpToMessage, leadText, listTitle, noteQuiet, quoteMessage, regenOn, replyBubble, replyCard, setSummaryOpen, snoozeLast, summaryOf, summaryStartsOpen, syncListTitle, bindLate: v => { if ('PAGE' in v) PAGE = v.PAGE; if ('PW' in v) PW = v.PW; } };
};
