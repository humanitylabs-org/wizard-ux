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
