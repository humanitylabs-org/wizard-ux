/* Wizard UX core: Chats › list places: the return bookmark of a Chats list, putting it back after a repaint and
 * holding it while the list settles. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.places = function ({ ch, elOf }) {
  // The phone replaces the list with the thread. Keep a bounded return bookmark before
  // that replacement, including nearby row anchors so Done or live updates above it
  // can remove/reorder rows without moving the surviving row under James's eyes.
  function listPlace(el) {
    const sc = el?.querySelector('.ch-scroll'); if (!sc) return null;
    const top = sc.scrollTop, edge = sc.getBoundingClientRect().top;
    const rows = top > 0 ? [...sc.querySelectorAll('[data-chopen]')].filter(r => r.getBoundingClientRect().bottom > edge).slice(0, 8) : [];
    return { top, rows: rows.map(r => ({ id: r.dataset.chopen, section: r.closest('[data-sec]')?.dataset.sec, y: r.getBoundingClientRect().top - edge })) };
  }
  // After an in-place patch the scroller kept its offset: only a row above that grew or shrank may move the reader.
  // Never re-assign an unchanged scrollTop (that stops a phone's momentum scroll mid-fling).
  function anchorListPlace(sc, place) {
    if (!sc || !place || !place.rows.length) return;
    const edge = sc.getBoundingClientRect().top, rows = [...sc.querySelectorAll('[data-chopen]')];
    for (const anchor of place.rows) {
      const row = rows.find(r => r.dataset.chopen === anchor.id && r.closest('[data-sec]')?.dataset.sec === anchor.section);
      if (row) { const d = row.getBoundingClientRect().top - edge - anchor.y; if (Math.abs(d) >= 1) sc.scrollTop += d; break; }
    }
  }
  /* Put the return bookmark back; true once it landed. A scroller with no layout yet (its window hidden, parked or
   * mid-transition on the phone) ignores scrollTop and sits at 0, and rows not painted yet clamp it short. Every
   * later paint then read that 0 as the place, so a reply or Done sent James to the top of Chats although Back kept
   * his spot (James, 24 Oct 2026). */
  function restoreListPlace(sc, place) {
    if (!sc || !place) return true;
    if (place.top < 1) { sc.scrollTop = 0; return true; }
    if (!sc.isConnected || !sc.getClientRects().length || !sc.clientHeight) return false;
    sc.scrollTop = place.top;
    const rows = [...sc.querySelectorAll('[data-chopen]')];
    for (const anchor of place.rows) {
      // Done can leave the same ID visible in expanded Archive. Follow a surviving
      // neighbor in the original section, never the archived row to its new home.
      const row = rows.find(r => r.dataset.chopen === anchor.id && r.closest('[data-sec]')?.dataset.sec === anchor.section);
      if (row) { sc.scrollTop += row.getBoundingClientRect().top - sc.getBoundingClientRect().top - anchor.y; return true; }
    }
    return Math.abs(sc.scrollTop - place.top) < 2;
  }
  // Keep putting an unlanded bookmark back each frame (≤3 s) until it lands, the thread changes, James touches the
  // list, or anything else scrolls it.
  // The window body can be remounted meanwhile, so each frame looks up the live scroller.
  function holdListPlace(w, el, place, ms = 3000) {
    const c = ch(w.id), until = Date.now() + ms; c.listPending = place;
    let box = el.querySelector('.ch-scroll'), mine = box?.scrollTop ?? 0;
    const step = () => {
      if (c.listPending !== place) return;
      const sc = (elOf(w.id) || el).querySelector('.ch-scroll');
      if (sc !== box) { box = sc; mine = sc?.scrollTop ?? 0; }
      if (w.thread || !sc || Date.now() > until || Math.abs(sc.scrollTop - mine) >= 1) { c.listPending = null; return; }
      if (restoreListPlace(sc, place)) { c.listPending = null; return; }
      mine = sc.scrollTop; requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  /* One remembered place per Chats list, whatever repaints or replaces it (James, 25 Oct 2026: tapping Reload on an
   * update put him back at the top; Back, Done and a reply had each been fixed one route at a time). Every scroll of a
   * laid-out list saves its bookmark here, and so does leaving the page; a list painted with no place of its own (a
   * fresh page after Reload, an app restart within the hour) takes it back. The key includes what the list shows, so
   * a different agent, Space, filter or search starts at its own top. */
  const LIST_PLACE_KEY = 'wos.chats.list-place.v1', LIST_PLACE_TTL = 60 * 60 * 1000;
  return { anchorListPlace, holdListPlace, LIST_PLACE_KEY, LIST_PLACE_TTL, listPlace, restoreListPlace };
};
