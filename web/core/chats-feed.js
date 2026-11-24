/* Wizard UX core: Chats › a channel's feed: every post of the channel in order, with its read place.
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.feed = function ({ agentName, agentRec, ago, AGS, CHAN_CLAMP, chanActs, chanArchived, chanAt, chanChanged, chanGenAgent, chanKey, chanMore, chanNeeds, chanNewN, chanPostOrder, chanPostText, chanReadKey, chanReplies, chanStart, chanUnread, esc, firstAgent, firstPost, firstWant, focusedAgent, focusOf, inChannel, isWorking, KIT, LIVE, pullFirst, replyWant, rowDraft }) {
  let alertsHtml, chanSending; // late-bound: chats.js declares these after the call, see bindLate
  /* Issue 1440 (James, 13 Nov 2026): no Open / Needs you / All selector. The feed is every post of the channel; the
   * thread's own jump pills (issue 1359) point at posts that need you (amber) or have unread replies (green). */
  function channelFeed(w, open, rows) {
    const mine = rows.filter(s => inChannel(open, s)), shown = mine.slice().sort(chanPostOrder);
    const cs = chanStart(w, shown, open);
    // Every post of the channel with its activity time for the watermark (chanReadFeed).
    const on = new Set(shown);
    chanActs[w.id] = { key: chanReadKey(open, open.general ? chanGenAgent(w) : ''), rows: mine.map(s => ({ row: chanKey(s), post: 'post:' + s.id, at: chanAt(s), changed: chanChanged(s, -Infinity), shown: on.has(s) })) };
    // The wizard's own sigil (WosAgents.sigil) as the reply line's avatar: the channel's agent, General's the list's.
    const hat = `<span class="ch-post-av" aria-hidden="true">${AGS()?.sigil?.(agentRec(open.agent || focusedAgent(focusOf(w)) || '')) || ''}</span>`;
    const me = String(window.WizConfig?.owner?.() || '').trim(), meAv = `<span class="ch-post-me" aria-hidden="true">${esc((me || 'You').slice(0, 1).toUpperCase())}</span>`;
    const post = s => {
      // Slack-style: avatar, name and time, then the message as plain text (4 lines, then "more") and its pictures.
      // A thread whose first message hasn't been read yet shows its owner preview meanwhile (chanPostText); the title
      // only when the thread has no owner message at all (the agent started it).
      const p = firstPost(s), byAgent = p?.none && p.agent ? p.agent : null, said = byAgent ? { text: byAgent.text } : chanPostText(s, p), text = said.text, media = byAgent ? byAgent.media : p?.media || [];
      const long = text.length > CHAN_CLAMP || (text.match(/\n/g) || []).length >= 4, more = chanMore.has(s.id);
      const pAt = byAgent ? byAgent.at : p?.at, at = pAt && isFinite(pAt) ? new Date(pAt).toISOString() : s.startedAt || s.createdAt || LIVE.cardAt(s);
      // Replies are the bubbles James sees in the thread (chanReplies), never a raw message count; none until read.
      const r = chanReplies(s), n = r && !r.partial ? Math.max(0, r.ats.length - (byAgent ? 1 : 0)) : 0, un = chanUnread(s);
      // Unread (issue 1269): a green dot with words ("● 2 new replies", "● New reply") at the right of the reply line,
      // in the slot and style of the amber "Needs you", never a dot on the left. It stays until the post is opened.
      // An agent's post is its own first message: never counted as a new reply.
      const nn = un ? chanNewN(s, byAgent && r ? { ...r, ats: r.ats.slice(1) } : r) : 0, replies = n ? `<span>${n} ${n === 1 ? 'reply' : 'replies'}</span>` : '';
      const fresh = un ? `<span class="ch-post-st new"><i class="ch-chan-dot new" aria-hidden="true"></i>${nn ? `${nn} new ${nn === 1 ? 'reply' : 'replies'}` : byAgent && !n ? 'New' : 'New reply'}</span>` : '';
      const state = (isWorking(s) ? '<span class="ch-post-st working"><i class="ch-spin" aria-hidden="true"></i>Working</span>' : chanNeeds(s) ? '<span class="ch-post-st needs"><i class="ch-chan-dot" aria-hidden="true"></i>Needs you</span>' : s.archived ? '<span class="ch-post-st">Done</span>' : '') + fresh;
      const marks = state ? `<span class="ch-post-sts">${state}</span>` : ''; // one unit: it wraps whole, never split
      // A thread whose reply box holds a saved, unsent draft (direct:<id>; wizard-ux issue 1604 made it always on; issue
      // 1709) says "✎ Draft" on its reply line, the same mark as its Activity row. It never moves or recounts the post.
      const dft = typeof rowDraft === 'function' && rowDraft(s) ? '<span class="ch-post-draft ch-draft-tag"><span aria-hidden="true">✎</span> Draft</span>' : '';
      const mk = !isWorking(s) && chanNeeds(s) ? 'needs' : un ? 'new' : ''; // what the feed's jump pills count (issue 1440)
      const pics = media.length ? `<div class="ch-post-media">${media.slice(0, 6).map((m, i) => `<button type="button" class="ch-post-img" data-chpostimg="${esc(s.id)}" data-chpostag="${esc(firstAgent(s))}" data-i="${i}" aria-label="Open ${esc(m.name || 'photo')}"><img src="${esc(m.thumb || m.url)}" alt="" loading="lazy" decoding="async"></button>`).join('')}${media.length > 6 ? `<span class="ch-post-n">+${media.length - 6}</span>` : ''}</div>` : '';
      // An agent's words keep the chat bubble's inline markdown (wizard-ux issue 1287: bold, italics, links, code; a
      // report opens with a bold sentence, never "**…**"). The owner's own words stay plain text, as typed.
      // Its links are never inside the post's button: the agent's words sit beside it (a tap there still opens the
      // thread; the header button is the keyboard's way in), so each link is its own control.
      // A heading line ("## Executive signal") shows as bold words, never a raw "#": the feed keeps one text size.
      // Lines inside a ``` or ~~~ fence are code and stay as written ("# a shell comment").
      let fence = '';
      const heads = t => t.split('\n').map(l => { const f = /^ {0,3}(`{3,}|~{3,})/.exec(l); if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = ''; return l; }
        const m = !fence && /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(l); return !m || !m[1] ? l : m[1].includes('**') ? m[1] : `**${m[1]}**`; }).join('\n');
      const words = byAgent && KIT?.inline ? KIT.inline(heads(text)) : esc(text);
      const body = text ? `<span class="ch-post-t${long && !more ? ' clamp' : ''}">${words}</span>` : said.voice ? '<span class="ch-post-t ch-post-voice">Voice note</span>' : p ? '' : '<span class="ch-post-t ch-post-wait" aria-label="Loading the first message"><i class="ch-sk"></i></span>';
      // A post the agent wrote (an alert, a reminder, a chat it opened; wizard-agent-service issue 441) carries the
      // agent's avatar and name, and a Reply button until the thread has replies; then the usual reply line.
      const av = byAgent ? `<span class="ch-post-me ch-post-ag" aria-hidden="true">${AGS()?.sigil?.(agentRec(firstAgent(s) || open.agent || '')) || ''}</span>` : meAv;
      const who = byAgent ? (typeof agentName === 'function' ? agentName(firstAgent(s) || open.agent || '') : 'Wizard') : (me || 'You');
      const foot = byAgent && !n ? `<span class="ch-post-rr"><button type="button" class="ch-post-reply" data-chreply="${esc(s.id)}" aria-label="Reply to ${esc(who)}">Reply</button>${dft}${marks}</span>`
        : `<button type="button" class="ch-post-r${un ? ' unread' : ''}" data-chopen="${esc(s.id)}">${hat}${replies}<time>${esc(ago(LIVE.cardAt(s)))}</time>${dft}${marks}</button>`;
      return `<div class="ch-post${un ? ' unread' : ''}${byAgent ? ' by-agent' : ''}"${mk ? ` data-chmark="${mk}"` : ''} data-morph-key="post:${esc(s.id)}" data-chrow="${esc(chanKey(s))}" data-chtitle="${esc(s.title || '')}">${av}<div class="ch-post-c"><button type="button" class="ch-post-b" data-chopen="${esc(s.id)}" aria-label="Open thread: ${esc(s.title)}"><span class="ch-post-h"><b>${esc(who)}</b><time>${esc(ago(at))}</time></span>${byAgent ? '' : body}</button>${byAgent && body ? `<div class="ch-post-tb" data-chopen="${esc(s.id)}">${body}</div>` : ''}${long ? `<button type="button" class="ch-post-more" data-chpostmore="${esc(s.id)}" aria-expanded="${more}">${more ? 'less' : 'more'}</button>` : ''}${pics}${foot}</div></div>`;
    };
    // A post just sent from the channel's box: on screen from the Send tap, with the reply line saying it is on its way.
    const sendingPost = p => {
      const long = p.text.length > CHAN_CLAMP || (p.text.match(/\n/g) || []).length >= 4;
      const pics = p.media.length ? `<div class="ch-post-media">${p.media.slice(0, 6).map(m => `<span class="ch-post-img"><img src="${esc(m.url)}" alt="" decoding="async"></span>`).join('')}${p.media.length > 6 ? `<span class="ch-post-n">+${p.media.length - 6}</span>` : ''}</div>` : '';
      return `<div class="ch-post sending" data-morph-key="post:${esc(p.key)}">${meAv}<div class="ch-post-c"><div class="ch-post-b"><span class="ch-post-h"><b>${esc(me || 'You')}</b><time>${esc(ago(new Date(p.at).toISOString()))}</time></span>${p.text ? `<span class="ch-post-t${long ? ' clamp' : ''}">${esc(p.text)}</span>` : ''}</div>${pics}<span class="ch-post-r">${hat}<span class="ch-post-st working"><i class="ch-spin" aria-hidden="true"></i>Sending…</span></span></div></div>`;
    };
    const sending = typeof chanSending === 'function' ? chanSending(w, open, mine) : [];
    const line = '<div class="ch-chan-new" role="separator" aria-label="New posts" data-morph-key="chan-new"><span>New</span></div>';
    const html = shown.map(s => (cs?.newKey && cs.newKey === chanKey(s) ? line : '') + post(s)).join('') + sending.map(sendingPost).join(''), archNote = chanArchived(open.id) ? '<span class="ch-none">This channel is archived. Restore it to post here.</span>' : '';
    if (firstWant.size || replyWant.size) pullFirst();
    const alertsNow = typeof alertsHtml === 'function' ? alertsHtml(open) : ''; // the Alerts channel's alert records (issue 1589)
    return `<div class="ch-chan-feed">${shown.length || sending.length ? html : alertsNow ? '' : '<span class="ch-none">No posts in the last 30 days.</span>'}${alertsNow}${archNote}</div>`;
  }
  return { channelFeed, bindLate: v => { if ('alertsHtml' in v) alertsHtml = v.alertsHtml; if ('chanSending' in v) chanSending = v.chanSending; } };
};
