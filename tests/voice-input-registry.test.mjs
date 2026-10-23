import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
test('cache cannot self-grant; network catalog projects strict voice declaration',async()=>{
 const entries=[{id:'editor',name:'Editor',url:'/editor/',receives_voice_input:true},{id:'string',url:'/string/',receives_voice_input:'true'},{id:'plain',url:'/plain/'}];
 let respond;const gate=new Promise(r=>respond=r),storage=new Map([['wux.apps.v1',JSON.stringify(entries)]]);
 const window={WizCore:{esc:String,clip:String,norm:s=>String(s).toLowerCase(),store:()=>({get:(_key,def)=>def,set(){}})},WizConfig:{endpoint:()=>'/apps'},addEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
 window.dispatchEvent=()=>{};
 const ctx={window,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),fetch:()=>gate,AbortSignal,setTimeout,clearTimeout,setInterval(){},addEventListener(){},document:{addEventListener(){},visibilityState:'visible'},localStorage:window.localStorage};
 vm.runInNewContext(source,ctx);const registry=window.WizCore.apps('mobile');
 assert.equal(registry.APP.editor.receives_voice_input,false);
 respond({ok:true,json:async()=>({apps:entries})});await window.WizCore.appsLoaded();
 assert.equal(registry.APP.editor.receives_voice_input,true);assert.equal(registry.APP.string.receives_voice_input,false);assert.equal(registry.APP.plain.receives_voice_input,false);
});
test('Troubleshooter stays a normal launchable app offline in both shells with all open-app aliases',async()=>{
 const names=['troubleshooter','troubleshooting','troubleshoot','fix wizard'];
 const installed=JSON.stringify([{id:'troubleshooter',name:'Troubleshooter',url:'/troubleshoot/',source:'apps.json',voice_names:names}]);
 const window={WizCore:{norm:s=>String(s).toLowerCase()},dispatchEvent(){},localStorage:{getItem:key=>key === 'wux.apps.v1' ? installed : null,setItem(){}}};
 const ctx={window,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),fetch:async()=>{throw Error('catalog unavailable');},AbortSignal,setTimeout,clearTimeout,setInterval(){},addEventListener(){},document:{addEventListener(){},visibilityState:'visible'},localStorage:window.localStorage};
 vm.runInNewContext(source,ctx);await window.WizCore.appsLoaded();
 for(const shell of ['mobile','desktop']){
  const R=window.WizCore.apps(shell),app=R.APP.troubleshooter;
  assert.equal(app.name,'Troubleshooter');assert.equal(app.kind,'wizard');assert.equal(app.url,'/troubleshoot/');
  assert.equal(window.WizCore.isMaintenanceApp(app),false);assert(R.searchApps('Troubleshooter').includes(app));
  for(const alias of ['troubleshooter','troubleshooting','troubleshoot','fix wizard']){
   assert.equal(R.findApp(alias).id,app.id);assert.equal(R.appByName('open '+alias).id,app.id);
  }
 }
});
