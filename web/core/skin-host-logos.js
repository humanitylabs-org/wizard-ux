/* Wizard UX skin host › an installed app's own logo and the App Store's listing of apps not installed yet.
 * Moved verbatim out of core/skin-host.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The skin host (core/skin-host.js) calls
 * this once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names skin-host.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before core/skin-host.js. The body below keeps
 * skin-host.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.skinHostParts = window.WizCore.skinHostParts || {};
window.WizCore.skinHostParts.logos = function ({ isDoc, stamp }) {
  /* An installed app's own logo: exactly the picture every other app-icon place shows (WizSigil.of(app).logo over the
   * box's list of installed logos; placeholders already excluded, a designed sigil wins), so a layout never draws a different
   * logo for the same app than the Desks view. A same-origin URL carrying the image's hash; null when it has none. */
  function appLogo(id) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return Promise.resolve(null);
    // WizSigil decides: an app with a designed sigil keeps it even when it ships a picture.
    const u = (typeof window !== 'undefined' && (window.WizSigil ? window.WizSigil.of({ id }).logo : window.WizCore?.appLogo?.(id))) || '';
    return Promise.resolve(/^\/wizard-os-home\/store-data\/app-logo\/[a-z0-9][a-z0-9-]{0,63}\?v=[0-9a-f]{16}$/.test(u) ? u : null);
  }
  /* The App Store's own listing (the Store app's Store-data route, the same index it shows): Apps (type view) that are
   * not installed yet, for the Orb and Apps views' "Get more" section. Read-only; one read per page, refreshed when the
   * app registry changes. Installed = the shell's registry (or a reviewed host alias of it, store-status.js). */
  let storeList = null;
  if (isDoc) window.addEventListener?.('message', e => { if (e.origin === location.origin && e.data?.type === 'wizard:apps-changed') storeList = null; });
  function storeApps(installedIds) {
    if (!isDoc || typeof fetch !== 'function') return Promise.resolve([]);
    if (!storeList) storeList = (async () => {
      const [{ isUserApp, hostAppId }, apps] = await Promise.all([import(stamp(new URL('store/store-status.js', document.baseURI).href)), (async () => {
        const out = []; let offset = 0;
        for (let page = 0; page < 5; page++) {
          const r = await fetch(new URL(`store-data/wizard/v1/index/search?limit=100&offset=${offset}`, document.baseURI), { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
          if (!r.ok) throw new Error('store ' + r.status);
          const d = await r.json(); out.push(...(Array.isArray(d.apps) ? d.apps : []));
          if (!Number.isSafeInteger(d.next_offset) || d.next_offset <= offset) break; offset = d.next_offset;
        }
        return out;
      })()]);
      const ID = /^[a-z0-9][a-z0-9-]{0,63}$/, seen = new Set(), txt = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
      return apps.filter(x => x && ID.test(x.id || '') && x.type === 'view' && isUserApp(x) && !seen.has(x.id) && seen.add(x.id))
        .map(x => Object.freeze({ id: x.id, name: txt(x.name, 60) || x.id, summary: txt(x.summary, 200), host: hostAppId(x) }));
    })().catch(err => { storeList = null; throw err; });
    const have = new Set(installedIds || []);
    return storeList.then(l => l.filter(x => !have.has(x.id) && !have.has(x.host)).map(({ host, ...x }) => Object.freeze(x)));
  }
  return { appLogo, storeApps };
};
