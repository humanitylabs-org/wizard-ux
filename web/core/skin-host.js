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
  const EVENTS = ['route', 'render'];
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
      disabled.add(a.id); unload('error');
      try { shell && shell.toast(`${nameOf(a.id)} gestures turned off after an error`); } catch (_) {}
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
      route: () => { const r = shell ? shell.route() : { view: 'desk', thread: null, desk: 0 }; return Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0 }); },
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
        claim: pointerId => { if (shell && shell.locked && shell.locked(pointerId)) return false; claims.add(pointerId); return true; },
      }),
      toast: msg => { try { need().toast(String(msg).slice(0, 140)); } catch (e) { fault(a, 'toast', e); } },
      storage: Object.freeze({
        get(key) { try { const v = localStorage.getItem(`wos.skin.${a.id}.${key}`); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
        set(key, value) { try { localStorage.setItem(`wos.skin.${a.id}.${key}`, JSON.stringify(value)); } catch (_) {} },
      }),
    };
    return Object.freeze(api);
  }

  /* ---------- script lifecycle ---------- */
  function unload(reason) {
    const a = active; if (!a) return; active = null; a.dead = true;
    if (typeof a.teardown === 'function') { try { a.teardown(reason); } catch (e) { try { console.warn(`[skin ${a.id}] teardown:`, e); } catch (_) {} } }
    for (const off of [...a.offs]) { try { off(); } catch (_) {} }
    for (const h of [...a.frames]) { try { cancelAnimationFrame(h.id); } catch (_) {} }
    a.offs.clear(); a.frames.clear(); a.on.route.clear(); a.on.render.clear(); claims.clear();
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
    const a = { id, offs: new Set(), frames: new Set(), on: { route: new Set(), render: new Set() }, errs: [], dead: false, teardown: null };
    active = a; lastRoute = '';
    try { a.teardown = setup(makeApi(a)); } catch (e) { fault(a, 'setup', e); if (a.dead) return false; }
    if (active === a) emitRoute();
    return active === a;
  }

  function emit(type, payload) {
    const a = active; if (!a) return;
    for (const fn of [...a.on[type]]) fn(payload);
  }
  function emitRoute() {
    if (!active || !shell) return;
    const r = shell.route(), k = `${r.view}|${r.thread || ''}|${r.desk}`;
    if (k === lastRoute) return; lastRoute = k;
    emit('route', Object.freeze({ view: r.view, thread: r.thread || null, desk: r.desk | 0 }));
  }

  const host = {
    /* core/skins.js: picker landed near a skin (preview or commit). Stylesheet only. */
    preview(id) { ensureCss(id); },
    /* core/skins.js: the owner picked a skin. Stylesheet plus (if any) its script. */
    commit(id) { ensureCss(id); committedId = id; if (shell) load(id); },
    /* app.js: the shell is ready; hands over the narrow adapter skins are allowed to drive. */
    attach(adapter) { shell = adapter; const id = committedId || (window.WosSkin && window.WosSkin.current); committedId = id; if (id) load(id); },
    /* chats.js: a chats window repainted part ('thread' | 'list'). */
    rendered(part, el) { if (!active) return; emit('render', Object.freeze({ part, el })); emitRoute(); },
    /* app.js: desk or focus changed. */
    changed() { emitRoute(); },
    /* app.js dock swipe: true when a skin gesture owns this pointer. Cleared on pointerup/cancel. */
    claimed: pointerId => claims.has(pointerId),
    release: pointerId => { claims.delete(pointerId); },
    get state() { return { active: active ? active.id : null, listeners: active ? active.offs.size : 0, frames: active ? active.frames.size : 0, handlers: active ? active.on.route.size + active.on.render.size : 0, disabled: [...disabled], requested: [...requested], css: [...cssLinks.keys()] }; },
    _test: { setImporter(fn) { importer = fn; }, env, load, unload },
  };
  if (typeof window !== 'undefined') {
    window.WosSkinHost = host;
    // The stored skin's stylesheet now, in <head>, so it paints with the first frame (no flash).
    const id = window.WosSkin && window.WosSkin.current;
    if (id) { ensureCss(id); committedId = id; }
    if (isDoc) for (const pid of ['pointerup', 'pointercancel']) document.addEventListener(pid, e => claims.delete(e.pointerId), true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = host;
})();
