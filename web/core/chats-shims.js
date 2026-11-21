/* Wizard UX core: Chats › the shims: the original body's names (windows, toasts, layout, agents, reading the
 * box) backed by the shell's host. Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.shims = function ({ H, openChat, saveDraft }) {
  let KIT; // late-bound: chats.js declares these after the call, see bindLate
  const { esc, clip, norm, ago, emoOf } = window.WizCore;
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const reach = () => window.WizReach?.failure() || { short: 'Reconnecting…' };
  // Short line for a failing request; operation 'send' | 'read' (WizReach.label owns the wording).
  const reachLabel = (operation, count) => window.WizReach?.label ? window.WizReach.label(operation, { count }) : reach().short;
  const troubleshoot = '<button type="button" class="pbtn" data-chtroubleshoot>Open Troubleshooter</button>';
  /* ---- shims: the original body's names, backed by the host ---- */
  const W = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? H.win(id) : undefined) });
  const track = { querySelector: sel => H.root().querySelector(sel) };
  const save = () => H.save();
  const toast = (...a) => H.toast(...a);
  const viewContext = (id, how) => H.viewContext(id, how);
  const winTitle = w => isHosted(w.id) ? LIVE?.session(w.thread)?.title || 'Thread' : H.title(w);
  const deskOf = id => id;
  const applyLayout = id => H.layout(id);
  const idx = 0, desks = [{ get wins() { return H.visible(); } }];
  const vib = ms => { if (H.vib) return H.vib(ms); try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  /* ---- end shims ---- */

  // A hosted thread borrows the exact standard chat UI without replacing its app iframe.
  // Entries and thread fields are ephemeral: shell persistence must still restore the app.
  const hosted = new Map();
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
  return { ago, androidDocument, applyLayout, ch, CH, clip, closeHosted, deskOf, desks, esc, hosted, idx, isHosted, LIVE, norm, openHosted, OUTBOX, prepThread, reach, reachLabel, save, toast, track, troubleshoot, vib, viewContext, W, winTitle, bindLate: v => { if ('KIT' in v) KIT = v.KIT; } };
};
