/* Wizard UX core: Chats › channel emoji: the emoji row under the name field of New channel and Rename, and
 * setting a channel's emoji. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.chanemoji = function ({ chanFace, chanRenameTo, esc, norm, openEmojiSheet, spaceAgent, spaces, toast }) {
  /* Channel emoji (issue 1506): a row of emoji under the name field of New channel and Rename. A tap puts that emoji in
   * front of the name; a tap on the one already there takes it off (the list then shows 💬). Any other emoji: type it
   * first in the name, or Emoji… in the channel's actions (the full emoji sheet with search). */
  function chanEmojiPick(name) {
    const L = window.WizCore?.CHANNEL_EMOJI; if (!Array.isArray(L)) return '';
    const f = chanFace(String(name || '')), cur = f.own ? f.emoji : '';
    return `<div class="ch-emoji-pick" role="group" aria-label="Channel emoji">${L.map(e => `<button type="button" data-chemoji="${esc(e)}" aria-pressed="${e === cur}" aria-label="Emoji ${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  }
  function chanEmojiSync(form) {
    const f = chanFace(String(form?.querySelector('input')?.value || '')), cur = f.own ? f.emoji : '';
    for (const x of form?.querySelectorAll('[data-chemoji]') || []) x.setAttribute('aria-pressed', String(x.dataset.chemoji === cur));
  }
  function chanEmojiTap(b) {
    const form = b?.closest('form'), inp = form?.querySelector('input'); if (!inp || inp.disabled) return false;
    const f = chanFace(inp.value), e = b.dataset.chemoji, off = f.own && f.emoji === e, t = window.WizCore.channelEmojiName(inp.value, off ? '' : e);
    if (!t) { toast('!', 'Name too long for an emoji: shorten it first', 2200); inp.focus(); return true; }
    inp.value = t;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    chanEmojiSync(form); return true;
  }
  // The full emoji sheet (the topic emoji one) for a channel; the pick renames it with that emoji in front.
  function openChannelEmoji(wid, cid) {
    const sp = spaces().find(s => s.id === cid); if (!sp) return false;
    openEmojiSheet(wid, `chanemoji:${cid}`, `Emoji for ${chanFace(sp.name).label || chanFace(sp.name).emoji}`);
    return true;
  }
  function chanSetEmoji(cid, e) {
    const sp = spaces().find(s => s.id === cid); if (!sp || !e) return false;
    const f = chanFace(sp.name), off = f.own && f.emoji === e;
    let t = window.WizCore.channelEmojiName(sp.name, off ? '' : e);
    if (!t) { toast('!', 'Name too long for an emoji: shorten it first', 2200); return false; }
    // An emoji-only name taken off becomes 'Channel'; a second one of the same agent gets 'Channel 2', and so on.
    if (off && !f.bare) { const taken = n => spaces().some(s => s.id !== cid && spaceAgent(s) === spaceAgent(sp) && norm(s.name) === norm(n)); for (let i = 2; taken(t); i++) t = `Channel ${i}`; }
    return chanRenameTo(cid, t) !== false;
  }
  return { chanEmojiPick, chanEmojiSync, chanEmojiTap, chanSetEmoji, openChannelEmoji };
};
