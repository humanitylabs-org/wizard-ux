// wizard-ux issue 2047: the phone Apps panel's Favorites and the apps taken off Recent are shared lists on the box
// (ui-preferences appFavorites, appRecentHidden). Each edit is one item operation (WizLive.prefOps add / remove / move),
// never this phone's whole cached list, so an edit on a stale phone, or two phones editing at the same moment, never
// erases the other phone's edit (AGENTS.md "Synced across devices"). The real panel (web/app-appspanel.js) runs on two
// devices, each with the real live.js preferences code and its own localStorage, against one fake box; with item
// operations (the Agent Service PATCH), with an older service without PATCH (405), and with a service whose PATCH does
// not know these lists yet (400): both fall back to replaying the same operations onto a fresh read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stale, simultaneous, liveDevice, tick } from './two-devices.mjs';
import { harness } from './fixtures/apps-panel.mjs';

const FAV = 'wos.apps.favorites.v1', HID = 'wos.apps.recentHidden.v1';
const done = dev => dev.prefOps([]);
// A phone with the panel up, saving through its own live.js (dev) and showing its own localStorage.
const phone = dev => harness({ live: dev, local: dev.store });
const star = (dev, id) => { phone(dev).click({ apstar: id }); return done(dev); };

const services = [['service with item operations', { patch: true }], ['older service (PUT only)', { patch: false }]];
for (const [svc, opt] of services) for (const [name, run] of [['stale phone', stale], ['simultaneous edits', simultaneous]]) {
  test(`Favorites, ${name}, ${svc}: one phone stars Notes, the other Music; the box keeps both`, async () => {
    const box = await run({ ...opt, initial: { appFavorites: [] }, local: { [FAV]: '[]' },
      first: a => star(a, 'notes'), second: b => star(b, 'music') });
    assert.deepEqual([...box.state.appFavorites].sort(), ['music', 'notes']);
  });
  test(`Recent, ${name}, ${svc}: one phone takes Music off Recent, the other stars Notes; both kept`, async () => {
    const box = await run({ ...opt, initial: { appFavorites: [], appRecentHidden: [] }, local: { [FAV]: '[]', [HID]: '[]' },
      first: async a => { phone(a).click({ apx: 'music' }); await done(a); }, second: b => star(b, 'notes') });
    assert.deepEqual(box.state.appRecentHidden, ['music']);
    assert.deepEqual(box.state.appFavorites, ['notes']);
  });
  test(`Recent, ${name}, ${svc}: two phones take different apps off Recent; both stay off`, async () => {
    const box = await run({ ...opt, initial: { appRecentHidden: [] }, local: { [HID]: '[]' },
      first: async a => { phone(a).click({ apx: 'music' }); await done(a); },
      second: async b => { phone(b).click({ apx: 'notes' }); await done(b); } });
    assert.deepEqual([...box.state.appRecentHidden].sort(), ['music', 'notes']);
  });
  test(`Favorites, ${name}, ${svc}: one phone removes Calendar, the other reorders; Calendar stays removed, the order holds`, async () => {
    const initial = { appFavorites: ['calendar', 'music', 'notes'] }, local = { [FAV]: JSON.stringify(initial.appFavorites) };
    const box = await run({ ...opt, initial, local,
      first: async a => { const h = phone(a); h.click({ apedit: '' }); h.click({ apminus: 'calendar' }); await done(a); },
      second: async b => { phone(b).A.moveFav('notes', 'calendar'); await done(b); } });
    assert.deepEqual(box.state.appFavorites, ['notes', 'music'], 'Notes moved first, Calendar not brought back');
  });
}

test('a service whose PATCH does not know these lists yet (400): the edit is replayed onto a fresh read, never dropped', async () => {
  const box = await stale({ initial: { appFavorites: ['calendar'] }, local: { [FAV]: '[]' },
    first: async () => {}, second: b => star(b, 'notes') });
  const old = box.apply;
  box.apply = (s, ops) => { if (ops.some(o => /^app/.test(o.key))) throw Object.assign(new Error('invalid'), { status: 400 }); return old(s, ops); };
  const req = box.req;
  box.req = async (url, init = {}) => { try { return await req(url, init); } catch (e) { if (e.status === 400) return { ok: false, status: 400, json: async () => ({}) }; throw e; } };
  const c = liveDevice(box, { [FAV]: '[]' }, { pulled: false }); await tick();
  await star(c, 'music');
  assert.deepEqual(box.state.appFavorites, ['calendar', 'notes', 'music'], "both phones' stars on the box");
  assert.deepEqual(JSON.parse(c.store.get(FAV)), ['calendar', 'notes', 'music'], 'and on the phone that edited');
});

test('every phone shows what the box holds after a pull; an agent id is stored as agent.<id>', async () => {
  const box = await stale({ initial: { appFavorites: ['music'] }, local: { [FAV]: '[]' },
    first: async () => {}, second: async b => { await star(b, 'agent:claude'); } });
  assert.deepEqual(box.state.appFavorites, ['music', 'agent.claude']);
  const other = liveDevice(box, { [FAV]: '[]' }); await tick(); await other.pullPrefs(); await tick();
  assert.deepEqual(JSON.parse(other.store.get(FAV)), ['music', 'agent.claude']);
});

test('a drag sends both neighbours, so a batch resent after a lost answer lands the same way twice', async () => {
  const box = await stale({ initial: { appFavorites: ['music', 'notes'] }, local: { [FAV]: JSON.stringify(['music', 'notes']) },
    first: async () => {}, second: async () => {} });
  const d = liveDevice(box, { [FAV]: JSON.stringify(['music', 'notes']) }); await tick();
  const sent = []; const prefOps = d.prefOps; d.prefOps = ops => { sent.push(...JSON.parse(JSON.stringify(ops))); return prefOps(ops); };
  phone(d).A.moveFav('music', ''); await done(d);
  assert.deepEqual(sent, [{ op: 'move', key: 'appFavorites', item: 'music', items: [], after: ['notes'] }]);
  const batch = [...sent, { op: 'add', key: 'appFavorites', item: 'maps' }], once = d.applyPrefOps({ appFavorites: ['music', 'notes'] }, batch);
  assert.deepEqual([...once.appFavorites], ['notes', 'music', 'maps']);
  assert.deepEqual([...d.applyPrefOps(once, batch).appFavorites], [...once.appFavorites]);
});
