import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function fixture(){
 const listeners=new Set(),sent=[],origin='https://fixture.invalid';
 const app={location:new URL(origin+'/wisdom/'),document:{},addEventListener(){},postMessage(d){sent.push(d)}};
 const frame={tagName:'IFRAME',src:app.location.href,isConnected:true,contentWindow:app,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const window={WizCore:{apps:()=>({APPS:[{id:'wisdom',kind:'wizard',url:'/wisdom/'}]})},WizAppCapture:{reloadCheck:()=>({safe:true})},dispatchEvent(){}};
 vm.runInNewContext(code,{window,location:new URL(origin+'/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener:(n,f)=>{if(n==='message')listeners.add(f)},removeEventListener:(n,f)=>listeners.delete(f),setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 const host=window.WizAppServices;host.attach(frame,{appId:'wisdom',path:'/wisdom/'});host.connect(app,{});
 const emit=(data,over={})=>Promise.all([...listeners].map(f=>f({source:app,origin,data,...over})));
 return {host,app,frame,sent,emit};
}
test('message-only app receives a challenge; wrong source, origin and id cannot confirm it',async()=>{
 const f=fixture();await f.emit({type:'wizard:app:request',version:1,id:'hold-1',op:'update.hold',args:{reason:'Wisdom unsent request',keepId:'owner-draft'}});
 assert.equal(f.host.update.reloadPlan().ok,false);const p=f.host.update.keepDrafts();await tick();
 const challenge=f.sent.find(d=>d.type==='wizard:app:keep');assert.equal(challenge.keepId,'owner-draft');
 const reply={type:'wizard:app:kept',version:1,id:challenge.id,result:'kept'};
 await f.emit(reply,{origin:'https://other.invalid'});await f.emit(reply,{source:{}});await f.emit({...reply,id:'wrong'});assert.equal(f.host.update.reloadPlan().ok,false);
 await f.emit(reply);await p;assert.equal(f.host.update.reloadPlan().ok,true);
});
test('a different document cannot acknowledge an earlier keep challenge',async()=>{
 const f=fixture();await f.emit({type:'wizard:app:request',version:1,id:'hold-1',op:'update.hold',args:{reason:'Wisdom unsent request',keepId:'owner-draft'}});
 const p=f.host.update.keepDrafts();await tick();const challenge=f.sent.find(d=>d.type==='wizard:app:keep');
 f.app.document={};await f.emit({type:'wizard:app:kept',version:1,id:challenge.id,result:'kept'});await p;
 assert.equal(f.host.inspect()[0].ready,false);
});
