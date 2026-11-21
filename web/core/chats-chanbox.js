/* Wizard UX core: Chats › a channel's message box: its draft and model, the owner's own new posts in the feed,
 * posts still on their way (Sending…) and Edit on a post that was not sent. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.chanbox = function ({ AGS, ch, CH, CHAN_TEXT_MAX, chanArchived, chanOpen, chanRepaint, chanTitle, elOf, esc, FIRST, firstAgent, focusAgentId, growTa, H, KIT, OUTBOX, owner, renderChatList, spaceContains, toast, viewContext, W, winAgent }) {
  let attachTray, CLIP_SVG, fileUrl, hasContent, pendRef, PREVIEW, PW, sendChat, syncSend; // late-bound: chats.js declares these after the call, see bindLate
  /* The channel's message box (wizard-ux issue 1258; James, 10 Nov 2026: "I should be able to have a text box at the
   * bottom … use the orb or type something and send a new message, and then that gets picked up by the agent as a new
   * thread automatically"). It is the thread composer's own markup and handlers (attach, mic, model label) with the
   * draft kept per channel ('chan:<agent>:<id>'). Send starts a new chat on today's path (sendChat '__new__', the
   * window's default agent and model unless one was picked), filed into the channel's Space, and the window stays on
   * the feed. The post is painted on the tap's own frame and gives way to the chat's own row once the outbox lists it.
   * Room for an @-mention of an agent or model later: it would only set the route below. */
  const CHAN_SENDING = [], CHAN_SENDING_MAX = 2 * 60e3;
  // The Space a new chat from this window's channel feed is filed into ('' = General), or null when no feed is open.
  // Voice takes pin it when they start, so a take sent after leaving the channel still lands where it began.
  function chanSpaceOf(w) { const open = w && !w.thread ? chanOpen(w) : null; return open ? (open.general || open.agentFeed ? '' : open.id) : null; }
  function chanDraftKey(w) {
    const open = w && !w.thread ? chanOpen(w) : null;
    return open && !chanArchived(open.id) ? `chan:${open.agent || winAgent(w) || ''}:${open.id}` : '';
  }
  /* The model picked in a channel's box (wizard-ux issue 1309), one per box (agent + channel), whichever pane draws the
   * feed (the AI apps feed and the classic list pane are panes of their own, id::side / id::list, whose window is
   * another id): the label, the menu's tick and every post from the box (Send, its mic, the orb) read this one place.
   * Kept through redraws, posts and channel switches until changed; in memory only. A thread's or New chat's pick never
   * lands here, and this one never rides into them. */
  const CHAN_MODEL = new Map();
  // By box key (chan:<agent>:<channel>): a take keeps the box it started in, whatever channel is in front by Send.
  function boxModel(key) {
    const nm = key ? CHAN_MODEL.get(key) : null; if (!nm) return null;
    return !nm.agent || nm.agent === key.split(':')[1] ? nm : null; // only a model of this channel's own agent
  }
  function chanModel(w) { return boxModel(chanDraftKey(w)); }
  function setChanModel(wid, route) {
    const key = chanDraftKey(W[wid]); if (!key || !route?.model) return false;
    if (route.agent && route.agent !== key.split(':')[1]) return false; // another agent's model never rides into this channel
    CHAN_MODEL.set(key, { model: route.model, provider: route.provider || '', ...(route.agent ? { agent: route.agent } : {}) });
    // Paint first: every box of this channel on screen shows the pick on this frame (the morph keeps scroll and caret).
    for (const id of Object.keys(CH)) { const x = W[id], el = x && chanDraftKey(x) === key ? elOf(id) : null; if (el) renderChatList(x, el); }
    return true;
  }
  function chanComposer(w, open) {
    const key = chanDraftKey(w); if (!key) return '';
    // The box, its mic and the orb read the box's own pick (chanModel), never the window's New chat pick (issue 1309).
    const c = ch(w.id);
    if (c.draftFor !== key) {
      // A photo still uploading stays with the channel it was attached in: its live tray waits here (the upload
      // finishes into it) and comes back, saved, when that channel is open again.
      const trays = c.chanTrays || (c.chanTrays = new Map()), was = String(c.draftFor || '');
      if (was.startsWith('chan:') && (c.files || []).some(f => f && f.uploading)) trays.set(was, c.files);
      const d = KIT.drafts.get(key), live = trays.get(key); trays.delete(key);
      c.draftFor = key; c.draft = d.text || '';
      c.files = live || (d.files || []).map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
      if (live) KIT.drafts.set(key, c.draft, c.files);
    }
    PW?.ensureModels?.();
    // The label: this box's own pick (wizard-ux issue 1309), else the default a new chat from this list starts on.
    const mlabel = PW?.modelLabel ? PW.modelLabel({ ...w, thread: '__new__' }, null, chanModel(w)) : '';
    const say = open.agentFeed ? `Message ${open.name}` : `Message ${typeof chanTitle === 'function' ? chanTitle(open) : '# ' + open.name}`;
    return `<form data-part="composer" class="ch-compose ch-chan-compose${hasContent(c.draft, c.files || []) ? ' has-text' : ''}" data-morph-key="chanbox:${esc(key)}" data-chform data-chchanform>${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach pictures or files">${CLIP_SVG}</button><div class="ch-field"><textarea rows="1" placeholder="${esc(say)}" aria-label="${esc(say)}" enterkeyhint="enter">${esc(c.draft || '')}</textarea>${mlabel}</div>${PW?.micBtn ? PW.micBtn(w.id) : ''}<button type="submit" class="ch-send" aria-label="${esc(open.agentFeed ? `Post to ${open.name}` : `Post in ${typeof chanTitle === 'function' ? chanTitle(open) : '# ' + open.name}`)}"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>`;
  }
  // The feed's newest post sits at the bottom: keep it in view after a send or when the feed opens.
  function chanToEnd(wid, focus = false) {
    const o = W[owner(wid)] || W[wid]; if (o?.chan) o.chan.at = { end: true };
    requestAnimationFrame(() => {
      const el = elOf(wid), sc = el?.querySelector('.ch-list > .ch-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
      const ta = focus && el?.querySelector('[data-chchanform] textarea'); if (ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
    });
  }
  /* The owner's own new post in a channel (wizard-ux issue 1291 follow-up; message box, voice key, orb, +): every feed of
   * that channel on screen goes to its end and holds there, so the post is in view even when the feed was scrolled up
   * or had opened at its New line. Only posts sent from here call this: other people's and agents' posts never move it.
   * space: the channel's id, '' = General; agent: the post's agent ('' = the default one). */
  function chanOwnPost(space, agent = '') {
    if (typeof space !== 'string') return 0;
    const ag = a => a || AGS()?.defaultId?.() || 'hermes'; let n = 0;
    for (const id of Object.keys(CH)) {
      const w = W[id], open = w && !w.thread ? chanOpen(w) : null; if (!open) continue;
      // General from the All view shows every agent's unfiled posts: any of his General posts; an agent's General, its own
      const gAg = open.general ? focusAgentId(W[owner(id)] || w) : '';
      if (open.agentFeed ? ag(open.agent) !== ag(agent) : open.general ? space !== '' || (gAg && ag(gAg) !== ag(agent)) : open.id !== space || ag(open.agent) !== ag(agent)) continue;
      chanToEnd(id); n++;
    }
    return n;
  }
  // New chat with this window's feed in front (wizard-ux issue 1291): the feed's own box takes it, never General.
  function chanCompose(wid) {
    if (!chanDraftKey(W[wid]) || !elOf(wid)?.querySelector('[data-chchanform] textarea')) return false;
    chanToEnd(wid, true); return true;
  }
  // Posts still on their way for this feed: until the chat's row is in the channel (or two minutes pass).
  function chanSending(w, open, mine) {
    const key = chanDraftKey(w), now = Date.now();
    for (let i = CHAN_SENDING.length - 1; i >= 0; i--) if (now - CHAN_SENDING[i].at > CHAN_SENDING_MAX) CHAN_SENDING.splice(i, 1);
    return key ? CHAN_SENDING.filter(p => p.feed === key && !(p.sid && mine.some(s => s.id === p.sid && firstAgent(s) === p.owner))) : [];
  }
  async function channelSend(wid, form) {
    const w = W[wid], key = chanDraftKey(w), open = key ? chanOpen(w) : null; if (!open) return null;
    const c = ch(wid), ta = form.querySelector('textarea'), text = String(ta?.value || '').trim();
    // A voice take into this channel is recording: Send finishes it, and the words and files here go with it.
    const into = H.voiceInto?.(); if (into === '__new__' && H.finishVoice) { H.finishVoice(); return null; }
    const tray = (c.files || []).filter(f => f && (f.id || f.uploading));
    if (!text && !tray.length) return null;
    const files = tray.map(pendRef).filter(f => f && f.id);
    const media = tray.filter(f => /^image\//.test(f.mime || '') && f.preview).map((f, i) => ({ id: f.id || 'up' + i, name: f.name || 'Photo', mime: f.mime, kind: 'image', url: f.preview }));
    const agent = open.agent || winAgent(w) || '', owner0 = agent && AGS()?.isOther?.(agent) ? agent : '';
    // The box's own pick (only a model of this channel's own agent: the chat must belong to the agent whose Space it is filed into).
    const route = chanModel(w);
    const p = { key: 'chanpost:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), feed: key, owner: owner0, text, media, at: Date.now(), sid: '' };
    CHAN_SENDING.push(p);
    if (ta) { ta.value = ''; growTa(ta); }
    c.draft = ''; c.files = []; KIT.drafts.clear(key); syncSend(form, c);
    renderChatList(w, elOf(wid)); chanToEnd(wid); // the post is on screen on this frame
    const how = `typing in the # ${open.name} channel in Chats`;
    const it = await sendChat(wid, text, how, null, { sid: '__new__', away: true, space: open.general || open.agentFeed ? '' : open.id, files, route, instructions: viewContext(wid, how) });
    if (!it?.sessionId) {
      // Not saved: the post goes and the words and files return to this channel's box.
      CHAN_SENDING.splice(CHAN_SENDING.indexOf(p), 1);
      const d = KIT.drafts.get(key), back = [text, String(d.text || '').trim()].filter(Boolean).join('\n');
      KIT.drafts.set(key, back, [...files, ...(d.files || []).filter(f => !files.some(x => x.id === f.id))]);
      if (W[wid] === w && chanDraftKey(w) === key) { c.draftFor = ''; const t = elOf(wid)?.querySelector('[data-chchanform] textarea'); if (t) t.value = back; }
      chanRepaint(); return null;
    }
    p.sid = it.sessionId;
    // The post keeps the words and pictures it was sent with (the chat's own first message, without a read).
    FIRST.set(owner0 + '|' + p.sid, { text: text.slice(0, CHAN_TEXT_MAX), media, at: p.at });
    chanRepaint(); chanToEnd(wid);
    return it;
  }
  // A Not sent channel post taken back (Edit) or dismissed (wizard-ux issue 1293): its "Sending…" post leaves the
  // feed at once, never after the two-minute cap. Only that chat's post, of its own agent (key: one feed only).
  function chanDropSending(it, key = '') {
    const sid = it?.sessionId, own = it?.agent && AGS()?.isOther?.(it.agent) ? it.agent : ''; let n = 0;
    if (sid) for (let i = CHAN_SENDING.length - 1; i >= 0; i--) { const p = CHAN_SENDING[i]; if (p.sid === sid && (p.owner || '') === own && (!key || p.feed === key)) { CHAN_SENDING.splice(i, 1); n++; } }
    return n;
  }
  // Edit on a channel post that was saved but then not sent (wizard-ux issue 1294): the words go back into this
  // channel's own box, as they do when the save itself fails, never into a separate New chat. false: not this
  // feed's post (a reply, another channel's post, a plain new chat), so the shell's own Edit takes it.
  const CHAN_HOW = /^typing in the # (.*) channel in Chats$/;
  function chanEditUnsent(wid, it) {
    const w = W[wid], key = chanDraftKey(w), open = key ? chanOpen(w) : null, how = CHAN_HOW.exec(String(it?.how || ''));
    if (!open || !how || it.kind !== 'new' || !it.sessionId) return false;
    // Its own agent's channel only: a main and a routed channel can share a name (and a chat id).
    const ag = a => a || AGS()?.defaultId?.() || 'hermes'; if (ag(it.agent) !== ag(open.agent || winAgent(w))) return false;
    if (how[1] !== open.name && (open.general || !spaceContains(open.id, it.sessionId))) return false;
    const c = ch(wid), t = elOf(wid)?.querySelector('[data-chchanform] textarea');
    if (c.draftFor === key && (c.files || []).some(f => f && f.uploading)) { toast('!', 'Existing draft kept · finish it before editing this unsent message', 2600); return true; }
    // Words typed in the box since are part of its draft: an edit never overwrites them.
    if (t && c.draftFor === key) KIT.drafts.set(key, t.value, c.files || []);
    if (!window.WosSettings?.moveDraft({ chats: { ch }, wid, item: it, outbox: OUTBOX, toast, key })) return true;
    // Its "Sending…" post goes with it: the words are the box's again.
    chanDropSending(it, key);
    c.draftFor = ''; // the box reloads its draft (the edited words and files) on this paint
    c.pillIds = ''; // taken back, not sent: the pill never flashes "Sent" for it
    renderChatList(w, elOf(wid));
    const box = elOf(wid)?.querySelector('[data-chchanform] textarea'); if (box) { box.value = c.draft || ''; growTa(box); syncSend(box.form || box.closest?.('form'), c); }
    chanToEnd(wid, true);
    return true;
  }
  return { boxModel, chanCompose, chanComposer, chanDraftKey, chanDropSending, chanEditUnsent, chanModel, channelSend, chanOwnPost, chanSending, chanSpaceOf, chanToEnd, setChanModel, bindLate: v => { if ('attachTray' in v) attachTray = v.attachTray; if ('CLIP_SVG' in v) CLIP_SVG = v.CLIP_SVG; if ('fileUrl' in v) fileUrl = v.fileUrl; if ('hasContent' in v) hasContent = v.hasContent; if ('pendRef' in v) pendRef = v.pendRef; if ('PREVIEW' in v) PREVIEW = v.PREVIEW; if ('PW' in v) PW = v.PW; if ('sendChat' in v) sendChat = v.sendChat; if ('syncSend' in v) syncSend = v.syncSend; } };
};
