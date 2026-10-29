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
   * web/layouts/<id>/{layout.css,layout.js}; its css applies only under html[data-layout="<id>"]. */
  const LAYOUTS = Object.freeze([
    Object.freeze({ id: 'classic', name: 'Classic', desc: 'One orb: tap to talk, hold for a command' }),
    Object.freeze({ id: 'two-orb', name: 'Two orbs', desc: 'Agent orb bottom right · white orb types and runs commands', css: true, js: true }),
  ]);
  const LAYOUT_KEY = 'wos.layout';
  const layoutOf = id => LAYOUTS.find(l => l.id === id && l.id !== 'classic') || null;
  let layoutId = 'classic', layoutRec = null, layoutSeq = 0;
  const taps = new Set();           // orb tap interceptors (layout first-wins); each returns true when handled
  const levels = new Set();         // microphone level listeners (0..1) during a take
  const isDoc = typeof document !== 'undefined';
  let shell = null;                 // adapter from app.js: route/back/openList/openThread/goDesk/deskCount/root/dock/toast
  let active = null;                // { id, dir, teardown, offs:Set, frames:Set, on:{route:Set,render:Set}, errs:[], dead }
  let lastRoute = '';
  const cssLinks = new Map();       // dir -> <link>
  const disabled = new Set();       // skin ids whose script failed this page
  const claims = new Set();         // pointer ids a skin gesture has claimed
  const requested = [];             // asset URLs requested (diagnostics + tests)
  let importer = url => import(url);
  let committedId = null, loadSeq = 0;
  let personal = null, personalSeq = 0, packageReady = Promise.resolve();
  // Built-in gestures every skin wears (core files register them; same API, guards and cleanup as a skin script).
  const builtinDefs = new Map(), builtins = new Map();
  const record = (id, label = id) => ({ id, label, offs: new Set(), frames: new Set(), claims: new Set(), mounts: new Set(), taps: new Set(), levels: new Set(), orbs: new Set(), on: { route: new Set(), render: new Set(), voice: new Set(), sent: new Set(), beside: new Set(), home: new Set() }, errs: [], dead: false, teardown: null });

  const skinOf = id => (typeof window !== 'undefined' && window.WosSkin && window.WosSkin.pkgOf) ? window.WosSkin.pkgOf(id) : null;
  const dirOf = (id, pkg) => (pkg && pkg.dir) || id;
  // The image build stamps each page with its release (tools/stamp-assets.sh); skin and layout files loaded here
  // carry it too, so a phone never mixes one release's shell with another's cached skin code.
  const releaseToken = () => { try { const v = isDoc && document.querySelector('meta[name="wos-release"]')?.content; return v && /^[0-9a-f]{6,40}$/.test(v) ? v : ''; } catch (_) { return ''; } };
  const stamp = h => { const v = releaseToken(); return v ? h + (h.includes('?') ? '&' : '?') + 'v=' + v : h; };
  const url = (dir, file) => isDoc ? stamp(new URL(`skins/${dir}/${file}`, document.baseURI).href) : `skins/${dir}/${file}`;

  function env() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return Object.freeze({
      touch: !!coarse,
      platform: /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'desktop',
      webview: /; wv\)|WizardNative/i.test(ua),
      edgeInset: 24,
      shell: (isDoc && document.documentElement.dataset.shell) || 'phone',
    });
  }

  /* ---------- stylesheet: safe to load on preview (scoped rules, no behaviour) ---------- */
  function ensureCss(id) {
    const pkg = skinOf(id); if (!pkg || !pkg.css || !isDoc) return null;
    const dir = dirOf(id, pkg); if (cssLinks.has(dir)) return cssLinks.get(dir);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url(dir, 'skin.css');
    l.dataset.skinPkg = dir; l.setAttribute('blocking', 'render');
    // The old cascade slot of these rules: right after core/skins.css (later packages stack after earlier ones).
    const prev = [...cssLinks.values()].pop();
    const anchor = prev || document.querySelector('link[href*="core/skins.css"]');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(l, anchor.nextSibling); else document.head.appendChild(l);
    cssLinks.set(dir, l); requested.push(l.href); return l;
  }

  /* ---------- error fallback ---------- */
  function fault(a, where, e) {
    if (!a || a.dead) return;
    try { console.warn(`[skin ${a.id}] ${where}:`, e); } catch (_) {}
    const now = Date.now(); a.errs = a.errs.filter(t => now - t < ERR_WINDOW); a.errs.push(now);
    if (a.errs.length >= ERR_LIMIT) {
      const wasTweak = tweaks.has(a.id); disabled.add(a.id); dispose(a, 'error'); if (wasTweak) { paintTweaks(); window.dispatchEvent?.(new Event('wos:experience')); }
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
        claim: pointerId => { if (shell && shell.locked && shell.locked(pointerId)) return false; claims.add(pointerId); a.claims.add(pointerId); return true; },
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
        const host = isDoc && document.getElementById('device'); if (!host || !node || node.nodeType !== 1) return () => {};
        host.appendChild(node); a.mounts.add(node);
        return () => { node.remove(); a.mounts.delete(node); };
      },
      /* Agents: who can receive a message, and who the screen in front routes to. */
      agents: Object.freeze({
        list: () => shell?.agents ? shell.agents().map(x => Object.freeze({ ...x })) : [],
        here: () => shell?.agentHere ? Object.freeze({ ...shell.agentHere() }) : null,
        sigil: id => shell?.agentSigil ? shell.agentSigil(id) : null,
        open: id => { if (typeof id === 'string' && id) need().openAgent?.(id); },
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
      }),
      storage: Object.freeze({
        get(key) { try { const v = localStorage.getItem(`wos.skin.${a.id}.${key}`); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
        set(key, value) { try { localStorage.setItem(`wos.skin.${a.id}.${key}`, JSON.stringify(value)); } catch (_) {} },
      }),
    };
    return Object.freeze(api);
  }

  /* ---------- script lifecycle ---------- */
  function unload(reason) {
    dispose(active, reason);
  }
  // Both layers share the API, guards and cleanup. Unloading one leaves the other alive.
  function dispose(a, reason) {
    if (!a) return;
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
    for (const id of a.claims) { if (!layers().some(l => l !== a && l.claims.has(id))) claims.delete(id); }
    a.claims.clear();
  }

  async function load(id) {
    const seq = ++loadSeq;
    unload('switch');
    const pkg = skinOf(id);
    if (!pkg || !pkg.js || disabled.has(id) || !shell) return false;
    const E = env();
    if ((pkg.when || 'touch') === 'touch' && !E.touch) return false;
    const href = url(dirOf(id, pkg), 'skin.js'); requested.push(href);
    let mod;
    try { mod = await importer(href); } catch (e) { try { console.warn(`[skin ${id}] import failed:`, e); } catch (_) {} return false; }
    if (seq !== loadSeq || committedId !== id) return false; // switched again while loading
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
    return Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0, app: r.app || null, agent: r.agent || null, beside: Math.sign(r.beside | 0) });
  }
  /* The view bound beside a chat thread (app.js syncPeek): 1 = it leans in on the right of the thread, -1 = on that
   * view, its thread leans in on the left, 0 = none. Its own event, so route listeners never see extra calls. */
  let lastBeside = 0;
  function emitBeside() {
    const side = shell ? routeOf().beside : 0;
    if (side === lastBeside) return; lastBeside = side;
    if (layers().length) emit('beside', Object.freeze({ side }));
  }
  function emitRoute() {
    if (!layers().length || !shell) return;
    const r = routeOf(), k = `${r.view}|${r.thread || ''}|${r.desk}|${r.app || ''}|${r.agent || ''}`;
    if (k === lastRoute) return; lastRoute = k;
    emit('route', r);
  }

  /* ---------- layout layer ---------- */
  const layoutUrl = (id, file) => isDoc ? stamp(new URL(`layouts/${id}/${file}`, document.baseURI).href) : `layouts/${id}/${file}`;
  let layoutCss = null;
  function paintLayout(id) {
    if (!isDoc) return;
    const L = layoutOf(id);
    if (L) document.documentElement.dataset.layout = id; else delete document.documentElement.dataset.layout;
    if (layoutCss && (!L || layoutCss.dataset.layoutPkg !== id)) { layoutCss.remove(); layoutCss = null; }
    if (L && L.css && !layoutCss) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = layoutUrl(id, 'layout.css'); l.dataset.layoutPkg = id;
      l.setAttribute('blocking', 'render'); document.head.appendChild(l); layoutCss = l; requested.push(l.href);
    }
  }
  async function loadLayout(id) {
    const seq = ++layoutSeq;
    dispose(layoutRec, 'switch');
    const L = layoutOf(id); const key = 'layout:' + id;
    if (!L || !L.js || !shell || disabled.has(key)) return false;
    const href = layoutUrl(id, 'layout.js'); requested.push(href);
    let mod;
    try { mod = await importer(href); } catch (e) { try { console.warn(`[layout ${id}] import failed:`, e); } catch (_) {} return false; }
    if (seq !== layoutSeq || layoutId !== id || typeof mod?.default !== 'function') return false;
    const a = record(key, L.name + ' layout'); layoutRec = a;
    try { a.teardown = mod.default(makeApi(a)); } catch (e) { fault(a, 'setup', e); if (a.dead) return false; }
    lastRoute = ''; emitRoute();
    return layoutRec === a;
  }
  function setLayout(id) {
    const next = layoutOf(id) ? id : 'classic';
    try { if (next === 'classic') localStorage.removeItem(LAYOUT_KEY); else localStorage.setItem(LAYOUT_KEY, next); } catch (_) {}
    layoutId = next; paintLayout(next);
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
  async function loadPersonal(bytes, allowed, file = 'Skins/My skin/skin.js') {
    const seq = ++personalSeq;
    dispose(personal, 'replace'); personalError = null;
    let pending; do { pending = packageReady; await pending; } while (pending !== packageReady);
    if (seq !== personalSeq || !shell || disabled.has('my-skin') || !allowed()) return false;
    const href = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
    let mod;
    try { mod = await importer(href); }
    catch (e) { if (seq === personalSeq) personalFailed(file, e); return false; }
    finally { URL.revokeObjectURL(href); }
    if (seq !== personalSeq || !allowed()) return false;
    if (typeof mod?.default !== 'function') { personalFailed(file, new Error('no export default function setup(api)')); return false; }
    const a = record('my-skin', file); personal = a;
    try { a.teardown = mod.default(makeApi(a)); } catch (e) { dispose(a, 'error'); personalFailed(file, e); return false; }
    lastRoute = ''; emitRoute();
    return personal === a;
  }
  function release(id) { claims.delete(id); for (const l of layers()) l.claims.delete(id); }
  function startBuiltin(name) {
    const d = builtinDefs.get(name); if (!d || !shell || builtins.has('core:' + name) || disabled.has('core:' + name)) return false;
    if (d.when === 'touch' && !env().touch) return false;
    const a = record('core:' + name, d.label); builtins.set(a.id, a);
    try { a.teardown = d.setup(makeApi(a)); } catch (e) { fault(a, 'setup', e); }
    lastRoute = ''; emitRoute();
    return builtins.get(a.id) === a;
  }

  // Same honest-code lint as packaged skins, plus no module dependencies: only this file is approved.
  // This is a guardrail, not a sandbox for hostile JavaScript (owner code runs in the shell origin).
  function scriptProblem(source) {
    const src = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = /\b(?:addEventListener|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|__wos|localStorage|sessionStorage|innerHTML|outerHTML|WebSocket)\b|\b(?:fetch|eval)\s*\(|\bnew\s+Function\b|\bhistory\s*\.|\bdocument\s*\.\s*cookie|\bimport\b|\bexport\s+(?!default\b)[^;]*\bfrom\b/;
    return banned.test(src) ? 'Use the skin hook API; imports are not allowed' : null;
  }

  /* Tweaks extend the existing package host: same guards, listeners, frames and disposal. */
  const tweaks = new Map(), interceptors = new Map(), snoozeLast = new Set(), inboxThreads = new Map(), overlays = []; // inboxThreads: package -> {act} // snoozeLast: packages holding snoozeOrder('last')
  let tweakSeq = 0, slotContract = null;
  const safeTweakId = id => /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id);
  const tweakUrl = (id, file) => stamp(new URL(`tweaks/${id}/${file}`, document.baseURI).href);
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Package timed out')), 8000); })]); }
    finally { clearTimeout(timer); }
  };
  function paintTweaks() {
    if (isDoc) document.documentElement.dataset.tweaks = [...tweaks].filter(([, a]) => !a.dead).map(([id]) => id).join(' ');
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
    if (caps.has('layout')) {
      Object.assign(api, { listen: base.listen, frame: base.frame, gesture: base.gesture });
      // Borrow a built-in layout through the same host; disposal invalidates the handle.
      api.layout = Object.freeze({ foundation(id) {
        if (a.dead) return () => {};
        const release = window.WosSkin?.useFoundation(id) || (() => {});
        a.offs.add(release); return release;
      }, use(id) {
        if (a.dead || !layoutOf(id)) return () => {};
        setLayout(id);
        let released = false;
        const release = () => { if (!released) { released = true; if (layoutId === id) setLayout('classic'); } };
        a.offs.add(release); return release;
      } });
      api.part = name => /^[a-z-]+$/.test(name) ? shell?.root()?.querySelector(`[data-part="${name}"]`) || null : null;
      // A package's own overlay joins the shell's Back order (phone Back / browser Back / desktop Esc): the newest
      // open one closes first. push(close) while it is open; the returned release (or teardown) takes it out.
      api.back = Object.freeze({ push(close) {
        if (a.dead || typeof close !== 'function') return () => {};
        const entry = { a, close: guard(a, 'back', close) }; overlays.push(entry);
        const off = () => { const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); a.offs.delete(off); };
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
    if (caps.has('models')) {
      api.models = Object.freeze({ list: async () => {
        const options = await shell?.models?.() || [];
        return a.dead ? [] : options.map(m => Object.freeze({ id: m.value, provider: m.provider, agent: m.agent || '', label: m.name, disabled: !!m.disabled }));
      } });
      api.thread = Object.freeze({ model: choice => a.dead ? null : shell?.model?.(choice, () => !a.dead) });
    }
    if (caps.has('data.read')) api.data = Object.freeze({ read: Object.freeze({ resources: Object.freeze({
      snapshot: () => structuredClone(window.WosResources?.state || {}), refresh: () => window.WosResources?.sync(),
      // resources.js announces each finished poll ('wos:resources'); the handle dies with the package.
      watch(fn) {
        if (a.dead || typeof fn !== 'function' || typeof window.addEventListener !== 'function') return () => {};
        const g = guard(a, 'resources.watch', () => fn(structuredClone(window.WosResources?.state || {})));
        window.addEventListener('wos:resources', g);
        const off = () => { window.removeEventListener('wos:resources', g); a.offs.delete(off); };
        a.offs.add(off); return off;
      },
    }),
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
        return !!shell.contextDraft('notifications:' + it.id, { title: it.title, message: it.message }, String(words || ''));
      },
    });
    return Object.freeze(api);
  }
  async function loadTweaks(entries, contract, { teamAuthors = [], trustedAuthors = [] } = {}) {
    const seq = ++tweakSeq; slotContract = contract;
    for (const a of [...tweaks.values()]) dispose(a, 'replace');
    tweaks.clear(); paintTweaks();
    if (!shell) return false;
    for (const id of entries) {
      if (seq !== tweakSeq) return false;
      if (!safeTweakId(id)) continue;
      try {
        const response = await bounded(fetch(tweakUrl(id, 'manifest.json'), { cache: 'no-store' }));
        if (!response.ok) throw new Error('Manifest unavailable');
        const m = await response.json();
        if (m.id !== id || m.author !== id.split('/')[0] || typeof m.version !== 'string' || !Array.isArray(m.capabilities) || m.capabilities.some(c => !['layout','nav','models','data.read','inbox'].includes(c))) throw new Error('Invalid manifest');
        if (m.apiVersion !== contract.apiVersion) throw new Error('Incompatible API version');
        const mod = await bounded(importer(tweakUrl(id, 'tweak.js')));
        if (seq !== tweakSeq) return false;
        if (typeof mod.default !== 'function') throw new Error('Missing setup');
        const a = record(id, m.name || id); tweaks.set(id, a);
        // CSS is optional; missing CSS is harmless. All package assets are same-origin build artifacts.
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = tweakUrl(id, 'tweak.css'); document.head.append(link); a.offs.add(() => link.remove());
        paintTweaks();
        try {
          a.teardown = mod.default(tweakApi(a, m, teamAuthors.includes(m.author) || trustedAuthors.includes(m.author)));
          if (a.teardown && typeof a.teardown !== 'function') throw new Error('Setup must return teardown');
        } catch (e) { dispose(a, 'error'); throw e; }
      } catch (e) { shell?.toast?.(`${id} turned off · ${e.message}`); }
    }
    paintTweaks(); lastRoute = ''; emitRoute(); window.dispatchEvent?.(new Event('wos:prefs')); return true;
  }

  const host = {
    loadTweaks, emit,
    get tweakState() { return [...tweaks.keys()]; },
    /* live.js / chats.js: 'last' while a live tweak holds api.nav.snoozeOrder('last'); otherwise 'default' (stock). */
    get snoozeOrder() { return snoozeLast.size ? 'last' : 'default'; },
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
    attach(adapter) { shell = adapter; for (const n of builtinDefs.keys()) startBuiltin(n); const id = committedId || (window.WosSkin && window.WosSkin.current); committedId = id; if (id) packageReady = load(id); window.WosMySkin?.startScript(); if (layoutOf(layoutId)) loadLayout(layoutId); window.dispatchEvent?.(new Event('wos:skin-host-ready')); },
    /* Layouts: Settings › Look. Classic loads nothing. */
    layouts: LAYOUTS, setLayout,
    get layout() { return layoutId; },
    get layoutState() { return { id: layoutId, active: !!layoutRec, disabled: disabled.has('layout:' + layoutId), mounts: layoutRec?.mounts.size || 0 }; },
    /* app.js: the dock orb was tapped while idle. True when a layout handled it. */
    orbTap() { for (const fn of [...taps]) { if (fn() === true) return true; } return false; },
    level(v) { if (levels.size) for (const fn of [...levels]) fn(v); },
    /* app.js: the orb's voice state changed. */
    voice(state) { if (layers().length) emit('voice', Object.freeze({ ...(shell?.voiceState ? shell.voiceState() : { state }) })); },
    loadPersonal, scriptProblem,
    /* core/*.js: a gesture every skin wears. `when: 'touch'` skips desktop pointers. */
    builtin(name, setup, { when = 'touch', label = name } = {}) { if (typeof setup !== 'function' || builtinDefs.has(name)) return false; builtinDefs.set(name, { setup, when, label }); return startBuiltin(name) || !shell; },
    get builtinState() { return [...builtins.keys()]; },
    stopPersonal() { personalSeq++; dispose(personal, 'off'); },
    get personalState() { return { ready: !!shell, active: !!personal, disabled: disabled.has('my-skin'), error: personalError ? { ...personalError } : null, listeners: personal?.offs.size || 0, handlers: personal ? personal.on.route.size + personal.on.render.size : 0 }; },
    /* app.js backStep / desktop.js escStep: close the newest package overlay. True when one closed. */
    back() { const e = overlays.pop(); if (!e) return false; e.close(); return true; },
    /* app.js / desktop.js: repaint a Home. Nodes a tweak mounted at the home-main slot move to the new markup
     * (no remount, no flash) and layout tweaks hear api.on('home'). Without a mount this is plain innerHTML. */
    paintHome(el, html) {
      if (!el) return;
      const sel = '[data-slot="home-main"]', kept = [...(el.querySelector?.(sel)?.childNodes || [])];
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
    release,
    get state() { return { active: active ? active.id : null, listeners: active ? active.offs.size : 0, frames: active ? active.frames.size : 0, handlers: active ? active.on.route.size + active.on.render.size : 0, disabled: [...disabled], requested: [...requested], css: [...cssLinks.keys()] }; },
    _test: { setImporter(fn) { importer = fn; }, env, load, unload, loadLayout },
  };
  if (typeof window !== 'undefined') {
    window.WosSkinHost = host;
    // The stored skin's stylesheet now, in <head>, so it paints with the first frame (no flash).
    const id = window.WosSkin && window.WosSkin.current;
    if (id) { ensureCss(id); committedId = id; }
    // ?layout=<id> in a link turns that layout on (and remembers it); ?layout=classic turns it off. Lets people share a try-it link.
    try {
      const q = new URLSearchParams(location.search).get('layout');
      if (q === 'classic') localStorage.removeItem(LAYOUT_KEY); else if (layoutOf(q)) localStorage.setItem(LAYOUT_KEY, q);
    } catch (_) {}
    try { const l = localStorage.getItem(LAYOUT_KEY); if (layoutOf(l)) { layoutId = l; paintLayout(l); } } catch (_) {}
    if (isDoc) for (const pid of ['pointerup', 'pointercancel']) document.addEventListener(pid, e => release(e.pointerId), true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = host;
})();
