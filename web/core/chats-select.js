/* Wizard UX core: Chats › selecting text: a working thread holds its repaint while you select, touch or scroll in
 * it, and catches up once you let go. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.select = function ({ ch, CH, flushHeld, idOf }) {
  /* Selecting text (James, 12 Oct): a working thread re-renders on every new step, which replaced the bubble under
   * a long-press (Android cancels the press) and wiped any selection a few seconds later. Background updates now
   * wait while a finger is down on the messages or text is selected in them, and land once the selection clears. */
  // A selection holds updates for two minutes at most, so a forgotten one never freezes a working thread.
  const SEL = { down: null, at: 0, x: 0, y: 0, since: 0 }, SEL_MAX = 120000;
  // Native scrolling cancels Pointer Events before the finger lifts. Touch Events retain ownership;
  // scroll events keep the same nodes through inertia. Only background paints use these guards.
  const TOUCH = new Map(), SCROLL_IDLE = 350;
  let idleT = 0;
  function scheduleHeld() { clearTimeout(idleT); idleT = setTimeout(flushHeld, SCROLL_IDLE); }
  function readingIn(el) {
    const g = ch(idOf(el)).reading;
    if (!g || !g.node.isConnected || !el.contains(g.node)) return false;
    // Recovery for a lost end event, not a 15-second deadline on a genuine slow drag.
    if (g.touches.size && Date.now() - g.at < SEL_MAX) return true;
    return Date.now() < g.until;
  }
  function readGuard(node) {
    const c = ch(idOf(node));
    if (!c.reading || c.reading.node !== node) c.reading = { node, touches: new Set(), at: 0, until: 0 };
    return c.reading;
  }
  function clearReading(id) {
    const g = CH[id]?.reading; if (!g) return;
    for (const [key, owner] of TOUCH) if (owner === g) TOUCH.delete(key);
    if (SEL.down === g.node) SEL.down = null;
    delete CH[id].reading; // explicit navigation/remount must not retain a detached touch target
  }
  function resetReading() {
    TOUCH.clear(); SEL.down = null;
    for (const c of Object.values(CH)) if (c.reading) { c.reading.touches.clear(); c.reading.until = 0; }
    scheduleHeld();
  }
  document.addEventListener('touchend', endTouches, { capture: true, passive: true });
  document.addEventListener('touchcancel', endTouches, { capture: true, passive: true });
  function endTouches(e) {
    for (const t of e.changedTouches) {
      const g = TOUCH.get(t.identifier); if (!g) continue;
      g.touches.delete(t.identifier); g.until = Date.now() + SCROLL_IDLE; TOUCH.delete(t.identifier);
    }
    if (!TOUCH.size) SEL.down = null;
    scheduleHeld();
  }
  document.addEventListener('visibilitychange', () => { resetReading(); });
  window.addEventListener('pagehide', resetReading);
  window.addEventListener('blur', resetReading);
  function selectingIn(el) {
    if (readingIn(el)) return true;
    if (SEL.down && el.contains(SEL.down) && Date.now() - SEL.at < SEL_MAX) return true;
    const s = window.getSelection?.(); if (!s || s.isCollapsed || !s.rangeCount) return false;
    if (SEL.since && Date.now() - SEL.since > SEL_MAX) return false;
    const n = s.anchorNode, e = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!e && el.contains(e) && !!e.closest('.ch-msgs');
  }
  return { clearReading, readGuard, readingIn, scheduleHeld, SCROLL_IDLE, SEL, selectingIn, TOUCH };
};
