import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {once} from 'node:events';
import {OutlineLocalRealtime,localEndpoint,localHealth} from '../local-realtime.mjs';
async function fixture(t,handler){const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');server.on('connection',handler);t.after(()=>{for(const w of server.clients)w.terminate();server.close();});return `ws://127.0.0.1:${server.address().port}`;}
const ready=w=>w.send(JSON.stringify({type:'ready',model:'nemotron',replace:true}));
test('loopback only, no credentials or remote fallback',()=>{assert.throws(()=>localEndpoint('wss://cloud.example'));assert.throws(()=>localEndpoint('ws://user:pass@127.0.0.1'));assert.throws(()=>localEndpoint('ws://127.0.0.1/other'));});
test('250ms frames split losslessly; pre-open end drains; replacement and empty final authoritative',async t=>{
 const frames=[],partials=[],origin=[];let final;
 const endpoint=await fixture(t,(w,req)=>{origin.push(req.headers.origin);w.on('message',(b,binary)=>{if(binary){frames.push(Buffer.from(b));return;}const m=JSON.parse(b);if(m.type==='start'){assert.deepEqual(m,{type:'start',sample_rate:16000,format:'s16le',channels:1});ready(w);w.send(JSON.stringify({type:'partial',text:'hello wrong',replace:true}));w.send(JSON.stringify({type:'partial',text:'hello world',replace:true}));}else if(m.type==='end')w.send(JSON.stringify({type:'final',text:'',replace:true}));});});
 const s=new OutlineLocalRealtime(endpoint,{replace:t=>partials.push(t),completed:t=>final=t,error:e=>assert.fail(e.message)},{frameMs:1});
 const input=Buffer.alloc(8000);for(let i=0;i<input.length;i++)input[i]=i%251;
 s.append(input);s.close();await s.open();assert.equal(await s.result,true);
 assert.deepEqual(frames.map(b=>b.length),[3200,3200,1600]);assert.deepEqual(Buffer.concat(frames),input);assert.deepEqual(partials,['hello wrong','hello world']);assert.equal(final,'');assert.deepEqual(origin,[undefined]);
});
test('disconnect fails without committing draft; reconnect is explicit',async t=>{
 const endpoint=await fixture(t,w=>w.on('message',()=>{ready(w);w.close();}));let error;
 const s=new OutlineLocalRealtime(endpoint,{error:e=>error=e});await s.open();assert.equal(await s.result,false);assert.match(error.message,/disconnected/);
});
test('cancel before open settles and does not dial',async()=>{const s=new OutlineLocalRealtime('ws://127.0.0.1:1',{});s.append(Buffer.alloc(8000));s.abort();await s.open();assert.equal(await s.result,false);assert.equal(s.ws,undefined);});
test('unavailable adapter reports failure and unhealthy',async()=>{let error;const s=new OutlineLocalRealtime('ws://127.0.0.1:1',{error:e=>error=e});await s.open();assert.equal(await s.result,false);assert.match(error.message,/unavailable/);assert.equal(await localHealth('ws://127.0.0.1:1'),false);});
test('bounded queued PCM and thought ceiling fail visibly',()=>{for(const options of [{queueBytes:7999},{maxSeconds:.2}]){let error;const s=new OutlineLocalRealtime('ws://127.0.0.1:1',{error:e=>error=e},options);s.append(Buffer.alloc(8000));assert.equal(s.terminal,true);assert(error);}});
test('final deadline fails; no invented final',async t=>{const endpoint=await fixture(t,w=>w.on('message',b=>{if(JSON.parse(b).type==='start')ready(w);}));let error;const s=new OutlineLocalRealtime(endpoint,{error:e=>error=e},{finalMs:30});await s.open();s.close();assert.equal(await s.result,false);assert.match(error.message,/timed out/);});
