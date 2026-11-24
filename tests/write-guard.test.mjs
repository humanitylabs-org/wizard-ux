// wizard-ux issue 1439: the shell's write guard (web/core/write-guard.js, switch wizard/write-guard, off by default).
// Runs the real module in a vm with a fake fetch and a fake clock. Run: node --test tests/write-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../web/core/write-guard.js', import.meta.url), 'utf8');
const ORIGIN = 'https://box.test';

function load({ on = true, apps = null, answer = null } = {}) {
  const clock = { t: Date.parse('2026-11-24T10:00:00Z') };
  const calls = [], events = [], storage = new Map();
  if (apps) storage.set('wux.apps.v1', JSON.stringify(apps));
  const root = { dataset: { tweaks: on ? 'wizard/thread-tracker wizard/write-guard' : 'wizard/thread-tracker', shell: 'phone' } };
  const reply = answer || (() => new Response(JSON.stringify({ ok: true, n: calls.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  function fetch(input, init) { calls.push({ url: String(input), init, self: this }); return new Promise(r => r(reply(String(input), init, calls.length))); }
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const window = {
    fetch, location: { href: ORIGIN + '/wizard-os-home/index.html', origin: ORIGIN },
    dispatchEvent: e => events.push(e), WizWebUpdate: { version: 'web-abc123' },
  };
  const ctx = vm.createContext({
    window, document: { documentElement: root }, location: window.location, Date: FakeDate, URL, URLSearchParams, Response, Request, Headers,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    console,
  });
  vm.runInContext(SRC, ctx);
  const put = (path, body, extra = {}) => window.fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, ...extra });
  return { window, calls, events, clock, root, storage, put, guard: window.WosWriteGuard, base: fetch };
}
const wire = (f, path) => f.calls.filter(c => new URL(c.url, ORIGIN).pathname === path).length;

test('switch off: every call goes straight to the page fetch, unchanged', async () => {
  const f = load({ on: false });
  const init = { method: 'PUT', body: '{"a":1}' };
  for (let i = 0; i < 30; i++) await f.put('/wizard/thread-seen', '{"a":1}');
  await f.window.fetch('/wizard/thread-seen', init);
  assert.equal(f.calls.length, 31, 'all 31 identical writes reach the network');
  assert.equal(f.calls.at(-1).init, init, 'the very same init object is passed through');
  assert.equal(f.calls.at(-1).self, f.window, 'called with the page as this');
  assert.deepEqual(JSON.parse(JSON.stringify(f.guard.stats())), {}, 'nothing counted');
});

test('the same write within 10 s gets the earlier answer and stays off the wire', async () => {
  const f = load();
  const a = await f.put('/wizard/thread-seen', '{"s":1}');
  f.clock.t += 9000;
  const b = await f.put('/wizard/thread-seen', '{"s":1}');
  assert.equal(wire(f, '/wizard/thread-seen'), 1);
  assert.deepEqual(await b.json(), await a.json(), 'the dropped call reads the first answer');
  assert.equal(b.status, 200);
  await f.put('/wizard/thread-seen', '{"s":2}');
  assert.equal(wire(f, '/wizard/thread-seen'), 2, 'a different body goes out');
  assert.equal(f.guard.stats()['PUT /wizard/thread-seen'].dropped, 1);
});

test('a box that never keeps one record: one resend after 10 s, then nothing', async () => {
  const f = load();
  // The old thread-seen loop (issue 1428): every list read, about every 300 ms, sends the whole state again.
  for (let i = 0; i < 2000; i++) { await f.put('/wizard/thread-seen', '{"threads":{"direct:lost":{"seenAt":5}}}'); f.clock.t += 300; }
  assert.equal(wire(f, '/wizard/thread-seen'), 2, 'the first write and one resend in 10 minutes of looping');
  f.clock.t += 10 * 60000;
  await f.put('/wizard/thread-seen', '{"threads":{"direct:lost":{"seenAt":5}}}');
  assert.equal(wire(f, '/wizard/thread-seen'), 3, 'after the 10 min hold one more goes');
});

test('an identical write in flight shares the one request', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const f = load({ answer: () => gate.then(() => new Response('{"ok":true}', { status: 200 })) });
  const calls = [f.put('/wizard/v1/ui-preferences', '{"x":1}'), f.put('/wizard/v1/ui-preferences', '{"x":1}'), f.put('/wizard/v1/ui-preferences', '{"x":1}')];
  release();
  const out = await Promise.all(calls.map(p => p.then(r => r.json())));
  assert.equal(f.calls.length, 1); assert.deepEqual(out, [{ ok: true }, { ok: true }, { ok: true }]);
});

test('a failed write may be tried again at once', async () => {
  let fail = true;
  const f = load({ answer: () => new Response('{}', { status: fail ? 503 : 200 }) });
  await f.put('/wizard/thread-seen', '{"s":1}');
  fail = false;
  const r = await f.put('/wizard/thread-seen', '{"s":1}');
  assert.equal(f.calls.length, 2); assert.equal(r.status, 200);
  const g = load({ answer: () => { throw new TypeError('offline'); } });
  await assert.rejects(g.put('/wizard/thread-seen', '{"s":1}'));
  await assert.rejects(g.put('/wizard/thread-seen', '{"s":1}'));
  assert.equal(g.calls.length, 2, 'a network failure is not an answer to copy');
});

test('two real sends of the same words (each its own Idempotency-Key) both go out', async () => {
  const f = load();
  const send = key => f.window.fetch('/wizard/hermes/v1/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: '{"input":"yes"}' });
  await send('k1'); await send('k2'); await send('k2');
  assert.equal(f.calls.length, 2, 'the double tap (same key) is one send');
});

test('reads, other origins and uploads with a stream body are never deduplicated', async () => {
  const f = load();
  for (let i = 0; i < 3; i++) await f.window.fetch('/wizard/thread-seen');
  for (let i = 0; i < 3; i++) await f.window.fetch('https://elsewhere.test/x', { method: 'PUT', body: 'same' });
  const blob = new Blob(['x']);
  for (let i = 0; i < 3; i++) await f.window.fetch('/wizard/v1/voice', { method: 'POST', body: blob });
  assert.equal(f.calls.length, 9);
});

test('breaker: the 21st write in a minute to one endpoint pauses it with a 429 and Retry-After, backing off', async () => {
  const f = load({ apps: [{ id: 'feedback', name: 'Feedback', url: '/feedback/' }] });
  const statuses = [];
  for (let i = 0; i < 25; i++) { statuses.push((await f.put('/wizard/hermes/api/sessions/20261124_100000_abcdef', `{"n":${i}}`, { method: 'PATCH' })).status); f.clock.t += 100; }
  assert.equal(wire(f, '/wizard/hermes/api/sessions/20261124_100000_abcdef'), 20, '20 reach the box');
  assert.deepEqual(statuses.slice(20), [429, 429, 429, 429, 429]);
  const paused = await f.put('/wizard/hermes/api/sessions/20261124_100000_abcdef', '{"n":99}', { method: 'PATCH' });
  assert.equal(paused.headers.get('Retry-After'), '30'); assert.equal(paused.headers.get('X-Wizard-Write-Guard'), 'paused');
  assert.equal((await paused.json()).error.code, 'write_paused');
  await f.put('/wizard/thread-seen', '{"other":1}');
  assert.equal(wire(f, '/wizard/thread-seen'), 1, 'other endpoints keep working');
  assert.equal(f.events.filter(e => e.type === 'wos:write-guard').length, 1);
  // after 30 s it opens; a second burst pauses for 60 s
  f.clock.t += 30000;
  for (let i = 0; i < 21; i++) await f.put('/wizard/hermes/api/sessions/20261124_100000_abcdef', `{"m":${i}}`, { method: 'PATCH' });
  const again = await f.put('/wizard/hermes/api/sessions/20261124_100000_abcdef', '{"m":99}', { method: 'PATCH' });
  assert.equal(again.headers.get('Retry-After'), '60', 'backoff doubles');
  // the bug report: once a day per endpoint, through the Feedback app, ids redacted
  const filed = f.calls.filter(c => c.url.endsWith('/feedback/api/feedback'));
  assert.equal(filed.length, 1, 'one report today');
  const body = JSON.parse(filed[0].init.body);
  assert.equal(body.kind, 'bug'); assert.equal(body.wizard_version, 'web-abc123');
  assert.match(body.text, /PATCH \/wizard\/hermes\/api\/sessions\/:id went out 21 times in one minute on this phone/);
  assert.match(body.text, /Build: web-abc123/); assert.doesNotMatch(body.text, /abcdef/);
  f.clock.t += 24 * 3600000;
  for (let i = 0; i < 21; i++) await f.put('/wizard/hermes/api/sessions/20261124_100000_abcdef', `{"d":${i}}`, { method: 'PATCH' });
  assert.equal(f.calls.filter(c => c.url.endsWith('/feedback/api/feedback')).length, 2, 'next day: one more');
});

test('without the Feedback app the report stays on this device', async () => {
  const f = load();
  for (let i = 0; i < 21; i++) await f.put('/wizard/thread-seen', `{"n":${i}}`);
  await new Promise(r => setTimeout(r, 0));
  const kept = f.guard.reports();
  assert.equal(kept.length, 1); assert.equal(kept[0].endpoint, 'PUT /wizard/thread-seen'); assert.equal(kept[0].filed, 'no-feedback-app'); assert.equal(kept[0].rate, 21);
});

test('a 429 with Retry-After from the box pauses that endpoint for as long as it says', async () => {
  let limited = true;
  const f = load({ answer: () => limited ? new Response('{"error":"client_storm"}', { status: 429, headers: { 'Retry-After': '5' } }) : new Response('{}', { status: 200 }) });
  assert.equal((await f.put('/wizard/thread-seen', '{"a":1}')).status, 429);
  limited = false;
  f.clock.t += 4000;
  const held = await f.put('/wizard/thread-seen', '{"a":2}');
  assert.equal(held.status, 429); assert.equal(held.headers.get('Retry-After'), '1');
  assert.equal(f.calls.length, 1, 'nothing on the wire while the box asked to wait');
  f.clock.t += 1500;
  assert.equal((await f.put('/wizard/thread-seen', '{"a":2}')).status, 200);
  assert.equal(f.calls.length, 2);
  // HTTP-date form
  const g = load({ answer: (u, i, n) => n === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': new Date(Date.parse('2026-11-24T10:00:20Z')).toUTCString() } }) : new Response('{}') });
  await g.put('/wizard/v1/workspaces', '{"a":1}');
  g.clock.t += 19000; assert.equal((await g.put('/wizard/v1/workspaces', '{"b":1}')).status, 429);
  g.clock.t += 2000; assert.equal((await g.put('/wizard/v1/workspaces', '{"b":1}')).status, 200);
});

test('the switch is read on every write: turning it off mid-run lets everything through again', async () => {
  const f = load();
  await f.put('/wizard/thread-seen', '{"a":1}'); await f.put('/wizard/thread-seen', '{"a":1}');
  assert.equal(f.calls.length, 1);
  f.root.dataset.tweaks = 'wizard/thread-tracker';
  await f.put('/wizard/thread-seen', '{"a":1}');
  assert.equal(f.calls.length, 2);
});
