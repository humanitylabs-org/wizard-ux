/* Wizard UX core: Chats › New channel, the channel list body and head, the channel sheet, Rename and Mark read.
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
window.WizCore.chatsParts.chanui = function ({ agentName, agentRec, ago, AGS, ch, CH, CHAN_CLAMP, CHAN_DAY, CHAN_GENERAL, CHAN_TEXT_MAX, CHAN_VIEW_KEY, chanActs, chanAgentsSec, chanArchived, chanAt, chanCarry, chanChanged, chanDraftMark, chanElsewhere, chanExpanded, chanFace, chanGenAgent, chanMore, chanNeeds, channelBack, channelsFor, channelsLate, chanNewCount, chanOpen, chanPostOrder, chanPrefEdit, chanPrefs, chanPruned, chanReadAt, chanReadFeed, chanReadKey, chanReadPaint, chanReadTo, chanStore, chanTarget, chanTitle, chanUnread, chanUnreadN, chatsBack, chatVars, closeRowSheet, doneLate, esc, focusAgentId, focusAgents, focusedAgent, focusOf, growTa, H, inChannel, isWorking, jumpGo, KIT, LIVE, MARK_DONE_SVG, norm, openChannel, openChat, openEmojiSheet, OUTBOX, owner, paintFeedJump, paintListsNow, PIN_SVG, renderChatList, rerenderList, rowAgent, rowDraft, sentTabsOn, spaceAgent, spaceContains, spaces, toast, toTurns, track, vib, viewContext, W, winAgent }) {
  let ACT, elOf, holdList, mediaOfFile, openSpacePicker, orderBar, RENAME_SVG; // late-bound: chats.js declares these after the call, see bindLate
  /* A channel's line in the list; core/chats-chanline.js. */
  const { chanMark, channelLine, chanNewAgent } = window.WizCore.chatsParts.chanline({ AGS: (...a) => AGS(...a), CHAN_DAY, chanAt, chanDraftMark, chanExpanded, chanFace, chanNeeds, chanNewCount, chanPrefs, chanStore, chanUnread, chanUnreadN, esc, focusAgents, focusedAgent, focusOf, inChannel, isWorking, PIN_SVG, spaceAgent, spaces });
  // + New channel (wizard-ux issue 1308): the existing name form, opened straight on its input; Esc or outside cancels.
  function chanNewForm(w, tab = null) {
    const a = w && chanNewAgent(w); if (!a) return false;
    openSpacePicker(w, a, tab, { naming: true, from: w.id, direct: true });
    return !!chatVars.spacePicker;
  }
  // Only the list's + New channel row opens it: + / ⌥N on the Channels list start a new chat (wizard-ux issue 1489).
  function channelsBody(w, rows) {
    if (typeof chanCarry === 'function' && !chatVars.chanCarried && Date.now() >= chatVars.chanCarryAfter && chanStore()) { chatVars.chanCarried = true; chanCarry(); }
    const now = Date.now(), arch = channelsFor(w, { archived: true }).filter(c => !chanPruned(c, rows, now));
    // The channel whose feed shows in the main column (AI apps sidebar): marked in the list, which stays as it is.
    const cur = chanElsewhere(w) ? String(H.channelCurrent?.() || '') : '', gAg = chanGenAgent(w), dAg = typeof winAgent === 'function' ? winAgent(w) : ''; // (tests slice the list without it)
    // Archive: folded by default, in the Activity Archive section's own style; its chats stay where they are.
    const archSec = arch.length ? `<section class="ch-sec ch-chan-arch${chatVars.chanArchOpen ? ' open' : ''}" data-sec="chan-archive"><button type="button" class="ch-sec-h" data-chchanarch aria-expanded="${chatVars.chanArchOpen}"><span>Archive</span><small>${arch.length}</small><i aria-hidden="true"></i></button>${chatVars.chanArchOpen ? `<div class="ch-sec-b">${arch.map(c => channelLine(c, rows, now, cur, gAg, dAg)).join('')}</div>` : ''}</section>` : '';
    // + New channel (wizard-ux issue 1308): the list's last row after General, in the accent colour; it opens the
    // existing name form (openSpacePicker naming) for the agent this list shows.
    const tags = !!chanStore()?.tags; // Tags on (wizard-agent-service issue 608, on for everyone)
    const add = chanNewAgent(w) ? `<button type="button" class="ch-chan-add" data-chchannew aria-haspopup="dialog"><span class="ch-chan-hash" aria-hidden="true">+</span><b>${tags ? 'New tag' : 'New channel'}</b></button>` : '';
    // Archived is a tag view: one line after General that opens every archived chat of this list's agent.
    const aAg = focusedAgent(focusOf(w)), archN = tags ? rows.filter(s => s.archived && !s.hidden && (!aAg || rowAgent(s) === aAg)).length : 0;
    const archLine = tags ? `<div class="ch-chan${cur === '__archived__' ? ' cur' : ''}" data-morph-key="chan:__archived__"><div class="ch-chan-r"><button type="button" class="ch-chan-open" data-chchan="__archived__" title="Open your archived chats"><span class="ch-chan-hash ch-chan-emo" aria-hidden="true">🗄️</span><b>Archived</b>${archN ? `<small class="ch-chan-n-all">${archN}</small>` : ''}</button></div></div>` : '';
    // Agents (issue 1336): a folded row just above Archive, so Archive stays last.
    const agents = typeof chanAgentsSec === 'function' ? chanAgentsSec(rows) : '';
    return `<div class="ch-chan-list">${channelsFor(w).map(c => channelLine(c, rows, now, cur, gAg, dAg)).join('')}${archLine}${add}${agents}${archSec}</div>`;
  }
  /* Channel posts: first message, words, reply counts, feed place; core/chats-posts.js. */
  const { chanHold, chanKey, chanNewN, chanPostText, chanRepaint, chanReplies, chanScrolled, chanStart, chanUser, chanUserAt, FIRST, firstAgent, firstPost, firstWant, pullFirst, replyWant } = window.WizCore.chatsParts.posts({ ch, CH, CHAN_TEXT_MAX, chanChanged, chanGenAgent, chanOpen, chanReadAt, chanReadFeed, chanReadKey, elOf: (...a) => elOf(...a), holdList: (...a) => holdList(...a), isWorking, LIVE, mediaOfFile: (...a) => mediaOfFile(...a), owner: (...a) => owner(...a), paintFeedJump, rerenderList, rowAgent, toTurns, W });
  channelsLate({ chanHold, chanUserAt });
  doneLate({ chanUser });
  /* A channel's feed; core/chats-feed.js. */
  const { channelFeed, bindLate: feedLate } = window.WizCore.chatsParts.feed({ agentName: (...a) => agentName(...a), agentRec, ago, AGS: (...a) => AGS(...a), CHAN_CLAMP, chanActs, chanArchived, chanAt, chanChanged, chanGenAgent, chanKey, chanMore, chanNeeds, chanNewN, chanPostOrder, chanPostText, chanReadKey, chanReplies, chanStart, chanUnread, esc, firstAgent, firstPost, firstWant, focusedAgent, focusOf, inChannel, isWorking, KIT, LIVE, pullFirst, replyWant, rowDraft });
  function chanHead(w, open) {
    if (open) return `<div class="ch-chan-h"><button type="button" class="ch-chan-back" data-chchanback aria-label="Back to channels"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>${open.agentFeed ? `<span class="ch-chan-sig" aria-hidden="true">${AGS()?.sigil?.(agentRec(open.agent)) || ''}</span>` : `<span class="ch-chan-hash ch-chan-emo"${chanFace(open).label ? ' aria-hidden="true"' : ''}>${esc(chanFace(open).emoji)}</span>`}${esc(open.agentFeed ? open.name : chanFace(open).label)}</b></div>`;
    const sort = chatVars.chanView === 'channels' ? orderBar('Sort channels', 'data-chchansort', ['az', 'za'], chanPrefs().sort, o => o === 'az' ? 'A–Z' : 'Z–A') : '';
    // The bottom tabs (wizard-ux issue 1778) pick Inbox or Tags; only the channels' sort stays up here.
    if (typeof sentTabsOn === 'function' && sentTabsOn(w)) return sort ? `<div class="ch-chan-tabs">${sort}</div>` : '';
    return `<div class="ch-chan-tabs">${orderBar('Chats view', 'data-chview', ['channels', 'activity'], chatVars.chanView, o => o === 'activity' ? 'Activity' : 'Channels')}${sort}</div>`;
  }
  // Long-press, right-click or Shift+F10 on a channel: the row action sheet's own markup, with channel actions.
  function openChannelSheet(wid, cid, trigger = null) {
    const el = track.querySelector(`[data-chats="${wid}"]`), sp = cid !== CHAN_GENERAL && spaces().find(s => s.id === cid);
    if (!el || (cid !== CHAN_GENERAL && !sp)) return false;
    closeRowSheet();
    const p = chanPrefs(), pinned = p.pins.includes(cid), arch = !!p.archived[cid], name = sp ? sp.name : 'General';
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Channel actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(chanTitle(sp ? name : { name, general: true }))}</div>
      ${sp ? `<button type="button" data-rschpin>${PIN_SVG}${pinned ? 'Unpin' : 'Pin'}</button><button type="button" data-rschrename>${RENAME_SVG}Rename</button>${chanStore()?.autoTags && !['alerts', 'daily'].includes(chanStore().channels.find(c => c.id === cid)?.kind) ? `<button type="button" data-rschcovers><span class="ch-sheet-emo" aria-hidden="true">🏷️</span>What goes here…</button>` : ''}<button type="button" data-rschemoji><span class="ch-sheet-emo" aria-hidden="true">${esc(chanFace(name).emoji)}</span>Emoji…</button><button type="button" data-rscharch>${ACT.done.icon}${arch ? 'Restore' : 'Archive channel'}</button>` : ''}
      <button type="button" data-rschread>${MARK_DONE_SVG}Mark channel read</button>
      ${arch ? '' : `<button type="button" data-rschnew><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New post</button>`}</div></div>`);
    chatVars.rowSheet = { wid, chan: cid, trigger };
    el.querySelector('.ch-sheet button')?.focus({ preventScroll: true });
    vib(10); return true;
  }
  /* Channel emoji; core/chats-chanemoji.js. */
  const { chanEmojiPick, chanEmojiSync, chanEmojiTap, chanModelEmoji, chanSetEmoji, openChannelEmoji } = window.WizCore.chatsParts.chanemoji({ chanFace, chanRenameTo, esc, norm, openEmojiSheet, spaceAgent, spaces, toast });
  function openChannelRename(wid, cid) {
    const el = track.querySelector(`[data-chats="${wid}"]`), sp = spaces().find(s => s.id === cid); if (!el || !sp) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Rename channel"><form class="ch-sheet-b ch-rename" data-chrnform>
      <div class="ch-sheet-t">Rename channel</div>
      <input type="text" name="t" maxlength="60" value="${esc(sp.name)}" autocomplete="off" enterkeyhint="done" aria-label="Channel name">${chanEmojiPick(sp.name)}
      <div class="ch-rename-b"><button type="button" data-rncancel>Cancel</button><button type="submit" class="go">Save</button></div></form></div>`);
    chatVars.rowSheet = { wid, chan: cid, rename: true };
    const inp = el.querySelector('.ch-rename input'); if (inp) { inp.focus(); inp.select(); }
  }
  /* What goes here (wizard-agent-service issue 702, the box's auto tags on): the channel's covers, one per line. Chats
   * about any of them get this channel's tag by themselves; `kind: report` (question, lookup, evaluation, digest,
   * reminder, todo) matches the kind of chat. Saving replaces the owner's list; what the box learned stays. */
  function openChannelCovers(wid, cid) {
    const el = track.querySelector(`[data-chats="${wid}"]`), sp = spaces().find(s => s.id === cid); if (!el || !sp || !LIVE.chanStore?.covers) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="What goes in ${esc(chanTitle(sp.name))}"><div class="ch-sheet-b ch-rename ch-covers">
      <div class="ch-sheet-t">What goes in ${esc(chanTitle(sp.name))}</div>
      <p class="ch-covers-help">Chats about any of these get this tag by themselves. One per line; <code>kind: report</code> matches questions, lookups and reports.</p>
      <textarea name="covers" rows="7" aria-label="What this channel covers" placeholder="Loading…" disabled></textarea>
      <div class="ch-rename-b"><button type="button" data-rncancel>Cancel</button><button type="button" class="go" data-chcvsave disabled>Save</button></div></div></div>`);
    chatVars.rowSheet = { wid, chan: cid, covers: true };
    LIVE.chanStore.covers(cid).then(d => {
      const ta = el.querySelector('.ch-covers textarea'), go = el.querySelector('[data-chcvsave]'); if (!ta || chatVars.rowSheet?.chan !== cid) return;
      if (!d) { ta.placeholder = 'Not available right now'; return; }
      ta.value = d.covers.join('\n'); ta.placeholder = 'clips\npodcast\nkind: report'; ta.disabled = false; if (go) go.disabled = false;
      const learned = d.learned.length ? `<p class="ch-covers-help">Learned from your tags: ${esc(d.learned.slice(-6).join(', '))}</p>` : '';
      if (learned) ta.insertAdjacentHTML('afterend', learned);
      ta.focus();
    });
  }
  function submitChannelCovers(sheet) {
    const cid = chatVars.rowSheet?.chan, ta = sheet?.querySelector('.ch-covers textarea'); if (!cid || !ta || ta.disabled) return;
    const list = [...new Set(ta.value.split(/\n|,/u).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    if (list.length > 40 || list.some(x => x.length > 60)) { toast('!', 'At most 40 lines of up to 60 letters', 2200); return; }
    closeRowSheet();
    LIVE.chanStore.setCovers(cid, list).then(r => toast(r.ok ? '🏷️' : '!', r.ok ? 'Saved: new chats are tagged by this list' : 'Not saved: check the lines', 1800));
  }
  /* Mark channel read (issue 1317, with Mark done): the channel's read point moves to now (issue 1316) and its posts'
   * green New reply words clear (LIVE.markSeen of the posts that have one). Amber Needs you is cleared only per thread. */
  function chanMarkRead(w, cid) {
    if (!w) return false;
    const sp = cid !== CHAN_GENERAL && spaces().find(x => x.id === cid), c = sp ? { id: cid, name: sp.name, agent: spaceAgent(sp) } : { id: CHAN_GENERAL, name: 'General', general: true };
    const ag = !c.general && AGS()?.isOther?.(c.agent) ? c.agent : winAgent(W[owner(w.id)] || w), rows = (LIVE.sessionsFor ? LIVE.sessionsFor(ag || '') : LIVE.unified()).filter(s => !s.hidden);
    const mine = rows.filter(s => !s.archived && inChannel(c, s)), unread = mine.filter(chanUnread);
    chanReadTo(chanReadKey(c, c.general ? chanGenAgent(w) : ''), Date.now());
    if (unread.length) LIVE.markSeen(unread);
    clearTimeout(chatVars.chanReadPaintT); chanReadPaint(); paintListsNow();
    toast('✓', `${chanTitle(c)} read`, 1400);
    return true;
  }
  function chanRepaintAll() { for (const id of Object.keys(CH)) { const x = W[id]; if (x && !x.thread) rerenderList(x); } }
  // One item edit (spaces/<id>/name), never this device's whole list (live.js prefOps).
  function submitChannelRename(form) {
    if (!chatVars.rowSheet?.rename || !chatVars.rowSheet.chan) return;
    const cid = chatVars.rowSheet.chan, sp = spaces().find(s => s.id === cid), t = form.querySelector('input').value.replace(/\s+/g, ' ').trim();
    if (!sp) { closeRowSheet(); return; }
    if (!t || t.length > 60 || /[\u0000-\u001f\u007f]/u.test(t)) { form.querySelector('input').focus(); return; }
    if (spaces().some(s => s.id !== cid && spaceAgent(s) === spaceAgent(sp) && norm(s.name) === norm(t))) { toast('!', 'Already a channel with that name', 2200); return; }
    closeRowSheet();
    chanRenameTo(cid, t);
  }
  function chanRenameTo(cid, t, quiet = false) { // quiet: the model's emoji (issue 1605) renames with no toast
    const sp = spaces().find(s => s.id === cid); if (!sp || !t || t.length > 60) return false;
    if (spaces().some(s => s.id !== cid && spaceAgent(s) === spaceAgent(sp) && norm(s.name) === norm(t))) { toast('!', 'Already a channel with that name', 2200); return false; }
    if (t === sp.name) return true;
    if (chanStore()) LIVE.chanStore.patch({ id: cid, name: t }); // the store's channel (issue 1261)
    else LIVE.prefOps([{ op: 'set', key: `spaces/${cid}/name`, item: t }]);
    chanRepaintAll(); if (!quiet) toast('✎', 'Renamed', 1400);
    return true;
  }
  function channelSheetClick(e) {
    if (!chatVars.rowSheet?.chan) return false;
    const { wid, chan: cid } = chatVars.rowSheet, w = W[wid] || W[owner(wid)], p = chanPrefs(), name = spaces().find(s => s.id === cid)?.name || 'General';
    if (e.target.closest('[data-rschpin]')) { const on = !p.pins.includes(cid); p.pins = on ? p.pins.concat(cid) : p.pins.filter(x => x !== cid); chanPrefEdit(p, { id: cid, pinned: on }); closeRowSheet(); chanRepaintAll(); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    if (e.target.closest('[data-rschrename]')) { openChannelRename(wid, cid); return true; }
    if (e.target.closest('[data-rschcovers]')) { openChannelCovers(wid, cid); return true; }
    if (e.target.closest('[data-chcvsave]')) { submitChannelCovers(e.target.closest('.ch-covers')); return true; }
    if (e.target.closest('[data-rschemoji]')) { openChannelEmoji(wid, cid); return true; }
    const em = e.target.closest('[data-chemoji]'); if (em) { chanEmojiTap(em); return true; }
    if (e.target.closest('[data-rscharch]')) {
      const arch = !p.archived[cid], wasPinned = p.pins.includes(cid);
      if (arch) { p.archived[cid] = new Date().toISOString(); p.pins = p.pins.filter(x => x !== cid); } else delete p.archived[cid];
      chanPrefEdit(p, { id: cid, archived: arch, ...(arch && wasPinned ? { pinned: false } : {}) }); closeRowSheet(); chanRepaintAll(); toast('✓', `${arch ? 'Archived' : 'Restored'} # ${name}`, 1800); return true;
    }
    if (e.target.closest('[data-rschread]')) { closeRowSheet(); chanMarkRead(w, cid); return true; }
    if (e.target.closest('[data-rschnew]')) { closeRowSheet(); const t = w && chanTarget(w); if (t && openChannel(t, cid)) chanToEnd(t.id, true); return true; }
    return false;
  }
  // The channel taps; false = not a channel control. Each paints on the same frame.
  function channelClick(e, id, w) {
    if (!w) return false;
    if (channelSheetClick(e)) return true;
    if (w.thread) return false;
    const v = e.target.closest('[data-chview]'); if (v) { chatVars.chanView = v.dataset.chview === 'channels' ? 'channels' : 'activity'; try { localStorage.setItem(CHAN_VIEW_KEY, chatVars.chanView); } catch (_) {} rerenderList(w); return true; }
    const so = e.target.closest('[data-chchansort]'); if (so) { const p = chanPrefs(); p.sort = so.dataset.chchansort === 'za' ? 'za' : 'az'; chanPrefEdit(p, { sort: p.sort }); chanRepaintAll(); return true; }
    if (e.target.closest('[data-chchanarch]')) { chatVars.chanArchOpen = !chatVars.chanArchOpen; renderChatList(w, elOf(id)); return true; }
    if (e.target.closest('[data-chchanagents]')) { chatVars.chanAgentsOpen = !chatVars.chanAgentsOpen; renderChatList(w, elOf(id)); return true; }
    const x = e.target.closest('[data-chchanx]'); if (x) { const k = x.dataset.chchanx; if (chanExpanded.has(k)) chanExpanded.delete(k); else chanExpanded.add(k); renderChatList(w, elOf(id)); return true; }
    const c0 = e.target.closest('[data-chchan]'); if (c0) { openChannel(w, c0.dataset.chchan); return true; }
    const nc = e.target.closest('[data-chchannew]'); if (nc) { chanNewForm(w, nc); return true; }
    if (e.target.closest('[data-chchanback]')) { channelBack(w); return true; }
    const jp = e.target.closest('[data-chjump]'); if (jp && typeof jumpGo === 'function') { jumpGo(id, jp.dataset.chjump); return true; } // issue 1440: the feed's pills
    // Reply under an agent's post: its thread opens with the composer ready, so the reply continues that thread.
    const rp = e.target.closest('[data-chreply]'); if (rp) { openChat(id, rp.dataset.chreply); const focus = () => { const ta = (elOf(owner(id)) || elOf(id))?.querySelector('.ch-compose textarea'); if (ta) ta.focus({ preventScroll: true }); return !!ta; }; setTimeout(() => { if (!focus()) setTimeout(focus, 250); }, 60); return true; }
    const mo = e.target.closest('[data-chpostmore]'); if (mo) { const k = mo.dataset.chpostmore; if (chanMore.has(k)) chanMore.delete(k); else chanMore.add(k); renderChatList(w, elOf(id)); return true; }
    // A photo opens the shared media viewer (Back closes it: closeOverlay → KIT.viewer.close).
    const im = e.target.closest('[data-chpostimg]'); if (im) { const s = LIVE.sessionFor ? LIVE.sessionFor(im.dataset.chpostimg, im.dataset.chpostag || '') : LIVE.session(im.dataset.chpostimg), fp = s ? firstPost(s) : null, g = fp ? (fp.none && fp.agent ? fp.agent.media : fp.media) || [] : []; if (g.length) KIT.viewer.open(g, Math.min(g.length - 1, Math.max(0, +im.dataset.i || 0))); return true; }
    return false;
  }
  /* A channel's message box, its own posts and Sending…; core/chats-chanbox.js. */
  const { boxModel, chanCompose, chanComposer, chanDraftKey, chanDropSending, chanEditUnsent, chanModel, channelSend, chanOwnPost, chanSending, chanSpaceOf, chanToEnd, setChanModel, bindLate: chanboxLate } = window.WizCore.chatsParts.chanbox({ AGS: (...a) => AGS(...a), ch, CH, CHAN_TEXT_MAX, chanArchived, chanOpen, chanRepaint, chanTitle, elOf: (...a) => elOf(...a), esc, FIRST, firstAgent, focusAgentId, growTa, H, KIT, OUTBOX, owner: (...a) => owner(...a), renderChatList, spaceContains, toast, viewContext, W, winAgent });
  feedLate({ chanSending });
  function clearAll(w) { const c = ch(w.id); c.filter = ''; c.q = ''; c.filterFrom = null; window.WizCore.chatSearch?.cancel(w.id); rerenderList(w); }
  function setQuery(w, q) { const c = ch(w.id); if (w.thread) chatsBack(w); c.q = String(q || ''); rerenderList(w); }
  const SEC_DEFAULT = { errors: true, working: true, saved: true, ready: true, yesterday: true, pastWeek: false, deferred: false, archive: false, recent: true, snoozed: false, archived: false, sentWorking: true, sentProcessed: true };
  return { boxModel, chanboxLate, chanCompose, chanComposer, chanDraftKey, chanDropSending, chanEditUnsent, chanEmojiPick, chanEmojiSync, chanEmojiTap, chanModelEmoji, chanHead, chanHold, chanKey, chanMark, chanModel, channelClick, channelFeed, channelsBody, channelSend, chanOwnPost, chanRepaint, chanScrolled, chanSetEmoji, chanSpaceOf, chanToEnd, chanUser, clearAll, feedLate, openChannelSheet, SEC_DEFAULT, setChanModel, setQuery, submitChannelRename, bindLate: v => { if ('ACT' in v) ACT = v.ACT; if ('elOf' in v) elOf = v.elOf; if ('holdList' in v) holdList = v.holdList; if ('mediaOfFile' in v) mediaOfFile = v.mediaOfFile; if ('openSpacePicker' in v) openSpacePicker = v.openSpacePicker; if ('orderBar' in v) orderBar = v.orderBar; if ('RENAME_SVG' in v) RENAME_SVG = v.RENAME_SVG; } };
};
