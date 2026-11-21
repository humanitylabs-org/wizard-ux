/* Wizard UX core: Chats › an app's thread opened over its window (what it brings along, closing it), the
 * per-window state and the document-scrolling check. Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.hosted = function ({ hosted, LIVE, saveDraft }) {
  let KIT; // late-bound: chats.js declares these after the call, see bindLate
  // What an app's thread brings along, wherever it opens (over the app, or the main Chats for a layout that keeps
  // chats apart from apps): its agent, and its item as the reply beside the thread's draft. False = not allowed.
  function prepThread(sid, opts = {}) {
    const rp = opts?.reply ? KIT.reply.clean(opts.reply) : null;
    // A newly-created agent thread may not be in the next session-list refresh yet.
    if (opts?.agent != null) {
      const a = typeof opts.agent === 'string' ? window.WosAgents?.get(opts.agent) : null;
      if (!a || a.status !== 'running' || !window.WosAgents.isOther(opts.agent) || typeof LIVE.pinAgent !== 'function') return false;
      if (opts.draft && !KIT.drafts.admit('direct:' + sid, opts.draft.text, rp)) return false;
      LIVE.pinAgent(sid, opts.agent);
    }
    else if (opts.draft && !KIT.drafts.admit('direct:' + sid, opts.draft.text, rp)) return false;
    // An app item (Wisdom passage) rides beside this thread's draft as its reply, framed only into the next message.
    // It never replaces one already waiting there, and the composer stays the owner's own words.
    if (rp && sid !== '__new__' && !KIT.drafts.get('direct:' + sid).reply) KIT.drafts.setReply('direct:' + sid, rp);
    return true;
  }
  function closeHosted(wid) {
    const entry = hosted.get(wid); if (!entry) return false;
    saveDraft(wid); const c = ch(wid); c.readNav = (c.readNav || 0) + 1;
    c.trail = []; c.loadedFor = ''; c.draftFor = '';
    hosted.delete(wid); entry.layer.remove(); entry.frame.inert = false; entry.frame.style.visibility = '';
    entry.container.style.position = entry.oldPosition;
    if (entry.previous) Object.defineProperty(entry.w, 'thread', entry.previous); else delete entry.w.thread;
    return true;
  }
  const isHosted = wid => hosted.has(wid);
  const CH = {}; // per window: { q, turns, loadedFor, loading, pending, err, at, show, files }
  const ch = id => (CH[id] = CH[id] || { q: '', turns: null, loadedFor: '', pending: [], at: 0 });
  // Android's built-in WebView capture scrolls the DOCUMENT, never an overflow div.
  // Keep the real thread and delegated events in their existing shell DOM.
  // Document scrolling needs an APK that dropped the custom scroll capture and scroll proxy; such APKs
  // say so in their user agent. Older APKs (any version line) keep inner-div scrolling.
  const androidDocument = /\bWizardOS-DocScroll\b/.test(navigator.userAgent);
  return { androidDocument, ch, CH, closeHosted, isHosted, prepThread, bindLate: v => { if ('KIT' in v) KIT = v.KIT; } };
};
