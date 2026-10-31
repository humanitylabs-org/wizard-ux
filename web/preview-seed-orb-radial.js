/* STAGING ONLY (branch proto/orb-radial-switcher-20261031). Pins four installed apps once, so the Orb switcher radial
 * is populated the first time a preview is opened. It does nothing anywhere but the tailnet preview ports (94xx/95xx),
 * runs once per browser (flag below) and never replaces pins the owner already chose. Real default for everyone
 * else: no pins. Delete this file and its <script> tag before the branch is ever merged. */
(() => {
  'use strict';
  if (!/^9[45]\d\d$/.test(location.port)) return;
  const FLAG = 'wos.orbSwitcher.seeded.v1', PINS = ['wizard-calendar', 'notes', 'wisdom', 'stories']; // ids the launcher knows; unknown ids are skipped
  try { if (localStorage.getItem(FLAG)) return; } catch (_) { return; }
  const seed = () => {
    const sw = window.WosOrbSwitcher; if (!sw) return;
    if (!sw.get().pins.length) sw.set({ pins: PINS });
    try { localStorage.setItem(FLAG, '1'); } catch (_) {}
  };
  if (document.readyState === 'complete') seed(); else window.addEventListener('load', seed);
})();
