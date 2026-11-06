import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fx = require('../tools/qa-proof-fixture.cjs');
const source = readFileSync(new URL('../qa-offline-popup.cjs', import.meta.url), 'utf8');
const captureNames = ['orb-tap-starts-real-fake-mic', 'capture-hides-checks', 'capture-navigation-suppressed'];
// Execute the actual capture branch and actual emitted result, not a parallel report builder.
async function captureCase(phone, captured) {
  const begin = source.indexOf('// Actual pointer delivery');
  const end = source.indexOf('        await navigate(); await pillOnly();', begin);
  const emit = source.match(/results\.push\(\{[^\n]+\}\);/)[0];
  let pillCalls = 0, navigations = 0;
  const page = {
    locator: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }), click: async () => {} }),
    mouse: { click: async () => {} },
    waitForFunction: async fn => { if (String(fn).includes("!== 'idle'") && !captured) throw Object.assign(Error('no capture'), { name: 'TimeoutError' }); },
    evaluate: async () => { navigations++; }, waitForTimeout: async () => {}, screenshot: async () => {}
  };
  const ctx = { phone, page, pillOnly: async () => { pillCalls++; }, checks: [], notRun: [], results: [],
    shell: phone ? 'phone' : 'desktop', skin: 'nebula', geometry: {}, start: Date.now(), liveReads: 0, blockedWrites: 0, assets: {}, OUT: '.', path: require('node:path') };
  await vm.runInNewContext(`(async()=>{${source.slice(begin, end)}\n${emit}})()`, ctx);
  return { row: ctx.results[0], pillCalls, navigations };
}

test('desktop without capture reports none of the non-executed capture checks as passed', async () => {
  const { row, pillCalls, navigations } = await captureCase(false, false);
  assert.equal(row.captured, false);
  for (const check of captureNames) {
    assert.ok(!row.checks.includes(check), `${check} did not execute`);
    assert.match(row.notRun.find(r => r.check === check)?.reason || '', /desktop mic needs an open chat target/i);
  }
  assert.ok(!row.checks.includes('pill-tap-opens-under-status-bar'));
  assert.equal(pillCalls, 0, 'outside-click dismissal is not capture-hides-checks evidence');
  assert.equal(navigations, 0);
});

for (const phone of [true, false]) test(`${phone ? 'phone' : 'desktop'} actual capture records only executed capture checks`, async () => {
  const { row, pillCalls, navigations } = await captureCase(phone, true);
  assert.equal(row.captured, true);
  assert.deepEqual(Array.from(row.checks), captureNames);
  assert.equal(row.notRun.length, 0);
  assert.equal(pillCalls, 2);
  assert.equal(navigations, phone ? 2 : 1);
});

test('phone capture timeout remains a hard failure', async () => {
  await assert.rejects(() => captureCase(true, false), /no capture/);
});

test('status-bar geometry is passed only after phone assertions execute; desktop records notRun', () => {
  const begin = source.indexOf('        if (phone) { assert.ok(geometry.card.y');
  const end = source.indexOf('        assert.ok(/', begin);
  assert.ok(begin >= 0 && end > begin);
  for (const phone of [true, false]) {
    const ctx = { phone, assert, geometry: { card: { y: 20, bottom: 80 }, orb: { top: 100 } }, pillBox: { y: 0, height: 20 }, checks: [], notRun: [] };
    vm.runInNewContext(source.slice(begin, end), ctx);
    assert.equal(ctx.checks.includes('pill-tap-opens-under-status-bar'), phone);
    if (!phone) assert.match(ctx.notRun[0].reason, /phone-only geometry/i);
  }
});

test('proof fixtures reject unknown paths, foreign origins and arbitrary message targets', () => {
  for (const p of ['/unknown', '/wizard/v1/unknown', '/unknown/messages', '/wizard/hermes/api/sessions/owner-thread/messages', 'https://owner.example/wizard/v1/setup']) {
    assert.throws(() => fx.read(p), /Uncatalogued fixture request|Non-fixture origin/);
  }
});

test('known-empty proof endpoints are explicit entries in the shared closed catalogue', () => {
  assert.deepEqual(fx.read('/wizard/thread-dispositions'), { state: {} });
  assert.deepEqual(fx.read('/wizard/v1/boomerangs'), { reminders: [] });
  assert.equal(fx.read('/wizard/hermes/api/sessions/tap-thread/messages').data.length, 2);
  assert.equal(fx.read('/wizard/hermes/api/sessions').data[0].id, 'tap-thread');
  assert.throws(() => fx.read('/wizard/v1/setup', 'POST'), /Uncatalogued fixture request/);
});


test('startup discovery has explicit synthetic skins and My skin responses', () => {
  const skins = fx.read('/wizard/v1/skins');
  assert.equal(skins.active, null);
  assert.deepEqual(skins.skins.map(s => s.base), ['nebula', 'grove', 'tide', 'ember', 'signal']);
  for (const s of skins.skins) { assert.equal(s.has_script, false); assert.equal(s.has_recipe, true); }
  assert.equal(fx.response('/wizard/v1/my-skin').contentType, 'text/css');
  assert.equal(fx.response('/wizard/v1/my-skin').body, '');
  assert.equal(fx.read('/wizard/v1/my-skin?format=json').script.exists, false);
  for (const p of ['/wizard/v1/pages', '/wizard/v1/agent-options', '/wizard/v1/app-bindings', '/wizard/v1/schedules', '/wizard/ai-usage', '/troubleshoot/api/status', '/wizard-tinfoil/api/status', '/wizard-claude/api/accounts', '/wizard-os-home/store-data/wizard/v1/app-logos', '/wizard-os-home/store-data/wizard/v1/installed-apps', '/wizard-os-home/store-install/_updates']) assert.doesNotThrow(() => fx.read(p), p);
  for (const p of ['/wizard/v1/skins/owner', '/wizard/v1/my-skin?format=other']) { fx.resetRefusals(); assert.equal(fx.response(p).status, 451); assert.equal(fx.refused().length, 1); fx.resetRefusals(); }
});

test('Wisdom verifies every pinned static asset, never nonexistent legacy files', async () => {
  const wisdom = readFileSync(new URL('../qa-wisdom-pinned-thread.cjs', import.meta.url), 'utf8');
  const start = wisdom.indexOf('  for(const f of ', wisdom.indexOf("extra.status='pass'"));
  const end = wisdom.indexOf('  await Promise.all(staticReads);', start);
  const manifest = { files: { 'static/discussions.js':'a', 'static/wisdom.js':'b', 'static/wizard-appearance.css':'c', 'static/icon.svg':'d' } };
  const seen = [], c = { assets:{} }, frame = {evaluate:async (fn,f) => {seen.push(f);assert.ok(Object.hasOwn(manifest.files,'static/'+f), 'asset is actually pinned: '+f);return manifest.files['static/'+f];}};
  await vm.runInNewContext(`(async()=>{${wisdom.slice(start,end)}})()`,{manifest,c,frame,assert});
  assert.deepEqual(seen.sort(),Object.keys(manifest.files).map(f=>f.slice(7)).sort());
});


test('production My skin startup follows only catalogued CSS and metadata reads', async () => {
  const calls = [], store = new Map();
  const ctx = { Event, URLSearchParams, location:{search:''}, addEventListener(){}, dispatchEvent(){},
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    WosSkin:{current:'nebula',list:[{id:'nebula'}]},
    fetch:async (url,init={})=>{calls.push(url);const r=fx.response(url,init.method||'GET');return {ok:true,status:r.status,headers:{get:()=>r.contentType},json:async()=>JSON.parse(r.body),text:async()=>r.body};}};
  ctx.window=ctx;
  vm.runInNewContext(readFileSync(new URL('../web/core/my-skin.js',import.meta.url),'utf8'),ctx);
  await ctx.WosMySkin.refresh();
  assert.deepEqual([...new Set(calls)],['/wizard/v1/skins','/wizard/v1/my-skin','/wizard/v1/my-skin?format=json']);
  assert.equal(ctx.WosMySkin.state.loaded,true);
});
