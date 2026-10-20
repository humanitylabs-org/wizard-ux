/* Notifications unread count from the installed Notifications app (same origin, /notifications/api/count).
 * The count shows as the app's badge on its dock/bar mark (workspaceNav.setCount), so the Chats panel carries
 * no separate bell. html() stays for any skin that wants a bell; the shell no longer renders it. */
(() => {
  'use strict';
  const S = { unread: 0, needs: 0, ok: false, at: 0 };
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
  const installed = () => !!(window.WizCanOpen && window.WizCanOpen('notifications'));
  function html() {
    if (!installed()) return '';
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
  async function refresh() {
    if (!installed()) return;
    try {
      const r = await fetch('/notifications/api/count', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const d = await r.json();
      const ch = d.unread !== S.unread || d.needs !== S.needs;
      Object.assign(S, { unread: d.unread | 0, needs: d.needs | 0, ok: true, at: Date.now() });
      if (ch) { paint(); window.dispatchEvent(new CustomEvent('wizard:notifications', { detail: { ...S } })); }
    } catch (e) {}
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
  window.WosBell = { html, refresh, get state() { return { ...S }; } };
})();
