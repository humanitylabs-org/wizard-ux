/* Wizard UX AI apps view (desktop) › a post opened from a channel feed and the way back to it. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
export function feedPart({ aadVars, api, cBack, chanTitle, FEED, feedBox, feedGone, feedOn, mainChats, one, oneSplit, panes, unpeek }) {
  let chatBack, here, listBack, paintTop; // late-bound: desktop.js declares these after the call, see bindLate
  function feedPost(e) {
    const t = e?.target, row = t?.closest?.('[data-chopen], [data-chreply]'), open = feedOn();
    if (!row || !open || t.closest('.ch-post-t a[href]') || t.closest('.ch-sheet')) return;
    // (its title too: a post older than the loaded Activity list is in no list titleOf reads, wizard-ux issue 1329)
    const title = row.closest('.ch-post')?.dataset?.chtitle || '';
    aadVars.fromFeed = { sid: row.dataset.chopen || row.dataset.chreply, id: open.id, name: open.name, title };
  }
  api.listen(feedBox, 'click', feedPost, true);
  // The channel the chat in the column goes back to, or null: only that post, docked, with its channel still open.
  function feedBack() {
    if (!aadVars.fromFeed || !aadVars.docked || aadVars.chatThread !== aadVars.fromFeed.sid) return null;
    const open = feedOn(); return open && open.id === aadVars.fromFeed.id ? open : null;
  }
  // the title of the post opened from the feed: an older post is in no list, and the lists match by id alone (a routed
  // agent's post may share its id with a main chat), so the post the owner clicked names it first
  function feedTitle(sid) { return aadVars.fromFeed && aadVars.fromFeed.sid === sid ? aadVars.fromFeed.title || '' : ''; }
  function paintBack() {
    // another chat (or none) in the column: that post's Back is spent; the feed itself keeps it for a reopen
    if (aadVars.fromFeed && aadVars.chatThread !== aadVars.fromFeed.sid && aadVars.chatThread !== FEED) aadVars.fromFeed = null;
    const b = feedBack(), up = b ? '' : listBack(); cBack.hidden = !b && !up; if (!b && !up) return;
    const name = b ? (typeof chanTitle === 'function' ? chanTitle(b) : `# ${b.name || ''}`) : up; cBack.textContent = `‹ ${name}`; cBack.title = 'Back (Esc)'; cBack.setAttribute('aria-label', `Back to ${name} (Esc)`);
  }
  api.listen(cBack, 'click', () => chatBack());
  // A channel opened in the sidebar: its feed comes into the column in place of the chat there (the app panel stays).
  function feedOpened(open) {
    // the feed closed by its own Back to channels: as Esc, the app it was brought in front of gets the front back
    if (!open) { feedGone(); paintTop(); return; }
    unpeek(); // (a channel picked in the list shown over the page: its feed in front)
    // one app at a time, the list alone (narrower than ONE.split): a channel picked there shows its feed, also when a
    // feed was already open behind the list (opened wide before the window narrowed, or restored); paintOne only sees
    // the column's thread change, and FEED stays FEED (wizard-ux issue 1452)
    if (one() && !aadVars.pane && !oneSplit()) { aadVars.oneList = false; aadVars.oneSeen = FEED; }
    const h = here(), r = api.route();
    // (no main Chats window yet, as on a desk holding only an app: the new chat makes the column the feed lies over)
    if (h.thread || h.note || h.draft || !mainChats() || (!h.app && (r.home || r.view !== 'thread'))) { aadVars.noteWant = false; aadVars.draftWant = false; aadVars.chatThread = null; api.sessions.newChat(); }
    else if (h.app) aadVars.chatThread = FEED;
    // With an app centred (or full) the feed comes to the front, as opening a chat does; closing the feed gives the
    // front back to the app, in the same view (wizard-ux issue 1344)
    const f = panes.get().focus;
    if (f !== 'chats') { aadVars.feedFocus = f; panes.set({ focus: 'chats' }); }
    paintTop();
  }
  return { feedBack, feedOpened, feedTitle, paintBack, bindLate: v => { if ('chatBack' in v) chatBack = v.chatBack; if ('here' in v) here = v.here; if ('listBack' in v) listBack = v.listBack; if ('paintTop' in v) paintTop = v.paintTop; } };
}
