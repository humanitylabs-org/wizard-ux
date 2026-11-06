// No browser, provider calls or inference. Execute both shared renderers with synthetic usage snapshots.
// QA_SOURCE_ROOT points the same assertions at an immutable baseline for A/B evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root = process.env.QA_SOURCE_ROOT || new URL('../', import.meta.url).pathname;
const read = p => readFileSync(resolve(root, p), 'utf8');
const provider = (paid = {}, fields = {}) => ({id:'claude:fixture', provider:'claude', name:'Claude', status:'ok', fetchedAt:new Date().toISOString(), limits:[{id:'weekly', label:'Weekly', remainingPercent:0}], paid:{type:'spend', enabled:true, currency:'USD', exponent:2, usedMinor:100176, limitMinor:null, balanceMinor:null, unlimited:false, ...paid}, ...fields});
function boot({bars=false, memo={}} = {}) {
  const storage = new Map([['wos.res.extra', JSON.stringify(memo)]]);
  const ctx = {document:{documentElement:{dataset:{tweaks:bars?'miguel/home-bars':''}}, hidden:false, addEventListener(){}, querySelectorAll:()=>[]}, localStorage:{getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v)}, queueMicrotask(){}, setTimeout, clearTimeout, AbortController, console};
  ctx.window=ctx; ctx.addEventListener=()=>{};
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  const source=read('web/core/resources.js');
  assert.ok(source.includes('window.WosResources={'), 'test seam matches the production module');
  vm.runInNewContext(source.replace('window.WosResources={','globalThis.__resourcesState=S;window.WosResources={'), ctx);
  const set = (p, error='') => {const snap=ctx.WosUsage.normalize({providers:[p]}); ctx.__resourcesState.ai=snap; ctx.__resourcesState.aiError=error; ctx.WosUsage.snap=snap;ctx.WosUsage.error=error;};
  return {r:ctx.WosResources, u:ctx.WosUsage, set, storage, ctx, home:()=>ctx.WosResources.home(), details:()=>ctx.WosUsage.html()};
}
const extraCell = h => {const start=h.indexOf('<span class="rs-account rs-extra');if(start<0)return '';let depth=0;for(const m of h.slice(start).matchAll(/<span\b[^>]*>|<\/span>/g)){depth+=m[0].startsWith('</')?-1:1;if(!depth)return h.slice(start,start+m.index+m[0].length);}throw new Error('Unclosed extra cell');};
const extraRow = h => h.match(/<button[^>]*data-k="extra:claude:fixture"[^]*?<\/button>/)?.[0] || '';

test('enabled with unknown cap is a real reading, not disabled, unlimited, or a percentage', () => {
  const b=boot(), x=b.r.extraOf(provider());
  assert.ok(x); assert.equal(x.limit,null); assert.equal(x.left,null);assert.equal(x.pct,null); assert.equal(x.used,100176);
  b.set(provider());const h=extraCell(b.home());
  assert.match(h,/Claude extra/);assert.match(h,/>Enabled</);assert.match(h,/\$1,001\.76 spent/);assert.match(h,/Balance and cap unavailable/);
  assert.doesNotMatch(h,/role="meter"|aria-valuenow|rs-bar|\d+%|unlimited|purchased/i);
});

test('fresh unknown-cap read replaces an exhausted legacy memo, including after reload/outage', () => {
  const old={left:0,limit:100000,exp:2,cur:'USD',pct:100,at:Date.now()-10000};
  const b=boot({memo:{'claude:fixture':old}}), p=provider();
  const x=b.r.extraFor(p);assert.ok(x);assert.equal(x.pct,null);assert.equal(x.limit,null);assert.equal(x.stale,false);
  const saved=JSON.parse(b.storage.get('wos.res.extra'));assert.equal(saved[p.id].limit,null);assert.equal(saved[p.id].used,100176);
  const reloaded=boot({memo:saved});reloaded.set({...p,status:'unavailable',paid:null});
  const h=extraCell(reloaded.home());assert.match(h,/>Enabled</);assert.match(h,/Last known reading/);assert.doesNotMatch(h,/100%|role="meter"/);
});

test('known cap keeps actual used/left and numeric meter semantics', () => {
  const b=boot(),p=provider({usedMinor:25000,limitMinor:100000}),x=b.r.extraOf(p);
  assert.equal(x.used,25000);assert.equal(x.left,75000);assert.equal(x.pct,25);
  b.set(p);const h=extraCell(b.home());assert.match(h,/>25%</);assert.match(h,/aria-valuenow="25"/);assert.match(h,/\$750 left of \$1,?000/);
});

test('good disabled or absent paid data clears previous extra state', () => {
  for(const paid of [{...provider().paid,enabled:false},null]) {
    const b=boot();b.r.extraFor(provider());const p={...provider(),paid};
    assert.equal(b.r.extraFor(p),null);assert.equal(JSON.parse(b.storage.get('wos.res.extra'))[p.id],undefined);
    b.set(p);assert.doesNotMatch(b.home(),/data-res-account="claude:fixture:extra"/);
    assert.equal(b.r.extraFor({...p,status:'unavailable'}),null);
  }
});

test('stale and unavailable provider readings never invent a fresh meter or erase last actual state', () => {
  const b=boot(),p=provider();b.r.extraFor(p);
  for(const bad of [{...p,status:'stale'}, {...p,status:'unavailable',paid:null}, {...p,status:'stale',paid:{...p.paid,enabled:false}}]) {
    b.set(bad);const h=extraCell(b.home());assert.match(h,/>Enabled</);assert.match(h,/Last known reading/);assert.doesNotMatch(h,/role="meter"|\d+%/);
  }
  b.set(p,'Latest AI usage unavailable');assert.match(extraCell(b.home()),/Last known reading/);
  const fresh=boot();fresh.set({...p,status:'unavailable',paid:null});assert.equal(extraCell(fresh.home()),'');
});

test('null spend is unknown even with a known cap, never a zero-spend/full-balance reading', () => {
  for(const limitMinor of [null,100000]) {
    const b=boot(),p=provider({usedMinor:null,limitMinor}),x=b.r.extraOf(p);
    assert.ok(x);assert.equal(x.used,null);assert.equal(x.left,null);assert.equal(x.pct,null);
    b.set(p);const h=extraCell(b.home());assert.match(h,/Spend unavailable/);assert.doesNotMatch(h,/\$0 spent|role="meter"|\d+%/);
    assert.match(b.details(),/Spend unavailable/);
  }
});

test('Home bars and Settings shared bars explicitly show enabled unknown-cap extra beside exhausted weekly quota', () => {
  for(const bars of [false,true]) {
    const b=boot({bars});b.set(provider());const h=b.r.barsHtml(),row=extraRow(h);
    assert.match(row,/Claude extra/);assert.match(row,/>Enabled</);assert.match(row,/\$1,001\.76 spent/);assert.match(row,/Balance and cap unavailable/);
    assert.doesNotMatch(row,/rs-bf|data-w=|\d+%|Enabled used|purchased|unlimited/i);
    assert.ok(h.indexOf('data-k="ai:claude:fixture"')<h.indexOf('data-k="extra:claude:fixture"'));
    assert.match(h,/extra usage monthly/);
    b.set(provider(),'Latest AI usage unavailable');assert.match(extraRow(b.r.barsHtml()),/Last known reading/);
  }
});

test('Home bars use numeric extra only for known spend/cap and preserve it visibly stale on outage', () => {
  const b=boot({bars:true}),p=provider({usedMinor:25000,limitMinor:100000});b.set(p);
  let h=extraRow(b.home());assert.match(h,/>25%</);assert.match(h,/data-w="25"/);
  b.set({...p,status:'unavailable',paid:null});h=extraRow(b.home());assert.match(h,/Last known reading/);assert.match(h,/>25%</);
  b.set(provider({enabled:false}));assert.equal(extraRow(b.home()),'');
});

test('AI details label unknown balance/cap, explicit spent amount, and stale/error context', () => {
  const b=boot();b.set(provider());assert.match(b.details(),/Extra usage: Enabled · \$1,001\.76 spent · Balance and cap unavailable/);
  b.set(provider({}, {status:'stale'}));assert.match(b.details(),/last known reading/);
  b.set(provider(),'Latest AI usage unavailable');assert.match(b.details(),/Last known reading/);
  b.set(provider({enabled:false}));assert.doesNotMatch(b.details(),/Extra usage:/);
});

test('actual detail fetch failure keeps the prior snapshot and visibly marks it last-known', async () => {
  const b=boot(),p=provider();b.ctx.fetch=async()=>({ok:true,json:async()=>({providers:[p]})});
  await b.u.load(true);assert.match(b.details(),/Extra usage: Enabled/);
  const prior=b.u.snap;b.ctx.fetch=async()=>{throw new Error('Fixture outage');};
  assert.equal(await b.u.load(true),prior);assert.equal(b.u.snap,prior);
  assert.match(b.details(),/Last known reading/);assert.match(b.details(),/\$1,001\.76 spent/);assert.match(b.details(),/Fixture outage/);
});

test('aging and disabled transitions cannot keep a previously numeric extra bar in shared markup', () => {
  const b=boot({bars:true});b.set(provider({limitMinor:100000,usedMinor:100000}));
  const known=b.home();assert.match(extraRow(known),/data-w="100"/);
  b.set(provider());const unknown=b.home();assert.doesNotMatch(extraRow(unknown),/rs-bf|100%/);
  const signature=h=>h.match(/data-sig="([^"]*)"/)?.[1];assert.notEqual(signature(known),signature(unknown),'paintBars replaces the old numeric DOM');
  b.set(provider({}, {fetchedAt:new Date(Date.now()-360000).toISOString()}));const aged=b.home();
  assert.match(extraRow(aged),/Last known reading/);assert.notEqual(signature(unknown),signature(aged),'paintBars repaints freshness text');
  b.set(provider({enabled:false}));assert.equal(extraRow(b.home()),'');
});

test('provider names, currency and spend descriptions remain escaped in every renderer', () => {
  for(const bars of [false,true]) {
    const b=boot({bars});b.set(provider({currency:'<svg onload="attack()">'},{name:'<img src=x onerror="attack()">'}));
    for(const h of [b.home(),b.r.barsHtml(),b.details()]) {
      assert.doesNotMatch(h,/<img|<svg onload/);assert.match(h,/&lt;svg onload=&quot;attack\(\)&quot;&gt;/);
    }
  }
});
