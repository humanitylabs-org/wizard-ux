import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fixture } from './fixtures/tweaks.mjs';
const root = process.env.ARCHIVE_SOURCE ? new URL('file://' + process.env.ARCHIVE_SOURCE.replace(/\/$/, '') + '/') : new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const id = 'miguel/archive-top';
async function run(saved) {
  const f = fixture();
  f.requested = [];
  f.host.loadTweaks = async ids => { f.requested.splice(0, f.requested.length, ...ids); };
  f.lsMap.set('wos.skin', 'obsidian');
  if (saved) f.lsMap.set('wos.skin-tweaks.v1', JSON.stringify(saved));
  f.ctx.window.WosSkin.families = [{ id: 'mizel', tweaks: 'miguel' }];
  f.ctx.window.WosSkin.familyOf = () => 'mizel';
  f.ctx.window.addEventListener = () => {};
  f.ctx.AbortSignal = AbortSignal;
  f.ctx.fetch = async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) });
  vm.runInNewContext(read('web/core/experience.js'), f.ctx);
  await f.ctx.window.WosExperience.refresh();
  assert.equal(f.ctx.window.WosExperience.state.error, '');
  return { ...f, E: f.ctx.window.WosExperience };
}
for (const [label, saved] of [
  ['no legacy record', null],
  ['explicit empty legacy off list', { version: 1, off: { miguel: [] } }],
  ['legacy off list with unrelated entry', { version: 1, off: { miguel: ['miguel/send-and-go'] } }],
]) {
  test('archive stays opt-in on migration: ' + label, async () => {
    const f = await run(saved);
    assert.equal(f.requested.includes(id), false);
    await f.clear();
  });
}
test('already flattened mix stays off; explicit author selection enables, toggle disables persistently', async () => {
  const f = await run({ version: 1, off: {}, preset: 'none', mix: {}, machinesHomeMoved: true });
  assert.equal(f.requested.includes(id), false);
  await f.E.chooseSkin();
  assert.equal(f.requested.includes(id), false);
  await f.E.chooseAuthor('miguel');
  assert.equal(f.requested.includes(id), true);
  await f.E.toggle(id);
  await f.E.refresh();
  assert.equal(f.requested.includes(id), false);
  await f.clear();
});
test('archive is discoverable but absent from defaults and legacy profile; package CSS tears down', async () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  const profile = JSON.parse(read('web/tweaks/miguel/profile.json'));
  assert.equal(catalog.defaults.includes(id), false);
  assert.equal(profile.tweaks.includes(id), false);
  assert.ok(JSON.stringify(catalog).includes(id));
  const f = fixture();
  await f.mount(id);
  await (await import('../web/tweaks/miguel/archive-top/contract.mjs')).default(f);
});
