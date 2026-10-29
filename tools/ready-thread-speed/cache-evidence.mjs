// Acceptance-only content/revision evidence. Never modifies production stores.
import assert from 'node:assert/strict';

export function historyRevision(rows) {
  assert.ok(Array.isArray(rows)&&rows.length,'nonempty canonical history');
  const latest=role=>rows.filter(r=>r.role===role).at(-1);
  const iso=r=>r?new Date(typeof r.timestamp==='number'?r.timestamp*1000:r.timestamp).toISOString():undefined;
  const revision={messageCount:rows.length,lastAssistantAt:iso(latest('assistant')),lastUserAt:iso(latest('user'))};
  return {...revision,key:[revision.messageCount,revision.lastAssistantAt,revision.lastUserAt].join('|'),
    marker:latest('assistant').content.split('\n')[0]};
}

export function assessCache(snapshot,revision) {
  assert.equal(snapshot.key,revision.key,'the exact canonical revision, not just any changed key');
  assert.equal(snapshot.trusted,true,'live canonical list authority');
  if(snapshot.accepted===null)return 'rejected-old-copy';
  assert.equal(snapshot.accepted.length,revision.messageCount,'accepted cache has the exact canonical count');
  const last=snapshot.accepted.filter(r=>r.role==='assistant').at(-1);
  assert.equal(last?.content.split('\n')[0],revision.marker,'accepted cache contains the exact newest canonical answer');
  assert.equal(historyRevision(snapshot.accepted).key,revision.key,'accepted content timestamps match canonical revision');
  return 'current-copy-refilled';
}

// Public accepted-cache API + read-only persisted cache inspect. TC/INFLIGHT remain
// private. Fetch instrumentation reports the actual request lifecycle separately.
export async function cacheEvidence(page,id) {
  return page.evaluate(async id=>{
    const s=WizLive.session(id),accepted=WizLive.cachedMessages(id);
    let persisted=null,storageError=null;
    try {
      persisted=await new Promise((resolve,reject)=>{
        const q=indexedDB.open('wos-thread-cache',1);
        q.onerror=()=>reject(q.error);
        q.onsuccess=()=>{const db=q.result;if(!db.objectStoreNames.contains('t')){db.close();resolve(null);return;}
          const r=db.transaction('t').objectStore('t').get(id);
          r.onsuccess=()=>{resolve(r.result||null);db.close()};r.onerror=()=>{reject(r.error);db.close()};};
      });
    }catch(e){storageError=String(e)}
    return {id,at:performance.now(),key:WizLive.contentKey(s),trusted:WizLive.listTrusted(),
      list:s?{id:s.id,messageCount:s.messageCount,lastAssistantAt:s.lastAssistantAt,lastUserAt:s.lastUserAt,preview:s.preview}:null,
      accepted,persisted,storageError,traffic:(window.__speedTraffic||[]).filter(r=>r.url.includes('/'+id+'/messages?'))};
  },id);
}

export async function waitForRevision(page,id,revision,observe,timeout=15000) {
  const until=Date.now()+timeout;
  do {
    await page.evaluate(()=>WizLive.refresh());
    const snapshot=await cacheEvidence(page,id);await observe(snapshot);
    if(snapshot.trusted&&snapshot.key===revision.key)return snapshot;
    await new Promise(r=>setTimeout(r,100));
  }while(Date.now()<until);
  throw Error('exact canonical revision barrier timed out: '+JSON.stringify({id,revision}));
}
