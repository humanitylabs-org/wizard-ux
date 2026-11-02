import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
// Card 2 (wizard-os #385): the REAL Notifications screens over the opaque boundary. Typed inbox/mark operations,
// a shell-read badge after proven writes, and the unsent reply draft as a bounded shell service.
// Real ports; DOM, catalog and the Agent Service are synthetic.
const ports = new Set();
test.afterEach(() => { for (const p of ports) p.close(); ports.clear(); });
const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'transport did not settle'); await new Promise(r => setTimeout(r, 1)); } };
const quiet = () => new Promise(r => setTimeout(r, 20));
const read = name => fs.readFileSync(new URL('../web/core/' + name, import.meta.url), 'utf8');
function fixture({ kind = 'wizard', visible = true } = {}) {
  const events = new Map(), replies = [], loads = new Map(), drafts = [], dispatched = [];
  const location = new URL('https://box.example.test/wizard-os-home/');
  const catalog = [{ id: 'notifications', kind, url: '/notifications/' }];
  const frame = { tagName: 'IFRAME', src: new URL('/notifications/', location).href, isConnected: true,
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
  ctx.WizAppServices.attach(frame, { appId: 'notifications', path: '/notifications/', isVisible: () => visible,
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

test('typed inbox and mark reach the Service with exact bodies; only a proven write tells the shell to re-read the badge', async () => {
  const f = fixture(), calls = [];
  let next = () => ({ status: 200, body: { view: 'inbox', counts: { unread: 1, needs: 0, flagged: 0 }, items: [] } });
  f.ctx.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.endsWith('/bindings')) return new Response(JSON.stringify({ handle: 'h-1', principal: {} }), { status: 200 });
    const r = next(body); return new Response(JSON.stringify(r.body), { status: r.status });
  };
  await f.ready();
  const key = webcrypto.randomUUID();
  assert.equal((await f.request('data.call', { operation: 'notifications.inbox', args: { view: 'inbox', limit: 500 } })).value.counts.unread, 1);
  assert.equal(f.dispatched.length, 0, 'a read never signals a write');
  const args = { items: [{ id: 'n1', expectedRevision: 'r-0000000000000000' }], marks: { read: true } };
  next = () => ({ status: 409, body: { error: 'conflict' } });
  assert.equal((await f.request('data.call', { operation: 'notifications.mark', args, operationKey: key })).error.code, 'conflict');
  assert.equal(f.dispatched.length, 0, 'a refused write never signals');
  next = () => ({ status: 200, body: { items: [{ id: 'n1', revision: 'r-1111111111111111' }], marks: { read: true }, operationKey: key } });
  assert.equal((await f.request('data.call', { operation: 'notifications.mark', args, operationKey: key })).value.operationKey, key);
  assert.deepEqual(JSON.parse(JSON.stringify(f.dispatched)), [{ type: 'wizard:browser-data-written', detail: { appId: 'notifications', operation: 'notifications.mark' } }]);
  next = () => ({ status: 200, body: { status: 'succeeded', operationKey: key } });
  assert.equal((await f.request('data.status', { operation: 'notifications.mark', operationKey: key })).value.status, 'succeeded');
  const sent = calls.filter(c => c.url.endsWith('/call')).map(c => c.body);
  assert.deepEqual(sent.map(b => [b.operation, Object.keys(b).sort().join()]), [
    ['notifications.inbox', 'args,generation,handle,operation,requestId'],
    ['notifications.mark', 'args,generation,handle,operation,operationKey,requestId'],
    ['notifications.mark', 'args,generation,handle,operation,operationKey,requestId'],
    ['data.status', 'args,generation,handle,operation,requestId'],
  ]);
  assert.deepEqual(sent[1].args, args);
  const before = calls.length;
  for (const [method, a, code] of [
    ['data.call', { operation: 'notifications.mark', args }, 'bad_request'],                                            // write without key
    ['data.call', { operation: 'notifications.inbox', args: { view: 'all', limit: 5 }, operationKey: key }, 'bad_request'], // key on a read
    ['data.call', { operation: 'notifications.inbox', args: { view: 'all', limit: 5 }, appId: 'profiles' }, 'bad_request'],
    ['data.call', { operation: 'notifications.delete', args: {} }, 'not_allowed'],
    ['data.status', { operation: 'notifications.inbox', operationKey: key }, 'bad_request'],
  ]) assert.equal((await f.request(method, a)).error.code, code, JSON.stringify(a));
  assert.equal(calls.length, before, 'refused in the shell before any server call');
});

test('reply draft: only while the frame holds focus, exact keys, bounded rate; returns only the documented receipt', async () => {
  const f = fixture();
  await f.ready();
  const item = { id: 'SynthAAAA0001', title: 'Synthetic', message: 'Synthetic body' };
  assert.equal((await f.request('nav.contextDraft', item)).error.code, 'denied');                 // owner never touched the frame
  assert.equal(f.drafts.length, 0);
  f.document.activeElement = f.frame;
  assert.equal((await f.request('nav.contextDraft', { ...item, id: '../x' })).error.code, 'failed');   // id grammar
  assert.equal(f.drafts.length, 0);
  const ok = await f.request('nav.contextDraft', item);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.value)), { kind: 'unsent-draft', sent: false });                                // no shell-only fields cross back
  assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [{ key: 'notifications:SynthAAAA0001', item: { title: 'Synthetic', message: 'Synthetic body' } }]);
  assert.equal((await f.request('nav.contextDraft', item)).error.code, 'rate_limited');             // second within 1.5 s
  assert.equal((await f.request('nav.contextDraft', { ...item, send: true })).error.code, 'invalid_request');
  f.document.hidden = true;
  assert.equal((await f.request('nav.contextDraft', item)).error.code, 'denied');
  assert.equal(f.drafts.length, 1);
});

test('reply draft is refused for a hidden window or an app that is not an installed Wizard app', async () => {
  for (const opts of [{ visible: false }, { kind: 'service' }]) {
    const f = fixture(opts); await f.ready(); f.document.activeElement = f.frame;
    assert.equal((await f.request('nav.contextDraft', { id: 'a', title: 't', message: 'm' })).error.code, 'failed', JSON.stringify(opts));
    assert.equal(f.drafts.length, 0);
  }
});

test('opaque client: nav.contextDraft is an allowed request; WizardApp.nav.openContextDraft routes through it', () => {
  assert.match(read('browser-boundary-client.js'), /'nav\.contextDraft'/);
  const src = read('app-client.js');
  assert.match(src, /if \(!service && window\.WizBoundaryClient\?\.ready\) return request\('nav\.contextDraft', data\);/);
});

test('watchers give an opaque frame only the reply draft and its visibility check, never openThread or Back callbacks', () => {
  for (const [file, name] of [['../app.js', 'watchFrames'], ['../desktop/desktop.js', 'watchFrame']]) {
    const src = read(file), start = src.indexOf('  function ' + name + '('), body = src.slice(start, src.indexOf('\n  function ', start + 10));
    const boundary = body.slice(body.indexOf('if (window.WizBrowserBoundary?.enabled)'), body.indexOf('if (opts) f._appDetach'));
    assert.match(boundary, /WizAppServices\.attach\(f, \{ appId: opts\.appId, path: opts\.path, openContextDraft: opts\.openContextDraft, isVisible: opts\.isVisible \}\)/, file);
    assert.doesNotMatch(boundary.replace(/\/\/.*$/gm, ''), /openThread|back:|openHosted|backStep/, file);
  }
});

test('badge: the shell re-reads its own count after a proven Notifications write; frames cannot post one', () => {
  const src = read('notif-bell.js');
  assert.match(src, /addEventListener\('wizard:browser-data-written', e => \{ if \(e\.detail\?\.appId === 'notifications'\) refresh\(true\); \}\);/);
  assert.match(src, /if \(e\.origin !== location\.origin \|\| !d \|\| d\.type !== 'wizard:notifications:count'\) return;/);   // opaque origin "null" never matches
});

test('media.open: exact args, the app\'s one reviewed media operation, and only a content-origin ticket goes back', async () => {
  const f = fixture(), calls = [];
  const ticket = { kind: 'ticket', url: 'http://127.0.0.1:9911/t/' + 'A'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), mime: 'image/png', bytes: 1234, methods: ['GET', 'HEAD'], range: true };
  let next = () => ticket;
  f.ctx.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.endsWith('/bindings')) return new Response(JSON.stringify({ handle: 'h-1', principal: {} }), { status: 200 });
    return new Response(JSON.stringify(next()), { status: 200 });
  };
  await f.ready();
  const ok = await f.request('media.open', { resourceId: 'n:SynthBBBB0001:1', purpose: 'thumbnail' });
  assert.deepEqual(JSON.parse(JSON.stringify(ok.value)), ticket);
  const call = calls.find(c => c.url.endsWith('/call'));
  assert.deepEqual(Object.keys(call.body).sort(), ['args', 'generation', 'handle', 'operation', 'requestId']);
  assert.equal(call.body.operation, 'notifications.media');
  assert.deepEqual(call.body.args, { resourceId: 'n:SynthBBBB0001:1', purpose: 'thumbnail' });
  // Frames cannot pick the operation, add fields or ask for another purpose.
  for (const args of [{ resourceId: 'n:x:1' }, { resourceId: 'n:x:1', purpose: 'download' }, { resourceId: 'n:x:1', purpose: 'read', operation: 'files.read' }, { resourceId: 7, purpose: 'read' }])
    assert.equal((await f.request('media.open', args)).error.code, 'bad_request', JSON.stringify(args));
  // A ticket pointing at the owner origin, carrying a query, a non-image type or extra fields never reaches the frame.
  for (const bad of [{ ...ticket, url: 'https://box.example.test/t/' + 'A'.repeat(43) }, { ...ticket, url: ticket.url + '?x=1' },
    { ...ticket, url: 'http://127.0.0.1:9911/notifications/media/x.png' }, { ...ticket, mime: 'text/html' }, { ...ticket, extra: 1 }, { ...ticket, url: 'javascript:alert(1)' }]) {
    next = () => bad;
    assert.equal((await f.request('media.open', { resourceId: 'n:x:1', purpose: 'read' })).error.code, 'backend_failed', JSON.stringify(bad));
  }
});

test('opaque client: media.open is an allowed request and WizardApp.media.open routes through it', () => {
  assert.match(read('browser-boundary-client.js'), /'media\.open'/);
  const src = read('app-client.js');
  assert.match(src, /open: requestData => window\.WizBoundaryClient \? request\('media\.open', requestData\)/);
  assert.equal(src.match(/\n    media: Object\.freeze\(/g).length, 1, 'one WizardApp.media (view + open), never a second key that hides view');
});
