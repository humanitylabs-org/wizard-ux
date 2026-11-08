import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/my-skin.js', import.meta.url), 'utf8');
// Old Service contract: POST only forwards name/css, ignores migration_key/base/tweaks/activate.
// Match server/skins.mjs create(): folder suffix differs, display name remains unchanged.
function oldService() {
  const data = { active: 'My skin', skins: [{ id: 'My skin', name: 'My skin', base: 'nebula', bytes: 22, empty: false, has_script: false, forked_from: null, published: null }] }, writes = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET', input = init.body ? JSON.parse(init.body) : {};
    const reply = (body, status = 200, type = 'application/json') => ({ ok: status === 200, status, headers: { get: () => type }, json: async () => structuredClone(body), text: async () => body });
    if (method !== 'GET') writes.push({ url, method, input });
    if (url === '/wizard/v1/skins' && method === 'GET') return reply(data);
    if (url === '/wizard/v1/skins' && method === 'POST') {
      let id = input.name, n = 1; while (data.skins.some(s => s.id === id)) id = input.name + ' ' + (++n);
      data.skins.push({ id, name: input.name, base: 'nebula', bytes: 0, empty: true, has_script: false, forked_from: null, published: null });
      return reply({ id });
    }
    if (url === '/wizard/v1/skins/active') { data.active = input.id; return reply(data); }
    if (url.startsWith('/wizard/v1/user-files/content')) return reply({ name: 'My skin' });
    return url.includes('format=json') ? reply({ script: { exists: false } }) : reply(':root{--qa-own:1}', 200, 'text/css');
  };
  return { data, writes, fetch };
}
async function boot(server, store) {
  const ctx = { fetch: server.fetch, Event, URLSearchParams, location: { search: '' },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WosSkin: { current: 'grove', list: [{ id: 'nebula' }, { id: 'grove' }], set(id) { this.current = id; } },
    addEventListener() {}, dispatchEvent() {},
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx); await ctx.WosMySkin.refresh(); return ctx.WosMySkin;
}
test('old Service plus two cached previews cannot create My skin 2 / My skin 3 on discovery', async () => {
  const server = oldService(), original = structuredClone(server.data);
  const preview = JSON.stringify({ version: 1, active: 'device-copy', migrated: true, skins: [{ id: 'device-copy', name: 'My skin', base: 'grove', tweaks: {} }] });
  for (let i = 0; i < 2; i++) {
    const store = new Map([['wos.own-skins.v1', preview]]), M = await boot(server, store);
    await M.refresh();
    assert.equal(store.get('wos.own-skins.v1'), preview, 'retain the local preview byte-for-byte');
    assert.equal(M.active.id, 'My skin');
    assert.equal(M.previews[0].id, 'device-copy', 'legacy preview stays explicitly recoverable even with a box cache');
    const reloaded = await boot(server, store); assert.equal(reloaded.previews[0].id, 'device-copy');
    M.dismissPreview('device-copy'); assert.equal(M.previews.length, 0); assert.equal(store.get('wos.own-skins.v1'), preview);
    assert.equal((await boot(server, store)).previews.length, 0, 'only the explicit dismissal persists');
  }
  console.log('DISCOVERY_METADATA', JSON.stringify(server.data));
  assert.deepEqual(server.writes, [], 'read-only discovery never submits background migration POSTs or activations');
  assert.deepEqual(server.data, original, 'all owner contents and the active pointer stay untouched');
});
test('an already-matching preview cannot silently activate over the box selection', async () => {
  const server = oldService(); server.data.skins.push({ id: 'Other', name: 'Other', base: 'grove', tweaks: {} });
  const preview = JSON.stringify({ version: 1, active: 'device-copy', skins: [{ id: 'device-copy', name: 'Other', base: 'grove', tweaks: {} }] });
  await boot(server, new Map([['wos.own-skins.v1', preview]]));
  assert.equal(server.data.active, 'My skin'); assert.deepEqual(server.writes, []);
});
