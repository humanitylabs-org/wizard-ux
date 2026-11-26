/* Wizard UX phone shell › full screen, clearing a desk, and links that open on a desk of their own. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.linkdesk = function ({ APP, appAt, APPS, appVars, closeDesk, closeSheets, deskOf, device, goDesk, LIVE, openWin, store, tourEv, vib, winEl, winTitle }) {
  let armBack, openApp, toast; // late-bound: app.js declares these after the call, see bindLate
  function setZen(on, quiet) {
    on = !!on; if (on === appVars.zen) return; appVars.zen = on;
    device.classList.toggle('zen', on); store.set('zen', on);
    clearTimeout(appVars.zenTipT); device.classList.remove('zen-tip');
    if (on && !quiet) {
      try { armBack(); } catch (e) {}
      void device.offsetWidth; device.classList.add('zen-tip');
      appVars.zenTipT = setTimeout(() => device.classList.remove('zen-tip'), 2400);
      const n = store.get('zenTips', 0);
      if (n < 3) { store.set('zenTips', n + 1); toast('↑', 'Swipe up from the bottom to bring the orb back', 2200); }
    }
    if (!quiet) { vib(on ? 8 : 6); tourEv('zen', { on }); }
  }
  function clearDesk(i) { closeDesk(i); }
  /* Apps open as windows. Views reuse a review window already on this desk. */
  function mountLinks() {
    if (appVars.LINKS || !window.WizLinks) return;
    appVars.LINKS = window.WizLinks.mount({
      // An installed Reader preview paints its loading frame in this tap task, just like desktop previews.
      // Do not send it through the launcher's asynchronous setup check; ordinary app links still use that gate.
      readerApp: () => APP.browser, readerOpen: href => openLinkDesk(href, null, true),
      parent: device, mode: 'sheet',
      onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a); else { const o = appAt(url); openWin({ app: 'frame', url, title: o ? o.name : title, ...(o ? { appId: o.id } : {}) }); } },
      onChange: on => { device.classList.toggle('link-open', on); if (on) { closeSheets(true); armBack(); } },
    });
    // Phone (James, 10 Oct 2026): a tapped link opens on its own desk beside this one (see openLinkDesk).
    appVars.LINKS.route = (href, from) => openLinkDesk(href, from);
    window.WizLinks.intercept(device, appVars.LINKS);
  }
  /* A tapped internal link opens on its own desk right beside the one it came from, full screen at once.
   * Tapped in a Chats thread, that desk is in thread-feedback mode: amber edge, "Review" tag, and the orb sends what
   * James says as feedback to that thread. Back or ✕ closes it and lands on the thread again; Pin keeps it
   * as a normal desk. Links tapped inside a review desk navigate that same window (Back steps back). */
  function linkTitle(u) {
    const seg = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] || 'Wizard'); // never the bare host (issue 1875)
    const app = APPS.find(x => x.url && u.pathname.startsWith(x.url.replace(/[#?].*$/, '')));
    return app ? app.name : seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // Where a tapped link came from: Back or ✕ on what it opened closes that and lands here again.
  function fromOf(srcId) {
    const src = appVars.W[srcId], sid = src?.app === 'chats' && src.thread && src.thread !== '__new__' ? src.thread : '';
    return { desk: appVars.desks[deskOf(srcId)]?.id || appVars.desks[appVars.idx].id, win: srcId || '', sid, title: sid ? (LIVE?.session(sid)?.title || winTitle(src)) : (src ? winTitle(src) : '') };
  }
  function openLinkDesk(href, fromEl, setupChecked = false) {
    let u; try { u = new URL(href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    const srcId = (fromEl && fromEl.closest ? fromEl.closest('.win')?.dataset.win : '') || appVars.desks[appVars.idx].focus;
    const src = appVars.W[srcId], rel = u.pathname + u.search + u.hash;
    const pageSlug = window.WosPages?.match(href);
    if (pageSlug) return !!openWin({app:'pages', appId:'pages', pageSlug, from:fromOf(srcId)});
    // Without the Pages API preserve the ordinary link sheet, not a privileged frame.
    if (/^\/pages\//.test(u.pathname)) return false;
    const targetApp = appAt(rel);
    if (targetApp && !setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(targetApp, () => openLinkDesk(href, fromEl, true));
    // a layout placing the shell's opens (apps.routeOpens): an app's page where it shows that app
    const routed = window.WosSkinHost?.routeOpen?.('link', { url: rel, title: '', app: targetApp ? targetApp.id : '' }, () => linkDesk(u, rel, srcId));
    return routed ? routed.value !== false : linkDesk(u, rel, srcId);
  }
  function linkDesk(u, rel, srcId) {
    const src = appVars.W[srcId];
    if (src && src.from && src.app === 'frame') { const f = winEl(srcId)?.querySelector('iframe'); if (f) { try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.href = u.href; } catch (e) { f.src = u.href; } return true; } }
    const open = Object.values(appVars.W).find(w => w.from && w.url === rel); if (open) { goDesk(deskOf(open.id)); return true; }
    const from = fromOf(srcId);
    window.__ovLog = (window.__ovLog || []).concat('link:' + rel).slice(-30);
    const owner = appAt(rel); // a page inside an installed app opens as that app, with its services
    return !!openWin({ app: 'frame', appId: owner ? owner.id : 'link', url: rel, title: owner ? owner.name : linkTitle(u), from });
  }
  return { clearDesk, fromOf, linkTitle, mountLinks, openLinkDesk, setZen, bindLate: v => { if ('armBack' in v) armBack = v.armBack; if ('openApp' in v) openApp = v.openApp; if ('toast' in v) toast = v.toast; } };
};
