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
  const EVENTS = ['route', 'render', 'voice'];
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
  const record = (id, label = id) => ({ id, label, offs: new Set(), frames: new Set(), claims: new Set(), mounts: new Set(), taps: new Set(), on: { route: new Set(), render: new Set(), voice: new Set() }, errs: [], dead: false, teardown: null });

  const skinOf = id => (typeof window !== 'undefined' && window.WosSkin && window.WosSkin.pkgOf) ? window.WosSkin.pkgOf(id) : null;
  const dirOf = (id, pkg) => (pkg && pkg.dir) || id;
  const url = (dir, file) => isDoc ? new URL(`skins/${dir}/${file}`, document.baseURI).href : `skins/${dir}/${file}`;

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
    const anchor = prev || document.querySelector('link[href$="core/skins.css"]');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(l, anchor.nextSibling); else document.head.appendChild(l);
    cssLinks.set(dir, l); requested.push(l.href); return l;
  }

  /* ---------- error fallback ---------- */
  function fault(a, where, e) {
    if (!a || a.dead) return;
    try { console.warn(`[skin ${a.id}] ${where}:`, e); } catch (_) {}
    const now = Date.now(); a.errs = a.errs.filter(t => now - t < ERR_WINDOW); a.errs.push(now);
    if (a.errs.length >= ERR_LIMIT) {
      disabled.add(a.id); dispose(a, 'error');
      try { shell && shell.toast(`${a.label || nameOf(a.id)} gestures turned off after an error`); } catch (_) {}
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
      }),
      toast: msg => { try { need().toast(String(msg).slice(0, 140)); } catch (e) { fault(a, 'toast', e); } },
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
    a.dead = true;
    if (typeof a.teardown === 'function') { try { a.teardown(reason); } catch (e) { try { console.warn(`[skin ${a.id}] teardown:`, e); } catch (_) {} } }
    for (const off of [...a.offs]) { try { off(); } catch (_) {} }
    for (const h of [...a.frames]) { try { h.clear ? h.clear() : cancelAnimationFrame(h.id); } catch (_) {} }
    for (const n of [...a.mounts]) { try { n.remove(); } catch (_) {} }
    for (const g of a.taps) taps.delete(g);
    if (layoutRec === a) layoutRec = null;
    a.offs.clear(); a.frames.clear(); a.mounts.clear(); a.taps.clear(); a.on.route.clear(); a.on.render.clear(); a.on.voice.clear();
    for (const id of a.claims) { if (!(active?.claims.has(id) || personal?.claims.has(id))) claims.delete(id); }
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

  const layers = () => [active, personal, layoutRec].filter(Boolean);
  function emit(type, payload) {
    for (const a of layers()) for (const fn of [...a.on[type]]) fn(payload);
  }
  function routeOf() {
    const r = shell ? shell.route() : { view: 'desk', thread: null, desk: 0 };
    return Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0, app: r.app || null, agent: r.agent || null });
  }
  function emitRoute() {
    if (!layers().length || !shell) return;
    const r = routeOf(), k = `${r.view}|${r.thread || ''}|${r.desk}|${r.app || ''}|${r.agent || ''}`;
    if (k === lastRoute) return; lastRoute = k;
    emit('route', r);
  }

  /* ---------- layout layer ---------- */
  const layoutUrl = (id, file) => isDoc ? new URL(`layouts/${id}/${file}`, document.baseURI).href : `layouts/${id}/${file}`;
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
  async function loadPersonal(bytes, allowed) {
    const seq = ++personalSeq;
    dispose(personal, 'replace');
    let pending; do { pending = packageReady; await pending; } while (pending !== packageReady);
    if (seq !== personalSeq || !shell || disabled.has('my-skin') || !allowed()) return false;
    const href = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
    let mod;
    try { mod = await importer(href); }
    catch (e) { try { console.warn('[Skins/My skin/skin.js] import failed:', e); } catch (_) {} return false; }
    finally { URL.revokeObjectURL(href); }
    if (seq !== personalSeq || !allowed() || typeof mod?.default !== 'function') return false;
    const a = record('my-skin', 'Skins/My skin/skin.js'); personal = a;
    try { a.teardown = mod.default(makeApi(a)); } catch (e) { fault(a, 'setup', e); }
    lastRoute = ''; emitRoute();
    return personal === a;
  }
  function release(id) { claims.delete(id); active?.claims.delete(id); personal?.claims.delete(id); }

  // Same honest-code lint as packaged skins, plus no module dependencies: only this file is approved.
  // This is a guardrail, not a sandbox for hostile JavaScript (owner code runs in the shell origin).
  function scriptProblem(source) {
    const src = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = /\b(?:addEventListener|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|__wos|localStorage|sessionStorage|innerHTML|outerHTML|WebSocket)\b|\b(?:fetch|eval)\s*\(|\bnew\s+Function\b|\bhistory\s*\.|\bdocument\s*\.\s*cookie|\bimport\b|\bexport\s+(?!default\b)[^;]*\bfrom\b/;
    return banned.test(src) ? 'Use the skin hook API; imports are not allowed' : null;
  }

  const host = {
    /* core/skins.js: picker landed near a skin (preview or commit). Stylesheet only. */
    preview(id) { ensureCss(id); },
    /* core/skins.js: the owner picked a skin. Stylesheet plus (if any) its script. */
    commit(id) { ensureCss(id); committedId = id; if (shell) packageReady = load(id); },
    /* app.js: the shell is ready; hands over the narrow adapter skins are allowed to drive. */
    attach(adapter) { shell = adapter; const id = committedId || (window.WosSkin && window.WosSkin.current); committedId = id; if (id) packageReady = load(id); window.WosMySkin?.startScript(); if (layoutOf(layoutId)) loadLayout(layoutId); },
    /* Layouts: Settings › Look. Classic loads nothing. */
    layouts: LAYOUTS, setLayout,
    get layout() { return layoutId; },
    get layoutState() { return { id: layoutId, active: !!layoutRec, disabled: disabled.has('layout:' + layoutId), mounts: layoutRec?.mounts.size || 0 }; },
    /* app.js: the dock orb was tapped while idle. True when a layout handled it. */
    orbTap() { for (const fn of [...taps]) { if (fn() === true) return true; } return false; },
    /* app.js: the orb's voice state changed. */
    voice(state) { if (layers().length) emit('voice', Object.freeze({ ...(shell?.voiceState ? shell.voiceState() : { state }) })); },
    loadPersonal, scriptProblem,
    stopPersonal() { personalSeq++; dispose(personal, 'off'); },
    get personalState() { return { ready: !!shell, active: !!personal, disabled: disabled.has('my-skin'), listeners: personal?.offs.size || 0, handlers: personal ? personal.on.route.size + personal.on.render.size : 0 }; },
    /* chats.js: a chats window repainted part ('thread' | 'list'). */
    rendered(part, el) { if (!active && !personal) return; emit('render', Object.freeze({ part, el })); emitRoute(); },
    /* app.js: desk or focus changed. */
    changed() { emitRoute(); },
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
    try { const l = localStorage.getItem(LAYOUT_KEY); if (layoutOf(l)) { layoutId = l; paintLayout(l); } } catch (_) {}
    if (isDoc) for (const pid of ['pointerup', 'pointercancel']) document.addEventListener(pid, e => release(e.pointerId), true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = host;
})();
