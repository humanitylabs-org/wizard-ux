import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {resolveInstalled, releaseState, mergeConflicts} from '../web/store/store-status.js';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const row=(repo,extra={})=>({id:'profiles',name:'Profiles',summary:'Your profile.',type:'view',repo,commit:A,version:'0.5.2',source:'standard',channel:'standard',releases:[],conflict:true,...extra});
// The live shape: an original repository and a GitHub fork both list the same app ID; the original is installed.
const original=row('origin-owner/profiles',{publisher:'origin-owner'});
const fork=row('fork-owner/profiles',{commit:B,version:'0.5.1',publisher:'fork-owner'});
const installedFromOriginal={wam:[{id:'profiles',repo:'origin-owner/profiles',commit:C,version:'0.5.1',source:'standard'}],shell:[{id:'profiles',url:'/profiles/'}],complete:true};
const resolveAll=(apps,snapshot,runtipi=[])=>new Map(apps.map(a=>[a,resolveInstalled(a,snapshot,runtipi)]));

test('two same-ID rows become one entry that keeps the exactly installed repository',()=>{
 const apps=[fork,original], inst=resolveAll(apps,installedFromOriginal);
 const out=mergeConflicts(apps,a=>inst.get(a));
 assert.equal(out.length,1);
 const [one]=out;
 assert.equal(one.repo,'origin-owner/profiles');
 assert.equal(one.conflict,true);
 assert.deepEqual(one.sources.map(s=>[s.repo,s.installed]),[['origin-owner/profiles',true],['fork-owner/profiles',false]]);
 assert.deepEqual(one.sources.map(s=>s.version),['0.5.2','0.5.1']);
 // Same ID, exact repository: the existing copy opens; nothing offers to install another source.
 assert.equal(releaseState(one,inst.get(original),false,true),'installed');
 assert.equal(releaseState(one,inst.get(original),true,true),'switch');
});

test('a conflict without exact installed provenance stays blocked and names no installed source',()=>{
 const runtipiOnly=[{info:{id:'profiles'},app:{status:'running'}}];
 for(const [snapshot,runtipi] of [[{wam:[],shell:[],complete:true},runtipiOnly],[{wam:[],shell:[],complete:true},[]],[{wam:[],shell:[{id:'profiles',url:'/profiles/'}],complete:true},[]]]) {
  const apps=[original,fork], inst=resolveAll(apps,snapshot,runtipi);
  const [one]=mergeConflicts(apps,a=>inst.get(a));
  assert.equal(one.sources.some(s=>s.installed),false);
  assert.equal(releaseState(one,inst.get(apps.find(a=>a.repo===one.repo)),false,true),'conflict');
 }
});

test('an installed copy from a third repository wins the merged entry; other IDs are untouched',()=>{
 const local={id:'profiles',name:'Profiles',summary:'Installed on this Wizard',type:'view',repo:'me/profiles',commit:C,installed_only:true,releases:[]};
 const other={id:'notes',name:'Notes',type:'view',repo:'org/notes',commit:A,releases:[]};
 const snapshot={wam:[{id:'profiles',repo:'me/profiles',commit:C}],shell:[],complete:true};
 const apps=[original,fork,local,other], inst=resolveAll(apps,snapshot);
 const out=mergeConflicts(apps,a=>inst.get(a));
 assert.deepEqual(out.map(a=>a.id),['profiles','notes']);
 assert.equal(out[0].repo,'me/profiles'); assert.equal(out[0].conflict,true); assert.equal(out[0].installed_only,true);
 assert.deepEqual(out[0].sources.map(s=>[s.repo,s.installed]),[['me/profiles',true],['origin-owner/profiles',false],['fork-owner/profiles',false]]);
 assert.strictEqual(out[1],other);
});

test('a catalog row whose ID is installed from another repository merges with that installed copy',()=>{
 const listed={...original,conflict:false};
 const local={id:'profiles',name:'Profiles',type:'view',repo:'me/profiles',commit:C,installed_only:true,releases:[]};
 const snapshot={wam:[{id:'profiles',repo:'me/profiles',commit:C}],shell:[],complete:true};
 const apps=[listed,local], inst=resolveAll(apps,snapshot);
 const out=mergeConflicts(apps,a=>inst.get(a));
 assert.equal(out.length,1); assert.equal(out[0].repo,'me/profiles'); assert.equal(out[0].conflict,true);
 assert.equal(releaseState(out[0],inst.get(local),false,true),'installed');
});

test('rows from one repository are one source, never a conflict between themselves',()=>{
 // Same repository listed twice (host spelling and case differ): one source, not two.
 const again=row('https://github.com/Origin-Owner/profiles',{conflict:false,publisher:'origin-owner'});
 const solo={...original,conflict:false};
 const out=mergeConflicts([solo,again],()=>null);
 assert.equal(out.length,1); assert.equal(out[0].conflict,false); assert.equal(out[0].sources,undefined);
 assert.strictEqual(out[0],solo);
 // Both copies of the installed repository match it exactly: still one source, and it is the installed one.
 const inst=resolveAll([solo,again,fork],installedFromOriginal);
 const [one]=mergeConflicts([again,fork,solo],a=>inst.get(a));
 assert.equal(one.conflict,true); assert.equal(one.sources.length,2);
 assert.deepEqual(one.sources.map(s=>s.installed),[true,false]);
 assert.equal(releaseState(one,inst.get(solo),false,true),'installed');
 // A lone row the index flagged as conflicted (its other source is unavailable here) keeps its flag.
 const [flagged]=mergeConflicts([original],()=>null);
 assert.equal(flagged.conflict,true);
});

test('no inert imperative remains: the Store never says Resolve conflict',()=>{
 for(const f of readdirSync(new URL('../web/store/',import.meta.url))) if(/\.(js|html|css)$/.test(f)) assert.doesNotMatch(readFileSync(new URL('../web/store/'+f,import.meta.url),'utf8'),/Resolve conflict/i,f);
});
