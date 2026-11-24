// WizardApp.audio.duck: an installed app asks the shell to lower Wizard Music while it plays a short sound; the shell
// owns the volume (WizBackgroundAudio.duck), keyed by the app's frame, and lets go when the frame goes away.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { appClient } from './fixtures/app-client-harness.mjs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
const source=withServicesParts(readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8'));
function fixture(id='wizard-messenger') {
 const calls=[],location=new URL('https://wizard.example/wizard-os-home/');
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/'};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent(){},
  WizBackgroundAudio:{duck:(owner,on)=>{calls.push([owner,on]);return Promise.resolve(on);}}};
 vm.runInNewContext(source,{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 const detach=window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 return {child,calls,detach,service:window.WizAppServices.connect(child,{})};
}
// owner-correction: humanitylabs-org/wizard-ux#559 · 2026-10-24 · "Also, when I'm playing a voice note, it might be nice if it turns the music volume down."
test('an app ducks and restores Wizard Music through the shell, one owner per frame',async()=>{
 const f=fixture(); assert.equal(await f.service.audio.duck(true),true); assert.equal(await f.service.audio.duck(false),false);
 assert.equal(f.calls.length,2); assert.equal(f.calls[0][0],f.calls[1][0]); assert.deepEqual(f.calls.map(c=>c[1]),[true,false]);
});
test('closing the app releases its duck so music comes back',async()=>{
 const f=fixture(); await f.service.audio.duck(true); f.detach();
 assert.deepEqual(f.calls.at(-1)[1],false); assert.equal(f.calls.at(-1)[0],f.calls[0][0]);
});
test('a reloaded frame cannot duck',()=>{
 const f=fixture(); f.child.document={}; assert.throws(()=>f.service.audio.duck(true)); assert.equal(f.calls.length,0);
});
test('audio.duck is an admitted message op and the client exposes WizardApp.audio.duck',async()=>{
 // the shell side: a framed app's postMessage request reaches the duck and gets its answer back
 const calls=[],replies=[],listeners=[],location=new URL('https://wizard.example/wizard-os-home/'),id='wizard-messenger';
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage:(m,o)=>replies.push([m,o])};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/'};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent(){},WizBackgroundAudio:{duck:(owner,on)=>{calls.push(on);return Promise.resolve(on);}}};
 vm.runInNewContext(source,{window,location,URL,addEventListener:(t,f)=>{if(t==='message')listeners.push(f);},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 const send=async(op,args,rid)=>{for(const f of listeners)await f({source:child,origin:location.origin,data:{type:'wizard:app:request',version:1,id:rid,op,args}});};
 await send('audio.duck',{on:true},'r1');
 assert.deepEqual(calls,[true]);assert.deepEqual(replies.map(([m])=>[m.id,m.value,m.error]),[['r1',true,undefined]]);
 await send('audio.louder',{on:true},'r2');assert.equal(replies.length,1,'an op the shell does not admit is never answered');
 // the app side: WizardApp.audio.duck, over postMessage (no same-origin services) and through a connected service
 const c=appClient();c.api.ready();await c.hello();
 const p=c.api.audio.duck(1);const req=c.requests('audio.duck').at(-1);
 assert.deepEqual({...req.args},{on:true});c.reply(req,true);assert.equal(await p,true);
 const seen=[],s=appClient({service:{audio:{duck:on=>{seen.push(on);return true;}}}});s.api.ready();
 assert.equal(await s.api.audio.duck(0),true);assert.deepEqual(seen,[false]);
});
