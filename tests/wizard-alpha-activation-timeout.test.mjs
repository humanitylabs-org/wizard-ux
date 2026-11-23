import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {subscribe,atomic,install} from '../tools/wizard-alpha.mjs';
// The catalog fixture tests/wizard-alpha.test.mjs uses (a GitHub API stand-in serving one app).
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

// The real install(): WAM installs, then the activation adapter loads the verified archive; both through the runner.
test('activation gets the same time budget as install (containerd reloads the verified archive)', async t => {
  const h=home(t),f=fake();f.s.apps=[entry];await subscribe('example/catalog','feature/test',h,f.api);
  atomic(join(h,'registry.json'),{apps:[]});atomic(join(h,'install-policy.json'),{wam:['wam'],activate:['adapter'],registry:join(h,'registry.json')});
  const calls=[];
  const runner=async(argv,opts)=>{
    calls.push([argv[0],opts.timeout]);
    if(argv[0]==='adapter') writeFileSync(argv[argv.indexOf('--receipt')+1],JSON.stringify({id:entry.id,commit,status:'running',open_verified:true,view:'/demo-app/'}));
    return {stdout:''};
  };
  const r=await install({source:source.id,id:entry.id,commit},h,{runner,api:f.api});
  assert.equal(r.open_verified,true);
  assert.deepEqual(calls.map(c=>c[0]),['wam','adapter']);
  const [[,installT],[,activateT]]=calls;
  assert.ok(Number.isFinite(installT) && installT>=600000,`install has a long budget (${installT} ms)`);
  assert.ok(activateT>=installT,`activation ${activateT} ms is at least install ${installT} ms`);
});
