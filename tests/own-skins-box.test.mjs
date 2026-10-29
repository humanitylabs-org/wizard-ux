import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const source = readFileSync(new URL('../web/core/my-skin.js', import.meta.url), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
function box() {
  const data = { active: null, skins: [{ id: 'My skin', name: 'My skin', base: 'nebula', empty: true, has_recipe: false, tweaks: {} }] }, calls = [], trash = new Map();
  let fail = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET', input = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, input, init });
    const reply = (value, status = 200, type = 'application/json') => ({ ok: status === 200, status, headers: { get: () => type }, json: async () => copy(value), text: async () => value });
    if (!url.startsWith('/wizard/v1/skins')) return url.includes('format=json') ? reply({ script: { exists: false } }) : reply(data.active ? 'body{opacity:.9}' : '', 200, 'text/css');
    if (fail) return reply({ error: fail === 404 ? 'not_found' : 'denied' }, fail);
    const path = url.slice('/wizard/v1/skins'.length);
    if (!path && method === 'GET') return reply(data);
    if (!path && method === 'POST') { const existing = input.migration_key && data.skins.find(s => s.migration_key === input.migration_key); if (existing) { if (input.activate) data.active = existing.id; return reply({ id: existing.id }); } const skin = { ...input, id: input.name, has_recipe: true, empty: true }; data.skins.push(skin); if (input.activate) data.active = skin.id; return reply({ id: skin.id }); }
    if (path === '/active') { data.active = input.id; return reply(data); }
    if (path === '/restore') {
      const skin = trash.get(input.trash); if (!skin) return reply({ error: 'trash_not_found' }, 404);
      trash.delete(input.trash); data.skins.push(skin); return reply({ id: skin.id, list: data });
    }
    const id = decodeURIComponent(path.slice(1)), skin = data.skins.find(s => s.id === id);
    if (method === 'PATCH') { Object.assign(skin, { ...input, ...(input.tweaks ? { tweaks: { ...skin.tweaks, ...input.tweaks } } : {}) }); return reply(data); }
    if (method === 'DELETE') { const token = 'token-' + id; trash.set(token, skin); data.skins = data.skins.filter(s => s.id !== id); if (data.active === id) data.active = null; return reply({ trash: token, list: data }); }
    throw new Error(method + ' ' + path);
  };
  return { data, calls, fetch, set fail(n) { fail = n; }, trash };
}
async function boot(server, store = new Map()) {
  const listeners = {};
  const ctx = { fetch: server.fetch, crypto: webcrypto, Event, URLSearchParams, location: { search: '' },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    dispatchEvent: e => { for (const fn of listeners[e.type] || []) fn(e); },
    WosSkin: { current: 'nebula', list: [{ id: 'nebula' }, { id: 'obsidian-light' }], set(id) { this.current = id; ctx.dispatchEvent(new Event('wos:skin')); } },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx); await ctx.WosMySkin.refresh();
  return { M: ctx.WosMySkin, ctx, store };
}
test('box owns recipe CRUD, active selection, reload, remove and Undo; empty default is hidden', async () => {
  const server = box(), { M, store, ctx } = await boot(server);
  assert.equal(M.storage, 'box'); assert.equal(M.recipes.length, 0);
  const made = await M.create({ name: 'Quiet morning', base: 'obsidian-light', tweaks: { 'wizard/app-borders': false } });
  assert.equal(made.id, 'Quiet morning'); assert.equal(M.active.name, 'Quiet morning'); assert.equal(ctx.WosSkin.current, 'obsidian-light');
  assert.equal(M.FILE, 'Skins/Quiet morning/skin.css'); assert.equal(store.has('wos.own-skins.v1'), false);
  const create = server.calls.find(c => c.method === 'POST');
  assert.deepEqual(create.input, { name: 'Quiet morning', base: 'obsidian-light', tweaks: { 'wizard/app-borders': false }, activate: true });
  for (const c of server.calls) { assert.equal(c.init.credentials, 'same-origin'); if (c.method !== 'GET') { assert.equal(c.init.headers['X-Requested-With'], 'wizard'); assert.equal(c.init.headers['Content-Type'], 'application/json'); } }
  await M.update({ name: 'Morning', base: 'nebula', tweaks: { 'wizard/model-pills': true } });
  assert.deepEqual(copy(M.active.tweaks), { 'wizard/app-borders': false, 'wizard/model-pills': true });
  assert.equal(server.calls.find(c => c.method === 'PATCH').url, '/wizard/v1/skins/Quiet%20morning');
  const second = await boot(server); assert.equal(second.M.active.name, 'Morning', 'a different device reads the box, not localStorage');
  const removed = await second.M.remove(made.id); assert.equal(second.M.active, null); assert.equal(second.M.recipes.length, 0);
  assert.ok(server.calls.some(c => c.method === 'DELETE'));
  await second.M.restore(removed); assert.equal(second.M.active.id, made.id);
  assert.ok(server.calls.some(c => c.url.endsWith('/restore') && c.method === 'POST'));
  await second.M.leave(); assert.equal(server.data.active, null);
  await second.M.wear(made.id); assert.equal(server.data.active, made.id);
  assert.equal(second.M.active.name, 'Morning');
});
test('preview recipes upload once, keep the worn choice and clear legacy storage', async () => {
  const server = box(), store = new Map([['wos.own-skins.v1', JSON.stringify({ version: 1, active: 'skin-two', migrated: true, skins: [
    { id: 'skin-one', name: 'First', base: 'nebula', tweaks: {} }, { id: 'skin-two', name: 'Second', base: 'obsidian-light', tweaks: { 'wizard/app-borders': false } },
  ] })]]);
  const b = await boot(server, store);
  assert.equal(b.M.active.id, 'Second'); assert.equal(store.has('wos.own-skins.v1'), false);
  assert.equal(server.calls.filter(c => c.method === 'POST').length, 2);
  await boot(server, store); assert.equal(server.calls.filter(c => c.method === 'POST').length, 2);
});
test('two clients patch only changed tweak keys, preserving independent edits', async () => {
  const server = box(), a = await boot(server);
  await a.M.create({ name: 'Shared', base: 'nebula', tweaks: { 'wizard/a': true } });
  const b = await boot(server);
  await Promise.all([a.M.update({ tweaks: { 'wizard/b': false } }), b.M.update({ tweaks: { 'wizard/c': true } })]);
  assert.deepEqual(server.data.skins.find(s => s.id === 'Shared').tweaks, { 'wizard/a': true, 'wizard/b': false, 'wizard/c': true });
  assert.ok(server.calls.filter(c => c.method === 'PATCH').every(c => Object.keys(c.input.tweaks).length === 1));
});
test('two preview tabs use the same migration key and make only one box folder', async () => {
  const server = box(), saved = JSON.stringify({ version: 1, active: 'skin-stable', migrated: true, skins: [{ id: 'skin-stable', name: 'Imported', base: 'nebula', tweaks: {} }] });
  const tabs = await Promise.all([boot(server, new Map([['wos.own-skins.v1', saved]])), boot(server, new Map([['wos.own-skins.v1', saved]]))]);
  assert.equal(server.data.skins.filter(s => s.name === 'Imported').length, 1);
  assert.ok(server.calls.filter(c => c.method === 'POST').every(c => c.input.migration_key === 'skin-stable'));
  assert.ok(tabs.every(t => t.M.active.id === 'Imported' && !t.store.has('wos.own-skins.v1')));
});
test('only empty uncustomized My skin is hidden; explicit names and existing CSS/script remain', async () => {
  for (const values of [{ has_recipe: true }, { empty: false }, { has_script: true }]) {
    const server = box(); Object.assign(server.data.skins[0], values); server.data.active = 'My skin';
    const b = await boot(server); assert.equal(b.M.recipes.length, 1); assert.equal(b.M.active.name, 'My skin');
  }
});
test('404/405 old boxes use local fallback quietly; denied/offline writes never claim success', async () => {
  for (const status of [404, 405]) {
    const server = box(); server.fail = status; const b = await boot(server);
    const made = b.M.create({ name: 'Old box', base: 'nebula', tweaks: {} }); assert.equal(made.name, 'Old box'); assert.equal(b.M.storage, 'local');
  }
  const server = box(), b = await boot(server); server.fail = 403;
  await assert.rejects(b.M.create({ name: 'Denied', base: 'nebula', tweaks: {} }));
  assert.equal(b.M.recipes.length, 0); assert.equal(b.store.has('wos.own-skins.v1'), false);
  server.fail = 0;
  const made = await b.M.create({ name: 'Cached', base: 'nebula', tweaks: {} });
  const snapshot = await b.M.remove(made.id); server.trash.clear();
  await assert.rejects(b.M.restore(snapshot), /trash_not_found/); assert.equal(b.M.storage, 'box'); assert.equal(b.M.recipes.length, 0);
  await b.M.create({ name: 'Cached', base: 'nebula', tweaks: {} });
  const offline = { fetch: async () => { throw new Error('offline'); } }, cached = await boot(offline, b.store);
  assert.equal(cached.M.active.name, 'Cached'); await assert.rejects(cached.M.create({ name: 'Offline', base: 'nebula', tweaks: {} }));
  assert.equal(cached.M.recipes.length, 1);
});
