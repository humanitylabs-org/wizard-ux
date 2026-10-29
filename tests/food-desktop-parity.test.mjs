import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
async function fixture(native){
 const entries=[{id:'usuals',name:'Food',url:'/usuals/'},{id:'photos',name:'Photos',url:'/photos/'},{id:'another-phone-app',url:'/other/',phone_only:true}];
 const window={WizCore:{norm:s=>String(s).toLowerCase()},WizConfig:{endpoint:()=>'/apps'},WizDeviceLegacy:[{appId:'usuals',probe:'usuals',phoneOnly:true}],WizardOSNative:native,dispatchEvent(){},localStorage:{getItem:()=>null,setItem(){}},addEventListener(){}};
 vm.runInNewContext(source,{window,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),fetch:async()=>({ok:true,json:async()=>({apps:entries})}),AbortSignal,setTimeout,clearTimeout,setInterval(){},addEventListener(){},document:{addEventListener(){},visibilityState:'visible'},localStorage:window.localStorage});
 await window.WizCore.appsLoaded();return window;
}
test('Food never becomes a working desktop ordering UI after moving to an app',async()=>{
 for(const native of [undefined,{usuals(){}}]){
  const w=await fixture(native), R=w.WizCore.apps('desktop');
  assert.equal(R.APP.usuals,undefined);assert.equal(R.findApp('usuals'),null);
  assert(!R.APPS.some(a=>a.id==='usuals'));assert(R.APP.photos);
  assert.equal(R.APP['another-phone-app'],undefined);
 }
});
test('Food still opens on a capable phone and is absent without its existing native store bridge',async()=>{
 const capable=await fixture({usuals(){}}), browser=await fixture(undefined);
 assert.equal(capable.WizCore.apps('mobile').APP.usuals.url,'/usuals/');
 assert.equal(browser.WizCore.apps('mobile').APP.usuals,undefined);
 assert(capable.WizCore.apps('mobile').APP.photos);
});
