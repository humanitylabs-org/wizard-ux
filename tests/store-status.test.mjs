import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInstalled, releaseState, preferredRelease, compareApps, isUserApp } from '../web/store/store-status.mjs';
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
 assert.equal(resolveInstalled({id:'wizard-music',repo:'humanitylabs-org/wizard-music'},{wam:[],shell},[]).id,'wizard-music');
 assert.equal(resolveInstalled({id:'wizard-calendar',repo:'wrong/repo'},{wam:[],shell},[]),null);
 assert.equal(resolveInstalled({id:'wizard-calendar',repo:'humanitylabs-org/wizard-calendar'},{wam:[],shell:[{id:'calendar',url:'/another/'}]},[]),null);
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
