import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function fixture({installed=true,ready=true}={}) {
 const calls=[],sourceWindow={location:new URL('https://wizard.example/wizard-manager/'),document:{},addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:sourceWindow.location.href,isConnected:true,contentWindow:sourceWindow,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const window={WizCore:{apps:()=>({APPS:installed?[{id:'wizard-manager',kind:'wizard',url:'/wizard-manager/'}]:[]})},dispatchEvent(){}};
 const ctx={window,location:new URL('https://wizard.example/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}};
 vm.runInNewContext(source,ctx);const host=window.WizAppServices;const detach=host.attach(frame,{appId:'wizard-manager',path:'/wizard-manager/'});
 const target={replyTo:1,label:'Manager · original reply'};
 const receiver={snapshot:()=>ready?target:null,receive:async message=>{calls.push(message);return {accepted:true,request_id:message.request_id}}};
 host.connect(sourceWindow,{conversation:receiver});
 const pin=host.conversation.pin(frame,'wizard-manager'),message={request_id:'qa-request-123',text:'original',files:[]};
 return {host,frame,sourceWindow,receiver,target,pin,message,calls,detach};
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
for(const opts of [{installed:false},{ready:false}])test(JSON.stringify(opts)+' retains unavailable Manager pin',async()=>{const f=fixture(opts);assert.equal(f.pin.appId,'wizard-manager');await assert.rejects(f.host.conversation.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
test('non-admitted app cannot opt into Manager dispatch',()=>{const f=fixture();assert.equal(f.host.conversation.pin(f.frame,'other-app'),null);});
test('unsupported files rejected before receiver',async()=>{const f=fixture();f.message.files=[{id:'file'}];await assert.rejects(f.host.conversation.deliver(f.pin,f.message));assert.equal(f.calls.length,0);});
test('receipt mismatch is uncertain, never accepted',async()=>{const f=fixture();f.receiver.receive=async()=>({accepted:true,request_id:'other-id'});await assert.rejects(f.host.conversation.deliver(f.pin,f.message));});
