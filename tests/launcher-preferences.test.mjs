import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { launcherFixture } from './launcher-fixture.mjs';
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function fixture(fetch) {
  const data = new Map(), events = {}, writes = [];
  const ctx = { window: { dispatchEvent() {} }, addEventListener: (k,f) => events[k] = f,
    localStorage: { getItem: k => data.get(k) || null, setItem: (k,v) => { data.set(k,v); writes.push(k); } }, fetch };
  const policy = launcherFixture(ctx);
  return { ctx, policy, data, events, writes };
}
test('old service uses one compatibility module, never writes a local migration marker', async () => {
  const calls = [], f = fixture(async (url, options) => { calls.push([url, options.method || 'GET']); return { ok: options.method !== 'POST', json: async () => ({ compact: true }), status: 404 }; });
  await f.policy.ready;
  assert.deepEqual(calls.map(x => x[1]), ['GET','POST']);
  assert.equal(f.policy.shared, false);
  assert.deepEqual(plain(f.policy.get('autoOpen')), ['topics','mizel']);
  assert.equal(f.policy.get('nativeLinks').length,10);
  assert.deepEqual(f.writes, []);
});
test('new service seed uses exact legacy values and consumes returned owner choices, not request defaults', async () => {
  const calls = [], chosen = { autoOpen: [], recents: ['new-app'], hostedThreadApps: [], nativeLinks: [] };
  const f = fixture(async (url, options) => { calls.push([url,options]); return { ok: true, json: async () => options.method ? { seeded: true, preferences: { launcher: chosen, migrations: { 'launcher-seed-v1': '2026-10-26T00:00:00Z' } } } : {} }; });
  await f.policy.ready;
  assert.equal(f.policy.shared,true);
  const payload=JSON.parse(calls[1][1].body);
  assert.equal(payload.marker,'launcher-seed-v1');
  assert.deepEqual(payload.launcher,plain(f.ctx.window.WizLauncherDefaults));
  assert.deepEqual(plain(f.policy.get('autoOpen')),[]);
  assert.deepEqual(plain(f.policy.get('recents')),['new-app']);
  assert.equal(f.policy.hasHostedThread('wisdom'),false);
  assert.equal(f.writes.some(k=>k.includes('migration')),false);
});
test('marker suppresses seed; focus refresh consumes synced preferences and empty arrays stay empty', async () => {
  let count=0, changed=0;
  const f=fixture(async (_,options)=> { count++; assert.equal(options.method,undefined); return {ok:true,json:async()=>({migrations:{'launcher-seed-v1':'2026-10-26T00:00:00Z'},launcher:{desktopQuick:[],displayNames:{'some-app':'Short'}}})}; });
  await f.policy.ready; assert.equal(count,1);
  f.policy.onChange(()=>changed++);
  f.policy.accept({launcher:{desktopQuick:['other-app']}}); assert.equal(changed,1);
  await f.events.focus(); assert.equal(count,2);
  assert.deepEqual(plain(f.policy.get('desktopQuick')),[]);
  assert.equal(f.policy.displayName({id:'some-app',name:'Long'}),'Short');
  assert.equal(f.policy.displayName({id:'constructor',name:'Safe'}),'Safe');
});
test('failed seed is retried on focus, never marks a device migration complete', async () => {
  let posts=0; const f=fixture(async (_,options)=>({ok:options.method ? ++posts>1 : true,json:async()=>options.method?{preferences:{launcher:{autoOpen:[]},migrations:{'launcher-seed-v1':'2026-10-26T00:00:00Z'}}}:{}}));
  await f.policy.ready; assert.equal(f.policy.shared,false);
  await f.events.focus(); assert.equal(f.policy.shared,true); assert.equal(posts,2);
});
test('registry masks and colours beat HOUSE, HOUSE remains only legacy fallback', () => {
  const ctx={window:{WizCore:{appMetadata:id=>id==='wisdom'?{icon:'wisdom',colors:['#123456']}:undefined}}};
  vm.runInNewContext(read('core/sigils.js'),ctx);
  assert.deepEqual(plain(ctx.window.WizSigil.of({id:'wisdom'})),{glyph:'wisdom',color:'#123456'});
  const file=ctx.window.WizSigil.of({id:'wisdom',icon:'/own.svg',colors:['#abcdef']});
  assert.equal(file.img,'/own.svg'); assert.equal(file.color,'#abcdef');
  const fallback=ctx.window.WizSigil.of({id:'wisdom',icon:'',colors:[]});
  assert.ok(fallback.glyph); assert.notEqual(fallback.color,'#123456');
});
test('shells and both hosted-thread consumers have no optional app lists; settings agent order stays untouched', () => {
  for (const p of ['app.js','desktop/desktop.js']) assert.doesNotMatch(read(p),/\['wizard', 'wizard-signal'|\['topics', 'mizel'|const quick = \[/);
  for (const p of ['core/chats.js','core/app-services.js']) assert.doesNotMatch(read(p),/const HOSTED_(?:THREAD_)?APPS =/);
  assert.doesNotMatch(read('core/home-screen-policy.js'),/wizard-signal/);
  assert.doesNotMatch(read('core/apps.js'),/id: '(?:maps|camera|phone|messages|spotify|telegram|line|grab|chrome|settings)'/);
});
