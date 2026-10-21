/* Setup app launch rules (system app `setup`, web/setup/). Both shells load this; each calls boot() once its own
 * deep link has been consumed. Self-contained so it can move to another shell base with three one-line hooks:
 *   phone   (app.js)     WosSetupLaunch.boot({...}) in place of the first-run tour timer, and .desk(home) in goDesk
 *   desktop (desktop.js) WosSetupLaunch.boot({...}) right after C.deeplink.consume()
 *
 * First run (design: Claude Fable, 14 Oct 2026, round 2 decision 1):
 *   - GET /wizard/v1/setup. When first_run is true the shell opens Setup; the app (not the shell) POSTs
 *     /wizard/v1/setup/seen when it renders, so a failed open simply tries again next launch.
 *   - Phone layout: the 30-second gesture tour waits (tourPending, this session only) and starts the first time the
 *     Home desk settles in front (Back from Setup lands there). Never stacked on Setup, at most once.
 *     If the person never returns Home, the tour runs on the next launch exactly as before.
 *   - A launch from a deep link (?session=, ?open=, ?view=…) keeps the place it was asked for: Setup doesn't
 *     auto-open (it will next plain launch) and the tour keeps its existing deep-link rule.
 *   - No answer within 2.5 s, or first_run false: the shell behaves exactly as it did without Setup.
 * The Setup page asks for the tour with postMessage {type:'wizard:setup:tour'} (phone only); only a frame showing
 * /setup/ on this origin is obeyed. */
(() => {
  'use strict';
  const API = '/wizard/v1/setup', WAIT_MS = 2500, TOUR_DELAY = 600, SETTLE = 500;
  let H = null, pending = false, booted = false, settleT = 0;
  const log = s => { window.__setupLaunchLog = (window.__setupLaunchLog || []).concat(s).slice(-40); };
  const deeplinked = () => { try { return !!(H.deeplinked ? H.deeplinked() : (window.__deeplinkLog || []).length); } catch (e) { return false; } };

  async function firstRun() {
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = setTimeout(() => ctl?.abort(), WAIT_MS);
    try {
      const r = await fetch(API, { credentials: 'same-origin', cache: 'no-store', signal: ctl?.signal });
      if (!r.ok) return null;
      const j = await r.json();
      return j && typeof j === 'object' ? j.first_run === true : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }

  function boot(h) {
    if (booted || !h) return; booted = true; H = h;
    const t0 = Date.now(), tour = !!h.firstRunTour;
    // Deep links are consumed synchronously at the end of shell boot; decide after that.
    setTimeout(async () => {
      if (deeplinked()) {
        log('deeplink');
        if (tour) setTimeout(() => H.markTour?.(), Math.max(0, TOUR_DELAY - (Date.now() - t0)));
        return;
      }
      const fr = await firstRun();
      log('first_run:' + fr);
      if (fr === true && !deeplinked() && !(window.WosTour && window.WosTour.active)) {
        if (tour) pending = true;
        H.open('setup'); log('open');
        return;
      }
      if (tour) setTimeout(() => {
        if (window.WosTour?.active || window.WosTour?.done?.()) return;
        if (!deeplinked()) H.tour?.('first-run'); else H.markTour?.();
      }, Math.max(0, TOUR_DELAY - (Date.now() - t0)));
    }, 0);
  }

  // Phone shell: called from goDesk with whether Home is now in front.
  function desk(home) {
    if (!pending || !home) return;
    clearTimeout(settleT);
    settleT = setTimeout(() => {
      if (!pending) return;
      if (window.WosTour?.active || window.WosTour?.done?.()) { pending = false; log('tour:already'); return; }
      if (!H.isHome || !H.isHome()) return; // moved on, or an overlay is open: wait for the next return Home
      pending = false; log('tour:home');
      H.tour?.('first-run');
    }, SETTLE);
  }

  addEventListener('message', e => {
    const d = e.data;
    if (e.origin !== location.origin || !d || d.type !== 'wizard:setup:tour' || !H?.tour) return;
    const f = [...document.querySelectorAll('iframe')].find(x => x.contentWindow === e.source);
    let path = ''; try { path = e.source.location.pathname; } catch (er) { return; }
    if (!f || !/\/setup\/(index\.html)?$/.test(path)) return;
    pending = false; clearTimeout(settleT); log('tour:link');
    H.tour('setup');
  });

  window.WosSetupLaunch = {
    boot, desk,
    get tourPending() { return pending; },
    get log() { return window.__setupLaunchLog || []; },
  };
})();
