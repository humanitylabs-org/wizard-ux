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
  function fault(a, where, e) {
    if (!a || a.dead) return;
    layoutDiagnostic(a.id, 'callback-error', where, e);
    try { console.warn(`[skin ${a.id}] ${where}:`, e); } catch (_) {}
    const now = Date.now(); a.errs = a.errs.filter(t => now - t < ERR_WINDOW); a.errs.push(now);
    // A layout is the owner's navigation, not an optional gesture script. Never
    // tear down its Chats/sidebar, panel claims or routes for a callback failure.
    // guard contains this invocation; the hook can recover on the next event.
    // Keep the existing breaker for My skin, colour-skin scripts and tweaks.
    if (String(a.id).startsWith('layout:')) { a.errs = a.errs.slice(-ERR_LIMIT); return; }
    if (a.errs.length >= ERR_LIMIT) {
      const wasTweak = tweaks.has(a.id); disabled.add(a.id); dispose(a, 'error', e, where); if (wasTweak) { paintTweaks(); window.dispatchEvent?.(new Event('wos:experience')); }
      try { shell && shell.toast(`${a.label || nameOf(a.id)} gestures turned off after an error`); } catch (_) {}
      if (a.id === 'my-skin') personalFailed(a.label, e, false); // the toast above already named the file
    }
  }
  const nameOf = id => ((typeof window !== 'undefined' && window.WosSkin?.list?.find(s => s.id === id)) || {}).name || id;
  const guard = (a, where, fn) => function () { if (a.dead) return; try { return fn.apply(this, arguments); } catch (e) { fault(a, where, e); } };

  /* ---------- the API a skin script receives ---------- */
  function makeApi(a) {
    const E = env();
    const need = () => { if (!shell) throw new Error('shell not ready'); return shell; };
    const api = {
      env: E,
      route: () => routeOf(),
      on(type, fn) {
        if (!EVENTS.includes(type) || typeof fn !== 'function') throw new Error(`unknown skin event ${type}`);
        const g = guard(a, `on(${type})`, fn); a.on[type].add(g);
        return () => a.on[type].delete(g);
      },
      nav: Object.freeze({
        back: () => !!need().back(),          // the shell's own Back step; never exits, never touches history
        openList: () => { need().openList(); },
        openThread: id => { if (typeof id === 'string' && id) need().openThread(id); },
        goDesk: i => { const s = need(), n = s.deskCount(); s.goDesk(Math.max(0, Math.min(n - 1, i | 0))); },
        deskCount: () => need().deskCount(),
      }),
      part(name) {
        if (!shell) return null;
        if (name === 'dock') return shell.dock();
        const root = shell.root(); if (!root) return null;
        return root.querySelector(`[data-part="${String(name).replace(/[^a-z-]/g, '')}"]`) ? root : null;
      },
      listen(target, type, fn, opts) {
        if (!target || typeof target.addEventListener !== 'function') return () => {};
        const g = guard(a, `listen(${type})`, fn);
        target.addEventListener(type, g, opts);
        const off = () => { target.removeEventListener(type, g, opts); a.offs.delete(off); };
        a.offs.add(off); return off;
      },
      frame(fn) {
        const g = guard(a, 'frame', fn);
        const h = { id: 0 };
        h.id = requestAnimationFrame(t => { a.frames.delete(h); g(t); });
        a.frames.add(h);
        return () => { cancelAnimationFrame(h.id); a.frames.delete(h); };
      },
      gesture: Object.freeze({
        // Claim a pointer before the shell's dock swipe locks direction. False once the shell owns it.
        claim: (pointerId, { backSwipe = false } = {}) => { if (shell && shell.locked && shell.locked(pointerId)) return false; claims.add(pointerId); a.claims.add(pointerId); if (backSwipe) { backClaims.add(pointerId); claimAt = clock(); } return true; },
        // The shell's one swipe threshold (core/swipe-intent.js): true for an intentional sideways swipe either way.
        intent: (dx, dy, ms) => { const w = typeof window !== 'undefined' && window.WosSwipeIntent; return !!(w && w.intentional(+dx || 0, +dy || 0, +ms || 0)); },
      }),
      toast: msg => { try { need().toast(String(msg).slice(0, 140)); } catch (e) { fault(a, 'toast', e); } },
      /* A file shipped in the layout's own folder (e.g. an orb page); null for skins. */
      asset: name => String(a.id).startsWith('layout:') && /^[a-z0-9][a-z0-9._-]*$/i.test(String(name)) && !String(name).includes('..')
        ? layoutUrl(String(a.id).slice(7), String(name)) : null,
      /* A timer that dies with the layer. */
      after(ms, fn) {
        const g = guard(a, 'after', fn); const h = { id: 0 };
        h.id = setTimeout(() => { a.frames.delete(h); g(); }, Math.max(0, Math.min(10000, ms | 0)));
        h.clear = () => clearTimeout(h.id); a.frames.add(h);
        return () => { clearTimeout(h.id); a.frames.delete(h); };
      },
      /* Own controls: a node appended to the device, removed on teardown. */
      mount(node) {
        // The phone's #device; the desktop hands over its stage (no #device there).
        const host = isDoc && (document.getElementById('device') || shell?.mountHost?.()); if (!host || !node || node.nodeType !== 1) return () => {};
        host.appendChild(node); a.mounts.add(node);
        return () => { node.remove(); a.mounts.delete(node); };
      },
      /* Agents: who can receive a message, and who the screen in front routes to. */
      agents: Object.freeze({
        list: () => shell?.agents ? shell.agents().map(x => Object.freeze({ ...x })) : [],
        here: () => shell?.agentHere ? Object.freeze({ ...shell.agentHere() }) : null,
        sigil: id => shell?.agentSigil ? shell.agentSigil(id) : null,
        open: id => { if (typeof id === 'string' && id) need().openAgent?.(id); },
        /* The agent choices of a layout that draws its own chat list: { id (the agent the main Chats is focused on, '' = All),
         * agents [{ id, label, colour, private, main }] } and focus(id) = Chats' own Focus on that agent ('' = All). */
        focus: () => { const f = shell ? shell.agentFocus?.() : null; return Object.freeze({ id: typeof f?.id === 'string' ? f.id : '', space: f?.space === true, agents: Object.freeze((Array.isArray(f?.agents) ? f.agents : []).map(x => Object.freeze({ ...x }))) }); },
        setFocus: id => shell?.agentFocusSet ? !!shell.agentFocusSet(typeof id === 'string' ? id : '') : false,
      }),
      /* Voice: the orb's own recorder. talk(agent) records a message for that agent (none = the screen's own);
       * tap() is the orb's tap on a running take (send / resume); dictate() types into the focused field. */
      voice: Object.freeze({
        state: () => shell?.voiceState ? Object.freeze({ ...shell.voiceState() }) : { state: 'idle' },
        talk: id => need().talk(typeof id === 'string' ? id : ''),
        tap: () => need().voiceTap(),
        dictate: () => !!need().dictate(),
        cancel: () => need().voiceCancel?.(),
      }),
      /* The app in front may claim the agent orb as its main button (WizardApp.orb.claim). */
      app: Object.freeze({
        orb: () => shell?.appOrb ? shell.appOrb() : null,
        tap: () => !!shell?.appOrbTap?.(),
      }),
      orb: Object.freeze({
        /* The dock orb's idle tap: fn() returns true to replace the shell's own talk. */
        onTap(fn) { const g = guard(a, 'orb.onTap', fn); a.taps.add(g); taps.add(g); return () => { a.taps.delete(g); taps.delete(g); }; },
        /* The microphone level the dock orb shows (0..1), for a layout drawing its own orb. */
        /* Draw another of the shell's own orb (the Wizard Everywhere orb, orb.js) on a layout's canvas. */
        create(canvas, fallback, opts) {
          if (!canvas || canvas.tagName !== 'CANVAS' || typeof window.Orb?.create !== 'function') return null;
          const o = window.Orb.create(canvas, fallback || document.createElement('img'), { R: Number(opts?.R) || .64 });
          a.orbs.add(o); return o;
        },
        onLevel(fn) { const g = guard(a, 'orb.onLevel', fn); a.levels.add(g); levels.add(g); return () => { a.levels.delete(g); levels.delete(g); }; },
        /* Resolves true once window.Orb exists. The desktop page doesn't load orb.js; this loads it once, on demand. */
        ready: () => loadOrb(),
      }),
      /* Now playing (core/media-watch.js): what the installed apps play, newest first ([{ key, appId, app, kind, playing,
       * title, artist }]), and pausing it. watch(fn) arms the watcher (nothing is watched while nobody holds it) and is
       * released on teardown; { passive: true } only listens while someone else holds it. icon(appId) = the shell's own
       * app mark (a fresh node), open(appId) = bring that app to the front. */
      media: Object.freeze({
        list: () => mediaList(a),
        watch(fn, { passive = false } = {}) {
          const M = isDoc && window.WosMedia; if (a.dead || !M || typeof fn !== 'function') return () => {};
          const g = guard(a, 'media.watch', () => fn(mediaList(a)));
          const off0 = M.watch(g, { passive: passive === true });
          const off = () => { off0(); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        pause: key => !a.dead && !!(isDoc && window.WosMedia?.pause(String(key))),
        play: key => !a.dead && !!(isDoc && window.WosMedia?.play(String(key))),
        pauseAll: () => !a.dead && !!(isDoc && window.WosMedia?.pauseAll()),
        toggle: () => !a.dead && !!(isDoc && window.WosMedia?.toggle()),
        icon(id) {
          const h = !a.dead && typeof id === 'string' ? shell?.mediaApp?.(id)?.icon : '';
          if (!h || !isDoc) return null;
          const t = document.createElement('template'); t.innerHTML = String(h); return t.content.firstElementChild || null;
        },
        open: id => !a.dead && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && !!shell?.mediaOpen?.(id),
      }),
      storage: Object.freeze({
        get(key) { try { const v = localStorage.getItem(`wos.skin.${a.id}.${key}`); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
        set(key, value) { try { localStorage.setItem(`wos.skin.${a.id}.${key}`, JSON.stringify(value)); } catch (_) {} },
      }),
    };
    return Object.freeze(api);
  }

  // The Now playing list with each app's own name (the shell's catalog), for api.media.
  function mediaList(a) {
    const M = isDoc && window.WosMedia; if (!M || a.dead) return [];
    return M.list().map(x => Object.freeze({ ...x, app: String(shell?.mediaApp?.(x.appId)?.name || x.appId) }));
  }

  /* ---------- script lifecycle ---------- */
  function unload(reason) {
    dispose(active, reason);
  }
  // Both layers share the API, guards and cleanup. Unloading one leaves the other alive.
  function dispose(a, reason, error, where = 'dispose') {
    if (!a) return;
    layoutDiagnostic(a.id, reason, where, error);
    if (active === a) active = null;
    if (personal === a) personal = null;
    if (builtins.get(a.id) === a) builtins.delete(a.id);
    if (tweaks.get(a.id) === a) tweaks.delete(a.id);
    a.dead = true;
    if (typeof a.teardown === 'function') { try { a.teardown(reason); } catch (e) { try { console.warn(`[skin ${a.id}] teardown:`, e); } catch (_) {} } }
    for (const off of [...a.offs]) { try { off(); } catch (_) {} }
    for (const h of [...a.frames]) { try { h.clear ? h.clear() : cancelAnimationFrame(h.id); } catch (_) {} }
    for (const n of [...a.mounts]) { try { n.remove(); } catch (_) {} }
    for (const g of a.taps) taps.delete(g);
    for (const g of a.levels) levels.delete(g); a.levels.clear();
    for (const o of a.orbs) { try { o.sleep(true); } catch (_) {} } a.orbs.clear();
    if (layoutRec === a) layoutRec = null;
    a.offs.clear(); a.frames.clear(); a.mounts.clear(); a.taps.clear(); a.on.route.clear(); a.on.render.clear(); a.on.voice.clear(); a.on.sent.clear(); a.on.beside.clear(); a.on.home.clear();
    for (const id of a.claims) { if (!layers().some(l => l !== a && l.claims.has(id))) { claims.delete(id); backClaims.delete(id); if (!backClaims.size) claimAt = -Infinity; } }
    a.claims.clear();
  }

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

  const layers = () => [...builtins.values(), active, personal, layoutRec, ...tweaks.values()].filter(Boolean);
  function emit(type, payload) {
    for (const a of layers()) for (const fn of [...(a.on[type] || [])]) fn(payload);
  }
  function routeOf() {
    const r = shell ? shell.route() : { view: 'desk', thread: null, desk: 0 };
    return Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0, app: r.app || null, agent: r.agent || null, beside: Math.sign(r.beside | 0), home: !!r.home, panel: ['thread', 'list', 'app'].includes(r.panel) ? r.panel : null, panelList: !!r.panelList, panelApp: typeof r.panelApp === 'string' && r.panelApp ? r.panelApp : null });
  }
  /* The view bound beside a chat thread (app.js syncPeek): 1 = it leans in on the right of the thread, -1 = on that
   * view, its thread leans in on the left, 0 = none. Its own event, so route listeners never see extra calls. */
  let lastBeside = 0;
  function emitBeside() {
    const side = shell ? routeOf().beside : 0;
    if (side === lastBeside) return; lastBeside = side;
    if (layers().length) emit('beside', Object.freeze({ side }));
  }
  if (isDoc) window.addEventListener?.('wizard:app-orb', () => { if (layers().length) emit('render', Object.freeze({ part: 'app-orb', el: null })); });
  function emitRoute() {
    if (!layers().length || !shell) return;
    const r = routeOf(), k = `${r.view}|${r.thread || ''}|${r.desk}|${r.app || ''}|${r.agent || ''}|${r.home ? 1 : 0}|${r.panel || ''}|${r.panelList ? 1 : 0}|${r.panelApp || ''}`;
    if (k === lastRoute) return; lastRoute = k;
    emit('route', r);
    if (frameInset) insetSync();   // the app now in front may have drawn its bottom bar out of sight
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
    later(() => { if (booting() && layoutId === id) document.documentElement.dataset.layoutBooting = 'slow'; }, BOOT_SLOW_MS);
  }
  // The give-up clock starts at attach: before it there is no shell to mount the recovery, and the layout has not
  // even started loading (a slow parser can take longer than BOOT_GIVEUP_MS to reach desktop.js).
  function bootGiveUp(id) {
    const t = setTimeout(() => {
      if (!booting() || layoutId !== id) return;
      // Mounted but its sheet never answered: the layout's own DOM is there, so show it.
      if (layoutRec && !layoutRec.dead && layoutFailed !== id) return endBoot();
      // Still not mounted: give up on this load (a late import must not mount over the recovery) and recover.
      layoutSeq++; layoutLoadFailed(id, 'timeout');
    }, BOOT_GIVEUP_MS);
    try { t?.unref?.(); } catch (_) {}
  }
  function layoutLoadFailed(id, reason = 'unavailable', error) {
    if (layoutId !== id) return false;
    layoutDiagnostic('layout:' + id, 'load-failed', reason, error);
    layoutFailed = id; endBoot(); paintChatsOwner();
    try { shell?.ownsChatList?.(chatsClaimed()); } catch (_) {}
    // Keep the selected layout/choice. The shell can mount its shared Chats
    // sidebar without importing the failed bundle; never show Classic Desks.
    if (layoutOf(id)?.ownsChats) try { shell?.layoutRecovery?.(true); } catch (e) { layoutDiagnostic('layout:' + id, 'recovery-error', reason, e); }
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
  /* Where the view's orb goes (round 6): the spot the app in front gave it (the end of its bottom row), else its own
   * fixed spot (null). The app in front = the widest app frame that is on screen (a desk still sliding in is not yet). */
  let placed = null;
  function placeSync() {
    if (!isDoc || !insetPlaces.size) return;
    let best = null, bw = 0;
    const vw = globalThis.innerWidth || 0;
    if (frameInset) for (const f of document.querySelectorAll('.win iframe')) {
      const r = f.getBoundingClientRect(), w = f.closest('.win');
      if (!r.width || r.left < -8 || r.right > vw + 8 || !w || w.classList.contains('gone') || getComputedStyle(w).visibility === 'hidden') continue;
      if (r.width > bw) { best = f; bw = r.width; }
    }
    const fs = best ? frameSpots.get(best) || null : null, br = fs ? best.getBoundingClientRect() : null;
    const spot = fs ? { x: Math.round(br.left + fs.fx), y: Math.round(br.top + fs.fy), d: fs.d } : null;
    if (spot === placed || (spot && placed && spot.x === placed.x && spot.y === placed.y && spot.d === placed.d)) return; placed = spot;
    for (const fn of [...insetPlaces.values()]) { try { fn(spot); } catch (_) {} }
  }
  function insetSync() {
    frameInset = Math.max(0, ...insetHolders.values());
    frameOrb = [...insetOrbs.values()].pop() || null;
    if (isDoc) for (const f of document.querySelectorAll('.win iframe')) insetFrame(f);
    placeSync();
  }
  // an app fills its page after it loads: look again a little later (once its list is there)
  if (isDoc) document.addEventListener?.('load', e => { if (!frameInset || e.target?.tagName !== 'IFRAME') return; const f = e.target; insetFrame(f); for (const ms of [1500, 5000]) setTimeout(() => { if (frameInset) insetFrame(f); }, ms); }, true);
  // a turn of the phone moves the orb: lay the bars out around it again
  let insetResize = 0;
  if (isDoc) globalThis.addEventListener?.('resize', () => { if (!frameInset || insetResize) return; insetResize = setTimeout(() => { insetResize = 0; if (frameInset) insetSync(); }, 250); });
  function shellApi(a, base) {
    const live = () => !a.dead && !!shell;
    return {
      // The orb's recorder plus a local command take (the held orb / ⌥C); call command() again to finish it.
      voice: Object.freeze({ ...base.voice, command: () => live() ? shell.command?.() : undefined,
        // Layout-only: a layout-docked composer owns its mic even while a companion app has keyboard focus.
        reply: (wid, sid) => live() && typeof wid === 'string' && typeof sid === 'string' && sid && sid !== '__new__'
          ? shell.recordReply?.(wid, sid) : false,
        /* The layout draws the command take itself (its own orb state and caption): while held, a command take's
         * result comes to fn({ result: 'done' | 'miss' | 'silent' | 'kept', text, action, app, music }) instead of the
         * shell's toast, and the desktop's voice pill steps aside (html.voice-cmd). Released on teardown. */
        onCommand(fn) {
          if (!live() || typeof fn !== 'function') return () => {};
          const g = guard(a, 'voice.onCommand', fn); commandUis.add(g);
          const off = () => { commandUis.delete(g); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // Words sent on to the agent as a new chat (the launcher's own ask path), e.g. a command with no match.
        ask: text => live() && typeof text === 'string' && text.trim() ? !!shell.askAgent?.(text.trim().slice(0, 4000)) : false,
      }),
      /* Keys: down(e) sees every key the desktop gets (app frames included) before its own bindings and returns true
       * when it used it; up(e) sees releases. hold: true = the layout draws its own hold-⌥ overlay (the shell's hold
       * chips stay off; ⌥/ still pins the guide). guide(fn, { only }): fn() → [{ el, key, word, at, frame?, app?, name?, free? }] chips the hold-⌥ guide adds (frame: el
       * sits in that same-origin app frame; app: the app's own ⌥ key (data-wz-key), named by the app; free: a spot the layout knows is
       * empty, drawn without the hit test). */
      keys: Object.freeze({
        on({ down, up, hold = false } = {}) {
          if (!live()) return () => {};
          const h = { a, hold: !!hold, down: typeof down === 'function' ? guard(a, 'keys.down', down) : null, up: typeof up === 'function' ? guard(a, 'keys.up', up) : null };
          keyHandlers.add(h); const off = () => { keyHandlers.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // only: true = the hold-⌥ guide shows just this layout's chips (none of the desktop's own, no footer line)
        guide(fn, { only = false } = {}) {
          if (!live() || typeof fn !== 'function') return () => {};
          const g = guard(a, 'keys.guide', fn); g.only = only === true; keyGuides.add(g);
          const off = () => { keyGuides.delete(g); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      sessions: Object.freeze({
        ownList() {
          if (!live() || !shell.ownsChatList) return () => {};
          chatListOwners.add(a); shell.ownsChatList(true);
          const off = () => { chatListOwners.delete(a); a.offs.delete(off); shell.ownsChatList(chatsClaimed()); };
          a.offs.add(off); return off;
        },
        // Archive alone advances within the section the layout actually drew. Return its ordered
        // chat IDs for this row (empty = no neighbour), not a separately sorted session list.
        archiveOrder(fn) {
          if (!live() || typeof fn !== 'function') return () => {};
          chatArchiveOrders.set(a, guard(a, 'sessions.archiveOrder', fn));
          const off = () => { chatArchiveOrders.delete(a); a.offs.delete(off); };
          a.offs.add(off); return off;
        },
        // Ready also holds the notifications Chats shows (round 5, Miguel: the unified inbox's items, an app set to Chats
        // in Settings › Notifications included), as rows of their own (id 'notif:<id>', note: true) in Chats' own order:
        // the new ones among the chats by time, the snoozed ones (read) at the end; acted on through the inbox's handler.
        // (a focused agent's list carries no inbox notifications: they belong to All, as in Chats)
        // { activity: true } (Channels on, wizard-ux issue 1336): every agent's chats as Working, Ready, Recent (+ older:
        // how many more Show older adds; { older: true } lists them), Snoozed and Archive, in the one Activity sort;
        // unread notifications wait in Ready, read ones sit in Recent.
        list: opts => { if (opts?.activity === true && live() && shell.activityList) return activityRows(shell.activityList({ order: readReadyOrder(), older: opts.older === true }));
          const l = live() ? (opts?.focused === true && shell.sessionListFocused ? shell.sessionListFocused() : shell.sessionList?.()) : null; if (!l) return null; const o = structuredClone(l); o.ready = opts?.focused === true && shell.agentFocus?.().id ? (o.ready || []) : withNoteRows(o.ready || []); o.working = window.WizChatsListModel.workingSort(o.working, readWorkingOrder()); return o; },
        open: id => { if (!live() || typeof id !== 'string' || !id) return; if (id.startsWith(NOTE_ID)) inboxAct(NOTE_ID_OPEN, id.slice(NOTE_ID.length)); else shell.openThread(id); },
        // The thread's own actions, through Chats' own paths (the same as its row sheet): Snooze, Done (archive), Mark
        // unread, Restore, Pin (the Pins toggle) and Rename (Chats' rename sheet). list() rows say which apply.
        act: (id, action) => !live() || typeof id !== 'string' || !id ? false
          : id.startsWith(NOTE_ID) ? NOTE_ACTS.includes(action) && noteAct(id, action)
          : SESSION_ACTS.includes(action) ? !!shell.sessionAct?.(id, action) : false,
        openList: kind => { if (live() && (kind === 'working' || kind === 'ready')) shell.openSessions?.(kind); },
        // Ready's order (the AI apps view, round 18): the stock Chats Filter's own saved choice (wos.chats.readyOrder.v1,
        // shared across devices through the box preferences, like Chats' own buttons), so both views always agree.
        workingOrder: () => readWorkingOrder(),
        setWorkingOrder: o => {
          return live() ? !!window.WizLive?.setWorkingOrder?.(o) : false;
        },
        order: () => readReadyOrder(),
        setOrder: o => {
          if (!live() || !['newest', 'oldest', 'priority'].includes(o)) return false;
          try { localStorage.setItem(READY_ORDER_KEY, o); } catch (_) {}
          try { window.WizLive?.putPrefs?.({ readyOrder: o }); } catch (_) {}
          window.dispatchEvent?.(new Event('wos:prefs')); return true;
        },
        // The Chats window as it is (its thread kept), and a New chat in it: the AI apps view's main screen.
        chats: () => live() ? !!shell.showChats?.() : false,
        newChat: () => live() ? !!shell.newChat?.() : false,
        /* Channels (wizard/chat-channels, wizard-ux issue 1256): Chats' own Channels pane for the main Chats window,
         * painted into node (one of this layout's mounted nodes): the Activity / Channels tabs, the channel list, a
         * channel's feed and its message box. Call it again to repaint; true while it shows anything (switch on). */
        channels: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? !!shell.chatChannels?.(node) : false,
        // Back from a channel's feed to the Channels list (thread → channel → list); false when no feed is open.
        channelBack: () => live() ? !!shell.chatChannelBack?.() : false,
        /* A channel's feed in the layout's main chat column (wizard-ux issue 1256, James 11 Nov 2026: the channel list stays
         * in the sidebar): its header, filters, posts and message box painted into node (one of this layout's mounted
         * nodes). Returns the open channel ({ id, name }), or null with none open (the node is emptied). */
        channelFeed: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? shell.chatFeed?.(node) || null : null,
        // The channel whose feed is open in the main column ({ id, name }), or null.
        channelFeedOpen: () => live() ? shell.chatFeedOpen?.() || null : null,
        // New chat with a channel's feed in front (wizard-ux issue 1291): its own box takes the post (true), never General.
        channelPost: () => live() ? !!shell.chatChannelPost?.() : false,
        /* Kept for layouts built against it: always false now. + / ⌥N on the Channels list start a new chat; only the list's
         * own + New channel row makes a channel (wizard-ux issue 1489, which reverses the + part of issue 1308). */
        channelNew: () => false,
        // The Chats list's tab: 'activity' or 'channels' ('' with the switch off). It decides what + does (issue 1310).
        channelView: () => live() ? shell.chatChannelView?.() || '' : '',
        /* The owner's Default Chats look (Settings › Chats, switch wizard/sidebar-chats-view, wizard-ux issue 1443): that
         * installed provider's list painted into node (one of this layout's mounted nodes), its taps opening threads in
         * the main chat. True while it owns the node; false (node emptied) for built-in Chats, the switch off or a
         * failed provider, and the layout draws its own rows. 'wos:chats-view' asks for a repaint. */
        chatsView: node => live() && node?.nodeType === 1 && [...a.mounts].some(m => m.contains(node)) ? !!shell.chatsView?.(node) : false,
      }),
      /* Workspaces: this Wizard first (the one on this screen), then the Wizards the owner manages (the devices registry,
       * the same list as the network map's switcher; not connected yet). refresh() reads the registry again. */
      workspaces: Object.freeze({
        list: () => {
          if (!live() || !isDoc) return [];
          const d = window.WosResources?.state?.devices || {}, txt = (v, n) => String(v || '').slice(0, n);
          const own = txt(d.this?.wizard, 60) || (window.WizConfig?.agent?.() || 'Wizard');
          return [Object.freeze({ id: 'this', name: own, org: '', current: true, owner: txt(window.WizConfig?.owner?.(), 60) }),
            ...(Array.isArray(d.managed) ? d.managed : []).filter(m => m && m.id).map(m => Object.freeze({ id: txt(m.id, 64), name: txt(m.name, 60) || txt(m.id, 60), org: txt(m.org, 60), ...(/^https?:\/\//i.test(m.url || '') ? { url: txt(m.url, 2048) } : {}), current: false }))];
        },
        refresh: () => { if (live()) try { window.WosResources?.sync?.(); } catch (_) {} },
      }),
      /* AI usage (read only): the feed's accounts as Settings › AI shows them, the default model's provider, and live(el)
       * to keep the feed polling while el is on screen (the AI apps view's fuel gauge, 4 Nov 2026). */
      aiUsage: Object.freeze({
        state: () => { if (!live()) return {}; const r = window.WosResources?.state || {}; return structuredClone({ ai: r.ai || null, aiError: r.aiError || '' }); },
        provider: () => live() ? String(window.WosModels?.defaultOption?.()?.provider || '') : '',
        live: el => { if (live() && el?.nodeType === 1) try { window.WosResources?.watch?.(el); } catch (_) {} },
      }),
      apps: Object.freeze({
        back: id => live() && typeof id === 'string' ? !!shell.appBack?.(id) : false,
        list: () => { const l = live() ? shell.apps?.() : null; return Array.isArray(l) ? structuredClone(l) : []; },
        open: id => live() && typeof id === 'string' && id ? !!shell.openApp?.(id) : false,
        // Open it on a desk of its own (the Apps and Orb views' + sheet: one app per desk). The phone already gives a
        // new app its own desk; the desktop adapter starts a fresh desk for it (openAppDesk).
        // An installed app with no page yet (an app tile in kinds without a window, ux#1505) shows its settings sheet.
        openDesk: (id, place = null) => live() && typeof id === 'string' && id ? !!(shell.openAppDesk ? shell.openAppDesk(id, typeof place === 'function' ? place : null) : shell.openApp?.(id))
          || !!shell.openAnyApp?.(id, () => false) : false,
        // Add to home screen: the Desks' own hold on an app tile (core/home-screen-apps.js, its sheet and its checks), for a
        // layout's own app icons (the AI apps view's Home, round 7). can(id) says whether that app may be offered.
        homeScreen: Object.freeze({
          can: id => live() && !!homeScreenApp(id),
          offer: id => { const x = live() ? homeScreenApp(id) : null; return x ? !!window.WizHomeScreenApps.offer(x) : false; },
        }),
        // Close the app everywhere it is open (its desk goes; the Orb panel quits it). Chats always stays.
        close: id => live() && typeof id === 'string' && id && id !== 'wizard' ? !!shell.closeApp?.(id) : false,
        /* Not installed yet: the App Store's Apps this Wizard lacks ([{ id, name, summary }], a Promise), and get(id),
         * which opens that app's page in the App Store window (its own Get; once installed it opens right away). */
        store: () => live() ? storeApps(shell.apps?.()?.map(x => x.id) || []) : Promise.resolve([]),
        get: id => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? !!shell.openStore?.(id) : false,
        /* Room the layout's floating orb takes at the bottom of app windows (px); released on teardown. orb(), when given,
         * says where that orb is ({ x, y, d }: its centre and size, viewport px): an app's own bottom tab bar is then
         * laid out around it (the orb bar: tabs split left and right of the orb, on its row), else lifted above it. */
        /* place(spot), when given (round 6), is told where the app in front wants the orb: { x, y, d } (the end of its
         * bottom row of controls, viewport px, the orb's size there), or null = the orb's own fixed spot. */
        inset(px, orb = null, place = null) {
          if (!live()) return () => {};
          insetHolders.set(a, Math.max(0, Math.min(240, +px || 0)));
          if (typeof orb === 'function') insetOrbs.set(a, () => { const o = orb(); return o && [o.x, o.y, o.d].every(Number.isFinite) ? { x: +o.x, y: +o.y, d: +o.d } : null; }); else insetOrbs.delete(a);
          if (typeof place === 'function') { insetPlaces.set(a, guard(a, 'apps.inset place', place)); placed = undefined; } else insetPlaces.delete(a);
          insetSync();
          const off = () => { insetHolders.delete(a); insetOrbs.delete(a); insetPlaces.delete(a); a.offs.delete(off); insetSync(); }; a.offs.add(off); return off;
        },
        all: () => { if (live()) shell.openPicker?.(); },
        /* One place for every open the shell starts by itself (the AI apps view, round 21: apps and links on the right,
         * chats an app starts on the left). While held, open(kind, detail, go) is asked first and returns true when it
         * placed it: 'app' { id, path } (a notification's Open, a launcher, a command, a chat's app button), 'link'
         * { url, title, app } (a link tapped in a reply; app = the installed app that owns it, else ''), 'draft'
         * { from } (an app's Reply on an item), 'thread' { sid, from } (an app opening a chat) and 'beside' { url } (the
         * view a reply binds beside its thread; true = none). go() runs the shell's own way for it; drafts and threads go
         * to the main Chats wherever it is. shows(desk) says whether the layout shows that desk's app on screen (an app's
         * Reply is admitted there). Released on teardown; nobody holding it = stock, byte for byte. */
        routeOpens({ open, shows } = {}) {
          if (!live() || typeof open !== 'function') return () => {};
          const h = { a, open: guard(a, 'apps.routeOpens', open), shows: typeof shows === 'function' ? guard(a, 'apps.routeOpens shows', shows) : null };
          openRoutes.add(h); const off = () => { openRoutes.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        // Take the open window of an installed app to one of its own pages (same origin, a path that app owns); false when
        // it has no window. And one link page (no app owns it) on a desk of its own, reused: the view's right panel.
        path: (id, path) => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && typeof path === 'string' && path ? !!shell.showAppPath?.(id, path) : false,
        openLink: (url, title = '') => live() && typeof url === 'string' && url ? !!shell.openLinkDesk?.(url, String(title || '').slice(0, 80)) : false,
        /* Every app by kind, as the launcher groups them (core/app-kinds.js): { apps, wiz (agent apps), agents, conns
         * (connectors), dev } of { id, name, icon, system }; null on a shell without kinds. openAny(id) opens any of them
         * like openDesk (an agent app with no screen shows its settings sheet). */
        kinds: () => { const k = live() ? shell.appKinds?.() : null; return k ? structuredClone(k) : null; },
        openAny: id => live() && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && shell.openAnyApp
          ? !!shell.openAnyApp(id, x => !!(shell.openAppDesk ? shell.openAppDesk(x) : shell.openApp?.(x))) : false,
        // The shell's own search & launch (⌥Space / ⌘K), never a second search box.
        search: () => { if (live()) shell.openPalette?.(); },
        // The app's own logo (the Store's read-only logo route), as a local URL; null when it has none.
        logo: id => live() ? appLogo(id) : Promise.resolve(null),
        /* The apps' count badges: the same counts the shell puts on desk marks and the dock (WizCore.workspaceNav:
         * Chats' unread threads, Notifications, and what each running app reports through WizardApp badge). Read-only
         * { id: n } (n > 0 only); watch(fn) is called again whenever one changes and is released on teardown. */
        // The badge text as the shell shows it ('50+' for an app that lists only its newest items); '' when none.
        badgeText: id => live() && isDoc ? String(window.WizCore?.workspaceNav?.label?.(String(id)) || '') : '',
        badges(watch) {
          const read = () => { const c = isDoc ? window.WizCore?.workspaceNav?.counts : null, o = {}; if (c) for (const [k, v] of Object.entries(c)) if (v > 0) o[k] = v | 0; return Object.freeze(o); };
          if (live() && typeof watch === 'function' && isDoc) {
            const g = guard(a, 'badges', watch), h = () => { if (live()) g(read()); };
            window.addEventListener('wizard:app-counts', h);
            const off = () => { window.removeEventListener('wizard:app-counts', h); a.offs.delete(off); }; a.offs.add(off);
          }
          return live() ? read() : Object.freeze({});
        },
      }),
      desk: Object.freeze({
        home: () => { if (live()) shell.home?.(); },
        look: () => { if (live()) shell.openSettings?.('look'); },
        // Settings (a page id such as 'network', or its first page).
        settings: page => { if (live()) shell.openSettings?.(typeof page === 'string' && /^[a-z-]{1,24}$/.test(page) ? page : undefined); },
        /* What the Settings cog carries (WosBell.attention, the same count as the phone's gear and the desktop's cog):
         * read-only { n, label } or null; watch(fn) is called again when it changes and is released on teardown. */
        attention(watch) {
          const read = () => { const at = isDoc ? window.WosBell?.attention?.() : null, n = Math.max(0, Math.min(999, Number(at?.n) | 0)); return n ? Object.freeze({ n, label: String(at.label || '') }) : null; };
          if (live() && typeof watch === 'function' && isDoc) {
            const g = guard(a, 'attention', watch), h = () => { if (live()) g(read()); };
            window.addEventListener('wizard:notify-attention', h);
            const off = () => { window.removeEventListener('wizard:notify-attention', h); a.offs.delete(off); }; a.offs.add(off);
          }
          return live() ? read() : null;
        },
        /* Back to the Desks view for this device: switches off the tweak wearing this layout, the same way as its
         * Settings › Look switch (WosExperience mix, no reload), so the layout itself always offers a way back. */
        classic: () => { if (live() && layoutHolder && layoutRec === a) return Promise.resolve(window.WosExperience?.toggle?.(layoutHolder)).then(() => true, () => false); return Promise.resolve(false); },
        // Closing the last window of a desk goes Home instead of to another desk (desks are out of sight). Released on teardown.
        emptyHome() { if (!live()) return () => {}; emptyHomes.add(a); const off = () => { emptyHomes.delete(a); a.offs.delete(off); }; a.offs.add(off); return off; },
        /* The layout's own group in Settings › Chats & app screens (the AI apps view's order inside each group, round
         * 19): a live node of its own, put back after every Settings render, released on teardown. */
        setting(id, node) {
          if (!live() || !isDoc || typeof id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(id) || !node || typeof node.append !== 'function') return () => {};
          const W = window.WosSettings; if (!W?.register) return () => {};
          let off0 = () => {};
          try { off0 = W.register({ id: 'layout-' + id, page: 'chats', html: () => '<div class="st-tweak" data-st-tweak></div>',
            painted: (ctx, box) => { const slot = box?.firstElementChild; if (slot && node.parentNode !== slot) slot.append(node); },
            deferRefresh: () => !!node.contains?.(document.activeElement) }); } catch (_) { return () => {}; }
          let done = false; const off = () => { if (done) return; done = true; off0(); node.remove?.(); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      /* No desks: while a layout holds the panel, whatever opens shows in a panel over Home instead of on a desk
       * (desktop.js, outside the desks: never tiled, never synced): a Chats window in the chat panel, anything else in
       * the app panel on the right; each holds one thing at a time (back() reopens the one before) and both can be open.
       * The desks underneath stay exactly as they were, and release (or teardown) gives them back. state() → { kind,
       * title, width, back, list: { width }, chat: { kind, left, right }, app: { id, title, left, right } } or null.
       * dock(true) keeps the stock Chats list docked in its own panel on the LEFT for good; a thread picked in it opens
       * in a column beside it, which closes when the thread is finished. dock(false) folds the list away. */
      panel: Object.freeze({
        claim() {
          if (!live()) return () => {};
          panelHolders.add(a); panelSync();
          const off = () => { panelHolders.delete(a); a.offs.delete(off); panelSync(); }; a.offs.add(off); return off;
        },
        // close() the panel in front; close('chat') the chat column; close('app') the app panel (hidden if parked).
        close: kind => !live() ? false : kind === 'chat' || kind === 'app' ? !!shell.panelCloseKind?.(kind) : !!shell.panelClose?.(),
        /* park(true): an app's panel only hides when closed (its frame stays alive, e.g. music keeps playing) and
         * opening that app again brings it back as it was; quit(id) really closes it; running() → [{ id, open,
         * playing }] (the app shown and the ones kept out of sight). */
        park: on => live() && panelHolders.has(a) ? !!shell.panelPark?.(!!on) : false,
        quit: id => live() && typeof id === 'string' && id ? !!shell.panelQuit?.(id) : false,
        running: () => { const l = live() ? shell.panelRunning?.() : null; return Array.isArray(l) ? l.map(r => Object.freeze({ id: String(r.id), open: !!r.open, playing: !!r.playing })) : []; },
        dock: on => live() && panelHolders.has(a) ? !!shell.panelDock?.(!!on) : false,
        back: () => live() ? !!shell.panelBack?.() : false,
        state: () => { const s = live() ? shell.panelState?.() : null; if (!s) return null; const o = { ...s }; for (const k of ['list', 'chat', 'app']) if (o[k]) o[k] = Object.freeze({ ...o[k] }); return Object.freeze(o); },
      }),
      /* Phone only (null elsewhere): the Home desk's section, where a layout's Home scene goes (it slides with the
       * desks), and the dock orb's box, where a layout drawing the dock orb puts its canvas (the stock gestures stay on
       * it: a layout may hand it a press with dispatchEvent). The layout removes what it put there on teardown. */
      phone: Object.freeze({
        home: () => live() ? shell.homeHost?.() || null : null,
        orb: () => live() ? shell.orbHost?.() || null : null,
        // The shared Chats surfaces of the phone's Chats windows (WizChatsHost: composer, notification, parts), so a
        // layout reaches them without the shell's window markup.
        chats: () => { const l = live() ? shell.chatsSurfaces?.() : null; return Object.freeze(Array.isArray(l) ? l.filter(Boolean) : []); },
        // The desks in order, one app each: [{ desk, id, name }] (Home and empty desks left out). nav.goDesk(desk) opens one.
        desks: () => { const l = live() ? shell.phoneDesks?.() : null; return Array.isArray(l) ? l.map(d => Object.freeze({ desk: d.desk | 0, id: String(d.id || ''), name: String(d.name || '') })) : []; },
        // An app's mark as the dock draws it (logo or sigil, colour; 'wizard' = Chats), as a fresh element the layout
        // may place; null when the app is unknown.
        mark: id => {
          const h = live() && typeof id === 'string' && id ? shell.phoneMark?.(id) : '';
          if (!h || !isDoc) return null;
          const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild || null;
        },
        /* The dock orb's swipes while this layout is worn: { up, side, down }, each 'stock' (or left out) = the dock's
         * own, null = nothing; up may be 'home' (go Home) or 'new' (a New chat, typing). Tap and hold are always the stock ones. Desks (no layout)
         * declares nothing, so every stock swipe stays. Released on teardown. */
        swipes(map) {
          if (!live() || !map || typeof map !== 'object') return () => {};
          const m = orbSwipeMap(map); orbSwipeHolders.set(a, m);
          const off = () => { if (orbSwipeHolders.get(a) === m) orbSwipeHolders.delete(a); a.offs.delete(off); }; a.offs.add(off); return off;
        },
      }),
      /* The desks in order, one app each, on either shell: [{ desk, id, name }] (Home and empty desks left out; a Chats
       * desk is id 'wizard'). nav.goDesk(desk) opens one. The Apps view's grid (phone: phoneDesks, desktop: deskApps). */
      desks: Object.freeze({
        list: () => { const l = live() ? (shell.deskApps || shell.phoneDesks)?.() : null; return Array.isArray(l) ? l.map(d => Object.freeze({ desk: d.desk | 0, id: String(d.id || ''), name: String(d.name || '') })) : []; },
        // close one desk as the stock ✕ does (the AI apps view's tab ✕; desktop only)
        close: desk => live() && Number.isInteger(desk) && desk >= 0 ? !!shell.closeDesk?.(desk) : false,
        // move one desk as the stock arrange does (take out at from, put in at to; the AI apps view's drag; desktop only)
        move: (from, to) => live() && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 ? !!shell.moveDesk?.(from, to) : false,
      }),
      // The layout's own overlay (e.g. a popover) joins the shell's Back order (desktop Esc), newest first.
      back: Object.freeze({
        surface(back) {
          if (!live() || typeof back !== 'function') return () => {};
          const h = { a, back: guard(a, 'escape.surface', back) }; escapeSurfaces.add(h);
          const off = () => { escapeSurfaces.delete(h); a.offs.delete(off); }; a.offs.add(off); return off;
        },
        push(close) {
        if (a.dead || typeof close !== 'function') return () => {};
        const done = guard(a, 'back', close);
        const entry = { a, close: () => { off(); return done(); } }; overlays.push(entry);
        const offEscape = shell?.escapeOverlay?.(entry.close);
        const off = () => { offEscape?.(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); a.offs.delete(off); };
        a.offs.add(off); return off;
      } }),
    };
  }
  /* The Add to home screen app, notification rows and the orb swipe map: core/skin-host-rows.js (moved verbatim, wizard-ux issue 1665). */
  const { activityRows, commandUis, homeScreenApp, inboxAct, keyGuides, keyHandlers, NOTE_ACTS, NOTE_ID, NOTE_ID_OPEN, noteAct, orbSwipeHolders, orbSwipeMap, panelHolders, readReadyOrder, readWorkingOrder, READY_ORDER_KEY, SESSION_ACTS, withNoteRows, bindLate: rowsLate } = window.WizCore.skinHostParts.rows({ isDoc });
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
  const expected = new Set(), preCss = new Map();   // ids still loading; id -> <link> added ahead of the package
  function tweakCss(id) {
    if (!isDoc) return null;
    let l = preCss.get(id); if (l) return l;
    l = document.createElement('link'); l.rel = 'stylesheet'; l.href = tweakUrl(id, 'tweak.css'); l.setAttribute('blocking', 'render');
    document.head.append(l); preCss.set(id, l); return l;
  }
  // Wait (briefly) for a package's stylesheet before its setup runs, so its view never shows unstyled.
  const cssReady = l => !l || l.sheet !== null || typeof l.addEventListener !== 'function' ? Promise.resolve() : new Promise(done => {
    const t = setTimeout(done, 1500), end = () => { clearTimeout(t); done(); };
    l.addEventListener('load', end, { once: true }); l.addEventListener('error', end, { once: true });
  });
  const bounded = async (promise, ms = 8000) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Package timed out')), ms); })]); }
    finally { clearTimeout(timer); }
  };
  function paintTweaks() {
    if (isDoc) document.documentElement.dataset.tweaks = [...new Set([...[...tweaks].filter(([, a]) => !a.dead).map(([id]) => id), ...expected])].join(' ');
    window.WosResources?.sync();
  }
  function tweakApi(a, manifest, trusted) {
    const base = makeApi(a), caps = new Set(manifest.capabilities.filter(c => trusted || c === 'layout' || c === 'nav'));
    const api = { env: base.env, route: base.route, on(type, fn) {
      if (type === 'render' && !caps.has('layout')) throw new Error('render requires layout');
      if (type === 'sent' && (!caps.has('nav') || !trusted)) throw new Error('sent requires trusted navigation');
      if (type === 'voice' && !caps.has('layout')) throw new Error('voice requires layout');
      if (type === 'beside' && !caps.has('layout')) throw new Error('beside requires layout');
      if (type === 'home' && !caps.has('layout')) throw new Error('home requires layout');
      return base.on(type, payload => fn(type === 'render' ? Object.freeze({ part: payload.part }) : payload));
    }, toast: base.toast, storage: base.storage };
    // Trusted packages that replace each other (catalog oneOf) can share one store, so a look-only skin change keeps
    // the owner's choices: manifest `storage: "<name>"` keys it as `wos.skin.shared:<name>.*` instead of by package id.
    if (trusted && typeof manifest.storage === 'string' && /^[a-z0-9-]{1,40}$/.test(manifest.storage)) {
      const ns = 'wos.skin.shared:' + manifest.storage + '.';
      api.storage = Object.freeze({
        get(key) { try {
          let v = localStorage.getItem(ns + key);
          // Before the shared store existed each package kept its own copy: take this package's, else any package of the
          // same name ("<author>/<storage>"), so switching skins after an upgrade keeps the owner's choices.
          if (v == null) v = localStorage.getItem(`wos.skin.${a.id}.${key}`);
          if (v == null) for (let i = 0; i < localStorage.length && v == null; i++) { const k = localStorage.key(i); if (k && /^wos\.skin\.[a-z0-9-]+\//.test(k) && k.endsWith(`/${manifest.storage}.${key}`)) v = localStorage.getItem(k); }
          return v == null ? null : JSON.parse(v);
        } catch (_) { return null; } },
        set(key, value) { try { localStorage.setItem(ns + key, JSON.stringify(value)); } catch (_) {} },
      });
    }
    if (caps.has('layout')) {
      Object.assign(api, { listen: base.listen, frame: base.frame, gesture: base.gesture });
      // Short answer first (--wos-reply-summary): how long replies start and how long the agent writes the short answer,
      // box-wide (ui-preferences replySummary; the Agent Service reads `length` while `on`). use() marks the view on for
      // the box and is released on teardown.
      api.replies = Object.freeze({ lengths: REPLY_LENGTHS, summary: () => replySummary.get(),
        set(patch = {}) { if (!a.dead) replySummary.set({ ...(patch.start ? { start: patch.start } : {}), ...(patch.length ? { length: patch.length } : {}) }); },
        use() { if (a.dead || summaryUsers.has(a.id)) return; summaryUsers.add(a.id); void replySummary.on(true);
          a.offs.add(() => { if (summaryUsers.delete(a.id) && !summaryUsers.size) void replySummary.on(false); }); } });
      // Borrow a built-in layout through the same host; disposal invalidates the handle.
      api.layout = Object.freeze({ foundation(id) {
        if (a.dead) return () => {};
        const release = window.WosSkin?.useFoundation(id) || (() => {});
        a.offs.add(release); return release;
      }, use(id) {
        if (a.dead || !layoutOf(id)) return () => {};
        // Already worn since boot (stored choice): keep the running layout instead of remounting it.
        if (layoutId !== id || (!layoutRec && !layoutSeq)) setLayout(id);
        layoutHolder = a.id;
        let released = false;
        const release = () => { if (!released) { released = true; if (layoutHolder === a.id) layoutHolder = null; if (layoutId === id && standardLayout !== id) setLayout('classic'); } };
        a.offs.add(release); return release;
      } });
      api.part = name => /^[a-z-]+$/.test(name) ? shell?.root()?.querySelector(`[data-part="${name}"]`) || null : null;
      // A package's own overlay joins the shell's Back order (phone Back / browser Back / desktop Esc): the newest
      // open one closes first. push(close) while it is open; the returned release (or teardown) takes it out.
      api.back = Object.freeze({ push(close) {
        if (a.dead || typeof close !== 'function') return () => {};
        const done = guard(a, 'back', close);
        const entry = { a, close: () => { off(); return done(); } }; overlays.push(entry);
        const offEscape = shell?.escapeOverlay?.(entry.close);
        const off = () => { offEscape?.(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); a.offs.delete(off); };
        a.offs.add(off); return off;
      } });
      const slot = name => {
        if (!slotContract?.slots[name]) return null;
        const selector = `[data-slot="${name}"]`;
        // Prefer the focused chats window, then any visible instance: desktop keeps hidden Chats copies around.
        const seen = el => !!el && el.isConnected !== false && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
        const own = shell?.root()?.querySelector(selector);
        if (seen(own)) return own;
        return [...document.querySelectorAll(selector)].find(seen) || own || document.querySelector(selector);
      };
      const borrowed = new Map();
      slot.mount = (name, node, order = 0) => {
        if (a.dead || !node || node.nodeType !== 1) return false;
        const target = slot(name); if (!target) return false;
        if (!borrowed.has(node)) {
          const parent = node.parentNode, marker = parent ? document.createComment('tweak mount origin') : null;
          if (parent) parent.insertBefore(marker, node);
          borrowed.set(node, marker);
          // Restore borrowed core nodes; owned nodes are removed. Run before common mount cleanup.
          a.offs.add(() => { if (marker?.parentNode?.isConnected) { marker.parentNode.insertBefore(node, marker); marker.remove(); a.mounts.delete(node); } });
        }
        node.dataset.tweakOrder = String(Number(order) || 0);
        const after = [...target.children].find(n => n !== node && +(n.dataset.tweakOrder || 0) > +node.dataset.tweakOrder);
        if (node.parentNode !== target || (after && node.nextSibling !== after)) target.insertBefore(node, after || null);
        a.mounts.add(node); return true;
      };
      api.slot = Object.freeze(slot);
    }
    if (caps.has('nav')) api.nav = Object.freeze({ ...Object.fromEntries(Object.entries(base.nav).map(([key, fn]) => [key, (...args) => !a.dead && fn(...args)])),
      newThread: () => !a.dead && shell?.newThread?.(),
      intercept(action, fn) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        if (action !== 'snooze' || typeof fn !== 'function') throw new Error('Unknown action');
        const handler = context => Promise.resolve().then(() => !a.dead && fn(Object.freeze({ ...context }))).catch(e => base.toast(e.message));
        interceptors.set(a.id, { action, handler }); a.offs.add(() => interceptors.delete(a.id));
      },
      snoozeSomeday: sessionId => { if (!trusted || a.dead) throw new Error('Trusted navigation required'); return window.WosBoomerang.someday({ sessionId, restore: true }); },
      // Ask the agent from a package view: a new chat carrying { title, message } as a quoted reply card (the shell's
      // contextDraft path). `words` lands as an unsent draft for the owner to check and send; { send: true } sends at
      // once. Trusted only; the key is namespaced so it can't pose as another app.
      ask(id, item = {}, words = '', opts = {}) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        const key = 'home:' + String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
        if (key === 'home:' || typeof shell?.contextDraft !== 'function') return false;
        const w = String(words || '').slice(0, 1000), send = opts?.send === true;
        return !!shell.contextDraft(key, { title: String(item.title || '').slice(0, 300), message: String(item.message || '').slice(0, 4000) }, send ? w : '', send ? '' : w);
      },
      // Snooze = lowest priority, bottom of Ready (live.js / chats.js read host.snoozeOrder). Released on teardown.
      snoozeOrder(order) {
        if (!trusted || a.dead) throw new Error('Trusted navigation required');
        if (order !== 'last') throw new Error('Unknown order');
        if (snoozeLast.has(a.id)) return;
        snoozeLast.add(a.id); a.offs.add(() => { if (snoozeLast.delete(a.id)) window.dispatchEvent?.(new Event('wos:prefs')); });
      },
    });
    // A layout+navigation package may borrow the shell's overview renderer/input adapter.
    // No DOM or package IDs cross this boundary; the handle is released on every teardown.
    if (caps.has('layout') && caps.has('nav')) api.overview = Object.freeze({ use(options = {}) {
      if (a.dead) return () => {};
      if (!['arrange','offer'].includes(options.hold) || ![null,'home-screen'].includes(options.appAction ?? null) || typeof options.appHold !== 'boolean') throw new Error('Invalid overview mode');
      const release = shell?.overview?.use?.(Object.freeze({ hold:options.hold, appAction:options.appAction ?? null, appHold:options.appHold })) || (() => {});
      let released = false; const off = () => { if (!released) { released = true; release(); } };
      a.offs.add(off); return off;
    } });
    // A layout+navigation package may ask the shell for ↻ in every window bar and (pull:false) drop Chats pull-to-refresh.
    // The shell owns the button and the refresh; the handle is released on every teardown.
    if (caps.has('layout') && caps.has('nav')) api.windowRefresh = Object.freeze({ use(options = {}) {
      if (a.dead) return () => {};
      if (typeof options.pull !== 'boolean') throw new Error('Invalid window refresh mode');
      const release = shell?.windowRefresh?.use?.(Object.freeze({ pull: options.pull })) || (() => {});
      let released = false; const off = () => { if (!released) { released = true; release(); } };
      a.offs.add(off); return off;
    } });
    // Trusted packages may show and pause what the apps play (api.media above).
    if (trusted && caps.has('media')) api.media = base.media;
    if (caps.has('models')) {
      api.models = Object.freeze({ list: async () => {
        const options = await shell?.models?.() || [];
        return a.dead ? [] : options.map(m => Object.freeze({ id: m.value, provider: m.provider, agent: m.agent || '', label: m.name, disabled: !!m.disabled }));
      },
      // The Wizard's default model (what a new chat starts on), or null while it is still loading.
      default: () => { if (a.dead) return null; const o = window.WosModels?.defaultOption?.(); return o ? Object.freeze({ id: String(o.value || ''), provider: String(o.provider || '') }) : null; } });
      api.thread = Object.freeze({ model: choice => a.dead ? null : shell?.model?.(choice, () => !a.dead) });
    }
    if (trusted && caps.has('data.read')) api.workspaces = window.WizWorkspaces;
    if (caps.has('data.read')) api.data = Object.freeze({ read: Object.freeze({ resources: Object.freeze({
      snapshot: () => structuredClone(window.WosResources?.state || {}), refresh: () => window.WosResources?.sync(),
      // A reading kept on screen outside Home or Settings (the desktop top bar) keeps the feed polling while it shows.
      live: el => { if (!a.dead && el?.nodeType === 1) window.WosResources?.watch?.(el); },
      // resources.js announces each finished poll ('wos:resources'); the handle dies with the package.
      watch(fn) {
        if (a.dead || typeof fn !== 'function' || typeof window.addEventListener !== 'function') return () => {};
        const g = guard(a, 'resources.watch', () => fn(structuredClone(window.WosResources?.state || {})));
        window.addEventListener('wos:resources', g);
        const off = () => { window.removeEventListener('wos:resources', g); a.offs.delete(off); };
        a.offs.add(off); return off;
      },
    }),
    // Trusted packages only: Ready / Working counts as Home shows them, and opening those same lists.
    ...(trusted ? { sessions: Object.freeze({
      counts: () => { if (a.dead) return null; const c = shell?.sessions?.(); return c ? Object.freeze({ working: c.working | 0, ready: c.ready | 0 }) : null; },
      open: kind => { if (!a.dead && (kind === 'working' || kind === 'ready')) shell?.openSessions?.(kind); },
    }) } : {}),
    // Trusted packages only: one same-origin GET of an installed app's read API (/<app>/api/<path>), JSON back.
    // No method, header, body or other origin crosses this boundary; null on any failure or after teardown.
    ...(trusted ? { app: async (id, path) => {
      if (a.dead || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id)) || !/^[a-z0-9][a-z0-9/_-]{0,80}$/.test(String(path))) return null;
      try {
        const r = await bounded(fetch(new URL(`/${id}/api/${path}`, document.baseURI).href, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
        if (!r.ok || !/json/.test(r.headers?.get?.('content-type') || 'application/json')) return null;
        const j = await r.json(); return a.dead ? null : structuredClone(j);
      } catch (_) { return null; }
    } } : {}),
    }) });
    // Trusted packages may show the Notifications inbox (core/notif-bell.js) in Chats: watch unread items, mark one
    // done, or answer it in a new chat (the shell's context-draft path; `words` sends at once). No fetch crosses this
    // boundary and every handle dies with the package.
    // Settings sections: a trusted package fills a System page of Settings (Your network, AI, Network & security,
    // Storage & backups) with its own live node, or puts its own options under its switch in Look (page 'look'), and can
    // open Settings at one of the System pages. Released on teardown.
    if (caps.has('settings')) api.settings = Object.freeze({
      section(id, page, node, opts = {}) {
        if (!trusted || a.dead) throw new Error('Trusted settings required');
        if (!['overview', 'ai', 'network', 'storage', 'look'].includes(page) || !node || typeof node.append !== 'function') throw new Error('Invalid settings section');
        const W = window.WosSettings; if (!W?.register) return () => {};
        // Look: the package's own options, right under its switch in the Tweaks list.
        if (page === 'look') { if (!W.tweakOptions) return () => {}; const off = W.tweakOptions(a.id, node); let done = false; const release = () => { if (!done) { done = true; off(); } }; a.offs.add(release); return release; }
        const fid = ('tweak-' + a.id + '-' + id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
        const subtitle = typeof opts.subtitle === 'function' ? guard(a, 'settings.subtitle', opts.subtitle) : null;
        const off = W.register({ id: fid, page, ...(subtitle ? { subtitle } : {}), html: () => '<div class="st-tweak" data-st-tweak></div>',
          painted: (ctx, el) => { const slot = el?.firstElementChild; if (slot && node.parentNode !== slot) slot.append(node); window.WosResources?.watch?.(node); },
          deferRefresh: () => node.contains?.(document.activeElement) });
        let done = false; const release = () => { if (!done) { done = true; off(); node.remove?.(); } };
        a.offs.add(release); return release;
      },
      open: page => { if (!a.dead && ['overview', 'ai', 'network', 'storage'].includes(page)) shell?.openSettings?.(page); },
      // One of the author's own tweaks, switched for this device the same way as Settings › Look (WosExperience
      // mix, no reload). Own author only: a package can never switch someone else's tweak.
      tweakOn: id => typeof id === 'string' && id.startsWith(a.id.split('/')[0] + '/') && tweaks.has(id) && !tweaks.get(id).dead,
      toggleTweak(id) {
        if (!trusted || a.dead) throw new Error('Trusted settings required');
        if (typeof id !== 'string' || !safeTweakId(id) || id === a.id || !id.startsWith(a.id.split('/')[0] + '/')) return Promise.resolve(false);
        return Promise.resolve(window.WosExperience?.toggle?.(id)).then(() => true, () => false);
      },
      refresh: () => { if (!a.dead) window.WosSettings?.refresh?.(); },
    });
    /* Trusted packages may replace where notifications go: the `notify-routing` part in core/notif-bell.js (version 1),
     * and read / save the box's saved choices at Notifications' /notifications/api/routes. No other URL,
     * method or header crosses this boundary. The replacement dies with the package (stock Badge | Chats comes back). */
    if (caps.has('notify') && trusted) api.notify = Object.freeze({
      routing(impl, opts = {}) {
        const R = window.WosBell?.routing; if (!R || a.dead || !impl || typeof impl !== 'object') return false;
        const wrapped = {};
        for (const [k, fn] of Object.entries(impl)) if (typeof fn === 'function' && k !== 'attach') wrapped[k] = (...args) => {
          if (a.dead) throw new Error('turned off');
          try { return fn(...args); } catch (e) { fault(a, 'notify.' + k, e); throw e; }
        };
        // The host handed to the replacement: what it may read and do, nothing more, and only while it lives.
        if (typeof impl.attach === 'function') wrapped.attach = host => { if (!a.dead) impl.attach(Object.freeze({
          stored: () => a.dead ? {} : host.stored(), route: id => host.route(String(id)), installed: () => !a.dead && host.installed(),
          adopt: next => !a.dead && host.adopt(next), changed: () => { if (!a.dead) host.changed(); },
          mark: (ids, marks = {}) => { const m = Object.fromEntries(['read', 'archived'].filter(k => typeof marks[k] === 'boolean').map(k => [k, marks[k]])); return a.dead || !Array.isArray(ids) || !Object.keys(m).length ? Promise.resolve(false) : host.mark(ids.map(String).slice(0, 200), m); },
        })); };
        const r = R.replace(wrapped, { owner: a.id, version: opts?.version });
        if (typeof r === 'function') { a.offs.add(r); return true; }
        try { shell?.toast?.(r === 'version' ? `${a.label || a.id} paused after an update · ask your Wizard to update it` : `${a.label || a.id} couldn't change notifications (${r})`); } catch (_) {}
        return false;
      },
      routes: Object.freeze({
        async get() {
          if (a.dead) return null;
          try {
            const r = await bounded(fetch(new URL('/notifications/api/routes', document.baseURI).href, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
            if (!r.ok) return null; const j = await r.json(); return a.dead || !j || typeof j !== 'object' ? null : structuredClone(j);
          } catch (_) { return null; }
        },
        async save(routes) {
          if (a.dead || !routes || typeof routes !== 'object' || Array.isArray(routes)) return false;
          const clean = {}; for (const [k, v] of Object.entries(routes).slice(0, 200)) if (typeof v === 'string' && /^[a-z0-9][a-z0-9:-]{0,80}$/.test(k) && /^[a-z][a-z0-9-]{0,19}$/.test(v)) clean[k] = v;
          if (!Object.keys(clean).length) return false;
          try {
            const r = await bounded(fetch(new URL('/notifications/api/routes', document.baseURI).href, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routes: clean }) }));
            return !a.dead && r.ok;
          } catch (_) { return false; }
        },
      }),
    });
    if (caps.has('inbox')) api.inbox = Object.freeze({
      watch(fn) {
        if (a.dead || typeof fn !== 'function' || !window.WosBell?.watch) return () => {};
        const g = guard(a, 'inbox.watch', fn);
        const off = window.WosBell.watch(items => { if (!a.dead) g(items); });
        a.offs.add(off); return off;
      },
      done: id => a.dead || !window.WosBell?.mark ? Promise.resolve(false) : window.WosBell.mark([String(id)], { archived: true, read: true }),
      // read / archived only (snoozed = read and kept; restored = neither).
      set(id, marks = {}) {
        const m = Object.fromEntries(['read', 'archived'].filter(k => typeof marks[k] === 'boolean').map(k => [k, marks[k]]));
        return a.dead || !Object.keys(m).length || !window.WosBell?.mark ? Promise.resolve(false) : window.WosBell.mark([String(id)], m);
      },
      // A notification opened from the list shows in the chat window as a one-message thread; its Done / Snooze /
      // Restore buttons (and keys) call act(action, id). Held while the package lives (chats.js reads host.inboxThreads).
      // `list: true` also lists them in Ready as rows like any chat (time, priority and subject order); a tap on one
      // calls act('open', id).
      threads(handlers = {}) {
        if (a.dead || typeof handlers.act !== 'function') return () => {};
        inboxThreads.set(a.id, { act: guard(a, 'inbox.act', handlers.act), list: handlers.list === true });
        const off = () => { if (inboxThreads.delete(a.id)) window.dispatchEvent?.(new Event('wos:prefs')); };
        a.offs.add(off); window.dispatchEvent?.(new Event('wos:prefs')); return off;
      },
      reply(id, words = '') {
        if (a.dead) return false;
        const it = window.WosBell?.item?.(id); if (!it || typeof shell?.contextDraft !== 'function') return false;
        // An app's item rides with its app name, so the agent knows where it came from (and which app tools to use).
        const app = it.app || it.from, name = it.appName || it.fromName || app;
        const title = app ? `${name}: ${it.title || 'Item'}` : it.title;
        const message = app ? `${it.message}\n\n(From the ${name} app, ${app}; item ${it.key || it.id})` : it.message;
        return !!shell.contextDraft('notifications:' + it.id, { title, message }, String(words || ''));
      },
      // An app's item (an app set to Chats in Settings › Notifications): open that app, at the item when it says where.
      open(id) {
        if (a.dead) return false;
        const it = window.WosBell?.item?.(id); if (!(it?.app || it?.from) || typeof window.WizOpenApp !== 'function') return false;
        // Android, switch wizard/app-windows (wizard-os issue 650): Open shows the app in its own window, as a link does.
        const openApp = (app, path) => window.WizAndroidRelay?.openAppWindow?.(app, path || '') === true || (path ? window.WizOpenApp(app, path) : window.WizOpenApp(app));
        if (!it.app) return !!openApp(it.from);   // a Notifications item about an app: open that app
        if (!it.open) return !!openApp(it.app);
        let base = ''; try { base = (window.WizCore?.apps?.('mobile')?.APPS || []).find(x => x.id === it.app)?.url || ''; } catch (_) {}
        try { const u = new URL(it.open, new URL(base || `/${it.app}/`, location.origin)); if (u.origin === location.origin && openApp(it.app, u.pathname + u.search + u.hash)) return true; } catch (_) {}
        return !!openApp(it.app);
      },
    });
    return Object.freeze(api);
  }
  /* A tweak reload (Settings, a skin pick, coming back to the tab) disposes and re-runs every tweak. A layout's panel
   * must not drop for that blink (Miguel lost every running Orbs app to it): the panel turns off only once the load
   * has settled and no layout claims it again. */
  async function loadTweaks(...args) {
    panelHold++;
    try { return await loadTweaksNow(...args); } finally { panelHold--; panelSync(); }
  }
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

  const host = {
    loadTweaks, emit,
    /* my-skin.js / settings.js: true while wizard/skins-look-only keeps skin scripts from running. */
    get lookOnly() { return lookOnly; },
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
    commit(id) { ensureCss(id); committedId = id; if (shell) packageReady = load(id); },
    /* app.js: the shell is ready; hands over the narrow adapter skins are allowed to drive. */
    attach(adapter) { shell = adapter; for (const n of builtinDefs.keys()) startBuiltin(n); const id = committedId || (window.WosSkin && window.WosSkin.current); committedId = id; if (id) packageReady = load(id); window.WosMySkin?.startScript(); if (layoutOf(layoutId)) loadLayout(layoutId); if (booting()) bootGiveUp(layoutId); window.dispatchEvent?.(new Event('wos:skin-host-ready')); },
    /* Layouts: Settings › Look. Classic loads nothing. */
    layouts: LAYOUTS, setLayout,
    escapeSurface() { for (const h of [...escapeSurfaces].reverse()) if (!h.a.dead && h.back() === true) return true; return false; },
    async whenLayoutReady() { let p; do { p = layoutLoading; await p; } while (p !== layoutLoading); },
    setStandardLayout(id) { standardLayout = layoutOf(id) ? id : 'classic'; if (layoutId !== standardLayout) setLayout(standardLayout, false); return standardLayout; },
    get layout() { return layoutId; },
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
      if (routing || !openRoutes.size) return null;
      for (const h of [...openRoutes]) {
        if (h.a.dead) continue;
        let out, ran = false;
        const g = desk => { if (!ran) { ran = true; out = typeof go === 'function' ? go(desk) : undefined; } return out; };
        routing++;
        let took; try { took = h.open(String(kind), Object.freeze({ ...detail }), g); } finally { routing--; }
        if (took === true) return Object.freeze({ value: out });
      }
      return null;
    },
    /* desktop.js: the layout holding the opens shows this desk's app on screen (beside the desk in front). */
    routeShows(desk) { for (const h of openRoutes) if (!h.a.dead && h.shows && h.shows(desk) === true) return true; return false; },
    /* desktop.js: a layout without desks holds the right-side panel (everything opens there, desks stay put). */
    get panelMode() { return panelOn && (panelHold > 0 || [...panelHolders].some(l => !l.dead)); },
    get layoutState() { return { id: layoutId, active: !!layoutRec, disabled: disabled.has('layout:' + layoutId), mounts: layoutRec?.mounts.size || 0 }; },
    /* desktop.js: a layout draws the command take (api.voice.onCommand); its result goes there, not to a toast. */
    get commandUi() { return commandUis.size > 0; },
    commandResult(ev) { for (const fn of [...commandUis]) fn(Object.freeze({ ...ev })); },
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
    voice(state) { if (layers().length) emit('voice', Object.freeze({ ...(shell?.voiceState ? shell.voiceState() : { state }) })); },
    loadPersonal, scriptProblem,
    /* core/*.js: a gesture every skin wears. `when: 'touch'` skips desktop pointers. */
    builtin(name, setup, { when = 'touch', label = name, capabilities } = {}) { if (typeof setup !== 'function' || builtinDefs.has(name)) return false; builtinDefs.set(name, { setup, when, label, capabilities }); return startBuiltin(name) || !shell; },
    get builtinState() { return [...builtins.keys()]; },
    stopPersonal() { personalSeq++; dispose(personal, 'off'); },
    get personalState() { return { ready: !!shell, active: !!personal, disabled: disabled.has('my-skin'), error: personalError ? { ...personalError } : null, listeners: personal?.offs.size || 0, handlers: personal ? personal.on.route.size + personal.on.render.size : 0 }; },
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
    claimedLately: (ms = 800) => { const t = clock() - claimAt; return t < ms || (backClaims.size > 0 && t < 10000); },
    release,
    get state() { return { active: active ? active.id : null, listeners: active ? active.offs.size : 0, frames: active ? active.frames.size : 0, handlers: active ? active.on.route.size + active.on.render.size : 0, disabled: [...disabled], requested: [...requested], css: [...cssLinks.keys()] }; },
    _test: { setImporter(fn) { importer = fn; }, env, load, unload, loadLayout },
  };
  if (typeof window !== 'undefined') {
    window.WosSkinHost = host;
    // The stored skin's stylesheet now, in <head>, so it paints with the first frame (no flash).
    const id = window.WosSkin && window.WosSkin.current;
    if (id) { ensureCss(id); committedId = id; }
    // The tweaks this device wore last time: listed and styled from the first frame (loadTweaks settles the real list).
    try { const last = JSON.parse(localStorage.getItem(EXPECT_KEY) || '[]'); if (isDoc && Array.isArray(last)) { for (const t of last.filter(x => typeof x === 'string' && safeTweakId(x)).slice(0, 40)) { expected.add(t); tweakCss(t); } if (expected.size) paintTweaks(); lookOnly = expected.has(LOOK_ONLY); } } catch (_) {}
    // If the catalog or profile never loads, drop the guessed packages (and their styles) instead of hiding Home for good.
    if (expected.size) setTimeout(() => { if (tweaksAsked) return; for (const t of [...expected]) { expected.delete(t); const l = preCss.get(t); if (l) { l.remove(); preCss.delete(t); } } paintTweaks(); }, BOOT_GUESS_MS);
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
        standardLayout = chosen;
      }
      layoutId = chosen; paintLayout(chosen);
      if (isDoc && env().shell === 'desktop' && layoutOf(chosen)?.ownsChats) {
        startBoot(chosen);
      }
    } catch (_) {}
    if (isDoc) for (const pid of ['pointerup', 'pointercancel']) document.addEventListener(pid, e => release(e.pointerId), true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = host;
})();
