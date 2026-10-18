/* Workspace identity shared by phone dock and desktop bar.
 * Shells own layout/window state; this module owns the focused-app glyph, colour,
 * count badge and Home-first keyboard slots. Keep those rules identical. */
(() => {
  'use strict';
  const C = window.WizCore = window.WizCore || {};
  /* Per-app counts (Chats = Ready threads, Notifications = unread, later any app). The badge belongs to the
   * app: each desk mark carries the count of the apps it holds, and the orb shows the desk in view. */
  const counts = {};
  function setCount(id, n) {
    n = Math.max(0, n | 0); if ((counts[id] || 0) === n) return;
    counts[id] = n; window.dispatchEvent(new CustomEvent('wizard:app-counts', { detail: { id, n } }));
  }
  function deskCount(desk, wins, appOf) {
    if (!desk || desk.home) return 0;
    const seen = new Set(); let n = 0;
    for (const id of desk.wins || []) { const a = wins[id] && appOf(wins[id]); const k = a && a.id; if (k && !seen.has(k)) { seen.add(k); n += counts[k] || 0; } }
    return n;
  }
  const fmt = n => n > 99 ? '99+' : String(n);
  function icon(desk, wins, appOf) {
    const S = window.WizSigil;
    if (!S) return '';
    if (desk.home) return '<span class="dsg" style="--c:#C9BEFF"><i class="sgi sg-home" aria-hidden="true"></i></span>';
    const ids = desk.wins || [], focused = wins[desk.focus] || wins[ids[0]];
    if (!focused) return '<span class="dsg empty" aria-hidden="true"></span>';
    const a = appOf(focused) || {}, sigil = a.sigil || a, s = S.of(sigil);
    return `<span class="dsg" style="--c:${a.sgc || s.color}">${a.sgh || S.html(sigil)}${ids.length > 1 ? `<b class="dn">${ids.length}</b>` : ''}${(() => { const n = deskCount(desk, wins, appOf); return n ? `<b class="dbg">${fmt(n)}</b>` : ''; })()}</span>`;
  }
  const slot = (index, homeIncluded = false) => index + (homeIncluded ? 1 : 2);
  function digitTarget(digit, count) {
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null;
    if (digit === 1) return { kind: 'home' };
    const index = digit - 2;
    return index < count ? { kind: 'desktop', index } : index === count ? { kind: 'new', index } : null;
  }
  C.workspaceNav = Object.freeze({ icon, slot, digitTarget, setCount, deskCount, fmt, counts });
})();
