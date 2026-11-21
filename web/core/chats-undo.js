/* Wizard UX core: Chats › the one Undo after an archive (restore the thread where it was), and the names of a
 * channel's read marks. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.undo = function ({ esc, LIVE, paintListsNow, toast, vib }) {
  /* The one Undo after an archive (issue 1336: "if the user archives something accidentally, how will they find it
   * quickly"): about five seconds, from any surface that archives a thread (row menus, swipe, the thread's own button,
   * the AI apps sidebar); Undo restores it where it was. Opaque, above the shell's own toast. */
  const ACT_UNDO_MS = 5000;
  let actUndoEl = null, actUndoT = 0;
  function actUndo(label, undo) {
    if (typeof document.createElement !== 'function' || !document.body) return false;
    clearTimeout(actUndoT); actUndoEl?.remove();
    const el = document.createElement('div'); el.className = 'ch-undo'; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(label)}</span><button type="button" data-chundo>Undo</button>`;
    el.querySelector('[data-chundo]').addEventListener('click', () => { clearTimeout(actUndoT); el.remove(); if (actUndoEl === el) actUndoEl = null; vib(8); undo(); });
    document.body.append(el); actUndoEl = el;
    actUndoT = setTimeout(() => { el.remove(); if (actUndoEl === el) actUndoEl = null; }, ACT_UNDO_MS);
    return true;
  }
  // Undo of a thread's archive: after that archive's write settled (pending: its promise), the restore, then every list.
  async function actRestore(sid, pending) {
    await Promise.resolve(pending).catch(() => {});
    const ok = await LIVE.restore(sid);
    if (!ok) toast('!', 'Couldn’t undo · still archived', 3200);
    paintListsNow();
    return ok;
  }
  /* A channel's read watermark (wizard-ux issue 1316, which supersedes the opening place and New line of 1263 and 1269;
   * James, 12 Nov 2026: "Just track their scroll position in the channel as what they have read. If they've scrolled
   * to the bottom of the channel, mark the whole thing as read"). Slack's model: each channel keeps the newest activity
   * time (chanAt: a post's start or its latest reply) the owner has scrolled past in its feed; the end of the feed is
   * all of it. A post is new for the channel only when it changed after the mark. That alone places the opening and
   * the New line and makes the channel's line bold. A reply never opened keeps its own "● New reply" words
   * (chanUnread), passive only: it never moves the opening, the line or the channel's state.
   * The mark lives on this device (localStorage). A channel never read here counts as read up to when this device first
   * kept marks (since), so nothing old comes back as new. A move forward is written at most once per CHAN_READ_MS.
   * With Channels on (the read point had its own switch until wizard-ux issue 1358; wizard-agent-service issue 471) the marks are also
   * kept on the box (LIVE.chanReads, /wizard/v1/channels/read), so every device of the owner reads the newer of its
   * own mark and the box's: reading a channel to the bottom on the desktop clears it on the phone. */
  const CHAN_READ_KEY = 'wos.chats.channel-read.v1', CHAN_READ_MAX = 300, CHAN_READ_MS = 2000, CHAN_READ_UP_MS = 30e3, chanActs = {};
  return { actRestore, actUndo, CHAN_READ_KEY, CHAN_READ_MAX, CHAN_READ_MS, CHAN_READ_UP_MS, chanActs };
};
