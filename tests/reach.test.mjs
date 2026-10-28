import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/reach.js', import.meta.url), 'utf8');
const response = (body = { checks: [], overall: 'ok' }, status = 200) => ({ ok: status < 400, status, json: async () => body });
function setup({ online = true, fetch = async () => response(), hostname = 'wizard.example-tailnet.ts.net' } = {}) {
  let now = 100000, calls = [], events = 0, id = 0;
  const timers = new Map(), opened = [];
  const ctx = { navigator: { onLine: online }, document: { documentElement: { dataset: { shell: 'phone' } } }, location: { hostname, assign: url => opened.push(['same', url]) }, open: (...args) => opened.push(args), dispatchEvent() { events++; }, Event, AbortController, Date: { now: () => now }, setTimeout(fn, ms) { assert.equal(ms, 4000); timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, fetch: async (...args) => { calls.push(args); return fetch(...args); } };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { ctx, api: ctx.WizReach, calls, timers, opened, events: () => events, advance: ms => { now += ms; } };
}
test('offline device is diagnosed only after the Wizard probe fails', async () => {
  const h = setup({ online: false, fetch: async () => { throw Error('network'); } });
  assert.equal((await h.api.diagnose()).layer, 'device-offline'); assert.equal(h.calls.length, 1);
  const falseOffline = setup({ online: false }); assert.equal((await falseOffline.api.diagnose()).layer, 'send');
});
test('an unreachable Wizard on a Tailscale address names Tailscale and the Wizard computer, and never probes another site', async () => {
  // Wizard's CSP (connect-src 'self') blocks cross-site requests, so a public-internet probe always "fails".
  const h = setup({ fetch: async url => { if (!url.startsWith('/')) throw Error('blocked by CSP'); throw Error('network'); } });
  const d = await h.api.diagnose();
  assert.equal(d.layer, 'tailscale'); assert.equal(d.short, 'Can’t reach Wizard · retrying');
  assert.match(d.message, /Tailscale is on/); assert.match(d.message, /computer running your Wizard is on/);
  assert.equal(d.action, 'troubleshoot');
  assert.deepEqual(h.calls.map(c => c[0]), ['/troubleshoot/api/ping']);
  const local = setup({ hostname: '127.0.0.1', fetch: async () => { throw Error('network'); } });
  const l = await local.api.diagnose();
  assert.equal(l.layer, 'unreachable'); assert.doesNotMatch(l.message, /Tailscale/); assert.equal(local.calls.length, 1);
});
test('HTTP ping errors do not blame the device or Tailscale', async () => {
  const h = setup({ fetch: async () => response({}, 503) });
  assert.equal((await h.api.diagnose()).layer, 'gateway'); assert.equal(h.calls.length, 1);
});
test('failing checks use gateway/signin/shell/service/Hermes priority then unknown layers', async () => {
  const order = ['gateway', 'signin', 'shell', 'agent-service', 'hermes', 'disk'];
  for (let i = 0; i < order.length; i++) {
    const checks = order.slice(i).reverse().map(id => ({ id, ok: false, label: id, detail: 'out of space' }));
    const h = setup({ fetch: async () => response({ checks }) }); const d = await h.api.diagnose();
    assert.equal(d.layer, order[i]); assert.equal(d.action, 'troubleshoot');
    if (i === 3 || i === 4) assert.match(d.message, /restarts itself automatically/);
    if (i === 5) assert.equal(d.message, 'disk: out of space');
  }
});
test('status failure, malformed JSON, missing checks and degraded overall stay actionable', async () => {
  for (const status of [response({}, 502), { ok: true, json: async () => { throw Error('bad JSON'); } }, response({})]) {
    const h = setup({ fetch: async url => url.endsWith('ping') ? response() : status });
    assert.equal((await h.api.diagnose()).layer, 'diagnosis');
  }
  const h = setup({ fetch: async () => response({ checks: [], overall: 'down', summary: 'Restarting Wizard' }) });
  assert.equal((await h.api.diagnose()).message, 'Restarting Wizard');
});
test('healthy infrastructure with failed send reports retry; results cache 10s and coalesce', async () => {
  const h = setup(); const [a, b] = await Promise.all([h.api.diagnose(), h.api.diagnose()]);
  assert.equal(a, b); assert.equal(a.layer, 'send'); assert.equal(h.calls.length, 2);
  await h.api.diagnose(); assert.equal(h.calls.length, 2);
  h.advance(10001); await h.api.diagnose(); assert.equal(h.calls.length, 4);
  assert.equal(h.events(), 1); assert.equal(h.timers.size, 0);
  for (const [, options] of h.calls) assert.equal(options.cache, 'no-store');
});
test('failure consumers throttle diagnosis to 15s; healthy module never polls', async () => {
  const h = setup(); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
  h.api.failure(); await h.api.diagnose(); assert.equal(h.calls.length, 2);
  h.advance(11000); h.api.failure(); await Promise.resolve(); assert.equal(h.calls.length, 2);
  h.advance(4000); h.api.failure(); await h.api.diagnose(); assert.equal(h.calls.length, 4);
});
test('4s deadline handles hung fetch and status bodies, without hanging consumers', async () => {
  const h = setup({ online: false, fetch: () => new Promise(() => {}) });
  const work = h.api.diagnose(); [...h.timers.values()][0]();
  assert.equal((await work).layer, 'device-offline'); assert.equal(h.timers.size, 0);
  const b = setup({ fetch: async url => url.endsWith('ping') ? response() : { ok: true, json: () => new Promise(() => {}) } });
  const bodyWork = b.api.diagnose(); for (let i = 0; i < 10; i++) await Promise.resolve();
  [...b.timers.values()][0](); assert.equal((await bodyWork).layer, 'diagnosis');
});
test('Troubleshooter navigation is same-tab on phone and a safe new tab on desktop', () => {
  const h = setup(); h.api.open(); assert.deepEqual(h.opened[0], ['same', '/troubleshoot/']);
  h.ctx.document.documentElement.dataset.shell = 'desktop'; h.api.open();
  assert.deepEqual(h.opened[1], ['/troubleshoot/', '_blank', 'noopener']);
});

test('Troubleshoot on an unreachable Wizard: the phone app shows its Tailscale guide; elsewhere nothing opens', async () => {
  const h = setup({ hostname: 'wizard.example.ts.net', fetch: async () => { throw new TypeError('Load failed'); } });
  await h.api.diagnose();
  assert.equal(h.api.failure().layer, 'tailscale');
  assert.equal(h.api.open(), false, 'Troubleshooter is served by the Wizard it can’t reach');
  assert.deepEqual(h.opened, []);
  let restarted = 0;
  h.ctx.Capacitor = { Plugins: { WizardShell: { retry: async () => { restarted++; } } } };
  assert.equal(h.api.open(), true);
  assert.equal(restarted, 1, 'the app restarts into its connect screen and Tailscale guide');
  assert.deepEqual(h.opened, []);
});
