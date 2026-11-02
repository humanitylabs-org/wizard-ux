import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
// Troubleshooter recovery view (wizard-os #385 census row "troubleshooter"): only the shell's built-in Troubleshooter
// window gets recovery-scoped typed operations; each maps to one fixed /troubleshoot/api/ path carrying the DISTINCT
// recovery token (never the shell token); no Agent Service in the path. The shell's own reads of /troubleshoot/api/
// get the recovery token too. Real Chromium + the real Troubleshooter: tools/qa-browser-recovery-surfaces.cjs.
const ports = new Set();
test.afterEach(() => { for (const p of ports) p.close(); ports.clear(); });
const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'transport did not settle'); await new Promise(r => setTimeout(r, 1)); } };
const quiet = () => new Promise(r => setTimeout(r, 20));
const read = name => fs.readFileSync(new URL('../web/core/' + name, import.meta.url), 'utf8');
const SHELL = 'a1'.repeat(32), RECOVERY = 'b2'.repeat(32);
function fixture({ appId = 'troubleshooter', url = '/troubleshoot/', source, recoveryToken = RECOVERY, focused = true } = {}) {
  const events = new Map(), replies = [], sent = [], opened = [];
  const location = new URL('https://box.example.test/wizard-os-home/');
  const entry = { id: appId, kind: 'wizard', url, ...(source !== undefined ? { source } : {}) };
  const catalog = [entry];
  const frame = { tagName: 'IFRAME', src: new URL(url, location).href, isConnected: true,
    matches: () => true, sandbox: { contains: () => false }, hasAttribute: () => false, closest: () => null,
    getClientRects: () => [{}], addEventListener() {}, removeEventListener() {},
    contentWindow: { postMessage: (data, target) => replies.push({ data, target }) } };
  const metas = { 'meta[name="wizard-shell-token"]': SHELL, 'meta[name="wizard-recovery-token"]': recoveryToken };
  const document = { hidden: false, readyState: 'loading', activeElement: focused ? frame : null, addEventListener() {},
    querySelector: sel => Object.hasOwn(metas, sel) && metas[sel] !== null ? { content: metas[sel], remove() {} } : null };
  const store = new Map();
  const ctx = { console, location, document, URL, URLSearchParams, Request, Headers, Blob, File, Response, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, setInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, navigator: {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    addEventListener(n, fn) { if (!events.has(n)) events.set(n, []); events.get(n).push(fn); },
    dispatchEvent() { return true; },
    // The browser's fetch, as the boundary's wrapper calls it: record exactly what goes on the wire.
    fetch: async request => {
      const r = request instanceof Request ? request : new Request(request);
      sent.push({ url: r.url, method: r.method, redirect: r.redirect, headers: Object.fromEntries(r.headers), body: r.method === 'POST' ? await r.clone().text() : null });
      const p = new URL(r.url).pathname;
      if (p === '/troubleshoot/api/status') return new Response(JSON.stringify({ overall: 'ok', checks: [] }), { status: 200 });
      if (p === '/troubleshoot/api/action') return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
      if (p === '/wizard/v1/provider-recovery') return new Response(JSON.stringify({ sent: true, secret: 'x' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    WizCore: { apps: () => ({ APPS: catalog }) }, WizConfig: { ready: Promise.resolve() },
    WizOpenApp: id => { opened.push(id); return true; } };
  ctx.window = ctx; ctx.parent = ctx;
  vm.runInNewContext(read('browser-boundary.js'), ctx);
  vm.runInNewContext(read('app-services.js'), ctx);
  ctx.WizAppServices.attach(frame, { appId, path: url, isVisible: () => true });
  const channel = () => replies.findLast(x => x.data.op === 'hello')?.data.channel;
  const emit = async (data, p = []) => { for (const fn of events.get('message') || []) await fn({ data, source: frame.contentWindow, origin: 'null', ports: p }); };
  let doc = null;
  const ready = async () => {
    const generation = channel(), c = new MessageChannel(); ports.add(c.port1); ports.add(c.port2);
    doc = { port: c.port1, connected: false, channel: generation };
    doc.port.onmessage = ({ data }) => { replies.push({ data, port: true }); if (data.op === 'challenge') doc.port.postMessage({ ...data, op: 'challenge.reply' }); if (data.op === 'connected') doc.connected = true; };
    doc.port.start();
    await emit({ type: 'wizard:boundary', version: 1, op: 'ready', portRole: 'document', channel: generation }, [c.port2]);
    await until(() => doc.connected);
  };
  let serial = 0;
  const recovery = async (op, args = {}) => {
    const id = 'wbs-' + ++serial;
    doc.port.postMessage({ type: 'wizard:boundary', version: 1, op: 'service.request', channel: doc.channel, id, method: 'recovery.call', args: { op, args } });
    const reply = () => replies.findLast(x => x.data.op === 'service.reply' && x.data.id === id)?.data;
    await until(() => reply()); await quiet(); return reply();
  };
  return { ctx, frame, document, ready, recovery, sent, opened, store };
}

test('fixed recovery operations go only to their own /troubleshoot/api/ path, with the recovery token and never the shell token', async () => {
  const f = fixture(); await f.ready();
  const st0 = await f.recovery('status', { fresh: true, accounts: false });
  assert.deepEqual(st0.value, { overall: 'ok', checks: [] });
  await f.recovery('repair.start', { id: null, message: 'Wizard is slow', engine: 'claude' });
  await f.recovery('repair.read', { id: 'ab'.repeat(8), since: 3 });
  await f.recovery('repair.approve', { id: 'ab'.repeat(8), approvalId: 'cd'.repeat(16), approved: true });
  await f.recovery('engine.set', { engine: 'chatgpt' });
  assert.deepEqual(f.sent.map(s => [s.method, new URL(s.url).pathname + new URL(s.url).search]), [
    ['GET', '/troubleshoot/api/status?fresh=1'], ['POST', '/troubleshoot/api/repair'], ['GET', '/troubleshoot/api/repair/abababababababab?since=3'],
    ['POST', '/troubleshoot/api/repair/approve'], ['POST', '/troubleshoot/api/engine']]);
  for (const s of f.sent) {
    assert.equal(s.headers['x-wizard-recovery-token'], RECOVERY);
    assert.equal(s.headers['x-wizard-shell-token'], undefined, 'the recovery listener never sees the shell token');
    assert.equal(s.redirect, 'error');
    assert.equal(new URL(s.url).origin, 'https://box.example.test');
    if (s.method === 'POST') assert.equal(s.headers['x-wizard-troubleshoot'], '1');
  }
  assert.deepEqual(JSON.parse(f.sent[1].body), { id: null, message: 'Wizard is slow', engine: 'claude' });
});

test('exact arguments, closed list, listener reasons come back as plain text', async () => {
  const f = fixture(); await f.ready();
  for (const [op, args] of [['status', { fresh: true }], ['status', { fresh: 1, accounts: false }], ['repair.read', { id: '../../x', since: 0 }], ['repairs', { limit: 99 }],
    ['engine.set', { engine: 'hermes' }], ['action', { action: 'rm -rf' }], ['repair.start', { id: null, message: '', engine: 'claude' }], ['repair.start', { id: null, message: 'x', engine: 'claude', url: '/x' }]]) {
    assert.equal((await f.recovery(op, args)).error.code, 'bad_request', op + JSON.stringify(args));
  }
  for (const op of ['fetch', 'internal/repair-tools', 'guardian-repair', '../wizard/v1/apps']) assert.equal((await f.recovery(op, {})).error.code, 'not_allowed', op);
  assert.equal(f.sent.length, 0, 'nothing refused reached the listener');
  const r = await f.recovery('action', { action: 'restart:agent-service' });
  assert.deepEqual([r.error.code, r.error.message], ['bad_request', 'Unknown action']);
});

test('Service-dependent read is one boolean; the engine cache is shape-checked shell storage; links open only known connection apps', async () => {
  const f = fixture(); await f.ready();
  assert.deepEqual((await f.recovery('provider_run', { runId: 'run_123' })).value, { sent: true });
  assert.equal(f.sent.at(-1).headers['x-wizard-shell-token'], SHELL, 'the Service read is an ordinary shell read');
  const value = { engines: [{ engine: 'claude', name: 'Claude', ok: true, modelLabel: 'Opus 5.5', reason: '' }], selected: 'claude' };
  assert.deepEqual((await f.recovery('cache.write', { value })).value, { saved: true });
  assert.deepEqual((await f.recovery('cache.read', {})).value, value);
  assert.equal((await f.recovery('cache.write', { value: { engines: [{ x: { nested: 1 } }], selected: 'claude' } })).error.code, 'bad_request');
  assert.deepEqual((await f.recovery('open_app', { appId: 'wizard-claude' })).value, { opened: true });
  assert.equal((await f.recovery('open_app', { appId: 'notifications' })).error.code, 'bad_request');
  assert.deepEqual(f.opened, ['wizard-claude']);
});

test('open_app needs the owner in the Troubleshooter window', async () => {
  const f = fixture({ focused: false }); await f.ready();
  assert.equal((await f.recovery('open_app', { appId: 'wizard-claude' })).error.code, 'denied');
  assert.deepEqual(f.opened, []);
});

test('no other window gets recovery operations: an installed app, another id or path', async () => {
  for (const opts of [{ appId: 'notifications', url: '/notifications/' }, { appId: 'troubleshooter', url: '/troubleshoot/', source: 'apps.json' }, { appId: 'troubleshooter', url: '/troubleshoot/other/' }]) {
    const f = fixture(opts); await f.ready();
    assert.equal((await f.recovery('status', { fresh: false, accounts: false })).error.code, 'not_allowed', JSON.stringify(opts));
    assert.equal(f.sent.length, 0);
  }
});

test('the shell document\'s own /troubleshoot/api/ reads carry the recovery token; ping and other paths do not', async () => {
  const f = fixture();
  await f.ctx.fetch('/troubleshoot/api/status?source=connection-banner');
  await f.ctx.fetch('/troubleshoot/api/ping');
  await f.ctx.fetch('/notifications/api/inbox');
  await f.ctx.fetch('https://other.example/troubleshoot/api/status');
  assert.deepEqual(f.sent.map(s => [new URL(s.url).pathname, s.headers['x-wizard-recovery-token'] || null, s.headers['x-wizard-shell-token'] || null]), [
    ['/troubleshoot/api/status', RECOVERY, null], ['/troubleshoot/api/ping', null, null], ['/notifications/api/inbox', null, null], ['/troubleshoot/api/status', null, null]]);
});

test('without a recovery token (Troubleshooter gate off) the operations still work, with no token header', async () => {
  const f = fixture({ recoveryToken: null }); await f.ready();
  assert.deepEqual((await f.recovery('status', { fresh: false, accounts: true })).value, { overall: 'ok', checks: [] });
  assert.equal(f.sent[0].headers['x-wizard-recovery-token'], undefined);
  const same = fixture({ recoveryToken: SHELL }); await same.ready();
  await same.recovery('status', { fresh: false, accounts: false });
  assert.equal(same.sent[0].headers['x-wizard-recovery-token'], undefined, 'a recovery token equal to the shell token is ignored');
});
