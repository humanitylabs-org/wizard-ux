import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStoreDataRoutes, PREFIX } from '../tools/store-data-origin.mjs';
import { createRouterOwnerRoutes, loopbackJson, routerOrigin } from '../tools/store-router-owner.mjs';

async function serve(handler) {
  const server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}
function origin(calls, reply = () => ({ status: 200, body: { ok: true } })) {
  const call = async (o, method, path, body) => { calls.push({ o, method, path, body }); return reply(method, path, body); };
  return createStoreDataRoutes({ routerOwner: createRouterOwnerRoutes({ origin: 'http://127.0.0.1:1', call }), index: async () => ({ status: 200, body: {} }) });
}
const approve = (base, body, headers = {}) => fetch(base + PREFIX + 'router/v1/approve', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1', ...headers }, body: JSON.stringify(body) });

test('router owner reads pass through as fixed loopback calls', async () => {
  const calls = [], s = await serve(origin(calls));
  try {
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/needs/wisdom')).status, 200);
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/routes')).status, 200);
    assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), ['GET /v1/owner/needs/wisdom', 'GET /v1/owner/routes']);
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/needs/Bad_Id')).status, 405);
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/needs/wisdom?x=1')).status, 400);
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/provider-order', { method: 'POST' })).status, 405, 'only approve may write');
    assert.equal((await fetch(s.base + PREFIX + 'api/apps/installed', { method: 'POST' })).status, 405, 'everything else stays read-only');
    assert.equal(calls.length, 2);
  } finally { await s.close(); }
});

test('approve needs the Store header, JSON and same-origin; it forwards install scope only', async () => {
  const calls = [], s = await serve(origin(calls));
  const good = { app: 'wisdom', feature: 'ask-ai', provider: 'wizard-chatgpt', model: 'gpt-5.1', scope: 'run', override: 'x', extra: 1 };
  try {
    assert.equal((await approve(s.base, good, { 'X-Wizard-Store': '0' })).status, 403);
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/approve', { method: 'POST', headers: { 'X-Wizard-Store': '1', 'Content-Type': 'text/plain' }, body: JSON.stringify(good) })).status, 403);
    assert.equal((await approve(s.base, good, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await approve(s.base, { ...good, app: '../x' })).status, 400);
    assert.equal((await approve(s.base, { ...good, model: 'a b' })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await approve(s.base, good, { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    assert.deepEqual(calls, [{ o: 'http://127.0.0.1:1', method: 'POST', path: '/v1/owner/approve',
      body: { app: 'wisdom', feature: 'ask-ai', provider: 'wizard-chatgpt', model: 'gpt-5.1', scope: 'install' } }]);
    const big = await fetch(s.base + PREFIX + 'router/v1/approve', { method: 'POST', headers: { 'X-Wizard-Store': '1', 'Content-Type': 'application/json' }, body: 'x'.repeat(5000) });
    assert.equal(big.status, 413);
  } finally { await s.close(); }
});

test('an older Router or a stopped one gives a clear status', async () => {
  let mode = 'old';
  const s = await serve(origin([], () => { if (mode === 'down') throw new Error('ECONNREFUSED');
    return mode === 'old' ? { status: 404, body: { type: 'error', code: 'blocked', message: 'Unknown route or method.' } }
      : { status: 403, body: { type: 'error', code: 'blocked', message: 'Calling app is not installed.' } }; }));
  try {
    assert.equal((await fetch(s.base + PREFIX + 'router/v1/needs/wisdom')).status, 501);
    mode = 'unknown'; const r = await fetch(s.base + PREFIX + 'router/v1/needs/wisdom');
    assert.equal(r.status, 403); assert.equal((await r.json()).message, 'Calling app is not installed.');
    mode = 'down'; assert.equal((await fetch(s.base + PREFIX + 'router/v1/needs/wisdom')).status, 503);
  } finally { await s.close(); }
});

test('loopback calls carry no browser, forwarding or grant headers', async () => {
  let seen; const s = await serve((req, res) => { seen = req.headers; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  try {
    const r = await loopbackJson(s.base, 'POST', '/v1/owner/approve', { a: 1 });
    assert.deepEqual(r, { status: 200, body: { ok: true } });
    for (const h of ['origin', 'x-forwarded-for', 'forwarded', 'tailscale-user-login', 'x-wizard-grant', 'x-wizard-app', 'cookie']) assert.equal(seen[h], undefined, h);
    assert.equal(routerOrigin('http://evil.example:80'), 'http://127.0.0.1:8802');
    assert.equal(routerOrigin('http://127.0.0.1:18802'), 'http://127.0.0.1:18802');
  } finally { await s.close(); }
});
