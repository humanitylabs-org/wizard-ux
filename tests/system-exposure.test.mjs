// Synthetic only: injected collectors/knocks/notifications/timers; no network or SSH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as exposure from '../tools/system-exposure.mjs';

const {parseAddrs, isPublic, plan, verdict, createExposureChecker, mergeAccess, readExposure, notifyOwner} = exposure;
const A = '8.8.8.8', B = '1.1.1.1'; // literals in fixtures only; never connected
const NOW = Date.parse('2026-11-02T00:00:00.000Z');
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-synthetic-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const registryPath = path.join(dir, 'devices.json'), file = path.join(dir, 'exposure.json');
  fs.writeFileSync(registryPath, JSON.stringify({this: {name: 'Box'}, devices: [{id: 'peer', name: 'Peer', connect: {type: 'ssh', host: 'peer.invalid'}}]}));
  const addrs = {this: {v4: [A], v6: [], listen: [22]}, peer: {v4: [B], v6: [], listen: []}};
  const checker = createExposureChecker({registryPath, path: file, now: () => NOW,
    readAddrsImpl: async m => addrs[m.id], knockImpl: async () => [], notify: async () => true, ...options});
  return {checker, file, addrs};
}

test('a bounded negative never says Tailscale only: translated/UDP ports and address discovery are incomplete', () => {
  const p = {tested: {v4: true, v6: true}, by: {v4: 'peer', v6: 'peer'}, ports: [22, 443]};
  const v = verdict({id: 'this'}, p, [], {peer: 'Peer'});
  assert.equal(v.exposure, 'unchecked');
  assert.match(v.details.join(' '), /tested|sample/i);
  assert.match(v.details.join(' '), /translated|NAT/i);
  assert.doesNotMatch(v.details.join(' '), /Nothing answers from the internet|Tailscale is the only way/i);
});

test('partial, failed and IPv6-only discovery never produce a safe verdict', () => {
  for (const tested of [{v4: true, v6: false}, {v4: false, v6: false}, {v6: true}]) {
    const v = verdict({id: 'this'}, {tested, by: {v4: 'peer', v6: 'peer'}, ports: [22]}, [], {peer: 'Peer'});
    assert.equal(v.exposure, 'unchecked');
  }
});

test('unknown Tailscale Self.Addrs is not an authoritative public address source', () => {
  const j = parseAddrs('ts=' + JSON.stringify({Self: {Addrs: [A + ':41641', '[2606:4700:4700::1111]:41641']}}));
  assert.deepEqual(j.v4, []);
  assert.deepEqual(j.v6, []);
  const direct = parseAddrs(`v4=${A}\nv6=2606:4700:4700::1111\nlisten=22`);
  assert.deepEqual(direct.v4, [A]); assert.deepEqual(direct.listen, [22]);
});

test('special-use addresses and malformed values cannot become scan targets', () => {
  for (const a of [null, {}, '127.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1', '192.0.0.1', '2001:db8::1', '3fff::1']) {
    assert.equal(isPublic(a), false, String(a));
  }
  assert.equal(isPublic(A), true);
});

test('unknown and malformed address families cannot crash the planner or create jobs', () => {
  for (const addrs of [{}, {v4: 'bad', v6: [], listen: []}, {v4: [null, '127.0.0.1'], v6: [], listen: [22]}]) {
    const {jobs, out} = plan([{id: 'this', addrs}, {id: 'peer', addrs: {v4: [B], v6: [], listen: [22]}}]);
    assert.equal(jobs.size, 0); assert.equal(verdict({id: 'this'}, out.this, [], {}).exposure, 'unchecked');
  }
});

test('an IPv6-only pair is not assumed to be on different networks', () => {
  const {jobs} = plan([{id: 'this', addrs: {v4: [], v6: ['2606:4700:1::1'], listen: []}},
    {id: 'peer', addrs: {v4: [], v6: ['2606:4700:2::1'], listen: []}}]);
  assert.equal(jobs.size, 0);
});

test('script generation rejects shell payloads without executing scripts', () => {
  const targets = [{addr: A, port: 22}, {addr: '$(id)', port: 22}, {addr: A, port: '22;id'}, null];
  for (const s of [exposure.knockSh(targets), exposure.knockPs(targets)]) {
    assert.ok(s.includes(A)); assert.ok(!s.includes('$(id)')); assert.ok(!s.includes('22;id'));
  }
});

test('only hits requested in the synthetic plan are accepted', async t => {
  const f = fixture(t, {knockImpl: async () => [{addr: '9.9.9.9', port: 1234}]});
  const r = await f.checker.checkNow();
  assert.equal(r.machines.this.exposure, 'unchecked');
  assert.equal(r.machines.peer.exposure, 'unchecked');
});

test('notification false is retried after restart, then acknowledged only once', async t => {
  let calls = 0;
  const options = {knockImpl: async (_, targets) => targets.filter(x => x.addr === A && x.port === 22), notify: async () => { calls++; return calls > 1; }};
  const f = fixture(t, options);
  await f.checker.checkNow(); assert.equal(calls, 1);
  assert.deepEqual(readExposure(f.file, NOW).machines.this.notification.pending, [22]);
  const again = createExposureChecker({path: f.file, registryPath: path.join(path.dirname(f.file), 'devices.json'), now: () => NOW,
    readAddrsImpl: async m => f.addrs[m.id], ...options});
  await again.checkNow(); assert.equal(calls, 2);
  await again.checkNow(); assert.equal(calls, 2);
  assert.deepEqual(readExposure(f.file, NOW).machines.this.notification.pending, []);
});

test('notification exceptions do not discard durable evidence or lose retry', async t => {
  let calls = 0;
  const f = fixture(t, {knockImpl: async (_, ts) => ts.filter(x => x.addr === A && x.port === 22),
    notify: async () => { calls++; if (calls === 1) throw new Error('offline'); return true; }});
  const r = await f.checker.checkNow(); assert.equal(r.machines.this.exposure, 'internet');
  await f.checker.checkNow(); assert.equal(calls, 2);
});

test('an inconclusive or offline later check cannot silently discard a pending alert', async t => {
  let open = true, offline = false, calls = 0;
  const f = fixture(t, {readAddrsImpl: async m => {if (offline) throw new Error('offline'); return {v4: [m.id === 'this' ? A : B], v6: [], listen: [22]};},
    knockImpl: async (_, ts) => open ? ts.filter(x => x.addr === A && x.port === 22) : [],
    notify: async () => { calls++; return false; }});
  await f.checker.checkNow(); open = false;
  await f.checker.checkNow(); offline = true;
  await f.checker.checkNow(); assert.equal(calls, 3);
  assert.deepEqual(readExposure(f.file, NOW).machines.this.notification.pending, [22]);
});

test('HTTP success is not an MCP acknowledgment, errors and redirects are refused', async () => {
  const url = 'http://127.0.0.1:9999/mcp';
  for (const body of ['', 'not-json', '{}', '{"jsonrpc":"2.0","id":1,"error":{"message":"no"}}', '{"jsonrpc":"2.0","id":1,"result":{"isError":true}}']) {
    assert.equal(await notifyOwner('t', 'm', {url, fetchImpl: async () => ({ok: true, text: async () => body})}), false);
  }
  assert.equal(await notifyOwner('t', 'm', {url, fetchImpl: async (_, init) => {
    assert.equal(init.redirect, 'error');
    return {ok: true, text: async () => '{"jsonrpc":"2.0","id":1,"result":{"content":[]}}'};
  }}), true);
});

test('notification URL validation refuses credentials, non-loopback and malformed origins before fetch', async () => {
  for (const url of ['http://127.0.0.1:80@outside.invalid/mcp', 'http://127.0.0.1:1.example.invalid/', 'https://outside.invalid/', 'file:///x']) {
    assert.equal(await notifyOwner('t', 'm', {url, fetchImpl: async () => { assert.fail('must not fetch'); }}), false);
  }
});

test('malformed cached machines cannot crash the feed merge; old automatic safe claims are downgraded', t => {
  const f = fixture(t), hand = {exposure: 'internet', how: 'owner access', details: ['Emergency console']};
  for (const auto of [{}, {at: null}, {at: 1}, {at: 'bad', details: {}}, {at: new Date(NOW + 1000).toISOString(), exposure: 'tailscale'}]) {
    assert.doesNotThrow(() => mergeAccess(hand, auto, NOW));
    assert.notEqual(mergeAccess(hand, auto, NOW)?.exposure, 'tailscale');
  }
  fs.writeFileSync(f.file, JSON.stringify({at: new Date(NOW).toISOString(), machines: {this: {at: new Date(NOW).toISOString(), exposure: 'tailscale', details: ['Nothing answers']}, bad: {at: null}}}));
  const j = readExposure(f.file, NOW);
  assert.equal(j.machines.this.exposure, 'unchecked');
  assert.equal(Object.hasOwn(j.machines, 'bad'), false);
  assert.equal(mergeAccess(hand, j.machines.this, NOW).how, 'owner access');
});

test('future cached timestamps cannot suppress a new check', async t => {
  let calls = 0;
  const f = fixture(t, {readAddrsImpl: async () => {calls++; return {v4: [], v6: [], listen: []};}});
  fs.writeFileSync(f.file, JSON.stringify({at: new Date(NOW + 86400000).toISOString(), machines: {}}));
  await f.checker.checkSoon(); assert.equal(calls, 2);
});

test('coalesced requests use one synthetic check; no I/O starts at construction', async t => {
  let calls = 0, release;
  const blocked = new Promise(r => {release = r;});
  const f = fixture(t, {readAddrsImpl: async () => {calls++; await blocked; return {v4: [], v6: [], listen: []};}});
  assert.equal(calls, 0);
  const one = f.checker.checkNow(), two = f.checker.checkNow(); assert.equal(one, two);
  release(); await one; assert.equal(calls, 2);
});

test('timer start is idempotent and every scheduled handle is unreferenced; stop prevents rearming', async t => {
  let seq = 0, calls = 0;
  const timers = new Map();
  const f = fixture(t, {readAddrsImpl: async () => {calls++; return {v4: [], v6: [], listen: []};},
    setTimeoutImpl: (fn, ms) => { const id = ++seq; const timer = {fn, ms, unrefs: 0, unref() {this.unrefs++;}}; timers.set(id, timer); return {id, unref: () => timer.unref()}; },
    clearTimeoutImpl: timer => timers.delete(timer?.id)});
  f.checker.start(300000, 1000); f.checker.start(300000, 1000);
  try {
    assert.equal(timers.size, 1);
    let [id, task] = [...timers][0]; timers.delete(id); assert.equal(task.unrefs, 1); await task.fn();
    assert.equal(calls, 2); assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].unrefs, 1);
    f.checker.stop(); assert.equal(timers.size, 0);
  } finally { f.checker.stop(); }
});

test('stopping while a timer check awaits cannot schedule another check', async t => {
  let task, release;
  const wait = new Promise(r => {release = r;});
  let scheduled = 0;
  const f = fixture(t, {readAddrsImpl: async () => {await wait; return {v4: [], v6: [], listen: []};},
    setTimeoutImpl: fn => {scheduled++; task = fn; return {unref() {}};}, clearTimeoutImpl: () => {}});
  f.checker.start(300000, 1000);
  try {
    assert.equal(typeof task, 'function'); const run = task(); f.checker.stop(); release(); await run; assert.equal(scheduled, 1);
  } finally {f.checker.stop(); release();}
});

test('new module remains dormant: no exposure endpoint, read-capability scan bridge or startup timer wired', () => {
  for (const file of ['../tools/system-resources.mjs', '../tools/system-devices.mjs', '../web/core/resources.js', '../web/core/skin-host.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /createExposureChecker|checkExposure|readExposure|mergeAccess/);
  }
});
