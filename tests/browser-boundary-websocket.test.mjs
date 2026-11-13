// wizard-os#133 slice 38: a sandboxed app's WebSocket to its own backend goes through the shell (ws.open, ws.send,
// ws.close) via the app kit's stand-in (core/app-client.js). Real Chromium proof (opaque frame, the real shell
// services, a real WebSocket server that checks the Origin): tests/qa-browser-boundary-websocket.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CLIENT = fs.readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
const START = CLIENT.indexOf('    /* WebSocket to this host goes through the shell too');
const END = CLIENT.indexOf("Object.defineProperty(window, 'WebSocket'", START);
const BLOCK = CLIENT.slice(START, CLIENT.indexOf('\n    }\n', END) + '\n    }\n'.length);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
class CloseEvent extends Event { constructor(t, o = {}) { super(t); this.code = o.code; this.reason = o.reason; this.wasClean = o.wasClean; } }

// The WebSocket block on its own: `channel()` gives a fake boundary client that records requests, and `hear(d)` plays
// a `ws` notice from the shell (as netNotice does).
function load({ noChannel = false, answer } = {}) {
  const requests = [], sockets = new Map(), natives = [];
  const NativeWS = class NativeWS { constructor(url, protocols) { this.native = url; this.protocols = protocols; this.l = {}; natives.push(this); } addEventListener(t, fn) { this.l[t] = fn; } };
  const client = { request(method, args) { const r = { method, args }; requests.push(r); return new Promise((resolve, reject) => { r.resolve = resolve; r.reject = reject; if (answer) answer(r); }); } };
  const g = { location: { href: 'https://box.example.com/notes/', origin: 'https://box.example.com', host: 'box.example.com', protocol: 'https:' },
    channel: async () => (noChannel ? null : client), sockets, WebSocket: NativeWS, EventTarget, Event, MessageEvent, CloseEvent, DOMException, Blob,
    URL, TextEncoder, Promise, Object, ArrayBuffer, Uint8Array, Math, Date, Number, String, Array, Set, TypeError };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(`(() => {\n${BLOCK}\n})();`, g);
  const hear = d => { if (d.event === 'reset') { for (const w of [...sockets.values()]) w(d); return; } sockets.get(d.key)?.({ ws: true, ...d }); };
  return { g, requests, hear, natives, NativeWS };
}
const clone = v => JSON.parse(JSON.stringify(v));

test('WebSocket stand-in: opens through the shell, messages both ways in order, the server\'s close', async () => {
  const { g, requests, hear, NativeWS } = load();
  assert.notEqual(g.WebSocket, NativeWS, 'the page gets the stand-in');
  assert.equal(g.WebSocket.CLOSING, 2); assert.equal(new g.WebSocket('live').CLOSED, 3);
  const ws = new g.WebSocket('wss://box.example.com/notes/live', ['live.v1']), log = [];
  ws.onopen = () => log.push('open:' + ws.protocol);
  ws.onmessage = e => log.push(['message', e.data, e.origin]);
  ws.onclose = e => log.push(['close', e.code, e.reason, e.wasClean]);
  ws.onerror = () => log.push('error');
  assert.equal(ws.readyState, 0); assert.equal(ws.url, 'wss://box.example.com/notes/live'); assert.equal(ws.binaryType, 'blob');
  assert.throws(() => ws.send('x'), err => err.name === 'InvalidStateError');
  await tick();
  const open = requests.filter(r => r.method === 'ws.open').at(-1);
  assert.deepEqual(clone(open.args.protocols), ['live.v1']);
  // A message that arrives before the open answer waits for it.
  hear({ key: open.args.key, event: 'message', data: 'early' });
  open.resolve({ ws: { protocol: 'live.v1', extensions: '' } }); await tick();
  assert.equal(ws.readyState, 1);
  assert.deepEqual(clone(log), ['open:live.v1', ['message', 'early', 'wss://box.example.com']]);
  ws.send('a'); ws.send(new Uint8Array([9, 8, 7]).subarray(1)); ws.send(new Blob([new Uint8Array([5])])); ws.send('b');
  assert.ok(ws.bufferedAmount >= 4);
  await tick(10);
  const sends = requests.filter(r => r.method === 'ws.send');
  assert.deepEqual(sends.map(r => (typeof r.args.data === 'string' ? r.args.data : [...new Uint8Array(r.args.data)])), ['a', [8, 7], [5], 'b'], 'in the page\'s order, a Blob in its place');
  for (const r of sends) r.resolve(true);
  await tick(5);
  assert.equal(ws.bufferedAmount, 0);
  ws.binaryType = 'arraybuffer'; ws.binaryType = 'nonsense'; assert.equal(ws.binaryType, 'arraybuffer');
  hear({ key: open.args.key, event: 'message', data: new Uint8Array([3]).buffer });
  assert.deepEqual([...new Uint8Array(log.at(-1)[1])], [3]);
  hear({ key: open.args.key, event: 'close', code: 4001, reason: 'see you', wasClean: true });
  assert.deepEqual(clone(log.at(-1)), ['close', 4001, 'see you', true]);
  assert.ok(!log.includes('error'), 'a clean close has no error');
  assert.equal(ws.readyState, 3);
  ws.send('ignored'); await tick();
  assert.equal(requests.filter(r => r.method === 'ws.send').length, 4, 'nothing is sent once closed');
});

test('WebSocket stand-in: close(code, reason) goes to the shell; bad codes throw; close while connecting fails it', async () => {
  const { g, requests, hear } = load();
  const ws = new g.WebSocket('live'); await tick();
  const open = requests[0]; open.resolve({ ws: {} }); await tick();
  assert.throws(() => ws.close(1001), err => err.name === 'InvalidAccessError');
  assert.throws(() => ws.close(1000, 'x'.repeat(124)), err => err.name === 'SyntaxError');
  ws.close(4321, 'done');
  assert.equal(ws.readyState, 2);
  assert.deepEqual(clone(requests.at(-1)), { method: 'ws.close', args: { key: open.args.key, code: 4321, reason: 'done' } });
  const log = []; ws.onclose = e => log.push([e.code, e.wasClean]);
  hear({ key: open.args.key, event: 'close', code: 4321, reason: 'done', wasClean: true });
  assert.deepEqual(log, [[4321, true]]);
  // Closing while connecting: error, then close 1006, once the shell refuses the open.
  const early = new g.WebSocket('live'); const elog = [];
  early.onerror = () => elog.push('error'); early.onclose = e => elog.push(e.code);
  await tick();
  const eopen = requests.at(-1); early.close();
  assert.equal(requests.at(-1).method, 'ws.close');
  eopen.reject(Object.assign(new Error('Connection failed'), { code: 'refused' })); await tick();
  assert.deepEqual(elog, ['error', 1006]);
});

test('WebSocket stand-in: another site, `outside` or no shell channel get the browser\'s own WebSocket; a new channel ends every socket', async () => {
  const { g, requests, hear, natives, NativeWS } = load();
  const other = new g.WebSocket('wss://elsewhere.example/x');
  assert.ok(other instanceof NativeWS, 'another site: the browser\'s own, at once');
  assert.throws(() => new g.WebSocket('ftp://box.example.com/x'), err => err.name === 'SyntaxError');
  assert.throws(() => new g.WebSocket('live', ['a', 'a']), err => err.name === 'SyntaxError');
  const away = new g.WebSocket('/other-app/live'); await tick();
  requests.at(-1).reject(Object.assign(new Error('Outside this app'), { code: 'outside' })); await tick();
  assert.equal(natives.at(-1).native, 'wss://box.example.com/other-app/live', 'outside: the browser\'s own, with the full address');
  natives.at(-1).readyState = 1; assert.equal(away.readyState, 1, 'its state is the native socket\'s');
  const ws = new g.WebSocket('live'), log = []; ws.onerror = () => log.push('error'); ws.onclose = e => log.push(e.code);
  await tick(); requests.at(-1).resolve({ ws: {} }); await tick();
  hear({ event: 'reset' });
  assert.deepEqual(log, ['error', 1006]);
  const none = load({ noChannel: true }); const s = new none.g.WebSocket('live'); await tick();
  assert.equal(none.natives.length, 1, 'no shell channel: the browser\'s own'); assert.equal(s.url, 'wss://box.example.com/notes/live');
});

test('WebSocket stand-in: at most 8 sends on the way at once; the rest wait their turn', async () => {
  const { g, requests } = load();
  const ws = new g.WebSocket('live'); await tick(); requests[0].resolve({ ws: {} }); await tick();
  for (let i = 0; i < 12; i++) ws.send('m' + i);
  await tick(5);
  let sends = requests.filter(r => r.method === 'ws.send');
  assert.equal(sends.length, 8);
  for (const r of sends) r.resolve(true);
  await tick(5);
  sends = requests.filter(r => r.method === 'ws.send');
  assert.deepEqual(sends.map(r => r.args.data), Array.from({ length: 12 }, (_, i) => 'm' + i));
});
