import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Override the entire source tree, including fixtures and package contract, for a before/after run.
const root = process.env.GROUP_BY_DAY_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.GROUP_BY_DAY_SOURCE_ROOT) + sep)
  : new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { fixture } = await import(new URL('tests/fixtures/tweaks.mjs', root).href);
const id = 'miguel/group-by-day';
const key = 'wos.skin-tweaks.v1';

async function device(saved) {
  const f = fixture();
  const requested = [];
  // Observe migration's real loader input without starting unrelated tweak packages.
  f.host.loadTweaks = async ids => { requested.splice(0, requested.length, ...ids); };
  f.lsMap.set('wos.skin', 'obsidian');
  if (saved !== undefined) f.lsMap.set(key, JSON.stringify(saved));
  Object.assign(f.ctx.window.WosSkin, {
    families: [{ id: 'mizel', tweaks: 'miguel' }], familyOf: () => 'mizel',
  });
  f.ctx.window.addEventListener = () => {};
  f.ctx.AbortSignal = AbortSignal;
  f.ctx.fetch = async url => {
    const path = new URL(url).pathname;
    const prefix = '/wizard-os-home/';
    assert.ok(path.startsWith(prefix), 'static request stays in shell source');
    return { ok: true, json: async () => JSON.parse(read('web/' + path.slice(prefix.length))) };
  };
  vm.runInNewContext(read('web/core/experience.js'), f.ctx);
  const E = f.ctx.window.WosExperience;
  await E.refresh();
  assert.equal(E.state.error, '');
  const offered = () => E.state.tweaks.some(t => t.id === id);
  return { E, requested, offered, saved: () => JSON.parse(f.lsMap.get(key)) };
}

// Group by day (miguel/group-by-day) and No ✕ on desks (miguel/no-desk-close) were removed in wizard-ux issue 1239:
// nobody had Group by day on, and the ✕ switch was on the wizard-ux#1190 drop list. A device that saved either one,
// or still runs Miguel's legacy preset, loads without an error and never asks the loader for them.
const GONE = [id, 'miguel/no-desk-close'];
for (const [label, saved] of [
  ['missing legacy record', undefined],
  ['explicitly saved empty off list', { version: 1, off: { miguel: [] } }],
  ['legacy Miguel preset', { version: 1, off: {}, preset: 'miguel' }],
  ['flattened mix with both on', { version: 1, off: {}, preset: 'none', mix: { [id]: true, 'miguel/no-desk-close': true, 'miguel/send-and-go': true }, machinesHomeMoved: true }],
]) {
  test('removed Miguel switches never load: ' + label, async () => {
    const f = await device(saved);
    for (const g of GONE) assert.ok(!f.requested.includes(g), g + ' is not requested');
    assert.equal(f.offered(), false, 'not offered in Settings › Look');
    await f.E.toggle(id);
    assert.ok(!f.requested.includes(id), 'a stale toggle is ignored');
    await f.E.chooseSkin();
    const again = await device(f.saved());
    for (const g of GONE) assert.ok(!again.requested.includes(g), g + ' stays out after restart');
  });
}

test('catalog, profile and packages no longer carry the removed switches', () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  const profile = JSON.parse(read('web/tweaks/miguel/profile.json'));
  for (const g of GONE) {
    assert.equal(catalog.tweaks.includes(g), false, g);
    assert.equal(profile.tweaks.includes(g), false, g);
    assert.equal((catalog.lookOnlyOff || []).includes(g), false, g);
  }
});
