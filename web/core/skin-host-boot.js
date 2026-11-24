/* Wizard UX skin host › first things: the built-in gestures every skin wears, the release stamp on loaded skin
 * files, the orb stand-in for a page without one, the skin stylesheet and the device-local error fallback. Moved
 * verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before core/skin-host.js. The body below keeps
 * skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.boot = function ({ cssLinks, isDoc, requested }) {
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
  /* orb.js draws its main orb on #orb as it loads. A page without one (desktop) gets a hidden stand-in that is put
   * to sleep at once, so only the orbs a layout creates ever draw. Loaded once per page, never on Classic. */
  let orbLoad = null;
  function loadOrb() {
    if (typeof window === 'undefined' || typeof window.Orb?.create === 'function') return Promise.resolve(typeof window !== 'undefined');
    if (!isDoc) return Promise.resolve(false);
    return orbLoad ||= new Promise(done => {
      const standIn = !document.getElementById('orb');
      if (standIn) {
        const c = document.createElement('canvas'); c.id = 'orb'; c.hidden = true; c.width = c.height = 1;
        const f = document.createElement('img'); f.id = 'orbFallback'; f.alt = ''; f.hidden = true;
        // Own wrapper: orb.js watches the canvas's parent for icon changes; never let that be <body>.
        const box = document.createElement('div'); box.hidden = true; box.dataset.orbStandIn = ''; box.append(c, f); document.body.append(box);
      }
      const s = document.createElement('script'); s.src = stamp(new URL('orb.js', document.baseURI).href);
      s.onload = () => { if (standIn) try { window.Orb?.sleep?.(true); } catch (_) {} done(typeof window.Orb?.create === 'function'); };
      s.onerror = () => { orbLoad = null; done(false); };
      document.head.appendChild(s); requested.push(s.src);
    });
  }

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
  // Device-local diagnostic only; never change the owner's chosen view or send
  // telemetry. Keep the last failure even if a later ordinary switch disposes.
  function layoutDiagnostic(id, reason, where, e) {
    if (!String(id).startsWith('layout:') || id === 'layout:classic') return;
    const entry = { layout: String(id).slice(7), reason, where, at: new Date().toISOString(),
      release: releaseToken(), message: String(e?.message || reason).slice(0, 1000),
      stack: String(e?.stack || new Error('Layout ' + reason + ': ' + where).stack || '').slice(0, 12000) };
    try {
      const key = 'wos.layout-fault.v1', old = JSON.parse(localStorage.getItem(key) || 'null');
      const failure = reason !== 'switch' ? entry : old?.lastFault || null;
      localStorage.setItem(key, JSON.stringify({ version: 1, ...entry, lastFault: failure }));
    } catch (_) {} // storage may be blocked/full; fallback must still work
    try { console.error('[layout] ' + reason + ':', entry); } catch (_) {}
  }
  return { builtinDefs, builtins, dirOf, ensureCss, env, layoutDiagnostic, loadOrb, record, skinOf, stamp, url };
};
