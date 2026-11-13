// wizard-os#133 slice 37: a sandboxed app's EventSource reads its own backend's event stream through the app kit's
// fetch stand-in (core/app-client.js), which streams the answer from the shell's net.fetch. Real Chromium proof (opaque
// frame, the real shell services, a live server-sent event stream): tests/qa-browser-boundary-stream.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CLIENT = fs.readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
const START = CLIENT.indexOf('    /* EventSource (server-sent events) to this host goes the same way');
const END = CLIENT.indexOf('    /* XMLHttpRequest goes the same way', START);
const BLOCK = CLIENT.slice(START, END);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// The EventSource block on its own, with `window.fetch` standing in for the app kit's fetch stand-in.
function load(fetch) {
  const native = class NativeES { constructor(url) { this.native = url; } };
  const g = { location: { href: 'https://box.example.com/notes/', origin: 'https://box.example.com' }, fetch, EventSource: native, EventTarget, Event, MessageEvent, DOMException,
    URL, TextDecoder, AbortController, setTimeout, clearTimeout, Promise, Object, JSON, Number, String };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(`(() => {\n${BLOCK}\n})();`, g);
  return { g, native };
}
// A server-sent event stream the test writes to piece by piece.
function sse(status = 200, type = 'text/event-stream') {
  let ctrl; const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { ctrl = c; } });
  return { res: new Response(body, { status, headers: { 'content-type': type } }), write: t => ctrl.enqueue(enc.encode(t)), end: () => ctrl.close(), fail: () => ctrl.error(new TypeError('network error')) };
}

test('EventSource stand-in: events arrive live, with names, multi-line data, ids and comments', async () => {
  const calls = [], s = sse();
  const { g, native } = load(async (url, init) => { calls.push({ url, init }); return s.res; });
  assert.notEqual(g.EventSource, native, 'the page gets the stand-in');
  assert.equal(g.EventSource.CLOSED, 2);
  const es = new g.EventSource('api/events'), got = [], states = [];
  es.onopen = () => states.push('open:' + es.readyState);
  es.onmessage = e => got.push(['message', e.data, e.lastEventId, e.origin]);
  es.addEventListener('note', e => got.push(['note', e.data, e.lastEventId]));
  assert.equal(es.readyState, 0); assert.equal(es.url, 'https://box.example.com/notes/api/events');
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0].init.headers.map(h => h[0])], ['Accept', 'Cache-Control']);
  assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(states, ['open:1']);
  s.write('\uFEFF: hello comment\ndata: first\n\n');
  await tick();
  assert.deepEqual(got, [['message', 'first', '', 'https://box.example.com']], 'the first event arrives before the stream ends');
  s.write('event: note\nid: 7\ndata: line one\r\ndata: line two\r');
  await tick();
  assert.equal(got.length, 1, 'not dispatched before its blank line');
  s.write('\n\r\ndata:no space\n\nid: 8\n\n');
  await tick();
  assert.deepEqual(got.slice(1), [['note', 'line one\nline two', '7'], ['message', 'no space', '7', 'https://box.example.com']]);
  es.close();
  assert.equal(es.readyState, 2);
  assert.equal(calls[0].init.signal.aborted, true, 'close() stops the call');
});

test('EventSource stand-in: a dropped stream reconnects after retry with Last-Event-ID; a refused answer closes it', async () => {
  const calls = [], streams = [sse(), sse()];
  const { g } = load(async (url, init) => { calls.push(init); return streams[calls.length - 1].res; });
  const es = new g.EventSource('/notes/api/events', { withCredentials: true }), errors = [], got = [];
  es.onerror = () => errors.push(es.readyState);
  es.onmessage = e => got.push(e.data);
  await tick();
  assert.equal(calls[0].credentials, 'include'); assert.equal(es.withCredentials, true);
  streams[0].write('retry: 20\nid: 41\ndata: a\n\ndata: half');
  await tick();
  streams[0].end();
  await tick();
  assert.deepEqual(errors, [0], 'the stream ended: error, then connecting again');
  assert.equal(calls.length, 1);
  await tick(40);
  assert.equal(calls.length, 2, 'reconnects after the retry time');
  assert.deepEqual([...calls[1].headers.find(h => h[0] === 'Last-Event-ID')], ['Last-Event-ID', '41']);
  streams[1].write('data: b\n\n');
  await tick();
  assert.deepEqual(got, ['a', 'b'], 'the half event at the end of the dropped stream was dropped');
  es.close();

  for (const bad of [sse(500), sse(200, 'text/plain')]) {
    let n = 0;
    const { g: g2 } = load(async () => { n++; return bad.res; });
    const es2 = new g2.EventSource('api/events'), errs = [];
    es2.onerror = () => errs.push(es2.readyState);
    await tick(30);
    assert.deepEqual(errs, [2], 'not a 200 event stream: closed, as the browser does');
    assert.equal(n, 1, 'and never asked again');
  }
});

test('EventSource stand-in: a failed connection retries; another site uses the browser\'s own EventSource', async () => {
  let n = 0;
  const { g } = load(async () => { n++; throw new TypeError('Failed to fetch'); });
  const es = new g.EventSource('api/events'), errs = [];
  es.onerror = () => { errs.push(es.readyState); if (errs.length === 2) es.close(); };
  await tick();
  assert.deepEqual(errs, [0]);
  await tick(3100);
  assert.equal(n, 2, 'tried again after the default 3 s');
  assert.deepEqual(errs, [0, 0]);
  await tick(50);
  assert.equal(n, 2, 'close() from the error handler stops the retries');
  const other = new g.EventSource('https://elsewhere.example/feed');
  assert.equal(other.native, 'https://elsewhere.example/feed');
  assert.throws(() => new g.EventSource('http://['), e => e.name === 'SyntaxError');
});
