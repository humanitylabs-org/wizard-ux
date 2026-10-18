/* Pin identity is an app ID, never a caller-provided launch URL. */
(() => {
  'use strict';
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id);
  const isShell = value => { try { return /^\/wizard-os-home(?:[/-]|$)/.test(new URL(value,location.origin).pathname); } catch (_) { return true; } };
  function within(value, base, origin = location.origin) {
    try {
      const u = new URL(value, origin), b = new URL(base, origin);
      const root = b.pathname.endsWith('/') ? b.pathname : b.pathname.slice(0, b.pathname.lastIndexOf('/') + 1);
      return u.origin === origin && b.origin === origin && root !== '/' && !/%(?:2f|5c|2e|25)/i.test(u.pathname) && u.pathname.startsWith(root);
    } catch (_) { return false; }
  }
  const key = (origin, id) => 'wos.single.v1:' + JSON.stringify([origin, id]);
  // Registry names stay unchanged in desks; launcher/task names are app names.
  const displayName = app => app.id === 'wizard-signal' ? 'Signal' : app.name;
  const requested = new URLSearchParams(location.search).get('app-session');
  // Even malformed session links must not reveal the workspace.
  const mode = requested !== null;
  const id = validId(requested) ? requested : '';
  if (mode) document.documentElement.setAttribute('data-app-session', id || 'unavailable');
  function installPresentationStorage(frame) {
    if (!mode || !id || frame === window || frame.location.origin !== location.origin || (frame.__wosPresentationStorageDocument && frame.__wosPresentationStorageDocument === frame.document)) return;
    const storage = frame.localStorage, prefix = key(location.origin,id) + ':presentation:';
    // Wisdom's paginated reader stores screen position, not content/preferences, under these keys.
    // Keep size/theme, highlights, read/saved state and every other backend/content key shared.
    const map = k => /^wisdom:.*:pos:/.test(String(k)) ? prefix + k : String(k);
    const facade = new Proxy(storage, {
      get(target, prop) {
        if (prop === 'getItem') return k => target.getItem(map(k));
        if (prop === 'setItem') return (k,v) => target.setItem(map(k),v);
        if (prop === 'removeItem') return k => target.removeItem(map(k));
        const value = Reflect.get(target,prop,target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    Object.defineProperty(frame,'localStorage',{ configurable:true, value:facade });
    frame.__wosPresentationStorage = true;
    frame.__wosPresentationStorageDocument = frame.document;
  }
  window.WizHomeScreenPolicy = Object.freeze({ validId, isShell, within, key, displayName, mode, id, installPresentationStorage });
})();
