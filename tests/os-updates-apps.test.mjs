// Settings > About & updates > Apps (wizard-ux#1191), behind the off-by-default switch wizard/app-updates-list:
// each installed Wizard Store app with its installed version, the App Store's latest and a plain status, read from
// the Store's installed list (the same Runtipi list wizard-app-manager's app updater compares). Off: no request.
// Run: node --test tests/os-updates-apps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/core/os-updates.js');
const ID = 'wizard/app-updates-list';
const tick = () => new Promise(r => setTimeout(r, 0));
const STATUS = { mode: 'auto', chosen: true, installed: '0.3.15', latest: '0.3.15', update_available: false, unpinned: false, checked: true, installing: false };
const row = (id, version, latestVersion, extra = {}) => ({ info: { id, urn: `${id}:wizardapps`, name: extra.name || id }, app: { status: extra.status || 'running', version, ...(extra.ignoredVersion ? { ignoredVersion: extra.ignoredVersion } : {}) }, metadata: { latestVersion } });
const INSTALLED = { installed: [
  row('wizard-messenger', 93, 97, { name: 'Messenger' }),
  row('wizard-notes', 12, 12, { name: 'Notes' }),
  row('wizard-ux', 40, 41, { name: 'Wizard UX' }),
  row('wizard-music', 5, 6, { name: 'Music', ignoredVersion: 6 }),
  row('wizard-photos', 3, 4, { name: 'Photos', status: 'updating' }),
  { info: { id: 'other-app', urn: 'other-app:someone-else', name: 'Elsewhere' }, app: { status: 'running', version: 1 }, metadata: { latestVersion: 9 } },
  { info: { id: 'Bad/Id', name: '<x>' }, app: { version: 1 }, metadata: { latestVersion: 2 } },
] };

async function load({ on, apps = () => [200, INSTALLED], updates = () => [200, STATUS], mgr = () => [404, { error: 'not found' }], hang = false, post = () => [200, {}] } = {}) {
  const calls = [], listeners = {}, posts = [];
  let refreshes = 0;
  const fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      posts.push({ url, body: JSON.parse(opts.body), headers: opts.headers, credentials: opts.credentials });
      const [status, body] = await post(JSON.parse(opts.body));
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }
    calls.push(url);
    if (hang && url.endsWith('/_app-updates')) return new Promise(() => {});
    const [status, body] = url.endsWith('/store-data/api/apps/installed') ? apps() : url.endsWith('/_app-updates') ? mgr() : updates();
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const window = { WosSettings: { register() {}, refresh: () => refreshes++ }, addEventListener: (t, f) => { listeners[t] = f; } };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' }, documentElement: { dataset: { tweaks: on ? `wizard/pin-buttons ${ID}` : 'wizard/pin-buttons' } } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
  await tick(); await tick();
  return { U: window.WosUpdates, calls, posts, document, listeners, refreshes: () => refreshes };
}

test('switch off: About & updates is unchanged and the apps list is never read', async () => {
  const { U, calls } = await load({ on: false });
  const h = U.html(); await tick(); await tick();
  assert.doesNotMatch(h, /data-osu-apps|>Apps</);
  assert.deepEqual(calls, ['https://box.ts.net/wizard-os-home/store-install/_updates']);
});

test('switch on: one read of the Store installed list, then every Wizard Store app with versions and status', async () => {
  const { U, calls } = await load({ on: true });
  assert.match(U.html(), /<div class="osu-sec" data-osu-apps><span class="osu-lbl">Apps<\/span><p class="st-note" role="status">Checking apps…<\/p><\/div>/);
  await tick(); await tick();
  assert.deepEqual(calls, ['https://box.ts.net/wizard-os-home/store-install/_updates', 'https://box.ts.net/wizard-os-home/store-install/_app-updates', 'https://box.ts.net/wizard-os-home/store-data/api/apps/installed']);
  const h = U.html();
  assert.match(h, /<div class="st-row static" data-osu-app="wizard-messenger" data-osu-app-state="ready"><span class="st-tx"><b>Messenger<\/b><span>Version 93 · latest 97<\/span><\/span><span class="st-val">Update ready<\/span><\/div>/);
  assert.match(h, /data-osu-app="wizard-notes" data-osu-app-state="current"><span class="st-tx"><b>Notes<\/b><span>Version 12<\/span><\/span><span class="st-val">Up to date</);
  assert.match(h, /data-osu-app="wizard-ux" data-osu-app-state="with-os">.*Updates with WizardOS</, 'system apps move with the release, as in the App Manager');
  assert.match(h, /data-osu-app="wizard-music" data-osu-app-state="skipped">.*This version skipped</);
  assert.match(h, /data-osu-app="wizard-photos" data-osu-app-state="busy">.*Updating…</);
  assert.doesNotMatch(h, /other-app|Elsewhere|Bad\/Id|&lt;x&gt;/, 'other stores and bad ids are left out');
  // Most urgent first: update ready, then busy, then the rest.
  assert.deepEqual([...h.matchAll(/data-osu-app="([^"]+)"/g)].map(m => m[1]), ['wizard-messenger', 'wizard-photos', 'wizard-music', 'wizard-ux', 'wizard-notes']);
  assert.match(h, /Installed version and the App Store’s latest, from the App Manager\./);
});

test('older App Manager without server update controls (404): the apps still show (Codex P2)', async () => {
  const { U, calls } = await load({ on: true, updates: () => [404, { error: 'not found' }] });
  assert.match(U.html(), /Update controls are not available on this Wizard\./);
  await U.loadApps();
  const h = U.html();
  assert.match(h, /Update controls are not available on this Wizard\.[\s\S]*data-osu-apps[\s\S]*data-osu-app="wizard-messenger" data-osu-app-state="ready"/);
  assert.equal(calls.filter(u => u.endsWith('/apps/installed')).length, 1);
});

test('appRows mirrors the App Manager comparison (latest > installed) and escapes names', async () => {
  const { U } = await load({ on: false });
  const rows = U.appRows({ installed: [row('a-app', '7', '7'), row('b-app', 7, 8, { name: '<b>B</b>' }), { info: { id: 'c-app' }, app: { version: 2 }, metadata: {} }] });
  assert.deepEqual(rows.map(r => [r.id, r.state, r.label]), [['b-app', 'ready', 'Update ready'], ['c-app', 'unknown', 'Couldn’t check'], ['a-app', 'current', 'Up to date']]);
  assert.equal(rows[0].name, '<b>B</b>');
});

test('a failed read says so plainly and keeps the last good list', async () => {
  let fail = true;
  const { U, calls } = await load({ on: true, apps: () => fail ? [502, { error: 'app_data_unavailable' }] : [200, INSTALLED] });
  U.html(); await U.loadApps();
  assert.match(U.html(), /data-osu-apps><span class="osu-lbl">Apps<\/span><p class="st-note" role="status">Couldn’t read the installed apps\.<\/p>/);
  U.html(); U.html(); await U.loadApps();
  assert.equal(calls.filter(u => u.endsWith('/apps/installed')).length, 1, 'a failed read is not retried on every repaint');
  fail = false; await U.loadApps(true);
  assert.match(U.html(), /data-osu-app="wizard-messenger"/);
  fail = true; await U.loadApps(true);
  const h = U.html();
  assert.match(h, /Couldn’t read the installed apps\. Showing the last check\./);
  assert.match(h, /data-osu-app="wizard-messenger"/);
});

test('turning the switch on repaints Settings and the list appears without a reload', async () => {
  const { U, document, listeners, refreshes, calls } = await load({ on: false });
  assert.equal(typeof listeners['wos:tweak-choice'], 'function');
  document.documentElement.dataset.tweaks = ID;
  const before = refreshes(); listeners['wos:tweak-choice']();
  assert.ok(refreshes() > before);
  U.html(); await tick(); await tick();
  assert.equal(calls.filter(u => u.endsWith('/apps/installed')).length, 1);
  assert.match(U.html(), /data-osu-app="wizard-messenger"/);
});

test('the switch is a catalogued tweak package, off by default', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(ID));
  assert.ok(!cat.defaults.includes(ID));
  assert.doesNotMatch(read('web/tweaks/wizard/profile.json'), /app-updates-list/);
  const m = JSON.parse(read('web/tweaks/wizard/app-updates-list/manifest.json'));
  assert.equal(m.id, ID); assert.equal(m.author, 'wizard'); assert.equal(m.apiVersion, 1);
  assert.match(read('web/tweaks/wizard/app-updates-list/tweak.css'), /html\[data-tweaks~="wizard\/app-updates-list"\]/);
});

// Slice 2: the App Manager's own app-update state (wizard-app-manager `_app-updates`, same switch).
const MGR = { app_mode: 'ask', holds: ['wizard-notes', 'wizard-music', 'wizard-photos-x'],
  failed: { 'wizard-messenger': { to: 97, at: 1762660000, reason: 'a container keeps restarting <b>' }, 'wizard-music': { to: 5, at: 1, reason: 'old' } },
  last: { at: '2026-11-09T04:31:07Z', updated: [], rolled_back: ['wizard-messenger'], failed: [] }, due: [], skipped: [] };

test('switch on with the App Manager state: failed with its reason, rolled back, held, mode and last run', async () => {
  const INST = { installed: [...INSTALLED.installed, row('wizard-maps', 2, 3, { name: 'Maps' })] };
  const { U } = await load({ on: true, apps: () => [200, INST], mgr: () => [200, { ...MGR, holds: ['wizard-maps', 'wizard-notes', 'wizard-messenger'] }] });
  await U.loadApps();
  const h = U.html();
  assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="failed"><span class="st-tx"><b>Messenger<\/b><span>Version 93 · latest 97<\/span><span data-osu-app-why>Version 97: a container keeps restarting &lt;b&gt;<\/span><\/span><span class="st-val">Rolled back<\/span>/);
  assert.match(h, /data-osu-app="wizard-maps" data-osu-app-state="held">.*<span class="st-val">Held</);
  assert.match(h, /data-osu-app="wizard-notes" data-osu-app-state="held">/, 'a hold shows while up to date too (Codex P2)');
  assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="failed">/, 'a failure wins over a hold');
  assert.match(h, /data-osu-app="wizard-music" data-osu-app-state="skipped">/, 'an old failure for another version is not this one');
  assert.match(h, /<p class="st-hint" data-osu-app-mode>App updates: Ask me · last run 2026-11-09 04:31 UTC<\/p>/);
  assert.deepEqual([...h.matchAll(/data-osu-app="([^"]+)"/g)].map(m => m[1]).slice(0, 3), ['wizard-messenger', 'wizard-photos', 'wizard-maps']);
});

test('failed but not rolled back reads Update failed; never run reads not run yet', async () => {
  const { U } = await load({ on: true, mgr: () => [200, { ...MGR, app_mode: 'auto', last: null }] });
  await U.loadApps();
  const h = U.html();
  assert.match(h, /data-osu-app-state="failed">.*<span class="st-val">Update failed</);
  assert.match(h, /App updates: Automatic, overnight · not run yet/);
});

test('older App Manager (404) or a bad answer: the list is as before, with no mode line', async () => {
  for (const mgr of [() => [404, { error: 'not found' }], () => [200, { app_mode: 'sometimes' }], () => { throw new Error('down'); }]) {
    const { U } = await load({ on: true, mgr });
    await U.loadApps();
    const h = U.html();
    assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="ready">/);
    assert.doesNotMatch(h, /data-osu-app-mode|data-osu-app-why/);
  }
});

test('switch off: the App Manager state is never read either', async () => {
  const { U, calls } = await load({ on: false, mgr: () => [200, MGR] });
  U.html(); await tick(); await tick();
  assert.ok(!calls.some(u => u.endsWith('/_app-updates')));
});

test('a hung App Manager answer never holds up the list (Codex P2)', async () => {
  const { U } = await load({ on: true, hang: true });
  const t = Date.now(); await U.loadApps();
  assert.ok(Date.now() - t < 6000);
  const h = U.html();
  assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="ready">/);
  assert.doesNotMatch(h, /data-osu-app-mode/);
});

// Slice 3: the buttons. Update now / Retry, Hold / Unhold and the app Automatic / Ask me choice, all POSTs to the
// App Manager's `_app-updates` route (wizard-app-manager#527), only while the switch is on and that route answered.
const tap = (U, osu, ctx = {}) => U.act({ closest: sel => sel === '[data-osu]' ? { dataset: { osu } } : null }, ctx);
const rowOf = (h, id) => (h.match(new RegExp(`<div class="st-row static" data-osu-app="${id}"[\\s\\S]*?</div>`)) || [''])[0];
const buttons = (h, id) => [...rowOf(h, id).matchAll(/<button type="button" data-osu="([^"]+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);

test('buttons per row: Retry for a failure, Update now when ready, Hold / Unhold, none for system or busy apps', async () => {
  const INST = { installed: [...INSTALLED.installed, row('wizard-maps', 2, 3, { name: 'Maps' }), row('wizard-chess', 4, 5, { name: 'Chess' })] };
  const { U } = await load({ on: true, apps: () => [200, INST], mgr: () => [200, { ...MGR, holds: ['wizard-notes', 'wizard-chess'] }] });
  await U.loadApps();
  const h = U.html();
  assert.deepEqual(buttons(h, 'wizard-messenger'), [['app-retry:wizard-messenger', 'Retry'], ['app-hold:wizard-messenger', 'Hold']]);
  assert.deepEqual(buttons(h, 'wizard-maps'), [['app-apply:wizard-maps', 'Update now'], ['app-hold:wizard-maps', 'Hold']]);
  assert.deepEqual(buttons(h, 'wizard-chess'), [['app-apply:wizard-chess', 'Update now'], ['app-unhold:wizard-chess', 'Unhold']], 'Update now overrides a hold, as `wam app-updates --apply <id>` does');
  assert.deepEqual(buttons(h, 'wizard-notes'), [['app-unhold:wizard-notes', 'Unhold']]);
  assert.deepEqual(buttons(h, 'wizard-ux'), [], 'system apps move with the WizardOS release');
  assert.deepEqual(buttons(h, 'wizard-photos'), [], 'nothing while Runtipi is busy with the app');
  assert.match(h, /<div class="st-seg" role="radiogroup" aria-label="App updates" data-osu-app-modes><button type="button" data-osu="app-mode:auto" role="radio" aria-checked="false">Automatic<\/button><button type="button" data-osu="app-mode:ask" role="radio" aria-checked="true">Ask me<\/button><\/div>/);
});

test('switch off, or an App Manager without the route: no buttons and no POST', async () => {
  for (const opts of [{ on: false, mgr: () => [200, MGR] }, { on: true }]) {
    const { U, posts } = await load(opts);
    await U.loadApps();
    const h = U.html();
    assert.doesNotMatch(h, /data-osu="app-|data-osu-app-modes|osu-app-acts/);
    for (const k of ['app-apply:wizard-messenger', 'app-retry:wizard-messenger', 'app-hold:wizard-notes', 'app-mode:auto']) assert.equal(tap(U, k), true);
    await tick(); await tick();
    assert.deepEqual(posts, []);
  }
});

test('Retry: one POST {action:"apply", app}, pending while it waits, then done and the row read again from GET', async () => {
  let answer; const toasts = [];
  const { U, posts, calls } = await load({ on: true, mgr: () => [200, MGR], post: () => new Promise(ok => { answer = ok; }) });
  await U.loadApps();
  const reads = calls.filter(u => u.endsWith('/_app-updates')).length;
  tap(U, 'app-retry:wizard-messenger', { toast: (...a) => toasts.push(a) });
  assert.deepEqual(posts.map(p => [p.url, p.body, p.headers['X-Wizard-Store'], p.credentials]), [['https://box.ts.net/wizard-os-home/store-install/_app-updates', { action: 'apply', app: 'wizard-messenger' }, '1', 'same-origin']]);
  let h = U.html();
  assert.match(rowOf(h, 'wizard-messenger'), /<button type="button" data-osu="app-retry:wizard-messenger" disabled aria-busy="true">Starting…<\/button>/);
  assert.match(rowOf(h, 'wizard-notes'), /data-osu="app-unhold:wizard-notes" disabled>/, 'one action at a time');
  tap(U, 'app-unhold:wizard-notes'); assert.equal(posts.length, 1);
  answer([200, { started: true }]); await tick(); await tick(); await tick(); await tick();
  h = U.html();
  assert.match(rowOf(h, 'wizard-messenger'), /<span data-osu-app-msg="done" role="status">Update started · Messenger<\/span>/);
  assert.match(rowOf(h, 'wizard-messenger'), /data-osu="app-retry:wizard-messenger">Retry</);
  assert.deepEqual(toasts, [['✓', 'Update started · Messenger', 2200]]);
  assert.ok(calls.filter(u => u.endsWith('/_app-updates')).length > reads, 'read again from GET');
});

test('the App Manager refuses: the row says so in its own words', async () => {
  const toasts = [];
  const { U } = await load({ on: true, mgr: () => [200, MGR], post: () => [409, { started: false, error: 'Failed to start transient service unit' }] });
  await U.loadApps();
  tap(U, 'app-apply:wizard-maps');   // not a row here: nothing is sent
  tap(U, 'app-retry:wizard-messenger', { toast: (...a) => toasts.push(a) });
  await tick(); await tick(); await tick();
  assert.match(rowOf(U.html(), 'wizard-messenger'), /<span data-osu-app-msg="failed" role="status">Failed to start transient service unit<\/span>/);
  assert.deepEqual(toasts, [['!', 'Failed to start transient service unit', 2600]]);
  // started:false with 200 is not a success either.
  const b = await load({ on: true, mgr: () => [200, MGR], post: () => [200, { started: false }] });
  await b.U.loadApps(); tap(b.U, 'app-retry:wizard-messenger'); await tick(); await tick(); await tick();
  assert.match(rowOf(b.U.html(), 'wizard-messenger'), /data-osu-app-msg="failed" role="status">The App Manager said 200</);
});

test('Hold and Unhold send {hold}/{unhold}; the row follows the App Manager on the next GET', async () => {
  let holds = [];
  const { U, posts } = await load({ on: true, mgr: () => [200, { ...MGR, failed: {}, last: null, holds }], post: b => { holds = b.hold ? [b.hold] : []; return [200, { holds }]; } });
  await U.loadApps();
  tap(U, 'app-hold:wizard-messenger'); await tick(); await tick(); await tick(); await tick(); await tick();
  assert.deepEqual(posts.at(-1).body, { hold: 'wizard-messenger' });
  let h = U.html();
  assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="held">/);
  assert.deepEqual(buttons(h, 'wizard-messenger'), [['app-apply:wizard-messenger', 'Update now'], ['app-unhold:wizard-messenger', 'Unhold']]);
  assert.match(rowOf(h, 'wizard-messenger'), /data-osu-app-msg="done" role="status">Held: updates skip this app until you unhold it</);
  tap(U, 'app-unhold:wizard-messenger'); await tick(); await tick(); await tick(); await tick(); await tick();
  assert.deepEqual(posts.at(-1).body, { unhold: 'wizard-messenger' });
  h = U.html();
  assert.match(h, /data-osu-app="wizard-messenger" data-osu-app-state="ready">/);
  assert.match(rowOf(h, 'wizard-messenger'), /Hold removed/);
});

test('the app Automatic / Ask me choice sends {mode}; the current choice sends nothing', async () => {
  let mode = 'ask';
  const { U, posts } = await load({ on: true, mgr: () => [200, { ...MGR, app_mode: mode }], post: b => { mode = b.mode; return [200, { chosen: true }]; } });
  await U.loadApps();
  tap(U, 'app-mode:ask'); tap(U, 'app-mode:sometimes'); await tick();
  assert.deepEqual(posts, []);
  tap(U, 'app-mode:auto');
  assert.match(U.html(), /data-osu="app-mode:auto" role="radio" aria-checked="false" disabled>/, 'pending while it waits');
  await tick(); await tick(); await tick(); await tick();
  assert.deepEqual(posts.map(p => p.body), [{ mode: 'auto' }]);
  const h = U.html();
  assert.match(h, /data-osu="app-mode:auto" role="radio" aria-checked="true">Automatic</);
  assert.match(h, /App updates: Automatic, overnight/);
});

test('a forged button for an app or action the row does not offer is never sent', async () => {
  const { U, posts } = await load({ on: true, mgr: () => [200, MGR] });
  await U.loadApps();
  for (const k of ['app-apply:wizard-ux', 'app-apply:wizard-photos', 'app-hold:other-app', 'app-apply:../x', 'app-delete:wizard-notes', 'app-unhold:wizard-maps']) tap(U, k);
  await tick(); await tick();
  assert.deepEqual(posts, []);
});
