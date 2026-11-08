import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInstalled, releaseState, preferredRelease, compareApps, isUserApp } from '../web/store/store-status.js';
import { wamMetadata } from '../tools/store-data-origin.mjs';
const pin = c => c.repeat(40);
const app = {id:'cinequeue',repo:'org/movies',commit:pin('a'),version:'0.2.1',source:'wizard-alpha',channel:'alpha'};
const wam = {id:'cinequeue-next',app_id:'cinequeue',repo:'org/movies',commit:pin('a'),version:'0.2.1'};
const snapshot = {wam:[wam],shell:[{id:'cinequeue',url:'/cinequeue/'},{id:'cinequeue-next',url:'/cinequeue-next/'}],complete:true};
test('exact WAM identity and commit opens staged Movies, never the daily copy',()=>{
 const i=resolveInstalled(app,snapshot,[]); assert.equal(i.id,'cinequeue-next'); assert.equal(releaseState(app,i,false,true),'installed');
 assert.equal(releaseState(app,i,true,true),'installed');
});
test('host Calendar alias requires reviewed repo + canonical shell path; Music is exact ID',()=>{
 const shell=[{id:'calendar',url:'/wizard-calendar/'},{id:'wizard-music',url:'/wizard-music/'}];
 assert.equal(resolveInstalled({id:'wizard-calendar',repo:'humanitylabs-org/wizard-calendar'},{wam:[],shell},[]).id,'calendar');
 assert.equal(resolveInstalled({id:'android-apps',repo:'humanitylabs-org/android-apps'},{wam:[],shell:[{id:'android-apps',url:'/android-apps/'}]},[]).id,'android-apps'); // host service registered via launcher.json
 assert.equal(resolveInstalled({id:'wizard-music',repo:'humanitylabs-org/wizard-music'},{wam:[],shell},[]).id,'wizard-music');
 assert.equal(resolveInstalled({id:'wizard-calendar',repo:'wrong/repo'},{wam:[],shell},[]).conflict,true);
 assert.equal(resolveInstalled({id:'wizard-music',repo:'wrong/repo'},{wam:[],shell},[]).conflict,true);
 assert.equal(resolveInstalled({id:'wizard-calendar',repo:'humanitylabs-org/wizard-calendar'},{wam:[],shell:[{id:'calendar',url:'/another/'}]},[]).conflict,true);
});
test('Wizard Notes Alpha opens the existing Notes copy only for the reviewed repo and path',()=>{
 const alpha={id:'wizard-notes',repo:'humanitylabs-org/wizard-notes',source:'wizard-alpha',channel:'alpha'};
 const local={wam:[{id:'notes',repo:'local/notes',status:'running'}],shell:[{id:'notes',url:'/notes/',status:'running'}]};
 const installed=resolveInstalled(alpha,local,[]);
 assert.equal(installed.id,'notes');
 assert.equal(releaseState(alpha,installed,false,true),'installed');
 assert.equal(resolveInstalled({...alpha,repo:'foreign/repo'},local,[]).conflict,true);
 assert.equal(resolveInstalled(alpha,{wam:[],shell:[{id:'notes',url:'/different/'}]},[]).conflict,true);
 assert.equal(resolveInstalled(alpha,{wam:[],shell:[]},[]),null);
 assert.equal(releaseState(alpha,null,false,true),'get');
});
test('repo mismatch never falls back to same-ID shell and never opens wrong app',()=>{
 const i=resolveInstalled({...app,repo:'other/repo'},snapshot,[]); assert.equal(i.conflict,true);
 assert.equal(releaseState(app,i,false,true),'conflict');
});
test('same name does not match; unknown installed status is not Get',()=>{
 assert.equal(resolveInstalled(app,{wam:[],shell:[{id:'different',name:'Movies',url:'/different/'}]},[]),null);
 assert.equal(releaseState(app,null,false,false),'unknown');
 assert.equal(releaseState(app,null,false,true),'get');
});
test('unknown pin is Open by default; explicit other release is Switch, not Update',()=>{
 const i={id:'calendar'};
 assert.equal(releaseState(app,i,false,true),'installed');
 assert.equal(releaseState(app,i,true,true),'switch');
 assert.equal(releaseState(app,{...wam,commit:pin('b')},false,true),'installed');
 assert.equal(releaseState(app,{...wam,commit:pin('b')},true,true),'switch');
});
test('only proven newer same source/channel semver is Update',()=>{
 const i={...wam,commit:pin('b'),version:'0.2.0',source:'wizard-alpha',channel:'alpha'};
 assert.equal(releaseState(app,i,false,true),'update');
 for(const change of [{source:'owner-private'},{channel:'standard'},{version:'0.3.0-private.2'},{version:'unknown'},{version:'0.2.1'},{version:'0.2.1+old'}]) {
  assert.equal(releaseState(app,{...i,...change},true,true),'switch');
 }
 assert.equal(releaseState(app,i,false,false),'unknown');
});
test('prefer exact installed Wisdom release, preserve explicit Alpha selection separately',()=>{
 const alpha={...app,id:'wisdom',commit:pin('b'),version:'0.2.0-testing.1'};
 const current={...alpha,commit:pin('c'),version:'0.3.0-private.2',source:'owner-private',channel:'standard'};
 const a={...alpha,releases:[alpha,current]}; const i={id:'wisdom',repo:app.repo,commit:pin('c')};
 assert.equal(preferredRelease(a,i).commit,pin('c'));
 assert.equal(releaseState(alpha,i,true,true),'switch');
});
test('Alpha first, deterministic name/id/repo remainder, shell capability is excluded',()=>{
 const rows=[{id:'b',name:'Beta'},{id:'a',name:'Apple'},{id:'z',name:'Zed',alpha_badge:'Alpha'}];
 assert.deepEqual(rows.sort(compareApps).map(a=>a.id),['z','a','b']);
 for(const a of [{id:'wizard-ux'},{id:'wizard-shell'},{id:'other-shell',provides:['shell']},{id:'system-ui',category:'interface'}]) assert.equal(isUserApp(a),false);
 assert.equal(isUserApp({id:'calendar',category:'app'}),true);
});

// Beta discovery uses link install provenance (UX#1188); this shared status primitive
// must compare the next catalog head with the exact WAM resource, not its display label.
const beta = {id:'friend-journal',repo:'friend/journal',commit:pin('c'),version:'1.1.0',source:'beta',channel:'standard'};
// Scalar subset of registry.build (wam/registry.py:120-148): no app_id or channel.
const linked = {id:beta.id,name:'Journal',type:'view',repo:beta.repo,commit:pin('b'),version:'1.0.0',source:'link',status:'running',urn:'friend-journal:wizard'};
test('registry-shaped same-ID Beta/link metadata offers Update (status only)',()=>{
 const snapshot={wam:wamMetadata({apps:[linked]}),shell:[],complete:true};
 const i=resolveInstalled(beta,snapshot,[]);
 assert.equal(i.id,beta.id); assert.equal(i.repo,beta.repo); assert.equal(i.source,'link');
 for(const explicit of [false,true]) {
  assert.equal(releaseState({...beta,source:'link',channel:undefined},i,explicit,true),'update');
  assert.equal(releaseState(beta,i,explicit,true),'update');
 }
 assert.equal(i.source,'link','status never rewrites installed provenance');
});
test('Beta/link compatibility is symmetric and accepts normalized explicit repository identity',()=>{
 assert.equal(releaseState({...beta,source:'link'},{...linked,source:'beta'},true,true),'update');
 // Direct releaseState normalization control only: URL-shaped repos are rejected by wamMetadata.
 assert.equal(releaseState(beta,{...linked,repo:'https://github.com/Friend/Journal'},true,true),'update');
});
test('Beta/link compatibility never infers repository identity from an app ID or absent repository',()=>{
 for(const change of [{repo:'other/journal'},{repo:''},{repo:undefined}]) {
  assert.equal(releaseState(beta,{...linked,...change},true,true),'switch');
  assert.equal(releaseState(beta,{...linked,...change},false,true),'installed');
 }
 assert.equal(releaseState({...beta,repo:''},linked,true,true),'switch');
 assert.equal(resolveInstalled(beta,{wam:[{...linked,repo:'other/journal'}],shell:[],complete:true},[]).conflict,true);
});
test('Beta/link keeps exact-pin Open, conflict, completeness and explicit Switch safety',()=>{
 for(const source of ['beta','link']) {
  const a={...beta,source};
  assert.equal(releaseState(a,{...linked,commit:a.commit},true,true),'installed');
  assert.equal(releaseState(a,linked,true,false),'unknown');
  assert.equal(releaseState({...a,conflict:true},linked,true,true),'update','exact installed repository keeps the existing link control behavior');
  assert.equal(releaseState({...a,conflict:true},{...linked,repo:'other/journal'},true,true),'conflict');
  assert.equal(releaseState(a,null,false,true),'get');
  for(const change of [{version:'1.1.0'},{version:'1.2.0'},{version:'unknown'},{version:''},{channel:'alpha'}]) {
   assert.equal(releaseState(a,{...linked,...change},true,true),'switch');
   assert.equal(releaseState(a,{...linked,...change},false,true),'installed');
  }
 }
});
test('Standard, Alpha, owner-private and unknown sources never become link-compatible',()=>{
 for(const source of ['standard','wizard-alpha','owner-private','friends-beta','local','']) {
  const a={...beta,source};
  assert.equal(releaseState(a,linked,true,true),'switch',source);
  assert.equal(releaseState(beta,{...linked,source},true,true),'switch',source);
  if(source) {
   assert.equal(releaseState(a,{...linked,source,channel:'standard'},true,true),'update',source+' keeps same-source updates');
   assert.equal(releaseState(a,{...linked,source},true,true),'switch',source+' never infers a missing channel');
  }
 }
});
