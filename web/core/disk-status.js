/* Wizard OS · Settings › Network & security: one plain line about disk encryption (wizard-os spec/DISK_ENCRYPTION.md).
 *   "Disk encrypted, unlocks with this box's security chip" · "Not encrypted" · "Protected by FileVault on this Mac" …
 * Source: the App Manager's read-only `wam disk status` (store-install/_disk, owner only). The line is written there,
 * so the shell never words a security claim itself; an error answer that carries its own line replaces an older one.
 * Asked when the page is drawn, at most every 10 minutes (1 minute after a failure, 10 s timeout). A box whose App
 * Manager has no such route (404) shows nothing and is not asked again. If the box cannot be reached, the last line
 * stays but says when it was last checked once that is over 30 minutes ago. */
(() => {
  'use strict';
  const S = window.WosSettings;
  if (!S) return;
  const src = document.currentScript?.src || location.href;
  const URL_ = new URL('../store-install/_disk', src).href;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const LEVELS = new Set(['ok', 'warn', 'error']);
  const FRESH = 600e3, RETRY = 60e3, STALE = 1800e3;
  // st: the last line the App Manager wrote; okAt: when it last answered with one; failed: the last ask got no line.
  let st = null, at = 0, okAt = 0, busy = false, failed = false, gone = false;

  const refresh = () => { try { S.refresh(); } catch (_) {} };
  const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const stale = () => !!(st && failed && okAt && Date.now() - okAt > STALE);
  const key = () => (st ? st.line + '|' + st.level + '|' + stale() : '');   // what the row shows
  function load() {
    if (gone || busy || (at && Date.now() - at < (failed ? RETRY : FRESH)) || typeof fetch !== 'function') return;
    busy = true;
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10e3) : undefined;
    fetch(URL_, { credentials: 'same-origin', cache: 'no-store', signal })
      .then(r => (r.status === 404 && !st ? (gone = true, null) : r.json().catch(() => null)), () => null)
      .catch(() => null)
      .then(d => {
        const line = clip(d?.line), was = key();
        if (line) { st = { line, level: LEVELS.has(d.level) ? d.level : 'warn' }; okAt = Date.now(); failed = false; }
        else failed = true;
        at = Date.now(); busy = false;
        if (key() !== was) refresh();
      });
  }
  function html() {
    load();
    if (!st) return '';
    const old = stale() ? ` (not rechecked since ${hhmm(okAt)})` : '';
    return `<div class="st-group" data-disk-encryption data-level="${old ? 'stale' : st.level}"><h4>Disk</h4><div class="st-row static"><span class="st-tx"><b>Disk encryption</b><small>${esc(st.line + old)}</small></span></div></div>`;
  }
  try {
    S.register({ id: 'disk-encryption', page: 'network', aliases: ['disk', 'disk-encryption', 'security'], available: () => { load(); return !!st; }, html: () => html() });
  } catch (_) { /* already registered by an earlier copy of this script */ }
})();
