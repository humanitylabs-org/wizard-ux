import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
async function setup(apps, cached=false, shell="desktop") {
 const storage=new Map(cached ? [['wux.apps.v1', JSON.stringify(apps)]] : []);
 const window={WizCore:{norm:s=>String(s).toLowerCase().replace(/[.!?,]/g,'').replace(/\s+/g,' ').trim()},WizConfig:{endpoint:()=>cached ? null : '/apps'},dispatchEvent(){},WizardOSNative:{usuals:()=>'[]',sideButton:()=>'{}'}};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 vm.runInNewContext(source,{window,localStorage,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),
   fetch:async()=>({ok:true,json:async()=>({apps})}),addEventListener(){},document:{addEventListener(){}}});
 await window.WizCore.appsLoaded();return window.WizCore.apps(shell);
}
const app=(id,name,voice_names)=>({id,name,voice_names,url:`/apps/${id}/`,source:'apps.json'});
test('installed spoken names work for explicit and bare launch, including spacing and case',async()=>{
 for(const cached of [false,true]) {
  const r=await setup([app('sample-reader','Quiet Reader',['reading room','page turner','six short words to open this'])],cached);
  for(const name of ['reading room','ReadingRoom','the page turner app','six short words to open this','Quiet Reader']) {
   assert.equal(r.findApp(name)?.id,'sample-reader',name);assert.equal(r.appByName(name)?.id,'sample-reader',name);
  }
  assert.equal(r.appByName('tell me about the reading room'),null);
 }
});
test('shell words and display names win collisions; link metadata cannot invent alternatives',async()=>{
 const r=await setup([app('first','First',['chats','Exact Name','shared name']),app('second','Exact Name',['shared name']),
  {...app('link','A Link',['secret phrase']),source:'launcher.json'}]);
 assert.equal(r.appByName('chats')?.id,'wizard');
 assert.equal(r.appByName('exact name')?.id,'second');
 assert.equal(r.appByName('sharedname')?.id,'first');
 assert.equal(r.appByName('secret phrase'),null);
});
test('missing or malformed alternatives do not break display-name matching',async()=>{
 const r=await setup([app('old','Legacy',null),app('bad','Other',[null,{},true,'', 'x'.repeat(41)])]);
 assert.equal(r.appByName('legacy')?.id,'old');assert.equal(r.appByName('other')?.id,'bad');
 assert.equal(r.appByName('movies'),null);assert.equal(r.appByName('meeting recorder'),null);
});
const migration=JSON.parse(readFileSync(new URL('./fixtures/voice-name-migration.json',import.meta.url),'utf8'));
for(const shell of ['mobile','desktop']) for(const cached of [false,true]) {
 test(`pre-registration aliases retain baseline destinations: ${shell}, cached=${cached}`,async()=>{
  const r=await setup(migration.apps,cached,shell);
  for(const c of migration.cases[shell]) {
   if(c.bare) assert.equal(r.appByName(c.name)?.id,c.bare,`bare ${c.name}`);
   if(c.explicit) assert.equal(r.findApp(c.name)?.id,c.explicit,`explicit ${c.name}`);
  }
 });
}
test('declarations replace only their own transitional aliases, including explicit opt-out and cache',async()=>{
 for(const cached of [false,true]) {
  let r=await setup([app('wisdom','Wisdom',['quiet room']),app('console','Console',[])],cached);
  assert.equal(r.appByName('quiet room')?.id,'wisdom');
  assert.equal(r.appByName('reader'),null);
  assert.equal(r.appByName('terminal'),null);
  r=await setup([app('wisdom','Wisdom',undefined),app('console','Console',undefined)],cached);
  assert.equal(r.appByName('reader')?.id,'wisdom');
  assert.equal(r.appByName('terminal')?.id,'console');
 }
});
test('built-in native, embedded Food and recovery names work without a catalog and with old records',async()=>{
 for(const apps of [[],[app('troubleshooter','Troubleshooter',undefined)]]) {
  const r=await setup(apps,false,'mobile');
  for(const [name,id] of [['fix wizard','troubleshooter'],['troubleshoot','troubleshooter'],['usuals','usuals'],['saved orders','usuals'],['wizard bites','usuals'],['order food','usuals'],['google maps','maps'],['map','maps'],['music','spotify']])
   assert.equal(r.appByName(name)?.id,id,name);
 }
});
