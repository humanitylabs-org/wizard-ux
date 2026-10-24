// First launch rules (web/core/setup-launch.js). Miguel, 24 Oct 2026: an alongside (existing-Hermes) owner gets
// the short first-message orientation once (phone Talk -> Hide tour, desktop composer guide) without Setup opening;
// VM onboarding (Setup first, then the phone tour) is unchanged, and a VM desktop launch still shows no guide.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/setup-launch.js', import.meta.url), 'utf8');
async function launch(data, { tour = true, deep = false, desktop = false, done = false, busy = false, tapAt = -1, slow = 0 } = {}) {
  const actions = [], listeners = {};
  const window = { AbortController, WosTour: { active: false, done: () => done, desk: { active: false } } };
  vm.runInNewContext(source, { window, AbortController, setTimeout, clearTimeout, Date,
    fetch: (u, o = {}) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, json: async () => data }), slow);
      o.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new Error('aborted')); }); // honour the 2.5 s budget
    }),
    addEventListener(t, f) { (listeners[t] ||= []).push(f); }, location: { origin: 'https://example.test' } });
  window.WosSetupLaunch.boot({ firstRunTour: tour, deeplinked: () => deep, ...(desktop ? { alongsideOnly: true } : {}), busy: () => busy,
    open: id => actions.push(id), tour: why => actions.push('tour:' + why), markTour: () => actions.push('marked') });
  if (tapAt >= 0) setTimeout(() => (listeners.pointerdown || []).forEach(f => f({})), tapAt);
  await new Promise(resolve => setTimeout(resolve, 800 + slow));
  return { actions, pending: window.WosSetupLaunch.tourPending, log: window.WosSetupLaunch.log };
}
test('alongside first launch starts the orientation once on phone and desktop; Setup never auto-opens', async () => {
  for (const desktop of [false, true]) {
    const r = await launch({ first_run: true, launch_mode: 'alongside' }, { desktop });
    assert.deepEqual(r.actions, ['tour:first-run'], desktop ? 'desktop' : 'phone');
    assert.equal(r.pending, false);
  }
});
test('alongside: an owner who already finished or skipped it is left alone', async () => {
  assert.deepEqual((await launch({ first_run: true, launch_mode: 'alongside' }, { tour: false })).actions, []);
  assert.deepEqual((await launch({ first_run: false, launch_mode: 'alongside' }, { done: true })).actions, []);
});
test('alongside: Setup having been seen does not suppress the per-browser orientation', async () => {
  assert.deepEqual((await launch({ first_run: false, launch_mode: 'alongside' })).actions, ['tour:first-run']);
});
test('VM onboarding still opens Setup and holds the phone tour', async () => {
  assert.deepEqual((await launch({ first_run: true })).actions, ['setup']);
  assert.equal((await launch({ first_run: true })).pending, true);
});
test('VM desktop launch is unchanged: Setup on first run, never the desktop guide', async () => {
  const first = await launch({ first_run: true }, { desktop: true });
  assert.deepEqual(first.actions, ['setup']); assert.equal(first.pending, false);
  assert.deepEqual((await launch({ first_run: false }, { desktop: true })).actions, []);
  assert.deepEqual((await launch(null, { desktop: true })).actions, []);
});
test('unknown modes preserve VM onboarding; deep links are never replaced', async () => {
  assert.deepEqual((await launch({ first_run: true, launch_mode: 'unknown' })).actions, ['setup']);
  assert.deepEqual((await launch({ first_run: true, launch_mode: 'alongside' }, { deep: true })).actions, ['marked']);
  assert.deepEqual((await launch({ first_run: true, launch_mode: 'alongside' }, { deep: true, desktop: true })).actions, []);
});
test('alongside: never interrupts the owner (Codex #482): a tap before a slow /setup answer, or a take in progress, skips it this launch', async () => {
  for (const desktop of [false, true]) {
    assert.deepEqual((await launch({ first_run: true, launch_mode: 'alongside' }, { desktop, slow: 900, tapAt: 300 })).actions, [], 'tapped first');
    assert.deepEqual((await launch({ first_run: true, launch_mode: 'alongside' }, { desktop, busy: true })).actions, [], 'busy (recording, sheet, typed text)');
  }
});
test('no /setup answer in time: the generic tour start also never interrupts an owner who already tapped', async () => {
  const fetchNever = { first_run: true, launch_mode: 'alongside' };
  // slow > 2.5 s budget: firstRun() aborts -> null -> generic path
  assert.deepEqual((await launch(fetchNever, { slow: 3000, tapAt: 500 })).actions, []);
  assert.deepEqual((await launch(fetchNever, { slow: 3000 })).actions, ['tour:first-run'], 'untouched: still starts');
});
