const {readFileSync}=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=readFileSync('web/core/offline-sw.js','utf8');
async function harness({missing=false}={}){
 const listeners={},stores=new Map(),origin='https://reader.test',base=origin+'/wisdom/';let online=true,claim=0,skip=0;
 const key=r=>typeof r==='string'?r:r.url;
 const caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);
  return {put:async(r,v)=>m.set(key(r),v.clone()),match:async(r,options={})=>{let k=key(r);const hit=[...m].find(([u])=>options.ignoreSearch?u.split('?')[0]===k.split('?')[0]:u===k);return hit?.[1].clone()}};
 }};
 const self={location:{href:base+'sw.js'},navigator:{get onLine(){return online}},WIZ_OFFLINE_CONFIG:{prefix:'wisdom-',version:'A',shell:['./','app.js'],data:['api/wisdom'],assets:['art/'],onlineOnly:['api/ai']},
  clients:{claim:async()=>claim++},skipWaiting:async()=>skip++,addEventListener:(k,f)=>listeners[k]=f};
 vm.runInNewContext(code,{self,caches,URL,Response,Request,fetch:async r=>{
  if(!online)throw TypeError('offline');const u=key(r);return new Response('fresh:'+u,{status:missing&&u.endsWith('app.js')?404:200});
 }});
 async function event(name){let p;listeners[name]({waitUntil:x=>p=x});return p}
 async function get(path,mode){let p;const request={url:base+path,method:'GET',mode:mode||'cors'};listeners.fetch({request,respondWith:x=>p=x});return p}
 return {event,get,stores,setOnline:v=>online=v,stats:()=>({claim,skip})};
}
(async()=>{
 const h=await harness();h.stores.set('sibling-shell-sentinel',new Map([['x',new Response('safe')]]));h.stores.set('wisdom-shell-old',new Map());
 await h.event('install');await h.event('activate');assert(h.stores.has('sibling-shell-sentinel'));assert(!h.stores.has('wisdom-shell-old'));assert.deepEqual(h.stats(),{claim:1,skip:1});
 assert.match(await(await h.get('app.js')).text(),/^fresh:/);assert.match(await(await h.get('api/wisdom')).text(),/^fresh:/);
 h.setOnline(false);assert.match(await(await h.get('app.js')).text(),/^fresh:/);assert.match(await(await h.get('api/wisdom')).text(),/^fresh:/);
 assert.equal((await h.get('api/ai')).status,503);assert.equal((await(await h.get('api/ai')).json()).error,'Needs a connection');
 assert.deepEqual([...h.stores.keys()].filter(k=>!k.startsWith('wisdom-')),['sibling-shell-sentinel']);
 const broken=await harness({missing:true});await assert.rejects(broken.event('install'),/Offline shell unavailable/);assert.equal(broken.stats().skip,0);
 assert(!/clients\.(navigate|openWindow)|location\.reload|caches\.match\(/.test(code));
 console.log('PASS offline worker: isolated caches, network freshness, offline shell/data, fast AI failure, partial install rejection, no forced reload');
})().catch(e=>{console.error(e);process.exitCode=1});
