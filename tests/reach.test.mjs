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
test('a false browser offline hint never proves absent internet', async () => {
  const h = setup({ online: false, fetch: async () => { throw Error('network'); } });
  assert.equal((await h.api.diagnose()).layer, 'tailscale'); assert.equal(h.calls.length, 2);
  const falseOffline = setup({ online: false }); assert.equal((await falseOffline.api.diagnose()).layer, 'send');
});
test('an unreachable Wizard names actionable Tailscale guidance even when the public check is blocked', async () => {
  // Wizard's CSP (connect-src 'self') blocks cross-site requests, so a public-internet probe always "fails".
  const h = setup({ fetch: async url => { if (!url.startsWith('/')) throw Error('blocked by CSP'); throw Error('network'); } });
  const d = await h.api.diagnose();
  assert.equal(d.layer, 'tailscale'); assert.equal(d.short, 'Can’t reach Wizard · retrying');
  assert.match(d.message, /Tailscale app/); assert.match(d.message, /computer running your Wizard is on/);
  assert.equal(d.action, 'troubleshoot');
  assert.deepEqual(h.calls.map(c => c[0]), ['/troubleshoot/api/ping', 'https://derp1.tailscale.com/generate_204']);
  const local = setup({ hostname: '127.0.0.1', fetch: async () => { throw Error('network'); } });
  const l = await local.api.diagnose();
  assert.equal(l.layer, 'unreachable'); assert.doesNotMatch(l.message, /Tailscale/); assert.equal(local.calls.length, 2);
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
    if (i === 3 || i === 4) assert.match(d.message, /comes back on its own/);
    if (i === 5) assert.equal(d.message, 'disk: out of space');
  }
});
test('status failure, malformed JSON, missing checks and degraded overall stay actionable', async () => {
  for (const status of [response({}, 502), { ok: true, json: async () => { throw Error('bad JSON'); } }, response({})]) {
    const h = setup({ fetch: async url => url.endsWith('ping') ? response() : status });
    assert.equal((await h.api.diagnose()).layer, 'diagnosis');
  }
  const h = setup({ fetch: async () => response({ checks: [], overall: 'down', summary: 'Restarting Wizard' }) });
  const d = await h.api.diagnose(); assert.equal(d.short, 'Reconnecting…');
  assert.equal((await h.api.diagnose()).message, 'Restarting Wizard');
});
test('healthy infrastructure with failed send reports retry; results cache 10s and coalesce', async () => {
  const h = setup(); const [a, b] = await Promise.all([h.api.diagnose(), h.api.diagnose()]);
  assert.equal(a, b); assert.equal(a.layer, 'send'); assert.equal(h.calls.length, 2);
  // Request-neutral: a read-only failure shares this result, so it never claims an outbound message.
  assert.equal(a.short, 'Wizard reachable · retrying');
  assert.match(a.message, /don’t show whether the request went through/);
  assert.doesNotMatch(a.message, /message|didn’t take/);
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
  for (let i = 0; i < 12; i++) await Promise.resolve(); [...h.timers.values()][0]();
  assert.equal((await work).layer, 'tailscale'); assert.equal(h.timers.size, 0);
  const b = setup({ fetch: async url => url.endsWith('ping') ? response() : { ok: true, json: () => new Promise(() => {}) } });
  const bodyWork = b.api.diagnose(); for (let i = 0; i < 10; i++) await Promise.resolve();
  [...b.timers.values()][0](); assert.equal((await bodyWork).layer, 'busy');
});
test('status deadline with a working ping reports busy, and the Wizard check is slow not a problem', async () => {
  for (const bodyHung of [false, true]) {
    const h = setup({ fetch: async url => !url.includes('/status') ? response() : bodyHung ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {}) });
    const work = h.api.checks();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    assert.equal(h.timers.size, 1); [...h.timers.values()][0]();
    const rows = await work, d = await h.api.diagnose();
    assert.equal(d.layer, 'busy'); assert.equal(d.short, 'Reconnecting…');
    assert.match(d.message, /busy and answering slowly/); assert.match(d.message, /kept on this device and send by themselves/);
    assert.equal(rows.wizard.state, 'slow'); assert.equal(rows.wizard.detail, 'Busy · answering slowly');
    assert.doesNotMatch(rows.wizard.detail, /Problem|health report/); assert.equal(h.timers.size, 0);
  }
});
test('real status HTTP and JSON failures retain the unavailable-health-report diagnosis', async () => {
  for (const reply of [{ ok: false, status: 503, json: () => new Promise(() => {}) }, { ok: true, json: async () => { throw Error('bad JSON'); } }]) {
    const h = setup({ fetch: async url => url.endsWith('ping') ? response() : reply });
    const d = await h.api.diagnose(); assert.equal(d.layer, 'diagnosis'); assert.match(d.message, /health report isn’t available/);
  }
});
test('Troubleshooter navigation is same-tab on phone and a safe new tab on desktop', async () => {
  const h = setup(); await h.api.open(); assert.deepEqual(h.opened[0], ['same', '/troubleshoot/']);
  h.ctx.document.documentElement.dataset.shell = 'desktop'; await h.api.open();
  assert.deepEqual(h.opened[1], ['/troubleshoot/', '_blank', 'noopener']);
});

// James, 27 Oct: an Agent Service restart showed "Agent Service needs attention", then a Tinfoil repair-engine
// failure; it reconnected on its own. A self-healing outage reads as reconnecting, never as an alarm.
test('self-healing outages read as reconnecting, not an alarm', async () => {
  for (const id of ['gateway', 'shell', 'agent-service', 'hermes', 'disk']) {
    const h = setup({ fetch: async () => response({ checks: [{ id, label: id === 'agent-service' ? 'Agent Service' : id, ok: false, detail: 'Not running' }], overall: 'down' }) });
    const d = await h.api.diagnose(); assert.equal(d.layer, id);
    assert.equal(d.short, 'Reconnecting…'); assert.doesNotMatch(d.short, /needs attention/i);
  }
  const ping = setup({ fetch: async () => response({}, 503) }); assert.equal((await ping.api.diagnose()).short, 'Reconnecting…');
  const service = setup({ fetch: async () => response({ checks: [{ id: 'agent-service', label: 'Agent Service', ok: false }], overall: 'down' }) });
  assert.match((await service.api.diagnose()).message, /comes back on its own/);
  const signin = setup({ fetch: async () => response({ checks: [{ id: 'signin', label: 'Sign-in', ok: false }], overall: 'down' }) });
  assert.match((await signin.api.diagnose()).short, /Sign-in needs attention/);
  assert.equal(setup().api.failure().short, 'Reconnecting…');
});
test('repair-chat engine probes (Tinfoil, Claude, ChatGPT) never become the connection diagnosis', async () => {
  const checks = [{ id: 'agent-service', ok: true }, { id: 'reply-tinfoil', label: 'Tinfoil can answer repair chats', ok: false, detail: 'The Tinfoil app is not answering on this server.' }, { id: 'reply-claude', label: 'Claude can answer repair chats', ok: false }];
  const h = setup({ fetch: async () => response({ checks, overall: 'degraded', summary: 'Tinfoil can answer repair chats: The Tinfoil app is not answering on this server.' }) });
  const d = await h.api.diagnose(); assert.equal(d.layer, 'send');
  assert.doesNotMatch(d.message + d.short, /tinfoil|claude|repair/i);
  const both = setup({ fetch: async () => response({ checks: [...checks, { id: 'hermes', label: 'Hermes', ok: false }], overall: 'down' }) });
  assert.equal((await both.api.diagnose()).layer, 'hermes');
});
test('James: internet working + Tailscale disconnected + navigator.onLine=false opens real Troubleshooter immediately', async () => {
  const h = setup({ online: false, fetch: async url => { if (url.startsWith('https://')) return { type: 'opaque' }; throw Error('Tailscale disconnected'); } });
  h.ctx.WizOpenApp = id => { h.opened.push(id); return true; };
  assert.equal(h.api.open(), true);
  assert.deepEqual(h.opened, ['troubleshooter']); assert.equal(h.calls.length, 0, 'window opens before any network');
  assert.match(h.api.recoveryHtml(), /Connection help/); assert.doesNotMatch(h.api.recoveryHtml(), /src=/);
  const c = await h.api.checks(); assert.equal(c.internet.state, 'ok'); assert.equal(c.tailscale.state, 'bad');
  assert.match(c.help, /Internet works/); assert.match(c.help, /Tailscale app/);
  assert.doesNotMatch(c.help + JSON.stringify(c) + (await h.api.diagnose()).message, /device.{0,10}offline|no internet|Tailscale is disconnected/i);
});
test('public no-cors probe uses follow: browsers reject error/manual before the network, even for a 204', async () => {
  // Fetch Standard main-fetch: cross-origin no-cors requires redirect=follow.
  // Node/VM fetch doubles otherwise accept combinations that Chromium rejects.
  for (const detailed of [false, true]) {
    const h = setup({ online: false, fetch: async (url, options) => {
      if (url.startsWith('/')) throw Error('Private route down');
      if (options.mode === 'no-cors' && options.redirect !== 'follow') throw TypeError('Fetch rejects no-cors redirect mode');
      return { ok: false, status: 0, type: 'opaque' };
    } });
    const c = detailed ? await h.api.checks() : await h.api.diagnose();
    assert.match(detailed ? c.help : c.message, /Internet works/);
    if (detailed) assert.equal(c.internet.state, 'ok');
    const [, options] = h.calls.find(([url]) => url.startsWith('https:'));
    assert.equal(options.mode, 'no-cors'); assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'follow');
  }
});
test('checks: no internet, then Tailscale, then Wizard; each names its state and only the first failure is red', async () => {
  const run = async (opts) => { const h = setup(opts); return { c: await h.api.checks(), urls: h.calls.map(c => c[0]), h }; };
  // The device itself is offline: nothing crosses the network for the internet row.
  let r = await run({ online: false, fetch: async () => { throw Error('network'); } });
  assert.equal(r.c.internet.state, 'skip'); assert.equal(r.c.tailscale.state, 'bad'); assert.equal(r.c.wizard.state, 'wait');
  assert.deepEqual(r.urls, ['https://derp1.tailscale.com/generate_204', '/troubleshoot/api/ping']);
  // Internet works, Wizard's address doesn't answer: Tailscale (or the Wizard computer).
  r = await run({ fetch: async url => { if (url.startsWith('https://derp1.tailscale.com/')) return { ok: false, status: 0, type: 'opaque' }; throw Error('network'); } });
  assert.equal(r.c.internet.state, 'ok'); assert.equal(r.c.tailscale.state, 'bad'); assert.equal(r.c.wizard.state, 'wait'); assert.equal(r.c.tailnet, true);
  const net = r.h.calls.find(c => c[0].startsWith('https://'));
  assert.equal(net[0], 'https://derp1.tailscale.com/generate_204', 'the one cross-site request: Tailscale’s own connectivity check');
  assert.equal(net[1].mode, 'no-cors'); assert.equal(net[1].credentials, 'omit');
  // Reached but unhealthy: Wizard is red with the existing diagnosis.
  r = await run({ fetch: async url => url.startsWith('https://') ? { ok: false, type: 'opaque' } : response({ checks: [{ id: 'hermes', ok: false }], overall: 'down' }) });
  assert.equal(r.c.tailscale.state, 'ok'); assert.equal(r.c.wizard.state, 'bad'); assert.match(r.c.wizard.detail, /Hermes/);
  // Reached and healthy, even with the public check blocked: internet is skipped, never blamed.
  r = await run({ fetch: async url => { if (url.startsWith('https://')) throw Error('blocked'); return response(); } });
  assert.equal(r.c.internet.state, 'skip'); assert.equal(r.c.tailscale.state, 'ok'); assert.equal(r.c.wizard.state, 'ok');
});
test('checks: a slow link is timed and called slow, without a speed test', async () => {
  const h = setup({ fetch: async () => response() });
  h.ctx.navigator.connection = { effectiveType: '2g' };
  const c = await h.api.checks();
  assert.equal(c.tailscale.state, 'slow'); assert.match(c.tailscale.detail, /address answered/);
  assert.ok(h.calls.length <= 4, 'a handful of tiny requests (internet, ping, the existing diagnosis), no download');
});
test('late detailed checks are marked stale after newer successful evidence', async () => {
  let release, calls = 0;
  const h = setup({ fetch: async url => {
    if (url.endsWith('/ping') && ++calls === 1) return new Promise((_, reject) => { release = () => reject(Error('old failure')); });
    return response();
  } });
  const old = h.api.checks();
  assert.equal((await h.api.diagnose(0)).layer, 'send');
  release(); assert.equal((await old).stale, true);
  assert.equal((await h.api.diagnose()).layer, 'send');
});
test('late failed diagnosis cannot replace newer successful connection evidence', async () => {
  let release, calls = 0;
  const h = setup({ fetch: async url => {
    if (url.endsWith('/ping') && ++calls === 1) return new Promise((_, reject) => { release = () => reject(Error('old failure')); });
    return response();
  } });
  const old = h.api.diagnose();
  assert.equal((await h.api.diagnose(0)).layer, 'send');
  release(); await old;
  assert.equal((await h.api.diagnose()).layer, 'send');
});
test('a blocked public check is unknown even if the host answers with 502; it never masks service health', async () => {
  const h = setup({ online: false, fetch: async url => { if (url.startsWith('https:')) throw Error('CSP blocked'); return response({}, 502); } });
  const c = await h.api.checks();
  assert.equal(c.internet.state, 'skip'); assert.match(c.internet.detail, /Unknown/);
  assert.equal(c.hostReachable, true); assert.equal(c.tailscale.state, 'ok'); assert.equal(c.wizard.layer, 'gateway');
  assert.doesNotMatch(c.help, /device.*offline|Tailscale app/);
});
test('primary nginx policy and generator retain the narrow public probe allowlist', () => {
  const csp = readFileSync(new URL('../packaging/static.conf', import.meta.url), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1];
  assert.deepEqual(csp.match(/connect-src ([^;]+)/)[1].split(' '), ["'self'", 'blob:', 'data:', 'https://derp1.tailscale.com/generate_204']);
  assert.match(readFileSync(new URL('../packaging/entrypoint.sh', import.meta.url), 'utf8'), /cp \/etc\/wizard-shell\/static.conf \/tmp\/wizard-static.conf/);
});
test('Troubleshoot decides on a current diagnosis, not one from before the disconnect', async () => {
  let up = true;
  const h = setup({ hostname: 'wizard.example-tailnet.ts.net', fetch: async () => { if (!up) throw new TypeError('Load failed'); return response(); } });
  await h.api.diagnose();                 // a healthy diagnosis is cached
  up = false; h.advance(5000);            // the Wizard drops; the cache is still within its 10 s
  h.ctx.WizOpenApp = id => { h.opened.push(id); return true; };
  assert.equal(h.api.open(), true); assert.deepEqual(h.opened, ['troubleshooter']);
  assert.equal(h.calls.length, 2, 'opening never diagnoses, even with a stale cache');
  const fresh = setup({ fetch: () => new Promise(() => {}) });
  fresh.ctx.WizOpenApp = () => true;
  assert.equal(fresh.api.open(), true); assert.equal(fresh.calls.length, 0);
});
