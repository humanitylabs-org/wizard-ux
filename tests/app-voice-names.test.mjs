import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
async function setup(apps, cached=false) {
 const storage=new Map(cached ? [['wux.apps.v1', JSON.stringify(apps)]] : []);
 const window={WizCore:{norm:s=>String(s).toLowerCase().replace(/[.!?,]/g,'').replace(/\s+/g,' ').trim()},WizConfig:{endpoint:()=>cached ? null : '/apps'},dispatchEvent(){}};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 vm.runInNewContext(source,{window,localStorage,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),
   fetch:async()=>({ok:true,json:async()=>({apps})}),addEventListener(){},document:{addEventListener(){}}});
 await window.WizCore.appsLoaded();return window.WizCore.apps('desktop');
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
