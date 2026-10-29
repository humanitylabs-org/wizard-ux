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
  let frame = null, app = null, detach = null, mountedURL = '', loaded = false, cut = 0, top = 0;
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  function toast(icon, text) { const el = document.getElementById('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1400); }
  // Reuse the shared link/media utilities, but never their desk-placement action.
  // Wisdom's selection Search uses window.open; without this guard it is a dead tap in Android.
  const links = window.WizLinks?.mount({ parent:document.body, mode:'sheet', allowURL:u => {
    if (!u || (u.origin === location.origin && (policy.isShell(u.href) || /%(?:2f|5c|2e|25)/i.test(u.pathname)))) {
      toast('!', 'Use your device Home to switch apps'); return false;
    }
    return true;
  } });
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
    const body = document.createElement('p'); body.textContent = text + ' Use your device Home to return to Wizard.';
    const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = () => location.reload();
    view.append(title, body, retry); win.append(view);
  }
  function safeInsets() {
    if (!frame) return;
    try {
      const d = frame.contentDocument;
      if (!d?.documentElement) return;
      // Android keeps its status bar and navigation buttons (James, 18 Oct): the app starts below the taller of
      // the status bar and the camera cutout; the native view already pads the navigation bar at the bottom.
      const edge = Math.max(cut, top);
      d.documentElement.style.setProperty('--wos-cutout', edge + 'px');
      let own = !!d.querySelector('meta[name="wizard-os-edge"][content="cover"]');
      if (!own) for (const sh of d.styleSheets) { try { if ([...sh.cssRules].some(r => r.cssText.includes('--wos-cutout'))) { own = true; break; } } catch (_) {} }
      win.style.setProperty('--single-cut', (own ? 0 : edge) + 'px');
    } catch (_) {}
  }
  window.__wosCutout = px => { cut = Math.max(0, px | 0); safeInsets(); };
  window.__wosTop = px => { top = Math.max(0, px | 0); safeInsets(); };
  try { window.WizardOSNative?.immersive?.(false); cut = +window.WizardOSNative?.cutoutTop?.() || 0; top = +window.WizardOSNative?.insetTop?.() || 0; } catch (_) {}
  window.__wosSessionCheckpoint = checkpoint;
  window.__wos = { toast, links, get singleApp() { return id; }, get voice() { return 'idle'; } };
  window.__wosNativeBack = () => {
    if (window.WosSelMenu?.back?.()) return 'selection';
    if (window.WosChat?.viewer?.close?.()) return 'media';
    if (links?.back()) return 'link';
    if (!frame || !loaded) return 'root';
    const step = window.WizAppServices?.back(frame);
    if (['handled','pending','stay'].includes(step)) { checkpoint(); return 'app'; }
    // A connected frontend's root decision is authoritative. It may have older
    // in-app entries or a root hash such as #for-you: never traverse them after
    // the app explicitly said it is at root. Generic history is only a fallback.
    if (step === 'atRoot') { checkpoint(); return 'root'; }
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
  window.WizCore.bridge?.handle({ back:window.__wosNativeBack });
  function mount() {
    const next = registry.APP[id];
    if (!next || next.kind !== 'wizard' || !next.url || !policy.within(next.url, next.url) || policy.isShell(next.url)) { unavailable(); return; }
    if (frame && mountedURL === next.url) { app = next; return; }
    checkpoint(); detach?.(); app = next; mountedURL = next.url; loaded = false;
    win.replaceChildren(); frame = document.createElement('iframe'); frame.className = 'appframe'; frame.title = policy.displayName(next);
    frame.setAttribute('allow','microphone; clipboard-read; clipboard-write; autoplay; fullscreen'); frame.referrerPolicy = 'same-origin';
    const saved = read();
    frame.src = saved?.v === 1 && saved.base === next.url && policy.within(saved.href, next.url) ? saved.href : next.url;
    // Attach before frontend scripts run: shared capture/share/appearance/reading, not a nested shell.
    win.appendChild(frame);
    detach = window.WizAppServices?.attach(frame, { appId:id, path:next.url, readingStorage:localStorage });
    const mountedFrame = frame;
    frame.addEventListener('load', () => {
      if (frame !== mountedFrame) return;
      try {
        if (!policy.within(frame.contentWindow.location.href, app.url)) { unavailable('This app navigated outside its registered view.'); return; }
        loaded = true; document.title = policy.displayName(app);
        // Read again on every frame load, not just mount: Signal reconstructs route/filter
        // from history state, including iframe refresh, while Wisdom follows its hash.
        const latest = read();
        const restore = latest?.v === 1 && latest.base === app.url && policy.within(latest.href,app.url) ? latest : null;
        if (restore && frame.contentWindow.location.href === restore.href && restore.state && typeof restore.state === 'object') {
          const w = frame.contentWindow;
          // A recreated frame has no prior app history. Keep the new SDK mark; app Back falls back to parent/root.
          const state = { ...restore.state, domain:false, depth:0, __wizardApp:w.history.state?.__wizardApp };
          w.history.replaceState(state,'',w.location.href);
          // Only Wisdom reconstructs its own hash at boot. Signal needs popstate even
          // with a hash, or #sources silently shows the feed after process/frame recreation.
          if (!(id === 'wisdom' && state.wisdom)) w.dispatchEvent(new w.PopStateEvent('popstate',{state}));
        }
        frame.contentWindow.WizardApp?.ready?.(); safeInsets(); checkpoint();
        if (links) window.WizLinks.guardFrame(frame.contentWindow,app.url,links);
        const w = frame.contentWindow;
        if (w.__wosSessionHistory !== w.document) {
          w.__wosSessionHistory = w.document;
          const saveRoute = () => { if (frame === mountedFrame) checkpoint(); };
          // Save route synchronously: Home immediately after a chapter tap must not
          // depend on the 750ms safety timer winning a race against Android process death.
          for (const method of ['pushState','replaceState']) {
            const original = w.history[method];
            w.history[method] = function(...args) { const result = original.apply(this,args); saveRoute(); return result; };
          }
          w.addEventListener('popstate',saveRoute); w.addEventListener('hashchange',saveRoute);
        }
        frame.contentWindow.addEventListener('pagehide', () => { if (frame !== mountedFrame) return; checkpoint(); loaded = false; });
      } catch (_) { unavailable('The app could not be loaded. Check your connection and try again.'); }
    });
  }
  win.innerHTML = '<div class="single-unavailable" role="status">Loading app…</div>';
  window.WizCore.appsLoaded().then(mount);
  addEventListener('wizard:apps', mount);
  addEventListener('pagehide', checkpoint); addEventListener('beforeunload', checkpoint);
  document.addEventListener('visibilitychange', () => { if (document.hidden) checkpoint(); });
  setInterval(checkpoint, 750);
})();
