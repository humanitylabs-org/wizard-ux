/* One registered frontend, existing platform services, zero workspace state. */
(() => {
  'use strict';
  const policy = window.WizHomeScreenPolicy;
  if (!policy?.mode) return;
  const id = policy.id, key = policy.key(location.origin, id), registry = window.WizCore.apps('mobile');
  const device = document.getElementById('device');
  device.classList.add('immersive');
  const win = document.createElement('article');
  win.id = 'singleApp'; win.className = 'win full'; win.dataset.win = key;
  device.appendChild(win);
  let frame = null, app = null, detach = null, mountedURL = '', loaded = false, cut = 0;
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  function toast(icon, text) { const el = document.getElementById('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1400); }
  function checkpoint() {
    if (!loaded || !frame || !app) return;
    try {
      const w = frame.contentWindow, href = w.location.href;
      if (!policy.within(href, app.url)) return;
      const state = w.history.state;
      const value = JSON.stringify({ v:1, href, state, at:Date.now(), base:app.url });
      if (value.length < 65536) localStorage.setItem(key, value);
      window.WizAppReadingPosition?.flush();
    } catch (_) {}
  }
  function unavailable(text = 'This app is no longer installed on this Wizard.') {
    checkpoint(); detach?.(); detach = null; frame?.remove(); frame = null; loaded = false;
    win.replaceChildren(); const view = document.createElement('div'); view.className = 'single-unavailable';
    const title = document.createElement('h2'); title.textContent = 'App unavailable';
    const body = document.createElement('p'); body.textContent = text + ' Use Android Home to return to Wizard.';
    const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = () => location.reload();
    view.append(title, body, retry); win.append(view);
  }
  function safeInsets() {
    if (!frame) return;
    try {
      const d = frame.contentDocument;
      if (!d?.documentElement) return;
      d.documentElement.style.setProperty('--wos-cutout', cut + 'px');
      let own = !!d.querySelector('meta[name="wizard-os-edge"][content="cover"]');
      if (!own) for (const sh of d.styleSheets) { try { if ([...sh.cssRules].some(r => r.cssText.includes('--wos-cutout'))) { own = true; break; } } catch (_) {} }
      win.style.setProperty('--single-cut', (own ? 0 : cut) + 'px');
    } catch (_) {}
  }
  window.__wosCutout = px => { cut = Math.max(0, px | 0); safeInsets(); };
  window.__wosTop = () => {};
  try { cut = +window.WizardOSNative?.cutoutTop?.() || 0; window.WizardOSNative?.immersive?.(true); } catch (_) {}
  window.__wosSessionCheckpoint = checkpoint;
  window.__wos = { toast, get singleApp() { return id; }, get voice() { return 'idle'; } };
  window.__wosNativeBack = () => {
    if (window.WosSelMenu?.back?.()) return 'selection';
    if (!frame || !loaded) return 'root';
    const step = window.WizAppServices?.back(frame);
    if (['handled','pending','stay'].includes(step)) { checkpoint(); return 'app'; }
    try {
      const w = frame.contentWindow, nav = w.navigation;
      // Only traverse an in-app entry. Never pop the containing document or desktops.
      const at = nav?.currentEntry?.index, previous = nav?.entries?.()[at - 1];
      if (previous && policy.within(previous.url, app.url) && previous.url !== w.location.href) { w.history.back(); return 'history'; }
      if (policy.within(w.location.href, app.url) && w.location.href !== new URL(app.url,location.origin).href) { w.location.replace(app.url); return 'app-root'; }
    } catch (_) {}
    return 'root'; // Android always consumes, including repeated root Back.
  };
  window.WizAppServices?.guardBack(() => { window.__wosNativeBack(); return true; }, toast);
  function mount() {
    const next = registry.APP[id];
    if (!next || next.kind !== 'wizard' || !next.url || !policy.within(next.url, next.url) || new URL(next.url,location.origin).pathname === '/wizard-os-home/') { unavailable(); return; }
    if (frame && mountedURL === next.url) { app = next; return; }
    checkpoint(); detach?.(); app = next; mountedURL = next.url; loaded = false;
    win.replaceChildren(); frame = document.createElement('iframe'); frame.className = 'appframe'; frame.title = next.name;
    frame.setAttribute('allow','microphone; clipboard-read; clipboard-write; autoplay; fullscreen'); frame.referrerPolicy = 'same-origin';
    const saved = read();
    frame.src = saved?.v === 1 && saved.base === next.url && policy.within(saved.href, next.url) ? saved.href : next.url;
    // Attach before frontend scripts run: shared capture/share/appearance/reading, not a nested shell.
    win.appendChild(frame);
    detach = window.WizAppServices?.attach(frame, { appId:id, path:next.url, readingStorage:localStorage });
    let restore = saved?.v === 1 && saved.base === next.url && policy.within(saved.href,next.url) ? saved : null;
    frame.addEventListener('load', () => {
      try {
        if (!policy.within(frame.contentWindow.location.href, app.url)) { unavailable('This app navigated outside its registered view.'); return; }
        loaded = true; document.title = app.name;
        if (restore && frame.contentWindow.location.href === restore.href && restore.state && typeof restore.state === 'object') {
          const w = frame.contentWindow;
          // A recreated frame has no prior app history. Keep the new SDK mark; app Back falls back to parent/root.
          const state = { ...restore.state, domain:false, depth:0, __wizardApp:w.history.state?.__wizardApp };
          restore = null;
          w.history.replaceState(state,'',w.location.href);
          w.dispatchEvent(new w.PopStateEvent('popstate',{state}));
        }
        frame.contentWindow.WizardApp?.ready?.(); safeInsets(); checkpoint();
        frame.contentWindow.addEventListener('pagehide', checkpoint);
      } catch (_) { unavailable('The app could not be loaded. Check your connection and try again.'); }
    });
  }
  win.innerHTML = '<div class="single-unavailable" role="status">Loading app…</div>';
  window.WizCore.appsLoaded().then(mount);
  addEventListener('wizard:apps', () => { if (frame) mount(); });
  addEventListener('pagehide', checkpoint); addEventListener('beforeunload', checkpoint);
  document.addEventListener('visibilitychange', () => { if (document.hidden) checkpoint(); });
  setInterval(checkpoint, 750);
})();
