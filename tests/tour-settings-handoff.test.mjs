// The first-run tour guards every tap outside its own targets (window-capture pointerdown + click). If Settings opens
// while it runs (a deeplink, notification or command), those taps would be swallowed under the scrim: on a phone the
// owner tapped "Your changes" and nothing happened. Opening Settings ends the tour as a handoff instead.
// Runs the real tour.js (tests/fixtures/tour-harness.mjs) and the real phone-shell sheet code (web/app-deskset.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { boot, mk } from './fixtures/tour-harness.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';

test('opening Settings mid-tour hands off: the tour finishes and stops guarding taps', () => {
  const t = boot(); t.T.start('qa');
  assert.ok(t.T.active);
  t.T.event('sheet', { which: 'launcher' });
  assert.ok(t.T.active, 'another sheet does not end it');
  t.T.event('sheet', { which: 'settings' });
  assert.equal(t.T.active, false, 'Settings ends the tour, so its tap guard lets taps through');
  assert.equal(t.T.step, 0);
  // Mid-beat too (Reply, step 2): the handoff wins over any beat steering the owner back.
  const u = boot(); u.T.start('qa'); u.tap('[data-tnext]');
  assert.equal(u.T.step, 2);
  u.T.event('sheet', { which: 'settings' });
  assert.equal(u.T.active, false);
});

// app-deskset.js (openSheet, liftSettings, rideSettings) wired to a real tour, as app.js does with tourEv.
function shell() {
  const t = boot(); t.T.start('qa');
  const ctx = { window: { WizCore: {} }, document: { activeElement: null }, innerWidth: 400 };
  vm.runInNewContext(withShellParts(readFileSync(new URL('../web/app-deskset.js', import.meta.url), 'utf8')), ctx);
  const device = mk(), settingsEl = Object.assign(mk(), { removeAttribute() {} }), appVars = { sheet: null, stDesk: null, desks: [{ id: 'd1' }, { id: 'd2' }], idx: 0, DS: null, settingsView: { focus() {} } };
  const api = ctx.window.WizCore.appParts.deskset({ $: () => mk(), appVars, closeMenu() {}, closeSheets() {}, device, foldOpen: {}, inboxEl: mk(), launcher: mk(), openChatsList() {},
    renderLauncher() {}, renderSettings() {}, settingsEl, tourEv: (type, d) => t.T.event(type, d), vib() {} });
  return { t, api, appVars };
}

test('a parked Settings sheet restored on its desk tells the tour too (not only openSheet)', () => {
  const a = shell();
  a.api.openSheet('settings');
  assert.equal(a.t.T.active, false, 'openSheet hands off');
  // Settings parked on desk 1, the tour started again, then the owner swipes back to that desk.
  const b = shell();
  b.appVars.sheet = 'settings'; b.api.liftSettings('d1');
  assert.equal(b.appVars.sheet, null); assert.ok(b.t.T.active, 'parking does not end the tour');
  b.appVars.idx = 0; b.api.rideSettings(0, false);
  assert.equal(b.appVars.sheet, 'settings', 'Settings is the open sheet again');
  assert.equal(b.t.T.active, false, 'and the tour hands off the same way');
});
