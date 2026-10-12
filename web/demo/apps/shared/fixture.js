/* Sample-app harness shared by the four preview fixtures (Wisdom, Music, Signal, Topics).
 * Back contract (web/app.js hostedBack): the shell calls window.__wizardCloseOverlay(). It answers true only when
 * the app took a nested step (closed an overlay, left a nested view); at the app's root it answers false and the
 * shell takes the step itself. Every step this app takes also changes what the shell's frameSig() reads (an <h1>,
 * a [role=dialog] count, an aria-label starting "Back", or an .open count), so the legacy signature check agrees.
 * Hosted: no history entries at boot, no CloseWatcher here (the shell arms its own in every framed app).
 * Standalone tab: a root sentinel + CloseWatcher; the first Back at root only warns, a second within 2 s may leave.
 * Comparison: the theme client sets html[data-comparison]; a standalone tab may ask with ?comparison=original. */
(() => {
  'use strict';
  const root = document.documentElement;
  const hosted = (() => { try { return window.top !== window; } catch (e) { return true; } })();
  const params = new URLSearchParams(location.search);
  const wantCompare = params.get('comparison');
  function standaloneComparison() {
    if (hosted || (wantCompare !== 'original' && wantCompare !== 'unified')) return;
    root.dataset.comparison = wantCompare;
  }
  standaloneComparison();
  // The theme client re-applies its own default on each appearance; a standalone tab keeps the asked-for mode.
  addEventListener('wizard:theme', standaloneComparison);

  let app = null, warnAt = 0, watcher = null;
  function step() {
    let did = false;
    try { did = !!(app && app.back()); } catch (e) { did = false; }
    if (did) { warnAt = 0; return true; }
    if (hosted) return false;
    const now = Date.now();
    if (now - warnAt < 2000) { warnAt = 0; return false; }
    warnAt = now; app?.toast?.('Press back again to exit');
    return true;
  }
  function armWatcher() {
    if (hosted || watcher || !('CloseWatcher' in window)) return;
    try { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; step(); }; } catch (e) { watcher = null; }
  }

  window.WzFixture = {
    hosted,
    /* a = { back(): boolean, toast(text) } */
    init(a) {
      app = a;
      window.__wizardCloseOverlay = () => { try { return !!app.back(); } catch (e) { return false; } };
      window.__wizardBack = window.__wizardCloseOverlay;
      if (hosted) return;
      history.replaceState({ wzRoot: 1 }, '', location.href);
      history.pushState({ wzGuard: 1 }, '', location.href);
      addEventListener('popstate', () => {
        if (step()) history.pushState({ wzGuard: 1 }, '', location.href);
        else history.back();
      });
      document.addEventListener('pointerdown', armWatcher, true);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !('CloseWatcher' in window)) step(); });
    },
  };
})();
