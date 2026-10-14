/* Desktop update coordinator. Phone uses device.js for its existing attributed
 * banner, sharing the same WizAppServices holds/availability. Never auto-reload. */
(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  let first = '', latest = '', banner = null;
  const services = () => window.WizAppServices;
  function busy() {
    if (services()?.update.busy()) return true;
    const w = window.__wux;
    if (!w || w.voice !== 'idle') return true;
    return Object.values(w.wins).some(win => (w.chats.ch(win.id)?.files || []).some(f => f.uploading));
  }
  function show() {
    if (!banner) {
      banner = document.createElement('aside'); banner.id = 'wizard-app-update'; banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--border,#555);border-radius:12px;background:var(--surface,#222);color:var(--text,#fff);max-width:calc(100vw - 32px)';
      const label = document.createElement('span'), button = document.createElement('button');
      button.textContent = 'Reload'; button.type = 'button';
      button.addEventListener('click', () => {
        if (busy()) { label.textContent = 'Finish recording or save your work first'; return; }
        for (const el of document.querySelectorAll('[data-compose]')) el.dispatchEvent(new Event('input', { bubbles: true }));
        window.WizAppReadingPosition?.flush();
        location.reload();
      });
      banner.append(label, button); document.body.appendChild(banner);
    }
    banner.firstChild.textContent = busy() ? 'Update ready · recording or unsaved work is held' : 'Wizard OS was updated';
  }
  async function check() {
    try {
      const r = await fetch(new URL('ux-version.txt', base), { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const version = (await r.text()).trim(); if (!/^[a-f0-9]{7,64}$/i.test(version)) return;
      if (!first) { first = latest = version; return; }
      if (version === latest || version === first) return;
      latest = version; services()?.update.announce({ version }); show();
    } catch (_) {}
  }
  addEventListener('wizard:app-holds', () => { if (banner) show(); });
  addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setTimeout(check, 1500); setInterval(() => { if (!document.hidden) check(); }, 60000);
  window.WizAppUpdates = Object.freeze({ check, busy });
})();
