import test from 'node:test';
import assert from 'node:assert/strict';
import { installRelease } from '../web/store/store-install.js';
import { resolveInstalled, releaseState } from '../web/store/store-status.js';
import { wamMetadata } from '../tools/store-data-origin.mjs';
const pin = c => c.repeat(40);
const base = new URL('https://wizard.example/wizard-os-home/');

// Exercise the real request/receipt primitive, not a duplicate selection builder.
async function posted(a, check) {
 const original = globalThis.fetch;
 let calls = 0;
 globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(options.method,'POST');
  assert.equal(options.credentials,'same-origin');
  assert.equal(options.cache,'no-store');
  assert.equal(options.headers['X-Wizard-Store'],'1');
  const selection = JSON.parse(options.body);
  check(url, selection);
  return Response.json({state:'installed',selection});
 };
 try { await installRelease(a,{base}); assert.equal(calls,1); }
 finally { globalThis.fetch = original; }
}
test('offered Beta Update posts link and selected exact resource/repo/commit',async()=>{
 const a={id:'friend-journal',repo:'friend/journal',source:'beta',channel:'standard',commit:pin('c'),version:'1.1.0'};
 // registry.build scalar shape: resource id is id; no app_id or channel is emitted.
 const registry={apps:[{id:a.id,name:'Journal',type:'view',version:'1.0.0',status:'running',urn:'friend-journal:wizard',repo:a.repo,commit:pin('b'),source:'link'}]};
 const i=resolveInstalled(a,{wam:wamMetadata(registry),shell:[],complete:true},[]);
 assert.equal(releaseState(a,i,false,true),'update');
 await posted({...a,operation:'update'},(url,body)=>{
  assert.equal(url,new URL('store-install/'+i.id,base).href);
  assert.deepEqual(body,{source:'link',repo:a.repo,commit:a.commit,operation:'update'});
 });
 assert.equal(registry.apps[0].source,'link');
});
test('request primitive preserves an explicitly selected staged resource ID, not metadata app_id',async()=>{
 // Contract-only: caller already selected this id. Does NOT prove controller alias routing,
 // arbitrary staging support, or server authorization of a differently named manifest.
 const a={id:'search-preview',repo:'humanitylabs-org/wizard-search',source:'beta',commit:pin('d'),operation:'update'};
 await posted(a,(url,body)=>{
  assert.equal(url,new URL('store-install/search-preview',base).href);
  assert.deepEqual(body,{source:'link',repo:a.repo,commit:a.commit,operation:'update'});
 });
});
test('Standard, Alpha, private and link request policy is unchanged for install/update/switch',async()=>{
 for(const source of ['standard','wizard-alpha','owner-private','link']) for(const operation of ['install','update','switch']) {
  const a={id:'journal',source,repo:'friend/journal',commit:pin('e'),operation};
  await posted(a,(url,body)=>{
   assert.equal(url,new URL('store-install/journal',base).href);
   assert.deepEqual(body,{source,repo:a.repo,commit:a.commit,operation});
  });
 }
});
test('normalized Beta request rejects a receipt retaining the discovery source',async()=>{
 const original=globalThis.fetch;
 const a={id:'journal',source:'beta',repo:'friend/journal',commit:pin('f'),operation:'update'};
 globalThis.fetch=async()=>Response.json({state:'installed',selection:{source:'beta',repo:a.repo,commit:a.commit,operation:a.operation}});
 try { await assert.rejects(installRelease(a,{base}),/different release/); }
 finally { globalThis.fetch=original; }
});
