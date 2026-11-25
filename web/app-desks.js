/* Wizard UX phone shell › leaving an empty desk, going to a desk, the desk dots and the orb app mark. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.desks = function ({ $, appVars, CHATS, deskName, esc, HOME, isReviewDesk, markVisibleThreadsSeen, placeTrack, save, scheduleParking, syncDesks, syncImmersive, tourEv, vib, winApp }) {
  let closeOverview, liftSettings, newDesk, openOverview, paintOrbBadge, syncBound, syncReviewChip; // late-bound: app.js declares these after the call, see bindLate
  const undoLastMove = () => {
    if (!appVars.lastMove || Date.now() - appVars.lastMove.at > 1500) return;
    const back = appVars.desks.findIndex(d => d.id === appVars.lastMove.from); appVars.lastMove = null;
    if (back >= 0 && back !== appVars.idx) { appVars.idx = back; placeTrack(0, false); renderDots(); save(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) undoLastMove(); });
  addEventListener('pagehide', undoLastMove);
  function atPickerEnd() { const d = appVars.desks[appVars.idx]; return appVars.idx === appVars.desks.length - 1 && !d.home && !d.wins.length; }
  function goDesk(n, silent, keepSettings = false) {
    n = Math.max(0, Math.min(appVars.desks.length - 1, n));
    // An empty desk (one the ＋ made, left without picking an app) goes away as soon as you leave it.
    const from = appVars.desks[appVars.idx], to = appVars.desks[n];
    if (from !== to && !CHATS.beforeNavigate(to?.wins || [])) { placeTrack(0, true); return; }
    if (from && to && from !== to && !from.home && !from.wins.length) { appVars.desks = appVars.desks.filter(d => d !== from); syncDesks(); n = appVars.desks.indexOf(to); }
    const moved = from !== to;
    if (moved && appVars.sheet === 'settings' && !keepSettings) liftSettings(from && from.id); // explicit navigation parks Settings on the desk you leave
    appVars.idx = n;
    if (moved) appVars.lastMove = null; // a tap, link or app open is a choice; swipeDesk re-marks swipes
    if (moved) window.WosResources?.back();
    // A Home card's chip is a quick look: leaving the Chats desk puts it back to all chats. Chips James picks stay.
    if (moved) for (const id in appVars.W) { const c = CHATS.CH[id]; if (appVars.W[id].app === 'chats' && c?.fromCard && !appVars.desks[n].wins.includes(id)) { c.fromCard = false; c.coach = false; CHATS.setFilter(appVars.W[id], ''); } }
    placeTrack(0, true); renderDots(); save(); scheduleParking(); syncImmersive(); syncReviewChip(); syncBound();
    window.WosScenery?.[appVars.idx === HOME ? 'poke' : 'update'](); // scenery hook: Home animates, any other desk freezes it
    window.WosSetupLaunch?.desk(appVars.idx === HOME); // a first-run tour held back for Setup starts on the first return Home
    if (moved && appVars.LINKS && appVars.LINKS.isOpen()) appVars.LINKS.close(); // a link is a peek over this desk: moving desks dismisses it
    if (moved) vib(8);
    // An empty New desk already titles itself and its search pill sits where the label would flash.
    if (!silent && (appVars.desks[appVars.idx].home || appVars.desks[appVars.idx].wins.length)) announce(`<b>${esc(deskName(appVars.idx))}</b>`);
    markVisibleThreadsSeen();
    window.WosResources?.sync();
    window.WosSkinHost?.changed();
  }
  function announce(html) {
    const L = $('#deskLabel'); L.innerHTML = html; L.classList.add('show'); document.body.classList.add('labeling');
    clearTimeout(appVars.labelT); appVars.labelT = setTimeout(() => { L.classList.remove('show'); document.body.classList.remove('labeling'); }, 1300);
  }
  // Any number of desks: up to three each side (Home always shows at the far left), a faint tick for more.
  // Desk sigils (James, 12 Oct 2026): each neighbour shows the glyph of the app it holds, bare (no tile), in
  // that app's colour; Home is a house; an empty desk is a faint ring; a desk with several windows carries a
  // small count. The current desk is the orb. Each is a thumb-sized button, so one tap jumps there.
  const deskSigil = i => window.WizCore.workspaceNav.icon(appVars.desks[i], appVars.W, winApp);
  /* The current desk's app icon, kept inside the orb (#orbApp, hidden). Skins may show it so the orb reads as sitting
   * on top of the app in view; nothing changes unless a skin unhides it. */
  let orbAppHtml = null;
  function paintOrbApp() {
    const wrap = $('#orbWrap'); if (!wrap || !appVars.desks[appVars.idx]) return;
    let el = document.getElementById('orbApp');
    if (!el) { el = document.createElement('span'); el.id = 'orbApp'; el.className = 'orb-app'; el.hidden = true; el.setAttribute('aria-hidden', 'true'); wrap.appendChild(el); }
    const h = deskSigil(appVars.idx); if (h !== orbAppHtml) { orbAppHtml = h; el.innerHTML = h; window.WizSigil.orb(el); }
  }
  function renderDots() {
    window.WosBell?.paint?.();
    if (typeof paintOrbBadge === 'function') try { paintOrbBadge(); } catch (_) {}
    paintOrbApp();
    const mk = i => `<button class="ddot sig${appVars.desks[i].wins.length ? ' filled' : ''}${appVars.desks[i].home ? ' dhome' : ''}${isReviewDesk(i) ? ' review' : ''}" data-goto="${i}" aria-label="${esc(deskName(i))}">${deskSigil(i)}</button>`;
    $('#dotsL').className = 'desk-dots left'; $('#dotsR').className = 'desk-dots right';
    const L = []; for (let i = Math.max(0, appVars.idx - 3); i < appVars.idx; i++) L.push(i);
    const R = []; for (let i = appVars.idx + 1; i <= Math.min(appVars.desks.length - 1, appVars.idx + 3); i++) R.push(i);
    const homeExtra = L.length && L[0] > 0;
    $('#dotsL').innerHTML = (homeExtra ? mk(0) + (L[0] > 1 ? '<i class="dmore"></i>' : '') : '') + L.map(mk).join('');
    $('#dotsR').innerHTML = R.map(mk).join('') + (R.length && R[R.length - 1] < appVars.desks.length - 1 ? '<i class="dmore"></i>' : '')
      + (atPickerEnd() ? '' : '<button class="ddot sig dplus" data-plus aria-label="New desk: pick an app"><span class="dsg"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span></button>');
    if (typeof phoneNavFit === 'function') phoneNavFit();
  }
  /* Dots: tap = jump to that desk. Long-press any dot = peek every desk as a
   * stack of cards (Android recents feel); tap a card to land there. */
  let dotHold = null, peekEl = null, peekJustOpened = 0;
  $('#dock').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    dotHold = setTimeout(() => { dotHold = null; peekJustOpened = Date.now(); openOverview(); appVars.ovTapBlock = Date.now() + 500; /* the click that ends the long-press must not land on the overview */ }, 420);
  });
  const endDotHold = () => { clearTimeout(dotHold); dotHold = null; };
  $('#dock').addEventListener('pointerup', endDotHold); $('#dock').addEventListener('pointercancel', endDotHold); $('#dock').addEventListener('pointerleave', endDotHold);
  $('#dock').addEventListener('click', e => {
    if (e.target.closest('[data-plus]')) { if (Date.now() - appVars.dockSwiped < 400) return; newDesk(); tourEv('desk-plus', {}); return; }
    const b = e.target.closest('[data-goto]'); if (!b) return;
    if (Date.now() - peekJustOpened < 600 || Date.now() - appVars.dockSwiped < 400) return;
    closeOverview(); goDesk(+b.dataset.goto); tourEv('desk', { home: appVars.idx === HOME });
  });
  $('#dock').addEventListener('contextmenu', e => { if (e.target.closest('[data-goto]')) e.preventDefault(); });
  /* Phone bar (wizard-ux issue 1533, switch wizard/phone-nav, read here inline): desk buttons are a fixed 44 px, so a
   * desk that doesn't fit its half of the bar hides whole, farthest from the orb first; Home and + always stay. On
   * iPhone the bar is 78 px (tweak.css reads data-phone-nav-ios). Only James's five skins: other skins draw their own
   * docks. With the switch off nothing is marked or hidden. */
  function phoneNavOn() {
    try {
      const r = document.documentElement;
      return (r.getAttribute('data-tweaks') || '').split(' ').includes('wizard/phone-nav') && r.dataset.shell !== 'desktop'
        && ['nebula', 'grove', 'tide', 'ember', 'signal'].includes(r.dataset.skin);
    } catch (_) { return false; }
  }
  function phoneNavFit() {
    const on = phoneNavOn(), r = document.documentElement;
    r.toggleAttribute('data-phone-nav-ios', on && /iPhone|iPod/.test(navigator.userAgent || ''));
    for (const side of [$('#dotsL'), $('#dotsR')]) {
      if (!side) continue;
      for (const el of side.querySelectorAll('.pn-cut')) el.classList.remove('pn-cut');
      if (!on) continue;
      const shown = () => [...side.children].filter(el => !el.classList.contains('pn-cut'));
      const gap = parseFloat(getComputedStyle(side).columnGap) || 0;
      const need = () => { const k = shown(); return k.reduce((n, el) => n + el.getBoundingClientRect().width, 0) + gap * Math.max(0, k.length - 1); };
      for (let guard = 0; guard < 12 && need() > side.clientWidth + .5; guard++) {
        const far = side.id === 'dotsL' ? shown() : shown().reverse(); // farthest from the orb first
        const cut = far.find(el => el.matches('.ddot[data-goto]:not(.dhome)'));
        if (!cut) break;
        cut.classList.add('pn-cut');
      }
    }
  }
  // Turning the switch (or skin) on or off, a rotation or a resize: the buttons change size, so fit them again.
  new MutationObserver(() => renderDots()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tweaks', 'data-skin'] });
  addEventListener('resize', () => { if (phoneNavOn()) phoneNavFit(); });
  return { announce, atPickerEnd, deskSigil, endDotHold, goDesk, renderDots, bindLate: v => { if ('closeOverview' in v) closeOverview = v.closeOverview; if ('liftSettings' in v) liftSettings = v.liftSettings; if ('newDesk' in v) newDesk = v.newDesk; if ('openOverview' in v) openOverview = v.openOverview; if ('paintOrbBadge' in v) paintOrbBadge = v.paintOrbBadge; if ('syncBound' in v) syncBound = v.syncBound; if ('syncReviewChip' in v) syncReviewChip = v.syncReviewChip; } };
};
