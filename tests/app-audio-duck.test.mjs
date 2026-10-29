// WizardApp.audio.duck: an installed app asks the shell to lower Wizard Music while it plays a short sound; the shell
// owns the volume (WizBackgroundAudio.duck), keyed by the app's frame, and lets go when the frame goes away.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
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
test('audio.duck is an admitted message op and the client exposes WizardApp.audio.duck',()=>{
 assert.match(source,/'audio\.duck'/); assert.match(source,/d\.op === 'audio\.duck'/);
 assert.match(readFileSync(new URL('../web/core/app-client.js',import.meta.url),'utf8'),/audio: Object\.freeze\(\{ duck:/);
});
