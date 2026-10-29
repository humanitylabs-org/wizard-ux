import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
test('focus refresh coalesces reads and failed/malformed snapshots retain the live registry',async () => {
  const events = new Map(), storage = new Map();
  let snapshot = {apps:[]}, calls = 0, mode = 'ok', release;
  const window = {WizCore:{norm:s=>s.toLowerCase()},WizConfig:{endpoint:()=>'/apps'},dispatchEvent(){}};
  const document = {hidden:false,addEventListener:(name,fn)=>events.set(name,fn)};
  const ctx = {window,document,CustomEvent:class{},URL,location:new URL('https://wizard.test/'),
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    addEventListener:(name,fn)=>events.set(name,fn),fetch:async()=>{
      calls++;
      if(mode==='throw') throw new Error('offline');
      if(mode==='hold') await new Promise(r=>{release=r;});
      return {ok:mode!=='http',json:async()=>{if(mode==='json') throw new Error('bad json');return snapshot;}};
    }};
  vm.runInNewContext(source,ctx);
  await window.WizCore.appsLoaded();
  const registry = window.WizCore.apps('desktop'), list = registry.APPS, lookup = registry.APP;
  snapshot = {apps:[{id:'messenger',name:'Messenger',url:'/messenger/'}]};
  mode = 'hold'; const before = calls;
  events.get('focus')(); events.get('visibilitychange')();
  const first = window.WizCore.refreshApps(), second = window.WizCore.refreshApps();
  assert.equal(first,second);
  assert.equal(calls,before+1); release(); await first;
  assert.equal(registry.APPS,list); assert.equal(registry.APP,lookup);
  assert.equal(lookup.messenger.url,'/messenger/');
  for (const failure of ['throw','http','json','ok']) {
    mode = failure; snapshot = {apps:null,in_development:['messenger']};
    await window.WizCore.refreshApps();
    assert.equal(lookup.messenger.url,'/messenger/');
    assert.equal(window.WizCore.isInDevelopment(lookup.messenger),false);
  }
  mode = 'ok'; snapshot = {apps:[]};
  await window.WizCore.refreshApps(); assert.equal(lookup.messenger,undefined,'valid empty snapshots still remove apps');
});

test('opening a picker during an older fetch queues one fresh snapshot after that fetch', async () => {
  let snapshot = {apps:[]}, calls = 0, hold = false;
  const releases = [], events = new Map();
  const window = {WizCore:{norm:s=>s.toLowerCase()},WizConfig:{endpoint:()=>'/apps'},dispatchEvent(){}};
  const ctx = {window,document:{hidden:false,addEventListener:(k,f)=>events.set(k,f)},CustomEvent:class{},URL,
    location:new URL('https://wizard.test/'),localStorage:{getItem:()=>null,setItem(){}},
    addEventListener:(k,f)=>events.set(k,f),fetch:async()=>{
      calls++; const captured = snapshot;
      if (hold) await new Promise(r=>releases.push(r));
      return {ok:true,json:async()=>captured};
    }};
  vm.runInNewContext(source,ctx);
  await window.WizCore.appsLoaded();
  const registry = window.WizCore.apps('desktop');
  hold = true;
  const older = window.WizCore.refreshApps();
  snapshot = {apps:[{id:'messenger',name:'Messenger',url:'/messenger/'}]};
  const after = window.WizCore.refreshApps({afterPending:true});
  assert.equal(after,window.WizCore.refreshApps({afterPending:true}),'picker burst queues only one read');
  releases.shift()(); await older; await Promise.resolve();
  assert.equal(calls,3,'initial, old snapshot, one after-opening snapshot');
  assert.equal(registry.APP.messenger,undefined,'the old response really was stale');
  hold = false; releases.shift()(); await after;
  assert.equal(registry.APP.messenger.url,'/messenger/');
});
