// wizard-ux issue 1762: the phone shell sent the same meeting marker to PUT /mizel-live/orb-events every 5 s for 40+
// minutes while the meeting server refused it with 409. The real web/core/orb-handoff.js runs in a vm with a fake
// clock, storage and network; the 5 s timer is driven by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.ORB_SYNC_SOURCE || new URL('../web/core/orb-handoff.js',import.meta.url),'utf8');
const KEY='wos.orb-meeting-events.v1';
const row=(id,rev=3)=>({id,meetingId:'mt_8b6b0a6b4f4d',captureId:'cap',status:'paused',clientRevision:rev,atMediaMs:1000});
function boot({rows,answer,data={},clock={now:1_700_000_000_000}}) {
  data[KEY]??=JSON.stringify(Object.fromEntries(rows.map(r=>[r.id,r])));
  const puts=[],ticks=[],listeners={};
  const DateX=class extends Date{static now(){return clock.now;}};
  const context={window:{},navigator:{onLine:true},Date:DateX,AbortSignal,console:{...console,warn(){}},
    localStorage:{getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v;}},
    setInterval:fn=>ticks.push(fn),addEventListener:(t,fn)=>{listeners[t]=fn;},crypto:globalThis.crypto,
    fetch:async(url,o={})=>{
      if(o.method==='PUT'){const b=JSON.parse(o.body);puts.push(b);const a=answer(b,puts.length);
        return {ok:a.status<300,status:a.status,text:async()=>JSON.stringify(a.body||{}),json:async()=>a.body||{event:b}};}
      const saved=puts.at(-1);return {ok:true,status:200,json:async()=>({events:saved?[saved]:[]})};}};
  vm.runInNewContext(source,context);
  const api=context.window.WosOrbHandoff,settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
  // Advance the fake clock in 5 s steps, firing the shell's interval each time, like a phone left open.
  async function run(ms){await settle();for(let t=0;t<ms;t+=5000){clock.now+=5000;ticks.forEach(f=>f());await settle();}}
  return {api,puts,data,clock,run,settle,online:()=>listeners.online?.(),read:()=>JSON.parse(data[KEY])};
}
const refused={status:409,body:{error:'Existing meeting could not be verified'}};

test('a meeting server that keeps answering 409 is not asked every 5 s forever',async()=>{
  const h=boot({rows:[row('orb-a'),row('orb-b')],answer:()=>refused});
  await h.run(45*60e3);
  // The old shell: 2 rows x 12 a minute x 45 minutes = 1080 PUTs. Now each row stops after 4 refusals.
  assert.equal(h.puts.length,8,'each refused row is tried 4 times, then parked');
  const a=h.read()['orb-a'];
  assert.equal(a.retry.parked,true);assert.equal(a.retry.status,409);assert.match(a.retry.error,/could not be verified/);
  assert.notEqual(a.acked,a.clientRevision,'a refused marker is kept on the device, never marked sent');
  assert.equal('retry' in h.puts[0],false,'the bookkeeping never goes to the server');
});

test('the wait survives a reload: a fresh page does not start a new 5 s burst',async()=>{
  const first=boot({rows:[row('orb-a')],answer:()=>refused});
  await first.run(10e3);assert.equal(first.puts.length,2,'tried at 0 s and 5 s; the next try waits 15 s');
  const again=boot({rows:[],answer:()=>refused,data:first.data,clock:first.clock});
  await again.run(5e3);
  assert.equal(again.puts.length,0,'the reload respects the wait already in the row');
  await again.run(70e3);assert.equal(again.puts.length,2,'then carries on from the same count: 2 more and it is parked');
  assert.equal(again.read()['orb-a'].retry.parked,true);
});

test('a parked marker is sent again once it changes, and a success clears the wait',async()=>{
  let accept=false;const h=boot({rows:[row('orb-a')],answer:()=>accept?{status:200}:refused});
  await h.run(10*60e3);assert.equal(h.read()['orb-a'].retry.parked,true);
  const n=h.puts.length;accept=true;
  h.api.update('orb-a',{question:'what did we decide?'});await h.settle();
  assert.equal(h.puts.length,n+1);
  const a=h.read()['orb-a'];assert.equal(a.acked,a.clientRevision);assert.equal(a.retry,undefined);
  await h.run(60e3);assert.equal(h.puts.length,n+1,'nothing more is sent after the server confirmed it');
});

test('a server that is down (503, network) backs off but keeps trying, and delivers when it is back',async()=>{
  let up=false;const h=boot({rows:[row('orb-a')],answer:()=>up?{status:200}:{status:503}});
  await h.run(30*60e3);
  assert.ok(h.puts.length<=8,`backed off: ${h.puts.length} tries in 30 minutes`);
  assert.equal(h.read()['orb-a'].retry.parked,undefined,'a server outage never parks a marker');
  up=true;await h.run(65*60e3);
  const a=h.read()['orb-a'];assert.equal(a.acked,a.clientRevision,'delivered once the server answers');
});

test('coming back online tries a waiting marker at once (but not a parked one)',async()=>{
  let status=503;const h=boot({rows:[row('orb-a'),row('orb-b')],answer:b=>b.id==='orb-b'?refused:{status}});
  await h.run(20*60e3);const n=h.puts.length;
  status=200;h.online();await h.settle();
  assert.equal(h.puts.length,n+1,'only the waiting marker is retried');
  assert.equal(h.read()['orb-a'].acked,3);assert.equal(h.read()['orb-b'].retry.parked,true);
});
