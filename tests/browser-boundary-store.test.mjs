import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
// App Store panel under the browser boundary (wizard-os 389 O1). The built-in App Store renders untrusted index text
// in an opaque window, so its own owner reads (store-data, store-install) are refused from Origin:null by design. The
// shell answers a fixed set of typed Store operations for ONLY that built-in window: each maps to one fixed path,
// owner changes need the owner's confirmation in shell UI first, and nothing is a relay. Real Chromium on the rig:
// wizard-os 389 addendum.
const ports = new Set();
test.afterEach(() => { for (const p of ports) p.close(); ports.clear(); });
const until = async (predicate, ms = 5000) => { const end = Date.now() + ms; while (!predicate()) { assert.ok(Date.now() < end, 'transport did not settle'); await new Promise(r => setTimeout(r, 1)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = name => fs.readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
const SHELL = 'a1'.repeat(32);
const SHA = 'c'.repeat(40);

function fixture({ appId = 'app-store', url = '/wizard-os-home/store/index.html', source } = {}) {
  const events = new Map(), replies = [], sent = [], created = [];
  const location = new URL('https://box.example.test/wizard-os-home/');
  const entry = { id: appId, kind: 'wizard', url, ...(source !== undefined ? { source } : {}) };
  const frame = { tagName: 'IFRAME', src: new URL(url, location).href, isConnected: true,
    matches: () => true, sandbox: { contains: () => false }, hasAttribute: () => false, closest: () => null,
    getClientRects: () => [{}], addEventListener() {}, removeEventListener() {},
    contentWindow: { postMessage: (data, target) => replies.push({ data, target }) } };
  const el = tag => {
    const n = { tag, children: [], listeners: {}, attrs: {}, style: {}, isConnected: true, offsetHeight: 20, offsetWidth: 80, hidden: false,
      classList: { add() {}, remove() {}, contains: () => false },
      append(...c) { this.children.push(...c); }, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getBoundingClientRect: () => ({ width: 0, height: 0 }),
      showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.isConnected = false; }, focus() {},
      contains(x) { return x === this || this.children.some(c => c === x || c.contains?.(x)); },
      fire(type, init = {}) { for (const fn of this.listeners[type] || []) fn({ isTrusted: true, isPrimary: true, detail: 1, target: this, preventDefault() {}, ...init }); } };
    created.push(n); return n;
  };
  const document = { hidden: false, readyState: 'loading', activeElement: frame, addEventListener() {},
    querySelector: sel => sel === 'meta[name="wizard-shell-token"]' ? { content: SHELL, remove() {} } : null,
    getElementById: () => null, createElement: el, head: el('head'), body: el('body') };
  const ctx = { console, location, document, URL, URLSearchParams, Request, Headers, Blob, File, Response, crypto: webcrypto, TextEncoder,
    // Unref'd: a review left open at the end of a test must not keep the runner alive.
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimeout,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; }, clearInterval, performance, requestAnimationFrame() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, navigator: {},
    addEventListener(n, fn) { if (!events.has(n)) events.set(n, []); events.get(n).push(fn); },
    dispatchEvent() { return true; },
    fetch: async request => {
      const r = request instanceof Request ? request : new Request(request);
      sent.push({ url: r.url, method: r.method, headers: Object.fromEntries(r.headers), body: r.method === 'POST' ? await r.clone().text() : null });
      const p = new URL(r.url).pathname;
      if (p.endsWith('/index/search')) return new Response(JSON.stringify({ apps: [{ id: 'wizard-files' }], next_offset: null }), { status: 200 });
      if (p.includes('/store-install/')) return new Response(JSON.stringify({ state: 'installing' }), { status: 202 });
      if (p.includes('/router/v1/needs/')) return new Response(JSON.stringify({ error: 'unknown' }), { status: 403 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    WizCore: { apps: () => ({ APPS: [entry] }) }, WizConfig: { ready: Promise.resolve() } };
  ctx.window = ctx; ctx.parent = ctx;
  vm.runInNewContext(read('core/browser-boundary.js'), ctx);
  vm.runInNewContext(read('core/app-services.js'), ctx);
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
  const ask = (op, args = {}) => {
    const id = 'wbs-' + ++serial;
    doc.port.postMessage({ type: 'wizard:boundary', version: 1, op: 'service.request', channel: doc.channel, id, method: 'store.call', args: { op, args } });
    return () => replies.findLast(x => x.data.op === 'service.reply' && x.data.id === id)?.data;
  };
  const store = async (op, args) => { const reply = ask(op, args); await until(() => reply()); return reply(); };
  const chip = () => created.find(n => n.tag === 'button' && n.className === 'wz-intent-chip' && n.isConnected);
  const dialog = () => created.find(n => n.tag === 'dialog' && n.isConnected);
  return { ready, store, ask, sent, chip, dialog };
}
const wire = f => f.sent.map(s => [s.method, new URL(s.url).pathname + new URL(s.url).search]);

test('Store reads go to their one fixed owner path from the shell, with the shell token, and come back as status + value', async () => {
  const f = fixture(); await f.ready();
  const cat = await f.store('catalog', { offset: 100, refresh: true });
  assert.deepEqual(cat.value, { status: 200, value: { apps: [{ id: 'wizard-files' }], next_offset: null } });
  await f.store('installed.runtipi', {});
  await f.store('installed.wizard', {});
  await f.store('link', { repo: 'humanitylabs-org/wizard-files', commit: SHA });
  const needs = await f.store('router.needs', { app: 'wizard-files' });
  assert.equal(needs.value.status, 403);   // the Store keeps its own handling of each status
  await f.store('install.status', { id: 'wizard-files' });
  await f.store('remove.plan', { id: 'wizard-files' });
  await f.store('app.agents', { id: 'wizard-files' });
  assert.deepEqual(wire(f), [
    ['GET', '/wizard-os-home/store-data/wizard/v1/index/search?limit=100&offset=100&refresh=1'],
    ['GET', '/wizard-os-home/store-data/api/apps/installed'],
    ['GET', '/wizard-os-home/store-data/wizard/v1/installed-apps'],
    ['GET', '/wizard-os-home/store-data/wizard/v1/link?repo=humanitylabs-org%2Fwizard-files&commit=' + SHA],
    ['GET', '/wizard-os-home/store-data/router/v1/needs/wizard-files'],
    ['GET', '/wizard-os-home/store-install/wizard-files'],
    ['GET', '/wizard-os-home/store-install/_remove/wizard-files/plan'],
    ['GET', '/wizard/v1/apps/wizard-files/agents'],
  ]);
  // store-install and /wizard/ are owner paths: the shell's own fetch adds the shell token (never visible to the frame).
  assert.equal(f.sent[5].headers['x-wizard-shell-token'], SHELL);
  assert.equal(f.sent[7].headers['x-wizard-shell-token'], SHELL);
});

test('not a relay: unknown operations, extra or malformed arguments and path tricks are refused before any request', async () => {
  const f = fixture(); await f.ready();
  const bad = [
    ['fetch', { url: '/wizard/v1/anything' }, 'not_allowed'],
    ['catalog', { offset: 0 }, 'bad_request'],
    ['catalog', { offset: -1, refresh: false }, 'bad_request'],
    ['catalog', { offset: 0, refresh: false, limit: 5 }, 'bad_request'],
    ['router.needs', { app: '../api/apps' }, 'bad_request'],
    ['install.status', { id: 'Files' }, 'bad_request'],
    ['link', { repo: 'a/b?x=1', commit: null }, 'bad_request'],
    ['install', { id: 'x', source: 'standard', repo: 'a/b', commit: 'HEAD', operation: 'install' }, 'bad_request'],
    ['remove', { id: 'x', repo: 'a/b', commit: SHA, dependents: ['../y'], empties: [] }, 'bad_request'],
    ['constructor', {}, 'not_allowed'],
  ];
  for (const [op, args, code] of bad) assert.equal((await f.store(op, args)).error.code, code, op);
  assert.deepEqual(f.sent, []);
});

test('only the built-in App Store window: an installed app (even with its id) or another path gets nothing', async () => {
  for (const opts of [{ source: 'standard:someone/app-store' }, { url: '/wizard-os-home/store/other.html' }, { appId: 'notifications', url: '/notifications/' }]) {
    const f = fixture(opts); await f.ready();
    assert.equal((await f.store('installed.wizard', {})).error.code, 'not_allowed');
    assert.deepEqual(f.sent, []);
  }
});

test('an install needs the owner in shell UI first: nothing is sent until a trusted activation after the wake delay', async () => {
  const f = fixture(); await f.ready();
  const reply = f.ask('install', { id: 'wizard-files', source: 'private-test', repo: 'humanitylabs-org/wizard-files', commit: SHA, operation: 'install' });
  await until(() => f.chip());
  await sleep(30);
  assert.deepEqual(f.sent, []);                          // the frame asked; the shell only shows its Review chip
  f.chip().fire('click', { isTrusted: false });          // a synthetic click is never consent
  assert.equal(f.dialog(), undefined);
  f.chip().fire('click');
  const dlg = f.dialog(); assert.ok(dlg?.open);
  const text = JSON.stringify(dlg.children.map(c => c.textContent));
  assert.match(text, /Install wizard-files\?/); assert.match(text, /github.com\/humanitylabs-org\/wizard-files at cccccccccccc/);
  const [go] = dlg.children.find(c => c.className === 'wzi-acts').children.filter(c => /wzi-go/.test(c.className));
  go.fire('pointerdown'); go.fire('pointerup');          // too early: before the wake delay
  await sleep(30); assert.deepEqual(f.sent, []);
  await sleep(550);
  go.fire('pointerdown'); go.fire('pointerup');
  await until(() => reply());
  assert.deepEqual(reply().value, { status: 202, value: { state: 'installing' } });
  assert.deepEqual(wire(f), [['POST', '/wizard-os-home/store-install/wizard-files']]);
  assert.deepEqual(JSON.parse(f.sent[0].body), { source: 'private-test', repo: 'humanitylabs-org/wizard-files', commit: SHA, operation: 'install' });
  assert.equal(f.sent[0].headers['x-wizard-store'], '1');
});

test('cancelling the review sends nothing; removals and model approvals need the same confirmation', async () => {
  const f = fixture(); await f.ready();
  const reply = f.ask('remove', { id: 'wizard-files', repo: 'humanitylabs-org/wizard-files', commit: SHA, dependents: [], empties: [] });
  await until(() => f.chip()); f.chip().fire('click');
  const cancel = f.dialog().children.find(c => c.className === 'wzi-acts').children.find(c => c.className === 'wzi-no');
  cancel.fire('click');
  await until(() => reply());
  assert.equal(reply().error.code, 'cancelled');
  const approve = f.ask('router.approve', { app: 'reader', feature: 'ask', provider: 'wizard-claude', model: 'claude-sonnet' });
  await until(() => f.chip());
  assert.match(f.chip().textContent, /Let reader use claude-sonnet\?/);
  await sleep(20);
  assert.equal(approve(), undefined);
  assert.deepEqual(f.sent, []);
});

test('the Store page loads the boundary client and the bridge before its own scripts', () => {
  const html = read('store/index.html');
  const at = s => html.indexOf(s);
  assert.ok(at('../core/browser-boundary-client.js') > 0 && at('../core/browser-boundary-client.js') < at('store-bridge.js'));
  assert.ok(at('store-bridge.js') < at('../core/app-setup.js') && at('store-bridge.js') < at('store.js"'));
});
