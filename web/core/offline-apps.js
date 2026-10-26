/* Reviewed offline app-session capabilities. Shared by registry and shell worker.
 * An app's URL or a caller-supplied query cannot grant an offline shell. */
(() => {
  'use strict';
  const apps = Object.freeze({ wisdom: Object.freeze({ offline: true, path: '/wisdom/' }) });
  globalThis.WizOfflineApps = Object.freeze({
    apps,
    allows(id, href, origin = location.origin) {
      const app = apps[id];
      if (!app?.offline) return false;
      try { const u = new URL(href, origin); return u.origin === origin && u.pathname === app.path && !u.search && !u.hash; }
      catch (_) { return false; }
    }
  });
})();
