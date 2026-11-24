/* Wizard UX skin host › the honest-code lint for an owner's own script, and the box-wide short answer first
 * (reply summary) setting. Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before core/skin-host.js. The body below keeps
 * skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.summary = function ({  }) {

  // Same honest-code lint as packaged skins, plus no module dependencies: only this file is approved.
  // This is a guardrail, not a sandbox for hostile JavaScript (owner code runs in the shell origin).
  function scriptProblem(source) {
    const src = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = /\b(?:addEventListener|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|__wos|localStorage|sessionStorage|innerHTML|outerHTML|WebSocket)\b|\b(?:fetch|eval)\s*\(|\bnew\s+Function\b|\bhistory\s*\.|\bdocument\s*\.\s*cookie|\bimport\b|\bexport\s+(?!default\b)[^;]*\bfrom\b/;
    return banned.test(src) ? 'Use the skin hook API; imports are not allowed' : null;
  }

  /* Tweaks extend the existing package host: same guards, listeners, frames and disposal. */
  const homeHtml = new WeakMap();   // Home element -> the markup paintHome last wrote
  // Short answer first, box-wide: { on, start: collapsed|expanded, length: line|sentences|paragraph } in ui-preferences
  // (cached by live.js as wos.chats.replySummary.v1). chats.js and packages (api.replies) read and write it here.
  const REPLY_LENGTHS = Object.freeze([
    Object.freeze({ id: 'line', name: 'One short line', hint: 'About 80 characters' }),
    Object.freeze({ id: 'sentences', name: 'Two sentences', hint: 'About 140 characters' }),
    Object.freeze({ id: 'paragraph', name: 'Short paragraph', hint: 'About 300 characters' })]);
  const RSUM_KEY = 'wos.chats.replySummary.v1';
  const replySummary = {
    get() {
      let v = null; try { v = JSON.parse(localStorage.getItem(RSUM_KEY) || 'null'); } catch (_) {}
      v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      return Object.freeze({ on: v.on === true, start: v.start === 'expanded' ? 'expanded' : 'collapsed', length: REPLY_LENGTHS.some(l => l.id === v.length) ? v.length : 'sentences', saved: typeof v.on === 'boolean' });
    },
    set(patch, force = false) {
      const cur = replySummary.get();
      const next = { on: typeof patch.on === 'boolean' ? patch.on : cur.on, start: ['collapsed', 'expanded'].includes(patch.start) ? patch.start : cur.start, length: REPLY_LENGTHS.some(l => l.id === patch.length) ? patch.length : cur.length };
      if (!force && cur.saved && next.on === cur.on && next.start === cur.start && next.length === cur.length) return;
      try { localStorage.setItem(RSUM_KEY, JSON.stringify(next)); } catch (_) {}
      window.WizLive?.putPrefs?.({ replySummary: next });
      window.dispatchEvent?.(new Event('wos:prefs'));
    },
    // Turning the view on reads the box's saved choice first, so a fresh device never overwrites it with defaults, and
    // tells the box only when the box doesn't already have it on (e.g. the box's service learnt the key after this device).
    async on(flag) {
      let box = null;
      if (flag) {
        try { const r = await fetch(new URL('/wizard/v1/ui-preferences', document.baseURI).href, { cache: 'no-store', credentials: 'same-origin' }); const j = r.ok ? await r.json() : null;
          if (j?.replySummary && typeof j.replySummary === 'object') { box = j.replySummary; localStorage.setItem(RSUM_KEY, JSON.stringify(box)); } } catch (_) {}
        if (!summaryUsers.size || box?.on === true) return;
      }
      replySummary.set({ on: flag }, flag);
    },
  };
  const tweaks = new Map(), interceptors = new Map(), snoozeLast = new Set(), summaryUsers = new Set(), inboxThreads = new Map(), overlays = []; // inboxThreads: package -> {act} // snoozeLast: packages holding snoozeOrder('last')
  return { homeHtml, inboxThreads, interceptors, overlays, REPLY_LENGTHS, replySummary, scriptProblem, snoozeLast, summaryUsers, tweaks };
};
