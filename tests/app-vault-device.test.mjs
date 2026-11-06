import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=process.env.VAULT_SOURCE_ROOT||new URL('../',import.meta.url).pathname;
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function fixture({legacy=false,front=false,visible=true}={}) {
 let now=1000,seq=0;const timers=new Map(),sent=[];let resolveNative;
 const window={addEventListener(){},dispatchEvent(){},WizCore:{apps:()=>({APPS:[{id:'sample',kind:'wizard',url:'/sample/'}]}),bridge:{call:(method,params)=>{sent.push({method,params});return new Promise(r=>resolveNative=r);}}}};
 if(legacy)window.wizardVaultPort={postMessage:body=>sent.push(JSON.parse(body))};else window.wizardDevicePort={postMessage(){}};
 const location=new URL('https://vault.test/wizard-os-home/'),child={location:new URL('/sample/',location),document:{},addEventListener(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const document={hidden:false,readyState:'loading',addEventListener(){}};
 const DateFake=class extends Date {static now(){return now;}};
 vm.runInNewContext(read('web/core/app-services.js'),{window,document,location,URL,navigator:{},addEventListener(){},setInterval(){},setTimeout:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},clearTimeout:id=>timers.delete(id),Date:DateFake,CustomEvent:class{},console});
 const detach=window.WizAppServices.attach(frame,{appId:'sample',path:'/sample/',isVisible:()=>visible,isFront:()=>front});
 const service=window.WizAppServices.connect(child,{});
 async function advance(ms){for(let i=0;i<ms;i+=100){now+=Math.min(100,ms-i);for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await Promise.resolve();await Promise.resolve();}}
 function reply(value={saved:true}){if(legacy){const req=sent.at(-1);window.wizardVaultPort.onmessage({data:JSON.stringify({id:req.id,ok:true,result:value})});}else resolveNative(value);}
 return {window,document,child,frame,service,detach,sent,advance,reply,setFront:value=>front=value};
}
for(const legacy of [false,true]) {
 test(`background app cannot summon a vault prompt; stable foreground does (${legacy?'legacy':'device'})`,async()=>{
  const f=fixture({legacy});const opened=f.service.vault.open('Unlock sample');await f.advance(1000);assert.equal(f.sent.length,0,'visible but unfocused app must not prompt');
  f.setFront(true);await f.advance(400);assert.equal(f.sent.length,0,'transient foreground is not enough');await f.advance(600);assert.equal(f.sent.length,1);assert.equal(f.sent[0].params?.appId||f.sent[0].appId,'sample');f.reply({secret:'synthetic'});assert.equal((await opened).secret,'synthetic');
 });
}
test('hidden document does not prompt and a closed queued app cancels without contacting native',async()=>{
 const f=fixture({front:true});f.document.hidden=true;const opened=f.service.vault.open('Sample');const rejected=assert.rejects(opened,e=>e.code==='cancelled');await f.advance(1000);assert.equal(f.sent.length,0);f.detach();await f.advance(200);await rejected;assert.equal(f.sent.length,0);
});
test('foreground wait times out fail-closed without a native request',async()=>{
 const f=fixture();const opened=f.service.vault.open('Sample');const rejected=assert.rejects(opened,e=>e.code==='not_in_front');await f.advance(61000);await rejected;assert.equal(f.sent.length,0);
});
test('has does not wait for focus; late secret still cannot cross a document replacement',async()=>{
 const f=fixture({front:true});const has=f.service.vault.has();assert.equal(f.sent.length,1);f.reply();await has;
 const opened=f.service.vault.open('Sample');await f.advance(1000);assert.equal(f.sent.length,2);f.child.document={};f.reply({secret:'synthetic'});await assert.rejects(opened,/no longer authorized/);
});
test('pinned app attachment admits only its current connected focused document',()=>{
 const source=read('web/core/single-app-session.js');const a=source.indexOf('    // Attach before frontend scripts run'),b=source.indexOf('    frame.addEventListener',a);assert.ok(a>=0 && b>a);
 let options,focused=true,covered=false;const original={isConnected:true},ctx={wid:'single-app',chats:{isHosted:()=>covered},win:{appendChild(){}},frame:original,id:'sample',next:{url:'/sample/'},localStorage:{},document:{visibilityState:'visible',hasFocus:()=>focused},window:{WizAppServices:{attach:(_,o)=>{options=o;}}}};
 vm.createContext(ctx);vm.runInContext('let detach;'+source.slice(a,b),ctx);assert.equal(typeof options.isFront,'function');assert.equal(options.isVisible(),true);assert.equal(options.isFront(),true);
 covered=true;assert.equal(options.isVisible(),false,'hosted Chats covers app');assert.equal(options.isFront(),false);covered=false;
 focused=false;assert.equal(options.isFront(),false);focused=true;ctx.document.visibilityState='hidden';assert.equal(options.isFront(),false);assert.equal(options.isVisible(),false);
 ctx.document.visibilityState='visible';original.isConnected=false;assert.equal(options.isFront(),false);original.isConnected=true;ctx.frame={isConnected:true};assert.equal(options.isFront(),false,'replacement app cannot inherit admission');
});
