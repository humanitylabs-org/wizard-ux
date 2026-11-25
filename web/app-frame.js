/* Wizard UX phone shell › an app's window: drawing its frame, the fallback card for a refused frame, and keeping
 * a hosted app from padding the Back stack. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.frame = function ({ APP, esc, ico, winApp }) {
  function renderApp(w) {
    const a = APP[w.appId] || {};
    const native = a.kind === 'native';
    let href = a.url || a.href;
    if (a.id === 'spotify' && w.query) href = `spotify:search:${encodeURIComponent(w.query)}`;
    return `<div class="desk-scroll"><div class="appcard">${ico('div', 'hero', a).replace(/^(<div[^>]*>)([\s\S]*)<\/div>$/, '$1<span class="big">$2</span></div>')}
      <div class="body"><h3>${esc(a.name)}${w.query ? ` · “${esc(w.query)}”` : ''}</h3><p>${esc(a.desc || '')}${native ? '. Opens the real Android app.' : ''}</p>
      <a class="cta" href="${esc(href)}" target="${native ? '_self' : '_blank'}" rel="noopener">Open ${esc(a.name)}</a></div></div></div>`;
  }
  function renderFrame(w) {
    const a = APP[w.appId] || winApp(w);
    return renderFrameCore(w, a);
  }
  function renderFrameCore(w, a) {
    if (w.appId === 'troubleshooter') return window.WizReach.recoveryHtml();
    const frameUrl = window.WosOwnViews?.frameUrl(a, w.url) || w.url || a.url || '/';
    // Browser boundary: an app that can't run in a sandboxed window (Files, wizard-os#942) opens as its own tab.
    if (window.WizBrowserBoundary?.ownTab?.(a.id, frameUrl)) return `<div class="frame-wrap blocked own-tab" data-own-tab="${esc(a.id || '')}"><div class="frame-fallback">${ico('span', 'glyph', a)}<h3>${esc(a.name)} opens in its own tab</h3><p>It can’t run inside a Wizard window, so it opens in a tab of its own.</p><a class="cta" href="${esc(frameUrl)}" target="_blank" rel="noopener">Open ${esc(a.name)}</a></div></div>`;
    return `<div class="frame-wrap loading">${window.WosOwnViews?.noteHtml(a) || ''}<div class="frame-loading" role="status" aria-label="Loading ${esc(a.name || 'app')}">${ico('span', 'glyph', a)}<i class="wos-spin" aria-hidden="true"></i></div><div class="frame-coming">${ico('span', 'glyph', a)}<h3>${esc(a.name)} is on its way</h3><p>${esc(a.desc || '')}. It’s being built in another thread and appears here on its own once it’s published.</p></div><iframe class="appframe"${window.WizBrowserBoundary?.enabled ? ' ' + window.WizBrowserBoundary.frameAttributes(frameUrl, a.id) : ''} ${a.probe ? `data-probe="${esc(w.url || a.url)}"` : ''} data-own-app="${esc(a.id || '')}" src="${esc(frameUrl)}" title="${esc(a.name || 'App')}" allow="microphone; clipboard-read; clipboard-write; autoplay; fullscreen" referrerpolicy="same-origin"></iframe>
      <div class="frame-fallback">${ico('span', 'glyph', a)}<h3>${esc(a.name)} can’t run in a window yet</h3><p>It opens in its own tab instead.</p><a class="cta" href="${esc(a.url || '/')}" target="_blank" rel="noopener">Open ${esc(a.name)}</a></div></div>`;
  }
  // A refused frame lands on an unreadable error document: show the fallback card.
  // Readable (same-origin) frames get the shell's Back handling, pinch, and voice hooks.
  function probeFrame(f, url) {
    const wrap = f.closest('.frame-wrap'); if (!wrap) return;
    fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(r => {
      if (r.ok) { if (wrap.classList.contains('coming')) { wrap.classList.remove('coming'); try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.replace(url); } catch (e) { f.src = url; } } }
      else { wrap.classList.add('coming'); setTimeout(() => { if (f.isConnected) probeFrame(f, url); }, 60000); }
    }).catch(() => setTimeout(() => { if (f.isConnected) probeFrame(f, url); }, 60000));
  }
  /* Hosted apps must not pad the Back stack: a history entry an app pushes
   * without the user touching it (router boot, redirects) becomes a replace.
   * Patched as early as the new document exists, before its module scripts run. */
  function tameHistory(win) {
    try {
      if (!win || win.__wosTamed || !win.history) return;
      win.__wosTamed = true;
      const h = win.history, push = h.pushState.bind(h), rep = h.replaceState.bind(h);
      h.pushState = function (st, t, u) { const r = (st?.__wizardApp?.version === 1 || win.navigator.userActivation?.isActive ? push : rep)(st, t, u); try { win.__wosHref = win.location.href; } catch (e) {} return r; };
      h.replaceState = function (st, t, u) { const r = rep(st, t, u); try { win.__wosHref = win.location.href; } catch (e) {} return r; };
      // The app stepping back through its own entries (collapse a section with history.back()) is the app's
      // step, never the user's Back: mark it so the frame popstate below lets the app handle it (James, 10 Oct:
      // collapsing a part in a full-screen app dropped full screen).
      const bk = h.back.bind(h), go = h.go.bind(h);
      h.back = function () { selfPop(win); return bk(); };
      h.go = function (n) { if (+n < 0) selfPop(win, +n); return go(n); };
    } catch (e) {}
  }
  function selfPop(win, delta = -1) {
    try {
      // Traversal completion owns its document/target, not an 800 ms guess. Parked frames and busy
      // WebViews can deliver this much later; it must never become another Back on the visible thread.
      const nav = win.navigation, entries = nav?.entries?.(), at = nav?.currentEntry?.index;
      const target = entries && Number.isInteger(at) ? entries[at + delta] : null;
      if (entries && Number.isInteger(at) && !target) return; // a no-op must not consume the next user Back
      win.__wosSelfPop = { doc: win.document, key: target?.key || null };
    } catch (e) {}
  }
  function takeSelfPop(win) {
    try {
      const pop = win.__wosSelfPop; win.__wosSelfPop = null;
      return !!pop && pop.doc === win.document && (!pop.key || win.navigation?.currentEntry?.key === pop.key);
    } catch (e) { return false; }
  }
  function watchEarly(f) {
    let last = null, n = 0;
    const tick = () => {
      if (!f.isConnected) return;
      try { const w = f.contentWindow; if (w && w !== last && w.location.href !== 'about:blank') { last = w; tameHistory(w); } } catch (e) {}
      if (++n < 4000) setTimeout(tick, 4);
    };
    tick();
    f.addEventListener('load', () => { n = 0; tick(); });
  }
  return { probeFrame, renderApp, renderFrame, selfPop, takeSelfPop, tameHistory, watchEarly };
};
