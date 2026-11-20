/* Wizard UX core: Chats › a channel's line in the list: its unread and needs-you dot, recent posts and the
 * agent a new post goes to. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.chanline = function ({ AGS, CHAN_DAY, chanAt, chanDraftMark, chanExpanded, chanFace, chanNeeds, chanNewCount, chanPrefs, chanStore, chanUnread, chanUnreadN, esc, focusAgents, focusedAgent, focusOf, inChannel, isWorking, PIN_SVG, spaceAgent, spaces }) {
  /* Unread is a green dot, needs-you the amber one (issue 1266: the violet dot blended into the shell). A channel line
   * and a chevron post line keep every marker in one slot at the right, just before the chevron, always in this order:
   * spinner (working), amber (needs you), green (new replies). Nothing sits beside the name, and there is no number
   * pill (issue 1269): the green dot carries the unread count in its label. */
  function chanMark(rows, post = false, un = chanUnreadN(rows)) {
    const marks = (rows.some(isWorking) ? '<i class="ch-spin" role="img" aria-label="Working"></i>' : '')
      + (rows.some(chanNeeds) ? '<i class="ch-chan-dot" role="img" aria-label="Needs you"></i>' : '')
      + (un ? `<i class="ch-chan-dot new" role="img" aria-label="${post ? 'Unread' : `${un} unread`}"></i>` : '');
    return marks ? `<span class="ch-chan-ind">${marks}</span>` : '';
  }
  // The drop-down of a channel whose chats are not in the loaded list (older ones only the box's store counts): their
  // number and a way in; the empty line is kept for a channel that holds no chats at all (issue 1531).
  const CHAN_RECENT_MIN = 3;
  function chanNoRecent(ch0) {
    // The store's count, else (store off: Spaces) the Space's own chat list, which also holds chats not loaded here.
    const st = typeof chanStore === 'function' ? chanStore() : null, own = !ch0.general && !ch0.agentFeed;
    const n = (own && (st ? st.channels?.find?.(c => c.id === ch0.id)?.count : spaces().find(s => s.id === ch0.id && spaceAgent(s) === ch0.agent)?.threads?.length)) || 0;
    return n > 0 ? `<button type="button" class="ch-chan-post ch-chan-more" data-chchan="${esc(ch0.id)}"><span>${n} ${n === 1 ? 'chat' : 'chats'}, open channel</span></button>` : '<span class="ch-none">No chats yet</span>';
  }
  function channelLine(ch0, rows, now, cur = '', gAg = '', dAg = '') {
    const mine = rows.filter(s => !s.archived && inChannel(ch0, s)), ex = chanExpanded.has(ch0.id), pinned = chanPrefs().pins.includes(ch0.id), on = !!cur && cur === ch0.id;
    const byNew = (a, b) => chanAt(b) - chanAt(a);
    let recent = ex ? mine.filter(s => isWorking(s) || chanNeeds(s) || now - chanAt(s) < CHAN_DAY).sort(byNew) : [];
    // Nothing from the last day: the newest few anyway, so a channel with chats never reads as empty (issue 1531).
    if (ex && !recent.length) recent = mine.slice().sort(byNew).slice(0, CHAN_RECENT_MIN);
    // The channel's own state is its watermark (issue 1316): posts changed since the owner last scrolled past them.
    const un = chanNewCount(ch0, mine, gAg), face = typeof chanFace === 'function' ? chanFace(ch0) : { emoji: '#', label: ch0.name };
    return `<div class="ch-chan${pinned ? ' pinned' : ''}${un ? ' unread' : ''}${on ? ' cur' : ''}" data-morph-key="chan:${esc(ch0.id)}"><div class="ch-chan-r"><button type="button" class="ch-chan-open" data-chchan="${esc(ch0.id)}"${on ? ' aria-current="true"' : ''} aria-haspopup="dialog" aria-keyshortcuts="Shift+F10" title="Open channel · hold or open the context menu for actions"><span class="ch-chan-hash ch-chan-emo"${face.label ? ' aria-hidden="true"' : ''}>${esc(face.emoji)}</span><b>${esc(face.label)}</b>${pinned ? `<i class="ch-chan-pin" role="img" aria-label="Pinned">${PIN_SVG}</i>` : ''}${typeof chanDraftMark === 'function' ? chanDraftMark(ch0, dAg) : ''}${chanMark(mine, false, un)}</button><button type="button" class="ch-chan-x" data-chchanx="${esc(ch0.id)}" aria-expanded="${ex}" aria-label="${ex ? 'Hide' : 'Show'} recent posts in ${esc(face.label || face.emoji)}"><i aria-hidden="true"></i></button></div>`
      + (ex ? `<div class="ch-chan-recent">${recent.length ? recent.map(s => `<button type="button" class="ch-chan-post${chanUnread(s) ? ' unread' : ''}" data-chopen="${esc(s.id)}"><span>${esc(s.title)}</span>${chanMark([s], true)}</button>`).join('') : chanNoRecent(ch0)}</div>` : '') + '</div>';
  }
  // The agent a new channel from this list belongs to: the list's agent (its Focus; else the default one), and only while
  // it is a visible one the form can take (a hidden agent's list gets no row: never filed under another agent).
  const chanNewAgent = w => {
    const ags = typeof focusAgents === 'function' ? focusAgents() : []; if (!ags.length) return ''; // (tests slice the list without the agents)
    const a = focusedAgent(focusOf(w)) || AGS()?.defaultId() || 'hermes';
    return ags.some(x => x.id === a) ? a : '';
  };
  return { chanMark, channelLine, chanNewAgent };
};
