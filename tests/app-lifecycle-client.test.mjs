import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/app-lifecycle-client.js', import.meta.url), 'utf8');
// The fake bridge journals every outcome under its Idempotency-Key and replays it for the same key, like
// wam/lifecycle.py: a definitive failure is journaled too. `failNext` = the next new key's journaled failure.
function fixture({ rejectOnce = false, uncertainOnce = false, refreshFails = false, host = '127.0.0.1', installedInitially = [], failNext = null, busyFor = 0, proxyLosesNext = false } = {}) {
  let clock = 0, boot = 0, writes = 0, csrf = 'session-1';
  let rows = installedInitially; const calls = []; const saved = new Map(); const journal = new Map();
  class MockDate extends Date { static now() { return clock; } }
  const window = { WizCore: { apps: { refresh: async () => { if (refreshFails) throw Error('read failed'); } } }, dispatchEvent() {} }; window.top = window;
  const fetch = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/wizard/v1/bootstrap') return Response.json({ capabilities: { app_installation: true } });
    if (path === '/wizard/v1/app-lifecycle/session') { boot++; csrf = 'session-' + boot; return Response.json({ csrf, expires_in: 3600 }); }
    if (path === '/api/apps/installed') {
      if (busyFor > 0) { busyFor--; return Response.json({ installed: rows.map(x => ({ ...x, app: { status: 'installing' } })) }); }
      return Response.json({ installed: rows });
    }
    if (path.startsWith('/wizard/v1/index/search')) return Response.json({ apps: [{ id: 'dep', name: 'Dep' }] });
    if (path.startsWith('/api/app-lifecycle/')) {
      writes++;
      if (rejectOnce && writes === 1) return Response.json({ error: 'owner_session_required' }, { status: 403 });
      if (uncertainOnce && writes === 1) throw Error('reply lost');
      const key = opts.headers['Idempotency-Key'];
      if (!journal.has(key)) {
        if (failNext) { journal.set(key, failNext); failNext = null; }
        else {
          const id = decodeURIComponent(path.split('/')[3]).split(':')[0], action = path.split('/').at(-1);
          rows = action === 'uninstall' ? rows.filter(x => x.info.id !== id) : [...rows.filter(x => x.info.id !== id), { info: { id }, app: { status: action === 'stop' ? 'stopped' : 'running' } }];
          journal.set(key, { status: 200, body: { success: true } });
        }
      }
      const out = journal.get(key);
      if (proxyLosesNext) { proxyLosesNext = false; return new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } }); }
      return Response.json(out.body, { status: out.status });
    }
    throw Error('unexpected URL: ' + path);
  };
  const context = { window, parent: window, location: { hostname: host }, sessionStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) }, crypto: { randomUUID: () => `01234567-89ab-cdef-0123-${calls.length.toString().padStart(12,'0')}` }, Date: MockDate, Response, fetch, CustomEvent: class {}, setTimeout: (fn) => queueMicrotask(fn) };
  vm.runInNewContext(source, context);
  return { client: window.WizAppLifecycle, calls, advance: (ms = 3600_000) => { clock += ms; }, boot: () => boot, writes: () => calls.filter(c => c.opts.method && c.path.startsWith('/api/app-lifecycle/')) };
}
test('owner session restart retries exactly once using the same operation key', async () => {
  const f = fixture({ rejectOnce: true });
  assert.equal((await f.client.operate('hello', 'install')).status, 'running');
  const writes = f.calls.filter(c => c.opts.method === 'POST');
  assert.equal(writes.length, 2); assert.equal(f.boot(), 2);
  assert.equal(writes[0].opts.headers['Idempotency-Key'], writes[1].opts.headers['Idempotency-Key']);
  assert.notEqual(writes[0].opts.headers['X-Wizard-CSRF'], writes[1].opts.headers['X-Wizard-CSRF']);
});
test('concurrent apps acquire one owner session and expiry reacquires it', async () => {
  const f = fixture();
  await Promise.all([f.client.operate('one', 'install'), f.client.operate('two', 'install')]);
  assert.equal(f.boot(), 1);
  f.advance(); await f.client.operate('two', 'stop'); assert.equal(f.boot(), 2);
});
test('an uncertain write keeps the retry identity; projection refresh failure never becomes install failure', async () => {
  const f = fixture({ uncertainOnce: true, refreshFails: true });
  await assert.rejects(f.client.operate('hello', 'install'));
  assert.equal((await f.client.operate('hello', 'install')).status, 'running');
  const writes = f.calls.filter(c => c.opts.method === 'POST');
  assert.equal(writes[0].opts.headers['Idempotency-Key'], writes[1].opts.headers['Idempotency-Key']);
});
test('read-only preview makes zero lifecycle writes', async () => {
  const f = fixture({ host: 'apps.staging.wizard.example' });
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'read_only');
  assert.equal(f.calls.filter(c => c.opts.method).length, 0);
});
test('uninstall has the explicit backup flag and requires missing installed projection', async () => {
  const f = fixture({ installedInitially: [{info:{id:'hello'},app:{status:'running'}}] });
  assert.equal((await f.client.operate('hello', 'uninstall')).status, 'removed');
  const write = f.calls.find(c => c.opts.method === 'DELETE');
  assert.deepEqual(JSON.parse(write.opts.body), { removeBackups: false });
});
test('a journaled definitive 5xx is not replayed forever: retry after repair uses a new key', async () => {
  const f = fixture({ failNext: { status: 502, body: { success: false, error: 'store_unavailable' } } });
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'store_unavailable' && e.status === 502);
  assert.equal((await f.client.operate('hello', 'install')).status, 'running');
  const [first, second] = f.writes();
  assert.notEqual(first.opts.headers['Idempotency-Key'], second.opts.headers['Idempotency-Key']);
});
test('operation_unconfirmed keeps the key: the retry replays the same identity', async () => {
  const f = fixture({ failNext: { status: 502, body: { success: false, error: 'operation_unconfirmed' } } });
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'operation_unconfirmed');
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'operation_unconfirmed');
  const [first, second] = f.writes();
  assert.equal(first.opts.headers['Idempotency-Key'], second.opts.headers['Idempotency-Key']);
});
test('pending publication keeps the key for the next tap', async () => {
  const f = fixture({ busyFor: 40 });
  const r = await f.client.operate('hello', 'install');
  assert.equal(r.pending, true);
  await f.client.operate('hello', 'install');
  const [first, second] = f.writes();
  assert.equal(first.opts.headers['Idempotency-Key'], second.opts.headers['Idempotency-Key']);
});
test('Get on a stopped app, or with a stopped dependency, starts it instead of a no-op install', async () => {
  const f = fixture({ installedInitially: [{ info: { id: 'hello' }, app: { status: 'stopped' } }, { info: { id: 'dep' }, app: { status: 'stopped' } }] });
  assert.equal((await f.client.install({ id: 'hello' })).status, 'running');
  assert.deepEqual(f.writes().map(c => c.path.split('/').at(-1)), ['start']);
  assert.equal((await f.client.install({ id: 'needs', uses: ['dep'] })).status, 'running');
  assert.deepEqual(f.writes().map(c => decodeURIComponent(c.path.split('/')[3]) + '/' + c.path.split('/').at(-1)), ['hello:wizardapps/start', 'dep:wizardapps/start', 'needs:wizardapps/install']);
});
test('the owner session renews in its last two minutes, before the Service would expire it', async () => {
  const f = fixture();
  await f.client.operate('one', 'install'); assert.equal(f.boot(), 1);
  f.advance(3600_000 - 110_000); await f.client.operate('one', 'stop'); assert.equal(f.boot(), 2);
});
test('a reply lost behind the outer proxy (non-JSON 502 after the operation ran) keeps the key; retry replays it', async () => {
  const f = fixture({ proxyLosesNext: true });
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'invalid_response' && e.status === 502);
  assert.equal((await f.client.operate('hello', 'install')).status, 'running');
  const [first, second] = f.writes();
  assert.equal(first.opts.headers['Idempotency-Key'], second.opts.headers['Idempotency-Key']);
});
