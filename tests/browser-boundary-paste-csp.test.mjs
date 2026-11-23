import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCsp, nginxCsp, serverPyCsp } from './fixtures/w1-csp.mjs';
// wizard-os#133 (17 Nov check-in): two shell reaches that the browser boundary must not lose or widen.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// 1. Troubleshooter's direct line: the shell CSP names this address's own :9691, never every tailnet name's.
test('nginx names only this Tailscale address\'s own :9691 in connect-src and frame-src', () => {
  // the CSP the image's nginx really sends for each Host (rendered by the real entrypoint: tests/fixtures/w1-csp.mjs)
  const direct = host => { const c = parseCsp(nginxCsp({ host })); return ['connect-src', 'frame-src'].map(d => c[d].filter(s => s.endsWith(':9691'))); };
  for (const h of ['wizard.example.ts.net', 'box-1.example.ts.net'])
    assert.deepEqual(direct(h), [[`https://${h}:9691`], [`https://${h}:9691`]], `${h} gets exactly its own line`);
  for (const h of ['localhost', 'evil.example', 'a b.ts.net', 'x.ts.net;script-src *', 'ts.net', '.ts.net', 'x.ts.net.evil.example', '-x.ts.net'])
    assert.deepEqual(direct(h), [['https://*.ts.net:9691'], ['https://*.ts.net:9691']], `${JSON.stringify(h)} never gets its own name into the CSP`);
});
test('the dev server (server.py) names its own configured Tailscale address, never the request\'s Host', async () => {
  const py = String.raw`
import sys; sys.path.insert(0, '.')
import server
for o in [['https://wizard.example.ts.net'], ['http://127.0.0.1:9271', 'https://Wizard.Example.ts.net:443/'], ['http://localhost:9271'], ['https://x.ts.net;script-src *'], ['https://-x.ts.net'], ['http://wizard.example.ts.net'], []]:
    print(server.troubleshoot_direct(o))
`;
  const out = execFileSync('python3', ['-c', py], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(out, ['https://wizard.example.ts.net:9691', 'https://wizard.example.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691']);
  // the CSP the real dev server sends (served by server.py on a free port), for a configured address
  const served = parseCsp(await serverPyCsp({ origin: 'https://wizard.example.ts.net' }));
  assert.deepEqual(served['connect-src'].filter(x => /tailscale|9691/.test(x)), ['https://derp1.tailscale.com/generate_204', 'https://wizard.example.ts.net:9691']);
  assert.deepEqual(served['frame-src'].slice(0, 2), ["'self'", 'blob:']);
  assert.ok(served['frame-src'].some(x => x === 'https://wizard.example.ts.net:9691'), 'its own direct line, not the 127.0.0.1 Host it was asked on');
  const none = parseCsp(await serverPyCsp({ origin: '' }));
  assert.ok(none['connect-src'].some(x => x === 'https://*.ts.net:9691') && !none['connect-src'].some(x => x.includes('127.0.0.1:9691')), 'unconfigured: the generic line');
});

// 2. Android paste (wizard-ux#1480): the shell can't reach a sandboxed app document, so the app side nudges itself.
function client({ raf = true } = {}) {
  const on = {}, frames = [], body = { style: { minHeight: '' } };
  const a = { setTimeout, clearTimeout, crypto: globalThis.crypto, JSON, console, Promise, Object, String, Map, Set, Error };
  a.window = a; a.origin = 'null';
  a.location = { origin: 'https://wizard.example', href: 'https://wizard.example/notes/' };
  a.addEventListener = (t, fn) => (on[t] ||= []).push(fn); a.removeEventListener = () => {};
  a.document = { activeElement: null, body, addEventListener() {} };
  a.parent = { postMessage() {} };
  if (raf) a.requestAnimationFrame = fn => frames.push(fn);
  vm.createContext(a);
  vm.runInContext(read('web/core/browser-boundary-client.js'), a);
  return { resize: () => (on.resize || []).forEach(fn => fn()), frames, body, a };
}
test('a sandboxed app lays itself out once more after a resize, then restores its body', () => {
  const c = client();
  assert.ok(c.a.WizBoundaryClient, 'the client runs in an opaque frame');
  c.resize();
  assert.equal(c.body.style.minHeight, '1px');
  c.frames.shift()();
  assert.equal(c.body.style.minHeight, '');
});
test('several resizes before the next frame make one nudge and keep the app\'s own min-height', () => {
  const c = client(); c.body.style.minHeight = '50vh';
  c.resize(); c.resize();
  assert.equal(c.frames.length, 1);
  c.frames.shift()();
  assert.equal(c.body.style.minHeight, '50vh');
});
test('without requestAnimationFrame the body is never left nudged', () => {
  const c = client({ raf: false });
  c.resize();
  assert.equal(c.body.style.minHeight, '');
});
