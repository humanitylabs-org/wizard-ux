// Android main-document shell port facade (web/core/native-shell-port.js), wizard-os issue 387.
// The native receiver's admission is proven on the emulator (ShellPortE2eTest); this covers the page half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/native-shell-port.js', import.meta.url), 'utf8');
const java = readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/shellport/ShellPortPolicy.java', import.meta.url), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const UA = 'Mozilla/5.0 (Linux; Android 14) WizardOS-Android/0.10.22';

function harness({ ua = UA, top = true, port = true, legacy = false, answerHello = true, results = {} } = {}) {
  const sent = [], hooks = [], events = [], timers = [];
  const fake = {
    onmessage: null,
    postMessage(s) {
      const m = JSON.parse(s); sent.push(m);
      if (m.method === 'hello') { if (answerHello) reply({ v: 1, id: m.id, ok: true, result: { capabilities: {}, state: h.state } }); return; }
      const r = Object.prototype.hasOwnProperty.call(results, m.method) ? results[m.method] : null;
      if (r instanceof Error) reply({ v: 1, id: m.id, ok: false, error: r.message });
      else reply({ v: 1, id: m.id, ok: true, result: typeof r === 'function' ? r(m.args) : r, state: h.state });
    },
  };
  const reply = msg => queueMicrotask(() => fake.onmessage?.({ data: JSON.stringify(msg) }));
  const ctx = {
    wizardShellPort: port ? fake : undefined,
    __wosSideButton: v => hooks.push(['side', v]), __wosUnsent: () => hooks.push(['unsent']), __wosEverywhere: () => hooks.push(['everywhere']),
    __wosUsuals: () => hooks.push(['usuals']), __wosCutout: n => hooks.push(['cutout', n]), __wosTop: n => hooks.push(['top', n]),
    WosDevice: { event: (t, d) => hooks.push(['event', t, d]) },
    dispatchEvent: e => events.push(e.type),
    navigator: { userAgent: ua }, document: { addEventListener() {}, hidden: false }, Event: class { constructor(t) { this.type = t; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    queueMicrotask, console, Blob, atob,
  };
  if (legacy) { ctx.WizardOSNative = { haptic() {} }; ctx.WizardOSDevice = { version: () => 1 }; }
  vm.createContext(ctx);
  ctx.window = vm.runInContext('this', ctx);
  ctx.top = top ? ctx.window : {};
  const h = { ctx, sent, hooks, events, timers, fake, reply,
    state: { native: { platform: 'android:0.10.22', sideButton: '{"mic":true}', everywhere: '{"enabled":false}', unsent: '[]', usuals: '{"list":[]}', cutoutTop: 24, insetTop: 32 },
      device: { version: 1, recActive: 'null', recLevel: 0, recPending: '[]', updateState: '{"state":"idle"}' } } };
  vm.runInContext(src, ctx);
  return h;
}

test('Java command table and the page facade table are the same reviewed set', () => {
  const pick = name => {
    const block = java.slice(java.indexOf(`String[][] ${name} = {`), java.indexOf('};', java.indexOf(`String[][] ${name} = {`)));
    return Object.fromEntries([...block.matchAll(/\{"([A-Za-z]+)", "([sibl]*)"\}/g)].map(m => [m[1], m[2]]));
  };
  const table = name => { const at = src.indexOf(`const ${name} = {`); return Function(`return ${src.slice(at + `const ${name} = `.length, src.indexOf('};', at) + 1)}`)(); };
  assert.deepEqual(table('NATIVE'), pick('n'));
  assert.deepEqual(table('DEVICE'), pick('d'));
  const jsFresh = [...src.slice(src.indexOf('const FRESH'), src.indexOf(']);', src.indexOf('const FRESH'))).matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]).sort();
  const javaFresh = [...java.slice(java.indexOf('Collections.addAll(FRESH'), java.indexOf(');', java.indexOf('Collections.addAll(FRESH'))).matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(jsFresh, javaFresh);
  // The page-side hook allowlist matches native's.
  const javaHooks = [...java.slice(java.indexOf('HOOKS ='), java.indexOf(')));', java.indexOf('HOOKS ='))).matchAll(/"([A-Za-z_.]+)"/g)].map(m => m[1]).sort();
  const jsHooks = [...src.slice(src.indexOf('const hooks = {'), src.indexOf('};', src.indexOf('const hooks = {'))).matchAll(/^\s+'?([A-Za-z_.]+)'?:/gm)].map(m => m[1]).sort();
  assert.deepEqual(jsHooks, javaHooks);
});

test('a hosted (child) frame never gets a facade, even with the port injected', () => {
  const h = harness({ top: false });
  assert.equal(h.ctx.WizardOSNative, undefined);
  assert.equal(h.ctx.WizardOSDevice, undefined);
  assert.equal(h.sent.length, 0);
  assert.equal(h.ctx.WosNativeShell.status, 'unsupported');
  assert.equal(h.ctx.WosNativeShell.safeForAppFrames(), false);
});

test('browsers take the browser-only path; older all-frame APKs are never treated as safe', () => {
  const b = harness({ ua: 'Mozilla/5.0 Chrome/130', port: false });
  assert.equal(b.ctx.WosNativeShell.status, 'browser');
  assert.equal(b.ctx.WosNativeShell.safeForAppFrames(), true);
  assert.equal(b.ctx.WizardOSNative, undefined);
  const l = harness({ legacy: true });
  assert.equal(l.ctx.WosNativeShell.status, 'legacy');
  assert.equal(l.ctx.WosNativeShell.safeForAppFrames(), false);
  assert.equal(l.sent.length, 0, 'no handshake over a legacy build');
  const u = harness({ port: false });
  assert.equal(u.ctx.WosNativeShell.status, 'unsupported');
  assert.equal(u.ctx.WosNativeShell.safeForAppFrames(), false);
});

test('no handshake answer (native refused this document) fails closed after bounded retries', async () => {
  const h = harness({ answerHello: false });
  assert.equal(h.ctx.WosNativeShell.status, 'pending');
  assert.equal(h.ctx.WosNativeShell.safeForAppFrames(), false);
  for (let i = 0; i < 8; i++) { const t = h.timers.find(x => x.fn && x.ms === 1500); t.fn(); t.fn = null; }
  assert.equal(h.ctx.WosNativeShell.status, 'unsupported');
  assert.equal(await h.ctx.WosNativeShell.ready, false);
  assert.equal(h.sent.filter(m => m.method === 'hello').length, 8);
});

test('handshake fills cached reads synchronously and re-runs the shell hooks once', async () => {
  const h = harness();
  const N = h.ctx.WizardOSNative, D = h.ctx.WizardOSDevice;
  assert.equal(typeof N.sideButton, 'function', 'objects exist before the handshake answers');
  assert.equal(N.sideButton(), 'null');
  await settle();
  assert.equal(h.ctx.WosNativeShell.status, 'ok');
  assert.equal(await h.ctx.WosNativeShell.ready, true);
  assert.equal(N.sideButton(), '{"mic":true}');
  assert.equal(N.cutoutTop(), 24);
  assert.equal(D.updateState(), '{"state":"idle"}');
  assert.deepEqual(h.hooks.slice(0, 6).map(x => x[0]), ['side', 'unsent', 'everywhere', 'usuals', 'cutout', 'top']);
  assert.deepEqual(h.events, ['wos-native-ready', 'wos-native-resume']);
  assert.throws(() => { h.ctx.WizardOSNative = {}; }, /read only/, 'a later script cannot swap the facade');
  assert.equal(h.ctx.WizardOSNative, N);
  assert.ok(Object.isFrozen(N) && Object.isFrozen(D));
});

test('actions post typed arguments; fresh results are Promises; errors reject', async () => {
  const h = harness({ results: { recStart: 'take-1', usualsRun: '', micRoute: 'builtin', recRead: new Error('Something went wrong') } });
  await settle();
  const N = h.ctx.WizardOSNative, D = h.ctx.WizardOSDevice;
  assert.equal(N.haptic('12.7'), undefined);
  N.keepAwake(1); N.appVoice('listen', 1234.9); N.openInBrowser(undefined);
  assert.equal(D.clip('x'), true);
  const posted = h.sent.filter(m => m.method !== 'hello');
  assert.deepEqual(posted.map(m => [m.target, m.method, m.args]), [
    ['native', 'haptic', [12]], ['native', 'keepAwake', [true]], ['native', 'appVoice', ['listen', 1234]],
    ['native', 'openInBrowser', [null]], ['device', 'clip', ['x']]]);
  const p = D.recStart('auto');
  assert.equal(typeof p.then, 'function');
  assert.equal(await p, 'take-1');
  assert.equal(await D.micRoute(), 'builtin');
  await assert.rejects(D.recRead('t', 0), /Something went wrong/);
});

test('native pushes refresh the cache and only allowlisted hooks run', async () => {
  const h = harness();
  await settle(); h.hooks.length = 0;
  h.reply({ v: 1, type: 'state', state: { native: { unsent: '[{"id":"a"}]' }, device: { recActive: '{"id":"t1"}', recLevel: 55 } } });
  await settle();
  assert.equal(h.ctx.WizardOSNative.unsent(), '[{"id":"a"}]');
  assert.equal(h.ctx.WizardOSDevice.recLevel(), 55);
  assert.deepEqual(h.hooks, [['unsent']]);
  h.hooks.length = 0;
  h.reply({ v: 1, type: 'hook', hook: 'WosDevice.event', arg: JSON.stringify(['rec', { type: 'stopped', id: 't1' }]), state: { device: { recActive: 'null' } } });
  h.reply({ v: 1, type: 'hook', hook: '__wosNativeBack', arg: null });
  h.reply({ v: 1, type: 'hook', hook: 'constructor', arg: null });
  h.reply({ v: 1, type: 'hook', hook: '__wosTop', arg: '40' });
  await settle();
  assert.equal(JSON.stringify(h.hooks), JSON.stringify([['event', 'rec', { type: 'stopped', id: 't1' }], ['top', 40]]));
  assert.equal(h.ctx.WizardOSDevice.recActive(), 'null', 'state applied before the hook ran');
  // A reply for an id nobody asked for is ignored.
  h.reply({ v: 1, id: 'forged', ok: true, result: 'x' });
  await settle();
});

test('fetch stops the live take, reads every chunk, and then recStop answers synchronously', async () => {
  const bytes = Buffer.from('0123456789');
  const h = harness({ results: {
    recStop: () => JSON.stringify({ id: 'live', ms: 900, bytes: 10 }),
    recRead: ([id, off]) => JSON.stringify(off === 0 ? { b64: bytes.subarray(0, 6).toString('base64'), next: 6 } : { b64: bytes.subarray(6).toString('base64'), next: -1 }),
  } });
  h.state.device.recActive = '{"id":"live"}';
  await settle();
  const D = h.ctx.WizardOSDevice;
  await D.fetch('live');
  assert.deepEqual(h.sent.filter(m => m.method !== 'hello').map(m => m.method), ['recStop', 'recRead', 'recRead']);
  assert.equal(D.recStop('live'), JSON.stringify({ id: 'live', ms: 900, bytes: 10 }));
  assert.equal(D.fetched('live').blob.size, 10);
  D.recDone('live');
  assert.equal(D.fetched('live'), null);
});

test('an already-stopped take is read without claiming it (recovery stays visible after a reload)', async () => {
  const h = harness({ results: {
    recPending: () => JSON.stringify([{ id: 'old', ms: 500, bytes: 3 }]),
    recRead: () => JSON.stringify({ b64: Buffer.from('abc').toString('base64'), next: -1 }),
  } });
  await settle();
  await h.ctx.WizardOSDevice.fetch('old');
  const methods = h.sent.filter(m => m.method !== 'hello').map(m => m.method);
  assert.deepEqual(methods, ['recPending', 'recRead']);
  assert.ok(!methods.includes('recClaim'));
});

test('calls made before the handshake wait for it (native never answers an unbound document)', async () => {
  const h = harness({ answerHello: false, results: { micRoute: 'builtin' } });
  h.ctx.WizardOSNative.immersive(false);
  const p = h.ctx.WizardOSDevice.micRoute();
  await settle();
  assert.deepEqual(h.sent.map(m => m.method), ['hello'], 'nothing but hello before binding');
  h.reply({ v: 1, id: h.sent[0].id, ok: true, result: { state: h.state } });
  assert.equal(await p, 'builtin');
  assert.deepEqual(h.sent.map(m => m.method).sort(), ['hello', 'immersive', 'micRoute']);
});

test('a native rebind fails calls in flight instead of resending them, then binds again quietly', async () => {
  const h = harness();
  await settle(); h.hooks.length = 0; h.events.length = 0;
  // Hold the next answer: swap the fake so micRoute is never answered.
  const post = h.fake.postMessage; h.fake.postMessage = s => { const m = JSON.parse(s); if (m.method === 'hello') post.call(h.fake, s); else h.sent.push(m); };
  const inflight = h.ctx.WizardOSDevice.micRoute();
  await settle();
  h.reply({ v: 1, type: 'rebind' });
  await assert.rejects(inflight, /reconnected/);
  await settle();
  assert.equal(h.ctx.WosNativeShell.status, 'ok');
  assert.equal(h.sent.filter(m => m.method === 'hello').length, 2);
  assert.equal(h.sent.filter(m => m.method === 'micRoute').length, 1, 'never sent twice');
  assert.deepEqual(h.hooks, [], 'a re-bind does not re-run boot hooks');
  assert.deepEqual(h.events, []);
});
