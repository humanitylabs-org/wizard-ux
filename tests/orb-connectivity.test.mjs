import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.ORB_SYNC_SOURCE || new URL('../web/core/orb-handoff.js',import.meta.url),'utf8');
const key='wos.orb-meeting-events.v1';
const marker={id:'e',meetingId:'m',captureId:'c',status:'local',clientRevision:1};
function harness(){
 const data={[key]:JSON.stringify({e:marker})},calls=[];let failure=null,badIdentity=false,saved={...marker};
 const context={window:{},navigator:{onLine:false},localStorage:{getItem:k=>data[k],setItem:(k,v)=>data[k]=v},setInterval(){},addEventListener(){},AbortSignal,console,
 fetch:async(url,opts={})=>{calls.push({url,method:opts.method||'GET'});if(failure==='transport')throw Error('socket closed');
 if(opts.method==='PUT' && !failure)saved=JSON.parse(opts.body);
 return {ok:failure!=='http',json:async()=>opts.method==='PUT'?{event:saved}:{events:[{...saved,captureId:badIdentity?'wrong':'c'}]}};}};
 vm.runInNewContext(source,context);
 return {api:context.window.WosOrbHandoff,calls,read:()=>JSON.parse(data[key]).e,setFailure:x=>failure=x,setBad:x=>badIdentity=x};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('false offline browser hint still persists exact handoff marker',async()=>{
 const h=harness();await settle();assert.equal(h.read().acked,1);assert.equal(h.calls.length,2);
 await h.api.sync();assert.equal(h.calls.length,2,'acknowledged metadata is not re-sent');
});
for(const failure of ['transport','http'])test(`real ${failure} failure retains journal then retries without agent dispatch`,async()=>{
 const h=harness();h.setFailure(failure);await settle();
 // Use a new revision after the bootstrap request so failure is deterministic.
 h.api.update('e',{question:'explicit request'});await settle();assert.notEqual(h.read().acked,h.read().clientRevision);
 h.setFailure(null);await h.api.sync();
 assert.equal(h.read().acked,h.read().clientRevision);
 assert(h.calls.every(c=>c.url.startsWith('/mizel-live/orb-events')));
 assert.equal(h.read().question,'explicit request');
});
test('wrong server capture identity never acknowledges marker',async()=>{
 const h=harness();h.setBad(true);await settle();assert.equal(h.read().acked,undefined);
 h.setBad(false);await h.api.sync();assert.equal(h.read().acked,1);
});
