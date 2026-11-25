/* Wizard UX core: Chats › channel list: which channels a list shows and in what order, a row's channel, a post's
 * place in its feed, opening a channel and Back from it. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.channels = function ({ agentName, AGS, CHAN_ARCHIVE_PRUNE_DAYS, CHAN_DAY, CHAN_GENERAL, chanAgentId, chanPrefs, chanStore, focusAgents, focusedAgent, focusOf, H, LIVE, openDaily, owner, save, setFocus, spaceAgent, spaceContains, spaces, spacesOf, visibleSpaces, W }) {
  let chanHold, chanUserAt, runningBack, sentBack; // late-bound: chats.js declares these after the call, see bindLate
  // The channel a window's list draws as a feed, or null. It only holds while the Focus still matches it (a Focus
  // tap elsewhere simply leaves the feed).
  function chanOpen(w) {
    if (!w) return null;
    const o = W[owner(w.id)] || w, c = o.chan, f = focusOf(o);
    if (!c || typeof c.id !== 'string') return null;
    if (c.id === CHAN_GENERAL) return f?.kind === 'space' ? null : { id: CHAN_GENERAL, name: 'General', general: true };
    // An agent's feed (issue 1336): every thread with that agent, while its Focus holds.
    const ag = typeof chanAgentId === 'function' ? chanAgentId(c.id) : '';
    if (ag) return f?.kind === 'agent' && f.key === ag ? { id: c.id, name: typeof agentName === 'function' ? agentName(ag) : ag, agent: ag, agentFeed: true } : null;
    const sp = f?.kind === 'space' && f.key === c.id && spaces().find(s => s.id === c.id);
    return sp ? { id: sp.id, name: sp.name, agent: spaceAgent(sp) } : null;
  }
  const chanByName = dir => (a, b) => dir * String(typeof chanFace === 'function' ? chanFace(a.name).label || a.name : a.name).localeCompare(String(typeof chanFace === 'function' ? chanFace(b.name).label || b.name : b.name), undefined, { sensitivity: 'base', numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // The channels the list shows: the Spaces of the Focus's agent (all visible agents' on All). Pinned first in pin
  // order, then A–Z (default) or Z–A, General last; { archived: true } gives the archived ones, sorted the same way.
  function channelsFor(w, { archived = false } = {}) {
    const ag = focusedAgent(focusOf(w)), p = chanPrefs(), pin = new Map(p.pins.map((id, i) => [id, i]));
    const mine = (ag ? spaces().filter(s => spaceAgent(s) === ag) : visibleSpaces()).map(s => ({ id: s.id, name: s.name, agent: spaceAgent(s) })).filter(c => !!p.archived[c.id] === archived);
    const byName = chanByName(p.sort === 'za' ? -1 : 1);
    if (archived) return mine.sort(byName);
    return mine.filter(c => pin.has(c.id)).sort((a, b) => pin.get(a.id) - pin.get(b.id)).concat(mine.filter(c => !pin.has(c.id)).sort(byName), { id: CHAN_GENERAL, name: 'General', general: true });
  }
  // The row's own owner (a main and a routed thread can share an id), else the id-only pin.
  const rowAgent = s => (LIVE.ownerOf ? LIVE.ownerOf(s) : LIVE.agentOf(s.id)) || AGS()?.defaultId() || 'hermes';
  const inChannel = (ch0, s) => ch0.agentFeed ? rowAgent(s) === ch0.agent : ch0.general ? !spacesOf(s.id).length : spaceContains(ch0.id, s.id) && rowAgent(s) === ch0.agent;
  const chanName = s => spacesOf(s.id)[0]?.name || 'General';
  // A channel's emoji and words (issue 1506): { emoji, label } of a channel ({ name, general }) or a name.
  const chanFace = c => window.WizCore?.channelFace?.(typeof c === 'string' ? c : c?.name, typeof c === 'string' ? c === 'General' : !!c?.general || c?.id === CHAN_GENERAL) || { emoji: '#', label: typeof c === 'string' ? c : c?.name || '' };
  const chanTitle = c => { const f = chanFace(c); return f.title || (f.label ? `${f.emoji} ${f.label}` : f.emoji); };
  // A layout that draws its own chat list (AI apps) asks for these through the Chats API: the "# channel" of a row
  // ('' with the switch off) and the sidebar's Channels pane, the desktop's id::side window (issue 1256).
  // A row's channel is its OWN agent's Space (a main and a routed thread can share an id), as inChannel files it.
  const channelOf = s => { if (!s || typeof s.id !== 'string') return ''; const a = rowAgent(s); return spaces().find(sp => spaceAgent(sp) === a && spaceContains(sp.id, s.id))?.name || 'General'; };
  const chanSide = w => /::side$/.test(String(w?.id || ''));
  // cardAt is an ISO time; a new chat still in the outbox has none yet (its row's own time, so it sorts as newest).
  const chanAt = s => Date.parse(LIVE.cardAt(s)) || Date.parse(s.updatedAt) || Date.parse(s.createdAt) || 0;
  // A post's place in its channel feed (wizard-ux issue 1289, James: Slack threads): when the thread was started, so a
  // new reply never moves its post. A row without a start time (an older Service, a chat still in the outbox) falls
  // back to its card time, which for a new chat is now: it sorts as the newest post.
  const chanPostedAt = s => Date.parse(s.startedAt) || Date.parse(s.createdAt) || chanAt(s);
  const chanPostOrder = (a, b) => chanPostedAt(a) - chanPostedAt(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  // Archive drops a channel once its newest chat (or the archiving itself) is older than CHAN_ARCHIVE_PRUNE_DAYS.
  function chanPruned(c, rows, now = Date.now()) {
    const t = rows.filter(s => inChannel(c, s)).reduce((m, s) => Math.max(m, chanAt(s)), Date.parse(chanPrefs().archived[c.id]) || 0);
    return now - t > CHAN_ARCHIVE_PRUNE_DAYS * CHAN_DAY;
  }
  // Where a channel opens from this window: in place, or (the AI apps sidebar's pane, wizard-ux issue 1256) in the
  // host's own feed window in the main chat column, so the sidebar keeps its channel list.
  const chanTarget = w => (w && H.channelWin?.(w)) || w;
  // The sidebar pane whose channels open elsewhere: it never draws a feed itself, only marks the open channel.
  const chanElsewhere = w => !!w && !!H.channelsElsewhere?.(w);
  function openChannel(w, id, feed = false) {
    // The Daily channel opens as one continuous chat (issue 1469), never as a feed.
    if (!feed && typeof dailyChan === 'function' && dailyChan(id)) return openDaily(w, id);
    w = chanTarget(w);
    const o = W[owner(w.id)] || w; if (!o) return false;
    // Back returns to the list this channel was opened from: a feed still open keeps its own way back; a stale one
    // (the Focus moved since) gives way to the Focus showing now.
    const prev = o.chan && chanOpen(w) ? o.chan.prev : (o.focus || null), sp = id !== CHAN_GENERAL && spaces().find(s => s.id === id);
    const ag = typeof chanAgentId === 'function' ? chanAgentId(id) : ''; // an agent's feed (issue 1336) is that agent's Focus
    if (id !== CHAN_GENERAL && !sp && !(ag && focusAgents().some(a => a.id === ag))) return false;
    o.chan = { id, prev }; chanUserAt[w.id] = 0; // the tap that opened it is not a scroll
    const f = focusOf(o), back = prev?.kind === 'space' ? { kind: 'agent', key: focusedAgent(prev) } : prev;
    // A Space channel is that Space's Focus; General keeps the agent the list was on (never a Space).
    setFocus(w, ag ? { kind: 'agent', key: ag } : sp ? { kind: 'space', key: sp.id } : f?.kind === 'space' ? back : f);
    chanHold(w.id); requestAnimationFrame(() => chanHold(w.id));
    H.channelOpened?.(w.id);
    return true;
  }
  // Back from a feed: to the Channels list, with the Focus the list had before.
  function channelBack(w) {
    if (!w || w.thread) return false;
    if (typeof runningBack === 'function' && runningBack(w)) return true; // the Running view → Chats (wizard-ux issue 1569)
    if (typeof sentBack === 'function' && sentBack(w)) return true; // Sent → Inbox (wizard-ux issue 1778)
    const o = W[owner(w.id)] || w; if (!o?.chan) return false;
    const open = chanOpen(w), prev = o.chan.prev || null; o.chan = null;
    if (!open) { save(); return false; }
    setFocus(w, prev);
    return true;
  }
  /* The Daily channel (wizard-ux issue 1469, part of the Channels switch; wizard-agent-service issue 527,
   * docs/chats-channels.md, Daily channel). The box keeps one real thread per day in its channel of kind 'daily' (pinned
   * at the top of Channels); Chats shows them as one continuous chat in the ordinary thread view. A tap on the channel
   * opens today's thread (before today's first post: the newest day's, with an empty Today line under it), and each
   * earlier day sits above it as a folded header (the day, its opener's first line, its message count) that unfolds in
   * place through the normal history read; the top reads older days as it scrolls into view. Every send from the Daily
   * view goes to today's thread: the box's POST /today names it (and makes it at the day's first post), so the box alone
   * decides where the day starts (05:00) and the view moves on without a reload. A window shows Daily while
   * w.daily = { id, agent }; Back, or opening any other thread, leaves it. Activity and the rows stay as they are. */
  const dailyChan = id => { const st = typeof chanStore === 'function' ? chanStore() : null; return (st && st.channels.find(c => c.id === id && c.kind === 'daily' && !c.archived)) || null; };
  const DAILY_OPEN = new Map(), DAILY_HIST = new Map(), DAILY_LAST = 'wos.chats.daily-last.v1';
  return { chanAt, chanElsewhere, chanFace, chanName, channelBack, channelOf, channelsFor, chanOpen, chanPostOrder, chanPruned, chanSide, chanTarget, chanTitle, DAILY_HIST, DAILY_LAST, DAILY_OPEN, dailyChan, inChannel, openChannel, rowAgent, bindLate: v => { if ('chanHold' in v) chanHold = v.chanHold; if ('chanUserAt' in v) chanUserAt = v.chanUserAt; if ('runningBack' in v) runningBack = v.runningBack; if ('sentBack' in v) sentBack = v.sentBack; } };
};
