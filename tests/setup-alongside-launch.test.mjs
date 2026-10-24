import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/setup-launch.js', import.meta.url), 'utf8');
async function launch(data, {tour = true, deep = false} = {}) {
  const actions = [];
  const window = { AbortController, WosTour: { active: false, done: () => false } };
  vm.runInNewContext(source, { window, AbortController, setTimeout, clearTimeout, Date,
    fetch: async () => ({ ok: true, json: async () => data }), addEventListener() {}, location: {origin: 'https://example.test'} });
  window.WosSetupLaunch.boot({ firstRunTour: tour, deeplinked: () => deep,
    open: id => actions.push(id), tour: () => actions.push('tour'), markTour: () => actions.push('marked') });
  await new Promise(resolve => setTimeout(resolve, 700));
  return { actions, pending: window.WosSetupLaunch.tourPending };
}
test('alongside first launch stays quiet on phone and desktop; Setup remains manually available', async () => {
  for (const tour of [true, false]) {
    const result = await launch({ first_run: true, launch_mode: 'alongside' }, {tour});
    assert.deepEqual(result.actions, []);
    assert.equal(result.pending, false);
  }
});
test('alongside subsequent launches do not start the delayed tour', async () => {
  assert.deepEqual((await launch({first_run: false, launch_mode: 'alongside'})).actions, []);
});
test('VM onboarding still opens Setup and holds the phone tour', async () => {
  assert.deepEqual(await launch({first_run: true}), {actions: ['setup'], pending: true});
});
test('unknown modes preserve VM onboarding; deep links are never replaced', async () => {
  assert.deepEqual((await launch({first_run: true, launch_mode: 'unknown'})).actions, ['setup']);
  assert.deepEqual((await launch({first_run: true, launch_mode: 'alongside'}, {deep:true})).actions, ['marked']);
});
