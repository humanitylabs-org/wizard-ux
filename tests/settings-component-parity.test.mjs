// James/Robert: one Settings front end, truthful component versions, no hidden failed update connector.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root = process.env.QA_SETTINGS_SOURCE || new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const status = { mode: 'auto', chosen: true, installed: '0.3.15', latest: '0.3.16', checked: true, update_available: true, channel: 'stable' };
async function harness(reply = () => [200, status]) {
  const calls = [], s = { console, URL, Map, Set, Date, String, CSS: { escape: String }, navigator: { userAgent: 'Android fixture' }, location: { host: 'fixture.invalid' }, setTimeout, document: { activeElement: null, currentScript: { src: 'https://fixture.invalid/wizard-os-home/core/os-updates.js' } }, addEventListener() {} };
  s.window = s; s.WizCore = {}; s.WizBrand = { html: 'W' }; s.WizConfig = { agent: () => 'Fixture assistant' };
  s.WizWebUpdate = { firstObservedVersion: 'a'.repeat(40), version: 'v:' + 'b'.repeat(40) };
  s.fetch = async (url, options = {}) => { calls.push({ url, ...options }); const [code, body] = await reply(options.method || 'GET'); return { ok: code >= 200 && code < 300, status: code, json: async () => body }; };
  vm.runInNewContext(read('web/core/settings.js'), s);
  vm.runInNewContext(read('web/core/os-updates.js'), s);
  await tick(); await tick();
  const mounts = ['phone', 'desktop'].map(shell => {
    const root = { innerHTML: '', scrollTop: 0, classList: { add() {} }, dataset: {}, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
    return { root, view: s.WosSettings.mount(root, { shell, helpSub: 'Input adapter fixture', live: { ok: true } }) };
  });
  return { s, calls, mounts };
}
test('every reachable category has identical registered page content with the same capabilities', async () => {
  const { mounts } = await harness();
  const menus = mounts.map(({root}) => [...root.innerHTML.matchAll(/data-st-page="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual(menus[0], menus[1]); assert.ok(menus[0].includes('about'));
  for (const page of menus[0]) {
    const content = mounts.map(({root,view}) => { view.focus(page); assert.equal(view.page, page); return root.innerHTML.slice(root.innerHTML.indexOf('<header class="st-page-head">')); });
    assert.equal(content[0], content[1], page);
    for (const {view} of mounts) { assert.equal(view.back(), true); assert.equal(view.page, ''); }
  }
});
test('desktop and phone show first-observed interface revision and installed server versions even when an update is ready', async () => {
  const { mounts } = await harness();
  for (const {root,view} of mounts) {
    view.focus('updates');
    assert.match(root.innerHTML, /<details data-settings-technical><summary>Technical details<\/summary>/);
    assert.match(root.innerHTML, /Interface revision at first check<\/b><small title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">aaaaaaaa<\/small>/);
    assert.match(root.innerHTML, /data-settings-observed-full[^>]*>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.doesNotMatch(root.innerHTML, /<details data-settings-technical open|code this document loaded|the Android app update separately/);
    assert.match(root.innerHTML, /Wizard OS \(server\) 0\.3\.15/);
    assert.doesNotMatch(root.innerHTML, /data-settings-observed-full[^>]*>bbbb/);
    assert.match(root.innerHTML, /data-osu-auto/); assert.match(root.innerHTML, /data-osu="auto"[^>]*>Automatic<\/button><button type="button" data-osu="ask"[^>]*>Ask me</, 'Automatic / Ask me in both shells (wizard-app-manager#483)'); assert.match(root.innerHTML, /data-osu="ch-latest"[^>]*>For testers</);
  }
});
test('native data is rendered by the same registered About owner, never a shell-specific markup callback', async () => {
  const { s, mounts } = await harness();
  assert.doesNotMatch(read('web/device.js'), /settingsHtml\(/);
  assert.match(read('web/device.js'), /settingsState\(/);
  s.WosDevice = { settingsState: () => ({ installed: '0.10.23', notificationsAllowed: true, updateDescription: 'Up to date' }) };
  for (const {root,view} of mounts) {
    view.focus('about');
    assert.match(root.innerHTML, /Phone app \(Android\) 0\.10\.23/);
    assert.match(root.innerHTML, /Wizard OS \(server\) 0\.3\.15/);
    assert.doesNotMatch(root.innerHTML, /Wizard OS 0\.10\.23/);
    assert.match(root.innerHTML, /data-dvupd/); // existing guarded native update action preserved
    assert.match(root.innerHTML, /Reply notifications/);
    assert.match(root.innerHTML, /The Android phone app updates separately too/);
  }
});
test('missing, unauthorized, malformed and offline connectors stay visible and cannot change preferences or install', async () => {
  for (const reply of [() => [404,{}], () => [403,{}], () => [200,{}], () => { throw Error('offline'); }]) {
    const {s,calls,mounts} = await harness(reply);
    for (const {root,view} of mounts) { view.focus('updates'); assert.match(root.innerHTML, /data-osu-group/); assert.match(root.innerHTML, /could not be verified/); assert.match(root.innerHTML, /data-osu="retry"/); assert.doesNotMatch(root.innerHTML, /data-osu="(?:auto|ask|apply)"/); }
    s.WosUpdates.act({closest: () => ({ dataset: { osu: 'ask' } })}, {});
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    assert.equal(s.WosUpdates.card(), null);
    assert.match(s.WosUpdates.html(), /No update preference was changed by this check/);
    assert.doesNotMatch(s.WosUpdates.html(), /Nothing has been changed/);
  }
});
test('retry reads the original connector and only a verified response restores canonical controls', async () => {
  let online = false;
  const {s,calls} = await harness(() => online ? [200,status] : [404,{}]);
  online = true;
  s.WosUpdates.act({closest: () => ({ dataset: { osu: 'retry' } })}, {});
  assert.doesNotMatch(s.WosUpdates.html(), /data-osu-auto|data-osu="ch-/, 'stale controls cannot flash during retry');
  assert.match(s.WosUpdates.html(), /disabled aria-busy="true"[^>]*>Checking…/, 'retry acknowledges the tap before the read resolves');
  await tick(); await tick();
  assert.match(s.WosUpdates.html(), /data-osu-auto/);
  const updates = calls.filter(c => c.url.endsWith('/store-install/_updates'));
  assert.equal(updates.length, 2); assert.equal(updates[1].url, updates[0].url);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('a later connector failure withdraws install/policy controls instead of keeping stale permission', async () => {
  let online = true;
  const {s,calls} = await harness(() => online ? [200,status] : [403,{}]);
  online = false; await s.WosUpdates.load(true);
  assert.doesNotMatch(s.WosUpdates.html(), /data-osu="(?:auto|ask|apply)"/);
  s.WosUpdates.act({closest: () => ({ dataset: { osu: 'apply' } })}, {});
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('shared updater exposes the first observed revision, not an actual loaded-code stamp or newer pending revision', async () => {
  let marker = 'a'.repeat(40), refreshes = 0;
  const s = { console, URL, navigator: { onLine: true }, location: { href: 'https://fixture.invalid/wizard-os-home/' }, document: { currentScript: { src: 'https://fixture.invalid/wizard-os-home/core/web-update.js' } }, fetch: async url => ({ ok: true, text: async () => marker, json: async () => [] }) };
  s.window = s; s.WosSettings = { refresh: () => refreshes++ };
  vm.runInNewContext(read('web/core/web-update.js'), s);
  s.navigator.onLine=false;await s.WizWebUpdate.check(true);
  assert.equal(s.WizWebUpdate.firstObservedVersion,'');
  s.navigator.onLine=true;
  await s.WizWebUpdate.check(true);
  assert.equal(s.WizWebUpdate.loadedVersion,undefined);
  assert.equal(s.WizWebUpdate.firstObservedVersion, marker); assert.equal(refreshes,1);
  marker = 'b'.repeat(40); await s.WizWebUpdate.check(true);
  assert.equal(s.WizWebUpdate.firstObservedVersion, 'a'.repeat(40));
  assert.equal(s.WizWebUpdate.version, 'v:' + marker);
  assert.equal(s.WizWebUpdate.pending,true);
});

test('lost connection during an install retains explicitly last-checked identity and progress but no actionable stale controls', async () => {
  for (const failure of [() => { throw Error('offline'); }, () => [503,{}], () => [401,{}]]) {
    let fail=false;
    const installing={...status,installing:true};
    const {s,calls,mounts}=await harness(()=>fail?failure():[200,installing]);
    fail=true;await s.WosUpdates.load(true);
    assert.equal(s.WosUpdates.state.installing,true,'known state is retained, not discarded');
    for(const {root,view} of mounts){
      view.focus('about');
      assert.match(root.innerHTML,/Wizard OS \(server\) 0\.3\.15/);
      assert.match(root.innerHTML,/Last checked · previously verified/);
      assert.match(root.innerHTML,/Last checked: Updating Wizard OS… Connection lost; latest progress unverified/);
      assert.doesNotMatch(root.innerHTML,/Nothing has been changed|Up to date|data-osu="(?:auto|ask|apply|ch-stable|ch-latest)"/);
      assert.match(root.innerHTML,/<button type="button"[^>]*data-osu="retry"/);
    }
    for(const osu of ['auto','ask','apply','ch-stable','ch-latest'])s.WosUpdates.act({closest:()=>({dataset:{osu}})},{});
    const before=calls.length;
    s.WosUpdates.act({closest:()=>({dataset:{osu:'retry'}})},{});
    await tick();await tick();
    assert.equal(calls.length,before+1);assert.equal(calls.at(-1).method,undefined);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
    assert.doesNotMatch(s.WosUpdates.html(),/data-osu="(?:auto|ask|apply|ch-stable|ch-latest)"/);
  }
});
