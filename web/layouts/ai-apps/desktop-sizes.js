/* Wizard UX AI apps view (desktop) › each panel's width, dragging a grip and re-tiling. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
export function sizesPart({ aadVars, api, COLS, el, FLIP_MS, host, paneWins, placePanes, RAIL, root, scene, SIDE, SIZE_LIMITS }) {
  let syncOrb; // late-bound: desktop.js declares these after the call, see bindLate
  const GRIP_NAMES = { side: 'Resize the chats sidebar', tabs: 'Resize the open apps', app: 'Resize the app panel' };
  const SIZE_VARS = { side: '--aad-side-w', tabs: '--aad-tabs-px', app: '--aad-app-px' };
  const vw = () => globalThis.innerWidth || 1440;
  const clampTo = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  /** each panel's width now (the owner's, else the default) within its limits: [now, lo, hi]; the app panel always
   * leaves the middle 320 px (the composer and the orb) */
  function sizes() {
    const W = vw(), hi = Math.round(Math.min(SIZE_LIMITS.side[1], W * .32));
    const side = clampTo(aadVars.sized.side ?? SIDE, SIZE_LIMITS.side[0], hi);
    const tabs = clampTo(aadVars.sized.tabs ?? COLS.tabs, SIZE_LIMITS.tabs[0], Math.min(SIZE_LIMITS.tabs[1], W * .25));
    const sideNow = root.dataset.aadSide === 'open' ? side : RAIL, tabsNow = root.dataset.aadTabs === 'rail' ? COLS.tabsRail : tabs;
    const appHi = Math.min(SIZE_LIMITS.app[1], W - sideNow - tabsNow - 320);
    // an app shown with its companion pane (Video Editor's video + Feedback) needs room for both columns: wider by
    // default until the owner sizes the panel himself (James, 6 Nov 2026)
    // An app with its companion (Video Editor + Feedback) needs room for two columns: the panel opens at least
    // 900px / 62% wide while the companion shows, even over a narrower width the owner chose for single apps,
    // and returns to that chosen width when the companion closes (James, 6 Nov 2026).
    const app = clampTo(Math.round(paneWins() > 1 ? Math.max(aadVars.sized.app ?? 0, 900, W * .62) : aadVars.sized.app ?? Math.min(720, Math.max(420, W * .4))), SIZE_LIMITS.app[0], appHi);
    return { side: [side, SIZE_LIMITS.side[0], hi], tabs: [tabs, SIZE_LIMITS.tabs[0], Math.min(SIZE_LIMITS.tabs[1], W * .25)], app: [app, SIZE_LIMITS.app[0], appHi] };
  }
  /* round 10 (Miguel: dragging felt laggy): a drag writes only what changed, once a frame. While a grip is held
   * (data-aad-resizing) the shown desks' windows follow their desk by CSS (desktop.css), and the page's resize (the
   * desks tiled again, every app frame, the orb, the composer) waits for the release: once, at pointerup. */
  const shownVars = {}, shownAria = {};
  function applySizes() {
    const s = sizes();
    placePanes(s);
    for (const id of Object.keys(SIZE_VARS)) {
      const px = s[id][0] + 'px';
      if (shownVars[id] !== px) { shownVars[id] = px; root.style.setProperty(SIZE_VARS[id], px); }
      const g = grip[id]; if (!g) continue;
      const aria = `${s[id][0]},${s[id][1]},${Math.round(s[id][2])}`; if (shownAria[id] === aria) continue; shownAria[id] = aria;
      g.setAttribute('aria-valuenow', String(s[id][0])); g.setAttribute('aria-valuemin', String(s[id][1])); g.setAttribute('aria-valuemax', String(Math.round(s[id][2])));
    }
    // the desks' windows are laid out in pixels: again when a width changed (after the drag, while one is held)
    const sig = Object.keys(SIZE_VARS).map(id => s[id][0]).join(',');
    if (sig !== aadVars.laidOut) { aadVars.laidOut = sig; if (!aadVars.sizing || !root.dataset.aadResizing) relayoutSoon(); }
  }
  /* One re-tile (the shell's own: a page resize) once a change has settled, coalesced: the windows of the shown panels
   * follow their desks by CSS meanwhile (desktop.css), so nothing re-lays out per frame and the wallpaper is untouched
   * (core/skins.js ignores a resize that leaves the page its size). */
  let retileOff = null;
  /* round 14 (Miguel: the fold must feel instant): a shown desk's lone window follows it by CSS and the desks out of
   * sight keep the open sidebar's geometry (desktop.css), so a fold needs no re-tile; only a desk tiling two or more
   * windows side by side does. The shell's re-tile re-laid out every desk's app (~100 layouts) right after each fold. */
  const needsTile = () => { const groups = new Map(); for (const w of host?.windows() || []) if (w.tiled) { const n = (groups.get(w.deskId) || 0) + 1; if (n > 1) return true; groups.set(w.deskId, n); } return false; };
  function retileSoon(ms = FLIP_MS + 20) { retileOff?.(); retileOff = api.after(ms, () => { retileOff = null; if (needsTile()) globalThis.dispatchEvent?.(new Event('resize')); syncOrb(); }); }
  const relayoutSoon = () => retileSoon();
  function setSize(id, w, keep) {
    aadVars.sized = { ...aadVars.sized, [id]: Math.round(w) }; applySizes();
    aadVars.sized = { ...aadVars.sized, [id]: sizes()[id][0] };   // what shows is what is kept
    if (keep) api.storage.set('widths', aadVars.sized);
  }
  function resetSize(id) { const { [id]: _, ...rest } = aadVars.sized; aadVars.sized = rest; api.storage.set('widths', aadVars.sized); applySizes(); }
  /* (round 10) an app's page lays itself out again whenever its frame changes width, and the shown apps run in this
   * page's thread: while a grip is held their frames keep a fixed width (the window clips or shows its own background
   * at the moving edge), refitted a few times a second, and once more on release. */
  const FRAME_FIT_MS = 120;
  const shownFrames = () => (host?.windows() || []).filter(w => w.visible && w.tiled).map(w => host.frame(w.id)).filter(Boolean);
  function fitFrames(list) {
    for (const f of list) f.style.removeProperty('width');
    const ws = list.map(f => f.getBoundingClientRect().width);
    list.forEach((f, i) => { if (ws[i] > 0) f.style.setProperty('width', Math.round(ws[i]) + 'px'); });
  }
  const grips = el('div', 'aad-grips');
  const grip = {};
  for (const id of ['side', 'tabs', 'app']) {
    const g = el('div', 'aad-grip', { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': GRIP_NAMES[id], title: GRIP_NAMES[id] + ' · double-click: back to default', 'data-grip': id });
    grips.append(g); grip[id] = g;
    // the sidebar grows to the right, the open-apps column and the app panel to the left
    const sign = () => id === 'tabs' ? (root.dataset.aadDockEdge === 'start' ? 1 : -1) : (id === 'side' ? 1 : -1) * (root.dataset.aadPaneSide === 'end' || (id === 'app' && root.dataset.aadAppSide === 'start') ? -1 : 1);
    let drag = null, cancelFrame = null;
    // (the pointer's latest x, applied once a frame: a fast mouse sends several moves a frame)
    const step = t => {
      cancelFrame = null; if (!drag || drag.at === drag.done) return;
      drag.done = drag.at; setSize(id, drag.w + (drag.at - drag.x) * sign(), false);
      if (t && t - drag.fit > FRAME_FIT_MS) { drag.fit = t; fitFrames(drag.frames); }
    };
    api.listen(g, 'pointerdown', e => {
      if (e.button) return; e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { x: e.clientX, at: e.clientX, done: e.clientX, w: sizes()[id][0], fit: 0, frames: shownFrames() }; aadVars.sizing = id; g.classList.add('is-drag'); root.dataset.aadResizing = id;
      fitFrames(drag.frames);
    });
    api.listen(g, 'pointermove', e => { if (!drag) return; drag.at = e.clientX; if (!cancelFrame) cancelFrame = api.frame(step); });
    const end = () => {
      if (!drag) return;
      cancelFrame?.(); cancelFrame = null; step(); const held = drag.frames; drag = null;
      for (const f of held) f.style.removeProperty('width');
      // the desks tiled for the final widths (and the orb placed) BEFORE the CSS follow is lifted: no jump on release
      aadVars.sizing = ''; g.classList.remove('is-drag'); globalThis.dispatchEvent?.(new Event('resize')); syncOrb();
      delete root.dataset.aadResizing; api.storage.set('widths', aadVars.sized);
    };
    api.listen(g, 'pointerup', end); api.listen(g, 'pointercancel', end); api.listen(g, 'lostpointercapture', end);
    api.listen(g, 'dblclick', () => resetSize(id));
    api.listen(g, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); resetSize(id); return; }
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!dir) return;
      e.preventDefault(); aadVars.sizing = id; setSize(id, sizes()[id][0] + dir * sign() * (e.shiftKey ? 64 : 16), true); aadVars.sizing = '';
    });
  }
  api.listen(globalThis, 'resize', () => applySizes());
  scene.append(grips);
  return { applySizes, grip, retileSoon, setSize, SIZE_VARS, sizes, vw, bindLate: v => { if ('syncOrb' in v) syncOrb = v.syncOrb; } };
}
