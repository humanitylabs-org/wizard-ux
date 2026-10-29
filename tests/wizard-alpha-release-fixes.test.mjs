import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {locked,subscribe,proposeRelease,config} from '../tools/wizard-alpha.mjs';
import {preserveCompanions} from '../tools/wizard-alpha-setup.mjs';
const moduleURL=new URL('../tools/wizard-alpha.mjs',import.meta.url).href;
function home(t){const h=mkdtempSync(join(tmpdir(),'alpha-fixes-'));t.after(()=>rmSync(h,{force:true,recursive:true}));return h;}

test('kernel lock excludes concurrent contenders and never expires a live owner',async t=>{
 const h=home(t);let release;let entered;const ready=new Promise(r=>entered=r);
 const holder=locked(h,'refresh',async()=>{entered();await new Promise(r=>release=r);});
 await ready;utimesSync(join(h,'refresh.advisory.lock'),1,1);
 await assert.rejects(locked(h,'refresh',async()=>assert.fail('overlap')),/operation_busy/);
 release();await holder;assert.equal(await locked(h,'refresh',async()=>42),42);
});
test('SIGKILL releases the crashed owner without manual filesystem deletion',async t=>{
 const h=home(t);const child=spawn(process.execPath,['--input-type=module','-e',`import {locked} from ${JSON.stringify(moduleURL)};await locked(${JSON.stringify(h)},'install',async()=>{console.log('held');await new Promise(()=>{});});`],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGKILL'));await once(child.stdout,'data');
 const closed=once(child,'close');child.kill('SIGKILL');await closed;
 let result;for(let i=0;i<20;i++){try{result=await locked(h,'install',async()=>true);break;}catch(e){if(e.message!=='operation_busy')throw e;await new Promise(r=>setTimeout(r,20));}}
 assert.equal(result,true);
});
test('legacy lock directory is not unsafely deleted without an owner identity',async t=>{
 const h=home(t);mkdirSync(join(h,'install.lock'));await assert.rejects(locked(h,'install',async()=>{}),/legacy_lock_requires_idle_cleanup/);
});
test('setup preserves both newer companion files and provisions missing ones',t=>{
 const h=home(t),name='store-index-views.mjs';writeFileSync(join(h,name),'newer deployment bytes');const changed=[];
 preserveCompanions(h,(p,body)=>{changed.push(p);writeFileSync(p,body);});
 assert.equal(readFileSync(join(h,name),'utf8'),'newer deployment bytes');assert.deepEqual(changed,[join(h,'system-overview.mjs')]);
 preserveCompanions(h,()=>assert.fail('must preserve existing companion'));
});

const appCommit='a'.repeat(40),base='b'.repeat(40);
const entry={id:'demo-app',name:'Demo',summary:'Fixture only',repo:'example/demo',version:'1.0',commit:appCommit,tag:'v1.0',architectures:['arm64'],images:{arm64:{asset:'demo-arm64.tar.gz',sha256:'c'.repeat(64),image_id:'sha256:'+'d'.repeat(64),image:'example/demo:1.0',asset_id:1,bytes:100}},gateway:{path:'/demo/',strip_prefix:true}};
function github(){
 const s={refs:new Map([['main',base]]),docs:new Map([[base,[]]]),prs:[],writes:[],badPR:false};
 const source={schema:1,id:'wizard-alpha',name:'Wizard Alpha',channel:'alpha'};
 const api=async(path,body,env,method)=>{
  if(path==='repos/example/catalog/git/refs' && method==='POST'){s.writes.push({path,body});s.refs.set(body.ref.replace('refs/heads/',''),body.sha);return {};}
  if(path.startsWith('repos/example/catalog/git/ref/heads/')){const sha=s.refs.get(path.split('/heads/')[1]);if(!sha)throw Error('github_read_failed');return {object:{sha}};}
  if(path.startsWith('repos/example/catalog/commits/')){const ref=decodeURIComponent(path.split('/commits/')[1]);return {sha:s.refs.get(ref)||ref};}
  if(path.includes('/git/trees/')){const sha=path.split('/trees/')[1].split('?')[0];return {tree:[{path:'source.json',sha:sha+':source',mode:'100644',type:'blob',size:100},...s.docs.get(sha).map(a=>({path:`apps/${a.id}.json`,sha:sha+':'+a.id,mode:'100644',type:'blob',size:100}))]};}
  if(path.includes('/git/blobs/')){const [sha,id]=path.split('/blobs/')[1].split(':');return {encoding:'base64',size:100,content:Buffer.from(JSON.stringify(id==='source'?source:s.docs.get(sha).find(a=>a.id===id))).toString('base64')};}
  if(path.startsWith('repos/example/catalog/contents/apps/') && body){assert.notEqual(body.branch,'main');s.writes.push({path,body});const a=JSON.parse(Buffer.from(body.content,'base64'));const old=s.docs.get(s.refs.get(body.branch));const apps=old.filter(x=>x.id!==a.id).concat(a);const sha=createHash('sha1').update(JSON.stringify(apps)).digest('hex');s.docs.set(sha,apps);s.refs.set(body.branch,sha);return {commit:{sha}};}
  if(path.startsWith('repos/example/catalog/contents/apps/'))return {sha:'e'.repeat(40)};
  if(path==='repos/example/catalog/pulls' && method==='POST'){const pr={number:1,state:'open',html_url:'https://github.com/example/catalog/pull/1',head:{ref:body.head,sha:s.refs.get(body.head)},base:{ref:body.base}};s.prs.push(pr);return pr;}
  if(path.startsWith('repos/example/catalog/pulls?'))return s.prs;
  if(path==='repos/example/catalog/pulls/1')return s.badPR?{...s.prs[0],head:{...s.prs[0].head,sha:base}}:s.prs[0];
  if(path.includes('/contents/wizard.md'))return {content:Buffer.from('---\nid: demo-app\n---').toString('base64')};
  if(path.includes('/releases/tags/'))return {assets:[{id:1,name:'demo-arm64.tar.gz',size:100,digest:'sha256:'+entry.images.arm64.sha256}]};
  if(path.startsWith('repos/example/demo/commits/'))return {sha:appCommit};
  throw Error('unhandled_mock:'+path);
 };return {s,api};
}
test('one publish operation from main creates and verifies PR; retry has no duplicate and leaves main intact',async t=>{
 const h=home(t),{s,api}=github();await subscribe('example/catalog','main',h,api);
 const a=await proposeRelease(entry,h,{api,expected:'absent'});assert.equal(a.merge_required,true);assert.equal(a.visible,false);assert.equal(a.pull_number,1);
 assert.equal(config(h).ref,'main');assert.equal(s.refs.get('main'),base);assert.equal(s.docs.get(base).length,0);
 const count=s.writes.length;const b=await proposeRelease(entry,h,{api,expected:'absent'});assert.equal(b.pull_request,a.pull_request);assert.equal(s.prs.length,1);assert.equal(s.writes.length,count);
});
test('publisher requires exact remote PR head readback before reporting prepared',async t=>{
 const h=home(t),{s,api}=github();await subscribe('example/catalog','main',h,api);s.badPR=true;await assert.rejects(proposeRelease(entry,h,{api}),/pull_request_not_verified/);
});
