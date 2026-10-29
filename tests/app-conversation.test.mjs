import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function fixture({installed=true,ready=true,enabled=true,id='wizard-manager'}={}) {
 const calls=[],sourceWindow={location:new URL('https://wizard.example/'+id+'/'),document:{},addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:sourceWindow.location.href,isConnected:true,contentWindow:sourceWindow,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,name:'Fixture app',kind:'wizard',url:'/'+id+'/',receives_voice_input:enabled};
 const window={WizCore:{apps:()=>({APPS:installed?[app]:[]})},dispatchEvent(){}};
 const ctx={window,location:new URL('https://wizard.example/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}};
 vm.runInNewContext(source,ctx);const host=window.WizAppServices;const detach=host.attach(frame,{appId:id,path:'/'+id+'/'});
 const target={replyTo:1,label:'Manager · original reply'};
 const receiver={snapshot:()=>ready?target:undefined,receive:async message=>{calls.push(message);return {accepted:true,request_id:message.request_id}}};
 host.connect(sourceWindow,{conversation:receiver});
 const pin=host.conversation.pin(frame,id),message={request_id:'qa-request-123',text:'original',files:[]};
 return {host,frame,sourceWindow,receiver,target,pin,message,calls,detach,app};
}
test('registered live Manager receives frozen recording-start target',async()=>{const f=fixture();f.target.replyTo=2;const receipt=await f.host.conversation.deliver(f.pin,f.message);assert.equal(receipt.accepted,true);assert.equal(f.calls[0].target.replyTo,1);assert(Object.isFrozen(f.calls[0]));});
for(const [name,alter] of [
 ['closed frame',f=>f.frame.isConnected=false],
 ['detached frame',f=>f.detach()],
 ['new document',f=>f.sourceWindow.document={}],
 ['foreign origin',f=>f.sourceWindow.location=new URL('https://other.example/wizard-manager/')],
 ['same-origin adjacent path',f=>f.sourceWindow.location=new URL('https://wizard.example/other-app/')],
 ['src changed',f=>f.frame.src='https://wizard.example/other-app/'],
 ['encoded path traversal',f=>f.sourceWindow.location=new URL('https://wizard.example/wizard-manager/%252e%252e/other')],
 ['replacement receiver',f=>f.host.connect(f.sourceWindow,{conversation:{...f.receiver}})],
])test(name+' fails closed without dispatch',async()=>{const f=fixture();alter(f);await assert.rejects(f.host.conversation.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
test('declared unavailable receiver retains an app pin',async()=>{const f=fixture({ready:false});assert.equal(f.pin.appId,'wizard-manager');await assert.rejects(f.host.conversation.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
for(const opts of [{installed:false},{enabled:false},{enabled:'true'}])test(JSON.stringify(opts)+' cannot grant app voice',()=>{assert.equal(fixture(opts).pin,null);});
test('null snapshot is deliberately inactive, undefined is unavailable',()=>{const f=fixture();f.receiver.snapshot=()=>null;assert.equal(f.host.voiceInput.pin(f.frame,'wizard-manager'),null);f.receiver.snapshot=()=>undefined;assert(f.host.voiceInput.pin(f.frame,'wizard-manager'));});
test('generic context is deeply copied and frozen',async()=>{const f=fixture();f.target.clip={id:'original',times:[1,2]};const pin=f.host.voiceInput.pin(f.frame,'wizard-manager');f.target.clip.times[0]=99;await f.host.voiceInput.deliver(pin,f.message);assert.equal(f.calls[0].target.clip.times[0],1);assert(Object.isFrozen(f.calls[0].target.clip.times));});
test('revoked installed declaration fails closed',async()=>{const f=fixture();f.app.receives_voice_input=false;await assert.rejects(f.host.voiceInput.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
test('authorize after async wait rechecks original frame',async()=>{const f=fixture();f.receiver.receive=async(message,authorize)=>{await Promise.resolve();f.sourceWindow.document={};authorize();f.calls.push(message);};await assert.rejects(f.host.voiceInput.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
for(const value of [Infinity,()=>{},'x'.repeat(9000)])test('non-JSON or oversized target fails closed '+typeof value,async()=>{const f=fixture();f.target.extra=value;const pin=f.host.voiceInput.pin(f.frame,'wizard-manager');await assert.rejects(f.host.voiceInput.deliver(pin,f.message));assert.equal(f.calls.length,0);});
test('non-admitted app cannot opt into Manager dispatch',()=>{const f=fixture();assert.equal(f.host.conversation.pin(f.frame,'other-app'),null);});
test('unsupported files rejected before receiver',async()=>{const f=fixture();f.message.files=[{id:'file'}];await assert.rejects(f.host.conversation.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
test('receipt mismatch is uncertain, never accepted',async()=>{const f=fixture();f.receiver.receive=async()=>({accepted:true,request_id:'other-id'});await assert.rejects(f.host.conversation.deliver(f.pin,f.message));});
test('non-Manager installed app receives generic target through the same seam',async()=>{const f=fixture({id:'qa-editor'});f.target.clipId='clip-1';f.target.draftId='draft-1';f.target.time=14.5;const pin=f.host.voiceInput.pin(f.frame,'qa-editor');await f.host.voiceInput.deliver(pin,f.message);assert.equal(f.calls[0].target.draftId,'draft-1');assert.equal(f.calls[0].target.time,14.5);});
test('self-asserted frame path cannot impersonate installed recipient',async()=>{const f=fixture();f.detach();f.frame.src='https://wizard.example/other-app/';f.sourceWindow.location=new URL(f.frame.src);f.host.attach(f.frame,{appId:'wizard-manager',path:'/other-app/'});f.host.connect(f.sourceWindow,{voiceInput:f.receiver});const pin=f.host.voiceInput.pin(f.frame,'wizard-manager');await assert.rejects(f.host.voiceInput.deliver(pin,f.message));assert.equal(f.calls.length,0);});
