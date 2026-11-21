/* Wizard UX phone shell › swipes and holds on the orb, and the Orb switcher. Moved out of app.js
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
window.WizCore.appParts.orbswipe = function ({ $, APP, APPS, appVars, atPickerEnd, barScrubDrop, barScrubJoin, cancelVoice, CHATS, clip, closeMenu, closeOverview, closeSheets, deskName, deskSigil, device, dropWarm, execute, FIELDS, finishVoice, generalTarget, generalVoiceSnap, goDesk, HOME, inboxEl, launcher, liftSettings, mayHoldCommand, MIC_WARM_MS, openApp, openOverview, openSheet, orbUpDesks, orbWrap, parkDesks, pauseCommandCapture, pillOvOpen, placeTrack, renderLauncher, saveVoiceRoute, secOf, setVoice, setZen, showChats, startOrbVoice, startVoice, store, swipeDesk, toast, tourEv, track, txHide, V, vib, voiceDestination, voiceRecovery, warmMic, winApp, winEl }) {
  let armBack; // late-bound: app.js declares these after the call, see bindLate
  function shock() { const s = $('.orb-shock'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go'); }
  /* A worn layout's own orb swipes (WosSkinHost.orbSwipes, e.g. the Orb and Apps views: up = Home, the rest nothing).
   * 'stock' = the dock's own swipe below; Desks declares none, so it is always 'stock' there. Tap and hold never ask. */
  function orbSwipeAct(g) {
    const s = g && g.swipes, k = !g ? '' : g.mode === 'h' ? 'side' : g.mode === 'v' ? (g.dy < 0 ? 'up' : 'down') : '';
    return !s || !k || !(k in s) ? 'stock' : s[k];
  }
  // Home from the orb: as a desk swipe it may be the iPhone's own swipe home in disguise (undoLastMove puts it back)
  function orbSwipeHome() {
    const from = appVars.desks[appVars.idx]?.id;
    if (appVars.sheet) closeSheets(true);
    if (pillOvOpen()) closeOverview();
    if (appVars.idx !== HOME) goDesk(HOME);
    if (appVars.desks[appVars.idx]?.id !== from) appVars.lastMove = { from, at: Date.now() };
  }
  /* A New chat to type in from the orb (the AI apps view, round 5: tap the orb to talk, swipe it up to type): the Chats
   * window's New chat with the cursor in its composer, focused inside the swipe's own release so the phone's keyboard
   * comes up (iOS raises it only for a focus made while handling the touch). */
  function orbSwipeNew() {
    if (appVars.sheet) closeSheets(true);
    if (pillOvOpen()) closeOverview();
    const w = showChats(); if (!w) return;
    CHATS.openChat(w.id, '__new__');
    const ta = winEl(w.id)?.querySelector('.ch-compose textarea');
    if (ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
  }
  orbWrap.addEventListener('contextmenu', e => e.preventDefault());
  orbWrap.addEventListener('pointerdown', e => {
    if (appVars.G || e.isPrimary === false) return;
    e.preventDefault(); try { orbWrap.setPointerCapture(e.pointerId); } catch (_) {} closeMenu();
    appVars.G = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), ts: e.timeStamp, mode: 'pending', dx: 0, dy: 0, aim: null };
    Orb.press(true);
    appVars.G.corner = device.classList.contains('orb-corner'); appVars.G.ovWas = pillOvOpen(); appVars.G.upDesks = orbUpDesks(); appVars.G.swipes = window.WosSkinHost?.orbSwipes?.() || null;
    if (V.state === 'idle') appVars.G.warm = setTimeout(() => { if (appVars.G && appVars.G.mode === 'pending') warmMic(); }, MIC_WARM_MS);
    // Hold = Orb switcher radial (James, 31 Oct 2026): a semicircle of wedges above the thumb. Slide onto one, release to
    // choose; the voice command lives in one wedge and needs a dwell. The corner orb (full-screen Chats) only talks:
    // there a hold stays the plain hold-command it always was.
    if (window.WosOrbSwitcher?.active() && !appVars.G.corner && !appVars.sheet && !appVars.G.ovWas) appVars.G.hold = setTimeout(() => { if (appVars.G && appVars.G.mode === 'pending') openRadial(appVars.G); }, window.WosOrbSwitcher.HOLD_OPEN_MS);
    else if (mayHoldCommand()) appVars.G.hold = setTimeout(() => { if (appVars.G && appVars.G.mode === 'pending') { appVars.G.mode = 'hold'; appVars.G.holdAt = performance.now(); if(V.state==='idle'||(V.state==='paused'&&V.replyTo)){vib(18);appVars.G.start=startVoice('command');}else{appVars.G.refused=true;toast('⏸','Pause your reply before a command');} } }, 380);
  });
  function openRadial(g) {
    if (!window.WosOrbSwitcher?.active()) return;
    g.mode = 'radial'; vib(18); closeMenu();
    const r = orbWrap.getBoundingClientRect();
    window.WosOrbSwitcher.open({ x: r.left + r.width / 2, y: r.top + r.height / 2, fromX: g.x, fromY: g.y });
  }
  /* Orb switcher host: what the radial needs from the shell, and nothing else. App placement stays the shell's
   * (openApp -> placeApp), the voice command is the ordinary startVoice('command') / finishVoice(). */
  const appGlyph = a => window.WizCore.workspaceNav.icon({ wins: ['_'], focus: '_' }, { _: {} }, () => a);
  const orbSwitcherHost = {
    apps: () => [{ id: 'home', name: 'Home', html: deskSigil(HOME) }].concat(APPS.filter(a => a.kind !== 'native' && a.kind !== 'view' && !window.WizCore.isMaintenanceApp(a))
      .map(a => ({ id: a.id, name: a.name, html: appGlyph(a) }))),
    // Exactly one entry per desktop, in strip order (including empty desktops). All app ids
    // on a split desktop suppress duplicate outer pins, not just its focused window's id.
    openItems: () => appVars.desks.map((d, i) => {
      const fw = appVars.W[d.focus] || appVars.W[d.wins[0]];
      return { id: d.home ? 'home' : fw ? winApp(fw).id || 'desk:' + d.id : 'desk:' + d.id,
        name: d.home ? 'Home' : deskName(i), html: deskSigil(i), desk: i, cur: i === appVars.idx,
        appIds: d.home ? ['home'] : d.wins.map(w => winApp(appVars.W[w]).id).filter(Boolean) };
    }),
    // The hovered desk slides in behind the radial so James sees where he will land. Parked desks (two+ away) render
    // nothing, so the hovered one is woken first; release re-parks via goDesk / parkDesks.
    hover: desk => { const w = track.getBoundingClientRect().width || innerWidth; if (desk != null && desk !== appVars.idx) secOf(desk)?.classList.remove('parked'); placeTrack(desk == null ? 0 : (appVars.idx - desk) * w, false); },
    vib, armBack: () => armBack(), cancelGesture: () => endGesture(null, true),
    voice: {
      enabled: () => (V.state === 'idle' || (V.state === 'paused' && !!V.replyTo)) && mayHoldCommand(),
      start: () => startVoice('command'),
      active: () => V.kind === 'command' && V.state === 'command',
      finish: () => finishVoice(),
      cancel: () => cancelVoice(true),
      pause: () => { V.stopAsked = true; pauseCommandCapture(); }, // capture lost: keep the take paused with controls, never discard
    },
  };
  // Core dock behaviour: no skin recipe or old tweak switch can disable it.
  window.WosCreateOrbSwitcher(orbSwitcherHost);

  // Slide-to-aim is retired (James, 11 Oct 2026): a held command already opens on the desk beside this one, so
  // sliding while holding does nothing (no desk label, no aim). A hold that starts travelling at once is a swipe.
  const aimFor = () => null;
  orbWrap.addEventListener('pointermove', e => {
    if (!appVars.G || e.pointerId !== appVars.G.pointerId) return; appVars.G.dx = e.clientX - appVars.G.x; appVars.G.dy = e.clientY - appVars.G.y;
    if (appVars.G.mode === 'radial') { window.WosOrbSwitcher.move(e.clientX, e.clientY); return; }
    if (appVars.G.mode === 'scrub') return; // the bar scrub has this finger (barScrubJoin); the dock's handlers run it
    // A hold that starts travelling right after it fired was really a swipe (slow frame ate the moves).
    if (appVars.G.mode === 'hold' && appVars.G.holdAt && performance.now() - appVars.G.holdAt < 600 && (Math.hypot(appVars.G.dx, appVars.G.dy) > 34 || (appVars.G.dy > 16 && appVars.G.dy > Math.abs(appVars.G.dx) * 1.4)) && !(appVars.G.dy < -20 && Math.abs(appVars.G.dx) < 100)) {
      cancelVoice(true); appVars.G.mode = 'pending';
    }
    if (appVars.G.mode === 'hold') {
      const box = generalTarget.getBoundingClientRect();
      // The compact target touches the orb: require deliberate upward travel,
      // so ordinary hold/release (including finger jitter) remains a command.
      appVars.G.general = appVars.G.dy < -16 && e.clientX >= box.left - 16 && e.clientX <= box.right + 16 && e.clientY >= box.top - 16 && e.clientY <= box.bottom + 16;
      generalTarget.classList.toggle('selected', appVars.G.general);
      voiceDestination.textContent = appVars.G.general ? 'Release: keep talking to ' + window.WizConfig.agent() : 'Release: command · slide onto ' + window.WizConfig.agent();
      // Aim: slide toward the desk this command should land on.
      appVars.G.aim = appVars.G.corner ? null : aimFor(appVars.G.dx);
      orbWrap.dataset.dir = appVars.G.aim == null ? '' : (appVars.G.aim < appVars.idx ? `← Desk ${appVars.G.aim + 1}` : `Desk ${appVars.G.aim + 1} →`);
      device.classList.toggle('aiming', appVars.G.aim != null);
      $('#txRouteText').textContent = appVars.G.aim == null ? 'Command · release to run' : `Command · opens on desk ${appVars.G.aim + 1}`;
      return;
    }
    // Swipes work in every voice state: recording or sending never locks navigation.
    if (appVars.G.mode === 'pending' && Math.hypot(appVars.G.dx, appVars.G.dy) > 14 && appVars.G.corner && !appVars.G.swipes) { clearTimeout(appVars.G.hold); appVars.G.mode = 'still'; }
    if (appVars.G.mode === 'still') return; // the corner orb only talks: a slid finger cancels, it never swipes the shell
    // A downward slide commits sooner (10 px): the orb sits near the bottom of the glass, so there is little room below it.
    if (appVars.G.mode === 'pending' && (Math.hypot(appVars.G.dx, appVars.G.dy) > 14 || (appVars.G.dy > 10 && appVars.G.dy > Math.abs(appVars.G.dx) * 1.4))) {
      clearTimeout(appVars.G.hold); appVars.G.mode = Math.abs(appVars.G.dx) > Math.abs(appVars.G.dy) ? 'h' : 'v'; orbWrap.classList.add('dragging');
      // wizard-ux#1536: the orb on the bar is part of the scrub surface, so its sideways swipe is the bar scrub.
      if (appVars.G.mode === 'h' && !appVars.G.corner && !appVars.G.ovWas && !(appVars.G.swipes && orbSwipeAct(appVars.G) !== 'stock') && orbWrap.closest('#dock') && barScrubJoin(e, appVars.G)) { appVars.G.mode = 'scrub'; orbWrap.classList.remove('dragging'); return; }
    }
    // A layout's own swipe (Orb / Apps): nothing follows the finger; only the hint for Home.
    if (appVars.G.swipes && orbSwipeAct(appVars.G) !== 'stock') { orbWrap.dataset.dir = appVars.G.dy < -40 ? ({ home: '↑ Home', new: '↑ New chat' }[orbSwipeAct(appVars.G)] || '') : ''; return; }
    if (appVars.G.mode === 'h' && appVars.sheet === 'settings') liftSettings(); // swipe away from Settings: it stays on its desk
    if (appVars.G.mode === 'h' && !appVars.sheet) {
      let dx = appVars.G.dx; if ((appVars.idx === 0 && dx > 0) || (atPickerEnd() && dx < 0)) dx *= .28;
      placeTrack(dx * 1.1, false);
      orbWrap.dataset.dir = Math.abs(appVars.G.dx) > 50 ? (appVars.G.dx < 0 ? (appVars.idx < appVars.desks.length - 1 ? `${clip(deskName(appVars.idx + 1), 16)} →` : atPickerEnd() ? '' : 'New desk →') : (appVars.idx > 0 ? `← ${clip(deskName(appVars.idx - 1), 16)}` : '')) : '';
    } else if (appVars.G.mode === 'v') {
      if (appVars.G.upDesks && !appVars.sheet) {
        // Our skins: up grows the pill into the desks panel (once, mid-swipe); down while it is open closes it.
        if (appVars.G.dy < -40 && !pillOvOpen() && !appVars.G.ovWas) { appVars.G.ovOpened = true; openOverview('pill'); }
        orbWrap.dataset.dir = '';
        return;
      }
      if (!appVars.sheet && appVars.G.dy < 0) {
        const p = Math.min(1, Math.abs(appVars.G.dy) / 240);
        launcher.classList.add('dragging');
        if (!launcher._rendered) { renderLauncher(''); launcher._rendered = true; }
        launcher.style.transform = `translateY(calc(${(1 - p) * 100}% + ${(1 - p) * 160}px))`;
        launcher.style.opacity = String(Math.min(1, p * 1.6));
      } else if (!appVars.sheet) { launcher.style.transform = ''; launcher.style.opacity = ''; }
      // Down: the bar follows the finger a little, then hides (distraction-free). Little room below the orb, so short.
      if (!appVars.sheet && V.state === 'idle') $('#dock').style.transform = appVars.G.dy > 0 ? `translateY(${Math.min(appVars.G.dy, 40) * .5}px)` : '';
      orbWrap.dataset.dir = appVars.sheet ? (Math.abs(appVars.G.dy) > 40 ? 'Close' : '') : appVars.G.dy < -40 ? '↑ Apps' : appVars.G.dy > 12 && V.state === 'idle' ? '↓ Hide' : '';
    }
  });
  // The orb's tap on a running take (the dock orb, or a layout's agent orb).
  // James 20 Oct: a tap on a paused take resumes it and never sends. Send is the next tap, once it records again.
  // Only a take that cannot resume (mic held by another recording, or the last resume found the mic busy) still sends.
  function orbTapBusy() {
    if (V.admitting) { V.admitSend = true; return; }
    if (V.state === 'paused') {
      // Dictation keeps its own contract: a tap on a paused dictation transcribes into the sealed field (nothing is sent).
      if (V.kind === 'dictation' || V.resumeBlocked || (window.WizAppCapture?.getState?.().recording && !V.meetingLoan)) { shock(); return finishVoice(); }
      return $('#arcPause').click();
    }
    if (V.state === 'listen') { shock(); return finishVoice(); }
    // sending: a tap on the orb does nothing until the take is handed off
  }
  function endGesture(e, cancelled) {
    if (!appVars.G || (e?.pointerId != null && e.pointerId !== appVars.G.pointerId)) return; const g = appVars.G; appVars.G = null;
    // a take this press starts has taken the warm mic by then (openRec claims it before its first await)
    clearTimeout(g.hold); clearTimeout(g.warm); queueMicrotask(dropWarm); Orb.press(false); orbWrap.classList.remove('dragging'); orbWrap.dataset.dir = ''; device.classList.remove('aiming'); generalTarget.classList.remove('selected');
    const vt = (performance.now() - g.t) || 1;
    if (g.mode === 'scrub') { if (cancelled) barScrubDrop(); return; } // the dock's pointerup lands the scrub
    // Our skins, desks panel open: the orb is its handle. Any tap or swipe on it closes the panel (nothing else fires).
    if (g.ovWas && pillOvOpen()) { if (!cancelled && g.mode !== 'hold') { closeOverview(); return; } }
    if (g.ovOpened) { if (cancelled) closeOverview(); return; }
    // A layout's own swipe (Orb / Apps): up far or fast enough = Home; a swipe it set to null does nothing.
    const own = orbSwipeAct(g);
    if (own !== 'stock') { if ((own === 'home' || own === 'new') && !cancelled && (g.dy < -70 || g.dy / vt < -.55)) { if (own === 'new') orbSwipeNew(); else orbSwipeHome(); } return; }
    if (g.upDesks && g.mode === 'v' && !appVars.sheet) { if (g.dy < -70 || g.dy / vt < -.55) openOverview('pill'); else if (!cancelled && V.state === 'idle' && (g.dy > 18 || (g.dy > 8 && g.dy / vt > .3))) setZen(true); return; }
    if (g.mode === 'pending' && !cancelled) {
      if (appVars.sheet) return closeSheets();
      if(V.admitting){V.admitSend=true;return;}
      if(V.state==='paused'&&V.replyTo&&FIELDS.refresh())return startVoice('dictation');
      if (V.state === 'idle') return window.WosSkinHost?.orbTap?.() ? undefined : startOrbVoice();
      return orbTapBusy();
    } else if (g.mode === 'radial') {
      const out = window.WosOrbSwitcher?.release(cancelled) || { kind: 'none' };
      placeTrack(0, true); parkDesks(false);
      if (out.kind === 'open' && out.id === 'home') execute({ action: 'desk', to: 'home' });
      else if (out.kind === 'open') { const a = APP[out.id]; if (a) openApp(a); } // every pin uses shared placement, including already-open apps
      else if (out.kind === 'customize') window.WosOrbSwitcher.openSettings();
    } else if (g.mode === 'hold') {

      if(g.refused)return; // a refused hold always consumes its release; never sends a reply
      if(g.start){g.start.then(()=>{if(V.kind!=='command')return;if(cancelled)pauseCommandCapture();else finishVoice();});return;}
      // Capture loss is not explicit Cancel. Keep the take paused with controls, never discard it.
      if (cancelled) { V.stopAsked = true; pauseCommandCapture(); return; }
      if (g.general) {
        // Synchronous latch before finishVoice: same recorder, no send on this release.
        V.kind = 'general'; V.snap = generalVoiceSnap(); V.target = null; V.replyTo = null;
        V.stopAsked = false; V.sendAsked = false;
        if (V.native) {
          try { voiceRecovery(V.native, { kind: 'general', general: true, conversation: null }); saveVoiceRoute(V.native, V.snap.route); }
          catch (_) { V.stopAsked = true; pauseCommandCapture(); toast('!', 'General destination could not be saved · recording kept'); return; }
        }
        setVoice('listen'); txHide(0); return;
      }
      V.target = g.aim;
      return finishVoice();
    } else if (g.mode === 'h') {
      if (appVars.sheet) return;  // launcher etc.; Settings was lifted onto its desk when the drag began
      if (cancelled || g.dy < -40) return placeTrack(0, true); // went up: the iPhone's swipe out, never a desk swipe
      const v = g.dx / vt;
      if (g.dx < -60 || v < -.5) { swipeDesk(1); tourEv('desk', { home: appVars.idx === HOME }); } else if (g.dx > 60 || v > .5) { swipeDesk(-1); tourEv('desk', { home: appVars.idx === HOME }); } else placeTrack(0, true);
    } else if (g.mode === 'v') {
      [launcher, inboxEl].forEach(el => el.classList.remove('dragging'));
      launcher._rendered = inboxEl._rendered = false; $('#dock').style.transform = '';
      if (appVars.sheet) { if ((appVars.sheet === 'launcher' && g.dy > 40) || (appVars.sheet === 'inbox' && g.dy < -40) || (appVars.sheet === 'settings' && Math.abs(g.dy) > 40)) closeSheets(); else if (g.dy < -40) openSheet('launcher'); return; }
      const v = g.dy / vt;
      if (g.dy < -70 || v < -.55) openSheet('launcher');
      else if (!cancelled && V.state === 'idle' && (g.dy > 18 || (g.dy > 8 && v > .3))) setZen(true);
      else { launcher.style.transform = ''; launcher.style.opacity = ''; }
    } else if (g.mode === 'still') {
      // The full-screen Chats corner orb only talks, but a clear downward slide hides it too.
      if (!cancelled && V.state === 'idle' && g.dy > 18 && g.dy > Math.abs(g.dx)) setZen(true);
    }
  }
  orbWrap.addEventListener('pointerup', e => endGesture(e, false));
  orbWrap.addEventListener('pointercancel', e => endGesture(e, true));
  orbWrap.addEventListener('lostpointercapture', e => endGesture(e, true));
  // Capture may move with the dock/immersive DOM. Id matching makes duplicate and unrelated releases inert.
  window.addEventListener('pointerup', e => endGesture(e, !orbWrap.hasPointerCapture(e.pointerId)), true);
  window.addEventListener('pointercancel', e => endGesture(e, true), true);
  window.addEventListener('blur', () => endGesture(null, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endGesture(null, true); });
  orbWrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (V.state === 'idle') { if (!window.WosSkinHost?.orbTap?.()) startOrbVoice(); } else finishVoice(); } });
  orbWrap.tabIndex = 0;

  /* Distraction-free, forgiving start (James, 18 Oct 2026): the swipe down may begin a little above the orb. Passive
   * touch watch over the strip above the orb: taps and scrolls there behave exactly as before; only a clear, mostly
   * vertical drag down of ~26 px hides the bars. Touch events (not pointer) so a list that starts scrolling under
   * the finger does not cancel the watch. */
  let ZA = null;
  document.addEventListener('touchstart', e => {
    ZA = null;
    if (appVars.zen || appVars.sheet || appVars.G || e.touches.length !== 1 || V.state !== 'idle') return;
    if (device.classList.contains('immersive') && !device.classList.contains('orb-corner')) return;
    if (e.target.closest && e.target.closest('#orbWrap, #zenEdge, #immEdge')) return;
    const t = e.touches[0], r = orbWrap.getBoundingClientRect(); if (!r.width) return;
    if (t.clientX < r.left - 48 || t.clientX > r.right + 48 || t.clientY < r.top - 72 || t.clientY > r.top + 6) return;
    ZA = { x: t.clientX, y: t.clientY };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => {
    if (!ZA || e.touches.length !== 1) { ZA = null; return; }
    const t = e.touches[0], dx = t.clientX - ZA.x, dy = t.clientY - ZA.y;
    if (dy < -12 || Math.abs(dx) > 44) { ZA = null; return; }
    if (dy > 26 && dy > Math.abs(dx) * 1.4) { ZA = null; setZen(true); }
  }, { capture: true, passive: true });
  ['touchend', 'touchcancel'].forEach(t => document.addEventListener(t, () => { ZA = null; }, { capture: true, passive: true }));

  /* Bottom edge while distraction-free: swipe up anywhere along it to bring the bars back. A real >=24 px target so
   * touch adjustment never hands the swipe to a composer above it (see immEdge). */
  const zenEdge = document.createElement('div'); zenEdge.id = 'zenEdge'; zenEdge.className = 'zen-edge';
  zenEdge.innerHTML = '<i></i>'; zenEdge.setAttribute('aria-label', 'Swipe up to show the orb'); device.appendChild(zenEdge);
  zenEdge.addEventListener('click', e => e.preventDefault());
  zenEdge.addEventListener('touchmove', e => { if (ZE && e.cancelable) e.preventDefault(); }, { passive: false });
  let ZE = null;
  zenEdge.addEventListener('pointerdown', e => {
    if (!appVars.zen) return; e.preventDefault(); try { zenEdge.setPointerCapture(e.pointerId); } catch (_) {}
    ZE = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  zenEdge.addEventListener('pointermove', e => {
    if (!ZE || e.pointerId !== ZE.id) return; ZE.dy = Math.min(0, e.clientY - ZE.y);
    zenEdge.classList.toggle('pull', -ZE.dy > 10);
    if (-ZE.dy > 22 && appVars.zen) { ZE = null; zenEdge.classList.remove('pull'); setZen(false); } // reveal as soon as the intent is clear
  });
  const zenEnd = e => {
    if (!ZE || e.pointerId !== ZE.id) return; const s = ZE; ZE = null; zenEdge.classList.remove('pull');
    const v = s.dy / ((performance.now() - s.t) || 1);
    if (e.type !== 'pointercancel' && s.dy < -8 && v < -.3) setZen(false);
  };
  zenEdge.addEventListener('pointerup', zenEnd); zenEdge.addEventListener('pointercancel', zenEnd);
  // Every load starts with the orb and bars showing (James, 18 Oct); distraction-free is a per-session choice.
  store.set('zen', false);
  return { orbTapBusy, shock, bindLate: v => { if ('armBack' in v) armBack = v.armBack; } };
};
