import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// wizard-os#133 (17 Nov check-in): two shell reaches that the browser boundary must not lose or widen.
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// 1. Troubleshooter's direct line: the shell CSP names this address's own :9691, never every tailnet name's.
test('nginx names only this Tailscale address\'s own :9691 in connect-src and frame-src', () => {
  const csp = /Content-Security-Policy "([^"]+)"/.exec(read('packaging/static.conf'))[1];
  assert.doesNotMatch(csp, /\*\.ts\.net/);
  for (const d of ['connect-src', 'frame-src']) assert.ok(new RegExp(`${d} [^;]*\\$wizard_troubleshoot_direct`).test(csp), d);
  const tpl = read('packaging/nginx.conf.template');
  const map = /map \$host \$wizard_troubleshoot_direct \{([^}]+)\}/.exec(tpl)?.[1];
  assert.ok(map, 'the map is defined in the http block');
  const rule = /"~([^"]+)" "https:\/\/\$host:9691";/.exec(map);
  assert.ok(rule, 'a Tailscale Host gets exactly https://$host:9691');
  assert.match(map, /default "https:\/\/\*\.ts\.net:9691";/);
  const re = new RegExp(rule[1].replace(/\\\\/g, '\\'));
  for (const h of ['wizard.tail1234.ts.net', 'box-1.example-tailnet.ts.net']) assert.ok(re.test(h), h);
  for (const h of ['localhost', 'evil.example', 'a b.ts.net', 'x.ts.net;script-src *', 'ts.net', '.ts.net', 'x.ts.net.evil.example', '-x.ts.net']) assert.ok(!re.test(h), h);
  assert.ok(tpl.indexOf('$wizard_troubleshoot_direct') < tpl.indexOf('server {'), 'defined before the server block');
});
test('the dev server (server.py) follows the same Host rule', () => {
  const py = String.raw`
import sys; sys.path.insert(0, '.')
import server
class H(server.Handler):
    def __init__(self, host): self.headers = {'Host': host} if host is not None else {}
for h in ['wizard.tail1234.ts.net', 'Wizard.Tail1234.ts.net:443', 'localhost:9271', 'x.ts.net;script-src *', None]:
    print(H(h)._troubleshoot_direct())
`;
  const out = execFileSync('python3', ['-c', py], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(out, ['https://wizard.tail1234.ts.net:9691', 'https://wizard.tail1234.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691', 'https://*.ts.net:9691']);
  assert.match(read('server.py'), /connect-src 'self' https:\/\/derp1\.tailscale\.com\/generate_204 \{direct\};[^"]*frame-src 'self' blob: \{direct\};/);
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
