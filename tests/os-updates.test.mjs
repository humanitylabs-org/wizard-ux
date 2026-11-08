// Settings → Updates (Automatic / Ask me, For testers / For everyone, installed vs latest, Update now) over the App Manager's owner-only
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
const STATUS = { mode: 'auto', always_auto: true, chosen: false, installed: '0.3.15', latest: '0.3.16', update_available: true, unpinned: false, checked: true, installing: false };

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
  assert.doesNotMatch(h, /data-osu="(?:auto|ask)"|Ask me|role="radiogroup" aria-label="Updates"/, 'no Automatic / Ask me choice on an always_auto App Manager');
  assert.match(h, /<div class="osu-sec" data-osu-auto><span class="osu-lbl">Updates<\/span><p class="st-hint">Install by themselves overnight, never during a chat\.<\/p><\/div>/);
});

test('up to date shows installed version and no Update button; a saved Ask me is ignored when updates are always automatic', async () => {
  const { U } = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, latest: '0.3.15', update_available: false }]);
  const h = U.html();
  assert.equal(U.card(), null); assert.equal(U.cardHtml(), '', 'nothing to do: no card');
  assert.match(h, /<b data-osu-title>Wizard OS \(server\) 0\.3\.15<\/b><\/span><span class="st-val">Up to date<\/span>/, 'a quiet value, not an Up to date pill');
  assert.doesNotMatch(h, /data-osu="apply"|osu-card|data-osu="(?:auto|ask)"|Ask me/);
  assert.match(h, /Install by themselves overnight/);
});

test('Automatic / Ask me is back (wizard-app-manager#483): Ask me never installs by itself, Install still works', async () => {
  let state = { ...STATUS, always_auto: undefined, mode: 'ask', chosen: false };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    if (body.action) return [200, { ...state, started: true }];
    state = { ...state, mode: body.mode, chosen: true }; return [200, state];
  });
  const h = U.html();
  assert.match(h, /<div class="osu-sec" data-osu-auto><span class="osu-lbl">Updates<\/span><div class="st-seg" role="radiogroup" aria-label="Updates"><button type="button" data-osu="auto" role="radio" aria-checked="false" >Automatic<\/button><button type="button" data-osu="ask" role="radio" aria-checked="true" >Ask me<\/button><\/div><p class="st-hint">Nothing installs until you tap Install\.<\/p><\/div>/);
  assert.doesNotMatch(h, /Turn on automatic updates/);
  assert.match(U.cardHtml(), /<b data-osu-title>Wizard OS update<\/b><span>Takes 10–20 minutes<\/span>[^]*>Install<\/button>/, 'Ask me shows the new version and an Install button, never "tonight"');
  assert.doesNotMatch(U.cardHtml(), /tonight/);
  const c = ctx();
  assert.equal(U.act(btn('auto'), c), true); await tick(); await tick();
  assert.deepEqual(calls.filter(x => x.method === 'POST').at(-1).body, { mode: 'auto' });
  assert.deepEqual(c.t.at(-1), ['✓', 'Updates: Automatic', 1800]);
  assert.match(U.html(), /data-osu="auto" role="radio" aria-checked="true" >Automatic<[^]*Install by themselves overnight, never during a chat\./);
  assert.match(U.cardHtml(), /Installs tonight when it’s quiet[^]*>Install now<\/button>/);
  assert.equal(U.act(btn('ask'), c), true); await tick(); await tick();
  assert.deepEqual(calls.filter(x => x.method === 'POST').at(-1).body, { mode: 'ask' }, 'Ask me is sent again');
  assert.deepEqual(c.t.at(-1), ['✓', 'Updates: Ask me', 1800]);
  const posts = calls.filter(x => x.method === 'POST').length;
  assert.equal(U.act(btn('ask'), c), true); await tick();
  assert.equal(calls.filter(x => x.method === 'POST').length, posts, 'tapping the chosen option again sends nothing');
  assert.equal(U.act(btn('apply'), c), true); await tick(); await tick();
  assert.deepEqual(calls.filter(x => x.method === 'POST').at(-1).body, { action: 'apply' }, 'Install still installs on Ask me');
});

test('an App Manager that reports always_auto (0.3.107) shows no Ask me, because it would not keep it', async () => {
  const { U, calls } = await load(() => [200, { ...STATUS, mode: 'auto', chosen: true }]);
  assert.doesNotMatch(U.html(), /data-osu="(?:auto|ask)"|Ask me/);
  const c = ctx();
  for (const what of ['ask', 'auto']) assert.equal(U.act(btn(what), c), true);
  await tick();
  assert.equal(calls.filter(x => x.method === 'POST').length, 0);
});

test('an unpinned box says it is updated by hand and offers no Update', async () => {
  const { U } = await load(() => [200, { ...STATUS, installed: null, update_available: false, unpinned: true }]);
  const h = U.html();
  assert.match(h, /Updated by hand/);
  assert.doesNotMatch(h, /data-osu="apply"/);
});

test('unavailable App Manager route stays visible without unverified install/policy controls', async () => {
  for (const reply of [() => [404, { error: 'no install for that app' }], () => [403, { error: 'owner only' }], () => { throw new Error('offline'); }]) {
    const { U, registered } = await load(reply);
    assert.match(U.html(), /could not be verified/);
    assert.match(U.html(), /data-osu="retry"/);
    assert.doesNotMatch(U.html(), /data-osu="(?:auto|ask|apply)"/);
    assert.equal(registered[0].available(), true);
  }
});

test('Install now POSTs the exact body with the Store headers; never force, never a mode', async () => {
  let state = { ...STATUS };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    return [200, { ...state, started: true }];
  });
  const c = ctx();
  for (const what of ['ask', 'auto']) assert.equal(U.act(btn(what), c), true);
  await tick(); await tick();
  assert.equal(calls.filter(x => x.method === 'POST').length, 0, 'no mode is ever sent when updates are always automatic');
  assert.equal(U.act(btn('apply'), c), true);
  await tick(); await tick();
  const apply = calls.filter(x => x.method === 'POST').at(-1);
  assert.deepEqual(apply.body, { action: 'apply' });
  assert.equal(apply.headers['X-Wizard-Store'], '1');
  assert.equal(apply.headers['Content-Type'], 'application/json');
  assert.equal(U.state.installing, true);
  assert.match(U.html(), /data-osu-card="building"[^]*<b data-osu-title>Updating Wizard OS…<\/b>/);
  assert.match(U.html(), /data-osu="apply" disabled>Install now</, 'same card, button disabled while it runs');
  assert.ok(!calls.some(x => x.body && 'force' in x.body));
});

test('a refused write keeps the old state and tells the owner', async () => {
  const { U } = await load((method) => method === 'GET' ? [200, STATUS] : [403, { error: 'only the box owner can install from the Store' }]);
  const c = ctx();
  U.act(btn('apply'), c);
  await tick(); await tick();
  assert.equal(U.state.installing, false);
  assert.deepEqual(c.t.at(-1), ['!', 'only the box owner can install from the Store', 2600]);
});

test('an update cut short by a reboot says interrupted, retrying, and offers Update now again', async () => {
  const { U } = await load(() => [200, { ...STATUS, installing: false, interrupted: true }]);
  const h = U.html();
  assert.match(h, /data-osu-card="failed"[^]*<b data-osu-title>Wizard OS update didn’t finish<\/b><span>Tries again tonight<\/span>/);
  assert.match(h, /data-osu="apply" >Try again</);
  const ask = await load(() => [200, { ...STATUS, always_auto: undefined, mode: 'ask', chosen: true, interrupted: true }]);
  assert.match(ask.U.html(), /<b data-osu-title>Wizard OS update didn’t finish<\/b>[^]*>Try again</);
  const old = await load(() => [200, { ...STATUS }]);              // an App Manager without the field: unchanged
  assert.match(old.U.html(), /<b data-osu-title>Wizard OS update<\/b>/);
});

test('channel picker: hidden on an App Manager without channels; For testers / For everyone, ids unchanged', async () => {
  const old = await load(() => [200, STATUS]);
  assert.doesNotMatch(old.U.html(), /Release channel/);
  const { U } = await load(() => [200, { ...STATUS, channel: 'stable', stable: '0.3.16' }]);
  const h = U.html();
  assert.match(h, /<div class="st-seg" role="radiogroup" aria-label="Release channel"><button type="button" data-osu="ch-latest" role="radio" aria-checked="false" >For testers<\/button><button type="button" data-osu="ch-stable" role="radio" aria-checked="true" >For everyone<\/button>/);
  assert.match(h, /Releases testers have used for about 3 days\./);
  assert.doesNotMatch(h, />(?:Stable|Latest)</, 'the old channel names are gone from the screen');
});

test('For testers on an App Manager with Automatic / Ask me (no always_auto) carries no "only For everyone" caveat', async () => {
  const { U } = await load(() => [200, { ...STATUS, always_auto: undefined, channel: 'latest', stable: '0.3.16' }]);
  assert.match(U.html(), /Every new release as soon as it’s out\. Try new features in Appearance\.<\/p>/);
  assert.doesNotMatch(U.html(), /only for For everyone/);
});

test('choosing For testers POSTs only {channel: "latest"} and says For testers', async () => {
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
  assert.match(U.html(), /<p class="st-hint">Every new release as soon as it’s out\. Try new features in Appearance\.<\/p>/);
  assert.deepEqual(c.t[0].slice(0, 2), ['✓', 'Channel: For testers']);
  const n = calls.length;
  U.act(btn('ch-latest'), ctx()); await tick();
  assert.equal(calls.length, n);   // re-tapping the current channel sends nothing
});

test('a release that only swaps the interface image says it takes about 2 minutes (App Manager quick: true)', async () => {
  const { U } = await load((m, b) => m === 'POST' ? [200, { ...STATUS, started: true, quick: true }] : [200, { ...STATUS, always_auto: undefined, mode: 'ask', chosen: true, quick: true }]);
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
    const { U } = await load((m) => m === 'POST' ? [200, { ...STATUS, started: true, quick }] : [200, { ...STATUS, always_auto: undefined, mode: 'ask', chosen: true, quick }]);
    assert.match(U.cardHtml(), /<span>Takes 10–20 minutes<\/span>/);
    const c = ctx();
    U.act(btn('apply'), c);
    await tick(); await tick();
    assert.deepEqual(c.t[0].slice(0, 2), ['↻', 'Updating Wizard OS · takes 10–20 minutes']);
    assert.equal(U.card().line, 'Takes 10–20 minutes · Wizard reconnects by itself');
  }
});

test('the App Manager decides at Install time: a quick:false reply keeps the long words even if the check said quick', async () => {
  const { U } = await load((m) => m === 'POST' ? [200, { ...STATUS, started: true, quick: false }] : [200, { ...STATUS, always_auto: undefined, mode: 'ask', chosen: true, quick: true }]);
  const c = ctx();
  U.act(btn('apply'), c);
  await tick(); await tick();
  assert.deepEqual(c.t[0].slice(0, 2), ['↻', 'Updating Wizard OS · takes 10–20 minutes']);
});
