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
  const on = () => {
    const item = E.state.tweaks.find(t => t.id === id);
    assert.ok(item, 'individual tweak remains discoverable');
    assert.equal(item.on, requested.includes(id), 'choice agrees with actual loader input');
    return item.on;
  };
  return { E, on, saved: () => JSON.parse(f.lsMap.get(key)) };
}

for (const [label, saved] of [
  ['missing legacy record', undefined],
  ['explicitly saved empty off list', { version: 1, off: { miguel: [] } }],
  ['unrelated saved off list', { version: 1, off: { miguel: ['miguel/send-and-go'] } }],
]) {
  test('legacy migration leaves Group by day off: ' + label, async () => {
    const f = await device(saved);
    assert.equal(f.on(), false);
    assert.equal(f.saved().preset, 'none', 'legacy profile really flattened');
    assert.equal(f.saved().mix['miguel/swipe-strip'], true, 'existing profile behavior preserved');
    if (saved?.off.miguel.includes('miguel/send-and-go')) {
      assert.notEqual(f.saved().mix['miguel/send-and-go'], true, 'unrelated explicit off preserved');
    }
    await f.E.chooseSkin();
    assert.equal(f.on(), false, 'harmless skin selection cannot opt in');
    assert.equal((await device(f.saved())).on(), false, 'off survives restart');
  });
}

test('already flattened switches survive refresh and harmless chooseSkin', async () => {
  for (const choice of [undefined, false, true]) {
    const mix = { 'miguel/swipe-strip': true, 'miguel/send-and-go': false };
    if (choice !== undefined) mix[id] = choice;
    const f = await device({ version: 1, off: {}, preset: 'none', mix, machinesHomeMoved: true });
    assert.equal(f.on(), choice === true);
    await f.E.chooseSkin();
    await f.E.refresh();
    assert.equal(f.on(), choice === true);
    assert.deepEqual(f.saved().mix, mix, 'existing explicit choices are untouched');
  }
});

test('explicit author selection enables discoverable tweak; individual off persists after restart', async () => {
  const f = await device({ version: 1, off: {}, preset: 'none', mix: {}, machinesHomeMoved: true });
  assert.equal(f.on(), false);
  const author = (await f.E.authors()).find(a => a.id === 'miguel');
  assert.ok(author.ids.includes(id));
  await f.E.chooseAuthor('miguel');
  assert.equal(f.on(), true);
  await f.E.toggle(id);
  assert.equal(f.on(), false);
  await f.E.refresh();
  assert.equal(f.on(), false);
  assert.notEqual(f.saved().mix[id], true);
  assert.equal((await device(f.saved())).on(), false);
});

test('individual discoverable switch can opt in and back out without choosing an author', async () => {
  const f = await device({ version: 1, off: {}, preset: 'none', mix: {}, machinesHomeMoved: true });
  await f.E.toggle(id);
  assert.equal(f.on(), true);
  assert.equal((await device(f.saved())).on(), true);
  await f.E.toggle(id);
  assert.equal((await device(f.saved())).on(), false);
});

test('catalog discovery is retained, without a global default or legacy profile opt-in', () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  const profile = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.ok(catalog.tweaks.includes(id));
  assert.equal(catalog.defaults.includes(id), false);
  assert.equal(profile.tweaks.includes(id), false);
});

test('actual package contract removes its CSS and host state on teardown in both shell fixtures', async () => {
  const { default: check } = await import(new URL('web/tweaks/miguel/group-by-day/contract.mjs', root).href);
  for (const shell of ['phone', 'desktop']) {
    const f = fixture({ shell });
    try {
      await f.mount(id);
      assert.ok(f.host.tweakState.includes(id));
      assert.ok(f.doc.head.children.some(n => n.href?.endsWith('group-by-day/tweak.css')));
      await check(f);
      assert.equal(f.host.tweakState.includes(id), false);
      assert.equal(f.doc.head.children.length, 0);
    } finally { await f.clear(); }
  }
});
