/* Wizard UX phone shell › opening an app: the one placement rule (a new tab), the instant answer to an app tap
 * (spinning icon, opening pill) and taking an open window to one of its own pages. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.opening = function ({ closeSheets, openApp, save, store, vib, winApp, winEl }) {
  /* THE placement rule for every app (James, 12 Oct 2026: apps always open in a new tab, as system behaviour,
   * never per app). An app opener only says what to show (obj) and how to spot its open copy (mine); it never
   * picks a desk. Not open yet: its own desk right beside the one in front (openWin). Already open: that window,
   * brought beside the desk in front on a desk of its own (refresh lets the app take the new query/date).
   * Chats is the hub and stays where it is; an explicit user placement (opts.desk) always gets a fresh window. */
  /* Every app tap answers at once (James, 26 Oct 2026: "tapping an app like notes I get no UX response for a few
   * seconds and tap it twice"). The tile shows it is opening; if the window is not on screen within a beat, an
   * "Opening Notes…" notice with a spinner stays up until it is; a second tap on the same app while it opens is
   * the same open, never a second one. The window itself shows a loading veil until the app's page has loaded. */
  const OPENING = { id: null, el: null, t: 0, pill: 0, safety: 0, sheet: false };
  function openingStart(a, el) {
    openingEnd(); OPENING.id = a.id; OPENING.el = el || null; OPENING.t = Date.now();
    // The feedback sits on the icon the finger is on (James, 26 Oct 2026): it sinks, dims and spins in place.
    if (el) { el.classList.add('opening'); el.setAttribute('aria-busy', 'true'); el.setAttribute('aria-label', `Opening ${a.name || 'app'}`);
      const ic = el.querySelector('.ic'); if (ic && !ic.querySelector('.open-spin')) ic.insertAdjacentHTML('beforeend', '<i class="open-spin" aria-hidden="true"></i>'); }
    vib(6);
    OPENING.safety = setTimeout(() => openingEnd(a.id), 10000);
  }
  function openingEnd(id) {
    if (!OPENING.id || (id && id !== OPENING.id)) return;
    clearTimeout(OPENING.pill); clearTimeout(OPENING.safety);
    const el = OPENING.el; if (el) { el.classList.remove('opening'); el.removeAttribute('aria-busy'); el.removeAttribute('aria-label'); el.querySelectorAll('.open-spin').forEach(x => x.remove()); }
    const sh = OPENING.sheet; OPENING.id = null; OPENING.el = null; OPENING.sheet = false;
    if (sh) closeSheets();
  }
  // The Apps sheet stays up, its tapped icon spinning, until the app's window is about to show (or its setup sheet).
  function openingReady() { if (OPENING.sheet) { OPENING.sheet = false; closeSheets(); } }
  const isOpening = id => OPENING.id === id && Date.now() - OPENING.t < 10000;
  // A tile tap (Apps sheet or New desk). fromSheet: the sheet closes first, then the app opens.
  function tapOpen(a, el, fromSheet) {
    if (!a) return;
    if (isOpening(a.id)) { vib(4); return; }
    const r = store.get('recent', []).filter(x => x !== a.id); r.unshift(a.id); store.set('recent', r.slice(0, 8));
    window.WizCore.appsPanelOpened?.(a.id); // back on Recent if it was taken off (switch wizard/apps-panel, app-appspanel.js)
    openingStart(a, el);
    OPENING.sheet = !!fromSheet;
    // One frame so the pressed, spinning icon paints before any work starts.
    requestAnimationFrame(() => { if (OPENING.id !== a.id) return; openApp(a); if (!window.WosAppSetup?.gate || a.kind !== 'wizard' || !a.url) openingEnd(a.id); });
  }
  // An app's open window taken to one of its own pages (replace: a page change never adds a Back step of its own).
  function framePage(w, rel) {
    w.url = rel; save(); const f = winEl(w.id)?.querySelector('iframe'); if (!f) return true;
    let now = ''; try { const l = f.contentWindow.location; now = l.pathname + l.search + l.hash; } catch (_) {}
    if (now !== rel) { const url = window.WosOwnViews?.frameUrl(winApp(w), rel) || rel; try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.replace(url); } catch (_) { f.src = url; } }
    return true;
  }
  return { framePage, openingEnd, openingReady, tapOpen };
};
