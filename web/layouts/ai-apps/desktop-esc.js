/* Wizard UX AI apps view (desktop) › the tidy sheet and Esc stepping back one layer. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { tidySentence } from './parts.js';
export function escPart({ aadVars, api, chatBack, chatsEl, closeMenu, closeTidy, cTop, doc, el, feedBack, goApp, listBack, one, oneApp, oneSplit, paintList, paintTidy, panes, pTop, side, tidyBtn, tidyKey, vtAll, vtFoot, windowMode }) {
  let paintTop; // late-bound: desktop.js declares these after the call, see bindLate
  function openTidy() {
    if (aadVars.tidyPop) { closeTidy(); return; } closeMenu();
    aadVars.tidyPop = el('div', 'aad-tidyx', { role: 'group', 'aria-label': 'Tidy up' });
    aadVars.tidyPop.append(tidySentence(doc, tidyKey(), k => { api.storage.set('tidy', k); paintTidy(); }, 'aad-tidys'));
    vtFoot.replaceChildren(vtAll, aadVars.tidyPop, tidyBtn); aadVars.offTidyBack = api.back.push(closeTidy); tidyBtn.setAttribute('aria-expanded', 'true');
    api.after(0, () => aadVars.tidyPop?.querySelector('select')?.focus?.({ preventScroll: true }));
  }
  api.listen(tidyBtn, 'click', openTidy);
  api.listen(doc, 'pointerdown', e => { if (aadVars.tidyPop && !aadVars.tidyPop.contains(e.target) && !tidyBtn.contains(e.target)) closeTidy(); }, true);
  paintTidy();

  /* ---------- keys (round 21 below): Esc steps back one layer: the picker, then the wide panel, then the panel hides,
   * then the chat column ---------- */
  // Escape navigation is a surface callback, not an early layout key. Recording
  // and the shared recency stack must finish first. A root press is consumed
  // without sending the hidden Classic Chats window through threadBack(__new__).
  let lastSurface = 'chat';
  const typing = () => { const a = doc.activeElement; return !!a && /^(TEXTAREA|INPUT)$/.test(a.tagName || '') && !!a.value; };
  const rememberSurface = e => {
    let slot;
    if (aadVars.secondEl?.contains(e.target)) slot = 'app2';
    else if (aadVars.pane?.el?.contains(e.target) || pTop.contains(e.target)) slot = 'app';
    else if (chatsEl()?.contains(e.target) || cTop.contains(e.target)) slot = 'chats';
    if (slot) { lastSurface = slot === 'chats' ? 'chat' : 'app'; if (panes.get().focus !== slot) panes.set({ focus: slot }); }
    else if (side.contains(e.target)) lastSurface = 'chat';
  };
  api.listen(doc, 'pointerdown', rememberSurface, true);
  api.listen(doc, 'focusin', rememberSurface, true);
  api.back.surface?.(() => {
    // Shared registry has already offered recording and transient overlays.
    if (panes.get().mode === 'full') {
      // A channel post's thread full screen: Esc is its "‹ # channel" Back, the feed again and still full screen
      // (wizard-ux issue 1325: going back never changes the owner's view). Full screen shows only the focused slot, so
      // the panes' focus decides, never a stale focus left in the hidden app's frame (Codex, PR 1390).
      // The same for a chat from the list, which full screen hides: Back shows the list over it, still full screen.
      if (panes.get().focus === 'chats' && (feedBack() || listBack())) { chatBack(); return true; }
      // Overlay-first: a sheet or nested view inside the focused app closes before Esc leaves full screen.
      const act = doc.activeElement, frame = aadVars.pane && (aadVars.pane.el.contains(act) || (lastSurface === 'app' && !chatsEl()?.contains(act))) ? aadVars.pane.el.querySelector?.('iframe') : null;
      // 'pending': a sandboxed app (browser boundary) answers later; at its root full screen ends then.
      // Leaving full screen goes back to the view it came from (50/50, centred or tiled; wizard-ux issue 1325).
      const r = frame ? globalThis.WizAppServices?.back?.(frame, () => windowMode(aadVars.fullFrom)) : null;
      if (r === 'handled' || (r === 'pending' && globalThis.WizBrowserBoundary?.owns(frame))) return true;
      windowMode(aadVars.fullFrom); return true;
    }
    const a = doc.activeElement;
    // A mixed Chats/app desk can have a focused iframe without an AI-apps pane.
    // Do not consume its Back: the shell's focused-window fallback owns that app.
    if (a?.tagName === 'IFRAME' && !aadVars.pane?.el?.contains(a)) return false;
    const appFocused = !!aadVars.pane && (aadVars.pane.el.contains(a) || pTop.contains(a) || (lastSurface === 'app' && !chatsEl()?.contains(a)));
    if (appFocused) api.apps.back?.(aadVars.pane.id);
    // one app at a time, the chat alone (narrower than ONE.split): one level up is the list it came from (a post from a
    // channel's feed has its own "‹ # channel" first); at the list (the root) Back goes to the app that was in front
    // before Chats, while it is open (wizard-ux issues 1314, 1452), else it stays put: never out of Wizard
    else if (one() && !aadVars.pane && !oneSplit() && !feedBack()) { const was = aadVars.oneList && oneApp(); if (was) goApp(was.id, was.desk); else if (!chatBack() && !aadVars.oneList) { aadVars.oneList = true; paintTop(); } }
    else if (aadVars.docked) chatBack();
    else if (api.sessions?.channelBack?.()) paintList(); // Channels: thread → channel → list (issue 1256)
    return true; // bare AI apps desktop: no DOM change, no legacy navigation
  });
  return { openTidy, typing, bindLate: v => { if ('paintTop' in v) paintTop = v.paintTop; } };
}
