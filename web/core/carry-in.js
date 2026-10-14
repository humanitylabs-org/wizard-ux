/* Wizard OS carry, NEW side: the first script of the shell (before core/shell.js).
 *
 * After the Android app moves from an older name to this Wizard's own name, it holds what the
 * old origin handed over (core/carry-out.js) until this page takes it. localStorage keys are written only
 * where this origin has nothing yet, so a second run (or a newer value) never overwrites anything.
 * Unsent messages go to window.WosCarry; outbox.js stores them at load and then calls done(), which
 * tells the app to delete its copy. Until then the app keeps it and the next launch repeats this safely
 * (keys only-if-missing, outbox items by id).
 */
(() => {
  'use strict';
  const N = window.WizardOSNative;
  if (!N || typeof N.carryIn !== 'function') return;
  let raw = '';
  try { raw = N.carryIn() || ''; } catch (e) { return; }
  if (!raw) return;
  const finish = () => { try { N.carryDone(); } catch (e) {} };
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { finish(); return; }
  if (!d || d.v !== 1 || typeof d !== 'object') { finish(); return; }
  const ls = d.ls && typeof d.ls === 'object' ? d.ls : {};
  let wrote = 0;
  for (const k of Object.keys(ls)) {
    const v = ls[k];
    if (typeof v !== 'string') continue;
    try { if (localStorage.getItem(k) === null) { localStorage.setItem(k, v); wrote++; } } catch (e) { /* quota: keep going */ }
  }
  const outbox = Array.isArray(d.outbox) ? d.outbox.filter(x => x && typeof x.id === 'string' && /^wos-[A-Za-z0-9-]{1,80}$/.test(x.id)) : [];
  window.WosCarryReport = { keys: Object.keys(ls).length, wrote, outbox: outbox.length, from: String(d.from || '') };
  if (!outbox.length) { finish(); return; }
  window.WosCarry = { outbox, done: finish };
})();
