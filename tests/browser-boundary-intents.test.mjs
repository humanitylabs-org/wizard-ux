import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
// Shell intents (wizard-os spec/browser-trust-shell-intents): the frame may only QUEUE an owner confirmation or a
// reviewed sign-in page. Consent operations are never a data.call; argument shapes are exact; three reviews a minute
// per app; one open per view. The dialog itself (500 ms wake, trusted pointer/keyboard activation) is exercised in
// real Chromium by tools/qa-browser-ai-accounts.cjs. Real ports; DOM, catalog and the Agent Service are synthetic.
const ports = new Set();
test.afterEach(() => { for (const p of ports) p.close(); ports.clear(); });
const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'transport did not settle'); await new Promise(r => setTimeout(r, 1)); } };
const quiet = () => new Promise(r => setTimeout(r, 20));
const read = name => fs.readFileSync(new URL('../web/core/' + name, import.meta.url), 'utf8');
function fixture({ kind = 'wizard', visible = true } = {}) {
  const events = new Map(), replies = [], loads = new Map(), drafts = [], dispatched = [];
  const location = new URL('https://box.example.test/wizard-os-home/');
  const catalog = [{ id: 'wizard-chatgpt', kind, url: '/wizard-chatgpt/' }];
  const frame = { tagName: 'IFRAME', src: new URL('/wizard-chatgpt/', location).href, isConnected: true,
    matches: () => true, sandbox: { contains: () => false }, hasAttribute: () => false, closest: () => null,
    getClientRects: () => [{}], addEventListener(n, fn) { loads.set(n, fn); }, removeEventListener: n => loads.delete(n),
    contentWindow: { postMessage: (data, target) => replies.push({ data, target }) } };
  const document = { hidden: false, readyState: 'loading', activeElement: null, addEventListener() {}, querySelector: () => ({ content: 'a1'.repeat(32), remove() {} }) };
  const ctx = { location, document, URL, Request, Headers, Blob, File, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, setInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, navigator: {},
    addEventListener(n, fn) { if (!events.has(n)) events.set(n, []); events.get(n).push(fn); },
    dispatchEvent(e) { dispatched.push({ type: e.type, detail: e.detail }); for (const fn of events.get(e.type) || []) fn(e); return true; },
    fetch: async () => new Response('{}'), WizCore: { apps: () => ({ APPS: catalog }) }, WizConfig: { ready: Promise.resolve() } };
  ctx.window = ctx; ctx.parent = ctx;
  vm.runInNewContext(read('browser-boundary.js'), ctx);
  vm.runInNewContext(read('app-services.js'), ctx);
  ctx.WizAppServices.attach(frame, { appId: 'wizard-chatgpt', path: '/wizard-chatgpt/', isVisible: () => visible,
    openContextDraft: (key, item) => { drafts.push({ key, item }); return Object.freeze({ kind: 'unsent-draft', id: 'new:x', sent: false, secret: 'shell-only' }); } });
  const channel = () => replies.findLast(x => x.data.op === 'hello')?.data.channel;
  const emit = async (data, source = frame.contentWindow, origin = 'null', p = []) => { for (const fn of events.get('message') || []) await fn({ data, source, origin, ports: p }); };
  let doc = null;
  const ready = async () => {
    const generation = channel(), c = new MessageChannel(); ports.add(c.port1); ports.add(c.port2);
    doc = { port: c.port1, connected: false, channel: generation };
    doc.port.onmessage = ({ data }) => { replies.push({ data, port: true }); if (data.op === 'challenge') doc.port.postMessage({ ...data, op: 'challenge.reply' }); if (data.op === 'connected') doc.connected = true; };
    doc.port.start();
    await emit({ type: 'wizard:boundary', version: 1, op: 'ready', portRole: 'document', channel: generation }, frame.contentWindow, 'null', [c.port2]);
    await until(() => doc.connected);
  };
  let serial = 0;
  const request = async (method, args = {}, extra = {}) => {
    const id = 'wbs-' + ++serial;
    doc.port.postMessage({ type: 'wizard:boundary', version: 1, op: 'service.request', channel: doc.channel, id, method, args, ...extra });
    const reply = () => replies.findLast(x => x.data.op === 'service.reply' && x.data.id === id)?.data;
    await until(() => reply()); await quiet(); return reply();
  };
  return { ctx, frame, document, ready, request, drafts, dispatched };
}


const ok = (body, status = 200) => new Response(JSON.stringify(body), { status });
function stubService(f, calls, { queue = () => ok({ error: 'busy' }, 429) } = {}) {
  f.ctx.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push({ url: String(url), body: b });
    if (String(url).endsWith('/bindings')) return ok({ handle: 'h-1', principal: {} });
    if (String(url).endsWith('/intents')) return queue(b);
    if (String(url).endsWith('/intents/cancel')) return ok({ cancelled: true });
    return ok({ accounts: [] });
  };
}

test('consent operations are never a data.call, and confirmed:true is not an argument the shell forwards', async () => {
  const f = fixture(), calls = []; stubService(f, calls); await f.ready();
  for (const operation of ['ai_accounts.change', 'claude_code.connect', 'claude_code.logout']) {
    const r = await f.request('data.call', { operation, args: {}, operationKey: webcrypto.randomUUID() });
    assert.equal(r.error.code, 'not_allowed', operation);
  }
  assert.equal(calls.filter(c => c.url.endsWith('/call')).length, 0, 'refused in the shell before the Service');
  assert.equal((await f.request('data.call', { operation: 'ai_accounts.inventory', args: {} })).value.accounts.length, 0);
  assert.equal((await f.request('intent.confirm', { operation: 'ai_accounts.change', args: { action: 'remove', target: 'c1' }, operationKey: 'k', confirmed: true })).error.code, 'bad_request');
  assert.equal((await f.request('intent.confirm', { operation: 'ai_accounts.inventory', args: {}, operationKey: 'k' })).error.code, 'bad_request');
  assert.equal((await f.request('intent.open', { url: 'https://evil.example/' })).error.code, 'bad_request', 'no URL from the app');
  assert.equal((await f.request('intent.open', { target: 'signin', ref: 'ai:x', url: 'https://evil.example/' })).error.code, 'bad_request');
  assert.equal(calls.filter(c => c.url.endsWith('/intents')).length, 0);
});

test('the shell forwards exactly the reviewed fields, never a URL, and keeps three reviews a minute per app', async () => {
  const f = fixture(), calls = []; stubService(f, calls); await f.ready();
  const r1 = await f.request('intent.confirm', { operation: 'ai_accounts.change', args: { action: 'add', target: null }, operationKey: 'k1' });
  assert.equal(r1.error.code, 'busy');   // the stub Service refused; nothing queued in the shell
  const r2 = await f.request('intent.open', { target: 'signin', ref: 'ai:' + 'j'.repeat(24) });
  assert.equal(r2.error.code, 'busy');
  const sent = calls.filter(c => c.url.endsWith('/intents')).map(c => c.body);
  assert.deepEqual(sent.map(b => Object.keys(b).sort().join()), ['args,generation,handle,kind,operation,operationKey,requestId', 'generation,handle,kind,ref,requestId,target']);
  assert.deepEqual([sent[0].kind, sent[0].operation, sent[0].args], ['confirm', 'ai_accounts.change', { action: 'add', target: null }]);
  assert.deepEqual([sent[1].kind, sent[1].target, sent[1].ref], ['navigate', 'signin', 'ai:' + 'j'.repeat(24)]);
  const r3 = await f.request('intent.confirm', { operation: 'claude_code.logout', args: {}, operationKey: 'k3' });
  assert.equal(r3.error.code, 'busy');
  const r4 = await f.request('intent.confirm', { operation: 'claude_code.logout', args: {}, operationKey: 'k4' });
  assert.equal(r4.error.code, 'rate_limited', 'fourth review in a minute');
  assert.equal(calls.filter(c => c.url.endsWith('/intents')).length, 3);
});

test('the opaque client exposes intent.confirm / intent.open with a long timeout; WizardApp.intent maps to them', () => {
  const client = read('browser-boundary-client.js'), app = read('app-client.js');
  assert.match(client, /'intent\.confirm', 'intent\.open'(, 'recovery\.call')?(, 'store\.call')?(, '(upload|download)\.[a-z]+')*\]\.includes\(method\)/);
  assert.match(app, /intent: Object\.freeze\(\{ confirm: requestData => window\.WizBoundaryClient \? request\('intent\.confirm', requestData, 600000\)/);
  const boundary = read('browser-boundary.js');
  assert.match(boundary, /INTENT_DELAY_MS = 500, INTENT_PER_MINUTE = 3/);
  assert.match(boundary, /chip\.addEventListener\('click', e => \{ if \(e\.isTrusted\) open\(\); \}\)/, 'only a trusted click on the shell chip opens the review');
});
