/* Wizard UX skin host › the skin host object the shells call. Moved verbatim out of core/skin-host.js
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
window.WizCore.skinHostParts.host = function ({ backClaims, BOOT_GUESS_MS, bootGiveUp, booting, builtinDefs, builtins, chatArchiveOrders, chatListOwners, chatsClaimed, claims, clock, commandUis, cssLinks, disabled, dispose, emit, emitBeside, emitRoute, emptyHomes, ensureCss, env, escapeSurfaces, EXPECT_KEY, expected, homeHtml, inboxThreads, interceptors, isDoc, keyGuides, keyHandlers, layers, LAYOUT_KEY, layoutOf, LAYOUTS, levels, load, loadLayout, loadTweaks, NOTE_ID, openRoutes, orbSwipeHolders, orbTaps, overlays, paintLayout, paintTweaks, panelHolders, preCss, release, REPLY_LENGTHS, replySummary, requested, safeTweakId, scriptProblem, setLayout, skinHostVars, snoozeLast, startBoot, startBuiltin, taps, tweakCss, tweaks, unload }) {

  const host = {
    loadTweaks, emit,
    get tweakState() { return [...tweaks.keys()]; },
    /* live.js / chats.js: 'last' while a live tweak holds api.nav.snoozeOrder('last'); otherwise 'default' (stock). */
    get snoozeOrder() { return snoozeLast.size ? 'last' : 'default'; },
    /* chats.js: the box-wide short-answer choices (start, length) and the three lengths, for the reply's ⚙ sheet. */
    replySummary: Object.freeze({ get: () => replySummary.get(), set: patch => replySummary.set(patch || {}), lengths: REPLY_LENGTHS }),
    /* chats.js: a live package shows notifications as threads; inboxAct runs its Done / Snooze / Restore. */
    get inboxThreads() { return inboxThreads.size > 0; },
    get inboxList() { for (const h of inboxThreads.values()) if (h.list) return true; return false; },
    inboxAct(action, id) { for (const h of inboxThreads.values()) { h.act(String(action), String(id)); return true; } return false; },
    action(name, context) { for (const { action, handler } of interceptors.values()) if (action === name) { void handler(context); return true; } return false; },
    /* core/skins.js: picker landed near a skin (preview or commit). Stylesheet only. */
    preview(id) { ensureCss(id); },
    /* core/skins.js: the owner picked a skin. Stylesheet plus (if any) its script. */
    commit(id) { ensureCss(id); skinHostVars.committedId = id; if (skinHostVars.shell) load(id); },
    /* app.js: the shell is ready; hands over the narrow adapter skins are allowed to drive. */
    attach(adapter) { skinHostVars.shell = adapter; for (const n of builtinDefs.keys()) startBuiltin(n); const id = skinHostVars.committedId || (window.WosSkin && window.WosSkin.current); skinHostVars.committedId = id; if (id) load(id); if (layoutOf(skinHostVars.layoutId)) loadLayout(skinHostVars.layoutId); if (booting()) bootGiveUp(skinHostVars.layoutId); window.dispatchEvent?.(new Event('wos:skin-host-ready')); },
    /* core/privacy.js (wizard-ux#1801): Ask my Wizard opens a new chat holding these words, unsent. */
    textDraft(text) { try { return !!skinHostVars.shell?.textDraft?.(String(text || '').slice(0, 2000)); } catch (e) { console.error(e); return false; } },
    /* Layouts: Settings › Look. Classic loads nothing. */
    layouts: LAYOUTS, setLayout,
    escapeSurface() { for (const h of [...escapeSurfaces].reverse()) if (!h.a.dead && h.back() === true) return true; return false; },
    async whenLayoutReady() { let p; do { p = skinHostVars.layoutLoading; await p; } while (p !== skinHostVars.layoutLoading); },
    setStandardLayout(id) { skinHostVars.standardLayout = layoutOf(id) ? id : 'classic'; if (skinHostVars.layoutId !== skinHostVars.standardLayout) setLayout(skinHostVars.standardLayout, false); return skinHostVars.standardLayout; },
    get layout() { return skinHostVars.layoutId; },
    chatsClaimed,
    chatArchiveOrder(sid) {
      for (const [a, fn] of chatArchiveOrders) if (!a.dead && chatListOwners.has(a)) {
        const ids = fn(sid);
        if (Array.isArray(ids)) return ids.filter(id => typeof id === 'string' && !id.startsWith(NOTE_ID));
      }
      return null;
    },
    /* desktop.js closeWin: a layout without desk numbers wants Home when the last window of a desk closes. */
    get emptyHome() { return [...emptyHomes].some(l => !l.dead); },
    /* app.js / desktop.js / bound-view.js: an open the shell starts by itself (apps.routeOpens). A holder that placed it
     * gives { value } (what its go() returned); null = nobody did: the caller opens it the stock way. Opens a holder
     * starts while it runs are never routed again. */
    routeOpen(kind, detail = {}, go = null) {
      if (skinHostVars.routing || !openRoutes.size) return null;
      for (const h of [...openRoutes]) {
        if (h.a.dead) continue;
        let out, ran = false;
        const g = desk => { if (!ran) { ran = true; out = typeof go === 'function' ? go(desk) : undefined; } return out; };
        skinHostVars.routing++;
        let took; try { took = h.open(String(kind), Object.freeze({ ...detail }), g); } finally { skinHostVars.routing--; }
        if (took === true) return Object.freeze({ value: out });
      }
      return null;
    },
    /* desktop.js: the layout holding the opens shows this desk's app on screen (beside the desk in front). */
    routeShows(desk) { for (const h of openRoutes) if (!h.a.dead && h.shows && h.shows(desk) === true) return true; return false; },
    /* desktop.js: a layout without desks holds the right-side panel (everything opens there, desks stay put). */
    get panelMode() { return skinHostVars.panelOn && (skinHostVars.panelHold > 0 || [...panelHolders].some(l => !l.dead)); },
    get layoutState() { return { id: skinHostVars.layoutId, active: !!skinHostVars.layoutRec, disabled: disabled.has('layout:' + skinHostVars.layoutId), mounts: skinHostVars.layoutRec?.mounts.size || 0 }; },
    /* desktop.js: a layout draws the command take (api.voice.onCommand); its result goes there, not to a toast. */
    get commandUi() { return commandUis.size > 0; },
    commandResult(ev) { for (const fn of [...commandUis]) fn(Object.freeze({ ...ev })); },
    /* desktop.js: the orb tapped from outside the page (wizard:orb) or by Right ⌘: the layout's own orb tap (api.voice.onTap)
     * decides where the take goes; undefined = no layout claims it (the shell's own talk). */
    deskOrbTap() { for (const fn of [...orbTaps].reverse()) { const r = fn(); if (r !== undefined) return r; } return undefined; },
    /* desktop.js onKey / keyup: a layout's keys first (api.keys.on); true = used. holdKeys: it draws its own hold-⌥. */
    key(e) { for (const h of [...keyHandlers]) if (!h.a.dead && h.down && h.down(e) === true) return true; return false; },
    keyUp(e) { for (const h of [...keyHandlers]) if (!h.a.dead && h.up) h.up(e); },
    get holdKeys() { return [...keyHandlers].some(h => h.hold && !h.a.dead); },
    // (app: a plain-key keycap on an app's own control inside the same-origin app frame `frame`, outlined; name = its label)
    keyChips() { const out = []; for (const fn of [...keyGuides]) { const l = fn(); if (Array.isArray(l)) for (const c of l.slice(0, 64)) if (c && c.el && typeof c.key === 'string') out.push({ el: c.el, key: c.key.slice(0, 6), word: typeof c.word === 'string' ? c.word.slice(0, 24) : '', at: c.at, ...(c.frame?.tagName === 'IFRAME' ? { frame: c.frame } : {}), ...(c.app === true ? { app: true, name: typeof c.name === 'string' ? c.name.slice(0, 64) : '' } : {}), ...(c.free === true ? { free: true } : {}) }); } return out; },
    get keysOnly() { return [...keyGuides].some(g => g.only); },
    /* app.js: the dock orb's swipes a worn layout asked for ({ up, side, down }: null = nothing, 'home'), or null = stock. */
    orbSwipes() { for (const [l, m] of orbSwipeHolders) if (!l.dead) return m; return null; },
    /* app.js: the dock orb was tapped while idle. True when a layout handled it. */
    orbTap() { for (const fn of [...taps]) { if (fn() === true) return true; } return false; },
    level(v) { if (levels.size) for (const fn of [...levels]) fn(v); },
    /* app.js: the orb's voice state changed. */
    voice(state) { if (layers().length) emit('voice', Object.freeze({ ...(skinHostVars.shell?.voiceState ? skinHostVars.shell.voiceState() : { state }) })); },
    scriptProblem,
    /* core/*.js: a gesture every skin wears. `when: 'touch'` skips desktop pointers. */
    builtin(name, setup, { when = 'touch', label = name, capabilities } = {}) { if (typeof setup !== 'function' || builtinDefs.has(name)) return false; builtinDefs.set(name, { setup, when, label, capabilities }); return startBuiltin(name) || !skinHostVars.shell; },
    get builtinState() { return [...builtins.keys()]; },
    /* core/experience.js: the shell is attached (no own-skin script runs: skins are look only, wizard-ux#1190). */
    get personalState() { return { ready: !!skinHostVars.shell }; },
    /* app.js backStep / desktop.js escStep: close the newest package overlay. True when one closed. */
    back() { const e = overlays.pop(); if (!e) return false; e.close(); return true; },
    /* app.js / desktop.js: repaint a Home. Nodes a tweak mounted at the home-main slot move to the new markup
     * (no remount, no flash) and layout tweaks hear api.on('home'). Without a mount this is plain innerHTML. */
    paintHome(el, html) {
      if (!el) return;
      const sel = '[data-slot="home-main"]';
      // A package view is mounted and the markup is the same as last time: leave the DOM alone, so the view is not
      // detached and re-attached (which restarts its motion and looks like a reload). When only the live resource
      // readings changed, update just that block in place.
      if (el.querySelector?.(sel)?.childNodes?.length && homeHtml.has(el)) {
        const prev = homeHtml.get(el);
        if (prev === html) { if (layers().some(l => l.on.home.size)) emit('home', Object.freeze({})); return; }
        const LIVE = ['[data-home-resources]', '.home-time', '.home-date', '.constellation'];
        const parts = h => { const t = document.createElement('template'); if (typeof t.content?.querySelector !== 'function') return null;
          t.innerHTML = h; const inner = LIVE.map(q => { const r = t.content.querySelector(q), v = r ? r.innerHTML : null; if (r) r.innerHTML = ''; return v; }); return [t.innerHTML, inner]; };
        const a = parts(prev), b = parts(html), live = LIVE.map(q => el.querySelector(q));
        if (a && b && a[0] === b[0] && b[1].every((v, i) => (v == null) === !live[i])) {
          b[1].forEach((v, i) => { if (live[i] && live[i].innerHTML !== v) live[i].innerHTML = v; }); homeHtml.set(el, html);
          if (layers().some(l => l.on.home.size)) emit('home', Object.freeze({}));
          return;
        }
      }
      homeHtml.set(el, html);
      const kept = [...(el.querySelector?.(sel)?.childNodes || [])];
      el.innerHTML = html;
      const slot = kept.length ? el.querySelector?.(sel) : null;
      if (slot) slot.append(...kept);
      if (layers().some(l => l.on.home.size)) emit('home', Object.freeze({}));
    },
    /* chats.js: a chats window repainted part ('thread' | 'list'). */
    rendered(part, el) { if (!layers().length) return; emit('render', Object.freeze({ part, el })); emitRoute(); },
    /* app.js: desk or focus changed. */
    changed() { emitRoute(); },
    /* app.js syncPeek: the bound view beside a thread appeared, moved or went away. */
    beside() { emitBeside(); },
    /* app.js dock swipe: true when a skin gesture owns this pointer. Cleared on pointerup/cancel. */
    claimed: pointerId => claims.has(pointerId),
    /* app.js Back: true while a skin gesture owns a finger or lifted it within `ms`. The browser's / OS's own back swipe
     * (iOS Safari's left edge, Chrome's overscroll, Android's edge) under that finger is the gesture's, not a Back. */
    claimedLately: (ms = 800) => { const t = clock() - skinHostVars.claimAt; return t < ms || (backClaims.size > 0 && t < 10000); },
    release,
    get state() { return { active: skinHostVars.active ? skinHostVars.active.id : null, listeners: skinHostVars.active ? skinHostVars.active.offs.size : 0, frames: skinHostVars.active ? skinHostVars.active.frames.size : 0, handlers: skinHostVars.active ? skinHostVars.active.on.route.size + skinHostVars.active.on.render.size : 0, disabled: [...disabled], requested: [...requested], css: [...cssLinks.keys()] }; },
    _test: { setImporter(fn) { skinHostVars.importer = fn; }, env, load, unload, loadLayout },
  };
  if (typeof window !== 'undefined') {
    window.WosSkinHost = host;
    // The stored skin's stylesheet now, in <head>, so it paints with the first frame (no flash).
    const id = window.WosSkin && window.WosSkin.current;
    if (id) { ensureCss(id); skinHostVars.committedId = id; }
    // The tweaks this device wore last time: listed and styled from the first frame (loadTweaks settles the real list).
    try { const last = JSON.parse(localStorage.getItem(EXPECT_KEY) || '[]'); if (isDoc && Array.isArray(last)) { for (const t of last.filter(x => typeof x === 'string' && safeTweakId(x)).slice(0, 40)) { expected.add(t); tweakCss(t); } if (expected.size) paintTweaks(); } } catch (_) {}
    // If the catalog or profile never loads, drop the guessed packages (and their styles) instead of hiding Home for good.
    if (expected.size) setTimeout(() => { if (skinHostVars.tweaksAsked) return; for (const t of [...expected]) { expected.delete(t); const l = preCss.get(t); if (l) { l.remove(); preCss.delete(t); } } paintTweaks(); }, BOOT_GUESS_MS);
    // ?layout=<id> only tries layouts supported by this shell. An unsupported link is ignored,
    // so it cannot overwrite another valid local choice. This runs before paint/CSS and attach/import.
    try {
      const q = new URLSearchParams(location.search).get('layout');
      if (q === 'classic') localStorage.removeItem(LAYOUT_KEY); else if (layoutOf(q)) localStorage.setItem(LAYOUT_KEY, q);
    } catch (_) {}
    try {
      const l = localStorage.getItem(LAYOUT_KEY), known = LAYOUTS.find(x => x.id === l);
      // wos.layout is a device-local materialized hint, not the per-shell shared choice.
      // Drop only a known unsupported hint; never touch experience/views, skin, mix or unknown keys.
      if (known?.shells && !known.shells.includes(env().shell)) localStorage.removeItem(LAYOUT_KEY);
      let chosen = layoutOf(l) ? l : 'classic';
      if (isDoc && env().shell === 'desktop') {
        const q = new URLSearchParams(location.search).get('layout'), explicit = q === 'classic' || !!layoutOf(q);
        const saved = localStorage.getItem('wos.desktop-view.v1');
        // A saved per-shell choice beats a stale legacy hint. Resolve before paintLayout, so even a saved Classic
        // choice never requests/claims the old AI apps layout. An explicit supported preview URL still wins.
        if (!explicit && (saved === 'classic' || layoutOf(saved))) chosen = saved;
        else if (!explicit && chosen === 'classic') chosen = 'ai-apps';
        skinHostVars.standardLayout = chosen;
      }
      skinHostVars.layoutId = chosen; paintLayout(chosen);
      if (isDoc && env().shell === 'desktop' && layoutOf(chosen)?.ownsChats) {
        startBoot(chosen);
      }
    } catch (_) {}
    if (isDoc) for (const pid of ['pointerup', 'pointercancel']) document.addEventListener(pid, e => release(e.pointerId), true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = host;
  return {  };
};
