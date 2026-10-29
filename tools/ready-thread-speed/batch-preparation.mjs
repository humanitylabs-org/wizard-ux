// Acceptance-only preparation: no production state injection or TTL override.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {historyRevision} from './cache-evidence.mjs';

export const SAMPLE_IDS=Array.from({length:30},(_,i)=>`wizard_speed_${i+1}`);
export function implementationCaps(ux) {
  const text=readFileSync(join(ux,'web/live.js'),'utf8');
  const max=Number(text.match(/TC_MAX\s*=\s*(\d+)/)?.[1]);
  const bytes=Number(text.match(/TC_BYTES\s*=\s*([\d.e+]+)/)?.[1]);
  const want=text.match(/const want = \[(.*)\]\.filter\(.*\)\.slice\(0,\s*(\d+)\)/);
  const preload=Number(want?.[2]),preloadOrder=[...(want?.[1]||'').matchAll(/g\.(ready|errors|working)/g)].map(m=>m[1]);
  assert.ok(max>=SAMPLE_IDS.length&&bytes>0&&preload>0&&preloadOrder.length===3,'read actual exported implementation caps, not a test approximation');
  return {max,bytes,preload,preloadOrder};
}
export function assertOldCopy(snapshot,old,current) {
  assert.equal(snapshot.key,current.key);assert.equal(snapshot.trusted,true);
  assert.equal(snapshot.accepted,null,'the exact new revision rejects the old copy');
  assert.ok(snapshot.persisted?.rows,'a real persisted old copy, not just an absent cache');
  assert.equal(historyRevision(snapshot.persisted.rows).contentSha256,old.contentSha256,'every persisted old role/content/timestamp remains intact');
  assert.equal(String(snapshot.persisted.rev).split('|').slice(0,3).join('|'),old.key,'old copy retains its original revision');
}
export async function waitForRevisions(page,revisions,observe,timeout=45000) {
  const until=Date.now()+timeout;
  do {
    await page.evaluate(()=>WizLive.refresh());
    const snapshot=await page.evaluate(ids=>({at:performance.now(),trusted:WizLive.listTrusted(),rows:ids.map(id=>{
      const s=WizLive.session(id);return {id,key:WizLive.contentKey(s),messageCount:s?.messageCount,lastAssistantAt:s?.lastAssistantAt,lastUserAt:s?.lastUserAt};
    }),raw:window.__speedRawList||null}),[...revisions.keys()]);
    await observe(snapshot);
    if(snapshot.trusted&&snapshot.rows.every(s=>s.key===revisions.get(s.id).key)) {
      assert.equal(snapshot.raw?.status,200,'exact compact HTTP list is retained before normalization');
      for(const row of snapshot.rows) {
        const raw=snapshot.raw.rows.find(s=>s.id===row.id),expected=revisions.get(row.id);
        assert.ok(raw,'target is present in the actual bounded HTTP list');
        for(const k of ['messageCount','lastAssistantAt','lastUserAt'])assert.equal(raw[k],expected[k],'raw HTTP and client agree on '+k);
      }
      return snapshot;
    }
    await new Promise(r=>setTimeout(r,100));
  }while(Date.now()<until);
  throw Error('entire batch exact canonical revision barrier timed out after '+timeout+'ms');
}

export function exactMatrix(results) {
  const cells=['phone','desktop'].flatMap(shell=>['nebula','signal'].map(skin=>({shell,skin})));
  const groups=cells.flatMap(c=>['current','empty','stale'].map(state=>({...c,state})));
  const cases=['long-history','no-js-errors','pending-voice-hang-deadline-retry','ready-prefetch-uses-existing-current-cache'];
  return results.api.length===3&&['health','detail','history'].every(name=>results.api.filter(r=>r.name===name&&r.n===50).length===1)&&
    results.browser.filter(r=>r.state).length===12&&groups.every(g=>results.browser.filter(r=>r.shell===g.shell&&r.skin===g.skin&&r.state===g.state&&r.n===30).length===1)&&
    results.browser.filter(r=>r.case).length===16&&cells.every(c=>cases.every(name=>results.browser.filter(r=>r.shell===c.shell&&r.skin===c.skin&&r.case===name).length===1));
}
