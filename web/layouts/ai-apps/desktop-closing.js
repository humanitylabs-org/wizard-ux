/* Wizard UX AI apps view (desktop) › hiding the app panel, closing the chat column and Back. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
export function closingPart({ aadVars, anim, api, cX, doneLoading, DRAFT, FEED, feedBack, feedGone, flip, focusFrame, icon, mainChats, one, oneSplit, paintSide, paintSplit, panes, peekable, pTop, pW, pX, reduced, retileSoon, root, wantAppFocus }) {
  let here, paintTop; // late-bound: desktop.js declares these after the call, see bindLate
  function hidePanel({ home: goBack = true } = {}) {
    if (!aadVars.pane || aadVars.closing) return !!aadVars.pane;
    const was = aadVars.pane, el0 = was.el, w0 = el0.getBoundingClientRect?.().width || 480;
    const finish = () => {
      aadVars.closing = null; if (aadVars.pane !== was) { out?.cancel?.(); aadVars.exitMotion = null; return; }
      aadVars.pane = null; setWide(false); doneLoading(); anim('close');
      // (Home / Focus: the route still names the app until the new chat lands; don't take it back as the panel meanwhile)
      if (!goBack) aadVars.dropped = { id: was.id, desk: Number(was.desk) };
      const m = mainChats();
      if (goBack && here().app === was.id) { if (m) api.nav.goDesk(m.desk); else api.sessions.newChat(); }
      paintSplit(!!aadVars.chatThread); paintTop();
      api.frame(() => { out?.cancel?.(); if (aadVars.exitMotion === out) aadVars.exitMotion = null; });
    };
    // (one app at a time: Chats replaces the app at once, on the click's own frame; no slide out)
    const out = goBack && !reduced() && !one() && typeof el0.animate === 'function' ? el0.animate([{ translate: '0px 0px', opacity: 1 }, { translate: `${Math.min(w0, 480)}px 0px`, opacity: 0.3 }], { duration: 180, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }) : null;
    aadVars.exitMotion = out;
    if (out) aadVars.closing = api.after(180, finish); else finish();
    return true;
  }
  // the chat column goes: Home (a new chat); the app panel (if any) stays
  function closeChat() {
    if (!aadVars.docked) return false;
    // Closing never changes the owner's view (wizard-ux issues 1330, 1325; James: "going back shouldn't change the
    // user's selected view"): a post's thread back to its feed, the feed closed and a plain chat closed all leave 50/50,
    // centred or full as they were; the new chat takes the chat slot.
    // the channel's feed: closed (nothing open); from a post opened in it, Back lands on the feed again (paintTop)
    if (aadVars.chatThread === FEED) feedGone(); // (brought in front of a centred app: the app gets the front back, issue 1344)
    if (aadVars.chatThread === FEED) { aadVars.chatThread = null; anim('undock'); api.sessions.channelBack?.(); paintTop(); return true; }
    if (!feedBack()) aadVars.feedFocus = null; // a plain chat closing: no feed to give the front back from
    aadVars.chatThread = null; aadVars.noteWant = false; aadVars.draftWant = false; anim('undock');
    api.sessions.newChat(); return true;
  }
  /* One level up from the column wherever the list is not beside it (James, 12 Nov 2026: "I am missing a back button
   * here at smaller width ... It either takes them back to the channels or the chats list, wherever is one level above
   * where they were last"): a narrow window (the rail), the sidebar folded, or full screen. The name of the list it goes
   * to, or '' (the list beside it, a post's own "‹ # channel" Back, a new chat, or one app at a time's own Back). */
  function listBack() {
    if (!aadVars.docked || !aadVars.chatThread || aadVars.chatThread === DRAFT || feedBack()) return '';
    // one app at a time (ONE): the chat alone, narrower than ONE.split (its list, oneList, is the level above it)
    if (one()) { if (aadVars.pane || oneSplit() || aadVars.oneList) return ''; }
    else if (root.dataset.aadSide === 'open' && panes.get().mode !== 'full') return '';
    if (aadVars.chatThread === FEED) return 'Channels';
    const v = api.sessions.channelView?.() || '';
    return v === 'channels' ? 'Channels' : v === 'activity' ? 'Activity' : 'Chats';
  }
  // Back (the header's ‹ and Esc): the column one level up (closeChat: a post to its feed, the feed or a chat closed);
  // a chat that came from the list shows that list again, over the page, at its place (its own Back / a tap outside
  // closes it). In page only: never a history step, so Back at the root never leaves Wizard.
  function chatBack() {
    const up = listBack();
    // one app at a time: the list fills the window again; the chat stays open behind it (Chats as it was)
    // (a channel's feed closes, as wide: one level up from it is the channel list; a chat stays open behind its list)
    if (one() && up) { if (aadVars.chatThread === FEED) closeChat(); aadVars.oneList = true; paintTop(); return true; }
    if (!closeChat()) return false;
    if (up && !aadVars.peek && peekable()) { aadVars.peek = true; aadVars.offPeek = api.back.push(() => { aadVars.peek = false; aadVars.offPeek = null; paintSide(); }); paintSide(); }
    return true;
  }
  function setWide(on) {
    const w = !!on && !!aadVars.pane; if (w === aadVars.wide) { paintWide(); return; } aadVars.wide = w;
    flip([aadVars.pane?.el], () => { if (aadVars.wide) root.dataset.aadWide = ''; else delete root.dataset.aadWide; });
    paintWide(); retileSoon();
  }
  function paintWide() {
    pW.setAttribute('aria-pressed', String(aadVars.wide)); pW.replaceChildren(icon(aadVars.wide ? 'shrink' : 'expand'));
    pW.title = aadVars.wide ? 'Back to the side (⌥F)' : 'Wider (⌥F)'; pW.setAttribute('aria-label', aadVars.wide ? 'Make the app panel narrower again' : 'Make the app panel wider');
  }
  paintWide();
  api.listen(pX, 'click', () => hidePanel());
  // a click anywhere on the app panel's bar hands the keyboard back to the app (its buttons never keep it)
  api.listen(pTop, 'mousedown', e => e.preventDefault());
  api.listen(pTop, 'click', e => { if (aadVars.pane && !e.target?.closest?.('.aad-px') && !aadVars.focusing) { wantAppFocus(aadVars.pane.id); aadVars.focusing = true; focusFrame(); } });
  api.listen(cX, 'click', closeChat);
  api.listen(pW, 'click', () => { aadVars.wideAuto = false; setWide(!aadVars.wide); });
  return { chatBack, closeChat, hidePanel, listBack, setWide, bindLate: v => { if ('here' in v) here = v.here; if ('paintTop' in v) paintTop = v.paintTop; } };
}
