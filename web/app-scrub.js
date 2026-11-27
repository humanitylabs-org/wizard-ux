/* Wizard UX phone shell › scrubbing along the bottom bar to step between desks. Moved out of app.js
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
window.WizCore.appParts.scrub = function ({ $, appVars, BAR_FLICK_MIN, BAR_FLICK_MS, BAR_FLICK_STEPS, CHATS, endDotHold, goDesk, HOME, parkDesks, placeTrack, renderDots, secOf, swipeDesk, tourEv, track, vib }) {
  let liftSettings, SC_STEP, scLabel, scrub, sectionsStops; // late-bound: app.js declares these after the call, see bindLate
  /* Where a scrub of `steps` desks from desk `start` lands. With phone sections (wizard-ux#1929) it steps through the
   * section desks only (sectionsStops: their indexes in bar order), counted from the section the start desk is in. */
  const scrubTo = (start, steps) => {
    const stops = typeof sectionsStops === 'function' ? sectionsStops() : null;
    if (!stops || !stops.length) return Math.max(0, Math.min(appVars.desks.length - 1, start - steps));
    let k = stops.length - 1; while (k > 0 && stops[k] > start) k--;
    return stops[Math.max(0, Math.min(stops.length - 1, k - steps))];
  };
  const barScrubBack = s => { if (s.live) { appVars.idx = s.start; placeTrack(0, true); renderDots(); parkDesks(false); } s.live = false; barScrubPeek(false); scrub.classList.remove('on'); };
  // The hovered desk and its neighbours render while the scrub points at it (parked desks skip rendering); the track
  // slides quicker so the desk follows each step. Desks the scrub has left behind (3+ away; 2 away may still be sliding
  // out) are parked again at once, and settling (goDesk / barScrubBack) parks the rest.
  const barScrubPeek = n => {
    track.classList.toggle('bar-scrubbing', n !== false);
    if (n !== false) appVars.desks.forEach((_, i) => { const d = Math.abs(i - n); if (d <= 1) secOf(i)?.classList.remove('parked'); else if (d > 2) secOf(i)?.classList.add('parked'); });
  };
  // Where the scrub points: counted from x0, set when the scrub went live (12 px before that point, the slop).
  const barScrubAt = (s, x) => scrubTo(s.start, Math.round((x - s.x0) / SC_STEP));
  const barScrubLive = (s, e) => { s.live = true; s.x0 = e.clientX - Math.sign(e.clientX - s.x) * 12; barScrubPeek(s.at); placeTrack(0, true); scrub.classList.add('on'); scLabel(s.at); vib(10); };
  // The orb's sideways drag hands its finger to the bar scrub (the orb keeps tap, hold and up/down). Its moves and
  // release bubble from #orbWrap to #dock, so the dock's own handlers below run the scrub from here on.
  const barScrubJoin = (e, g) => {
    if ((appVars.sheet && appVars.sheet !== 'settings') || appVars.DS) return false;
    appVars.DS = { x: g.x, y: g.y, t: g.t, id: e.pointerId, h: true, ts: g.ts ?? e.timeStamp, start: appVars.idx, at: appVars.idx, live: false, up: false };
    endDotHold(); if (appVars.sheet === 'settings') liftSettings();
    barScrubLive(appVars.DS, e); return true;
  };
  const barScrubDrop = () => { if (appVars.DS) barScrubBack(appVars.DS); appVars.DS = null; };
  $('#dock').addEventListener('pointerdown', e => {
    if (e.target.closest('#orbWrap') || (appVars.sheet && appVars.sheet !== 'settings')) return; // Settings never blocks a desk swipe
    if (e.pointerType === 'touch' && e.clientY > innerHeight - 22) return; // iOS home-indicator strip: the system's swipe
    appVars.DS = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, h: false, ts: e.timeStamp, start: appVars.idx, at: appVars.idx, live: false, up: false };
  });
  $('#dock').addEventListener('pointermove', e => {
    if (!appVars.DS || e.pointerId !== appVars.DS.id) return;
    const dx = e.clientX - appVars.DS.x, dy = e.clientY - appVars.DS.y;
    if (!appVars.DS.h && window.WosSkinHost?.claimed(e.pointerId)) { appVars.DS = null; return; } // a skin gesture owns this finger
    if (!appVars.DS.h) { if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return; appVars.DS.h = true; endDotHold(); if (appVars.sheet === 'settings') liftSettings(); try { $('#dock').setPointerCapture(e.pointerId); } catch (_) {} }
    if (appVars.DS.up) return;
    if (dy < -30) { appVars.DS.up = true; barScrubBack(appVars.DS); placeTrack(0, true); return; } // going up: the iPhone's swipe out
    if (!appVars.DS.live) barScrubLive(appVars.DS, e);
    const n = barScrubAt(appVars.DS, e.clientX);
    if (n !== appVars.DS.at && !CHATS.beforeNavigate(appVars.desks[n]?.wins || [])) return;
    if (n !== appVars.DS.at) { appVars.DS.at = n; vib(6); appVars.idx = n; barScrubPeek(n); placeTrack(0, true); renderDots(); scLabel(n); }
  });
  const dockEnd = e => {
    if (!appVars.DS || e.pointerId !== appVars.DS.id) return; const s = appVars.DS; appVars.DS = null;
    if (!s.h) return;
    const dx = e.clientX - s.x, quick = e.timeStamp - s.ts < BAR_FLICK_MS;
    appVars.dockSwiped = Date.now();
    // A cancelled touch or one that rose is the system's swipe out: the desk goes back to where it started.
    if (s.up || e.type === 'pointercancel' || e.clientY - s.y < -30) { barScrubBack(s); return; }
    // A short quick flick moves exactly one desk, the way the finger travelled in total (wizard-ux#1601: decided at
    // release from the whole travel and time, not from steps crossed, so a flick that arrives as one or two merged
    // moves is one desk too). A quick swipe that travelled further lands by distance, below.
    if (quick && Math.abs(dx) < BAR_FLICK_STEPS * SC_STEP) {
      // Under BAR_FLICK_MIN px (finger drift on a dock control, Codex P2 on PR 1603) is no swipe: the desk stays.
      const dir = Math.abs(dx) >= BAR_FLICK_MIN ? -Math.sign(dx) : 0;
      barScrubBack(s); if (dir) { swipeDesk(dir); tourEv('desk', { home: appVars.idx === HOME }); } return;
    }
    // The last move may not have come in before the release: land where the finger let go. A quick long swipe counts
    // its whole travel from touch-down, first move included (a lone far first move is not lost to the slop).
    const n = quick ? scrubTo(s.start, Math.round(dx / SC_STEP)) : barScrubAt(s, e.clientX);
    if (n !== s.at && (n === s.start || CHATS.beforeNavigate(appVars.desks[n]?.wins || []))) s.at = n;
    // The scrub moved idx as it went; land from the start desk so goDesk runs its desk-leave work (Resources, a Home
    // card's Chats chip, an empty desk going away, an open link) exactly as a tap or flick does.
    barScrubPeek(false); scrub.classList.remove('on'); appVars.idx = s.start; goDesk(s.at, true); tourEv('desk', { home: appVars.idx === HOME });
  };
  $('#dock').addEventListener('pointerup', dockEnd); $('#dock').addEventListener('pointercancel', dockEnd);
  return { barScrubDrop, barScrubJoin, bindLate: v => { if ('liftSettings' in v) liftSettings = v.liftSettings; if ('SC_STEP' in v) SC_STEP = v.SC_STEP; if ('scLabel' in v) scLabel = v.scLabel; if ('scrub' in v) scrub = v.scrub; if ('sectionsStops' in v) sectionsStops = v.sectionsStops; } };
};
