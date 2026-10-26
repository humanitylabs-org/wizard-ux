/* WizOffline v1: opt-in app replica and durable ordered outbox. No timers reload
 * pages, no origin-wide cache reads/deletes, no external or model transports.
 * project(state, item) and reconcile(state, result, item) are pure app adapters.
 * Each queued write needs server-side idempotency for a lost-response retry. */
(() => {
  'use strict';
  function create(c) {
    if(!/^[a-z][a-z0-9-]*-$/.test(c.prefix))throw Error('App cache prefix required');
    const base=new URL(c.base||'./',location.href), absolute=p=>new URL(p,base).href;
    const dbp=new Promise((resolve,reject)=>{
      const r=indexedDB.open(c.prefix+'offline-v1',1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('outbox',{keyPath:'seq',autoIncrement:true});r.result.createObjectStore('meta')};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    async function store(name,mode,fn) {
      const db=await dbp;return new Promise((resolve,reject)=>{
        const tx=db.transaction(name,mode);let result;
        const req=fn(tx.objectStore(name));if(req)req.onsuccess=()=>{result=req.result};
        tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage unavailable'));
      });
    }
    const all=()=>store('outbox','readonly',s=>s.getAll());
    const meta=()=>store('meta','readonly',s=>s.get('state'));
    const save=s=>store('meta','readwrite',o=>o.put(s,'state'));
    const write=i=>store('outbox','readwrite',s=>s.put(i));
    const remove=i=>store('outbox','readwrite',s=>s.delete(i.seq));
    const lock=fn=>navigator.locks?navigator.locks.request(c.prefix+'outbox',fn):serial(fn);
    let chain=Promise.resolve();function serial(fn){const p=chain.catch(()=>{}).then(fn);chain=p;return p}
    let warming=false, ready=false, warmingError='', done=0,total=0, syncing=false, lastError='';
    const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(c.prefix+'offline'):null;
    async function status() {
      const items=await all();return {online:navigator.onLine,ready,done,total,warming,error:warmingError||lastError,
        pending:items.filter(i=>!i.error).length,failed:items.filter(i=>i.error)};
    }
    async function notify(broadcast=true) {
      const s=await status();c.onStatus?.(s);if(broadcast)channel?.postMessage('changed');return s;
    }
    channel?.addEventListener('message',()=>notify(false).catch(()=>{}));
    const onlineOnly=p=>(c.onlineOnly||[]).some(x=>absolute(p).startsWith(absolute(x)));
    const queueable=p=>(c.writes||[]).some(x=>absolute(p)===absolute(x));
    async function response(p,body,id,timeout=c.timeout||20000) {
      const r=await fetch(absolute(p),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',...(id?{'X-Wizard-Offline-Id':id}:{})}:{},
        body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(timeout)});
      let d;try{d=await r.json()}catch{throw Object.assign(Error('Invalid server response'),{status:r.status})}
      if(!r.ok)throw Object.assign(Error(d.error||'Unable to connect'),{status:r.status});return d;
    }
    const projected=async()=>{let state=await meta();for(const i of await all())state=c.project(state,i);return state};
    async function flushLocked(target) {
      if(!navigator.onLine)return;
      syncing=true;
      let targetResult;
      try {
        for(const queued of await all()) {
          const item=await store('outbox','readonly',s=>s.get(queued.seq));if(!item)continue;
          // A failed operation blocks its dependents, not unrelated later reading work.
          if(item.error)continue;
          if(c.blocked?.(item,await all()))continue;
          try {
            const result=await response(item.path,item.body,item.id);
            const alias=c.alias?.(item,result);if(alias)await store('meta','readwrite',s=>s.put(alias.to,'alias:'+alias.from));
            let state=await meta();state=c.reconcile(state,result,item);await save(state);
            if(c.resolve)for(const later of await all())if(later.seq>item.seq){const changed=c.resolve(later,item,result);if(changed)await write(changed)}
            await remove(item);if(item.id===target)targetResult=result;
            channel?.postMessage('changed');
          } catch(e) {
            if(!e.status||e.status>=500||[408,429].includes(e.status)){lastError=navigator.onLine?'Waiting to sync — your changes are saved on this device.':'';break}
            item.error=e.message||'Couldn’t save';await write(item);c.onFailure?.(item);if(item.id===target)throw e;
          }
        }
      } finally {syncing=false;await notify()}
      return targetResult;
    }
    async function flush(){return lock(async()=>{const before=await all();await flushLocked();if(before.some(i=>!i.error))c.onSynced?.(await projected())}).catch(e=>{lastError=e.message;return notify()})}
    async function request(path,body,timeout) {
      if(onlineOnly(path)&&!navigator.onLine)throw Error('Needs a connection');
      if(body&&queueable(path))return lock(async()=>{
        // Store before the first network attempt: a killed tab cannot lose an accepted edit.
        const id=crypto.randomUUID();let item={id,path,body:structuredClone(body),created:new Date().toISOString(),tempId:-(Date.now()*1000+Math.floor(Math.random()*1000))};
        if(c.prepare)item=await c.prepare(item,old=>store('meta','readonly',s=>s.get('alias:'+old)));
        item.seq=await store('outbox','readwrite',s=>s.add(item));await notify();
        const result=await flushLocked(id);
        if(result)return result;
        const state=await projected();return c.queuedResult(state,item);
      });
      const result=await response(path,body,undefined,timeout);
      if(!body&&(c.data||[]).includes(path)) {
        await lock(async()=>{await save(result)});
        // The worker caches the canonical snapshot; pending local edits remain a separate overlay.
        const state=await projected();void warm(state);return state;
      }
      return result;
    }
    let registration;
    const started=(async()=>{
      if(!('serviceWorker'in navigator))throw Error('Offline storage is not supported in this browser');
      registration=await navigator.serviceWorker.register(absolute(c.worker||'sw.js'),{scope:base.pathname,updateViaCache:'none'});
      await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
        const t=setTimeout(()=>reject(Error('Offline worker did not take control')),15000);
        navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(t);resolve()},{once:true});
      });
      try{await navigator.storage?.persist?.()}catch{}
      return registration;
    })();
    started.catch(e=>{warmingError='Offline saving unavailable: '+e.message;void notify()});
    async function warm(state) {
      if(warming||!state)return;warming=true;
      try {
        await started;
        const assets=[...new Set(c.assetURLs(state).map(absolute))].filter(u=>u.startsWith(base.origin+'/'));
        total=assets.length;done=0;ready=false;warmingError='';await notify();
        const dataCache=await caches.open(c.prefix+'data-v1');
        for(const path of c.data||[]){const u=absolute(path);if(navigator.onLine){const r=await fetch(u,{cache:'no-store'});if(!r.ok||r.redirected)throw Error('Library could not be saved');await dataCache.put(u,r)}}
        const cache=await caches.open(c.prefix+'assets-v1');let cursor=0;
        await Promise.all(Array.from({length:Math.min(c.concurrency||4,assets.length||1)},async()=>{
          while(cursor<assets.length){const u=assets[cursor++];if(!await cache.match(u)){
            const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(30000)});
            if(!r.ok||r.redirected)throw Error('Some artwork is not saved yet');await cache.put(u,r);
          }done++;await notify()}
        }));
        ready=true;
      }catch(e){warmingError=navigator.onLine?'Offline saving paused — '+e.message:''}
      finally{warming=false;await notify()}
    }
    addEventListener('online',()=>{void flush().then(()=>meta()).then(warm)});
    addEventListener('offline',()=>{void notify()});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&navigator.onLine){void flush();void registration?.update().catch(()=>{})}});
    // Bounded low-frequency retries only while visible; never a reload.
    const timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void flush()},30000);
    void notify();void flush();
    return Object.freeze({request,flush,status,started,warm,projected,
      dispose(){clearInterval(timer);channel?.close()}});
  }
  globalThis.WizOffline=Object.freeze({version:1,create});
})();
