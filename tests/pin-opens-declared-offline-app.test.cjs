const {readFileSync}=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const {test}=require('node:test');
const origin='https://pin.test',base=origin+'/wizard-os-home/';
async function harness({missing,deny=false,declared=['reader']}={}) {
  const listeners={}, stores=new Map(); let online=true,claim=0,skip=0;
  const key=r=>typeof r==='string'?r:r.url;
  const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
    return {put:async(r,v)=>store.set(key(r),v.clone()),match:async(r,options={})=>{
      const hit=[...store].find(([u])=>options.ignoreSearch?u.split('?')[0]===key(r).split('?')[0]:u===key(r));return hit?.[1].clone();
    }};
  }};
  const sandbox={URL,URLSearchParams,Response,Request,caches,location:{origin},fetch:async r=>{
    if(!online)throw TypeError('all network aborted');
    const u=new URL(key(r));
    if(missing&&u.pathname.endsWith(missing))return new Response('missing',{status:404});
    if(deny)return new Response('unauthorized',{status:401});
    return new Response(u.pathname.endsWith('app-session.html')?readFileSync('web/app-session.html'):('fresh:'+u.href));
  }};
  sandbox.self=sandbox;sandbox.location.href=base+'sw.js';sandbox.navigator={get onLine(){return online}};
  sandbox.clients={claim:async()=>claim++};sandbox.skipWaiting=async()=>skip++;
  sandbox.addEventListener=(n,f)=>listeners[n]=f;
  const context=vm.createContext(sandbox);
  sandbox.importScripts=name=>vm.runInContext(readFileSync('web/'+name.replace(/^\.\//,''),'utf8'),context);
  vm.runInContext(readFileSync('web/core/offline-session-config.js','utf8'),context);
  // core/offline-session.js publishes this snapshot from what installed apps declared (home_screen.offline).
  if(declared)(await caches.open('wizard-os-home-registry')).put(base+'offline-apps.json',new Response(JSON.stringify({v:1,ids:declared})));
  async function event(name){let p;listeners[name]({waitUntil:x=>p=x});return p;}
  function get(path,{mode='navigate',method='GET',range=false}={}){
    let p;listeners.fetch({request:{url:new URL(path,base).href,mode,method,headers:{has:k=>range&&k==='range'}},respondWith:x=>p=x});return p;
  }
  return {event,get,stores,setOnline:v=>online=v,stats:()=>({claim,skip}),config:sandbox.WIZ_OFFLINE_CONFIG,cap:sandbox.WizOfflineApps};
}

test('a pin of an app that declared offline opens with no connection',async()=>{
  const h=await harness();h.stores.set('reader-shell-owned',new Map());h.stores.set('sibling-shell-sentinel',new Map());h.stores.set('wizard-os-home-shell-old',new Map());
  await h.event('install');await h.event('activate');
  assert.deepEqual(h.stats(),{claim:1,skip:1});assert(h.stores.has('reader-shell-owned'));assert(h.stores.has('sibling-shell-sentinel'));assert(!h.stores.has('wizard-os-home-shell-old'));
  assert(h.stores.has('wizard-os-home-registry'),'the declared-app snapshot survives shell cache turnover');
  assert.match(await(await h.get('?app-session=reader')).text(),/^fresh:/,'online pin is network-first');
  h.setOnline(false);
  assert.match(await(await h.get('?app-session=reader')).text(),/single-app-session\.js/);
  assert.match(await(await h.get('index.html?app-session=reader')).text(),/Offline app-session document/);
  assert.match(await(await h.get('core/apps.js',{mode:'cors'})).text(),/^fresh:/);
  // Anything else is either not ours at all, or claimed only to be passed straight to the (offline) network.
  for(const path of ['', '?app-session=','?app-session=reader&app-session=files','?app-session=reader&session=private','?app-session=..%2Freader','app-session.html?app-session=files']){
    const r=h.get(path);if(r!==undefined)await assert.rejects(r,/network aborted/,path);
  }
  for(const path of ['/wizard/attachments/private.jpg','/wizard/files/private.pdf'])assert.equal(h.get(path,{mode:'cors'}),undefined);
  assert.equal(h.get('styles.css',{mode:'cors',range:true}),undefined);assert.equal(h.get('?app-session=reader',{method:'POST'}),undefined);
  const family=h.stores.get('wizard-os-home-shell-'+h.config.version);
  assert(![...family.keys()].some(k=>k.includes('?')||k.includes('/wizard/')));
});

test('an app that did not declare offline gets nothing from the worker, online or off',async()=>{
  for(const declared of [null,['someone-else']]){
    const h=await harness({declared});await h.event('install');await h.event('activate');
    assert.match(await(await h.get('?app-session=reader')).text(),/^fresh:/,'online: plain network, no cached document');
    h.setOnline(false);
    await assert.rejects(h.get('?app-session=reader'),/network aborted/,'offline: no shell fallback for an undeclared app');
  }
});

test('the shell worker and its generated config name no app',()=>{
  const h=['web/core/offline-session-config.js','web/core/offline-sw.js','web/core/offline-session.js','tools/build-offline-session.py','web/app-session.html'];
  for(const f of h)assert(!/wisdom|mizel|notes|outline|movies|messenger/i.test(readFileSync(f,'utf8')),f+' must stay app-agnostic');
  const src=readFileSync('web/core/apps.js','utf8');
  const policy=src.slice(src.indexOf('window.WizCore.appMigrations ='),src.indexOf('const PALETTE'));
  // #892 P1: this historical migration remains until the companion declaration reaches each box.
  assert(/^\s*wisdom\s*:/m.test(policy),'pre-declaration installs must still retire the exact legacy worker');
  assert.match(policy,/'wizard-signal'/,'unrelated reviewed legacy cleanup is preserved');
  assert.match(readFileSync('web/core/app-services.js','utf8'),/appHomeScreen\?\.\(st\.appId\)\?\.offline\) return \[\]/,'declared-offline apps are never cleaned up');
});

test('legacy cleanup retires only the exact pre-declaration worker and never an offline-declared worker',async()=>{
 const src=readFileSync('web/core/apps.js','utf8'),policy=src.slice(src.indexOf('window.WizCore.appMigrations ='),src.indexOf('const PALETTE'));
 const window={WizCore:{}};vm.runInNewContext(policy,{window});let declared=null,removed=0;
 window.WizCore.appHomeScreen=()=>declared;
 const make=(scope,scriptURL)=>({scope,active:{scriptURL},unregister:async()=>{removed++;return true}});
 const regs=[make(origin+'/wisdom/',origin+'/wisdom/sw.js'),make(origin+'/',origin+'/sw.js'),make(origin+'/wisdom/',origin+'/wisdom/new-worker.js')];
 const services=readFileSync('web/core/app-services.js','utf8');
 const fn=services.slice(services.indexOf('  async function cleanupLegacy('),services.indexOf("  addEventListener('message'",services.indexOf('  async function cleanupLegacy(')));
 const box={window,ORIGIN:origin,URL,valid:()=>true,within:(url,base)=>url.origin===base.origin&&url.pathname.startsWith(base.pathname),navigator:{serviceWorker:{getRegistrations:async()=>regs}}};
 vm.runInNewContext(fn+';this.cleanupLegacy=cleanupLegacy',box);
 const st={appId:'wisdom',url:new URL(origin+'/wisdom/')};
 assert.deepEqual(Array.from(await box.cleanupLegacy(st)),[origin+'/wisdom/']);assert.equal(removed,1,'no root or replacement worker may be removed');
 declared={offline:true};assert.deepEqual(Array.from(await box.cleanupLegacy(st)),[]);assert.equal(removed,1,'the identical legacy script is app-owned once offline is declared');
});

test('partial or denied pin-shell installation is rejected, without activating it',async()=>{
  for(const opts of [{missing:'core/bridge.js'},{deny:true}]){const h=await harness(opts);await assert.rejects(h.event('install'),/Offline shell unavailable/);assert.equal(h.stats().skip,0);}
});

// Do not regress the workspace while serving declared-offline pins.
test('composed worker preserves live workspace and exactly one fetch owner',()=>{
 const src=readFileSync('web/sw.js','utf8');
 assert.match(src,/WizOfflineWorker\?\.handles\(req\)/);
 assert.match(src,/const CACHE = 'wos-shell-v1', PREFIX = 'wos-shell-'/);
 assert.match(src,/wos-shell-warm/);assert.match(src,/async function complete/);
 const generic=readFileSync('web/core/offline-sw.js','utf8');
 assert.match(generic,/self.WizOfflineWorker = Object.freeze\(\{handles\}\)/);
});
