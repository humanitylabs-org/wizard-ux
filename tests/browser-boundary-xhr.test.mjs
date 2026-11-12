// wizard-os#133 slice 36: a sandboxed app's XMLHttpRequest goes through the app kit's fetch stand-in (core/app-client.js),
// so its calls to its own backend reach the shell's net.fetch like fetch does. Real Chromium proof (opaque frame, the
// real shell services, the app server seeing cookies and headers): tests/qa-browser-boundary-xhr.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CLIENT = fs.readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
const START = CLIENT.indexOf('    /* XMLHttpRequest goes the same way');
const END = CLIENT.indexOf('    } catch (_) {}\n', CLIENT.indexOf("Object.defineProperty(window, 'XMLHttpRequestUpload'", START)) + '    } catch (_) {}\n'.length;
const BLOCK = CLIENT.slice(START, END);

class ProgressEvent extends Event {
  constructor(type, o = {}) { super(type); this.loaded = o.loaded || 0; this.total = o.total || 0; this.lengthComputable = !!o.lengthComputable; }
}
// The XHR block on its own, with `window.fetch` standing in for the app kit's fetch stand-in (the shell's net.fetch).
function load(fetch) {
  const native = class NativeXHR { constructor() { this.native = true; } };
  const g = { location: { href: 'https://box.example.com/notes/' }, fetch, XMLHttpRequest: native, EventTarget, Event, ProgressEvent, DOMException,
    URL, URLSearchParams, FormData, Blob, Headers, Response, TextDecoder, AbortController, setTimeout, clearTimeout, Promise, Object, JSON, Math, Number, String, Error };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(`(() => {\n${BLOCK}\n})();`, g);
  return { g, native };
}
const run = (X, setup) => new Promise(done => {
  const x = new X(), ev = [], states = [];
  for (const t of ['loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend']) x.addEventListener(t, () => ev.push(t));
  x.onreadystatechange = () => states.push(x.readyState);
  x.onloadend = () => setTimeout(() => done({ x, ev, states }), 0);
  setup(x);
});

test('XMLHttpRequest stand-in: the call goes through the app kit fetch with its method, headers, body and credentials', async () => {
  const calls = [];
  const { g, native } = load(async (url, init) => { calls.push({ url, ...init }); return new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json', 'x-v': '7' } }); });
  assert.notEqual(g.XMLHttpRequest, native, 'the page gets the stand-in');
  assert.equal(g.XMLHttpRequest.DONE, 4);
  const { x, ev, states } = await run(g.XMLHttpRequest, x => {
    x.open('post', 'api/save'); x.setRequestHeader('X-App', 'yes'); x.responseType = 'json'; x.withCredentials = true; x.send('{"a":1}');
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://box.example.com/notes/api/save');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].headers)), [['X-App', 'yes']]);
  assert.equal(calls[0].body, '{"a":1}');
  assert.equal(calls[0].credentials, 'include');
  assert.deepEqual([x.status, x.statusText, x.readyState, x.getResponseHeader('X-V'), x.responseURL], [201, 'Created', 4, '7', 'https://box.example.com/notes/api/save']);
  assert.equal(x.response.ok, true);
  assert.deepEqual(states, [1, 2, 3, 4]);
  assert.deepEqual(ev, ['loadstart', 'progress', 'load', 'loadend']);
  assert.match(x.getAllResponseHeaders(), /^content-type: application\/json\r\n/m);
});

test('XMLHttpRequest stand-in: a refused call is a network error (status 0), never a partial answer', async () => {
  const { g } = load(async () => { throw new TypeError('Failed to fetch'); });
  const { x, ev } = await run(g.XMLHttpRequest, x => { x.open('GET', '/other/api/secret'); x.send(); });
  assert.deepEqual([x.status, x.readyState, x.responseText, x.getAllResponseHeaders()], [0, 4, '', '']);
  assert.deepEqual(ev, ['loadstart', 'error', 'loadend']);
});

test('XMLHttpRequest stand-in: abort and timeout stop the fetch (its signal) and fire their own events', async () => {
  const signals = [];
  const { g } = load((url, init) => new Promise((_, reject) => { signals.push(init.signal); init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const a = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/slow'); x.send(); setTimeout(() => x.abort(), 5); });
  assert.deepEqual([a.ev, a.x.readyState, a.x.status, signals[0].aborted], [['loadstart', 'abort', 'loadend'], 0, 0, true]);
  const t = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/slow'); x.timeout = 10; x.send(); });
  assert.deepEqual([t.ev, t.x.readyState, signals[1].aborted], [['loadstart', 'timeout', 'loadend'], 4, true]);
  // A request opened again drops the old one without events.
  const seen = [];
  const x = new g.XMLHttpRequest(); x.addEventListener('abort', () => seen.push('abort'));
  x.open('GET', 'api/slow'); x.send(); x.open('GET', 'api/other');
  assert.equal(signals[2].aborted, true); assert.deepEqual(seen, []); assert.equal(x.readyState, 1);
});

test('XMLHttpRequest stand-in: binary, text and bad JSON answers; GET drops a body; responseText only for text', async () => {
  const { g } = load(async (url, init) => {
    if (url.endsWith('/bytes')) return new Response(new Uint8Array([0, 250, 255]), { headers: { 'content-type': 'application/octet-stream' } });
    if (url.endsWith('/bad')) return new Response('{nope', { headers: { 'content-type': 'application/json' } });
    return new Response('body was ' + String(init.body));
  });
  const bytes = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/bytes'); x.responseType = 'arraybuffer'; x.send(); });
  assert.deepEqual([...new Uint8Array(bytes.x.response)], [0, 250, 255]);
  assert.throws(() => bytes.x.responseText, e => e.name === 'InvalidStateError');
  const blob = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/bytes'); x.responseType = 'blob'; x.send(); });
  assert.deepEqual([blob.x.response.type, blob.x.response.size], ['application/octet-stream', 3]);
  const bad = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/bad'); x.responseType = 'json'; x.send(); });
  assert.equal(bad.x.response, null);
  const get = await run(g.XMLHttpRequest, x => { x.open('GET', 'api/echo'); x.send('ignored'); });
  assert.equal(get.x.responseText, 'body was null');
  assert.throws(() => { const x = new g.XMLHttpRequest(); x.send(); }, e => e.name === 'InvalidStateError', 'send before open');
});

test('XMLHttpRequest stand-in: upload events fire for any body, FormData too (Codex P2)', async () => {
  const { g } = load(async () => new Response('ok'));
  for (const body of [() => { const f = new FormData(); f.append('file', new Blob(['figs']), 'figs.txt'); return f; }, () => new URLSearchParams('a=1'), () => 'text']) {
    const up = [];
    const done = await run(g.XMLHttpRequest, x => {
      for (const t of ['loadstart', 'progress', 'load', 'loadend']) x.upload.addEventListener(t, () => up.push(t));
      x.open('POST', 'api/upload'); x.send(body());
    });
    assert.equal(done.x.status, 200);
    assert.deepEqual(up, ['loadstart', 'progress', 'load', 'loadend'], body().constructor.name);
  }
});
