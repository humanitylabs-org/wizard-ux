import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateEntry,validateSnapshot,subscribe,refresh,cached,atomic,publish,install} from '../tools/wizard-alpha.mjs';
const commit='a'.repeat(40), second='b'.repeat(40);
const entry={id:'demo-app',name:'Demo',summary:'Fixture only',repo:'example/demo',version:'1.0',commit,tag:'v1.0',architectures:['arm64','amd64'],images:Object.fromEntries(['arm64','amd64'].map(arch=>[arch,{asset:`demo-${arch}.tar.gz`,sha256:'c'.repeat(64),image_id:'sha256:'+'d'.repeat(64),image:'example/demo:1.0',asset_id:arch==='arm64'?1:2,bytes:100}])),gateway:{path:'/demo/',strip_prefix:true}};
const source={schema:1,id:'wizard-alpha',name:'Wizard Alpha',channel:'alpha'};
function fake() {
 const s={apps:[],revision:'e'.repeat(40),fail:false,writes:[],race:null};
 const api=async(path,body)=>{
  if(s.fail) throw Error('github_read_failed');
  if(body) {
   s.writes.push(body); if(s.race) {const f=s.race;s.race=null;f(s);throw Error('github_write_failed');}
   const a=JSON.parse(Buffer.from(body.content,'base64'));s.apps=s.apps.filter(x=>x.id!==a.id).concat(a);return {commit:{sha:s.revision}};
  }
  if(path.startsWith('repos/example/catalog/commits/')) return {sha:s.revision};
  if(path.includes('/git/trees/')) return {tree:[{path:'source.json',mode:'100644',type:'blob',sha:'source',size:100},...s.apps.map(a=>({path:`apps/${a.id}.json`,mode:'100644',type:'blob',sha:a.id,size:1000}))]};
  if(path.includes('/git/blobs/')) {const key=path.split('/').at(-1);return {encoding:'base64',size:1000,content:Buffer.from(JSON.stringify(key==='source'?source:s.apps.find(a=>a.id===key))).toString('base64')};}
  if(path.includes('/contents/apps/')) return {sha:'f'.repeat(40)};
  if(path.includes('/contents/wizard.md')) return {content:Buffer.from('---\nid: demo-app\n---').toString('base64')};
  if(path.includes('/releases/tags/')) return {assets:Object.values(entry.images).map(i=>({id:i.asset_id,name:i.asset,size:i.bytes,digest:'sha256:'+i.sha256}))};
  if(path.includes('/commits/')) return {sha:path.endsWith('/v1.0')?commit:path.split('/').at(-1)};
  throw Error('unexpected_fixture_route');
 };
 return {s,api};
}
function home(t) {const p=mkdtempSync(join(tmpdir(),'wizard-alpha-test-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('schema rejects command fields, malformed identity, mutable pin and asset substitutions',()=>{
 assert.equal(validateEntry(entry).id,'demo-app');
 for(const change of [{id:'../escape'},{commit:'main'},{repo:'example/demo;echo'},{token:'secret'},{install_command:'run'},{architectures:['arm64','arm64']},{gateway:{path:'//outside/',strip_prefix:true}}]) assert.throws(()=>validateEntry({...entry,...change}));
 assert.throws(()=>validateSnapshot({source,revision:commit,apps:[entry,entry]}));
 assert.throws(()=>validateEntry({...entry,images:{arm64:{...entry.images.arm64,asset:'../bad'}}}));
});
test('independent subscribers; failed refresh retains exact valid snapshot and bounded warning',async t=>{
 const a=home(t),b=home(t),f=fake();f.s.apps=[entry];
 await subscribe('example/catalog','feature/test',a,f.api);await subscribe('example/catalog','feature/test',b,f.api);
 f.s.fail=true;const r=await refresh(a,{force:true,api:f.api});assert.equal(r.status.stale,true);assert.equal(r.snapshot.apps[0].commit,commit);assert.equal(cached(b).status.stale,false);
 assert.ok(!JSON.stringify(cached(a).status).includes('example/catalog'));assert.equal(cached(a).status.error,'source_unavailable');
});
test('bad new subscriber never registers source; existing source cannot silently change',async t=>{
 const h=home(t),f=fake();f.s.fail=true;await assert.rejects(subscribe('example/catalog','main',h,f.api));assert.equal(existsSync(join(h,'config.json')),false);
 f.s.fail=false;await subscribe('example/catalog','feature/test',h,f.api);await assert.rejects(subscribe('example/other','feature/test',h,f.api),/subscription_exists/);
});
test('publisher CAS idempotence, same-app conflict, and default branch refusal',async t=>{
 const h=home(t),f=fake();await subscribe('example/catalog','feature/test',h,f.api);
 const r=await publish(entry,h,{api:f.api,expected:'absent'});assert.equal(r.revision,f.s.revision);assert.equal(f.s.writes.length,1);
 assert.equal((await publish(entry,h,{api:f.api})).unchanged,true);assert.equal(f.s.writes.length,1);
 await assert.rejects(publish(entry,h,{api:f.api,expected:second}),/publish_conflict/);
 const changed={...entry,release_notes:'Edited note'};f.s.race=s=>{s.apps=[{...entry,release_notes:'Other author'}];};
 await assert.rejects(publish(changed,h,{api:f.api}),/publish_conflict/);assert.equal(f.s.apps[0].release_notes,'Other author');
 atomic(join(h,'config.json'),{schema:1,repo:'example/catalog',ref:'main'});await assert.rejects(publish(entry,h,{api:f.api}),/review_branch/);
});
test('different-app concurrent write survives retry without lost entries',async t=>{
 const h=home(t),f=fake();await subscribe('example/catalog','feature/test',h,f.api);
 f.s.race=s=>{s.apps=[{...entry,id:'other-app'}];};await publish(entry,h,{api:f.api});assert.deepEqual(f.s.apps.map(a=>a.id).sort(),['demo-app','other-app']);assert.equal(f.s.writes.length,2);
});
test('source-qualified install rejects wrong source, stale pin, missing activation and repo conflict before WAM',async t=>{
 const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
 let calls=0;const runner=async()=>{calls++;return {stdout:''};};
 await assert.rejects(install({source:'other',id:entry.id,commit},h,{runner,api:f.api}),/source_not_subscribed/);
 await assert.rejects(install({source:source.id,id:entry.id,commit:second},h,{runner,api:f.api}),/selected_release/);
 atomic(join(h,'install-policy.json'),{wam:['wam']});await assert.rejects(install({source:source.id,id:entry.id,commit},h,{runner,api:f.api}),/activation_not_configured/);
 atomic(join(h,'registry.json'),{apps:[{id:entry.id,repo:'wrong/repo'}]});atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json')});
 await assert.rejects(install({source:source.id,id:entry.id,commit,update:true},h,{runner,api:f.api}),/installed_repository_conflict/);assert.equal(calls,0);
});
test('healthy process without real activation receipt is never reported as Open',async t=>{
 const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
 atomic(join(h,'registry.json'),{apps:[]});atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json')});
 const calls=[];const runner=async(argv,opts)=>{calls.push(argv);const d=JSON.parse(readFileSync(opts.env.WAM_PRIVATE_CATALOG));assert.equal(d.apps[0].commit,commit);return {stdout:'healthy'};};
 await assert.rejects(install({source:source.id,id:entry.id,commit},h,{runner,api:f.api}));assert.equal(calls.length,2);assert.equal(existsSync(join(h,'installed.json')),false);assert.deepEqual(calls[0],['wam','install',entry.id]);
});
test('bare WAM update passthrough cannot claim pinned lifecycle support',async t=>{
 const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
 atomic(join(h,'registry.json'),{apps:[{id:entry.id,repo:entry.repo,commit}]});atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json')});
 let calls=0;await assert.rejects(install({source:source.id,id:entry.id,commit,update:true},h,{api:f.api,runner:async()=>{calls++;}}),/pinned_update_adapter_required/);assert.equal(calls,0);
});
test('installed WAM aliases retain exact source identity and launcher on explicit update',async t=>{
 const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
 atomic(join(h,'registry.json'),{apps:[{id:'demo-next',app_id:entry.id,repo:entry.repo,commit}]});atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json'),pinned_lifecycle:1});
 const runner=async argv=>{if(argv[0]==='adapter')atomic(argv[argv.indexOf('--receipt')+1],{id:entry.id,commit,status:'running',open_verified:true,view:'/demo-next/',launcher_id:'demo-next'});return {stdout:''};};
 await install({source:source.id,id:entry.id,commit,update:true},h,{api:f.api,runner});
 assert.equal(JSON.parse(readFileSync(join(h,'installed.json')))[entry.id].launcher_id,'demo-next');
 await assert.rejects(install({source:source.id,id:entry.id,commit},h,{api:f.api,runner}),/already_installed/);
});
test('conflicting alias repo or ambiguous installed identity is rejected before lifecycle',async t=>{
 const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
 atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json'),pinned_lifecycle:1});
 atomic(join(h,'registry.json'),{apps:[{id:'demo-next',app_id:entry.id,repo:'wrong/repo',commit}]});
 const runner=async()=>assert.fail('must not run');await assert.rejects(install({source:source.id,id:entry.id,commit,update:true},h,{api:f.api,runner}),/installed_repository_conflict/);
 atomic(join(h,'registry.json'),{apps:[{id:'demo-next',app_id:entry.id,repo:entry.repo,commit},{id:entry.id,repo:entry.repo,commit}]});
 await assert.rejects(install({source:source.id,id:entry.id,commit,update:true},h,{api:f.api,runner}),/installed_identity_ambiguous/);
});
