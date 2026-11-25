// Share feature counts (wizard-app-manager#701, box switch wizard/try-feature-counts): the shell reads the Try new
// features state of the apps the App Manager can't call itself (no owner proof) and posts only {id, issues, tried,
// vote} to the App Manager's owner route. Runs the real block of web/core/settings.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const settings = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = settings.indexOf(a), j = settings.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return settings.slice(i, j); };
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body });

function kit(fetchImpl, tweaks = 'wizard/try-feature-counts') {
  const calls = [];
  const ctx = { URL, JSON, Date, Array, String, encodeURIComponent, calls,
    document: { baseURI: 'https://box.example.ts.net:8444/wizard-os-home/', visibilityState: 'visible', documentElement: { dataset: { tweaks } } },
    window: { fetch: async (u, i = {}) => { calls.push([u, i]); return fetchImpl(u, i); } } };
  vm.createContext(ctx);
  vm.runInContext(between('  const homePath = p =>', '\n  function appSwTake(d)') + '\n'
    + between('  async function appSwFetch(body)', '\n  // A read started before a flip') + '\n'
    + between('  const COUNTS_TWEAK =', "\n  // Armed only while the switch is on")
    + '\nglobalThis.countsCollect = countsCollect; globalThis.countsRun = countsRun;', ctx);
  return ctx;
}

const routes = (u) => {
  if (u === '/wizard-os-home/store-install/_feature-switches') return res(200, { switches: [], apps: [
    { id: 'notes', ok: false, status: 503 }, { id: 'messenger', ok: true }, { id: 'mail', ok: false }, { id: '../x', ok: false }] });
  if (u === '/notes/api/switches') return res(200, { switches: [{ id: 'a', name: 'Secret', description: 'd', on: true, tried: true, vote: 'up', issues: ['o/r#1'] }] });
  if (u === '/mail/api/switches') return res(404, {});
  if (u === '/mail/api/view/switches') return res(403, { error: 'owner_only' });
  if (u === '/wizard-os-home/store-install/_switch-feedback') return res(200, { on: true, recorded: ['notes'] });
  throw new Error('unexpected ' + u);
};

test('reads the apps the App Manager could not call and posts only the counts', async () => {
  const k = kit(routes);
  assert.deepEqual(JSON.parse(JSON.stringify(await k.countsCollect())), { apps: 1, status: 200 });
  assert.ok(!k.calls.some(([u]) => u.startsWith('/messenger/')), 'apps the App Manager reads itself are left to it');
  assert.equal(k.calls.find(([u]) => u === '/notes/api/switches')[1].headers['X-Wizard-Switch'], '1');
  const [, post] = k.calls.at(-1);
  assert.equal(post.method, 'POST'); assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.deepEqual(JSON.parse(post.body), { apps: [{ id: 'notes', switches: [{ id: 'a', issues: ['o/r#1'], tried: true, vote: 'up' }] }] });
});

test('switch off: nothing is read or sent; on: at most once per 10 minutes', async () => {
  const off = kit(routes, 'wizard/desktop-chats');
  assert.equal(off.countsRun(), null); assert.equal(off.calls.length, 0);
  const on = kit(routes);
  await on.countsRun();
  const n = on.calls.length;
  assert.ok(n > 0);
  assert.equal(on.countsRun(), null); assert.equal(on.calls.length, n);
});

test('nothing to report posts nothing', async () => {
  const k = kit(() => res(200, { switches: [], apps: [{ id: 'messenger', ok: true }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(await k.countsCollect())), { apps: 0 });
  assert.equal(k.calls.length, 1);
});
