/* Wizard UX core: Chats, a native Wizard client on the Wizard API. Shared by every shell.
 *
 * A list of threads, a thread view and a composer, on Wizard's own read state and the durable outbox.
 * The shell owns windows and layout and hands this module a host:
 *   win(id)          → { id, thread } for a Chats window (thread: null = list, '__new__' = new chat)
 *   root()           → element that contains every [data-chats=id] node of this shell
 *   save()           → persist the shell's window state
 *   layout(id)       → that window's content changed shape (re-tile, re-measure)
 *   toast(icon, text, ms), title(w), viewContext(id, how)
 *   visible()        → ids of windows on screen (their open threads count as read)
 *   front()          → (optional) id of the window in front; a new thread started while it shows a Space joins it
 *   editUnsent(item) → put an unsent message back into a composer
 *   newChatHint      → the line under "New chat" (the phone mentions the orb, the desktop its keys)
 *   openLink(url, title) → (optional) open a private-origin link in a window of this shell; return true if it did
 *   openApp(id, srcEl) → (optional) open an installed app, remembering the source window so Back returns to it
 *   keepThreadOpen   → (optional) desktop retains existing threads on sends and state actions
 *   keepNewOpen(id)  → (optional) a new chat sent from this window stays open (a chat docked beside an app panel)
 *   owner(id)        → (optional) the window a pane belongs to (the desktop's list pane id::list → id)
 *   overlay(open)         → (optional) the media viewer opened/closed (the phone arms its Back guard)
 *   vib(ms)               → (optional) haptic tick
 *   threadShown(id, el)   → (optional) a window painted a loaded thread (el) or its list (null); the phone binds
 *                           the view the latest reply links to that thread (bound views, app.js)
 *
 * Parsing, Markdown, local time, drafts, copy/share and the media viewer live in core/chat-kit.js
 * (window.WosChat), loaded before this file by both shells.
 *
 * The body below the shims is kept line-for-line identical to the original mobile code it came from
 * (app.js, Chats section), so in-flight branches that edit that section port over with
 * `tools/port-chats-patch.sh <branch>`.
 */
window.WizCore = window.WizCore || {};
// Retire legacy pinned windows before either shell normalizes/persists its desks.
// Preserve ordinary extra Chats/provider windows; only the old agent windows are folded away.
window.WizCore.migrateChatsFocus = function (wins, desks) {
  let main = Object.values(wins).find(w => w?.app === 'chats' && !w.agent && (!w.chatsProvider || w.chatsProvider === 'wizard-chats'));
  const dropped = new Set();
  for (const w of Object.values(wins)) if (w?.app === 'chats' && w.agent) {
    if (main) { dropped.add(w.id); delete wins[w.id]; }
    else { w.focus = { kind: 'agent', key: w.agent }; delete w.agent; w.chatsProvider = 'wizard-chats'; main = w; }
  }
  return desks.filter(d => {
    if (!d || !Array.isArray(d.wins)) return true; // desktop repairs malformed stored desks below
    const hadLegacy = d.wins.some(id => dropped.has(id));
    d.wins = d.wins.filter(id => !dropped.has(id));
    if (!d.wins.includes(d.focus)) d.focus = d.wins[0] || null;
    return !hadLegacy || d.wins.length || d.home;
  });
};
/* Channel emoji (wizard-ux issue 1506, switch wizard/chat-channels): a channel shows an emoji where the # was. The
 * emoji is the start of the channel's own name ("🚀 Launch"), so it syncs and renames with the name, a channel whose
 * owner already typed an emoji in front keeps it, and nothing new is stored. General is #️⃣; a name with no emoji
 * gets 💬. channelFace(name, general) → { emoji, label, own, title }; channelEmojiName(name, emoji) puts (or, with '', takes
 * off) the emoji in front of a name. The AI apps desktop reads these too. Issue 1523: a name that is only an emoji has
 * no words (label '', title the emoji once); taking that emoji off gives the name 'Channel' (shown with 💬); and an
 * emoji that would push the name past 60 characters gives '' (the caller says so) instead of cutting the name. */
window.WizCore.CHANNEL_EMOJI = ['💬', '🚀', '📌', '💡', '🛠️', '📅', '🎯', '📚', '🎨', '🎵', '💰', '🏠', '✈️', '❤️', '🌱', '⭐', '🔥', '🧪', '📝', '🤖', '👥', '🎉', '⚙️', '🌍'];
window.WizCore.channelFace = function channelFace(name, general = false) {
  const n = String(name || ''), m = n.match(/^(?:\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?[\uFE0E\uFE0F]?\p{EMod}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{EMod}?)*)/u);
  if (general) return { emoji: '#️⃣', label: n || 'General', own: false, title: `#️⃣ ${n || 'General'}` };
  if (!m) return { emoji: '💬', label: n, own: false, title: `💬 ${n}` };
  const bare = n.slice(m[0].length).replace(/^[\s\uFE0F]+/u, '');
  return { emoji: m[0], label: bare, own: true, bare, title: bare ? `${m[0]} ${bare}` : m[0] };
};
window.WizCore.channelEmojiName = function channelEmojiName(name, emoji) {
  const f = window.WizCore.channelFace(name), bare = f.own ? f.bare : String(name || '').trim();
  if (!emoji) return bare || 'Channel';
  // The 60-character limit (UTF-16, as the stores count it): a name that has no room for the emoji is never cut.
  const t = (emoji + (bare ? ' ' + bare : '')).trim();
  return t.length > 60 ? '' : t;
};
window.WizCore.chats = function createChats(H) {
  'use strict';
  /* Values this closure changes over time (wizard-ux issue 1665): the parts in core/chats-*.js read and write them
   * as chatVars.<name>, accessors on these same variables, so every read and write is live. */
  const chatVars = {
    get chanAgentsOpen() { return chanAgentsOpen; }, set chanAgentsOpen(v) { chanAgentsOpen = v; },
    get chanArchOpen() { return chanArchOpen; }, set chanArchOpen(v) { chanArchOpen = v; },
    get chanCarried() { return chanCarried; }, set chanCarried(v) { chanCarried = v; },
    get chanCarryAfter() { return chanCarryAfter; }, set chanCarryAfter(v) { chanCarryAfter = v; },
    get chanReadDoc() { return chanReadDoc; }, set chanReadDoc(v) { chanReadDoc = v; },
    get chanReadPaintT() { return chanReadPaintT; }, set chanReadPaintT(v) { chanReadPaintT = v; },
    get chanReadT() { return chanReadT; }, set chanReadT(v) { chanReadT = v; },
    get chanView() { return chanView; }, set chanView(v) { chanView = v; },
    get dailyNext() { return dailyNext; }, set dailyNext(v) { dailyNext = v; },
    get docFrame() { return docFrame; }, set docFrame(v) { docFrame = v; },
    get docObserved() { return docObserved; }, set docObserved(v) { docObserved = v; },
    get docOwner() { return docOwner; }, set docOwner(v) { docOwner = v; },
    get docResize() { return docResize; }, set docResize(v) { docResize = v; },
    get focusHoldUntil() { return focusHoldUntil; }, set focusHoldUntil(v) { focusHoldUntil = v; },
    get lp() { return lp; }, set lp(v) { lp = v; },
    get lpHeld() { return lpHeld; }, set lpHeld(v) { lpHeld = v; },
    get lpUntil() { return lpUntil; }, set lpUntil(v) { lpUntil = v; },
    get paintForced() { return paintForced; }, set paintForced(v) { paintForced = v; },
    get pickFor() { return pickFor; }, set pickFor(v) { pickFor = v; },
    get readyOrder() { return readyOrder; }, set readyOrder(v) { readyOrder = v; },
    get rowChan() { return rowChan; }, set rowChan(v) { rowChan = v; },
    get rowListAgent() { return rowListAgent; }, set rowListAgent(v) { rowListAgent = v; },
    get rowSheet() { return rowSheet; }, set rowSheet(v) { rowSheet = v; },
    get secOpen() { return secOpen; }, set secOpen(v) { secOpen = v; },
    get selT() { return selT; }, set selT(v) { selT = v; },
    get spacePicker() { return spacePicker; }, set spacePicker(v) { spacePicker = v; },
    get swipeOpen() { return swipeOpen; }, set swipeOpen(v) { swipeOpen = v; },
    get visibleThreads() { return visibleThreads; }, set visibleThreads(v) { visibleThreads = v; },
  };
  /* The shims: the original body's names, backed by the host; core/chats-shims.js. */
  const { ago, applyLayout, clip, deskOf, desks, esc, hosted, idx, LIVE, norm, OUTBOX, reach, reachLabel, save, toast, track, troubleshoot, vib, viewContext, W, winTitle, bindLate: shimsLate } = window.WizCore.chatsParts.shims({ H });
  // Apps admitted to open the standard thread over their window (app-services.js keeps the same list).
  // Wisdom (James, 22 Oct 2026): Ask AI is the real Chats thread, never an app-built chat.
  function openHosted(wid, frame, sid, opts = {}) {
    const w = W[wid];
    if (!w || !window.WizLauncher?.hasHostedThread(w.appId) || !frame?.isConnected || frame.closest('[data-win]')?.dataset.win !== wid) return false;
    // Refuse replacement while any hosted thread is open; the app is not front.
    if (opts.draft && hosted.has(wid)) return false;
    if (!prepThread(sid, opts)) return false;
    if (hosted.has(wid)) closeHosted(wid);
    const layer = document.createElement('div'); layer.className = 'chats hosted-thread'; layer.dataset.chats = wid;
    layer.style.cssText = 'position:absolute;inset:0;z-index:5;background:var(--wz-base,var(--base,#15151d));display:flex;flex-direction:column;min-height:0';
    const container = frame.parentElement;
    const oldPosition = container.style.position;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const previous = Object.getOwnPropertyDescriptor(w, 'thread');
    Object.defineProperty(w, 'thread', { value: null, writable: true, configurable: true, enumerable: false });
    const entry = { frame, layer, container, oldPosition, previous, w };
    hosted.set(wid, entry);
    frame.inert = true; frame.style.visibility = 'hidden'; container.append(layer);
    openChat(wid, sid);
    if (opts.draft) requestAnimationFrame(() => { if (hosted.get(wid) === entry) layer.querySelector('.ch-compose textarea')?.focus({preventScroll:true}); });
    return true;
  }
  /* What an app's thread brings along, closing it, per-window state; core/chats-hosted.js. */
  const { androidDocument, ch, CH, closeHosted, isHosted, prepThread, bindLate: hostedLate } = window.WizCore.chatsParts.hosted({ hosted, LIVE, saveDraft });
  shimsLate({ isHosted });
  let docOwner = null, docFrame = 0, docResize = null, docObserved = [], visibleThreads = new Set();
  /* A thread as the page, move to a channel, the Space in front, Focus agents; core/chats-focus.js. */
  const { addFilter, agoText, BOOM, byStatus, CHAN_ARCHIVE_PRUNE_DAYS, CHAN_CLAMP, CHAN_DAY, CHAN_GENERAL, CHAN_PREFS_KEY, CHAN_TEXT_MAX, CHAN_VIEW_KEY, channelsOn, clearFilter, fileInGeneral, fileInSpace, focusAgentId, focusAgents, focusedAgent, focusMatches, focusOf, focusRows, hasFilter, INC, isWorking, KIT, matchesFocus, matchFilters, md, moveToChannel, paintPins, PIN, PIN_SVG, PINS_KEY, pinsOn, rememberedFocus, rerenderList, scrollBox, SEC_OPEN_KEY, SECTIONS_DAY, SECTIONS_STATUS, setFilter, setFocus, setupLate, SPACE, spaceAgent, spaceContains, spaceMember, spaces, spacesOf, STALE_LIST, STATUS, statusEntries, subjectOf, subjects, syncDocumentThread, threadOnScreen, threadViewportTop, TOPIC, topicOn, toTurns, visibleSpaces, watchTracker, WORKING_ST, bindLate: focusLate } = window.WizCore.chatsParts.focus({ agentRec, AGS: (...a) => AGS(...a), androidDocument, ch, chanStoreMove, chanStoreSpaces, chatsBack, chatVars, growTa, H, LIVE, norm, OUTBOX, owner: (...a) => owner(...a), renderChatList, renderThread, save, toast, W, winAgent });
  hostedLate({ KIT });
  let chanView = (() => { try { return localStorage.getItem(CHAN_VIEW_KEY) === 'channels' ? 'channels' : 'activity'; } catch (_) { return 'activity'; } })();
  const chanExpanded = new Set(), chanMore = new Set();
  let chanArchOpen = false;
  /* Mark done and Needs you; core/chats-done.js. */
  const { canMarkDone, chanArchived, chanNeeds, chanPrefs, handledNow, jumpGo, jumpOpened, jumpPillsHtml, MARK_DONE_SVG, markDone, markDoneOn, needsAsk, needsLand, needsMark, needsReplied, needsThreadOn, paintFeedJump, paintJump, replyStd, setChanPrefs, bindLate: doneLate } = window.WizCore.chatsParts.done({ attOf: (...a) => attOf(...a), ch, CH, CHAN_PREFS_KEY, channelsOn, chanSeenPaint, chanStore: (...a) => chanStore(...a), chanStorePrefs, elOf: (...a) => elOf(...a), esc, isWorking, LIVE, owner: (...a) => owner(...a), paintListsNow, renderThreadNow, rowOf: (...a) => rowOf(...a), scrollBox, threadOnScreen, threadViewportTop, toast, vib, W });
  /* Phase 2 (wizard-ux issue 1261; wizard-agent-service issue 440, docs/chats-channels.md): with the switch on and the
   * box's channel store answering (GET /wizard/v1/channels is 200; 404 while its WIZARD_CHANNEL_STORE is off or on an
   * older service), the channels, their sort, pins and archive are the box's, the same on every device (this also
   * covers wizard-agent-service issue 447), and the seeded Alerts channel sits pinned at the top like any pin. A chat's
   * channel is its list row's `channel` (else the ui-preferences projection the store serves, or a move this device
   * just made); filing and moving are the store's atomic PUT membership with the row's own agent. A channel feed adds
   * the channel's own list (view=list&channel=) to the live rows. With the store off everything stays on Spaces. */
  const chanStore = () => (channelsOn() && LIVE.chanStore?.state?.()) || null;
  const storeAgent = a => !a || a === (AGS()?.defaultId() || 'hermes') ? 'hermes' : a;
  const CHAN_STORE_MAX = 200, CHAN_FEED_DAYS = 30;
  function chanStorePrefs(st) {
    const pins = st.channels.filter(c => c.pinned).sort((a, b) => a.pinOrder - b.pinOrder || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0)).map(c => c.id);
    return { sort: st.sort, pins, archived: Object.fromEntries(st.channels.filter(c => c.archived).map(c => [c.id, c.archivedAt || c.createdAt || new Date(0).toISOString()])), store: true };
  }
  // A sort, pin or archive edit: the store's PATCH when it is on, else this device's prefs (p already changed).
  function chanPrefEdit(p, body) { if (p.store && LIVE.chanStore) LIVE.chanStore.patch(body); else setChanPrefs(p); }
  let chanStoreMemo = null;
  function chanStoreSpaces(proj) {
    const st = chanStore(); if (!st) return null;
    const S = LIVE.chanStore, tick = LIVE.ticks || 0;
    if (chanStoreMemo && chanStoreMemo.rev === st.rev && chanStoreMemo.proj === proj && chanStoreMemo.tick === tick) return chanStoreMemo;
    const byId = new Map(st.channels.map(c => [c.id, c])), where = new Map();
    for (const sp of proj) { const c = byId.get(sp.id); if (c) for (const t of sp.threads) where.set(c.agent + '|' + t, c.id); }
    // A row's own channel outranks the projection (newest 500 of open channels only); a move made here outranks both.
    for (const list of [LIVE.sessions || [], ...Object.values(LIVE.agentSessions || {}), S.rows?.() || []]) for (const s of list) if (s && typeof s.channel === 'string') where.set(storeAgent(rowAgent(s)) + '|' + s.id, s.channel);
    for (const [k, to] of S.moves?.() || []) where.set(k, to);
    const threads = new Map(st.channels.map(c => [c.id, []]));
    for (const [k, cid] of where) { const c = cid && byId.get(cid), i = k.indexOf('|'); if (c && k.slice(0, i) === c.agent) threads.get(cid).push(k.slice(i + 1)); }
    const list = st.channels.map(c => ({ id: c.id, name: c.name, ...(c.agent === 'hermes' ? {} : { agent: c.agent }), threads: threads.get(c.id), createdAt: c.createdAt, ...(c.kind ? { kind: c.kind } : {}) }));
    chanStoreMemo = { rev: st.rev, proj, tick, list, sets: new Map(list.map(s => [s.id, new Set(s.threads)])) };
    return chanStoreMemo;
  }
  // Filing on the store: true/false as spaceMember answers, null = the store is off (Spaces as before). The chat goes
  // only into its own agent's channel (the store would refuse another's with a 409).
  function chanStoreMove(key, sid, add, agent) {
    const st = chanStore(); if (!st) return null;
    const c = st.channels.find(x => x.id === key); if (!c) return false;
    const a = agent === undefined ? c.agent : storeAgent(agent);
    if (a !== c.agent || (!add && !spaceContains(key, sid))) return false;
    LIVE.chanStore.move(sid, add ? key : null, a);
    return true;
  }
  // The row a window shows for this id, by its own agent (a main and a routed thread can share an id).
  const chanRowAgent = (wid, sid) => { const r = rowOf(wid, sid); return r && r.id === sid ? rowAgent(r) : undefined; };
  // A channel's feed: the live rows plus the channel's own list from the store (newest posts of the last 30 days).
  function chanFeedRows(open, rows) {
    if (!open || open.general || open.agentFeed || !chanStore()) return rows;
    const f = LIVE.chanStore.feed(open.id, storeAgent(open.agent));
    if (!f?.rows?.length) return rows;
    const have = new Set(rows.map(chanKey)), cut = Date.now() - CHAN_FEED_DAYS * CHAN_DAY;
    return rows.concat(f.rows.filter(s => !s.hidden && !have.has(chanKey(s)) && chanAt(s) >= cut));
  }
  // Once per device, the first time the store answers: this device's own pins and archive move onto it (a pin or an
  // archive is only ever added, never undone here; the sort stays the box's, since another device may have chosen it).
  // Recorded as carried only once every write landed; a failed one is tried again a minute later.
  const CHAN_CARRY_KEY = 'wos.chats.channel-prefs.carried.v1';
  let chanCarried = false, chanCarryAfter = 0;
  async function chanCarry() {
    const st = chanStore(); if (!st) return false;
    try { if (localStorage.getItem(CHAN_CARRY_KEY)) return true; } catch (_) { return false; }
    let v = null; try { v = JSON.parse(localStorage.getItem(CHAN_PREFS_KEY) || 'null'); } catch (_) {}
    const byId = new Map(st.channels.map(c => [c.id, c])), edits = [];
    if (v && typeof v === 'object') {
      const arch = v.archived && typeof v.archived === 'object' ? v.archived : {};
      for (const id of Array.isArray(v.pins) ? v.pins : []) { const c = byId.get(id); if (c && !c.pinned && !c.archived && !arch[id]) edits.push({ id, pinned: true }); }
      for (const id of Object.keys(arch)) { const c = byId.get(id); if (c && !c.archived) edits.push({ id, archived: true, ...(c.pinned ? { pinned: false } : {}) }); }
    }
    const done = (await Promise.all(edits.map(b => LIVE.chanStore.patch(b)))).every(r => r && r.ok);
    if (done) { try { localStorage.setItem(CHAN_CARRY_KEY, new Date().toISOString()); } catch (_) {} }
    else { chanCarried = false; chanCarryAfter = Date.now() + 60e3; }
    return done;
  }
  /* Channel list, order, a row's channel and opening a channel; core/chats-channels.js. */
  const { chanAt, chanElsewhere, chanFace, chanName, channelBack, channelOf, channelsFor, chanOpen, chanPostOrder, chanPruned, chanSide, chanSwitchedOff, chanTarget, chanTitle, DAILY_HIST, DAILY_LAST, DAILY_OPEN, dailyChan, inChannel, openChannel, rowAgent, bindLate: channelsLate } = window.WizCore.chatsParts.channels({ agentName: (...a) => agentName(...a), AGS: (...a) => AGS(...a), CHAN_ARCHIVE_PRUNE_DAYS, CHAN_DAY, CHAN_GENERAL, chanAgentId: (...a) => chanAgentId(...a), channelsOn, chanPrefs, chanStore, focusAgents, focusedAgent, focusOf, H, LIVE, openDaily, owner: (...a) => owner(...a), save, setFocus, spaceAgent, spaceContains, spaces, spacesOf, visibleSpaces, W });
  focusLate({ channelBack, rowAgent });
  let dailyNext = null;
  // Only while the window still shows the thread Daily opened (a list window may move its thread without openChat).
  const dailyOn = w => !!w?.daily && w.daily.sid === w.thread && channelsOn() && !!LIVE.chanDaily && !!dailyChan(w.daily.id);
  const dailyState = w => dailyOn(w) ? LIVE.chanDaily.state(w.daily.id) : null;
  const dailyName = w => dailyOn(w) ? dailyChan(w.daily.id).name : '';
  const dailyHead = st => st?.days?.[0]?.sessionId || '__new__';
  const dailyPin = (sid, agent) => { if (sid && sid !== '__new__' && agent && agent !== 'hermes') LIVE.pinAgent?.(sid, agent); };
  function dailyLast(id, sid) {
    let v = {}; try { v = JSON.parse(localStorage.getItem(DAILY_LAST) || '{}') || {}; } catch (_) {}
    if (sid === undefined) return typeof v[id] === 'string' ? v[id] : '';
    v[id] = sid; try { localStorage.setItem(DAILY_LAST, JSON.stringify(v)); } catch (_) {}
    return sid;
  }
  // A tap on Daily: its newest thread in this window (the AI apps sidebar: in the main chat column, as a row tap does).
  // The box is asked again on every tap (another device may have started today's thread): a quick answer picks the
  // thread, a slow one lets the kept copy open at once and moves the view on when it lands (dailyFollow).
  const DAILY_WAIT = 800;
  function openDaily(w, id) {
    const c0 = dailyChan(id); if (!c0 || !LIVE.chanDaily || !w) return false;
    let done = false; const start = w.thread;
    const go = () => {
      if (done) return true; done = true;
      if (w.thread !== start) return false; // the window moved on while the box was asked
      const st = LIVE.chanDaily.state(id);
      if (!st.ok && !st.days.length) return openChannel(w, id, true); // never read and unreachable: the plain feed
      const sid = dailyHead(st); st.days.forEach(d => dailyPin(d.sessionId, c0.agent));
      dailyNext = { sid, daily: { id, agent: c0.agent }, at: Date.now() };
      openChat(w.id, sid);
      if (fresh) fresh.then(() => dailyFollow(id, sid));
      return true;
    };
    const fresh = Promise.resolve(LIVE.chanDaily.read(id)).catch(() => {});
    const st = LIVE.chanDaily.state(id);
    fresh.then(go);
    if (st.ok || st.days.length) setTimeout(go, DAILY_WAIT);
    return true;
  }
  /* Daily follow and claim, agents in the Channels list; core/chats-agentrows.js. */
  const { actAllAgents, actMark, actNeeds, actRowMark, actUnread, agentLabelOf, CHAN_AGENT, chanDraftMark, chanUnread, chanUnreadN, dailyClaim, dailyClick, dailyFollow, dailyHtml, dailyLate, dailyLinkTo, dailyTarget, dailyWatch, draftTag, rowDraft, bindLate: agentrowsLate } = window.WizCore.chatsParts.agentrows({ agentName: (...a) => agentName(...a), AGS: (...a) => AGS(...a), ch, CH, chanElsewhere, chanNeeds, channelsOn, chanOpen, chanView, chatVars, clip, DAILY_HIST, DAILY_OPEN, dailyHead, dailyLast, dailyOn, dailyPin, dailyState, draftKey: (...a) => draftKey(...a), esc, isWorking, KIT, LIVE, loadDraft, openChat, owner: (...a) => owner(...a), renderChatList, renderThread, rowAgent, save, saveDraft, toTurns, W });
  let chanAgentsOpen = false;
  const chanAgentId = id => typeof id === 'string' && id.startsWith(CHAN_AGENT) ? id.slice(CHAN_AGENT.length) : '';
  function chanAgentsList() {
    const ags = typeof focusAgents === 'function' ? focusAgents() : [], main = AGS()?.defaultId?.() || 'hermes';
    return ags.length > 1 ? ags.slice().sort((a, b) => Number(b.id === main || !!b.is_default) - Number(a.id === main || !!a.is_default)) : [];
  }
  function chanAgentsSec(rows) {
    const list = chanAgentsList(); if (!list.length) return '';
    const lines = chanAgentsOpen ? list.map(a => {
      const mine = rows.filter(s => !s.archived && rowAgent(s) === a.id), un = chanUnreadN(mine);
      const name = typeof agentName === 'function' ? agentName(a.id) : (a.label || a.id);
      return `<div class="ch-chan ch-chan-agent${un ? ' unread' : ''}" data-morph-key="chan:${esc(CHAN_AGENT + a.id)}"><div class="ch-chan-r"><button type="button" class="ch-chan-open" data-chchan="${esc(CHAN_AGENT + a.id)}" title="Open ${esc(name)}"><span class="ch-chan-sig" aria-hidden="true">${AGS()?.sigil?.(agentRec(a.id)) || ''}</span><b>${esc(name)}</b>${typeof chanDraftMark === 'function' ? chanDraftMark({ id: CHAN_AGENT + a.id, agent: a.id }) : ''}${chanMark(mine, false, un)}</button></div></div>`;
    }).join('') : '';
    return `<section class="ch-sec ch-chan-agents${chanAgentsOpen ? ' open' : ''}" data-sec="chan-agents"><button type="button" class="ch-sec-h" data-chchanagents aria-expanded="${chanAgentsOpen}"><span>Agents</span><small>${list.length}</small><i aria-hidden="true"></i></button>${chanAgentsOpen ? `<div class="ch-sec-b">${lines}</div>` : ''}</section>`;
  }
  /* Undo after an archive and channel read-mark names; core/chats-undo.js. */
  const { actRestore, actUndo, CHAN_READ_KEY, CHAN_READ_MAX, CHAN_READ_MS, CHAN_READ_SYNC, CHAN_READ_UP_MS, chanActs } = window.WizCore.chatsParts.undo({ channelsOn, esc, LIVE, paintListsNow, toast, vib });
  let chanReadDoc = null, chanReadT = 0, chanReadPaintT = 0;
  /* A channel's read place and new-post counts; core/chats-chanread.js. */
  const { chanChanged, chanGenAgent, chanNewCount, chanReadAt, chanReadFeed, chanReadKey, chanReadPaint, chanReadTo, chanSeenRow, bindLate: chanreadLate } = window.WizCore.chatsParts.chanread({ CH, CHAN_GENERAL, CHAN_READ_KEY, CHAN_READ_MAX, CHAN_READ_MS, CHAN_READ_SYNC, CHAN_READ_UP_MS, chanActs, chanAt, channelsOn, chanOpen, chanStore, chatVars, focusAgentId, handledNow, isWorking, LIVE, owner: (...a) => owner(...a), renderChatList, rowOf: (...a) => rowOf(...a), storeAgent, W });
  function chanSeenPaint() {
    if (!channelsOn()) return;
    // Activity too (issue 1336): an opened green thread leaves Ready at once, also in the list pane beside the thread
    // that the desktop's Live repaint skips while focus is inside it.
    for (const id of Object.keys(CH)) { const x = W[id]; if (!x || x.thread || !(chanOpen(x) || chanView === 'activity') || holdList(id)) continue; const el = elOf(id); if (el) renderChatList(x, el); }
  }
  /* New channel, channel list body and head, channel sheet, Rename, Mark read; core/chats-chanui.js. */
  const { boxModel, chanboxLate, chanCompose, chanComposer, chanDraftKey, chanDropSending, chanEditUnsent, chanEmojiPick, chanEmojiSync, chanEmojiTap, chanHead, chanHold, chanKey, chanMark, chanModel, channelClick, channelFeed, channelsBody, channelSend, chanOwnPost, chanRepaint, chanScrolled, chanSetEmoji, chanSpaceOf, chanToEnd, chanUser, clearAll, feedLate, openChannelSheet, SEC_DEFAULT, setChanModel, setQuery, submitChannelRename, bindLate: chanuiLate } = window.WizCore.chatsParts.chanui({ agentName: (...a) => agentName(...a), agentRec, ago, AGS: (...a) => AGS(...a), ch, CH, CHAN_CLAMP, CHAN_DAY, CHAN_GENERAL, CHAN_TEXT_MAX, CHAN_VIEW_KEY, chanActs, chanAgentsSec, chanArchived, chanAt, chanCarry, chanChanged, chanDraftMark, chanElsewhere, chanExpanded, chanFace, chanGenAgent, chanMore, chanNeeds, channelBack, channelsFor, channelsLate, channelsOn, chanNewCount, chanOpen, chanPostOrder, chanPrefEdit, chanPrefs, chanPruned, chanReadAt, chanReadFeed, chanReadKey, chanReadPaint, chanReadTo, chanStore, chanTarget, chanTitle, chanUnread, chanUnreadN, chatsBack, chatVars, closeRowSheet, doneLate, esc, focusAgentId, focusAgents, focusedAgent, focusOf, growTa, H, inChannel, isWorking, jumpGo, KIT, LIVE, MARK_DONE_SVG, markDoneOn, norm, openChannel, openChat, openEmojiSheet, OUTBOX, owner: (...a) => owner(...a), paintFeedJump, paintListsNow, PIN_SVG, renderChatList, rerenderList, rowAgent, spaceAgent, spaceContains, spaces, toast, toTurns, track, vib, viewContext, W, winAgent });
  focusLate({ chanHold, chanOwnPost });
  let secOpen = (() => { try { return { ...SEC_DEFAULT, ...JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || '{}') }; } catch (e) { return { ...SEC_DEFAULT }; } })();
  /* Status marks, loading placeholders and the New chat face; core/chats-status.js. */
  const { ATT, attOf, deferredOf, newChatHtml, SEC_PAGE, skelRows, skelThread, STI, STI_LAB, STI_TIP, stiBadge, stiKind, bindLate: statusLate } = window.WizCore.chatsParts.status({ agentName: (...a) => agentName(...a), agentRec, AGS: (...a) => AGS(...a), esc, H, handledNow, isWorking });
  focusLate({ attOf, deferredOf });
  agentrowsLate({ deferredOf });
  chanreadLate({ deferredOf });
  // Unified Chats: in the owner's main list, a private agent's row wears the lock. data-wiz-private keeps its words out
  // of the screen text sent as context with a message to another agent (core/screen-text.js).
  let rowListAgent = '', rowChan = false;
  /* A thread row in a list; core/chats-rows.js. */
  const { alertFeedback, chatRow, INBOX_SVG, inboxCanSend, inboxHeadHtml, inboxMove, READY_ORDER_KEY, READY_ORDER_LABEL, READY_ORDERS, runningBack, runningBody, runningGo, runningHead, runningOn, runningOpen, runningRow, sweepAnswer, sweepHtml, sweepLater, sweepYesToAll, bindLate: rowsLate } = window.WizCore.chatsParts.rows({ actRowMark, agentLabelOf, ago, AGS: (...a) => AGS(...a), ATT, attOf, BOOM, ch, CH, chanName, channelsLate, chanStore, chanTitle, chatVars, clip, deferredOf, draftTag, esc, feedLate, H, isWorking, KIT, LIVE, paintListsNow, PIN, PIN_SVG, renderThreadNow, rerenderList, STI, STI_LAB, STI_TIP, stiKind, storeAgent, subjectOf, toast, TOPIC, topicOn, W, winAgent });
  let readyOrder = (() => {
    try {
      const v = localStorage.getItem(READY_ORDER_KEY); if (READY_ORDERS.includes(v) || v === 'oldest') return v;
      if (localStorage.getItem('wos.chats.readyBySubject.v1') === '1') return 'subject'; // the old two-way toggle
    } catch (e) {}
    return 'newest';
  })();
  /* Ready and Working orders, notifications in Ready, Back to Newest; core/chats-readylist.js. */
  const { archSel, CHEV_SVG, COG_SVG, COMPACT_KEY, compactOn, discardDraft, draftRow, draftsLate, eventsLate, filterSheet, focusLabel, focusOptions, focusStrip, jumpToMessage, keepThreadOpen, leadText, listTitle, moveSubject, newDrafts, nextOrder, noteAt, noteIcon, noteMoreHtml, notePlain, noteQuiet, noteRouteHtml, noteRow, notes, noteSiblings, noteSrcName, noteStackHtml, noteTactsHtml, notifAct, notifDoneAll, notifOf, notifRoute, openContextDraft, openNewDraft, orderBar, quoteMessage, readyBack, readyBody, readyOrdered, regenOn, replyBubble, replyCard, sendPill, setSummaryOpen, showBoomMessage, snoozeLast, summaryOf, summaryStartsOpen, syncListTitle, trackerLate, WORKING_ORDERS, workingOrderBar, workingOrdered, workLabel, bindLate: readylistLate } = window.WizCore.chatsParts.readylist({ agentName: (...a) => agentName(...a), agentRec, ago, AGS: (...a) => AGS(...a), attOf, byStatus, ch, CH, chanArchived, channelsOn, chanOpen, chatsBack, chatVars, clip, dailyLate, deferredOf, draftKey: (...a) => draftKey(...a), esc, focusAgents, focusedAgent, focusOf, H, isWorking, KIT, leaveFinishedThread, LIVE, matchesFocus, openChat, OUTBOX, owner: (...a) => owner(...a), pinsOn, reachLabel, READY_ORDER_KEY, READY_ORDER_LABEL, READY_ORDERS, rememberedFocus, renderChatList, renderThread, renderThreadLive, renderThreadNow, saveDraft, scrollBox, setFocus, setupLate, spaceAgent, spaces, statusEntries, statusLate, stiKind, syncDocumentThread, threadViewportTop, toast, TOPIC, topicOn, toTurns, track, troubleshoot, vib, visibleSpaces, W, winAgent });
  chanreadLate({ snoozeLast });
  chanuiLate({ orderBar });
  rowsLate({ snoozeLast, workLabel });
  // One local picker, rendered through the same Focus options as the filter sheet.
  let spacePicker = null, focusHoldUntil = 0;
  /* Space picker, Focus strip, Activity list and order; core/chats-spaces.js. */
  const { activityBody, activityClick, actSetOrder, anchorListPlace, bindFocusStrip, closeSpacePicker, holdListPlace, listPlace, listSaveT, openSpacePicker, queueListPlace, restoreListPlace, storedListPlace, bindLate: spacesLate } = window.WizCore.chatsParts.spaces({ actNeeds, actUnread, agentRec, AGS: (...a) => AGS(...a), ch, CH, CHAN_STORE_MAX, chanAt, chanEmojiPick, chanEmojiSync, chanEmojiTap, channelsOn, chanOpen, chanStore, chanTarget, chanToEnd, chatRow, chatVars, esc, fileInGeneral, fileInSpace, focusAgents, focusOf, focusOptions, H, LIVE, norm, noteAt, noteRow, openChannel, owner: (...a) => owner(...a), READY_ORDER_KEY, renderChatList, rerenderList, runningOpen, SEC_PAGE, setFocus, SPACE, spaceAgent, spaceContains, spaceMember, spaces, spacesOf, storeAgent, toast, W, winAgent });
  focusLate({ closeSpacePicker, openSpacePicker });
  chanuiLate({ openSpacePicker });
  function renderChatList(w, el) {
    if (globalThis.WosThreadTracker?.on()) globalThis.WosThreadTracker.loadCounts();
    // A layout which owns the list supplies its own sidebar. Do not paint a
    // second, CSS-covered list underneath it (including a thread returning Back).
    // The AI apps sidebar's Channels pane (wizard-ux issue 1256) is this same list for the main Chats window, drawn
    // into the sidebar as the id::side window while the switch is on: tabs, the channel list, a feed and its box.
    const side = typeof chanSide === 'function' && chanSide(w);
    if (!side) {
      // Switched off with a feed open in the sidebar: its Focus goes back to the one before the channel.
      if (H.ownsChatList?.() && typeof chanSwitchedOff === 'function' && chanSwitchedOff(w)) H.layout?.(owner(w.id));
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
    rowListAgent = AGID;
    // (the AI apps sidebar's pane opens its channels in the main column: it never draws a feed, wizard-ux issue 1256)
    const chanOn = typeof channelsOn === 'function' && channelsOn(), feed = chanOn && !(typeof chanElsewhere === 'function' && chanElsewhere(w)) ? chanOpen(w) : null; // tests slice this renderer without the Channels block
    if (!chanOn && typeof chanSwitchedOff === 'function' && chanSwitchedOff(w)) { syncListTitle(w); H.layout?.(owner(w.id)); }
    // The main column's feed window draws a feed or nothing (never the tabs or the channel list: those stay in the sidebar).
    if (side && !feed && typeof chanElsewhere === 'function' && typeof H.channelsElsewhere === 'function' && !chanElsewhere(w)) { el.replaceChildren(); return; }
    rowChan = chanOn && !feed;
    const runView = !side && typeof runningOpen === 'function' && runningOpen(w), runRow = !side && !runView && !feed && typeof runningRow === 'function' ? runningRow(w) : ''; // wizard-ux issue 1569
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
    // Channels (wizard/chat-channels): the live window only (James, 9 Nov 2026: older chats are reached by asking the agent).
    else if (feed && !n && !F) { const live = new Set((LIVE.sessionsFor ? LIVE.sessionsFor(AGID) : LIVE.sessions).map(s => s.id)), mine = all.filter(s => live.has(s.id)); body = channelFeed(w, feed, typeof chanFeedRows === 'function' ? chanFeedRows(feed, mine) : mine); }
    else if (chanOn && chanView === 'channels' && !n && !F) body = channelsBody(w, all);
    // Activity as a short what-needs-me list (issue 1336): Working, Ready, Recent, then folded Snoozed and Archived.
    else if (chanOn && !side && !feed && !n && !F && typeof activityBody === 'function') body = draftSec + activityBody(w, all, listNotes);
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
      if (!list.length && !extra.n && (k === 'errors' || k === 'saved' || k === 'deferred' || k === 'yesterday' || k === 'pastWeek' || n || filtered) && !notesN) return '';
      // While searching, every section with a hit opens so nothing is buried.
      const open = n ? true : secOpen[k];
      // Counts are unread only (James, 8 Nov 2026): a finished thread already read adds nothing, so Ready is never an inventory.
      // Working, Snoozed and Archive keep their place counts; they are not messages waiting.
      const unreadSec = k === 'errors' || k === 'ready' || k === 'yesterday' || k === 'pastWeek';
      const secN = unreadSec ? window.WizChatsListModel.unreadThreads(list, s => LIVE.isNew(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)), nt?.awake) : list.length + extra.n + notesN;
      const waitN = !byStatus() && (k === 'ready' || k === 'yesterday' || k === 'pastWeek') ? list.filter(s => !window.WizChatsListModel.isListWorking(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)) && (['waiting_for_approval', 'unknown'].includes(s.status) || (!deferredOf(s) && attOf(s)?.state === 'needs_you'))).length : 0;
      const windowMeta = AGID ? LIVE.windows?.[AGID] : Object.values(LIVE.windows || {}).length ? {archiveTotal:Object.values(LIVE.windows).reduce((n,x)=>n+(x.archiveTotal||0),0)} : null;
      const archiveNote = k === 'archive' && !n && !filtered && windowMeta ? `<span class="ch-none">Newest ${list.length} of ${windowMeta.archiveTotal} · search to find older chats</span>` : '';
      const shown = c.more[k] ? list : list.slice(0, SEC_PAGE);
      return `<section class="ch-sec${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${secN || ''}</small>${waitN ? `<b class="wait">${waitN} need you</b>` : ''}<i aria-hidden="true"></i></button>
        ${open ? `<div class="ch-sec-b">${k === 'working' && list.length ? workingOrderBar() : ''}${k === 'archive' && !n && !filtered && !AGID ? '<div data-slot="archive-top"></div>' : ''}${k === 'archive' && !n && !filtered ? archSel() : ''}${archiveNote}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-top"></div>' + (window.WizAppExtensions?.html() || '') : ''}${list.length || extra.n || notesN ? (k === 'errors' && PW ? shown.map(s => PW.errorRow(s, chatRow(s, n ? snips.get(s.id) : null))).join('') + extra.html : dayOrdered ? readyBody(shown, s => chatRow(s, null), nt, k) : shown.map(s => chatRow(s, n ? snips.get(s.id) : null)).join('')) : '<span class="ch-none">None</span>'}${list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-end"></div>' : ''}</div>` : ''}</section>`;
    }).join('');
    if (runView) body = runningBody();
    // Progress sits above the results (James, 25 Oct 2026: it was hidden below a long Archive); the final line stays under them.
    if (bs && LST.ok) body = BS.scanning(bs) || bs.busy ? BS.footer(bs) + body : body + BS.footer(bs);
    if (side && !feed && chanView !== 'channels') body = ''; // Activity: the tabs only; the sidebar draws its own rows
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
    const html = side ? `<div data-part="list" class="ch-list ch-side${feed ? ' ch-side-feed' : chanView === 'channels' ? ' ch-side-chan' : ''}">${head}<div class="ch-scroll">${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${feed ? fab : ''}</div>`
      : `<div data-part="list" class="ch-list${AGID ? ' agent' : ''}${compactOn() ? ' compact' : ''}${byStatus() ? ' by-status' : ''}"${focusedAgent(focus) ? ` style="--agc:${AGS()?.colour(agentRec(focusedAgent(focus))) || ''};--ch-agent-hue:${AGS()?.distinctHues().get(focusedAgent(focus)) ?? AGS()?.hue(agentRec(focusedAgent(focus)))}"` : ''}><div data-slot="list-top"></div>${runView ? runningHead() : head}${sync}<div class="ch-ptr" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg><span>Pull to refresh</span></div><div class="ch-scroll">${runView ? '' : sugHtml + unsentRow}${runRow}${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${pill}${runView ? '' : fab}${feed || chanOn ? '' : focusStrip(w)}${c.sheet ? filterSheet(w, c) : ''}</div>`;
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
      const aso = root.querySelector('[data-chactorder]'), asv = aso && window.WizChatsListModel?.activitySortOf(readyOrder); if (aso && aso.value !== asv) aso.value = asv;
      if (c.listPending) { if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null; }
      else anchorListPlace(el.querySelector('.ch-scroll'), place);
    } else {
      const keepSheet = keptSheet(el);
      clearReading(w.id); el.innerHTML = html; c.listHTML = html; c.listRoot = el.firstElementChild;
      // Back from the Android app's document-scrolled thread: leave document scroll now, in this paint, so the list is
      // never drawn (or its place restored) at the thread's page offset first (wizard-ux issue 1564).
      // (typeof: tests run this function cut out of the file, without the document-scroll adapter around it.)
      if (typeof docOwner !== 'undefined' && docOwner && androidDocument && (docOwner === el || docOwner.contains(el))) syncDocumentThread();
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
    secOpen = { ...secOpen, [k]: !secOpen[k] };
    try { localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(secOpen)); } catch (e) {}
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderChatList(w, el);
  }
  /* Attachments and voice notes; core/chats-attach.js. */
  const { addFiles, attachTray, CHECK_SVG, CLIP_SVG, fileUrl, hasContent, mediaOfFile, MIC_SVG, PEND, pendRef, PREVIEW, refreshCompose, refreshReply, syncSend, timeTag, toggleVoice, turnAt, turnHtml, UPLOAD_ABORT, uploadFile, userMedia, bindLate: attachLate } = window.WizCore.chatsParts.attach({ ch, CHEV_SVG, clip, COG_SVG, draftKey: (...a) => draftKey(...a), draftsLate, elOf: (...a) => elOf(...a), esc, fileRef: (...a) => fileRef(...a), INC, KIT, leadText, md, needsThreadOn, regenOn, replyBubble, replyCard, saveDraft, summaryOf, summaryStartsOpen, sweepHtml, toast, track, W, winAgent });
  agentrowsLate({ hasContent });
  chanuiLate({ mediaOfFile });
  readylistLate({ refreshReply });
  dailyLate({ turnHtml });
  chanboxLate({ attachTray, CLIP_SVG, fileUrl, hasContent, pendRef, PREVIEW, syncSend });
  /* Thread actions (Snooze / Archive) and the action icons; core/chats-threadacts.js. */
  const { ACT, followUpActive, threadActions } = window.WizCore.chatsParts.threadacts({ isWorking, LIVE, WORKING_ST });
  chanuiLate({ ACT });
  draftsLate({ ACT });
  // Notification-thread only: hand it to the agent to stop or fix (the package sends the ask).
  const NACT = { resolve: { label: 'Resolve this', icon: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.7-7.7M5 5l3 3"/></svg>', hint: 'Ask Wizard to stop these or fix the cause' }, restore: { ...ACT.restore, label: 'Restore', hint: 'Move back to your inbox' } };
  draftsLate({ NACT });
  const actionLabel = (s, a, compact = false) => a === 'done' && followUpActive(s) ? 'Archive for now'
    : a === 'stop_watch' && compact ? 'Stop' : ACT[a].label;
  const owner = id => (H.owner ? H.owner(id) : id);
  /* ---- Agents MVP: per-agent Chats. A window pinned to a non-default agent (w.agent) lists only that agent's
   * threads and starts new chats on it. Focus derives that same route; the thread keeps its
   * conversation title and model picker without repeating the agent banner. ---- */
  const AGS = () => window.WosAgents || null;
  function winAgent(w) { const o = (w && W[owner(w.id)]) || w; const f = focusOf(o), id = focusedAgent(f) || o?.agent || ''; const A = AGS(); return id && (!A || A.isOther(id)) ? id : ''; }
  // The thread row this window shows. A window focused on an agent lists that agent's rows, so a same-id thread
  // opened from it is that agent's row; anything else (All, the main agent, a main thread opened from a link while
  // an agent is focused) keeps the shared lookup. Watcher actions then scope to this row's own owner.
  const rowOf = (wid, sid) => { const a = winAgent(W[owner(wid)]); return (a && LIVE.sessionFor ? LIVE.sessionFor(sid, a) : null) || LIVE.session(sid); };
  /* Thread tracker Resume = an ordinary owner message through this window's own send path; it never takes the composer's
   * draft, quote or files and never leaves the thread (the spinner flips in the tracker). The agent comes from this
   * window's scope (the row it shows, else its own agent), carried explicitly; if the id-only lookup names a different
   * agent the send is refused (the tracker restores the rows) rather than delivered to the wrong agent. */
  function resumeTracked(id, w, text) {
    const sid = w.thread, how = 'tapping Resume in the thread tracker', A = AGS(), row = rowOf(id, sid);
    const other = a => !!a && (!A || A.isOther(a));
    const scoped = (other(row?.agent) ? row.agent : '') || winAgent(W[owner(id)] || w) || '';
    if (scoped !== ((LIVE.agentOf && LIVE.agentOf(sid)) || '')) return Promise.resolve(null);
    const it = sendChat(id, text, how, null, { sid, away: true, instructions: viewContext(id, how), ...(scoped ? { agent: scoped } : {}) });
    PW?.follow(id, true, sid); return it;
  }
  // AI Look up (core/lookup-pop.js): which agent/thread the words sit in. Private agents, private threads and Incognito
  // never use a cloud model, so the selection menu hides Look up there (the Agent Service refuses them too).
  function lookupScope(id) {
    const w = W[id]; if (!w) return null;
    const sid = w.thread && w.thread !== '__new__' ? String(w.thread) : '';
    const agent = winAgent(w) || (sid && LIVE.agentOf ? LIVE.agentOf(sid) : '') || '';
    const priv = !!INC?.active(id) || !!(sid && LIVE.isPrivate?.(sid)) || !!AGS()?.isPrivate(agentRec(agent)); // '' is the default agent, checked too
    let title = ''; try { title = winTitle(w) || ''; } catch (e) {}
    return { session: sid, agent, private: priv, frame: `${agentName(agent)}${title ? ' · ' + title : ''}`.slice(0, 80) };
  }
  function agentRec(id) {
    const A = AGS();
    if (!id) { const d = A?.get(A.defaultId()); return d || { id: 'hermes', label: window.WizConfig.agent(), privacy: 'standard', appearance: { glyph: 'wizard' }, model: {}, is_default: true }; }
    return A?.get(id) || { id, label: id, privacy: 'standard', appearance: {}, model: {}, missing: true };
  }
  // The agent name used in composer hints and receipts: the open agent's label, else the main agent's name.
  const agentName = id => id ? agentRec(id).label : window.WizConfig.agent();
  // Read the drawn list, not workGroups(): filters, Space Focus, sort, folded sections and
  // Show more have already decided what is here. Keep that order while a phone shows its thread.
  function archiveListOrder(wid, sid) {
    const own = window.WosSkinHost?.chatArchiveOrder?.(sid);
    if (own != null) return own;
    const el = elOf(wid + '::list') || elOf(wid);
    const rows = [...(el?.querySelectorAll('.ch-list [data-chopen]') || [])];
    const row = rows.find(r => r.dataset.chopen === sid);
    if (!row) return ch(wid).archiveOrder || [];
    const section = row.closest('.ch-sec, .ch-search-results') || row.closest('.ch-list');
    return rows.filter(r => (r.closest('.ch-sec, .ch-search-results') || r.closest('.ch-list')) === section).map(r => r.dataset.chopen);
  }
  function archiveAdvance(w, sid) {
    const ids = archiveListOrder(w.id, sid).filter(id => id === sid || (rowOf(w.id, id) && !rowOf(w.id, id).archived));
    const at = ids.indexOf(sid), nx = at < 0 ? null : ids[at + 1] || ids[at - 1];
    ch(w.id).archiveOrder = ids;
    // Reuse the ordinary opener: it saves the draft and clears the link trail. Back goes to
    // the list, never the archived thread. No neighbour also discards that trail explicitly.
    if (nx) openChat(w.id, nx);
    else { ch(w.id).trail = []; chatsBack(w); }
  }
  // The one "I'm finished with this thread" landing, shared by Archive and Snooze (James, 8 Nov 2026): desktop opens the next
  // chat in the drawn list, the phone goes straight to the chats list (no step up the link trail), whatever the After-actions setting.
  function leaveFinishedThread(w, sid) {
    if (!w || !sid || w.thread !== sid) return false;
    if (!PHONE()) archiveAdvance(w, sid);
    else { ch(w.id).trail = []; chatsBack(w); }
    return true;
  }
  // Repaint every chats list from the already-patched LIVE state on the tap's own frame. The holds that normally defer a
  // repaint (swipe tray, long press, actions sheet, reading) guard against a poll reshuffling rows under a finger; the
  // owner's own action is the one repaint that must never wait.
  let paintForced = false;
  function paintListsNow() {
    closeSwipe(true); paintForced = true;
    try { for (const id of Object.keys(CH)) { const x = W[id]; if (x && !x.thread) renderChats(x); } } finally { paintForced = false; }
    H.changed?.();
    window.WosSkinHost?.rendered?.('chats-list', null); // a layout that draws its own list (AI apps sidebar) re-reads it now too
  }
  /* Row actions for threads, alerts and channel lines; core/chats-rowacts.js. */
  const { NOTE_ACT, noteRowAct, ROW_MENU, rowMenu, threadAct, bindLate: rowactsLate } = window.WizCore.chatsParts.rowacts({ ACT, actRestore, actUndo, BOOM, ch, CH, closeRowSheet, followUpActive, H, keepThreadOpen, leaveFinishedThread, LIVE, markDone, notifAct, openChannelSheet, openRowSheet, owner, paintListsNow, rowOf, threadBack, toast, vib, W });
  let rowSheet = null; // { wid, sid?, nid?, trigger }
  function rowActions(s) {
    const acts = threadActions(s, null);
    return LIVE.workGroups([s]).ready.length > 0 && !LIVE.isNew(s) ? ['unread', ...acts] : acts;
  }
  function openRowSheet(wid, sid, nid = '') {
    const s = nid ? window.WosBell?.item?.(nid) : rowOf(wid, sid), el = track.querySelector(`[data-chats="${wid}"]`); if (!s || !el || (nid && s.archived)) return;
    closeRowSheet();
    const trigger = Array.from(el.querySelectorAll(nid ? '[data-chnotif]' : '[data-chopen]')).find(row => (nid ? row.dataset.chnotif : row.dataset.chopen) === (nid || sid)) || null;
    const grp = nid && trigger?.dataset.chnotifGroup ? [s, ...noteSiblings(s)].filter(i => !!i.read === !!s.read).map(i => i.id) : null;
    const acts = nid ? ['done', ...(s.read ? ['unread'] : ['snooze'])] : rowActions(s);
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="${nid ? 'Alert' : 'Thread'} actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(nid ? grp && grp.length > 1 ? `${noteSrcName(s)} · ${grp.length}` : notePlain(s.title) || 'Alert' : s.title)}</div>
      ${nid ? '<button type="button" data-rsopen><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>Open</button>' : ''}
      ${!nid && typeof canMarkDone === 'function' && canMarkDone(s) ? `<button type="button" data-rsmarkdone>${MARK_DONE_SVG}Mark done</button>` : ''}
      ${nid ? '' : `<button type="button" data-rsrename>${RENAME_SVG}Rename</button>
      ${PIN.on?.() !== false ? `<button type="button" data-part="pin-action" data-rspin>${PIN_SVG}${PIN.has(sid) ? 'Unpin' : 'Pin'}</button>` : ''}
      ${typeof inboxCanSend === 'function' && inboxCanSend(wid, s) ? `<button type="button" data-rsinbox>${INBOX_SVG}Send to inbox</button>` : ''}
      <button type="button" data-rsspacepicker>${PIN_SVG}${SPACE.ch ? 'Move to channel…' : spacesOf(sid).length ? `Move to ${SPACE.one}…` : `Add to a ${SPACE.one}…`}</button>
      ${spacesOf(sid).map(space => `<button type="button" data-rsspace="${esc(space.id)}" data-add="false">${PIN_SVG}Remove from ${SPACE.ch ? 'channel' : SPACE.one} · ${esc(space.name)}</button>`).join('')}
      ${topicOn() ? `<button type="button" data-rsemo><span class="ch-sheet-emoji">${TOPIC.get(`thread:${sid}`, [subjectOf(s), s.title, s.preview].filter(Boolean).join(' '))}</span>Choose emoji</button>` : ''}`}
      ${acts.map(a => `<button type="button" data-rsact="${a}">${(nid ? NOTE_ACT : ACT)[a].icon}${nid ? NOTE_ACT[a].label + (grp && grp.length > 1 ? ` all ${grp.length}` : '') : actionLabel(s, a)}</button>`).join('')}
      ${acts.length ? '' : `<p class="ch-sheet-n">${isWorking(s) || ['waiting_for_approval', 'unknown'].includes(s.status) ? `${window.WizConfig.agent()} is still on this one.` : 'Nothing to file yet.'}</p>`}</div></div>`);
    rowSheet = { wid, sid, nid, trigger, grp };
    el.querySelector('.ch-sheet button')?.focus({ preventScroll: true });
    vib(10);
  }
  const emojiCategoryHtml = category => `<section class="ch-emoji-category"><h3>${esc(category.label)}</h3><div class="ch-emoji-grid">${category.emoji.map(emoji => `<button type="button" data-chtopicemoji="${emoji}" aria-label="Use ${emoji}">${emoji}</button>`).join('')}</div></section>`;
  const emojiRenderState = new WeakMap();
  function appendEmojiCategory(scroll) {
    const state = emojiRenderState.get(scroll); if (!state || state.index >= state.categories.length) return false;
    const sentinel = scroll.querySelector('[data-chemosentinel]');
    sentinel?.insertAdjacentHTML('beforebegin', emojiCategoryHtml(state.categories[state.index++]));
    if (state.index >= state.categories.length) sentinel?.remove();
    return true;
  }
  function startEmojiCategories(scroll, categories) {
    if (!scroll) return;
    const list = Array.from(categories || []);
    scroll.innerHTML = list.length ? '<span data-chemosentinel aria-hidden="true"></span>' : '<p class="ch-emoji-empty" role="status">No emojis found. Try another word.</p>';
    scroll.scrollTop = 0;
    emojiRenderState.set(scroll, { categories: list, index: 0 });
    appendEmojiCategory(scroll);
    scroll.onscroll = () => {
      const state = emojiRenderState.get(scroll);
      if (!state || state.index >= state.categories.length || scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 320) return;
      appendEmojiCategory(scroll);
    };
  }
  function renderEmojiSearch(sheet, query) {
    const results = TOPIC.search(query), scroll = sheet?.querySelector('[data-chemoresults]'), clear = sheet?.querySelector('[data-chemoclear]');
    if (!scroll) return;
    startEmojiCategories(scroll, results);
    if (clear) clear.hidden = !String(query || '').trim();
  }
  function openEmojiSheet(wid, key, label) {
    const el = track.querySelector(`[data-chats="${wid}"]`); if (!el || !key) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Choose topic emoji"><div class="ch-sheet-b ch-emoji-sheet"><div class="ch-sheet-t">${esc(label || 'Choose emoji')}</div><label class="ch-emoji-search"><span aria-hidden="true">⌕</span><input type="search" data-chemosearch aria-label="Search emojis" placeholder="Search emojis" autocomplete="off" autocapitalize="none" spellcheck="false"><button type="button" data-chemoclear aria-label="Clear emoji search" hidden>×</button></label><div class="ch-emoji-scroll" data-chemoresults></div></div></div>`);
    const scroll = el.querySelector('.ch-emoji-sheet [data-chemoresults]');
    startEmojiCategories(scroll, TOPIC.categories);
    rowSheet = { wid, key, emoji: true }; vib(8);
  }
  /* Rename sheet, sheets kept across repaints, length sheet; core/chats-sheets.js. */
  const { keptSheet, openLengthSheet, openRenameSheet, RENAME_SVG, restoreSheet, submitRename, bindLate: sheetsLate } = window.WizCore.chatsParts.sheets({ CH, chatVars, closeRowSheet, esc, H, LIVE, renderThreadNow, toast, track, W });
  chanuiLate({ RENAME_SVG });
  function closeRowSheet() {
    if (!rowSheet) return false;
    const trigger = rowSheet.trigger;
    H.root().querySelectorAll('.ch-sheet').forEach(n => n.remove()); rowSheet = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    return true;
  }
  /* Approvals in a thread and repainting around a field; core/chats-approvals.js. */
  const { approvalHtml, chooseApproval, loadApproval, rebuildAround } = window.WizCore.chatsParts.approvals({ ch, esc, KIT, LIVE, renderThreadNow, toast, W });
  function renderThreadNow(w) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && w.thread) renderThread(w, el); }
  /* Selecting text in a working thread; core/chats-select.js. */
  const { clearReading, readGuard, readingIn, scheduleHeld, SCROLL_IDLE, SEL, selectingIn, TOUCH } = window.WizCore.chatsParts.select({ ch, CH, flushHeld, idOf: (...a) => idOf(...a) });
  function renderThreadLive(w) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && w.thread) renderLive(w, el); }
  function renderLive(w, el) {
    const c = ch(w.id);
    if (selectingIn(el)) { c.held = true; return; }
    c.held = false; renderThread(w, el);
  }
  function flushHeld() {
    for (const id of Object.keys(CH)) {
      const c = CH[id], w = W[id]; if (!w || (!c.held && !c.heldList)) continue;
      const el = elOf(id); if (!el) { c.held = c.heldList = false; continue; }
      if (document.hidden) continue;
      if (w.thread) {
        c.heldList = false;
        if (c.held && !selectingIn(el)) { c.held = false; renderThread(w, el); }
      } else {
        c.held = false;
        if (c.heldList && !holdList(id)) renderChatList(w, el);
      }
    }
  }
  let selT = 0;
  document.addEventListener('wos-scroll-capture-end', () => queueMicrotask(flushHeld));
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection?.(), on = !!s && !s.isCollapsed;
    if (!on) SEL.since = 0; else if (!SEL.since) SEL.since = Date.now();
    clearTimeout(selT); selT = setTimeout(flushHeld, 250);
  });
  setInterval(flushHeld, 10000); // bounded recovery for lost touch/selection-end or an external sheet close
  const PAGE = 60;
  focusLate({ PAGE });
  trackerLate({ PAGE });
  /* Thread streaming and a thread's working state; core/chats-stream.js. */
  const { closeStream, keepLoadedImages, syncStream, threadState, bindLate: streamLate } = window.WizCore.chatsParts.stream({ agentName, agentRec, ago, elOf: (...a) => elOf(...a), esc, isWorking, LIVE, md, renderThreadLive, snoozeLast, stiKind, W });
  function renderThread(w, el, keep) {
    if (INC?.render(w.id, el)) return;
    if (H.renderView?.(w, el, () => renderThread(w, el, keep), 'thread')) return;
    ch(w.id).held = false; // explicit actions/navigation may repaint immediately
    const c = ch(w.id), isNew = w.thread === '__new__', s = isNew ? null : rowOf(w.id, w.thread);
    // The thread's own agent (pinned at creation); a new chat belongs to the window's agent.
    const TAG = isNew ? (winAgent(w) || (AGS()?.isOther(c.newModel?.agent) ? c.newModel.agent : '')) : (LIVE.agentOf ? LIVE.agentOf(w.thread) : '');
    // Unified Chats: a private agent's thread opened from the owner's main list says so in its header.
    const incognitoAction = isNew && INC && window.WizCore.incognitoOptIn?.enabled(agentRec(TAG)) ? '<button type="button" class="pbtn ch-incog-toggle" role="switch" aria-checked="false" data-incog-start aria-label="Incognito"><span>Incognito</span><span class="sw" aria-hidden="true"><i></i></span></button>' : '';
    const privTag = !winAgent(w) && TAG && AGS()?.isPrivate(agentRec(TAG)) ? `<span class="ch-privtag" data-wiz-private="" title="Private agent: ${esc(agentName(TAG))}">${AGS().lock()}<span>Private</span></span>` : '';
    const state = threadState(s, TAG), working = state.working, held = working && !!globalThis.WizReach?.restartHeld?.(s);
    const sub = isNew ? `Starts a new thread with ${agentName(TAG)}` : state.sub;
    const storedTurns = (c.loadedFor === w.thread || c.cachedFor === w.thread) && turnsCurrent(c, s) ? c.turns || [] : null;
    const turns = storedTurns && reconcileSent(storedTurns, OUTBOX ? OUTBOX.forThread(w.thread) : [], s);
    c.media = []; c.texts = [];
    let msgs;
    // A message the transcript on screen already shows is never drawn again below it as pending: reopening a thread
    // painted the cached transcript (your message, then the reply) and the outbox copy still "Sending…" under both
    // until the server read retired it (James, 23 Oct 2026).
    const pend = pendingFor(w).filter(p => !(turns && (localSent(turns, p) || echoed(turns, p) || retryShown(turns, p))));
    const carry = isNew && c.carry && TAG ? `<div class="ch-carry" role="note"><b>${AGS()?.lock?.() || ''}Continues “${esc(clip(c.carry.title, 60))}” privately</b><span>Your first message takes the last ${c.carry.n === 1 ? 'message' : `${c.carry.n} messages`} with it as quoted context. That thread stays as it is.</span><button type="button" data-chcarryx>Don’t include</button></div>` : '';
    const NV = isNew && !pend.length ? notifOf(w) : null;
    const noteBox = NV && el.dataset.notificationId === NV.id ? el.querySelector('.ch-msgs') : null;
    const notificationScroll = noteBox ? scrollBox(noteBox).scrollTop : 0;
    const NQ = !!NV && noteQuiet();
    if (NV) msgs = `<div class="msg a ch-notif" data-morph-key="notif:${esc(NV.id)}"><div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}<div class="mmeta">${NV.item?.time ? timeTag(NV.item.time * 1000) : ''}<span class="ch-notif-src">${NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.app ? esc(NV.item.appName || NV.item.app) : 'Notification'}</span></div></div>`;
    if (NQ) msgs = noteStackHtml(NV, `<div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}`, noteTactsHtml(NV, true));
    // The rest waiting from the same app, under it (its row in the list was one fold), with Done all.
    if (NV) msgs += noteMoreHtml(NV);
    // The same Badge | Chats picker as Settings › Notifications, above the notification.
    if (NV) msgs = noteRouteHtml(NV) + msgs;   // (quiet: its own line already sits under the note)
    else if (isNew && !pend.length) msgs = newChatHtml(TAG) + `<div class="ch-empty nc-classic"><b>${TAG && AGS()?.isPrivate(agentRec(TAG)) ? `New private chat` : 'New chat'}</b><br>${esc(H.newChatHint || 'Type below.')}</div>${carry}`;
    // A thread answered 404 in this open is gone: that verdict wins over cached turns and queued sends.
    else if (!isNew && c.goneFor === w.thread && c.goneNav === c.readNav && !threadAlive(w, w.thread)) msgs = threadErrHtml(c);
    else if (!turns && !isNew && !pend.length) msgs = c.err && (c.failN > 1 || c.err !== 'Couldn’t load this thread') ? threadErrHtml(c) : skelThread();
    else {
      const all = turns || [];
      if (c.showFor !== w.thread) {
        const shown = PW?.RP.read(w.thread)?.shown;
        c.show = Number.isInteger(shown) ? Math.max(PAGE, Math.min(all.length, shown)) : PAGE; c.showFor = w.thread;
      }
      const from = Math.max(0, all.length - c.show), shown = all.slice(from);
      let day = '';
      // A named failure reason (wizard/failure-reason tweak) is a notice in the failed panel, not a Wizard reply:
      // it hides Hermes' generic failed_turn bubble and the duplicate "Reply not sent" line.
      const runErr = !working && !!window.WosModels?.runError?.(s);
      // Issue 1500: a send that failed on a signed-out/expired subscription shows the Reconnect card only, never Hermes'
      // generic "not processed… send it again" line above it.
      const signedOut = !working && !!PW?.signedOutFail?.(s);
      // Issue 1235: a chat another app owns (Telegram, Slack …) refuses every reply, so its Not sent bubble has no
      // Retry and the clear card shows at once: on a failed thread or a Not sent message, without waiting for the
      // Service's words (they used to land about a minute after the generic Needs retry panel).
      const foreign = window.WosModels?.foreignApp?.(s) || '';
      const refused = !working && !!foreign && (['failed', 'interrupted'].includes(s?.status) || !!s?.safeError
        || shown.some(tn => ['failed', 'interrupted'].includes(tn.u?.queue?.status)));
      c.retryRunId = !working && !foreign && s?.retryRunId || ''; // the saved request a Not sent bubble's Retry sends (turnHtml)
      // Renames show where they happened ("Renamed from …"), so the old name still finds its place in the thread.
      const firstAt = shown.length ? turnAt(shown[0]) : Infinity;
      const rns = (s?.renames || []).map(r => ({ ...r, ms: r.at * 1000 })).filter(r => from === 0 || !(r.ms < firstAt)).sort((a, b) => a.ms - b.ms);
      const rnHtml = r => `<div class="ch-renamed"><span>${r.by === 'you' ? 'You renamed this from' : 'Renamed from'} “${esc(r.from)}”</span></div>`;
      const rnBefore = at => { let out = ''; while (rns.length && isFinite(at) && rns[0].ms <= at) out += rnHtml(rns.shift()); return out; };
      const need = typeof needsMark === 'function' && !isNew && s ? needsMark(w.id, w.thread, s, shown) : { k: -1, html: '' }; // issue 1331
      c.restartHeld = held; // turnHtml: a held send's last turn is not live (wizard-ux issue 1362)
      c.stopping = s?.status === 'stopping'; // turnHtml: the live work line says Stopping… from the tap (issue 1576)
      msgs = (from > 0 ? `<button type="button" class="ch-earlier" data-chearlier>Load earlier messages · ${from} more</button>` : '')
        + shown.map((tn, k, arr) => {
          const at = turnAt(tn), dk = KIT.time.dayKey(at);
          const div = dk && dk !== day ? `<div class="ch-day"><span>${esc(KIT.time.day(at))}</span></div>` : '';
          if (dk) day = dk;
          return rnBefore(at) + div + turnHtml(c, tn, k === arr.length - 1, working, s?.helperStatus, s?.reconnect || !!runErr || signedOut, !!globalThis.WosThreadTracker?.onFor?.(TAG) || (typeof replyStd === 'function' && replyStd(TAG)), k === need.k ? need.html : '');
        }).join('')
        + rns.splice(0).map(rnHtml).join('')
        + (refused ? `<div class="appr" role="status" data-chrefused><b>Reply not sent</b><p>${esc(window.WosModels.refusal(s))}</p>${['failed', 'interrupted'].includes(s?.status) ? '<div class="appr-b"><button type="button" class="no" data-chdismiss>Dismiss</button></div>' : ''}</div>`
          : (!runErr && !signedOut && s?.safeError && !s?.reconnect && s?.queueReason !== 'provider_access' ? `<div class="appr" role="status"><b>Reply not sent</b><p>${esc(s.safeError)}</p></div>` : ''))
        + approvalHtml(c, s)
        + pend.map(p => pendingHtml(p, c, s)).join('')
        // A send a graceful restart holds: one quiet saved line, never a Working timer (wizard-ux issue 1362).
        + (held ? `<div class="ch-held-line" role="status" data-restart-held>${STI.held}<span>Saved · sends after Wizard restarts</span></div>` : '')
        + (pend.some(p => ['queued', 'sending', 'waiting'].includes(p.state)) && !working ? `<details class="steps live"><summary><i class="dots"><b></b><b></b><b></b></i> ${pend.some(p => p.state === 'waiting') ? 'Waiting for Wizard · will retry' : 'Sending'}</summary></details>` : '');
    }
    // The Daily view (issue 1469): earlier days folded above the open day, an empty Today under it before today's first post.
    const DL = !NV && typeof dailyHtml === 'function' ? dailyHtml(w, c) : null;
    if (DL) msgs = isNew && !pend.length ? DL.above + DL.below : DL.above + msgs + DL.below;
    msgs += syncStream(w, c, turns, TAG);
    // A saved copy painted after a failed read says so, so it never passes for a fresh one.
    // Only within the open whose read failed; the next good read clears it.
    if (!isNew && turns && c.savedFor === w.thread && c.savedNav === c.readNav)
      msgs += `<div class="ch-renamed ch-saved" role="status"><span>Saved copy${c.savedAt ? ' from ' + esc(new Date(c.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : ''} · can’t reach Wizard right now</span></div>`;
    const acts = isNew ? [] : threadActions(s, turns);
    const box = el.querySelector('.ch-msgs');
    PW?.capture(box); // save the shared eye-line record before rows above it change
    const dkey = draftKey(w);
    // Only the thread's own box counts: a channel feed's box left in this element (Back from a post lands on its feed)
    // holds that channel's words, never this thread's (wizard-ux issue 1444: the thread's draft showed as the emptied box).
    const ta0 = el.querySelector('textarea'), oldTa = ta0 && !ta0.closest?.('[data-chchanform]') ? ta0 : null;
    const draft = oldTa && el.dataset.draftFor === dkey ? oldTa.value : (c.draftFor === dkey ? c.draft || '' : loadDraft(w));
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    // Live status/model paints must not replace a sealed dictation target in this same composer.
    // Navigation to another thread still destroys it: never transfer a seal to the new draft.
    // Same draft = same textarea: live repaints (new steps in a working thread) reuse the owner's field so the caret,
    // selection, undo history and scroll stay put. James, 21 Oct 2026: typing at the bottom of a long reply in a working
    // thread, every repaint threw the box back to the top. Navigation to another thread still gets a fresh field.
    const keepTa = oldTa && el.dataset.draftFor === dkey ? oldTa : null;
    const keepRange = keepTa && [keepTa.selectionStart, keepTa.selectionEnd, keepTa.selectionDirection];
    const keepScroll = keepTa ? keepTa.scrollTop : 0;
    // Stop shows the moment a send is pending (Sending…/Starting…, upload, transcription), not only once the run
    // id arrives: before the run exists it withdraws the send (LIVE.cancelSend), after that it stops the run.
    const canStop = working && !held && s.status !== 'stopping' && (!!s.runId || s.pend !== undefined); // a send a restart holds is saved, not running (issue 1432)
    const rpl = !(isNew && TAG) ? KIT.drafts.get(dkey).reply : null; // an app item (Notifications, Wisdom passage) waiting with this draft
    PW?.ensureModels();
    // The model lives in the message box, bottom-right (James 18 Oct 2026); the header keeps the whole width for the title.
    // Miguel's skins (Dark, Light, Landscapes): a slide switch row above the composer replaces the in-box label.
    const msw = PW?.modelSwitch && s !== undefined ? PW.modelSwitch(w, s) : '';
    const mlabel = PW?.modelLabel && !msw ? PW.modelLabel(w, s) : '';
    const chip = PW && !PW.modelLabel ? PW.modelChip(w, s) : '';
    const fail = PW && !isNew && turns ? PW.failureHtml(w, s) : '';
    const tacts = NV ? (NQ ? '' : noteTactsHtml(NV, false))
      : acts.length && turns && !pend.length ? `<div class="ch-tacts" data-part="thread-actions">${typeof needsAsk === 'function' && needsAsk(s) && canMarkDone(s) ? `<button type="button" class="ch-tact-md" data-chmarkdone aria-label="Mark done: clear Needs you" title="Mark done">${MARK_DONE_SVG}<span>Mark done</span></button>` : ''}${acts.map(a => `<button type="button" data-chact="${a}" aria-label="${ACT[a].hint}" title="${ACT[a].hint}">${ACT[a].icon}<span>${actionLabel(s, a, true)}</span></button>`).join('')}</div>` : '';
    clearReading(w.id);
    // Live repaints rebuild the thread. Keep each already-loaded photo node so it doesn't blank and reload (flicker).
    const keepImgs = keepLoadedImages(el);
    const keepSheet = keptSheet(el);
    const openContexts = el.dataset.draftFor === dkey ? new Set([...el.querySelectorAll('[data-run-original][open]')].map(e => e.dataset.runOriginal)) : new Set();
    const threadHTML = `<div data-part="thread" class="ch-thread${TAG ? ' agent' : ''}${NV ? ' ch-notif-thread' : ''}"${TAG ? ` style="--agc:${AGS()?.colour(agentRec(TAG)) || ''}"` : ''}>
      <div class="ch-head"><button class="ch-back" data-chback aria-label="Back to threads"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>${s && !isNew && stiKind(s) !== 'none' ? stiBadge(s, ' ch-head-sti') : ''}<div class="ti" title="${esc(sub)}">${s && !DL ? `<button type="button" class="ti-b" data-chrename aria-label="Rename thread"><b>${esc(winTitle(w))}</b></button>` : `<b>${esc(NV ? NV.reply.title || NV.item?.title || 'Notification' : DL ? (typeof chanTitle === 'function' ? chanTitle(dailyName(w)) : '# ' + dailyName(w)) : winTitle(w))}</b>${NQ ? `<span class="ch-notif-hsrc"><span class="ch-notif-hic" aria-hidden="true">${NV.item ? noteIcon(NV.item) : window.WosBell?.icon || ''}</span>${esc(NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.appName || NV.item?.app || 'Notifications')}${NV.item?.time ? ` · ${timeTag(NV.item.time * 1000)}` : ''}</span>` : ''}`}${privTag}</div>${chip}${incognitoAction}${typeof inboxHeadHtml === 'function' && s && !isNew ? inboxHeadHtml(w, s) : ''}<span data-slot="thread-header-actions"></span></div>
      ${s && !isNew && globalThis.WosThreadTracker?.on() ? globalThis.WosThreadTracker.stripHtml(s.id, TAG) : ''}${s && BOOM() ? BOOM().banner(s.id) : ''}<div class="ch-msgs">${msgs}${tacts}${fail}</div>${PW ? PW.latestBtn() : ''}${s && !isNew && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}
      ${msw ? `<div class="ch-swrow">${msw}<span data-slot="thread-switch-row-end"></span></div>` : '<div data-slot="thread-switch-row-end"></div>'}<form data-slot="composer-end" data-part="composer" class="ch-compose${hasContent(draft, c.files || []) ? ' has-text' : ''}${rpl ? ' has-reply' : ''}" data-chform>${replyBubble(rpl)}${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach photos or files">${CLIP_SVG}</button><div class="ch-field"><textarea rows="1" placeholder="${!isNew && window.WosModels?.foreignApp?.(s) ? `This chat lives in ${esc(window.WosModels.foreignApp(s))} · reply there` : working && !held ? `Steer ${esc(agentName(TAG))}…` : `Message ${esc(agentName(TAG))}`}" enterkeyhint="enter">${esc(draft)}</textarea>${mlabel}</div>${PW ? PW.micBtn(w.id) : ''}${canStop ? `<button type="button" class="ch-stop" data-chstop aria-label="Stop ${esc(window.WizConfig.agent())}"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>` : ''}<button type="submit" class="ch-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </div>`;
    // A focused composer must never leave the page during a live repaint: iPhone Safari closes the keyboard the
    // moment a focused field is detached and will not reopen it from script, so the owner saw a caret and no
    // keyboard in any working thread (Miguel, 22 Oct 2026). Rebuild everything around the field instead.
    // A live repaint of the same thread (new step, helper timer, streamed words) patches only what changed: messages,
    // photos, the composer field (focus, caret, keyboard) and the reading place stay exactly as they are
    // (James, 23 Oct 2026: whole-thread rebuilds flickered while a reply was working).
    const troot = el.firstElementChild;
    const morphed = !!keepTa && troot?.dataset.part === 'thread' && troot.contains(keepTa) && !!window.WosMorph?.morph(troot, threadHTML, {
      keep: (n, f) => { if (n !== keepTa) return false; const ph = f.getAttribute('placeholder'); if (ph !== null && n.placeholder !== ph) n.placeholder = ph; return true; },
    });
    if (!morphed) {
      if (!(keepTa && hadFocus && rebuildAround(el, threadHTML, keepTa))) {
        el.innerHTML = threadHTML;
        if (keepTa) { const fresh = el.querySelector('.ch-compose textarea'); keepTa.placeholder = fresh.placeholder; fresh.replaceWith(keepTa); }
      }
      restoreSheet(el, keepSheet);
    }
    for (const detail of el.querySelectorAll('[data-run-original]')) if (detail.open !== openContexts.has(detail.dataset.runOriginal)) detail.open = openContexts.has(detail.dataset.runOriginal);
    if (!morphed) keepImgs(el);
    el.dataset.draftFor = dkey; c.draft = draft; c.draftFor = dkey;
    el.dataset.notificationId = NV?.id || '';
    syncDocumentThread();
    const nb = el.querySelector('.ch-msgs');
    PW?.position(w, el, nb, { turns, working, notification: NV?.id, notificationScroll });
    watchTracker(w, nb);
    if (hadFocus) { const ta = el.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...(keepRange || [ta.value.length, ta.value.length])); }
    growTa(el.querySelector('textarea'));
    // Re-attaching a field resets its scroll to the top; put the owner's view back where it was.
    if (keepTa && !morphed) keepTa.scrollTop = keepScroll;
    // Desktop renders before revealing its thread pane. Measure once it is visible,
    // retaining a usable first layout even before the user types or a live repaint runs.
    const field = el.querySelector('textarea');
    requestAnimationFrame(() => { if (field?.isConnected && field === el.querySelector('textarea')) growTa(field); });
    PW?.paint(w.id, el);
    if (DL && typeof dailyWatch === 'function') dailyWatch(w, el);
    // A returned message Boomerang opens on its message, once.
    if (s && turns && !keep) { const r = BOOM()?.focusFor(s.id); if (r && showBoomMessage(el, r.anchor_at)) BOOM().focusedOn(r.id); }
    // The shell may bind the view this thread's latest reply links (phone: bound views beside the thread).
    if (!isNew && turns) H.threadShown?.(w.id, el);
    window.WosSkinHost?.rendered('thread', el);
  }
  /* ---- drafts: one per thread (and one for a new chat), kept across reloads ---- */
  // An agent's new chat keeps its own slot ('agentnew:<id>'), so it never shows in (or takes) the main Drafts.
  const draftKey = w => w.thread === '__new__' ? (winAgent(w) ? 'agentnew:' + winAgent(w) : 'new') : (!w.thread && typeof chanDraftKey === 'function' && chanDraftKey(w)) || 'direct:' + w.thread;
  function loadDraft(w) {
    const c = ch(w.id), key = draftKey(w), d = KIT.drafts.get(key);
    c.draftFor = key; c.draft = d.text;
    c.files = d.files.map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    return d.text;
  }
  // Saves the window's box only while its words belong to the box the window now shows (c.draftFor): stale words of
  // another box (a channel's, a thread left) never write over, or empty, this box's draft (wizard-ux issue 1444).
  function saveDraft(wid) { if (INC?.active(wid)) return; const w = W[wid], c = ch(wid); if (!w || (!w.thread && !(typeof chanDraftKey === 'function' && chanDraftKey(w)))) return; const key = draftKey(w); if (c.draftFor !== key) return; KIT.drafts.set(key, c.draft || '', c.files || []); }
  /* Typing into a composer, opening media, pull to refresh; core/chats-pull.js. */
  const { bindPull, openMedia, repaintList, typedInto, bindLate: pullLate } = window.WizCore.chatsParts.pull({ ch, chanUser, chatVars, draftKey, H, INC, KIT, LIVE, renderChatList, saveDraft, toast, vib, W, winAgent });
  /* Long-press or swipe left on a thread row → thread actions (listeners in bind()). */
  let lp = null, lpUntil = 0, lpHeld = null;
  /* Gmail-style swipe (Novaire, 23 Oct 2026): in the Novairecito phone skin family, swipe a row left and it stays
   * open over two explicit buttons: Recall (🪄, schedule a return) and Done (Archive, restorable). Swiping never
   * performs an action. Tapping elsewhere, scrolling or swiping back closes it; list repaints wait while open. */
  let swipeOpen = null; // { wid, sid, wrap }
  /* Swipe and long-press on a thread row; core/chats-swipe.js. */
  const { bindGestures, closeSwipe, echoed, loadThread, localSent, pendingFor, pendingHtml, reconcileSent, renderChats, retryShown, threadAlive, threadErrHtml, turnsCurrent, bindLate: swipeLate } = window.WizCore.chatsParts.swipe({ ACT, addFiles, BOOM, ch, CH, chanScrolled, chatVars, CHECK_SVG, esc, eventsLate, flushHeld, H, INC, isWorking, KIT, LIVE, loadApproval, md, MIC_SVG, needsLand, openRowSheet, OUTBOX, paintFeedJump, PEND, queueListPlace, reach, reachLabel, readGuard, renderChatList, renderLive, renderThread, renderThreadLive, repaintList, replyCard, ROW_MENU, rowactsLate, rowMenu, rowOf, scheduleHeld, SCROLL_IDLE, SEL, setupLate, streamLate, syncListTitle, threadAct, threadActions, toast, toTurns, TOUCH, track, troubleshoot, userMedia, vib, W });
  readylistLate({ renderChats });
  spacesLate({ renderChats });
  sheetsLate({ renderChats });
  /* Thread trail: a thread opened from a link inside another thread remembers where it came from, so Back,
   * Done and Defer step back to that thread instead of the list (James clicks through a summary thread's links,
   * reviews each one, taps Done, and lands back on the summary). Opening a thread any other way starts a fresh trail. */
  function openChat(wid, sid, opts = {}) {
    window.WizCore.chatSearch?.park(wid); // Back returns to these results, not a fresh search
    const w = W[wid]; if (!w) return;
    if (INC?.active(wid) && !INC.close(wid)) return;
    if (opts.via === 'link' && w.daily && typeof dailyLinkTo === 'function' && dailyLinkTo(w, sid)) return; // issue 1469
    if (!w.thread) { const c0 = ch(wid), place = c0.listPending || listPlace(elOf(wid)); c0.listPending = null; if (place) c0.listPlace = place; }
    const listOrder = archiveListOrder(wid, sid);
    if (w.thread) saveDraft(wid);
    closeRowSheet();
    const c = ch(wid); c.archiveOrder = listOrder; c.approval = null; c.cachedFor = ''; // a cached paint belongs to one open only
    c.err = ''; c.failN = 0; clearTimeout(c.retryT); // a read error belongs to the thread that failed, never the next one opened
    c.readNav = (c.readNav || 0) + 1;
    if (w.thread !== sid) H.threadShown?.(wid, null); // close the old preview immediately, even while the new thread loads
    if (opts.via === 'link' && w.thread && w.thread !== '__new__' && w.thread !== sid) {
      // A thread left from the Daily view comes back in it (issue 1653): the same earlier days above, so the same place.
      // Kept per trail entry (index-aligned with the trail; the trail can hold one thread twice, once in each view).
      const t = c.trail || [], td = (c.trailDaily || []).slice(0, t.length); while (td.length < t.length) td.push(null);
      td.push(typeof dailyOn === 'function' && dailyOn(w) ? { sid: w.thread, id: w.daily.id, agent: w.daily.agent } : null);
      c.trail = t.concat(w.thread).slice(-20); c.trailDaily = td.slice(-20);
    } else if (!opts.keepTrail) c.trail = [];
    PW?.opened(wid, sid, !!opts.back);
    if (sid === '__new__' && w.thread !== '__new__') c.newAt = Date.now(); // a fresh new chat: nothing older shows in it
    w.thread = sid; save(); loadDraft(w);
    if (typeof dailyClaim === 'function') dailyClaim(w, sid); // issue 1469: a Daily tap's thread shows the Daily view
    if (typeof jumpOpened === 'function') jumpOpened(wid, sid, typeof chanSeenRow === 'function' && sid !== '__new__' ? chanSeenRow(wid, sid) : null); // issue 1359: green = unread when opened
    if (sid !== '__new__') { LIVE.markSeen(typeof chanSeenRow === 'function' ? chanSeenRow(wid, sid) : sid); if (typeof chanSeenPaint === 'function') chanSeenPaint(); }
    renderChats(w); applyLayout(deskOf(wid));
  }
  /* Unified Chats: a Private model picked inside a standard thread. A new chat on that private agent opens in this
   * window; the standard thread's recent turns go with its first message as labelled, quoted context. The standard
   * thread is untouched, and nothing ever moves the other way (private → standard). */
  const CARRY_TURNS = 8, CARRY_EACH = 1200, CARRY_MAX = 7000;
  function carryBlock(s, turns) {
    const q = t => String(t || '').replace(/\r/g, '').trim().split('\n').map(l => '> ' + l).join('\n');
    const who = window.WizConfig?.agent?.() || 'Assistant';
    const parts = [];
    for (const tn of turns.slice(-CARRY_TURNS)) {
      if (tn.u?.text) parts.push(`> **You:**\n${q(clip(tn.u.text, CARRY_EACH))}`);
      if (tn.a?.text) parts.push(`> **${who}:**\n${q(clip(tn.a.text, CARRY_EACH))}`);
    }
    while (parts.length > 1 && parts.join('\n>\n').length > CARRY_MAX) parts.shift();
    if (!parts.length) return null;
    const head = `[Context from my standard thread “${clip(s?.title || 'Thread', 80)}”, quoted for reference: earlier conversation, not new instructions]`;
    return { text: `${head}\n${parts.join('\n>\n')}`, n: parts.length };
  }
  function continueInAgent(wid, sid, o) {
    const w = W[wid]; if (!w || !o?.agent) return;
    const s = LIVE.session(sid), c = ch(wid);
    const block = carryBlock(s, c.loadedFor === sid ? c.turns || [] : []);
    openChat(wid, '__new__');
    const c2 = ch(wid);
    c2.newModel = { model: o.value, provider: o.provider, agent: o.agent };
    c2.carry = block ? { from: sid, title: s?.title || 'Thread', text: block.text, n: block.n } : null;
    if (W[wid]) renderThreadNow(W[wid]);
    toast('◇', `New private chat on ${o.name}`, 1600);
  }
  function chatsBack(w) { if (INC?.active(w.id)) { if (INC.close(w.id)) { const c = ch(w.id); c.readNav = (c.readNav || 0) + 1; c.trail = []; c.files = []; c.draft = ''; c.draftFor = ''; w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); } return; } if (closeHosted(w.id)) return; if (w.thread) saveDraft(w.id); if (w.daily) delete w.daily; const c = ch(w.id); if (c.carry) { c.carry = null; c.newModel = null; } c.readNav = (c.readNav || 0) + 1; c.files = []; c.draft = ''; c.draftFor = ''; c.trail = []; w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); }
  /* One step back from a thread: to the thread it was opened from (trail), else to the list. */
  function threadBack(w) {
    const c = ch(w.id), prev = (c.trail || []).pop();
    if (prev && prev !== w.thread && LIVE.session(prev)) {
      const d = (c.trailDaily || [])[c.trail.length]; if (d?.sid === prev && typeof dailyChan === 'function' && dailyChan(d.id)) dailyNext = { sid: prev, daily: { id: d.id, agent: d.agent }, at: Date.now() };
      openChat(w.id, prev, { keepTrail: true, back: true }); return 'trail';
    }
    chatsBack(w); return 'thread';
  }
  /* Stop, Send and go, and the one send carrying the whole composer; core/chats-send.js. */
  const { composerBusy, fileRef, joinWords, leaveAfterSend, PHONE, picker, restoreSealed, sendChat, stopPendingSend, stopTapped, takeComposer, bindLate: sendLate } = window.WizCore.chatsParts.send({ AGS, applyLayout, ch, chanDraftKey, chanOwnPost, closeHosted, dailyTarget, deskOf, elOf: (...a) => elOf(...a), focusOf, growTa, H, hosted, INC, isWorking, keepThreadOpen, KIT, LIVE, needsReplied, openChat, openHosted, OUTBOX, PEND, pendRef, refreshCompose, refreshReply, renderChats, renderThreadNow, save, setDraft, spaceMember, syncSend, threadBack, toast, viewContext, W, winAgent });
  readylistLate({ PHONE });
  spacesLate({ sendChat });
  chanboxLate({ sendChat });
  let pickFor = '';
  /* Fitting a long label into its button; core/chats-fitlabel.js. */
  const { fitLabel } = window.WizCore.chatsParts.fitlabel({ addFiles, picker, pickFor, W });
  function growTa(ta) {
    if (!ta) return;
    const top = ta.scrollTop; // collapsing to 'auto' to measure clamps the scroll; keep the owner's view
    ta.style.height = 'auto';
    if (ta.getClientRects().length && ta.clientWidth) ta.style.height = Math.min(Math.max(42, ta.scrollHeight + 2), 140) + 'px';
    fitLabel(ta);
    if (ta.scrollTop !== top) ta.scrollTop = top;
  }
  /* Presence, clicks inside a Chats window, composer events, text from outside, forget; core/chats-bind.js. */
  const { bind, click, closeFilterSheet, closeOverlay, elOf, forget, holdList, idOf, insertText, justPressed, markVisibleThreadsSeen, registerBack, bindLate: bindLate } = window.WizCore.chatsParts.bind({ activityClick, actSetOrder, AGS, alertFeedback, bindGestures, bindPull, BOOM, byStatus, ch, CH, chanDropSending, chanEditUnsent, channelClick, channelSend, chanRepaint, chanRowAgent, chanSeenRow, chanSetEmoji, chatsBack, chatVars, chooseApproval, clearAll, clearReading, closeHosted, closeRowSheet, closeSpacePicker, closeStream, closeSwipe, COMPACT_KEY, compactOn, dailyClick, desks, discardDraft, draftKey, focusAgents, focusedAgent, focusOf, growTa, H, idx, inboxMove, INC, isHosted, jumpGo, jumpToMessage, keepThreadOpen, KIT, listSaveT, LIVE, loadThread, markDone, moveSubject, nextOrder, noteRowAct, notifDoneAll, notifRoute, openChat, openEmojiSheet, openLengthSheet, openMedia, openNewDraft, openRenameSheet, openSpacePicker, OUTBOX, owner, PAGE, paintPins, PHONE, picker, PIN, PINS_KEY, pinsOn, quoteMessage, readingIn, READY_ORDER_KEY, READY_ORDERS, refreshCompose, refreshReply, rememberedFocus, renderChatList, renderChats, renderEmojiSearch, renderThread, renderThreadLive, renderThreadNow, replyStd, rerenderList, resumeTracked, ROW_MENU, rowMenu, runningBack, runningGo, runningOn, saveDraft, sendChat, setDraft, setFocus, setSummaryOpen, showBoomMessage, SPACE, spaceMember, spaces, stopPendingSend, stopTapped, submitChannelRename, submitRename, sweepAnswer, sweepLater, sweepYesToAll, syncSend, threadAct, threadBack, toast, toggleSection, toggleVoice, TOPIC, topicOn, typedInto, UPLOAD_ABORT, vib, W, winAgent, WORKING_ORDERS });
  focusLate({ elOf });
  agentrowsLate({ elOf, holdList });
  chanreadLate({ elOf, holdList });
  chanuiLate({ elOf, holdList });
  readylistLate({ elOf, holdList });
  spacesLate({ elOf, idOf });
  pullLate({ elOf, holdList, idOf });
  swipeLate({ elOf, idOf });
  // Put words (and already-uploaded files) back into a composer, e.g. editing an unsent message.
  function setDraft(wid, text, files) {
    if (INC?.active(wid)) { toast('!', 'Close Incognito before opening a saved draft', 2200); return; }
    const w = W[wid], c = ch(wid); if (!w) return;
    c.draft = text || ''; c.files = (files || []).map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') && f.id ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    c.draftFor = draftKey(w); saveDraft(wid);
    const el = elOf(wid); if (el) delete el.dataset.draftFor;
  }
  // Models, Errors actions, composer mic, work receipts, reading position, Files (core/chat-power.js).
  const PW = window.WosChatPower ? window.WosChatPower({ CH, ch, toast, H, md, KIT, MIC_SVG, WORKING_ST, isWorking, scrollBox, threadOnScreen, threadViewportTop, elOf, owner, vib, renderChats, renderThreadNow, renderThreadLive, openChat, refreshCompose, saveDraft, closeRowSheet, leaveAfterSend, takeComposer, continueInAgent, winAgent, chanOpen, paintJump, chanSpaceOf, spaceMember, chanOwnPost, chanBox: wid => (W[wid] && chanDraftKey(W[wid])) || '', chanModel: wid => chanModel(W[wid]), setChanModel }) : null;
  focusLate({ PW });
  bindLate({ PW });
  chanboxLate({ PW });
  sendLate({ PW });
  doneLate({ PW });
  attachLate({ PW });
  trackerLate({ PW });
  restoreSealed();
  // Chats lists show new chats still in the outbox (Sending): repaint open lists when that set changes.
  let outSig = '';
  addEventListener('wizreachchange', () => {
    for (const id of Object.keys(CH)) { const w = H.win(id), el = elOf(id); if (!w || !el) continue; if (w.thread) renderThreadLive(w); else if (!holdList(id)) renderChatList(w, el); }
  });
  OUTBOX?.onChange(() => {
    restoreSealed();
    for (const it of OUTBOX._items.values()) if (it.durable && it.sealKey) KIT.drafts.clear(it.sealKey);
    const sig = OUTBOX.unsent().filter(it => it.kind === 'new' || it.kind === 'reply').map(it => it.id + ':' + it.state + ':' + (it.error || '')).join(',');
    if (sig === outSig) return; outSig = sig;
    for (const id of Object.keys(CH)) { const w = H.win(id), el = elOf(id); if (w && w.app === 'chats' && !w.thread && el && !holdList(id)) renderChatList(w, el); }
  });
  const tweakModel = (wid, choice, alive) => PW?.tweakModel(wid, choice, alive);
  return { beforeNavigate: ids => INC?.beforeNavigate(ids) ?? true, beforeLeave: (id, checkOnly = false) => !INC?.active(id) || INC.close(id, false, checkOnly), incognitoActive: id => !!INC?.active(id), tweakModels: wid => PW?.tweakModels(wid), tweakModel, openHosted, prepThread, closeHosted, isHosted, CH, ch, click, bind, PW, listTitle, modelRoute: (wid, sid, box) => { const nm = sid !== '__new__' ? null : box ? boxModel(box) : chanDraftKey(W[wid]) ? chanModel(W[wid]) : PW?.newModel(ch(wid)); return window.WosModels.snapshot(sid === '__new__' ? '' : sid || '', nm, sid === '__new__' ? (winAgent(W[wid]) || nm?.agent || '') : ''); }, winAgent, agentRec, leaveAfterSend, takeComposer, composerBusy, joinWords, sendVoiceTo: (...a) => { if (INC?.active(a[0])) { toast('!', 'Incognito is text only', 2200); return null; } return PW?.sendVoiceTo(...a); }, insertText, lookupScope, forget, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, threadBack, setFilter, clearFilter, readyBack, channelBack, chanOpen, channelOf, activityNeeds: actNeeds, activityUnread: actUnread, activityMark: actMark, activityDraft: s => channelsOn() && rowDraft(s), agentLabelOf, moveToChannel, chanSpaceOf, chanCompose, chanView: () => channelsOn() ? chanView : '', chanBox: wid => (W[wid] && chanDraftKey(W[wid])) || '', chanModel: wid => chanModel(W[wid]), boxModel, setChanModel, setFocus, focusOf, focusMatches, focusRows, focusAgentId, addFilter, hasFilter, clearAll, setQuery, matchFilters, subjects, closeFilterSheet, sendChat, uploadFile,
    refreshCompose, toggleVoice, growTa, markVisibleThreadsSeen, addFiles, toTurns, md, MIC_SVG, CLIP_SVG, WORKING_ST, isWorking,
    registerBack, KIT, threadAct, threadActions, stiKind, notifOpen: wid => notifOf(W[owner(wid)])?.id || '', openRowSheet, openRenameSheet, closeRowSheet, closeOverlay, holdList, justPressed, setDraft, saveDraft, openNewDraft, openContextDraft, newDrafts, canMarkDone, markDone };
};
