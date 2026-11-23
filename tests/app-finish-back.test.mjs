import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';
const read=p=>withShellParts(readFileSync(new URL('../web/'+p,import.meta.url),'utf8'));
// The shell's app services (core/app-services.js) with one attached app frame; back() is the shell's Back for it.
function services(visible){
 const location=new URL('https://wizard.example/wizard-os-home/'),id='wizard-notes',backs=[];
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const window={WizCore:{apps:()=>({APPS:[{id,kind:'wizard',url:'/'+id+'/'}]}),workspaceNav:{setCount(){}}},dispatchEvent(){}};
 vm.runInNewContext(withServicesParts(read('core/app-services.js')),{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 window.WizAppServices.attach(frame,{appId:id,path:'/'+id+'/',isVisible:()=>visible.on,back:()=>{backs.push(1);return true;}});
 return {service:window.WizAppServices.connect(child,{}),backs};
}
test('apps return through the shared Back step and hidden frames cannot navigate the owner',()=>{
 // WizardApp.nav.back(): true only when the shell took the step
 for(const answer of [true,'yes',undefined]){const c=appClient({service:{nav:{back:()=>answer}}});c.api.ready();assert.equal(c.api.nav.back(),answer===true);}
 const thrower=appClient({service:{nav:{back:()=>{throw new Error('gone');}}}});thrower.api.ready();assert.equal(thrower.api.nav.back(),false,'a failure is just no step');
 // the shell: only the visible frame's Back runs
 const visible={on:true},s=services(visible);
 assert.equal(s.service.nav.back(),true);assert.equal(s.backs.length,1);
 visible.on=false;assert.equal(s.service.nav.back(),false,'a hidden frame cannot navigate the owner');assert.equal(s.backs.length,1);
 // the phone's frame hands it the shared Back step, only for the window in front on its desk
 const app=read('app.js'),steps=[];
 const make=focus=>runRecording('globalThis.back = () => '+block(app,'back: () => { if (desks[idx].focus !== w.id) return false;').replace(/^back: \(\) => /,'')+';',
  {desks:[{focus}],idx:0,w:{id:'w2'},window:{},backStep:id=>{steps.push(id);return 'app';}});
 assert.equal(make('w2').back(),true);assert.deepEqual(steps,['w2'],'the shared Back step for this window');
 assert.equal(make('w9').back(),false);assert.deepEqual(steps,['w2'],'not in front: nothing');
});
