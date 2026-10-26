/* Notifications bell on the Chats panel: a small bell beside search with the unread count from the installed
 * Notifications app (same origin, /notifications/api/count). Tapping it opens Notifications as an ordinary app
 * window, so it sits on a desk you can swipe to. Hidden entirely when no Notifications app is installed, and
 * hidden while a Notifications window is open: its desk mark already carries the same count as a badge, so the
 * owner sees one or the other, never both. Shells expose WizAppOpen(id) and call WosBell.paint() on window changes. */
(() => {
  'use strict';
  const S = { unread: 0, needs: 0, ok: false, at: 0 };
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
  const installed = () => !!(window.WizCanOpen && window.WizCanOpen('notifications'));
  function html() {
    if (!installed()) return '';
    if (typeof window.WizAppOpen === 'function' && window.WizAppOpen('notifications')) return '<button type="button" class="ch-bell" data-chbell hidden aria-hidden="true" tabindex="-1"></button>';
    const n = S.unread, lbl = n ? `Notifications, ${n} unread` : 'Notifications';
    return `<button type="button" class="ch-bell${S.needs ? ' needs' : ''}" data-chbell aria-label="${lbl}">${BELL}${n ? `<b>${n > 99 ? '99+' : n}</b>` : ''}</button>`;
  }
  function paint() {
    window.WizCore?.workspaceNav?.setCount('notifications', S.unread);
    for (const b of document.querySelectorAll('[data-chbell]')) {
      const h = html(); if (!h) { b.remove(); continue; }
      const t = document.createElement('div'); t.innerHTML = h; const nb = t.firstElementChild;
      if (b.outerHTML !== nb.outerHTML) b.replaceWith(nb);
    }
  }
  // At most one count read every 10 s (60 s after a failure): a burst of registry events must
  // never become a request storm against the Notifications app (26 Oct 2026: ~50 req/s).
  let inflight = false, nextAt = 0;
  async function refresh() {
    if (!installed() || inflight || Date.now() < nextAt) return;
    inflight = true; nextAt = Date.now() + 10000;
    try {
      const r = await fetch('/notifications/api/count', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) { nextAt = Date.now() + 60000; return; }
      const d = await r.json();
      const ch = d.unread !== S.unread || d.needs !== S.needs;
      Object.assign(S, { unread: d.unread | 0, needs: d.needs | 0, ok: true, at: Date.now() });
      if (ch) { paint(); window.dispatchEvent(new CustomEvent('wizard:notifications', { detail: { ...S } })); }
    } catch (e) { nextAt = Date.now() + 60000; } finally { inflight = false; }
  }
  // The Notifications window tells us its count as soon as something is marked read.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:notifications:count') return;
    S.unread = d.unread | 0; S.needs = d.needs | 0; paint();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-chbell]')) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof window.WizOpenApp === 'function') window.WizOpenApp('notifications');
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('wizard:apps', () => { refresh(); paint(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setTimeout(refresh, 800);
  window.WosBell = { html, refresh, paint, get state() { return { ...S }; } };
})();
