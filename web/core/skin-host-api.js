/* Wizard UX skin host › what a skin script receives and how it is loaded and disposed. Moved verbatim out of core/skin-host.js
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
window.WizCore.skinHostParts.api = function ({ backClaims, builtins, claims, clock, disabled, env, ERR_LIMIT, ERR_WINDOW, EVENTS, isDoc, layoutDiagnostic, levels, loadOrb, skinHostVars, taps }) {
  let layers, layoutUrl, paintTweaks, routeOf, tweaks; // late-bound: skin-host.js declares these after the call, see bindLate
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
      try { skinHostVars.shell && skinHostVars.shell.toast(`${a.label || nameOf(a.id)} gestures turned off after an error`); } catch (_) {}
    }
  }
  const nameOf = id => ((typeof window !== 'undefined' && window.WosSkin?.list?.find(s => s.id === id)) || {}).name || id;
  const guard = (a, where, fn) => function () { if (a.dead) return; try { return fn.apply(this, arguments); } catch (e) { fault(a, where, e); } };

  /* ---------- the API a skin script receives ---------- */
  function makeApi(a) {
    const E = env();
    const need = () => { if (!skinHostVars.shell) throw new Error('shell not ready'); return skinHostVars.shell; };
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
        if (!skinHostVars.shell) return null;
        if (name === 'dock') return skinHostVars.shell.dock();
        const root = skinHostVars.shell.root(); if (!root) return null;
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
        claim: (pointerId, { backSwipe = false } = {}) => { if (skinHostVars.shell && skinHostVars.shell.locked && skinHostVars.shell.locked(pointerId)) return false; claims.add(pointerId); a.claims.add(pointerId); if (backSwipe) { backClaims.add(pointerId); skinHostVars.claimAt = clock(); } return true; },
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
        const host = isDoc && (document.getElementById('device') || skinHostVars.shell?.mountHost?.()); if (!host || !node || node.nodeType !== 1) return () => {};
        host.appendChild(node); a.mounts.add(node);
        return () => { node.remove(); a.mounts.delete(node); };
      },
      /* Agents: who can receive a message, and who the screen in front routes to. */
      agents: Object.freeze({
        list: () => skinHostVars.shell?.agents ? skinHostVars.shell.agents().map(x => Object.freeze({ ...x })) : [],
        here: () => skinHostVars.shell?.agentHere ? Object.freeze({ ...skinHostVars.shell.agentHere() }) : null,
        sigil: id => skinHostVars.shell?.agentSigil ? skinHostVars.shell.agentSigil(id) : null,
        open: id => { if (typeof id === 'string' && id) need().openAgent?.(id); },
        /* The agent choices of a layout that draws its own chat list: { id (the agent the main Chats is focused on, '' = All),
         * agents [{ id, label, colour, private, main }] } and focus(id) = Chats' own Focus on that agent ('' = All). */
        focus: () => { const f = skinHostVars.shell ? skinHostVars.shell.agentFocus?.() : null; return Object.freeze({ id: typeof f?.id === 'string' ? f.id : '', space: f?.space === true, agents: Object.freeze((Array.isArray(f?.agents) ? f.agents : []).map(x => Object.freeze({ ...x }))) }); },
        setFocus: id => skinHostVars.shell?.agentFocusSet ? !!skinHostVars.shell.agentFocusSet(typeof id === 'string' ? id : '') : false,
      }),
      /* Voice: the orb's own recorder. talk(agent) records a message for that agent (none = the screen's own);
       * tap() is the orb's tap on a running take (send / resume); dictate() types into the focused field. */
      voice: Object.freeze({
        state: () => skinHostVars.shell?.voiceState ? Object.freeze({ ...skinHostVars.shell.voiceState() }) : { state: 'idle' },
        talk: id => need().talk(typeof id === 'string' ? id : ''),
        tap: () => need().voiceTap(),
        dictate: () => !!need().dictate(),
        cancel: () => need().voiceCancel?.(),
      }),
      /* The app in front may claim the agent orb as its main button (WizardApp.orb.claim). */
      app: Object.freeze({
        orb: () => skinHostVars.shell?.appOrb ? skinHostVars.shell.appOrb() : null,
        tap: () => !!skinHostVars.shell?.appOrbTap?.(),
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
          const h = !a.dead && typeof id === 'string' ? skinHostVars.shell?.mediaApp?.(id)?.icon : '';
          if (!h || !isDoc) return null;
          const t = document.createElement('template'); t.innerHTML = String(h); return t.content.firstElementChild || null;
        },
        open: id => !a.dead && typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && !!skinHostVars.shell?.mediaOpen?.(id),
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
    return M.list().map(x => Object.freeze({ ...x, app: String(skinHostVars.shell?.mediaApp?.(x.appId)?.name || x.appId) }));
  }

  /* ---------- script lifecycle ---------- */
  function unload(reason) {
    dispose(skinHostVars.active, reason);
  }
  // Both layers share the API, guards and cleanup. Unloading one leaves the other alive.
  function dispose(a, reason, error, where = 'dispose') {
    if (!a) return;
    layoutDiagnostic(a.id, reason, where, error);
    if (skinHostVars.active === a) skinHostVars.active = null;
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
    if (skinHostVars.layoutRec === a) skinHostVars.layoutRec = null;
    a.offs.clear(); a.frames.clear(); a.mounts.clear(); a.taps.clear(); a.on.route.clear(); a.on.render.clear(); a.on.voice.clear(); a.on.sent.clear(); a.on.beside.clear(); a.on.home.clear();
    for (const id of a.claims) { if (!layers().some(l => l !== a && l.claims.has(id))) { claims.delete(id); backClaims.delete(id); if (!backClaims.size) skinHostVars.claimAt = -Infinity; } }
    a.claims.clear();
  }
  return { dispose, fault, guard, makeApi, nameOf, unload, bindLate: v => { if ('layers' in v) layers = v.layers; if ('layoutUrl' in v) layoutUrl = v.layoutUrl; if ('paintTweaks' in v) paintTweaks = v.paintTweaks; if ('routeOf' in v) routeOf = v.routeOf; if ('tweaks' in v) tweaks = v.tweaks; } };
};
