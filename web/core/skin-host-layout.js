/* Wizard UX skin host › events, the route, and the layout layer: loading, booting and painting a layout. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values skin-host.js changes over time (its reassigned lets, like the
 * layout record and the shell) stay in skin-host.js; this code reads and writes them as skinHostVars.<name>, its
 * get/set accessors on the same variables, so every read and write is live. Loaded just before core/skin-host.js.
 * The body below keeps skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.layout = function ({ builtins, chatsClaimed, isDoc, layoutDiagnostic, layoutFile, layoutOf, requested, skinHostVars, stamp }) {
  let insetPlaces, insetSync, placeSync, tweaks; // late-bound: skin-host.js declares these after the call, see bindLate

  const layers = () => [...builtins.values(), skinHostVars.active, skinHostVars.personal, skinHostVars.layoutRec, ...tweaks.values()].filter(Boolean);
  function emit(type, payload) {
    for (const a of layers()) for (const fn of [...(a.on[type] || [])]) fn(payload);
  }
  function routeOf() {
    const r = skinHostVars.shell ? skinHostVars.shell.route() : { view: 'desk', thread: null, desk: 0 };
    return Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0, app: r.app || null, agent: r.agent || null, beside: Math.sign(r.beside | 0), home: !!r.home, panel: ['thread', 'list', 'app'].includes(r.panel) ? r.panel : null, panelList: !!r.panelList, panelApp: typeof r.panelApp === 'string' && r.panelApp ? r.panelApp : null });
  }
  /* The view bound beside a chat thread (app.js syncPeek): 1 = it leans in on the right of the thread, -1 = on that
   * view, its thread leans in on the left, 0 = none. Its own event, so route listeners never see extra calls. */
  let lastBeside = 0;
  function emitBeside() {
    const side = skinHostVars.shell ? routeOf().beside : 0;
    if (side === lastBeside) return; lastBeside = side;
    if (layers().length) emit('beside', Object.freeze({ side }));
  }
  if (isDoc) window.addEventListener?.('wizard:app-orb', () => { if (layers().length) emit('render', Object.freeze({ part: 'app-orb', el: null })); });
  function emitRoute() {
    if (!layers().length || !skinHostVars.shell) return;
    const r = routeOf(), k = `${r.view}|${r.thread || ''}|${r.desk}|${r.app || ''}|${r.agent || ''}|${r.home ? 1 : 0}|${r.panel || ''}|${r.panelList ? 1 : 0}|${r.panelApp || ''}`;
    if (k === skinHostVars.lastRoute) return; skinHostVars.lastRoute = k;
    emit('route', r);
    if (skinHostVars.frameInset) insetSync();   // the app now in front may have drawn its bottom bar out of sight
    // the orb's spot follows the app in front once its desk has slid in
    if (insetPlaces.size) for (const ms of [380, 760]) setTimeout(placeSync, ms);
  }

  /* ---------- layout layer ---------- */
  const layoutUrl = (id, file) => isDoc ? stamp(new URL(`layouts/${id}/${file}`, document.baseURI).href) : `layouts/${id}/${file}`;
  let layoutCss = null;
  // html[data-chats-owner] lets the layout's blocking stylesheet keep Classic's list pane hidden from the first frame.
  function paintChatsOwner() {
    if (!isDoc) return;
    if (chatsClaimed()) document.documentElement.dataset.chatsOwner = 'layout'; else delete document.documentElement.dataset.chatsOwner;
  }
  // data-layout-booting: first frames of a desktop refresh that wears a layout owning the chats (AI apps). The page stays
  // clear until the layout says it is drawn (its own sheet applied) or has failed, never on a plain timer: a slow load
  // (cold cache, tailnet, Mac app) used to drop the veil after 5 s and show Classic Desks underneath (issue 1556).
  // The veil is an inline sheet, so it never waits on a fetch. A slow boot shows a quiet "Loading…" after BOOT_SLOW_MS;
  // one still not drawn BOOT_GIVEUP_MS after the shell attached gets the shared Chats recovery (layoutLoadFailed), never Classic.
  const BOOT_SLOW_MS = 5000, BOOT_GIVEUP_MS = 45000;
  const BOOT_VEIL = 'html[data-layout-booting] body { opacity: 0 !important; pointer-events: none !important; }\n'
    + 'html[data-layout-booting="slow"]::after { content: "Loading\\2026"; position: fixed; inset: 0; display: grid; place-items: center; '
    + 'font: 500 var(--wz-text-sm, 0.9rem) system-ui, sans-serif; color: CanvasText; opacity: 0.6; pointer-events: none; }';
  const booting = () => isDoc && document.documentElement.dataset.layoutBooting !== undefined;
  function endBoot() { if (isDoc) delete document.documentElement.dataset.layoutBooting; }
  function startBoot(id) {
    document.documentElement.dataset.layoutBooting = '';
    try { const st = document.createElement('style'); st.dataset.layoutVeil = ''; st.textContent = BOOT_VEIL; document.head.appendChild(st); } catch (_) {}
    // (unref: a test runtime never waits on these; a page ignores it)
    const later = (fn, ms) => { const t = setTimeout(fn, ms); try { t?.unref?.(); } catch (_) {} };
    later(() => { if (booting() && skinHostVars.layoutId === id) document.documentElement.dataset.layoutBooting = 'slow'; }, BOOT_SLOW_MS);
  }
  // The give-up clock starts at attach: before it there is no shell to mount the recovery, and the layout has not
  // even started loading (a slow parser can take longer than BOOT_GIVEUP_MS to reach desktop.js).
  function bootGiveUp(id) {
    const t = setTimeout(() => {
      if (!booting() || skinHostVars.layoutId !== id) return;
      // Mounted but its sheet never answered: the layout's own DOM is there, so show it.
      if (skinHostVars.layoutRec && !skinHostVars.layoutRec.dead && skinHostVars.layoutFailed !== id) return endBoot();
      // Still not mounted: give up on this load (a late import must not mount over the recovery) and recover.
      skinHostVars.layoutSeq++; layoutLoadFailed(id, 'timeout');
    }, BOOT_GIVEUP_MS);
    try { t?.unref?.(); } catch (_) {}
  }
  function layoutLoadFailed(id, reason = 'unavailable', error) {
    if (skinHostVars.layoutId !== id) return false;
    layoutDiagnostic('layout:' + id, 'load-failed', reason, error);
    skinHostVars.layoutFailed = id; endBoot(); paintChatsOwner();
    try { skinHostVars.shell?.ownsChatList?.(chatsClaimed()); } catch (_) {}
    // Keep the selected layout/choice. The shell can mount its shared Chats
    // sidebar without importing the failed bundle; never show Classic Desks.
    if (layoutOf(id)?.ownsChats) try { skinHostVars.shell?.layoutRecovery?.(true); } catch (e) { layoutDiagnostic('layout:' + id, 'recovery-error', reason, e); }
    return false;
  }
  function paintLayout(id) {
    if (!isDoc) return;
    const L = layoutOf(id);
    if (L) document.documentElement.dataset.layout = id; else delete document.documentElement.dataset.layout;
    paintChatsOwner();
    if (layoutCss && (!L || layoutCss.dataset.layoutPkg !== id)) { layoutCss.remove(); layoutCss = null; }
    if (L && L.css && !layoutCss && layoutFile(L, 'css')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = layoutUrl(id, layoutFile(L, 'css')); l.dataset.layoutPkg = id;
      l.setAttribute('blocking', 'render'); document.head.appendChild(l); layoutCss = l; requested.push(l.href);
    }
  }
  return { bootGiveUp, booting, emit, emitBeside, emitRoute, endBoot, layers, layoutLoadFailed, layoutUrl, paintChatsOwner, paintLayout, routeOf, startBoot, bindLate: v => { if ('insetPlaces' in v) insetPlaces = v.insetPlaces; if ('insetSync' in v) insetSync = v.insetSync; if ('placeSync' in v) placeSync = v.placeSync; if ('tweaks' in v) tweaks = v.tweaks; } };
};
