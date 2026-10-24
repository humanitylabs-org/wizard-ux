// Wizard Shell background recording (web/core/device-recording.js) over a fake wizardDevicePort v1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const portSrc = readFileSync(new URL('../web/core/device-port.js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../web/core/device-recording.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };

function harness({ port = true, caps = ['status', 'level', 'start', 'pause', 'stop', 'cancel', 'pending', 'read', 'ack'], full = false } = {}) {
  const sent = [], audio = new Map(), takes = new Map(), toasts = [];
  let live = null;
  const answer = (m, result, error) => queueMicrotask(() => fake.onmessage?.({ data: JSON.stringify(error ? { v: 1, id: m.id, ok: false, error } : { v: 1, id: m.id, ok: true, result }) }));
  const fake = {
    onmessage: null,
    postMessage(s) {
      const m = JSON.parse(s); sent.push(m); const p = m.params || {};
      if (m.method === 'device.capabilities') return answer(m, { v: 1, capabilities: { 'device.recording': { v: 1, methods: caps.map(c => 'device.recording.' + c) } } });
      const name = m.method.replace('device.recording.', '');
      if (name === 'status') return answer(m, { id: live, state: live ? 'recording' : 'idle', ms: 1200, level: 40, last: { id: '', state: '' } });
      if (name === 'start') { live = p.id; audio.set(p.id, 'abcdefgh'); takes.set(p.id, { id: p.id, kind: p.kind, state: 'recording' }); return answer(m, { id: p.id }); }
      if (name === 'stop') { live = null; const t = { ...takes.get(p.id), state: 'stopped', ms: 4000, bytes: audio.get(p.id).length, mime: 'audio/aac', released: false }; takes.set(p.id, t); return answer(m, t); }
      if (name === 'read') { const a = audio.get(p.id); return a ? answer(m, { b64: Buffer.from(a).toString('base64'), next: -1, size: a.length }) : answer(m, null, 'unknown take'); }
      if (name === 'ack') { const had = takes.delete(p.id); audio.delete(p.id); return answer(m, { released: had }); }
      if (name === 'pending') return answer(m, [...takes.values()].filter(t => t.id !== live).map(t => ({ ...t, bytes: audio.get(t.id)?.length || 0 })));
      if (name === 'cancel') { live = null; return answer(m, { released: true }); }
      if (name === 'pause') return answer(m, {});
      answer(m, null, 'unknown method');
    },
  };
  const outbox = new Map();
  const window = {
    wizardDevicePort: port ? fake : undefined,
    WizardOSDevice: full ? { recStart() {} } : undefined,
    __wos: { V: { native: null }, voice: 'idle', toast: (...a) => toasts.push(a), setVoice() {}, txHide() {}, nativeResume: () => true },
    WosOutbox: {
      recoveryComplete: true,
      nativeItem: () => null,
      async capture(blob, id) { const it = { id, audio: blob, durable: true, state: 'capturing' }; outbox.set(id, it); return it; },
      async transition(id, state, error) { Object.assign(outbox.get(id), { state, error }); return outbox.get(id); },
    },
  };
  const ctx = { window, document: { readyState: 'complete', hidden: false, addEventListener() {} }, crypto: webcrypto, Blob, atob, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, queueMicrotask, console };
  vm.createContext(ctx);
  vm.runInContext(portSrc, ctx);
  vm.runInContext(src, ctx);
  return { window, sent, takes, audio, outbox, toasts, seed: t => { takes.set(t.id, t); audio.set(t.id, t.data); }, get live() { return live; } };
}

test('no port, or the full Wizard OS app: inert, the orb keeps today\'s recorder', async () => {
  for (const opts of [{ port: false }, { full: true }]) {
    const h = harness(opts); await settle();
    assert.equal(h.window.WosDeviceRecording.device(), null);
    assert.equal(h.sent.length, 0);
  }
});

test('a port without the whole capability is not used', async () => {
  const h = harness({ caps: ['status', 'start'] }); await settle();
  assert.equal(h.window.WosDeviceRecording.ready, false);
  assert.equal(h.window.WosDeviceRecording.device(), null);
  assert.deepEqual(h.sent.map(m => m.method), ['device.capabilities']);
});

test('discovery, then start → stop → read → ack through the recorder surface app.js uses', async () => {
  const h = harness(); await settle();
  const d = h.window.WosDeviceRecording.device();
  assert.ok(d, 'capability discovered');
  assert.ok(h.sent.every(m => m.v === 1 && typeof m.id === 'string' && m.id.length <= 64));
  const id = d.recStart('auto');
  assert.match(id, /^take-\d+-[0-9a-f]{8}$/);
  assert.equal(JSON.parse(d.recActive()).id, id, 'synchronously known to the orb');
  assert.equal(d.recStart('auto'), '', 'one take at a time');
  await settle();
  assert.equal(h.live, id);
  assert.equal(d.recStop(id), 'null', 'nothing claimed before the async fetch');
  await d.fetch(id);
  const meta = JSON.parse(d.recStop(id));
  assert.equal(meta.id, id); assert.equal(meta.bytes, 8); assert.equal(meta.kind, 'auto');
  assert.equal(await d.fetched(id).blob.text(), 'abcdefgh');
  assert.equal(JSON.parse(d.recPending()).find(t => t.id === id).id, id, 'a fetched take is still listed until the outbox has it');
  assert.ok(h.takes.has(id), 'native custody kept until recDone');
  d.recDone(id); await settle();
  assert.equal(h.takes.has(id), false, 'released only by ack');
  assert.equal(d.fetched(id), null);
});

test('takes cut short by an app kill go into the outbox as held recordings, then native releases them', async () => {
  const h = harness();
  h.seed({ id: 'take-1-0000abcd', kind: 'auto', state: 'interrupted', ms: 9000, data: 'killed-mid-take' });
  await settle(40);
  const it = h.outbox.get('native-take-1-0000abcd');
  assert.ok(it, 'moved into the durable outbox');
  assert.equal(it.state, 'held', 'held, never sent automatically');
  assert.match(it.error, /Interrupted/);
  assert.equal(await it.audio.text(), 'killed-mid-take');
  assert.equal(h.takes.has('take-1-0000abcd'), false, 'acked after the durable copy');
  assert.ok(h.sent.some(m => m.method === 'device.recording.ack' && m.params.id === 'take-1-0000abcd'));
});

test('a take is never acked while the outbox copy is not durable', async () => {
  const h = harness();
  h.window.WosOutbox.capture = async (blob, id) => ({ id, audio: blob, durable: false });
  h.window.WosOutbox.transition = async () => ({});
  h.seed({ id: 'take-2-0000abcd', kind: 'auto', state: 'stopped', ms: 3000, data: 'keep-me' });
  await settle(40);
  assert.ok(h.takes.has('take-2-0000abcd'));
  assert.equal(h.sent.some(m => m.method === 'device.recording.ack'), false);
});

test('app.js reaches the shell recorder only through DEV() and keeps the full app\'s bridge first', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /const DEV = \(\) => \{ const d = window\.WizardOSDevice; return d && typeof d\.recStart === 'function' \? d : window\.WosDeviceRecording\?\.device\(\) \|\| null; \};/);
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('core/device-port.js') < html.indexOf('core/device-recording.js'));
  assert.ok(html.indexOf('core/device-recording.js') < html.indexOf('"app.js"'));
});
