import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/apps.js',import.meta.url),'utf8');
// Fresh boxes: after a Store Get the Store posts `wizard:apps-changed`; the shell must re-read its app list so
// WizCanOpen knows the new app and the Store shows Open without a reload.
test('a same-origin wizard:apps-changed message re-reads the box app list; other origins cannot',async()=>{
 const listeners=[];let calls=0,apps=[{id:'morning-report',name:'Morning Report',url:'/morning-report/'}];
 const storage=new Map();
 const window={WizCore:{norm:s=>String(s).toLowerCase()},WizConfig:{endpoint:()=>'/apps'},dispatchEvent(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
 const ctx={window,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),
  fetch:async()=>{calls++;return {ok:true,json:async()=>({apps:apps.slice()})};},AbortSignal,setTimeout,clearTimeout,setInterval(){},
  addEventListener:(type,fn)=>listeners.push([type,fn]),document:{addEventListener(){},visibilityState:'visible'},localStorage:window.localStorage};
 vm.runInNewContext(source,ctx);await window.WizCore.appsLoaded();
 const R=window.WizCore.apps('desktop');
 assert.equal(R.APP['wizard-connection-router'],undefined);
 apps.push({id:'wizard-connection-router',name:'Connection Router',url:'/wizard-connection-router/'});
 const send=async (origin,data)=>{for(const [t,fn] of listeners) if(t==='message') fn({origin,data});await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
 const before=calls;
 await send('https://evil.example',{type:'wizard:apps-changed'});
 await send('https://wizard.example',{type:'something-else'});
 assert.equal(calls,before);
 assert.equal(R.APP['wizard-connection-router'],undefined);
 await send('https://wizard.example',{type:'wizard:apps-changed',id:'wizard-connection-router'});
 assert.equal(calls,before+1);
 assert.equal(R.APP['wizard-connection-router'].url,'/wizard-connection-router/');
 assert.equal(R.APP['wizard-connection-router'].kind,'wizard');
});
