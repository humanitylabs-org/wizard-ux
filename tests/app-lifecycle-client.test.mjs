import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/app-lifecycle-client.js', import.meta.url), 'utf8');
function fixture({ rejectOnce = false, uncertainOnce = false, refreshFails = false, host = '127.0.0.1', installedInitially = [] } = {}) {
  let clock = 0, boot = 0, writes = 0, csrf = 'session-1';
  let rows = installedInitially; const calls = []; const saved = new Map();
  class MockDate extends Date { static now() { return clock; } }
  const window = { WizCore: { apps: { refresh: async () => { if (refreshFails) throw Error('read failed'); } } }, dispatchEvent() {} }; window.top = window;
  const fetch = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/wizard/v1/bootstrap') return Response.json({ capabilities: { app_installation: true } });
    if (path === '/wizard/v1/app-lifecycle/session') { boot++; csrf = 'session-' + boot; return Response.json({ csrf, expires_in: 3600 }); }
    if (path === '/api/apps/installed') return Response.json({ installed: rows });
    if (path.startsWith('/api/app-lifecycle/')) {
      writes++;
      if (rejectOnce && writes === 1) return Response.json({ error: 'owner_session_required' }, { status: 403 });
      if (uncertainOnce && writes === 1) throw Error('reply lost');
      const id = decodeURIComponent(path.split('/')[3]).split(':')[0], action = path.split('/').at(-1);
      rows = action === 'uninstall' ? rows.filter(x => x.info.id !== id) : [...rows.filter(x => x.info.id !== id), { info: { id }, app: { status: action === 'stop' ? 'stopped' : 'running' } }];
      return Response.json({ success: true });
    }
    throw Error('unexpected URL: ' + path);
  };
  const context = { window, parent: window, location: { hostname: host }, sessionStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) }, crypto: { randomUUID: () => `01234567-89ab-cdef-0123-${calls.length.toString().padStart(12,'0')}` }, Date: MockDate, Response, fetch, CustomEvent: class {}, setTimeout: (fn) => queueMicrotask(fn) };
  vm.runInNewContext(source, context);
  return { client: window.WizAppLifecycle, calls, advance: () => { clock += 3600_000; }, boot: () => boot };
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
  const f = fixture({ host: 'apps.staging.wizard001.com' });
  await assert.rejects(f.client.operate('hello', 'install'), e => e.code === 'read_only');
  assert.equal(f.calls.filter(c => c.opts.method).length, 0);
});
test('uninstall has the explicit backup flag and requires missing installed projection', async () => {
  const f = fixture({ installedInitially: [{info:{id:'hello'},app:{status:'running'}}] });
  assert.equal((await f.client.operate('hello', 'uninstall')).status, 'removed');
  const write = f.calls.find(c => c.opts.method === 'DELETE');
  assert.deepEqual(JSON.parse(write.opts.body), { removeBackups: false });
});
