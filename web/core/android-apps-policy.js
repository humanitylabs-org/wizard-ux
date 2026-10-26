/* Android Apps policy (web side). Native (ai.wizards.os.apps) is the device capability: list installed packages
 * with raw facts, icon, launch, open Play / app info, uninstall, install a pinned APK (sha256 + signer checked
 * natively), schedule the background update job. What those facts MEAN for the view — the source badge, when to
 * keep apps updated — is decided here, so it changes with a web update instead of an APK.
 *
 * Message v1: the relay stamps v:1 on every call. A v1 list no longer schedules the update job by itself; the relay
 * asks with scheduleUpdates once the list has loaded (shouldSchedule). Older Wizard OS builds ignore v and answer
 * scheduleUpdates with "unknown method", which is harmless: their list already scheduled it.
 */
(function (root) {
  'use strict';
  const V = 1;
  const METHODS = ['list', 'icon', 'launch', 'openPlay', 'appInfo', 'uninstall', 'install', 'status', 'scheduleUpdates'];
  // Methods the hosted Android Apps view may ask for. scheduleUpdates is the relay's own decision, not the view's.
  const VIEW_METHODS = METHODS.filter(m => m !== 'scheduleUpdates');

  /** Same words Wizard OS ≤ 0.9.x put on each row natively ("Wizard", "System", "Play", "Obtainium", "Other"). */
  function badge(row, self) {
    const a = row || {}, i = a.installer || '', o = a.owner || '';
    const owned = a.owned === true || (!!self && (i === self || o === self));
    if (owned) return 'Wizard';
    if (a.system && !i) return 'System';
    if (i === 'com.android.vending') return 'Play';
    if (i === 'dev.imranr.obtainium') return 'Obtainium';
    return a.system ? 'System' : 'Other';
  }

  /** A list answer with the web's badge on every row (rows from native are facts only). */
  function decorate(result) {
    if (!result || !Array.isArray(result.apps)) return result;
    const self = typeof result.self === 'string' ? result.self : '';
    return Object.assign({}, result, { apps: result.apps.map(a => (a && typeof a === 'object' ? Object.assign({}, a, { badge: badge(a, self) }) : a)) });
  }

  /** Keep Wizard's apps updated in the background once the view is in use: after the first good list per shell load. */
  function shouldSchedule(method, ok, alreadyAsked) { return method === 'list' && !!ok && !alreadyAsked; }

  const api = { V, METHODS, VIEW_METHODS, badge, decorate, shouldSchedule };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WizAndroidAppsPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
