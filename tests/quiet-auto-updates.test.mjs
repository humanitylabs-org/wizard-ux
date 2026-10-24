import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
async function box({ personal = true, release = true, mode = 'auto' } = {}) {
  let status = { mode, update_available: true, release: release ? { behind: 2 } : undefined };
  let build = 'aaaa111', pop = null, renders = 0;
  const window = { __wos: { idx: 0, desks: [{ wins: [] }] }, WizWebUpdate: { pending: false, render() { renders++; } } };
  const document = {
    documentElement: { dataset: personal ? { mine: '' } : {} }, currentScript: { src: 'https://box/core/os-updates.js' },
    querySelector() { return null; }, body: { appendChild(el) { pop = el; } },
    createElement() { return { dataset: {}, style: {}, setAttribute() {}, addEventListener() {}, remove() { pop = null; } }; },
  };
  const fetch = async url => ({ ok: true, json: async () => url.endsWith('my-release.json') ? (release ? { base: 'main', changes: [], build } : {}) : status });
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: '' });
  await new Promise(r => setTimeout(r, 0));
  return { U: window.WosUpdates, window, pop: () => pop, renders: () => renders,
    async set(patch, nextBuild) { status = { ...status, ...patch }; if (nextBuild) build = nextBuild; await window.WosUpdates.load(true); await window.WosUpdates.poll(); } };
}
test('personal Automatic: behind, building and both reload signals remain quiet on Home and Settings', async () => {
  const b = await box();
  for (const release of [{ behind: 2 }, { building: true }, { behind: 0 }]) {
    await b.set({ release });
    assert.equal(b.U.card(), null); assert.equal(b.U.cardHtml(), ''); assert.equal(b.pop(), null);
  }
  await b.set({}, 'bbbb222');
  b.window.WizWebUpdate.pending = true; b.U.popup();
  assert.equal(b.U.card(), null); assert.equal(b.pop(), null);
  assert.equal(b.U.ownsReload(), true, 'legacy web banner must not replace the hidden card');
  assert.match(b.U.html(), /Only failures need your attention/);
  assert.ok(b.renders() > 0, 'status changes reconcile the existing web banner');
});
test('personal Automatic failures win over a pending reload and remain visible and actionable', async () => {
  const b = await box();
  await b.set({ release: { failed: { code: 'BUILD', message: 'Build failed' } } }, 'bbbb222');
  b.window.WizWebUpdate.pending = true; b.U.popup();
  assert.equal(b.U.card().state, 'failed'); assert.equal(b.U.card().label, 'Try again');
  assert.equal(b.pop().dataset.state, 'failed'); assert.match(b.U.cardHtml(), /Build failed/);
});
test('Ask me is unchanged, and switching to Automatic removes an existing Home popup', async () => {
  const b = await box({ mode: 'ask' });
  assert.equal(b.U.card().state, 'behind'); assert.equal(b.pop().dataset.state, 'behind');
  await b.set({ release: { building: true } }); assert.equal(b.U.card().state, 'building');
  await b.set({ release: { failed: 'CONFLICT' } }); assert.equal(b.U.card().state, 'failed');
  await b.set({ release: {} }, 'bbbb222'); assert.equal(b.U.card().state, 'reload');
  await b.set({ mode: 'auto' }); assert.equal(b.U.card(), null); assert.equal(b.pop(), null);
  await b.set({ mode: 'ask' }); assert.equal(b.U.card().state, 'reload');
});
test('stock and non-personal release Automatic retain building and reload cards', async () => {
  for (const options of [{ personal: false }, { personal: true, release: false }, { personal: false, release: false }]) {
    const b = await box(options);
    await b.set({ installing: true }); assert.equal(b.U.card().state, 'building');
    b.window.WizWebUpdate.pending = true;
    assert.equal(b.U.card().state, 'reload');
  }
});
