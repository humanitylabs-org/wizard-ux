/* Skin packages v1 (James, 19 Oct 2026; architecture agreed with Claude Fable).
 *
 * A collaborator skin can carry its own look AND behaviour in its own folder, web/skins/<dir>/:
 *   skin.css   rules scoped to that skin only (html[data-skin="<id>"] …); lint-enforced
 *   skin.js    optional ES module: `export default function setup(api) { …; return teardown }`
 * The skin's entry in core/skins.js opts in with `pkg: { css: true, js: true, when: 'touch' | 'always', dir }`.
 * James's skins declare no pkg, so they load nothing extra. A skin's files download only when that skin
 * is picked; skin.js runs only once the skin is committed (never while swiping the picker) and is torn down
 * on every switch. Skin scripts see only the small API below, never shell internals (window.__wos).
 *
 * Safety net: every skin callback is wrapped. Three errors within a minute unload the skin's script for this
 * page (its stylesheet stays), with one toast and no retry. nav.back() runs the shell's own Back step, so a
 * skin can never leave or exit the app; at the root it simply returns false.
 *
 * Load order: this script sits in <head> right after the core/skins.css link, so the stored skin's stylesheet
 * is inserted in the old skins.css cascade slot and blocks first paint (no flash of the wrong skin). */
(function () {
  'use strict';
  /* Values this file changes over time (wizard-ux issue 1665): the parts in core/skin-host-*.js read and write them
   * as skinHostVars.<name>, accessors on these same variables, so every read and write is live. */
  const skinHostVars = {
    get active() { return active; }, set active(v) { active = v; },
    get claimAt() { return claimAt; }, set claimAt(v) { claimAt = v; },
    get committedId() { return committedId; }, set committedId(v) { committedId = v; },
    get frameInset() { return frameInset; }, set frameInset(v) { frameInset = v; },
    get frameOrb() { return frameOrb; }, set frameOrb(v) { frameOrb = v; },
    get importer() { return importer; }, set importer(v) { importer = v; },
    get lastRoute() { return lastRoute; }, set lastRoute(v) { lastRoute = v; },
    get layoutFailed() { return layoutFailed; }, set layoutFailed(v) { layoutFailed = v; },
    get layoutHolder() { return layoutHolder; }, set layoutHolder(v) { layoutHolder = v; },
    get layoutId() { return layoutId; }, set layoutId(v) { layoutId = v; },
    get layoutLoading() { return layoutLoading; }, set layoutLoading(v) { layoutLoading = v; },
    get layoutRec() { return layoutRec; }, set layoutRec(v) { layoutRec = v; },
    get layoutSeq() { return layoutSeq; }, set layoutSeq(v) { layoutSeq = v; },
    get lookOnly() { return lookOnly; }, set lookOnly(v) { lookOnly = v; },
    get packageReady() { return packageReady; }, set packageReady(v) { packageReady = v; },
    get panelHold() { return panelHold; }, set panelHold(v) { panelHold = v; },
    get panelOn() { return panelOn; }, set panelOn(v) { panelOn = v; },
    get personal() { return personal; }, set personal(v) { personal = v; },
    get personalError() { return personalError; }, set personalError(v) { personalError = v; },
    get personalSeq() { return personalSeq; }, set personalSeq(v) { personalSeq = v; },
    get routing() { return routing; }, set routing(v) { routing = v; },
    get shell() { return shell; }, set shell(v) { shell = v; },
    get slotContract() { return slotContract; }, set slotContract(v) { slotContract = v; },
    get standardLayout() { return standardLayout; }, set standardLayout(v) { standardLayout = v; },
    get tweaksAsked() { return tweaksAsked; }, set tweaksAsked(v) { tweaksAsked = v; },
  };
  const ERR_LIMIT = 3, ERR_WINDOW = 60000;
  const EVENTS = ['route', 'render', 'voice', 'sent', 'beside', 'home'];
  /* Layouts (James, 22 Oct 2026): a third, opt-in layer for UX changes (gestures, orbs, controls) that any
   * colour skin can wear. Classic is the shell as everyone has it and loads nothing. A layout lives in
   * web/layouts/<id>/{layout.css,layout.js}; its css applies only under html[data-layout="<id>"]. files: { <shell>: { css, js } }
   * names that shell's own entry instead (css '' = none), so a shell never downloads another shell's layout code. */
  const LAYOUTS = Object.freeze([
    Object.freeze({ id: 'classic', name: 'Classic', desc: 'One orb: tap to talk, hold for a command' }),
    // Miguel's miguel/ai-apps tweak wears it on desktop only: apps/threads around the chat.
    // Keep this synchronous support metadata aligned with its manifest; boot cannot wait for the catalog.
    Object.freeze({ id: 'ai-apps', name: 'AI apps', desc: 'Apps and chats around the main chat (desktop only)', shells: Object.freeze(['desktop']), css: true, js: true, ownsChats: true, files: Object.freeze({ desktop: Object.freeze({ css: 'desktop-boot.css', js: 'desktop.js' }) }) }),   // ownsChats: it draws every chat list itself (api.sessions.ownList), so Classic's never mounts
  ]);
  // The Orb, Apps and Two orbs layouts were removed (wizard-ux issue 1338): a stored 'orb', 'apps' or 'two-orb' is unknown,
  // so boot treats it as Classic (phone) or the standard AI apps view (desktop).
  const VIEW_LAYOUTS = new Set(['ai-apps']);   // worn only by a view tweak: a stale stored one goes back to Classic
  const LAYOUT_KEY = 'wos.layout';
  const layoutFile = (L, kind) => { const f = L.files?.[env().shell]; return f ? f[kind] || '' : kind === 'css' ? 'layout.css' : 'layout.js'; };
  const layoutOf = id => LAYOUTS.find(l => l.id === id && l.id !== 'classic' && (!l.shells || l.shells.includes(env().shell))) || null;
  let standardLayout = null; // built-in desktop renderer, independent of personal tweak lifetimes
  const escapeSurfaces = new Set(), chatListOwners = new Set(), chatArchiveOrders = new Map();
  let layoutId = 'classic', layoutRec = null, layoutSeq = 0, layoutHolder = null; // layoutHolder: the tweak wearing it
  let layoutFailed = null;          // a chat-owning layout whose code could not load: Classic's list comes back (never a blank desktop)
  /* Who draws the chat list. True from the first frame for a layout that owns chats (decided synchronously at boot, before
   * Classic paints) until that layout fails to load; a layout that has claimed the list holds it too. */
  const chatsClaimed = () => chatListOwners.size > 0 || (!!layoutOf(layoutId)?.ownsChats && layoutFailed !== layoutId);
  const taps = new Set();           // orb tap interceptors (layout first-wins); each returns true when handled
  const levels = new Set();         // microphone level listeners (0..1) during a take
  const isDoc = typeof document !== 'undefined';
  let shell = null;                 // adapter from app.js: route/back/openList/openThread/goDesk/deskCount/root/dock/toast
  let active = null;                // { id, dir, teardown, offs:Set, frames:Set, on:{route:Set,render:Set}, errs:[], dead }
  let lastRoute = '';
  const cssLinks = new Map();       // dir -> <link>
  const disabled = new Set();       // skin ids whose script failed this page
  const claims = new Set();         // pointer ids a skin gesture has claimed
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const backClaims = new Set();
  window.addEventListener?.('keydown', () => { claimAt = -Infinity; backClaims.clear(); }, true);
  window.addEventListener?.('pointerdown', () => { claimAt = -Infinity; backClaims.clear(); }, true);
  let claimAt = -Infinity;          // when a claimed finger last went down or lifted (a back swipe that follows is the gesture's)
  const requested = [];             // asset URLs requested (diagnostics + tests)
  let importer = url => import(url);
  let committedId = null, loadSeq = 0;
  /* Skins are look only (wizard-ux#1190, switch wizard/skins-look-only, off by default). While the switch is among the
   * tweaks the experience asks for, no skin script runs: neither a skin package's skin.js nor an own skin's personal
   * script. Their stylesheets still apply. Switching it off brings both back (the personal one only if still approved). */
  const LOOK_ONLY = 'wizard/skins-look-only';
  let lookOnly = false;
  let personal = null, personalSeq = 0, packageReady = Promise.resolve();
  /* Built-in gestures, the release stamp, the orb stand-in, the stylesheet and the error fallback: core/skin-host-boot.js (moved verbatim, wizard-ux issue 1665). */
  const { builtinDefs, builtins, dirOf, ensureCss, env, layoutDiagnostic, loadOrb, record, skinOf, stamp, url } = window.WizCore.skinHostParts.boot({ cssLinks, isDoc, requested });
  /* What a skin script receives and how it is loaded and disposed; core/skin-host-api.js. */
  const { dispose, fault, guard, makeApi, nameOf, unload, bindLate: apiLate } = window.WizCore.skinHostParts.api({ backClaims, builtins, claims, clock, disabled, env, ERR_LIMIT, ERR_WINDOW, EVENTS, isDoc, layoutDiagnostic, levels, loadOrb, personalFailed, skinHostVars, taps });

  async function load(id) {
    const seq = ++loadSeq;
    unload('switch');
    const pkg = skinOf(id);
    if (!pkg || !pkg.js || lookOnly || disabled.has(id) || !shell) return false;
    const E = env();
    if ((pkg.when || 'touch') === 'touch' && !E.touch) return false;
    const href = url(dirOf(id, pkg), 'skin.js'); requested.push(href);
    let mod;
    try { mod = await importer(href); } catch (e) { try { console.warn(`[skin ${id}] import failed:`, e); } catch (_) {} return false; }
    if (seq !== loadSeq || committedId !== id || lookOnly) return false; // switched again while loading
    const setup = mod && mod.default;
    if (typeof setup !== 'function') return false;
    const a = record(id, nameOf(id));
    active = a; lastRoute = '';
    try { a.teardown = setup(makeApi(a)); } catch (e) { fault(a, 'setup', e); if (a.dead) return false; }
    if (active === a) emitRoute();
    return active === a;
  }
  /* Events, the route, and the layout layer: loading, booting and painting a layout; core/skin-host-layout.js. */
  const { bootGiveUp, booting, emit, emitBeside, emitRoute, endBoot, layers, layoutLoadFailed, layoutUrl, paintChatsOwner, paintLayout, routeOf, startBoot, bindLate: layoutLate } = window.WizCore.skinHostParts.layout({ builtins, chatsClaimed, isDoc, layoutDiagnostic, layoutFile, layoutOf, requested, skinHostVars, stamp });
  apiLate({ layers, layoutUrl, routeOf });
  // Loading a layout holds the panel too (a tweak reload re-wears it a moment after the tweaks settle).
  let layoutLoading = Promise.resolve();
  function loadLayout(id) { return layoutLoading = loadLayoutHeld(id); }
  async function loadLayoutHeld(id) {
    panelHold++;
    try { return await loadLayoutNow(id); } finally { panelHold--; panelSync(); }
  }
  async function loadLayoutNow(id) {
    const seq = ++layoutSeq;
    dispose(layoutRec, 'switch');
    try { shell?.layoutRecovery?.(false); } catch (_) {}
    layoutFailed = null; paintChatsOwner();
    const L = layoutOf(id); const key = 'layout:' + id;
    if (!L || !L.js || !shell || disabled.has(key)) return layoutLoadFailed(id);
    const href = layoutUrl(id, layoutFile(L, 'js')); requested.push(href);
    let mod;
    // Three retries after the first failure. A distinct URL avoids a cached
    // rejected module entry; a superseded selection must never mount late.
    let importError;
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt) {
        await new Promise(resolve => setTimeout(resolve, [250, 750, 1500][attempt - 1]));
        if (seq !== layoutSeq || layoutId !== id) return false;
      }
      const attemptHref = attempt ? href + (href.includes('?') ? '&' : '?') + 'layout-retry=' + seq + '-' + attempt + '-' + Date.now() : href;
      if (attempt) requested.push(attemptHref);
      try { mod = await importer(attemptHref); importError = null; break; }
      catch (e) { importError = e; try { console.warn('[layout] import failed:', id, attempt, e); } catch (_) {} }
      if (seq !== layoutSeq || layoutId !== id) return false;
    }
    if (importError) return seq === layoutSeq ? layoutLoadFailed(id, 'import', importError) : false;
    if (seq !== layoutSeq || layoutId !== id) return false;
    if (typeof mod?.default !== 'function') return layoutLoadFailed(id, 'missing setup');
    const a = record(key, L.name + ' layout'); layoutRec = a;
    try { const base = makeApi(a); a.teardown = mod.default(Object.freeze({ ...base, ...shellApi(a, base) })); }
    catch (e) {
      fault(a, 'setup', e);
      // A partial mount has no usable navigation contract. Release only its
      // resources, then show shared Chats under the unchanged selected layout.
      dispose(a, 'setup-failed', e, 'setup');
      return layoutLoadFailed(id, 'setup', e);
    }
    lastRoute = ''; emitRoute();
    return layoutRec === a;
  }
  /* Layouts are built-in shell code, so they also get the shell's own lists and actions (no DOM crosses):
   * the Working / Ready threads with the actions Chats offers on each, Snooze / Done through Chats' own threadAct
   * (so a snooze tweak's interception applies), the owner's quick apps, Home and Settings › Look. */
  const emptyHomes = new Set();   // layouts that asked for desktop.js closeWin to go Home when a desk empties
  const openRoutes = new Set();   // layouts that place the shell's own opens themselves (apps.routeOpens); none = stock
  let routing = 0;                // a held route is running: opens it starts itself take the stock way (no loop)
  /* An app's own logo and the App Store listing: core/skin-host-logos.js (moved verbatim, wizard-ux issue 1665). */
  const { appLogo, storeApps } = window.WizCore.skinHostParts.logos({ isDoc, stamp });
  /* Room a layout's floating orb takes at the bottom of every app window (px): each hosted app document gets it as
   * --wos-inset-b on its <html> (like the camera's --wos-cutout) and one rule that adds that much room after a kit
   * scroll area's last item (.wz-scroll), so every list still scrolls clear of the orb. 0 = nothing (stock). */
  let frameInset = 0, frameOrb = null;
  /* The orb bar and the room the orb takes in app windows: core/skin-host-orbbar.js (moved verbatim, wizard-ux issue 1665). */
  const { bottomBar, clearEnd, CONTROLS, fitTabs, floatsOver, frameSpots, hasEntry, INSET_CSS, insetFonts, insetHolders, insetOrbs, insetPlaces, insetSheets, insetWatch, isTabBar, mainScroller, orbEnd, orbTabs, setAttr, shownIn, unmark, WOS_MARKED } = window.WizCore.skinHostParts.orbbar({  });
  layoutLate({ insetPlaces });
  function insetFrame(f) {
    // (round 7) a desktop app panel beside the orb's column (AI apps: the app on the right, the orb in the chat): no orb
    // over it, so no room kept for one (no lift, no band)
    let fi = frameInset;
    // (no room for an orb that is not over the frame: beside a document, or below it in a desktop app bar)
    if (fi && document.documentElement.dataset.shell === 'desktop') { try { const o = frameOrb?.(), r = f.getBoundingClientRect(); if (o && r.width && (isDoc && (o.x < r.left || o.x > r.right) || o.y - o.d / 2 >= r.bottom - 1)) fi = 0; } catch (_) {} }
    let d = null; try { d = f.contentDocument; } catch (_) { return; }
    if (!d?.documentElement) return;
    d.documentElement.style.setProperty('--wos-inset-b', fi + 'px');
    // an app re-draws its bar (a tab picked, a list loaded): look again once it settles (one watcher per document)
    if (fi && d.body && !insetWatch.has(d) && d.defaultView?.MutationObserver) {
      let t = 0; const mo = new d.defaultView.MutationObserver(() => { if (t) return; t = setTimeout(() => { t = 0; if (frameInset && f.isConnected && f.contentDocument === d) insetFrame(f); }, 180); });
      mo.observe(d.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
      insetWatch.set(d, mo);
    }
    if (fi) {
      // a kit scroll area (most apps) or, when the page itself scrolls, the page: room after the last item; an app's own
      // bottom tab bar is lifted clear of the orb instead (its background runs on under the orb, like a phone's home bar).
      // A constructed sheet in the app's own realm (CSSOM, so an app's style-src policy still lets it apply); put back if
      // the app replaces its adopted sheets.
      try {
        // one per document (a frame's window object can outlive its first, blank document)
        let sh = insetSheets.get(d);
        if (!sh) { sh = new d.defaultView.CSSStyleSheet(); sh.replaceSync(INSET_CSS); insetSheets.set(d, sh); }
        if (!d.adoptedStyleSheets.includes(sh)) d.adoptedStyleSheets = [...d.adoptedStyleSheets, sh];
      } catch (_) {}
    }
    const se = d.scrollingElement, doc = !!fi && !!se && !d.querySelector('.wz-scroll') && se.scrollHeight > se.clientHeight + 4;
    if (doc) d.documentElement.classList.add('wos-inset-doc');
    // a bottom tab bar: a full-width nav / footer along the app's bottom edge (the window then needs no fade of its own);
    // else (round 5) any block of controls that stays put along the bottom: Messenger's filter rows, Notes' vault
    // footer, a composer. One that went away (a thread opened over the list) is let go and looked for again.
    let bar = d.querySelector('[data-wos-inset-bar]');
    if (bar && !bar.getClientRects().length) { bar.removeAttribute('data-wos-inset-bar'); bar.removeAttribute('data-wos-lift'); bar = null; }
    const vw = d.documentElement.clientWidth, vh = d.documentElement.clientHeight;
    if (fi && !bar?.isConnected && vw && vh) {
      for (let n = d.elementFromPoint(vw / 2, vh - 3); n && n !== d.body && n !== d.documentElement; n = n.parentElement) {
        const r = n.getBoundingClientRect();
        if (r.width >= vw * .8 && r.height < 160 && r.bottom >= vh - 2 && (/^(NAV|FOOTER)$/.test(n.tagName) || /^(navigation|tablist)$/.test(n.getAttribute('role') || ''))) { bar = n; n.setAttribute('data-wos-inset-bar', ''); break; }
      }
      // (round 14) a full-width footer along the bottom that something else covers at the probe point (Wisdom's reader:
      // its page count and time left sat in the orb's row, under its body's flow): found by what it is, lifted the same
      if (!bar) { try { bar = [...d.querySelectorAll('nav, footer, [role="navigation"], [role="tablist"]')].find(n => { const r = n.getBoundingClientRect(); return r.width >= vw * .8 && r.height > 0 && r.height < 160 && r.bottom >= vh - 2 && r.bottom <= vh + 2 && shownIn(d, n); }) || null; if (bar) bar.setAttribute('data-wos-inset-bar', ''); } catch (_) { bar = null; } }
      // a block found this way is never a tab bar: it is lifted above the orb's row (data-wos-lift set from the start)
      if (!bar) { try { bar = bottomBar(d, vw, vh); } catch (_) { bar = null; } }
      // round 6: else a narrower block of controls right under the orb (a pane's composer beside a list)
      if (!bar) { try { const o0 = frameOrb?.(), r0 = f.getBoundingClientRect(), at = o0 && r0.width ? (o0.x - r0.left) / vw : -1; if (at > 0 && at < 1) bar = bottomBar(d, vw, vh, at); } catch (_) { bar = null; } }
      if (bar && !bar.hasAttribute('data-wos-inset-bar')) { bar.setAttribute('data-wos-lift', bar.matches(CONTROLS) ? 'self' : 'block'); bar.setAttribute('data-wos-inset-bar', ''); }
      if (bar) floatsOver(d, bar, vw);
    }
    // a list that scrolls under the orb without a kit scroll area (Mail): room after its last item too
    const sc = fi && !bar && !doc && !d.querySelector('.wz-scroll') && vw && vh ? mainScroller(d, vw, vh) : null;
    for (const n of d.querySelectorAll('[data-wos-inset-scroll]')) if (n !== sc) n.removeAttribute('data-wos-inset-scroll');
    if (sc && sc.getBoundingClientRect().bottom > vh - fi) sc.setAttribute('data-wos-inset-scroll', '');
    if (!fi) d.querySelector('[data-wos-inset-bar]')?.removeAttribute('data-wos-inset-bar');
    // the orb bar: the orb sits over this frame's bottom centre (a full-screen app under a view's orb), so the bar's tabs
    // go either side of it, on its row; else (no orb there, no tabs) the lifted bar above
    let split = false, spot = null;
    if (fi && bar?.isConnected) {
      let o = null; try { o = frameOrb?.(); } catch (_) {}
      const fr = f.getBoundingClientRect(), cy = o ? fr.bottom - o.y : 0;
      // the frame spans the screen (an app alone on its desk; its desk may still be sliding in) and the orb is centred
      const vwTop = globalThis.innerWidth || fr.width;
      // (or, on the desktop, a frame filling the page beside a sidebar with the view's orb centred over it: AI apps)
      if (o && o.d > 0 && cy > o.d / 2 && cy < 160 && (fr.width >= vwTop * .9 && Math.abs(vwTop / 2 - o.x) < 8 || fr.width >= vwTop * .6 && Math.abs(fr.left + fr.width / 2 - o.x) < 8)) {
        d.documentElement.style.setProperty('--wos-orb-cy', Math.round(cy) + 'px');
        d.documentElement.style.setProperty('--wos-orb-slot', Math.round(o.d + 16) + 'px');
        // tabs go either side of the orb only on a real tab bar (a nav / footer / tablist) with no field in it; a
        // composer or any other block of controls is lifted above the orb's row instead, its own surface running on
        // under the orb, so the two read as one bar (Miguel, round 5: never the orb layered over an app's controls)
        split = !/^(block|self)$/.test(bar.getAttribute('data-wos-lift') || '') && isTabBar(bar) && !hasEntry(d, bar) && orbTabs(d, bar, d.documentElement.clientWidth);
        // round 6: any other bar keeps its place and the orb takes the end of its lowest row (no band under the app)
        if (!split) { try { spot = orbEnd(d, bar, o, fr); } catch (_) { spot = null; } }
        else spot = { x: o.x, y: o.y, d: o.d, split: true };
      }
    }
    if (!spot) { clearEnd(d); d.documentElement.classList.remove('wos-orb-end'); }
    // kept in the frame's own coordinates: a desk still sliding in when this ran is placed where it comes to rest
    { const r0 = f.getBoundingClientRect(); frameSpots.set(f, spot && !spot.split ? Object.freeze({ fx: spot.x - r0.left, fy: spot.y - r0.top, d: spot.d }) : null); }
    if (bar?.isConnected && !/^(block|self)$/.test(bar.getAttribute('data-wos-lift') || '')) setAttr(bar, 'data-wos-lift', fi && !split ? '' : null);
    if (!fi || split) for (const n of d.querySelectorAll('[data-wos-float]')) n.removeAttribute('data-wos-float');
    if (!split) for (const n of d.querySelectorAll(WOS_MARKED)) unmark(n);
    if (d.documentElement.classList.contains('wos-orb-bar') !== split) d.documentElement.classList.toggle('wos-orb-bar', split);
    // with the split in place (its CSS applied), share each side by what the labels need; again once the app's fonts load
    if (split) {
      try { const row = d.querySelector('[data-wos-tabs]'); if (row) fitTabs(d, row); } catch (_) {}
      if (!insetFonts.has(d) && d.fonts?.ready) { insetFonts.add(d); d.fonts.ready.then(() => { if (frameInset && f.isConnected && f.contentDocument === d) insetFrame(f); }, () => {}); }
    }
    f.closest('.win')?.classList.toggle('wos-inset-bar', !!fi && !!bar?.isConnected);
    placeSync();
  }
  /* Where the view's orb goes, the inset sync and the shell API a layout receives; core/skin-host-shellapi.js. */
  const { insetSync, placeSync, shellApi, bindLate: shellapiLate } = window.WizCore.skinHostParts.shellapi({ appLogo, chatArchiveOrders, chatListOwners, chatsClaimed, emptyHomes, escapeSurfaces, frameSpots, guard, insetFrame, insetHolders, insetOrbs, insetPlaces, isDoc, openRoutes, panelSync, skinHostVars, storeApps });
  layoutLate({ insetSync, placeSync });
  /* The Add to home screen app, notification rows and the orb swipe map: core/skin-host-rows.js (moved verbatim, wizard-ux issue 1665). */
  const { activityRows, commandUis, homeScreenApp, inboxAct, keyGuides, keyHandlers, NOTE_ACTS, NOTE_ID, NOTE_ID_OPEN, noteAct, orbSwipeHolders, orbSwipeMap, orbTaps, panelHolders, readReadyOrder, readWorkingOrder, READY_ORDER_KEY, SESSION_ACTS, withNoteRows, bindLate: rowsLate } = window.WizCore.skinHostParts.rows({ isDoc });
  shellapiLate({ activityRows, commandUis, homeScreenApp, inboxAct, keyGuides, keyHandlers, NOTE_ACTS, NOTE_ID, NOTE_ID_OPEN, noteAct, orbSwipeHolders, orbSwipeMap, orbTaps, panelHolders, readReadyOrder, readWorkingOrder, READY_ORDER_KEY, SESSION_ACTS, withNoteRows });
  let panelOn = false, panelHold = 0;
  function panelSync() {
    const on = [...panelHolders].some(l => !l.dead);
    if (!on && panelOn && panelHold) return;   // a tweak reload in flight: decide once it settles (see loadTweaks)
    if (on === panelOn) return; panelOn = on;
    try { shell?.panelMode?.(on); } catch (e) { try { console.warn('[layout] panel mode:', e); } catch (_) {} }
  }
  function setLayout(id, persist = true) {
    const next = layoutOf(id) ? id : 'classic';
    try { if (persist) { if (next === 'classic') localStorage.removeItem(LAYOUT_KEY); else localStorage.setItem(LAYOUT_KEY, next); } } catch (_) {}
    // Re-wearing a layout that owns the chats keeps the boot veil until it has mounted (it clears it itself, or fails).
    layoutId = next; if (!layoutOf(next)?.ownsChats) endBoot(); paintLayout(next);
    if (shell) loadLayout(next); else if (next === 'classic') { layoutSeq++; dispose(layoutRec, 'off'); }
    try { shell?.relayout?.(); } catch (_) {}
    return next;
  }

  /* My skin supplies hashed bytes, never a service URL. Check consent again after waiting for the
   * package; generations cancel stale/revoked loads. Blob import executes only the verified bytes. */
  // A broken owner script switches itself off and names its file (spec SKINS_AND_VIEWS §2): the error is kept
  // for Settings, the owner hears it once, and wos:personal-error lets My skin revoke the approval so the next
  // load starts with the script off.
  let personalError = null;
  function personalFailed(file, e, notify = true) {
    const message = String((e && (e.message || e)) || 'error').split('\n')[0].slice(0, 160);
    personalError = { file, message };
    try { console.warn('[%s] turned off:', file, e); } catch (_) {}
    if (notify) try { shell && shell.toast(`${file} turned off · ${message}`); } catch (_) {}
    try { window.dispatchEvent?.(new CustomEvent('wos:personal-error', { detail: { ...personalError } })); } catch (_) {}
  }
  // The look-only switch turned on or off: stop both skin script layers now, or bring the skin package's back.
  // My skin hears wos:look-only and restarts its approved personal script itself.
  function setLookOnly(on) {
    if (on === lookOnly) return;
    lookOnly = on;
    if (on) { loadSeq++; unload('look-only'); personalSeq++; dispose(personal, 'look-only'); }
    else if (shell && committedId) packageReady = load(committedId);
    try { window.dispatchEvent?.(new Event('wos:look-only')); } catch (_) {}
  }
  async function loadPersonal(bytes, allowed, file = 'Skins/My skin/skin.js') {
    const seq = ++personalSeq;
    dispose(personal, 'replace'); personalError = null;
    let pending; do { pending = packageReady; await pending; } while (pending !== packageReady);
    if (seq !== personalSeq || !shell || lookOnly || disabled.has('my-skin') || !allowed()) return false;
    const href = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
    let mod;
    try { mod = await importer(href); }
    catch (e) { if (seq === personalSeq) personalFailed(file, e); return false; }
    finally { URL.revokeObjectURL(href); }
    if (seq !== personalSeq || lookOnly || !allowed()) return false;
    if (typeof mod?.default !== 'function') { personalFailed(file, new Error('no export default function setup(api)')); return false; }
    const a = record('my-skin', file); personal = a;
    try { a.teardown = mod.default(makeApi(a)); } catch (e) { dispose(a, 'error'); personalFailed(file, e); return false; }
    lastRoute = ''; emitRoute();
    return personal === a;
  }
  function release(id) { if (backClaims.delete(id)) claimAt = clock(); claims.delete(id); for (const l of layers()) l.claims.delete(id); }
  function startBuiltin(name) {
    const d = builtinDefs.get(name); if (!d || !shell || builtins.has('core:' + name) || disabled.has('core:' + name)) return false;
    if (d.when === 'touch' && !env().touch) return false;
    const a = record('core:' + name, d.label); builtins.set(a.id, a);
    try { a.teardown = d.setup(d.capabilities ? { ...makeApi(a), ...tweakApi(a, { capabilities: d.capabilities }, true) } : makeApi(a)); } catch (e) { fault(a, 'setup', e); }
    lastRoute = ''; emitRoute();
    return builtins.get(a.id) === a;
  }
  /* The owner-script lint and the reply summary setting: core/skin-host-summary.js (moved verbatim, wizard-ux issue 1665). */
  const { homeHtml, inboxThreads, interceptors, overlays, REPLY_LENGTHS, replySummary, scriptProblem, snoozeLast, summaryUsers, tweaks } = window.WizCore.skinHostParts.summary({  });
  apiLate({ tweaks });
  layoutLate({ tweaks });
  shellapiLate({ overlays });
  rowsLate({ inboxThreads });
  let tweakSeq = 0, slotContract = null;
  const safeTweakId = id => /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id);
  const tweakUrl = (id, file) => stamp(new URL(`tweaks/${id}/${file}`, document.baseURI).href);
  /* Tweaks paint once, not twice: the ids this device last wore are listed on <html> and their stylesheets are in <head>
   * (render-blocking) from the first frame, so stock Home never flashes before a package's own view. A package that
   * does not come back drops out of the list. Reapplying adds the new <link> before the old one goes (no unstyled gap). */
  const EXPECT_KEY = 'wos.tweaks.expect';
  const BOOT_GUESS_MS = 20000;
  let tweaksAsked = false;  // set once the experience asks for the real list; until then the boot preload is a guess
  /* A tweak's stylesheet, the API a tweak receives and loading every tweak; core/skin-host-tweaks.js. */
  const { bounded, cssReady, expected, loadTweaks, paintTweaks, preCss, tweakApi, tweakCss } = window.WizCore.skinHostParts.tweaks({ fault, guard, inboxThreads, interceptors, isDoc, layoutOf, loadTweaksNow, makeApi, overlays, panelSync, REPLY_LENGTHS, replySummary, safeTweakId, setLayout, skinHostVars, snoozeLast, summaryUsers, tweaks, tweakUrl });
  apiLate({ paintTweaks });
  async function loadTweaksNow(entries, contract, { teamAuthors = [], trustedAuthors = [] } = {}) {
    const seq = ++tweakSeq; slotContract = contract; tweaksAsked = true;
    const want = entries.filter(safeTweakId);
    setLookOnly(want.includes(LOOK_ONLY));
    for (const [id, l] of preCss) if (!want.includes(id)) { l.remove(); preCss.delete(id); }
    for (const id of want) tweakCss(id);
    expected.clear(); for (const id of want) expected.add(id);
    for (const a of [...tweaks.values()]) dispose(a, 'replace');
    tweaks.clear(); paintTweaks();
    if (!shell) return false;
    // Fetch every package at once (a slow network pays one wait, not one per package), and give a package that timed
    // out a second, longer try before turning it off: a slow wifi must not silently drop half of an owner's tweaks.
    const fetchPkg = async (id, ms) => {
      const response = await bounded(fetch(tweakUrl(id, 'manifest.json')), ms);  // release-stamped: cacheable
      if (!response.ok) throw new Error('Manifest unavailable');
      const m = await response.json();
      if (m.id !== id || m.author !== id.split('/')[0] || typeof m.version !== 'string' || !Array.isArray(m.capabilities) || m.capabilities.some(c => !['layout','nav','models','data.read','inbox','settings','notify','media'].includes(c))) throw new Error('Invalid manifest');
      if (m.apiVersion !== contract.apiVersion) throw new Error('Incompatible API version');
      const mod = await bounded(importer(tweakUrl(id, 'tweak.js')), ms);
      if (typeof mod.default !== 'function') throw new Error('Missing setup');
      return { m, mod };
    };
    const pkgs = new Map(want.map(id => [id, fetchPkg(id, 8000).catch(e => /timed out/i.test(e.message) ? fetchPkg(id, 30000) : Promise.reject(e))]));
    for (const p of pkgs.values()) p.catch(() => {});
    let slow = false;
    for (const id of want) {
      if (seq !== tweakSeq) return false;
      try {
        const { m, mod } = await pkgs.get(id);
        if (seq !== tweakSeq) return false;
        // CSS is optional; missing CSS is harmless. All package assets are same-origin build artifacts.
        const link = tweakCss(id); await cssReady(link);
        if (seq !== tweakSeq) return false;
        const a = record(id, m.name || id); tweaks.set(id, a);
        preCss.delete(id); if (link) a.offs.add(() => link.remove());
        paintTweaks();
        try {
          a.teardown = mod.default(tweakApi(a, m, teamAuthors.includes(m.author) || trustedAuthors.includes(m.author)));
          if (a.teardown && typeof a.teardown !== 'function') throw new Error('Setup must return teardown');
          if (a.ready) await a.ready;
          if (seq !== tweakSeq) return false;
        } catch (e) { dispose(a, 'error'); throw e; }
      } catch (e) {
        if (seq !== tweakSeq) return false;
        if (/timed out/i.test(e.message)) slow = true;
        expected.delete(id); const l = preCss.get(id); if (l) { l.remove(); preCss.delete(id); } paintTweaks(); shell?.toast?.(`${id} turned off · ${e.message}`);
      }
    }
    // A run cut short by the network keeps the full list for next time, so the next load still paints them at once.
    if (slow) { expected.clear(); try { localStorage.setItem(EXPECT_KEY, JSON.stringify(want)); } catch (_) {} paintTweaks(); lastRoute = ''; emitRoute(); window.dispatchEvent?.(new Event('wos:prefs')); return true; }
    expected.clear();
    // A layout stored on this device that no live tweak wears any more (switched off on another load) goes back to Classic.
    if (VIEW_LAYOUTS.has(layoutId) && standardLayout !== layoutId && !(layoutHolder && tweaks.has(layoutHolder))) setLayout('classic');
    try { localStorage.setItem(EXPECT_KEY, JSON.stringify([...tweaks].filter(([, a]) => !a.dead).map(([id]) => id))); } catch (_) {}
    paintTweaks(); lastRoute = ''; emitRoute(); window.dispatchEvent?.(new Event('wos:prefs')); return true;
  }
  /* The skin host object the shells call; core/skin-host-host.js. */
  window.WizCore.skinHostParts.host({ backClaims, BOOT_GUESS_MS, bootGiveUp, booting, builtinDefs, builtins, chatArchiveOrders, chatListOwners, chatsClaimed, claims, clock, commandUis, cssLinks, disabled, dispose, emit, emitBeside, emitRoute, emptyHomes, ensureCss, env, escapeSurfaces, EXPECT_KEY, expected, homeHtml, inboxThreads, interceptors, isDoc, keyGuides, keyHandlers, layers, LAYOUT_KEY, layoutOf, LAYOUTS, levels, load, loadLayout, loadPersonal, loadTweaks, LOOK_ONLY, NOTE_ID, openRoutes, orbSwipeHolders, orbTaps, overlays, paintLayout, paintTweaks, panelHolders, preCss, release, REPLY_LENGTHS, replySummary, requested, safeTweakId, scriptProblem, setLayout, skinHostVars, snoozeLast, startBoot, startBuiltin, taps, tweakCss, tweaks, unload });
})();
