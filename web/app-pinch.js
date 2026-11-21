/* Wizard UX phone shell › pinching a window to fill the screen and the bottom edge in full screen. Moved out of app.js
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
window.WizCore.appParts.pinch = function ({ $, appVars, deskOf, device, menuEl, openOverview, setFull, track, winEl }) {
  function closeMenu() { appVars.menuFor = null; menuEl?.classList.remove('open'); }

  /* Pinch a window: spread to fill the screen, pinch in to tile it again. */
  function bindWinPinch(root, fixedId) {
    if (root._wpinch) return; root._wpinch = true;
    let p = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    root.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) return;
      const t0 = e.touches[0].target, el = t0.closest ? t0 : t0.parentElement;
      const id = fixedId || el.closest('.win')?.dataset.win;
      if (!id) { if (el.closest('.desk')) p = { id: null, d0: dist(e.touches[0], e.touches[1]), s: 1 }; return; }
      // A framed app that zooms its own content (maps, photos, PDFs) opts out of the shell's pinch with
      // <meta name="wizard-os-pinch" content="app">; Back and the bottom-edge swipe still leave full screen.
      if (fixedId && pinchClaimed(fixedId)) return;
      p = { id, d0: dist(e.touches[0], e.touches[1]), s: 1 };
    }, { passive: true, capture: true });
    root.addEventListener('touchmove', e => {
      if (!p || e.touches.length !== 2) return;
      // Two fingers on a window belong to the shell: keep a scrolling list from eating the pinch.
      if (e.cancelable) e.preventDefault();
      p.s = dist(e.touches[0], e.touches[1]) / p.d0;
      const we = p.id && winEl(p.id); if (we) we.style.setProperty('--pinch', String(Math.max(.9, Math.min(1.06, 1 + (p.s - 1) * .25))));
    }, { passive: false, capture: true });
    const end = () => {
      if (!p) return; const q = p; p = null;
      if (!q.id) { if (q.s < .75) openOverview(); return; }
      const we = winEl(q.id); if (we) we.style.removeProperty('--pinch');
      const d = appVars.desks[deskOf(q.id)]; if (!d) return;
      if (q.s > 1.25 && !(d.full && d.focus === q.id)) setFull(q.id, true);
      else if (q.s < (device.classList.contains('immersive') ? .72 : .8) && d.full) setFull(q.id, false);
      else if (q.s < .75 && !d.full) openOverview(); // already zoomed out to the desk: one more pinch shows every desk
    };
    root.addEventListener('touchend', e => { if (p && e.touches.length < 2) end(); }, { capture: true });
    root.addEventListener('touchcancel', end, { capture: true });
  }
  bindWinPinch(track);
  function pinchClaimed(id) { try { return winEl(id)?.querySelector('iframe')?.contentDocument?.querySelector('meta[name="wizard-os-pinch"]')?.content === 'app'; } catch (e) { return false; } }

  /* Bottom edge in immersive full screen: swipe up from anywhere along it to leave full screen.
   * The window follows the finger (shrinks a touch), past ~56 px or a quick flick it returns to tiles. */
  const immEdge = document.createElement('div'); immEdge.id = 'immEdge'; immEdge.className = 'imm-edge';
  immEdge.innerHTML = '<i></i>'; immEdge.setAttribute('aria-hidden', 'true'); device.appendChild(immEdge);
  // A click listener makes the strip a real tap target, so the browser's touch adjustment never snaps an
  // edge touch onto the composer just above it.
  immEdge.addEventListener('click', e => e.preventDefault());
  immEdge.addEventListener('touchmove', e => { if (IE && e.cancelable) e.preventDefault(); }, { passive: false });
  let IE = null;
  const immWin = () => { const d = appVars.desks[appVars.idx]; return d && d.full && d.focus ? winEl(d.focus) : null; };
  immEdge.addEventListener('pointerdown', e => {
    if (!device.classList.contains('immersive')) return;
    e.preventDefault(); try { immEdge.setPointerCapture(e.pointerId); } catch (_) {}
    IE = { y: e.clientY, x: e.clientX, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  immEdge.addEventListener('pointermove', e => {
    if (!IE || e.pointerId !== IE.id) return;
    IE.dy = Math.min(0, e.clientY - IE.y);
    const p = Math.min(1, -IE.dy / 160), we = immWin();
    if (we) { we.style.transition = 'none'; we.style.transform = `translateY(${IE.dy * .35}px) scale(${1 - p * .08})`; we.style.borderRadius = `${p * 22}px`; }
    immEdge.classList.toggle('pull', -IE.dy > 12);
  });
  const immEnd = e => {
    if (!IE || e.pointerId !== IE.id) return; const s = IE; IE = null;
    immEdge.classList.remove('pull');
    const we = immWin(); if (we) { we.style.transition = ''; we.style.transform = ''; we.style.borderRadius = ''; }
    const v = s.dy / ((performance.now() - s.t) || 1);
    if (e.type !== 'pointercancel' && (s.dy < -56 || (s.dy < -18 && v < -.45))) { const d = appVars.desks[appVars.idx]; if (d.full && d.focus) setFull(d.focus, false); }
  };
  immEdge.addEventListener('pointerup', immEnd); immEdge.addEventListener('pointercancel', immEnd);
  // The keyboard is up: the bottom edge belongs to the text field, not the shell.
  setInterval(() => {
    if (!appVars.immOn) return;
    let a = document.activeElement;
    try { if (a && a.tagName === 'IFRAME') a = a.contentDocument?.activeElement; } catch (e) {}
    device.classList.toggle('imm-typing', !!a && (/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) || a.isContentEditable));
  }, 400);

  /* ---------------- sheets ---------------- */
  const launcher = $('#launcher'), inboxEl = $('#inbox'), settingsEl = $('#settings');
  return { bindWinPinch, closeMenu, inboxEl, launcher, settingsEl };
};
