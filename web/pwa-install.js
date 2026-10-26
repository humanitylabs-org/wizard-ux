/* Wizard OS: offer installation only when the browser supplies an install prompt (adapted from CineQ's pwa-install.js).
 * Chrome's own menu can say "already installed" for ANY sibling app on the former custom origin (it checks the origin,
 * not the app). This banner uses the page's real install prompt, which checks this app's own manifest id. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || (script.dataset.pwaOrigin && location.origin !== script.dataset.pwaOrigin)) return;
  const base = new URL('.', script.src);
  if (!location.pathname.startsWith(base.pathname) || window.top !== window.self) return;
  const name = script.dataset.pwaName || document.title;
  const key = `wizard-pwa-install:${base.origin}${base.pathname}`;

  const read = () => { try { return Number(localStorage.getItem(key)) || 0; } catch (_) { return 0; } };
  const dismiss = () => { try { localStorage.setItem(key, String(Date.now() + 86400000)); } catch (_) {} };
  let deferred = null, host = null, root = null, busy = false, installed = false, dismissedHere = false, held = false;
  const clear = () => { host?.remove(); host = root = null; };

  function render() {
    // No event means unknown state. It never warrants an install suggestion.
    // A real install capability outranks an inherited parent-container display mode.
    if (!deferred || installed || held || dismissedHere || read() > Date.now()) { clear(); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', render, {once: true}); return; }
    if (!host) {
      host = document.createElement('aside');
      host.id = 'wizard-pwa-install';
      host.dataset.state = 'ready';
      host.setAttribute('aria-label', `${name} installation`);
      host.style.display = 'block';
      root = host.attachShadow({mode: 'open'});
      root.innerHTML = `<style>
        :host{display:block;color:var(--text,#f4f4f7);font:13px/1.4 system-ui,sans-serif;background:#0e0a1f;position:fixed;left:0;right:0;top:0;z-index:200;padding-top:env(safe-area-inset-top);border-bottom:1px solid var(--line-strong,rgba(255,255,255,.16))}
        *{box-sizing:border-box}.bar{max-width:1160px;margin:auto;padding:8px 14px;display:flex;align-items:center;gap:10px}.copy{flex:1;min-width:0}.title{font-weight:650}.hint{font-size:11px;color:var(--muted,#999)}
        button{font:600 12px system-ui;min-height:40px;padding:8px 12px;border:1px solid var(--line-strong,#555);border-radius:7px;color:inherit;background:transparent;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid var(--amber,#e2b13c);outline-offset:2px}.action{background:linear-gradient(90deg,#7a4dff,#ff5ccf);border-color:transparent;color:#fff}.close{min-width:40px;padding:8px;font-size:20px;font-weight:400}
      </style><div class="bar"><div class="copy"><div class="title"></div><div class="hint">Open it directly next time.</div></div><button class="action" type="button">Install</button><button class="close" type="button" aria-label="Dismiss install suggestion">×</button></div>`;
      root.querySelector('.title').textContent = `Install ${name}`;
      document.body.prepend(host);
      root.querySelector('.action').addEventListener('click', act);
      root.querySelector('.close').addEventListener('click', () => { dismissedHere = true; dismiss(); clear(); });
    }
    root.querySelector('.action').textContent = busy ? 'Opening…' : 'Install';
    root.querySelector('.action').disabled = busy;
  }

  async function act() {
    if (busy || !deferred) return 'unavailable';
    const event = deferred;
    busy = true;
    let outcome = 'unavailable';
    try {
      // Keep the real native prompt inside this click's user activation.
      const pending = event.prompt();
      render();
      await pending;
      const choice = await event.userChoice;
      outcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
      if (outcome === 'accepted') installed = true;
      else { dismissedHere = true; dismiss(); }
    } catch (error) {
      // A rejected/consumed capability is not a reason to advertise installation.
      console.warn('Wizard OS installation prompt unavailable', error?.name || 'Error');
    } finally { deferred = null; busy = false; render(); }
    return outcome;
  }

  // One install prompt per page: the phone tour's Install beat (core/tour.js) uses this same deferred event, and
  // holds the banner while the tour runs so the two never show at once.
  window.WizardPwaInstall = {
    // A dismissal (the banner's ×, a dismissed prompt or a skipped Install beat) holds for both surfaces.
    get available() { return !!deferred && !installed && !busy && !dismissedHere && read() <= Date.now(); },
    prompt: act,
    hold(on) { held = !!on; render(); },
    dismiss() { dismissedHere = true; dismiss(); clear(); },
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event; installed = false; render();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; clear(); });

  window.addEventListener('pageshow', render);
  // A service worker scoped to this app only: Chrome needs it to offer install, and the narrow scope keeps
  // Wizard OS a separate app from every sibling on the same origin.
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: base.pathname }).catch(() => {}));
  window.addEventListener('storage', event => { if (event.key === key) render(); });
})();
