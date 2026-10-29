import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/status.js', import.meta.url), 'utf8');
const failedProbe = async () => { throw new Error('probe unavailable'); };
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(online = true, fetch = failedProbe) {
  const events = {}, timers = new Map(), nodes = new Map();
  let tid = 0;
  const element = () => ({ classList: { toggle() {} }, dataset: {}, handlers: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(name, fn) { this.handlers[name] = fn; }, appendChild(el) { nodes.set(el.id, el); } });
  let clock = 1e6;
  const body = element();
  const L = { ok: false, at: 0, error: '', sessions: [], refreshes: 0, listeners: [], refresh() { this.refreshes++; }, onChange(fn) { this.listeners.push(fn); }, emit() { this.listeners.forEach(fn => fn()); } };
  const ctx = { navigator: { onLine: online }, document: { body, documentElement: element(), getElementById(id) { return nodes.get(id); }, createElement: element }, addEventListener(name, fn) { (events[name] ||= []).push(fn); }, setTimeout(fn) { timers.set(++tid, fn); return tid; }, clearTimeout(id) { timers.delete(id); }, setInterval() {}, AbortSignal: { timeout() { return {}; } }, fetch, console, Date: { now: () => clock } };
  ctx.window = ctx; ctx.WizLive = L;
  ctx.WizReach = { calls: 0, opened: 0, checked: 0, failure() { this.calls++; return { message: 'Wizard’s Agent Service isn’t responding.', short: 'Reconnecting…' }; }, open() { this.opened++; },
    async checks() { this.checked++; return { tailnet: true, internet: { state: 'ok', detail: 'Working · 80 ms' }, tailscale: { state: 'bad', detail: 'Can’t reach your Wizard' }, wizard: { state: 'wait', detail: 'Waiting for the connection' } }; } };
  ctx.WosOutbox = { waiting: false, retries: 0, listeners: [], unsent() { return this.waiting ? [{ state: 'waiting' }] : []; }, onChange(fn) { this.listeners.push(fn); }, retryAll() { this.retries++; } };
  vm.runInNewContext(source, ctx); ctx.WizCore.status.attach({});
  return { ctx, L, state: () => ctx.WizCore.status.state.net, event(name) { events[name].forEach(fn => fn()); }, success() { L.at++; L.ok = true; L.error = ''; L.emit(); }, settle() { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); },
    // The pop-up's grace: a failure must last this long before anything covers the screen.
    grace() { clock += 3100; const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); ctx.WizCore.status.refresh(); },
    pop: () => nodes.get('wxOffline'), banner: () => nodes.get('wxBanners'), clickPop(attr) { nodes.get('wxOffline').handlers.click({ target: { closest: sel => sel === attr } }); } };
}

test('fresh Wizard reads override a false offline flag at boot and remain online', () => {
  const h = setup(false); assert.equal(h.state(), 'offline');
  h.grace(); h.success(); assert.equal(h.state(), 'restored');
  h.settle(); h.L.emit(); assert.equal(h.state(), 'online');
  assert.equal(h.ctx.navigator.onLine, false);
});
test('offline event probes Wizard; cached and optimistic events cannot clear it', () => {
  const h = setup(); h.success();
  h.ctx.navigator.onLine = false; h.event('offline');
  assert.equal(h.L.refreshes, 1); assert.equal(h.state(), 'offline');
  h.L.emit(); assert.equal(h.state(), 'offline');
  h.grace(); h.success(); assert.equal(h.state(), 'restored');
  h.settle(); assert.equal(h.state(), 'online');
  h.event('offline'); h.L.emit(); assert.equal(h.state(), 'offline');
});
test('real network failure stays offline, recovery requires a fresh successful read', () => {
  const h = setup(); h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  h.L.error = 'offline'; h.L.emit(); assert.equal(h.state(), 'offline'); h.grace();
  h.ctx.navigator.onLine = true; h.event('online'); assert.equal(h.state(), 'reconnecting');
  h.success(); assert.equal(h.state(), 'restored'); h.settle(); assert.equal(h.state(), 'online');
});
test('server failure while browser is online still shows reconnecting', () => {
  const h = setup(); h.success(); h.L.error = 'offline'; h.L.emit();
  assert.equal(h.state(), 'reconnecting'); h.grace(); h.success(); assert.equal(h.state(), 'restored');
});
test('stale successful read never overrides a subsequent failed read', () => {
  const h = setup(false); h.success(); h.settle();
  h.L.error = 'offline'; h.L.emit(); assert.equal(h.state(), 'offline');
});
test('a short blip shows nothing and comes back silently', () => {
  const h = setup(); h.success();
  h.L.error = 'offline'; h.L.emit();
  assert.equal(h.state(), 'reconnecting');
  assert.equal(h.banner().hidden, true, 'no pill during the grace');
  assert.equal(h.pop(), undefined, 'no pop-up during the grace');
  h.success(); assert.equal(h.state(), 'online', 'no "Back online" for a blip nobody was told about');
  assert.equal(h.banner().hidden, true);
});
test('a lasting failure covers the screen with the three checks; X tucks it into a pill that brings it back', async () => {
  const h = setup(); h.success(); assert.equal(h.ctx.WizReach.calls, 0);
  h.L.error = 'offline'; h.L.emit(); h.grace();
  assert.equal(h.pop().hidden, false); assert.equal(h.pop().attrs['aria-modal'], 'true');
  assert.equal(h.ctx.WizCore.status.state.offline, 'open');
  await turn(); await turn();
  assert.equal(h.ctx.WizReach.checked, 1);
  const html = h.pop().innerHTML;
  assert.match(html, /Can’t reach your Wizard/); assert.match(html, /data-wxck="internet"/); assert.match(html, /data-wxck="tailscale"/); assert.match(html, /data-wxck="wizard"/);
  assert.match(html, /wx-ck bad" data-wxck="tailscale"/); assert.match(html, /Open the Tailscale app/);
  assert.match(html, /saved on this device still open/); assert.doesNotMatch(html, /data-wxoffhelp/, 'no Troubleshooter while it can’t load');
  assert.equal(h.ctx.WizCore.status.back(), 'offline', 'Back/Esc hides it');
  assert.equal(h.pop().hidden, true); assert.equal(h.ctx.WizCore.status.state.offline, 'pill');
  assert.match(h.banner().innerHTML, /data-wxnet="reconnecting"/); assert.match(h.banner().innerHTML, /data-wxoffopen/);
  h.banner().handlers.click({ target: { closest: sel => sel === '[data-wxoffopen]' } });
  assert.equal(h.pop().hidden, false, 'the pill brings the checks back');
  h.clickPop('[data-wxoffcheck]'); assert.equal(h.ctx.WosOutbox.retries, 1, 'Check again also retries saved messages');
  h.success(); h.settle();
  assert.equal(h.pop().hidden, true, 'recovery closes it by itself');
});
test('any Troubleshoot button while Wizard can’t be reached opens the same pop-up', () => {
  const h = setup(); h.success();
  h.ctx.dispatch = null; h.event('wizreachexplain');
  assert.equal(h.pop().hidden, false);
});
test('a retryable saved message never turns healthy chat reads into a connection warning', () => {
  const h = setup(); h.success(); const O = h.ctx.WosOutbox;
  O.canRetry = () => true; O.waiting = true; O.listeners.forEach(fn => fn());
  assert.equal(h.state(), 'online');
  assert.equal(h.ctx.document.getElementById('wxBanners').hidden, true);
  assert.equal(h.ctx.WizReach.calls, 0, 'a healthy connection does not start failure probes');
  assert.equal(O.waiting, true, 'the saved message is not dismissed, sent or otherwise changed');
  assert.equal(O.retries, 0, 'rendering never replays a saved message');
  O.waiting = false; O.listeners.forEach(fn => fn());
  assert.equal(h.ctx.document.getElementById('wxBanners').hidden, true);
});
test('connection failure still warns with a saved message, until fresh recovery evidence', () => {
  const h = setup(); h.success(); const O = h.ctx.WosOutbox;
  O.waiting = true; O.canRetry = () => false; O.listeners.forEach(fn => fn());
  assert.equal(h.ctx.document.getElementById('wxBanners').hidden, true);
  h.L.error = 'offline'; h.L.emit(); h.grace(); h.ctx.WizCore.status.back();
  assert.match(h.ctx.document.getElementById('wxBanners').innerHTML, /data-wxnet="reconnecting"/);
  O.canRetry = () => true; O.listeners.forEach(fn => fn());
  assert.match(h.ctx.document.getElementById('wxBanners').innerHTML, /data-wxnet="reconnecting"/);
  h.success(); h.settle();
  assert.equal(h.ctx.document.getElementById('wxBanners').hidden, true);
  assert.equal(O.waiting, true, 'connection recovery does not discard the saved message');
});
test('Retry queues a fresh verification when a stale degraded probe is still in flight', async () => {
  let calls = 0, resolveFirst;
  const fetch = () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ overall: 'ok' }) });
  };
  const h = setup(true, fetch); h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  assert.equal(calls, 1); assert.equal(h.state(), 'offline');
  h.grace(); h.clickPop('[data-wxoffcheck]');
  assert.equal(calls, 1);
  resolveFirst({ ok: true, json: async () => ({ overall: 'degraded' }) });
  await turn(); await turn();
  assert.equal(calls, 2); assert.equal(h.state(), 'restored');
});
test('a probe from before a newer offline event cannot clear the newer failure', async () => {
  let calls = 0, resolveProbe;
  const fetch = () => { calls++; return new Promise(resolve => { resolveProbe = resolve; }); };
  const h = setup(true, fetch); h.success(); h.ctx.navigator.onLine = false;
  h.event('offline'); h.event('offline');
  resolveProbe({ ok: true, json: async () => ({ overall: 'ok' }) });
  await turn(); await turn();
  assert.equal(calls, 1); assert.equal(h.state(), 'offline');
});
test('a probe from before a newer failed live read cannot hide that failure', async () => {
  let calls = 0, resolveProbe;
  const fetch = () => { calls++; return new Promise(resolve => { resolveProbe = resolve; }); };
  const h = setup(true, fetch); h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  h.ctx.navigator.onLine = true;
  // Like web/live.js: a failed read sets errorAt and leaves `at` (last success) unchanged.
  h.L.errorAt = Date.now() + 1; h.L.ok = false; h.L.error = 'offline'; h.L.emit();
  assert.equal(h.state(), 'reconnecting');
  resolveProbe({ ok: true, json: async () => ({ overall: 'ok' }) });
  await turn(); await turn();
  assert.equal(calls, 1); assert.equal(h.state(), 'reconnecting');
});
test('live.js stamps failed reads so status can order them against probes', () => {
  const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
  assert.match(live, /this\.error = e\.status === 403 \? 'access' : 'offline'; this\.errorAt = Date\.now\(\);/);
});
test('a healthy probe survives later non-network live emits while the browser still says offline', async () => {
  const fetch = async () => ({ ok: true, json: async () => ({ overall: 'ok' }) });
  const h = setup(true, fetch); h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  await turn(); await turn();
  assert.equal(h.state(), 'online', 'verified inside the grace: nobody was told, so no Back online');
  h.L.emit(); // e.g. a thread marked read; no new read, no failure
  assert.equal(h.state(), 'online');
  h.event('offline'); // a genuinely newer offline event still wins
  assert.equal(h.state(), 'offline');
});
test('the probe works without AbortSignal.timeout (iOS 16.0-16.3)', async () => {
  let opts;
  const fetch = async (url, o) => { opts = o; return { ok: true, json: async () => ({ overall: 'ok' }) }; };
  const h = setup(true, fetch); delete h.ctx.AbortSignal;
  h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  await turn(); await turn();
  assert.ok(opts); assert.equal(h.state(), 'online');
});
