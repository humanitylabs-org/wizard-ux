import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sourceLabel, installedOnlyApps} from '../web/store/store-source.js';
import {resolveInstalled} from '../web/store/store-status.js';
import {parseInstallLink, installShareLink} from '../web/store/install-link.js';
import {createStoreDataRoutes, PREFIX, wamMetadata} from '../tools/store-data-origin.mjs';
import {linkPreview, manifestProjection} from '../tools/store-link-preview.mjs';
const C='a'.repeat(40);
for(const [app,kind] of [[{source:'standard'},'public'],[{private:true},'beta'],[{source:'owner-private'},'beta'],[{channel:'alpha'},'beta'],[{source:'friends-beta'},'beta'],[{repo:'local/airlock'},'local'],[{local:'/private/path'},'local'],[{source:{local:'/private/path'}},'local'],[{source:'local'},'local'],[{source:'link'},'link'],[{install_link:true},'link']]) test('source '+JSON.stringify(app),()=>assert.equal(sourceLabel(app).kind,kind));
test('installed provenance wins and details stay display-only',()=>{
 assert.deepEqual(sourceLabel({private:true,source:'owner-private'},{source:'standard'}),{kind:'public',label:'Public',detail:''});
 assert.equal(sourceLabel({source:'standard'},{source:'link',from:'Jane'}).detail,'Shared with you by Jane');
 assert.equal(sourceLabel({private:true,publisher:'Jane'}).detail,'Shared with you by Jane');
 assert.equal(sourceLabel({source:'link'},{repo:'local/airlock'}).kind,'local');
});
test('installed link source wins over a later catalog sidecar',()=>{
 const a={id:'linked',repo:'o/r',commit:C,source:'standard',installed_app_id:'linked',installed_commit:C,installed_source:'standard'};
 const i=resolveInstalled(a,{wam:[{id:'linked',repo:'o/r',commit:C,source:'link'}]},[]);assert.equal(sourceLabel(a,i).kind,'link');
 assert.deepEqual(wamMetadata({apps:[{id:'local-app',source:{local:'/secret/path'}}]}),[{id:'local-app',source:'local'}]);
});
test('unmatched installed identities merge without duplicate catalog pins',()=>{
 const catalog=[{id:'public',repo:'o/public'}];
 assert.deepEqual(installedOnlyApps(catalog,[{id:'public',repo:'o/public'},{id:'airlock',repo:'local/airlock',type:'view',name:'Airlock'}]).map(x=>[x.id,x.type,x.name]),[['airlock','view','Airlock']]);
});
for(const input of ['wizard://install?repo=github.com/Owner/Repo&commit='+C+'&from=Jane%20Doe','https://box.example/wizard-os-home/?view=install&repo=Owner/Repo&commit='+C+'&from=Jane%20Doe',new URLSearchParams({repo:'https://github.com/Owner/Repo',commit:C,from:'Jane Doe'})]) test('valid install link '+input,()=>assert.deepEqual(parseInstallLink(input),{ok:true,repo:'Owner/Repo',commit:C,from:'Jane Doe'}));
test('unversioned repo input is accepted; sharing always pins',()=>{
 assert.equal(parseInstallLink('Owner/Repo').commit,'');
 assert.equal(installShareLink({repo:'https://github.com/Owner/Repo',commit:C}),'wizard://install?repo=github.com%2FOwner%2FRepo&commit='+C);
 assert.equal(installShareLink({repo:'local/airlock',commit:C}),'');
});
for(const input of ['wizard://unknown?repo=o/r','wizard://install?repo=https://evil.test/o/r','wizard://install?repo=o/r/../x','wizard://install?repo=-o/r','wizard://install?repo=o/r&commit=main','wizard://install?repo=o/r&commit=','wizard://install?repo=o/r&from=%3Cb%3EJane','wizard://install?repo=o/r&from=%0A','wizard://install?repo=o/r&from='+ 'x'.repeat(61),'wizard://install?repo=o/r&unknown=1','wizard://install?repo=o/r&repo=x/y','wizard://install?repo=o/r#x',null]) test('bad link is a plain error '+input,()=>{
 const r=parseInstallLink(input); assert.equal(r.ok,false); assert.equal(typeof r.error,'string'); assert.ok(!/[<>\n]/.test(r.error));
});
test('registry metadata validates each display scalar and drops paths/config/objects',()=>{
 const fields={name:'Airlock',summary:'Private recordings',type:'view',source:'local'};
 assert.deepEqual(wamMetadata({apps:[{id:'airlock',...fields,config:{secret:'hidden'},path:'/secret',url:'https://secret'}]}),[{id:'airlock',...fields}]);
 assert.deepEqual(wamMetadata({apps:[{id:'bad',name:'x'.repeat(81),summary:'x'.repeat(301),type:'shell',source:{secret:1}},{id:'nested',name:{secret:1},summary:['private'],type:{secret:1}}]}),[{id:'bad'},{id:'nested'}]);
});
const markdown='---\nid: shared\nname: Shared app\nsummary: >-\n  A shared\n  fixture app.\ntype: view\nversion: "1.2.3"\npublisher: Jane\nconfig:\n  password: never-project\n---\n# Shared';
function fixture() { const calls=[]; return {calls,fetchImpl:async(url,opts)=>{calls.push({url,opts});if(url.endsWith('/commits/HEAD'))return Response.json({sha:C});return new Response(markdown);}}; }
test('link preview HTTP route resolves HEAD, pins manifest and exposes no credentials',async()=>{
 const f=fixture(), route=createStoreDataRoutes({...f,index:async()=>({status:200,body:{source:'owner-private',private:true}})});
 const s=http.createServer(route);await new Promise(r=>s.listen(0,'127.0.0.1',r));
 try {
  const base=`http://127.0.0.1:${s.address().port}${PREFIX}wizard/v1/link`;
  const r=await fetch(base+'?repo=o/r'), j=await r.json();
  assert.equal(r.status,200); assert.deepEqual(j,{id:'shared',name:'Shared app',summary:'A shared fixture app.',type:'view',version:'1.2.3',publisher:'Jane',repo:'o/r',commit:C,source:'link',private:true,catalog_source:'owner-private'});
  assert.equal(f.calls.length,2); assert.ok(f.calls[1].url.endsWith('/contents/wizard.md?ref='+C));
  assert.ok(f.calls.every(c=>c.opts.redirect==='error' && c.opts.signal));
  assert.ok(!JSON.stringify(j).includes('never-project'));
  const before=f.calls.length;assert.equal((await fetch(base+'?repo=https://evil.test/x/y')).status,400);assert.equal(f.calls.length,before);
  assert.equal((await fetch(base+'?repo=o/r',{method:'POST'})).status,405);
 }finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});
test('pinned preview skips HEAD and auth is server-only',async()=>{
 const f=fixture();const r=await linkPreview(new URLSearchParams({repo:'o/r',commit:C}),{...f,readToken:()=> 'fixture-token'});
 assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].opts.headers.Authorization,'Bearer fixture-token');assert.ok(!JSON.stringify(r).includes('fixture-token'));
});
for(const mode of ['404','redirect','oversized','bad-manifest','bad-sha']) test('preview fails closed: '+mode,async()=>{
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.redirect,'error');
  if(mode==='redirect')throw Error('private internal details');
  if(mode==='404')return new Response('',{status:404});
  if(url.endsWith('/commits/HEAD')) return Response.json({sha:mode==='bad-sha'?'main':C});
  return new Response(mode==='oversized'?'x'.repeat(65537):'---\nid: bad\nname: Missing type\n---\n');
 };
 const r=await linkPreview(new URLSearchParams({repo:'o/r'}),{fetchImpl,readToken:()=>''});assert.equal(r.status,422);assert.ok(!r.body.error.includes('private internal'));
});
test('manifest duplicates and complex display values are refused',()=>{
 assert.throws(()=>manifestProjection(markdown.replace('name: Shared app','name: Shared app\nname: Other')));
 assert.throws(()=>manifestProjection(markdown.replace('name: Shared app','name: {password: secret}')));
});
test('core install deep links preserve parameters and use normal view dispatch',()=>{
 const calls=[], ctx={URL,URLSearchParams,location:new URL('https://box.example/wizard-os-home/'),window:{WizCore:{}},history:{state:null,replaceState(){}}};vm.runInNewContext(readFileSync(new URL('../web/core/deeplink.js',import.meta.url),'utf8'),ctx);
 const d=ctx.window.WizCore.deeplink;d.handle({view:(...v)=>calls.push(v)});
 assert.equal(d.route('https://box.example/wizard-os-home/?view=install&repo=o/r&from=Jane'),true);
 assert.deepEqual(Array.from(calls[0]),['install','','?view=install&repo=o/r&from=Jane']);
});
