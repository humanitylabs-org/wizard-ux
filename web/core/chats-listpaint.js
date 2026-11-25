/* Wizard UX core: Chats › painting a Chats list and folding its sections.
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
window.WizCore.chatsParts.listpaint = function ({ actAllAgents, activityBody, agentName, agentRec, agoText, AGS, anchorListPlace, androidDocument, archSel, attOf, bindFocusStrip, byStatus, ch, chanComposer, chanElsewhere, chanFeedRows, chanHead, chanHold, channelFeed, channelsBody, chanOpen, chanSide, chatRow, chatVars, clip, compactOn, deferredOf, draftRow, esc, filterSheet, focusedAgent, focusLabel, focusMatches, focusOf, focusStrip, growTa, H, holdListPlace, isWorking, jumpPillsHtml, listPlace, LIVE, matchFilters, newDrafts, norm, notes, OUTBOX, owner, PIN, reachLabel, readyBody, readyOrdered, restoreListPlace, runningBody, runningHead, runningOpen, runningRow, SEC_OPEN_KEY, SEC_PAGE, SECTIONS_DAY, SECTIONS_STATUS, sendPill, sentBar, sentBody, sentHead, sentOpen, sentTabsOn, skelRows, snoozeLast, SPACE, spaceAgent, spaces, STALE_LIST, STATUS, storedListPlace, syncDocumentThread, syncListTitle, track, W, winAgent, workingOrderBar, workingOrdered }) {
  let clearReading, closeStream, elOf, holdList, keptSheet, PW, restoreSheet; // late-bound: chats.js declares these after the call, see bindLate
  function renderChatList(w, el) {
    if (globalThis.WosThreadTracker?.on()) globalThis.WosThreadTracker.loadCounts();
    // A layout which owns the list supplies its own sidebar. Do not paint a
    // second, CSS-covered list underneath it (including a thread returning Back).
    // The AI apps sidebar's Channels pane (wizard-ux issue 1256) is this same list for the main Chats window, drawn
    // into the sidebar as the id::side window: tabs, the channel list, a feed and its box.
    const side = typeof chanSide === 'function' && chanSide(w);
    if (!side) {
      if (H.ownsChatList?.()) { el?.replaceChildren(); return; }
    }
    syncListTitle(w);
    closeStream(ch(w.id));
    if (!el) return;
    if (el.dataset) delete el.dataset.draftFor; // a list holds no thread's box: the next thread paint reads its own draft (issue 1444)
    if (H.renderView?.(w, el, () => renderChatList(w, el), 'list')) return;
    ch(w.id).heldList = false;
    H.threadShown?.(w.id, null); // the list is showing: nothing is bound to this window
    if (typeof actAllAgents === 'function') actAllAgents(w, side); // Activity shows every agent (issue 1336)
    const c = ch(w.id), n = norm(c.q);
    const AGID = winAgent(w), LST = LIVE.statusFor ? LIVE.statusFor(AGID) : { ok: LIVE.ok, error: LIVE.error };
    chatVars.rowListAgent = AGID;
    // (the AI apps sidebar's pane opens its channels in the main column: it never draws a feed, wizard-ux issue 1256)
    // Channels are on for everyone (wizard-ux issue 1258); chanOn is false only where tests slice this renderer without
    // the Channels block.
    const chanOn = typeof chanHead === 'function', feed = chanOn && !(typeof chanElsewhere === 'function' && chanElsewhere(w)) ? chanOpen(w) : null;
    // The main column's feed window draws a feed or nothing (never the tabs or the channel list: those stay in the sidebar).
    if (side && !feed && typeof chanElsewhere === 'function' && typeof H.channelsElsewhere === 'function' && !chanElsewhere(w)) { el.replaceChildren(); return; }
    chatVars.rowChan = chanOn && !feed;
    // The bottom tabs Inbox · Tags · Sent (switch wizard/chats-inbox, wizard-ux issue 1778): the Sent view, and no Running row
    // (Working is Sent's filter while they are on).
    const sentTabs = !side && !feed && typeof sentTabsOn === 'function' && sentTabsOn(w), sentView = sentTabs && sentOpen(w);
    const runView = !side && !sentView && typeof runningOpen === 'function' && runningOpen(w), runRow = !side && !runView && !feed && !sentTabs && typeof runningRow === 'function' ? runningRow(w) : ''; // wizard-ux issue 1569
    if (!AGID) window.WizAppExtensions?.poll();
    const F = c.filter && STATUS[c.filter] ? STATUS[c.filter] : null, focus = focusOf(w);
    const fids = F?.ids ? F.ids(AGID) : null;
    const space = focus?.kind === 'space' ? spaces().find(s => s.id === focus.key) : null;
    const members = space && LST.ok ? LIVE.spaceSessions?.(space.threads, { agent: spaceAgent(space) }) : null;
    const all = (LST.ok ? (members ? members.rows : n && LIVE.searchRows ? LIVE.searchRows(AGID) : LIVE.sessionsFor ? LIVE.sessionsFor(AGID) : LIVE.sessions).filter(s => !s.hidden) : []).filter(s => (!F || (fids ? fids.has(s.id) : F.test(s))) && focusMatches(w, s));
    const filtered = !!(F || focus);
    // The default main-agent Focus is still the owner's inbox. Spaces and other agents are not.
    // Subscribe before the empty-list branch: notifications can be the only Ready rows.
    const listNotes = !n && !F && !AGID && focus?.kind !== 'space' ? notes() : null;
    const listNotesN = listNotes ? listNotes.awake.length + listNotes.later.length : 0;
    const titleHit = n ? all.filter(s => window.WizCore.chatSearch.relevance(s, n).coverage) : all;
    // Message bodies: searched lazily in the background (core/chat-search.js); hits stream in with a snippet.
    // Search is scoped to this window's agent, including routed agents and indexed body-only rows.
    const BS = window.WizCore.chatSearch, queryAt = c.q, searchNav = c.readNav;
    const bs = n && BS ? BS.query(w.id, queryAt, () => {
      const current = W[w.id], e2 = elOf(w.id); if (current && !current.thread && winAgent(current) === AGID && c.readNav === searchNav && e2 && ch(w.id).q === queryAt && e2.querySelector('.ch-list') && !holdList(w.id)) renderChatList(w, e2);
    }, AGID) : null;
    if (!n && BS) BS.cancel(w.id);
    const snips = bs ? bs.hits : new Map();
    const seen = new Set(titleHit.map(s => s.id));
    const hit = titleHit.concat(all.filter(s => !seen.has(s.id) && snips.has(s.id)));
    const hitIds = new Set(hit.map(s=>s.id));
    for (const s of bs?.rows?.values() || []) if (!hitIds.has(s.id) && !s.hidden && (!F || (fids ? fids.has(s.id) : F.test(s))) && focusMatches(w, s)) { hit.push(s); hitIds.add(s.id); }
    // Pinned live chats get one fixed section at the top (archived pins stay in Archive); search and filters still
    // decide which rows are eligible first.
    const split = n ? { pinned: [], rest: hit } : PIN.partition(hit, s => !s.archived && !(snoozeLast() && deferredOf(s))), pinnedRows = split.pinned;
    const groups = LIVE.workGroups(split.rest);
    // Sends a graceful restart holds get their own Saved heading, never counted as Working (wizard-ux issue 1362).
    const heldRow = s => !!globalThis.WizReach?.restartHeld?.(s);
    if (groups.working?.some(heldRow)) { groups.saved = groups.working.filter(heldRow); groups.working = groups.working.filter(s => !heldRow(s)); }
    // SEARCH_RELEVANCE (chat-search.js): coverage → relevance × bounded recency; Archive/pins are neutral.
    const ranked = n ? BS.rank(hit, n, LIVE.cardAt, snips) : [];
    // Reuse groupWork's classification (including automatic Archive and snooze), not a second status policy.
    const searchLabels = { errors: 'Error', working: 'Working', saved: 'Saved', ready: 'Ready', yesterday: 'Ready', pastWeek: 'Ready', deferred: 'Snoozed', archive: 'Archive' };
    const searchStatus = new Map(n ? Object.entries(groups).flatMap(([k, rows]) => rows.map(s => [s.id, k !== 'archive' && deferredOf(s) && !isWorking(s) ? 'Snoozed' : searchLabels[k]])) : []);
    const hitCount = () => hit.length;
    const coachLine = () => c.coach ? '<span class="ch-coach">Filtered. Tap ✕ to see all chats.</span>' : '';
    const ownerId = owner(w.id), curThread = W[ownerId]?.thread;
    const drafts = focus ? [] : newDrafts().filter(d => !n || norm(d.text).includes(n));
    c.more = c.more || {};
    const chip = (k, label) => `<span class="ch-chip ${k}" data-chchip="${k}"><i class="ch-fdot ${k === 'status' ? c.filter : 'subject'}"></i>${esc(label)}<button type="button" data-chchipx="${k}" aria-label="Remove filter ${esc(label)}">✕</button></span>`;
    const chips = (F ? chip('status', F.label) : '');
    const ph = filtered ? 'Search within' : 'Search chats and messages';
    const head = side ? chanHead(w, feed) : `<div class="ch-top"><label class="ch-search${filtered ? ' has-chips' : ''}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>${chips}<input data-chsearch placeholder="${ph}" aria-label="Search chats and messages" value="${esc(c.q)}" enterkeyhint="search" spellcheck="false">${c.q ? '<button type="button" class="ch-sclear" data-chsclear aria-label="Clear search">×</button>' : ''}<button type="button" class="ch-fbtn${filtered ? ' on' : ''}" data-chfbtn aria-label="Filter chats" aria-expanded="${c.sheet ? 'true' : 'false'}"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg></button></label>${AGID ? '' : (window.WosBell?.html?.() || '')}</div>`
      // Switching Focus (agent/Space) never pushes the list down with a count line (James, 25 Oct 2026); only a status filter says how many matched.
      + (chanOn ? chanHead(w, feed) : '')
      + (F && LIVE.ok ? `<div class="ch-count">${hitCount()} ${hitCount() === 1 ? 'chat' : 'chats'}${coachLine()}</div>` : '');
    // Suggestions while typing (or focused on an empty field): filters that match the words, then a new chat.
    const sug = !c.sugOff && (c.q || c.focus) ? matchFilters(c.q, 3).filter(f => !(f.kind === 'status' && f.key === c.filter) && !(f.kind === focus?.kind && f.key === focus.key)) : [];
    // Filter suggestions only. New chat lives in one place, the bottom-right button (James, 24 Oct 2026: no second New chat in search).
    const sugHtml = sug.length ? `<div class="ch-sug">${sug.map(f => `<button type="button" class="ch-sugrow" data-chsug="${f.kind}:${esc(f.key)}"><span class="ch-sugic">⌯</span><span>Filter: <b>${esc(f.label)}</b></span></button>`).join('')}</div>` : '';
    let body;
    const draftSec = drafts.length ? `<section class="ch-sec open" data-sec="drafts"><div class="ch-sec-h static"><span>Drafts</span><small>${drafts.length}</small></div><div class="ch-sec-b">${drafts.map(d => draftRow(d, d.key === 'new' && curThread === '__new__')).join('')}</div></section>` : '';
    // Messages still on the phone (the window went back to the list on send), new chats and replies: shown until
    // Wizard takes them. Local recovery is independent of list/search/server availability.
    const outNew = OUTBOX ? OUTBOX.unsent().filter(it => OUTBOX.isMessage(it) && (it.agent || '') === AGID && (it.kind === 'new' || it.kind === 'reply')) : [];
    // A message still leaving the phone already shows as its thread's "Sending…" row in Working; the pill is only
    // for trouble (offline / not sent) or a thread that isn't in the list.
    const pill = sendPill(outNew.filter(it => ['failed', 'waiting', 'unconfirmed'].includes(it.state) || (it.state === 'held' && it.lateHeld) || OUTBOX?.quarantined(it.id) || !LIVE.session(it.sessionId)), w);
    // Everything else still on the phone (orb commands and dictation, held takes, side-button takes): one row at the
    // top, the only Chats-side sign of something that could be lost. It replaces the old notifications panel's Unsent.
    const others = !AGID && H.openUnsent && window.WosSettings?.unsentAll ? window.WosSettings.unsentAll({ outbox: OUTBOX }).filter(it => !(it.origin === 'app' && (it.kind === 'new' || it.kind === 'reply'))) : [];
    const otherFail = others.filter(it => ['failed', 'empty', 'unconfirmed'].includes(it.state)).length;
    const unsentRow = others.length ? `<button type="button" class="ch-unsent${otherFail ? ' fail' : ''}" data-chunsent><span class="pip"></span><span class="tx"><b>${others.length === 1 ? '1 voice take' : others.length + ' voice takes'} ${otherFail ? 'not sent' : 'waiting to send'}</b><small>${esc(clip(others[others.length - 1].recoveryText || others[others.length - 1].text || 'Voice note', 60))}</small></span><span class="go">View</span></button>` : '';
    if (false) {}
    else if (!LST.ok && !LST.error) body = draftSec + skelRows(AGID ? `Connecting to ${agentName(AGID)}` : 'Connecting to Wizard');
    else if (!LST.ok) body = draftSec + `<div class="ch-empty">${esc(window.WizReach?.failure().message || 'Checking the connection to Wizard…')}</div>`;
    // Channels: the live window only (James, 9 Nov 2026: older chats are reached by asking the agent).
    else if (feed && !n && !F) { const live = new Set((LIVE.sessionsFor ? LIVE.sessionsFor(AGID) : LIVE.sessions).map(s => s.id)), mine = all.filter(s => live.has(s.id)); body = channelFeed(w, feed, typeof chanFeedRows === 'function' ? chanFeedRows(feed, mine) : mine); }
    else if (chanOn && chatVars.chanView === 'channels' && !n && !F) body = channelsBody(w, all);
    // Activity as a short what-needs-me list (issue 1336): Working, Ready, Recent, then folded Snoozed and Archived.
    else if (chanOn && !side && !feed && !n && !F && typeof activityBody === 'function') body = draftSec + activityBody(w, all, listNotes, drafts.length);
    else if (focus?.kind === 'space' && !hit.length && !n && !F) body = `<div class="ch-empty">${esc(agentRec(focusedAgent(focus)).label)} is filling this ${SPACE.ch ? 'channel' : 'Space'}…</div>`;
    else if (AGID && !all.length && !n && !F) body = `<div class="ch-empty"><b>No chats with ${esc(agentName(AGID))} yet</b><br><button type="button" class="ch-fclear" data-chnew data-chemptynew>Start a new chat</button><br> ${agentRec(AGID).privacy === 'private' ? 'They stay with this agent: the main agent can’t search or read them.' : 'They stay in this agent’s chats.'}</div>`;
    else if (filtered && !hit.length && !listNotesN) body = `<div class="ch-empty">${n ? 'No chats match' : F ? F.empty : `No chats in ${esc(focusLabel(w))}`}<br><button type="button" class="ch-fclear" ${n || F ? 'data-chfclear' : 'data-chfbtn'}>${n || F ? 'Clear filter' : 'Change focus'}</button></div>`;
    else if (!hit.length && !drafts.length && !listNotesN) body = `<div class="ch-empty">${bs && (bs.busy || bs.scanned < Math.min(bs.want, bs.total || 0)) ? `No titles match “${esc(c.q)}” · searching messages…` : `No threads match “${esc(c.q)}”.`}</div>`;
    else if (n) {
      const shown = c.more.search ? ranked : ranked.slice(0, SEC_PAGE);
      body = `<div class="ch-search-results" data-search-results="flat">${filtered ? '' : drafts.map(d => draftRow(d, d.key === 'new' && curThread === '__new__')).join('')}${shown.map(s => chatRow(s, snips.get(s.id), searchStatus.get(s.id))).join('')}${ranked.length > shown.length ? `<button class="ch-more" data-secmore="search">Show all ${ranked.length}</button>` : ''}</div>`;
    }
    else body = (filtered ? '' : draftSec)
      + (pinnedRows.length ? `<section class="ch-sec ch-pinned open" data-sec="pinned"><div class="ch-sec-h static"><span>Pinned</span><small>${pinnedRows.length}</small></div><div class="ch-sec-b">${pinnedRows.map(s => chatRow(s, n ? snips.get(s.id) : null)).join('')}</div></section>` : '')
      + (byStatus() ? SECTIONS_STATUS : SECTIONS_DAY).map(([k, label]) => {
      const list0 = PW && k === 'errors' ? PW.errorsFilter(groups[k]) : groups[k] || [];
      // Ready's order is chosen before paging, so Priority never pages a needs-you row out of the first page.
      const dayOrdered = !n && (k === 'ready' || (!byStatus() && (k === 'yesterday' || k === 'pastWeek')));
      const list = k === 'working' ? workingOrdered(list0) : dayOrdered ? readyOrdered(list0) : k === 'archive' && !n && !filtered && Object.keys(LIVE.windows || {}).length ? list0.slice(0,50) : list0;
      // Errors also holds failed background work and voice notes that didn't send (chat-power.js #12).
      const extra = PW && k === 'errors' && !n ? PW.errorsExtra() : { n: 0, html: '' };
      const nt = k === 'ready' ? listNotes : null, notesN = nt ? nt.awake.length + nt.later.length : 0;
      // An empty section is drawn only where it carries a slot another part fills (Ready's and Archive's tops on the
      // main list); never a header over a bare "None" (wizard-ux issue 1731).
      const slots = (k === 'ready' || k === 'archive') && !n && !filtered && !AGID;
      if (!list.length && !extra.n && !notesN && !slots) return '';
      // While searching, every section with a hit opens so nothing is buried.
      const open = n ? true : chatVars.secOpen[k];
      // Counts are unread only (James, 8 Nov 2026): a finished thread already read adds nothing, so Ready is never an inventory.
      // Working, Snoozed and Archive keep their place counts; they are not messages waiting.
      const unreadSec = k === 'errors' || k === 'ready' || k === 'yesterday' || k === 'pastWeek';
      const secN = unreadSec ? window.WizChatsListModel.unreadThreads(list, s => LIVE.isNew(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)), nt?.awake) : list.length + extra.n + notesN;
      const waitN = !byStatus() && (k === 'ready' || k === 'yesterday' || k === 'pastWeek') ? list.filter(s => !window.WizChatsListModel.isListWorking(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)) && (['waiting_for_approval', 'unknown'].includes(s.status) || (!deferredOf(s) && attOf(s)?.state === 'needs_you'))).length : 0;
      const windowMeta = AGID ? LIVE.windows?.[AGID] : Object.values(LIVE.windows || {}).length ? {archiveTotal:Object.values(LIVE.windows).reduce((n,x)=>n+(x.archiveTotal||0),0)} : null;
      const archiveNote = k === 'archive' && !n && !filtered && windowMeta ? `<span class="ch-none">Newest ${list.length} of ${windowMeta.archiveTotal} · search to find older chats</span>` : '';
      const shown = c.more[k] ? list : list.slice(0, SEC_PAGE);
      return `<section class="ch-sec${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${secN ? `<small>${secN}</small>` : ''}${waitN ? `<b class="wait">${waitN} need you</b>` : ''}<i aria-hidden="true"></i></button>
        ${open ? `<div class="ch-sec-b">${k === 'working' && list.length ? workingOrderBar() : ''}${k === 'archive' && !n && !filtered && !AGID ? '<div data-slot="archive-top"></div>' : ''}${k === 'archive' && !n && !filtered ? archSel() : ''}${archiveNote}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-top"></div>' + (window.WizAppExtensions?.html() || '') : ''}${list.length || extra.n || notesN ? (k === 'errors' && PW ? shown.map(s => PW.errorRow(s, chatRow(s, n ? snips.get(s.id) : null))).join('') + extra.html : dayOrdered ? readyBody(shown, s => chatRow(s, null), nt, k) : shown.map(s => chatRow(s, n ? snips.get(s.id) : null)).join('')) : ''}${list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-end"></div>' : ''}</div>` : ''}</section>`;
    }).join('');
    if (runView) body = runningBody();
    if (sentView) body = sentBody(w);
    // Progress sits above the results (James, 25 Oct 2026: it was hidden below a long Archive); the final line stays under them.
    if (bs && LST.ok) body = BS.scanning(bs) || bs.busy ? BS.footer(bs) + body : body + BS.footer(bs);
    if (side && !feed && chatVars.chanView !== 'channels') body = ''; // Activity: the tabs only; the sidebar draws its own rows
    // An unlanded return bookmark outranks the scroller's own reading: that reading is the 0 it fell to.
    // A fresh page has no scroller yet: fall back to the place this list last saved (once per page per window).
    const fresh = !el.querySelector('.ch-scroll') && !c.listPlace && !c.listPending && !c.storedTried;
    if (!el.querySelector('.ch-scroll')) c.storedTried = true;
    const place = c.listPending || listPlace(el) || c.listPlace || (fresh ? storedListPlace(w) : null);
    // Results stream in while typing: keep the search box focused with the caret where it was.
    const inp0 = el.querySelector('[data-chsearch]'), had = inp0 && document.activeElement === inp0, sel = had ? [inp0.selectionStart, inp0.selectionEnd] : null;
    // New chat: a thumb-reach button bottom-right of the list (James: never make the thumb reach the top).
    // A channel's feed has its message box instead (wizard-ux issue 1258); an archived one takes no new posts (Restore
    // first), as its sheet offers no New post.
    // On the Channels list (none open) it starts a new chat too, as on Activity; only the list's + New channel row makes a
    // channel (James, 17 Nov 2026, wizard-ux issue 1489).
    const fab = feed ? (typeof chanComposer === 'function' ? chanComposer(w, feed) : '') : `<button type="button" class="ch-fab" data-chnew data-chfab aria-label="${AGID ? esc(`New chat with ${agentName(AGID)}`) : 'New chat'}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
    // Opened on the stored snapshot: say so, with a spinner, until the first fresh read lands (live.js SNAP_KEY).
    // Never let an old list pass for the latest (James, 21 Oct 2026): a failed or hung read, or a list older than a
    // minute, says when it was last updated; a pull-to-refresh shows its own progress and an "Up to date" flash.
    const lastAt = LST.at || LST.cachedAt || 0, age = lastAt ? Date.now() - lastAt : 0, since = lastAt ? `last updated ${agoText(lastAt)}` : '';
    const spin = '<i class="ch-spin" aria-hidden="true"></i>';
    // One quiet row, never a pill pushing the list down (James, 7 Nov 2026): a status dot, the line (ellipsis when long;
    // the whole line stays in the row's title) and a compact "Troubleshoot" text action at its right end, which opens
    // the Troubleshooter exactly like every other data-chtroubleshoot control.
    const dot = '<i class="ch-sync-dot" aria-hidden="true"></i>';
    const act = '<button type="button" class="ch-sync-act" data-chtroubleshoot aria-label="Open Troubleshooter">Troubleshoot</button>';
    // The text's title carries the whole line as plain text (its parts are already escaped); the visible labels stay
    // literal markup so app-parity-gate sees them.
    const syncBar = (cls, lead, inner, extra = '', title = inner) => `<div class="ch-sync${cls ? ' ' + cls : ''}" role="status">${lead}<span title="${title}">${inner}</span>${extra}</div>`;
    const notUp = (cls, lead, rest) => syncBar(cls, lead, `<b>Not up to date</b>${rest}`, act, `Not up to date${rest}`);
    const sync = c.ptrState === 'busy' ? syncBar('', spin, `Refreshing…${LST.error || age > STALE_LIST ? ` · ${esc(since)}` : ''}`)
      : LST.error ? notUp('off', dot, ` · ${esc(reachLabel('read'))}${since ? ` · ${esc(since)}` : ''}`)
      : LST.cached ? syncBar('', spin, `Updating…${LST.cachedAt && Date.now() - LST.cachedAt > 120000 ? ` · from ${esc(agoText(LST.cachedAt))}` : ''}`)
      : LST.ok && age > STALE_LIST ? notUp('stale', LST.loading ? spin : dot, ` · ${esc(since)}${LST.loading ? ' · updating…' : ''}`)
      : c.ptrState === 'done' ? syncBar('ok', '', '<span>Up to date</span>', '', 'Up to date') : '';
    const html = side ? `<div data-part="list" class="ch-list ch-side${feed ? ' ch-side-feed' : chatVars.chanView === 'channels' ? ' ch-side-chan' : ''}">${head}<div class="ch-scroll">${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${feed ? fab : ''}</div>`
      : `<div data-part="list" class="ch-list${AGID ? ' agent' : ''}${compactOn() ? ' compact' : ''}${byStatus() ? ' by-status' : ''}"${focusedAgent(focus) ? ` style="--agc:${AGS()?.colour(agentRec(focusedAgent(focus))) || ''};--ch-agent-hue:${AGS()?.distinctHues().get(focusedAgent(focus)) ?? AGS()?.hue(agentRec(focusedAgent(focus)))}"` : ''}><div data-slot="list-top"></div>${runView ? runningHead() : sentView ? sentHead(w) : head}${sync}<div class="ch-ptr" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg><span>Pull to refresh</span></div><div class="ch-scroll">${runView || sentView ? '' : sugHtml + unsentRow}${runRow}${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${pill}${runView ? '' : fab}${sentTabs ? sentBar(w) : ''}${feed || chanOn ? '' : focusStrip(w)}${c.sheet ? filterSheet(w, c) : ''}</div>`;
    // Unchanged list reads keep the same nodes, caret, scroll and text selection.
    // A thread/list remount invalidates the identity guard even when its HTML matches.
    if (c.listHTML === html && c.listRoot === el.firstElementChild) { PW?.paint(w.id, el); return; }
    // A live tick (a timer, a relative time, one Working row) patches only what changed: rows, spinners, scroll
    // and any open sheet stay put (James, 23 Oct 2026: whole-list rebuilds flickered on every update).
    const root = el.firstElementChild;
    if (c.listRoot === root && root?.classList.contains('ch-list') && window.WosMorph?.morph(root, html)) {
      clearReading(w.id); c.listHTML = html;
      // The morph keeps a typed field's live value; a cleared search (×, Back, a chip) must empty the box too.
      const box = root.querySelector('[data-chsearch]'); if (box && !c.q && box.value) box.value = '';
      const cta = feed && root.querySelector('[data-chchanform] textarea'); if (cta && typeof growTa === 'function') growTa(cta); // the morph drops its measured height
      // The auto-archive picker is a saved setting, not a draft: show the saved value after every repaint, or a
      // window painted before the choice changed (another desk, another device, first paint) keeps saying "1 week".
      const arch = root.querySelector('[data-archafter]'); if (arch && arch.value !== String(LIVE.archiveAfterDays)) arch.value = String(LIVE.archiveAfterDays);
      const aso = root.querySelector('[data-chactorder]'), asv = aso && window.WizChatsListModel?.activitySortOf(chatVars.readyOrder); if (aso && aso.value !== asv) aso.value = asv;
      if (c.listPending) { if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null; }
      else anchorListPlace(el.querySelector('.ch-scroll'), place);
    } else {
      const keepSheet = keptSheet(el);
      clearReading(w.id); el.innerHTML = html; c.listHTML = html; c.listRoot = el.firstElementChild;
      // Back from the Android app's document-scrolled thread: leave document scroll now, in this paint, so the list is
      // never drawn (or its place restored) at the thread's page offset first (wizard-ux issue 1564).
      // (typeof: tests run this function cut out of the file, without the document-scroll adapter around it.)
      if (typeof chatVars.docOwner !== 'undefined' && chatVars.docOwner && androidDocument && (chatVars.docOwner === el || chatVars.docOwner.contains(el))) syncDocumentThread();
      restoreSheet(el, keepSheet);
      if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null;
      // After a reload the rows come from the snapshot or the first read, which can take a few seconds.
      else if (c.listPending !== place) holdListPlace(w, el, place, fresh ? 8000 : 3000);
    }
    PW?.paint(w.id, el);
    if (chanOn && typeof chanHold === 'function') chanHold(w.id); // a channel's feed holds its place (issue 1263)
    bindFocusStrip(el);
    window.WosSkinHost?.rendered('list', el);
    if (had) { const inp = el.querySelector('[data-chsearch]'); inp.focus(); try { inp.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
  }
  function toggleSection(w, k) {
    chatVars.secOpen = { ...chatVars.secOpen, [k]: !chatVars.secOpen[k] };
    try { localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(chatVars.secOpen)); } catch (e) {}
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderChatList(w, el);
  }
  return { renderChatList, toggleSection, bindLate: v => { if ('clearReading' in v) clearReading = v.clearReading; if ('closeStream' in v) closeStream = v.closeStream; if ('elOf' in v) elOf = v.elOf; if ('holdList' in v) holdList = v.holdList; if ('keptSheet' in v) keptSheet = v.keptSheet; if ('PW' in v) PW = v.PW; if ('restoreSheet' in v) restoreSheet = v.restoreSheet; } };
};
