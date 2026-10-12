/* Store is an app document, not a Wizard shell or launcher panel. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const framed = window.top !== window;
  const ctx = { api: '../store-data/api', wizard: '../store-data/wizard/v1', index: '../store-data/wizard/v1/index', lifecycleApi: '/api', browseOnly: true, chipsEl: $('chips'), onApp: showCard, onOpen: openInstalled };
  let card = null, scroll = 0;
  if (/\.staging\.wizard001\.com$/.test(location.hostname)) $('preview').hidden = false;
  try { const skin = parent.document.documentElement.dataset.skin; if (skin) document.documentElement.dataset.skin = skin; } catch (_) {}
  const store = WosStore.renderStore($('catalog'), ctx);
  $('query').addEventListener('input', () => store.setQuery($('query').value));
  function showCard(app) {
    scroll = document.scrollingElement.scrollTop; card = app;
    $('browse').hidden = true; $('query').disabled = true; $('card').hidden = false;
    WosStore.renderCard($('card'), app, { ...ctx, from: 'store', onBack: back });
    document.scrollingElement.scrollTop = 0;
  }
  function back() {
    if (!card) return false;
    card = null; $('card').hidden = true; $('browse').hidden = false; $('query').disabled = false;
    document.scrollingElement.scrollTop = scroll; return true;
  }
  // Canonical hosted-app Back hook: parent owns joint session history. No framed root sentinel or child guard.
  window.__wizardCloseOverlay = back;
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && back()) { e.preventDefault(); e.stopPropagation(); } });
  async function openInstalled(app) {
    try {
      const u = new URL(app.open, location.origin);
      if (!app.installed || u.origin !== location.origin || !/^\/[a-zA-Z0-9_-]+\//.test(u.pathname) || u.pathname.startsWith('/wizard-os-home/')) throw new Error();
      // Parent verifies the installed registry's id/URL and uses its existing normal openApp path.
      if (!framed || !parent.WizStoreOpen?.(app.id, u.pathname + u.search + u.hash)) throw new Error();
    } catch (_) { $('message').textContent = 'App view is not connected yet'; }
  }
  if (!framed) {
    // Reuse an armed guard after reload; each real Back re-arms exactly one, never accumulating entries.
    if (history.state?.store !== 'guard') { history.replaceState({ store:'root' }, ''); history.pushState({ store:'guard' }, ''); }
    addEventListener('popstate', () => { back(); history.pushState({ store:'guard' }, ''); });
    let watcher;
    const arm = () => { if (!watcher && 'CloseWatcher' in window) { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; back(); arm(); }; } };
    addEventListener('pointerdown', arm, true); arm();
  }
})();
