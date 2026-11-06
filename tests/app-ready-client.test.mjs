import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../web/core/app-client.js',import.meta.url),'utf8');
function fixture(){
 let handler;const sent=[],timers=[],parent={postMessage:m=>sent.push(m)},requests=new Map();class NativeMessage{constructor(x){Object.assign(this,x);}}
 const c={ORIGIN:'https://wizard.test',VERSION:1,framed:true,parent,MessageEvent:NativeMessage,requests,keepCallbacks:new Map(),requestId:0,setTimeout:f=>(timers.push(f),timers.length),clearTimeout(){},addEventListener:(_,fn)=>handler=fn};
 const request=src.slice(src.indexOf('  function request('),src.indexOf('  function back()'));
 const listener=src.slice(src.indexOf("  addEventListener('message', e => {"),src.indexOf('  function hold('));
 const facade=src.split('\n').find(l=>l.includes('readyExtension: Object.freeze'));
 vm.runInNewContext(request+listener+'\nthis.api=({'+facade.trim()+'}).readyExtension;',c);
 return{api:c.api,sent,timers,requests,reply:data=>handler(new NativeMessage({source:parent,origin:c.ORIGIN,isTrusted:true,data:{version:1,id:sent.at(-1).id,...data}})),spoof:data=>handler(new NativeMessage({source:parent,origin:c.ORIGIN,isTrusted:false,data:{version:1,id:sent.at(-1).id,...data}}))};
}
test('same-frame request, one admission callback, settlement independent of acknowledgement',async()=>{
 const f=fixture();let admitted=0,settled=false;const p=f.api.write('step',{item:'task'},{revision:1},{onAdmitted:()=>admitted++}).then(v=>(settled=true,v));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].op,'ready.write');assert.equal(admitted,0);
 f.spoof({type:'wizard:app:admitted'});assert.equal(admitted,0);
 f.reply({type:'wizard:app:admitted'});f.reply({type:'wizard:app:admitted'});assert.equal(admitted,1);await Promise.resolve();assert.equal(settled,false);
 f.reply({type:'wizard:app:reply',value:{done:true}});assert.equal((await p).done,true);assert.equal(f.requests.size,0);
});
test('domain recovery details survive errors; untrusted settlement cannot release the request',async()=>{
 const f=fixture(),p=f.api.write('step',{},{});f.spoof({type:'wizard:app:reply',value:'fake'});assert.equal(f.requests.size,1);
 f.reply({type:'wizard:app:reply',error:'Save outcome unknown',details:{uncertain:true,shellNotified:true,state:{revision:2}}});
 await assert.rejects(p,e=>e.uncertain&&e.shellNotified&&e.state.revision===2);assert.equal(f.requests.size,0);
});
test('a transport timeout is uncertain, never permission to retry an independent write',async()=>{
 const f=fixture(),p=f.api.write('step',{},{});f.timers[0]();await assert.rejects(p,e=>e.uncertain===true);assert.equal(f.requests.size,0);
});
