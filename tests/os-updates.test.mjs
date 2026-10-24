// Settings → Updates (Automatic / Ask me, installed vs latest, Update now) over the App Manager's owner-only
// store-install listener, the same path and headers as the Store's Get.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

async function load(reply) {
  const calls = [], registered = [];
  let refreshes = 0;
  const fetch = async (url, opts = {}) => {
    calls.push({ url, ...opts, body: opts.body && JSON.parse(opts.body) });
    const [status, body] = reply(opts.method || 'GET', opts.body && JSON.parse(opts.body));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const window = { WosSettings: { register: f => registered.push(f), refresh: () => refreshes++ } };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
  await tick(); await tick();
  return { U: window.WosUpdates, calls, registered, refreshes: () => refreshes };
}
const btn = osu => ({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu } } : null) });
const ctx = () => { const t = []; return { t, toast: (...a) => t.push(a), render() {}, haptic() {} }; };
const STATUS = { mode: 'auto', chosen: false, installed: '0.3.15', latest: '0.3.16', update_available: true, unpinned: false, checked: true, installing: false };

test('reads the App Manager through the Store listener and registers one Settings group', async () => {
  const { U, calls, registered } = await load(() => [200, STATUS]);
  assert.equal(calls[0].url, 'https://box.ts.net/wizard-os-home/store-install/_updates');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'updates');
  assert.equal(registered[0].available(), true);
  const h = U.html();
  assert.match(h, /<h4>Updates<\/h4>/);
  assert.match(h, /<b data-osu-title>Update available<\/b><small>Wizard OS 0\.3\.15 → 0\.3\.16<\/small>/);
  assert.match(h, /data-osu="apply"[^>]*>Update now</);
  assert.match(h, /data-osu="auto" role="radio" aria-checked="true"/);   // Automatic is the default
  assert.match(h, /data-osu="ask" role="radio" aria-checked="false"/);
});

test('up to date shows installed version and no Update button; Ask me is shown when chosen', async () => {
  const { U } = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, latest: '0.3.15', update_available: false }]);
  const h = U.html();
  assert.match(h, /Wizard OS 0\.3\.15<\/b><small>Up to date/);
  assert.doesNotMatch(h, /data-osu="apply"/);
  assert.match(h, /data-osu="ask" role="radio" aria-checked="true"/);
});

test('an unpinned box says it is updated by hand and offers no Update', async () => {
  const { U } = await load(() => [200, { ...STATUS, installed: null, update_available: false, unpinned: true }]);
  const h = U.html();
  assert.match(h, /Updated by hand/);
  assert.doesNotMatch(h, /data-osu="apply"/);
});

test('hidden when the App Manager has no updates route (older box or no Serve mount)', async () => {
  for (const reply of [() => [404, { error: 'no install for that app' }], () => [403, { error: 'owner only' }], () => { throw new Error('offline'); }]) {
    const { U, registered } = await load(reply);
    assert.equal(U.html(), '');
    assert.equal(registered[0].available(), false);
  }
});

test('choosing a mode and Update now POST the exact bodies with the Store headers; never force', async () => {
  let state = { ...STATUS };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    if (body.mode) { state = { ...state, mode: body.mode, chosen: true }; return [200, state]; }
    return [200, { ...state, started: true }];
  });
  const c = ctx();
  assert.equal(U.act(btn('ask'), c), true);
  await tick(); await tick();
  const post = calls.find(x => x.method === 'POST');
  assert.deepEqual(post.body, { mode: 'ask' });
  assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.equal(U.state.mode, 'ask');
  assert.deepEqual(c.t.at(-1), ['✓', 'Updates: Ask me', 1800]);
  assert.equal(U.act(btn('apply'), c), true);
  await tick(); await tick();
  const apply = calls.filter(x => x.method === 'POST').at(-1);
  assert.deepEqual(apply.body, { action: 'apply' });
  assert.equal(U.state.installing, true);
  assert.match(U.html(), /Updating…/);
  assert.doesNotMatch(U.html(), /data-osu="apply"/);
  assert.ok(!calls.some(x => x.body && 'force' in x.body));
});

test('a refused write keeps the old state and tells the owner', async () => {
  const { U } = await load((method) => method === 'GET' ? [200, STATUS] : [403, { error: 'only the box owner can install from the Store' }]);
  const c = ctx();
  U.act(btn('ask'), c);
  await tick(); await tick();
  assert.equal(U.state.mode, 'auto');
  assert.deepEqual(c.t.at(-1), ['!', 'only the box owner can install from the Store', 2600]);
});

test('an update cut short by a reboot says interrupted, retrying, and offers Update now again', async () => {
  const { U } = await load(() => [200, { ...STATUS, installing: false, interrupted: true }]);
  const h = U.html();
  assert.match(h, /<b data-osu-title>Update interrupted · retrying<\/b><small>Wizard OS 0\.3\.15 → 0\.3\.16 · tries again tonight, or tap Update now/);
  assert.match(h, /data-osu="apply"[^>]*>Update now</);
  const ask = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, interrupted: true }]);
  assert.match(ask.U.html(), /<b data-osu-title>Update interrupted<\/b><small>[^<]*tap Update now to try again/);
  const old = await load(() => [200, { ...STATUS }]);              // an App Manager without the field: unchanged
  assert.match(old.U.html(), /<b data-osu-title>Update available<\/b>/);
});

test('channel picker: hidden on an App Manager without channels, shown with Stable checked when it has them', async () => {
  const old = await load(() => [200, STATUS]);
  assert.doesNotMatch(old.U.html(), /Release channel/);
  const { U } = await load(() => [200, { ...STATUS, channel: 'stable', stable: '0.3.16' }]);
  const h = U.html();
  assert.match(h, /data-osu="ch-stable" role="radio" aria-checked="true"/);
  assert.match(h, /Stable \(recommended\)/);
  assert.match(h, /Latest \(every release, for testers\)/);
});

test('on latest with Automatic it says Automatic installs stable only; choosing a channel POSTs only {channel}', async () => {
  let state = { ...STATUS, channel: 'stable', stable: '0.3.16' };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    state = { ...state, channel: body.channel, latest: '0.3.17' }; return [200, { channel: body.channel, ...state }];
  });
  const c = ctx();
  assert.equal(U.act(btn('ch-latest'), c), true);
  await tick(); await tick();
  const post = calls.find(x => x.method === 'POST');
  assert.deepEqual(post.body, { channel: 'latest' });
  assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.equal(U.state.channel, 'latest');
  assert.match(U.html(), /data-osu="ch-latest" role="radio" aria-checked="true"/);
  assert.match(U.html(), /Automatic installs stable only/);
  assert.match(c.t[0][1], /Channel: Latest/);
  const n = calls.length;
  U.act(btn('ch-latest'), ctx()); await tick();
  assert.equal(calls.length, n);   // re-tapping the current channel sends nothing
});

test('my release: the summary names it and its base, and Your changes lists each change', async () => {
  const MINE = { name: "Miguel's release", base: { ref: 'b79c1e9', label: 'Latest b79c1e9' }, changes: [{ sha: 'abc1234', title: 'Updates shows my release', status: 'Mine', date: '2026-10-24' }] };
  const { U, calls } = await load((m, b) => [200, STATUS]);
  assert.equal(calls[0].url, 'https://box.ts.net/wizard-os-home/store-install/_updates');
  assert.equal(calls[1].url, 'https://box.ts.net/wizard-os-home/my-release.json');
  assert.doesNotMatch(U.html(), /Your changes/);                       // no my-release.json: nothing new
  const r2 = await (async () => {
    const calls = [], registered = [];
    const fetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => url.endsWith('my-release.json') ? MINE : STATUS }; };
    const window = { WosSettings: { register: f => registered.push(f), refresh() {} } };
    const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
    new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
    for (let i = 0; i < 4; i++) await tick();
    return window.WosUpdates;
  })();
  let h = r2.html();
  assert.match(h, /<b data-osu-title>Miguel&#39;s release<\/b><small>Built on Latest b79c1e9 · 1 change of your own/);
  assert.match(h, /data-osu="mine"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(h, /Updates shows my release/);
  assert.equal(r2.act(btn('mine'), ctx()), true);
  h = r2.html();
  assert.match(h, /data-osu-change="abc1234"[\s\S]*Updates shows my release[\s\S]*Mine · 2026-10-24/);
});
