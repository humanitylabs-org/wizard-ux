// The interactive alert preview must never make a live notification or Agent Service write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
async function origin(t, enabled) {
  const tripwire = createServer((req, res) => { assert.fail(`Unexpected upstream access: ${req.method} ${req.url}`); res.end(); });
  const backend = await listen(tripwire); t.after(() => tripwire.close());
  const reservation = createServer(); const port = await listen(reservation); await new Promise(r => reservation.close(r));
  const child = spawn(process.execPath, [new URL('../tools/qa-origin.cjs', import.meta.url).pathname, String(port)], { env: { ...process.env, QA_SAMPLE_ALERTS: enabled ? '1' : '0', QA_BACKEND_PORT: String(backend) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(([code]) => { throw Error('Origin exited: ' + code); })]);
  const base = `http://127.0.0.1:${port}`;
  return { get: path => fetch(base + path), mark: body => fetch(base + '/notifications/api/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), base };
}
test('sample preview accepts only synthetic IDs and supported marks; state reads back and resets on reload', async t => {
  const a = await origin(t, true), items = await (await a.get('/notifications/api/items')).json();
  assert.equal(items.items.length, 3); assert.ok(items.items.every(i => i.id.startsWith('preview-alert-')));
  assert.equal((await a.mark({ ids: ['preview-alert-archive'], archived: true })).status, 200);
  const saved = await (await a.get('/__qa/alerts')).json();
  assert.deepEqual({ read: saved.items[0].read, archived: saved.items[0].archived }, { read: true, archived: true });
  assert.equal(saved.liveWrites, false);
  for (const body of [{ ids: ['real-alert'], archived: true }, { ids: ['preview-alert-done'], flagged: true }, { ids: ['preview-alert-done'], read: 'yes' }]) assert.equal((await a.mark(body)).status, 400);
  assert.equal((await fetch(a.base + '/wizard/anything', { method: 'POST', body: '{}' })).status, 403);
  await a.get('/wizard-os-home/');
  assert.equal((await (await a.get('/__qa/alerts')).json()).items[0].archived, false);
});
test('ordinary QA origin still refuses every notification write when sample mode is not enabled', async t => {
  const a = await origin(t, false);
  assert.equal((await a.mark({ ids: ['preview-alert-archive'], archived: true })).status, 403);
});
