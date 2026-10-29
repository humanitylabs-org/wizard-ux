import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const start = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
for (const prefix of ['', '/wizard-music']) test(`QA origin opt-in app route strips prefix and forwards reads only without owner credentials (upstream=${prefix || 'root'})`, async () => {
  const reads = [];
  const upstream = http.createServer((req, res) => { reads.push({ url: req.url, method: req.method, cookie: req.headers.cookie, authorization: req.headers.authorization }); res.setHeader('content-type', 'application/json'); res.end('{"fixture":true}'); });
  const port = await start(upstream), reserve = http.createServer();
  const qaPort = await start(reserve); await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [new URL('../tools/qa-origin.cjs', import.meta.url).pathname, String(qaPort)], { env: { ...process.env, QA_READ_APP_PREFIX: '/fixture/', QA_READ_APP_PORT: String(port), QA_READ_APP_UPSTREAM_PREFIX: prefix }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const base = `http://127.0.0.1:${qaPort}`;
    const response = await fetch(base + '/fixture/api?test=1', { headers: { cookie: 'owner=not-a-real-secret', authorization: 'Bearer fixture-only' } });
    assert.deepEqual(await response.json(), { fixture: true });
    assert.deepEqual(reads, [{ url: prefix + '/api?test=1', method: 'GET', cookie: undefined, authorization: undefined }]);
    for (const path of ['/fixture/api', '/wizard/v1/sessions', '/wizard-os-home/store-install/_slots/chats']) assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 403);
    assert.equal(reads.length, 1, 'no mutations reached the upstream app');
    assert.equal((await (await fetch(base + '/__qa/refused')).json()).refused, 3);
  } finally { child.kill(); await once(child, 'exit'); await new Promise(resolve => upstream.close(resolve)); }
});
