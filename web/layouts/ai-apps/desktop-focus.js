/* Wizard UX AI apps view (desktop) › focusing an app, All apps and the pinned apps. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
import { homeView } from './home.js';
import { CHATS } from '../apps/chrome.js';
export function focusPart({ aadVars, api, badgeText, chrome, closeMenu, closeWs, desks, doc, frameReady, goApp, host, lit, panelWindow, setSearch, unpeek, vtAll }) {
  let openAppMenu; // late-bound: desktop.js declares these after the call, see bindLate
  function wantAppFocus(id) { aadVars.focusWant = id; aadVars.focusing = false; aadVars.focusHosted = null; aadVars.focusGeneration++; }
  const paneFrame = () => host?.frame(panelWindow()?.id) || null;
  function focusFrame(tries = 0, generation = aadVars.focusGeneration) {
    if (generation !== aadVars.focusGeneration) return; // an old timer cannot consume a newer request
    if (!aadVars.focusWant) { aadVars.focusing = false; return; }
    const f = aadVars.pane && aadVars.pane.id === aadVars.focusWant ? paneFrame() : null;
    if (!f || !frameReady()) { if (tries < 60) api.after(150, () => focusFrame(tries + 1, generation)); else { aadVars.focusWant = ''; aadVars.focusing = false; } return; }
    // One host lifecycle focus per request, not once per iframe-focus retry.
    // Some documents refuse browser focus; that must never re-enter routing.
    const id = panelWindow()?.id;
    if (id && aadVars.focusHosted !== id) { aadVars.focusHosted = id; host?.focus(id, { scroll: false }); }
    if (generation !== aadVars.focusGeneration) return;
    try { f.focus?.({ preventScroll: true }); f.contentWindow?.focus?.(); } catch (_) {}
    // (the shell can still focus the window itself right after the desk switch: once more, then it is the app's)
    if (tries < 60 && doc.activeElement !== f) { api.after(150, () => focusFrame(tries + 1, generation)); return; }
    aadVars.focusWant = ''; aadVars.focusing = false;
  }

  /* ---------- round 15: All apps (round 16: the right column's last row, ⌥T) ----------
   * A sheet over the main area: every app as a big icon with its name (the open ones, then every installed app, then
   * Get more; paged, home.js), on a soft veil over the skin's background; a pick opens it as the panel; a right click
   * gives Pin / Unpin, Open, Add to Home Screen, its App Store page; Esc or a click on the veil closes it. */
  const canPin = id => !!api.apps.homeScreen?.can?.(id);
  const oneEach = () => { const seen = new Set(); return desks().filter(d => d.id !== CHATS && !seen.has(d.id) && seen.add(d.id)); };
  // (round 16 item 7: no All apps grid any more; Home's model still gives the ⌥ letters, never shown)
  const home = homeView(api, { goApp: (id, desk) => goApp(id, desk), getMore: () => api.apps.openDesk('app-store'), lit, badgeText, desks: oneEach, paged: true, menu: (a, at) => openAppMenu(a, at) });
  /* the picker (round 16 item 7; the shared sheet, chrome.js): installed apps neither open nor pinned, For people open,
   * For agents folded, + Get more last (the App Store as it is); ⌥T or the column's + */
  const allOpenNow = () => !!chrome.isOpen;
  function openAll() { if (chrome.isOpen) return; unpeek(); closeMenu(); closeWs(); if (aadVars.q) setSearch(false); chrome.open({ includeOpen: true, people: 'For people' }); }
  function closeAll() { chrome.close(); }
  api.listen(vtAll, 'click', openAll);

  /* ---------- round 15: the pinned apps (round 16: the right column's top) ---------- */
  // Launcher links (e.g. Video Editor) live in kinds.dev, not the quick-app list.
  // Validate pins against the installed catalog, never just that quick projection.
  const pinApps = () => { const K = api.apps.kinds?.() || {}; return [...api.apps.list(), ...(K.apps || []), ...(K.dev || [])]; };
  const installedIds = () => pinApps().filter(a => a && a.id && a.id !== CHATS).map(a => a.id);
  return { allOpenNow, canPin, closeAll, focusFrame, home, installedIds, openAll, paneFrame, pinApps, wantAppFocus, bindLate: v => { if ('openAppMenu' in v) openAppMenu = v.openAppMenu; } };
}
