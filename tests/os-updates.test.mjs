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
    const [status, body] = await reply(opts.method || 'GET', opts.body && JSON.parse(opts.body));
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
const APPS = { app_mode: 'auto', chosen: false, due: [{ id: 'notes' }], skipped: [{ id: 'my-app', skip: 'owner-source' }], last: { updated: [{ id: 'news' }] } };

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('an older background refresh cannot overwrite a confirmed app setting', async () => {
  const stale = deferred(); let reads = 0;
  const manual = { ...STATUS, apps: { ...APPS, app_mode: 'ask', chosen: true } };
  const { U } = await load(method => method === 'POST' ? [200, {}] : ++reads === 2 ? stale.promise : [200, reads > 2 ? manual : { ...STATUS, apps: APPS }]);
  const old = U.load(true); await tick();
  const c = ctx(); U.act(btn('apps-ask'), c);
  await tick(); await tick();
  stale.resolve([200, { ...STATUS, apps: APPS }]); await old; await tick(); await tick();
  assert.equal(U.state.apps.app_mode, 'ask');
  assert.equal(U.state.apps.chosen, true);
  assert.equal(c.t.at(-1)[0], '✓');
});

test('Update apps now remains busy across slow or failed status refresh', async () => {
  for (const response of [[200, { ...STATUS, apps: APPS }], [503, {}]]) {
    const refresh = deferred(); let reads = 0;
    const { U, calls } = await load(method => method === 'POST' ? [200, { started: true }] : ++reads === 1 ? [200, { ...STATUS, apps: APPS }] : refresh.promise);
    U.act(btn('apps-apply'), ctx()); await tick(); await tick();
    assert.match(U.html(), /data-osu="apps-apply" disabled/);
    U.act(btn('apps-apply'), ctx()); await tick();
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
    refresh.resolve(response); await tick(); await tick();
    if (response[0] !== 200) assert.match(U.html(), /data-osu="apps-apply" disabled/, 'unknown admission remains held until successful refresh');
  }
});

test('unknown source is not described as owner-modified', async () => {
  const { U } = await load(() => [200, { ...STATUS, apps: { ...APPS, skipped: [{ id: 'legacy', skip: 'source-unverified' }] } }]);
  assert.match(U.html(), /legacy \(can’t confirm it is unchanged yet\)/);
  assert.doesNotMatch(U.html(), /legacy \(your code needs review\)/);
});

test('app policy is visible, separately scoped, default is not called consent, and legacy boxes invent nothing', async () => {
  const { U } = await load(() => [200, { ...STATUS, mode: 'ask', apps: APPS }]);
  assert.match(U.html(), /Wizard OS updates/);
  assert.match(U.html(), /App updates/);
  assert.match(U.html(), /Default: Automatic/);
  assert.match(U.html(), /Last updated: news/);
  assert.doesNotMatch(U.html(), /\[object Object\]/);
  assert.match(U.html(), /my-app \(your code needs review\)/);
  assert.match(U.html(), /data-osu="apps-auto" role="radio" aria-checked="true"/);
  const old = await load(() => [200, STATUS]);
  assert.doesNotMatch(old.U.html(), /apps-auto|apps-ask/);
});

test('manual app choice is read back and does not change system policy; Update apps now stays Manual', async () => {
  let state = { ...STATUS, apps: { ...APPS } };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    if (body.app_mode) { state = { ...state, apps: { ...state.apps, app_mode: body.app_mode, chosen: true } }; return [200, state]; }
    return [200, { started: true }];
  });
  const c = ctx();
  U.act(btn('apps-ask'), c);
  await tick(); await tick();
  assert.equal(U.state.apps.app_mode, 'ask');
  assert.equal(U.state.mode, 'auto');
  assert.deepEqual(c.t.at(-1), ['✓', 'Automatic app updates off', 1800]);
  assert.deepEqual(calls.filter(r => r.method === 'POST').at(-1).body, { app_mode: 'ask' });
  assert.equal(calls.at(-1).method, undefined, 'GET readback follows write');
  U.act(btn('apps-apply'), c);
  await tick(); await tick();
  assert.deepEqual(calls.filter(r => r.method === 'POST').at(-1).body, { action: 'apply-apps' });
  assert.equal(U.state.apps.app_mode, 'ask');
});

test('failed app policy readback never fabricates success or a chosen setting', async () => {
  for (const readback of [[503, {}], [200, { ...STATUS, apps: APPS }]]) {
    let reads = 0;
    const { U } = await load(method => method === 'GET' ? (++reads === 1 ? [200, { ...STATUS, apps: APPS }] : readback) : [200, {}]);
    const c = ctx();
    U.act(btn('apps-ask'), c);
    await tick(); await tick();
    assert.equal(U.state.apps.app_mode, 'auto');
    assert.equal(U.state.apps.chosen, false);
    assert.equal(c.t.at(-1)[0], '!');
    assert.match(c.t.at(-1)[1], /confirm the saved/);
  }
});

test('reads the App Manager through the Store listener and registers one Settings group', async () => {
  const { U, calls, registered } = await load(() => [200, STATUS]);
  assert.equal(calls[0].url, 'https://box.ts.net/wizard-os-home/store-install/_updates');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'updates');
  assert.equal(registered[0].available(), true);
  const h = U.html();
  assert.match(h, /<div class="osu-card" data-osu-card="behind" role="status"><div class="osu-tx"><b data-osu-title>Wizard OS update<\/b><span>Installs tonight when it’s quiet<\/span><\/div><button type="button" class="osu-go" data-osu="apply" >Install now<\/button>/);
  assert.equal(U.cardHtml(), U.card() && h.slice(h.indexOf('<div class="osu-card"'), h.indexOf('</button></div>') + 15), 'the page leads with the same card Settings puts on top');
  assert.match(h, /data-osu="auto" role="radio" aria-checked="true"/);   // Automatic is the default
  assert.match(h, /data-osu="ask" role="radio" aria-checked="false"/);
  assert.match(h, /<p class="st-hint">Overnight, never during a chat\.<\/p>/, 'one short line under the choice');
});

test('up to date shows installed version and no Update button; Ask me is shown when chosen', async () => {
  const { U } = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, latest: '0.3.15', update_available: false }]);
  const h = U.html();
  assert.equal(U.card(), null); assert.equal(U.cardHtml(), '', 'nothing to do: no card');
  assert.match(h, /<b data-osu-title>Wizard OS 0\.3\.15<\/b><\/span><span class="st-val">Up to date<\/span>/, 'a quiet value, not an Up to date pill');
  assert.doesNotMatch(h, /data-osu="apply"|osu-card/);
  assert.match(h, /data-osu="ask" role="radio" aria-checked="true"/);
  assert.match(h, /Nothing installs until you tap Install\./);
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
  assert.match(U.html(), /data-osu-card="building"[^]*<b data-osu-title>Updating Wizard OS…<\/b>/);
  assert.match(U.html(), /data-osu="apply" disabled>Install</, 'same card, button disabled while it runs');
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
  assert.match(h, /data-osu-card="failed"[^]*<b data-osu-title>Wizard OS update didn’t finish<\/b><span>Tries again tonight<\/span>/);
  assert.match(h, /data-osu="apply" >Try again</);
  const ask = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, interrupted: true }]);
  assert.match(ask.U.html(), /<b data-osu-title>Wizard OS update didn’t finish<\/b>[^]*>Try again</);
  const old = await load(() => [200, { ...STATUS }]);              // an App Manager without the field: unchanged
  assert.match(old.U.html(), /<b data-osu-title>Wizard OS update<\/b>/);
});

test('channel picker: hidden on an App Manager without channels, shown with Stable checked when it has them', async () => {
  const old = await load(() => [200, STATUS]);
  assert.doesNotMatch(old.U.html(), /Release channel/);
  const { U } = await load(() => [200, { ...STATUS, channel: 'stable', stable: '0.3.16' }]);
  const h = U.html();
  assert.match(h, /<div class="st-seg" role="radiogroup" aria-label="Release channel"><button type="button" data-osu="ch-stable" role="radio" aria-checked="true" >Stable<\/button><button type="button" data-osu="ch-latest" role="radio" aria-checked="false" >Latest<\/button>/);
  assert.match(h, /Tested releases only\./);
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
  assert.match(U.html(), /Every release, for testers\. Automatic installs Stable only\./);
  assert.match(c.t[0][1], /Channel: Latest/);
  const n = calls.length;
  U.act(btn('ch-latest'), ctx()); await tick();
  assert.equal(calls.length, n);   // re-tapping the current channel sends nothing
});

test('a release that only swaps the interface image says it takes about 2 minutes (App Manager quick: true)', async () => {
  const { U } = await load((m, b) => m === 'POST' ? [200, { ...STATUS, started: true, quick: true }] : [200, { ...STATUS, mode: 'ask', chosen: true, quick: true }]);
  assert.match(U.cardHtml(), /<b data-osu-title>Wizard OS update<\/b><span>Takes about 2 minutes<\/span>[^]*>Install<\/button>/);
  const c = ctx();
  U.act(btn('apply'), c);
  await tick(); await tick();
  assert.deepEqual(c.t[0].slice(0, 2), ['↻', 'Updating Wizard OS · takes about 2 minutes']);
  assert.equal(U.card().state, 'building');
  assert.equal(U.card().line, 'Takes about 2 minutes', 'no reconnect promise: only the interface restarts, then it offers Reload');
});

test('without quick (older App Managers, or the full installer) the 10–20 minute words stay', async () => {
  for (const quick of [undefined, false]) {
    const { U } = await load((m) => m === 'POST' ? [200, { ...STATUS, started: true, quick }] : [200, { ...STATUS, mode: 'ask', chosen: true, quick }]);
    assert.match(U.cardHtml(), /<span>Takes 10–20 minutes<\/span>/);
    const c = ctx();
    U.act(btn('apply'), c);
    await tick(); await tick();
    assert.deepEqual(c.t[0].slice(0, 2), ['↻', 'Updating Wizard OS · takes 10–20 minutes']);
    assert.equal(U.card().line, 'Takes 10–20 minutes · Wizard reconnects by itself');
  }
});

test('the App Manager decides at Install time: a quick:false reply keeps the long words even if the check said quick', async () => {
  const { U } = await load((m) => m === 'POST' ? [200, { ...STATUS, started: true, quick: false }] : [200, { ...STATUS, mode: 'ask', chosen: true, quick: true }]);
  const c = ctx();
  U.act(btn('apply'), c);
  await tick(); await tick();
  assert.deepEqual(c.t[0].slice(0, 2), ['↻', 'Updating Wizard OS · takes 10–20 minutes']);
});
