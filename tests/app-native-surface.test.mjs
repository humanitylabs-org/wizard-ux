import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.QA_REGISTRY_SOURCE || new URL('../web/core/apps.js',import.meta.url),'utf8');
async function registry(url,native,extra={}) {
 const window={WizCore:{norm:s=>s},WizConfig:{endpoint:()=>'/apps'},WizDeviceLegacy:[{appId:'legacy-tool',path:'/native-tool/',probe:'nativeTool',phoneOnly:true}],WizardOSNative:native,dispatchEvent(){}};
 const localStorage={getItem:()=>null,setItem(){}};
 vm.runInNewContext(source,{window,URL,location:new URL('https://fixture.invalid/'),localStorage,CustomEvent:class{},addEventListener(){},document:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({apps:[{id:'legacy-tool',url,...extra}]})})});
 await window.WizCore.appsLoaded();return window.WizCore;
}
test('native compatibility gates only the declared surface, never an unrelated web app sharing its id',async()=>{
 for(const url of ['/web-tool/','/native-tool-lookalike/','https://elsewhere.invalid/native-tool/']){
  const core=await registry(url);
  for(const shell of ['mobile','desktop']){const a=core.apps(shell).APP['legacy-tool'];assert.equal(a?.url,url);assert.equal(a.phoneOnly,false);}
 }
});
test('declared native paths and descendants remain native-only; explicit phone_only is preserved',async()=>{
 for(const url of ['/native-tool/','/native-tool/item']){
  const absent=await registry(url),capable=await registry(url,{nativeTool(){}});
  assert.equal(absent.apps('mobile').APP['legacy-tool'],undefined);
  assert.equal(capable.apps('desktop').APP['legacy-tool'],undefined);
  assert.equal(capable.apps('mobile').APP['legacy-tool'].phoneOnly,true);
 }
 const explicit=await registry('/web-tool/',undefined,{phone_only:true});
 assert.equal(explicit.apps('desktop').APP['legacy-tool'],undefined);
 assert.equal(explicit.apps('mobile').APP['legacy-tool'].phoneOnly,true);
});
