const {readFileSync}=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const {test}=require('node:test');
const origin='https://pin.test',base=origin+'/wizard-os-home/';
async function harness({missing,deny=false}={}) {
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
  vm.runInContext(readFileSync('web/sw.js','utf8'),context);
  async function event(name){let p;listeners[name]({waitUntil:x=>p=x});return p;}
  function get(path,{mode='navigate',method='GET',range=false}={}){
    let p;listeners.fetch({request:{url:new URL(path,base).href,mode,method,headers:{has:k=>range&&k==='range'}},respondWith:x=>p=x});return p;
  }
  return {event,get,stores,setOnline:v=>online=v,stats:()=>({claim,skip}),config:sandbox.WIZ_OFFLINE_CONFIG,cap:sandbox.WizOfflineApps};
}

test('wizard pin opens wisdom offline',async()=>{
  const h=await harness();h.stores.set('wisdom-shell-owned',new Map());h.stores.set('sibling-shell-sentinel',new Map());h.stores.set('wizard-os-home-shell-old',new Map());
  await h.event('install');await h.event('activate');
  assert.deepEqual(h.stats(),{claim:1,skip:1});assert(h.stores.has('wisdom-shell-owned'));assert(h.stores.has('sibling-shell-sentinel'));assert(!h.stores.has('wizard-os-home-shell-old'));
  assert.match(await(await h.get('?app-session=wisdom')).text(),/^fresh:/,'online pin is network-first');
  h.setOnline(false);
  assert.match(await(await h.get('?app-session=wisdom')).text(),/single-app-session\.js/);
  assert.match(await(await h.get('index.html?app-session=wisdom')).text(),/Offline app-session document/);
  assert.match(await(await h.get('core/apps.js',{mode:'cors'})).text(),/^fresh:/);
  for(const path of ['', '?app-session=files','?app-session=','?app-session=wisdom&app-session=files','?app-session=wisdom&session=private','?app-session=..%2Fwisdom','app-session.html?app-session=files'])assert.equal(h.get(path),undefined,path);
  for(const path of ['/wizard/attachments/private.jpg','/wizard/files/private.pdf'])assert.equal(h.get(path,{mode:'cors'}),undefined);
  assert.equal(h.get('styles.css',{mode:'cors',range:true}),undefined);assert.equal(h.get('?app-session=wisdom',{method:'POST'}),undefined);
  const family=h.stores.get('wizard-os-home-shell-'+h.config.version);
  assert(![...family.keys()].some(k=>k.includes('?')||k.includes('/wizard/')));
});

test('only the reviewed exact Wisdom route opts into offline; legacy cleanup cannot unregister it',async()=>{
  const h=await harness();assert(h.cap.allows('wisdom','/wisdom/',origin));
  for(const [id,url] of [['files','/files/'],['wisdom','https://evil.test/wisdom/'],['wisdom','/wisdom/?auth=1'],['wisdom','/wizard/views/wisdom/'],['wisdom','/wisdom/other/']])assert.equal(h.cap.allows(id,url,origin),false);
  const src=readFileSync('web/core/apps.js','utf8');
  const policy=src.slice(src.indexOf('window.WizCore.appMigrations ='),src.indexOf('const PALETTE'));
  assert(!/^\s*wisdom\s*:/m.test(policy),'load/attach cleanup must not unregister the approved reading worker');
  assert.match(policy,/'wizard-signal'/,'unrelated reviewed legacy cleanup is preserved');
});

test('partial or denied pin-shell installation is rejected, without activating it',async()=>{
  for(const opts of [{missing:'core/bridge.js'},{deny:true}]){const h=await harness(opts);await assert.rejects(h.event('install'),/Offline shell unavailable/);assert.equal(h.stats().skip,0);}
});
