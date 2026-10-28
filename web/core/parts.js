/* Replaceable parts: named pieces of the front end a tweak may swap out whole (28 Oct 2026, Miguel: owners'
 * Wizards need to fix and change front-end behaviour on their own box without editing core files, so an update
 * never wipes the change and never needs a rebase).
 *
 * A core file defines a part with a contract (version, required methods, the event it fires when its state
 * changes) and its stock implementation. Core code calls the part through use(name): a stable facade that runs
 * the replacement while one is live and falls back to stock if the replacement throws or is removed. A tweak
 * replaces a part through the skin host (api.parts.replace), which ties the replacement to the tweak's
 * lifetime and pauses it when the part's contract version no longer matches (after an update).
 *
 * Parts today: pins (core/chat-pins.js). Add a part by calling define() in the core file that owns it, and a
 * row in docs/TWEAKS.md. */
(() => {
  'use strict';
  const NAME = /^[a-z][a-z0-9-]{0,40}$/;
  const defs = new Map(); // name -> { version, methods, event, stock, live: { impl, owner } | null, facade }
  const changed = name => { const d = defs.get(name); if (d?.event) { try { window.dispatchEvent(new Event(d.event)); } catch (_) {} } };
  const report = (d, owner, method, e) => { try { console.warn(`[part ${d.name}] ${owner} ${method}:`, e); } catch (_) {} };
  function facade(d) {
    const f = {};
    for (const m of d.methods) f[m] = (...args) => {
      const live = d.live;
      if (live) { try { return live.impl[m](...args); } catch (e) { report(d, live.owner, m, e); } }
      return d.stock[m](...args);
    };
    // Stock-only extras (sync, pending, …) stay reachable for core callers that know them.
    for (const [k, v] of Object.entries(d.stock)) if (!(k in f)) f[k] = typeof v === 'function' ? (...args) => v(...args) : v;
    return Object.freeze(f);
  }
  const api = Object.freeze({
    define(name, { version, methods, event = '' }, stock) {
      if (!NAME.test(name) || defs.has(name) || !Number.isInteger(version) || version < 1 || !Array.isArray(methods) || !stock) return null;
      if (methods.some(m => typeof stock[m] !== 'function')) return null;
      const d = { name, version, methods: methods.slice(), event: String(event || ''), stock, live: null };
      d.facade = facade(d); defs.set(name, d);
      return d.facade;
    },
    /* The part as core code should call it. null when it isn't defined on this build. */
    use: name => defs.get(name)?.facade || null,
    version: name => defs.get(name)?.version ?? null,
    list: () => [...defs.values()].map(d => Object.freeze({ name: d.name, version: d.version, methods: d.methods.slice(), replacedBy: d.live?.owner || null })),
    /* Swap in a replacement. Returns a remover, or a reason string when refused:
     *   'unknown'   no such part on this build
     *   'version'   the tweak was written for another contract version (it should pause and be updated)
     *   'methods'   a required method is missing
     *   'taken'     another tweak already replaced it (first wins; the owner turns one off) */
    replace(name, impl, { owner = 'tweak', version } = {}) {
      const d = defs.get(name); if (!d) return 'unknown';
      if (version !== undefined && version !== d.version) return 'version';
      if (!impl || d.methods.some(m => typeof impl[m] !== 'function')) return 'methods';
      if (d.live && d.live.owner !== owner) return 'taken';
      const live = { impl, owner }; d.live = live; changed(name);
      return () => { if (d.live === live) { d.live = null; changed(name); } };
    },
    /* A replacement calls this when its state changed, so the screen repaints (fires the part's event). */
    changed,
  });
  window.WosParts = api;
})();
