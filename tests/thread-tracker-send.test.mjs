import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const send = chats.slice(chats.indexOf('  async function sendChat('), chats.indexOf('  const picker =', chats.indexOf('  async function sendChat(')));
function fixture(agent,working,save='pending') {
 const order=[], w={id:'w',thread:'t'}, c={files:[]};
 const ctx={INC:null,W:{w},ch:()=>c,joinWords:(...s)=>s.filter(Boolean).join('\n'),pendRef:x=>x,MAX_FILES:10,
  KIT:{drafts:{get:()=>({}),clear(){},set(){order.push(['draft']);}}},LIVE:{session:()=>({runId:'run'}),agentOf:()=>agent,holdSend:()=>null},
  isWorking:()=>working,PW:null,OUTBOX:{enqueue:o=>{order.push(['enqueue',o.steerRunId]);return save==='pending'?new Promise(()=>{}):save==='fail'?Promise.reject(Error('synthetic storage failure')):Promise.resolve({sessionId:'t'});}},
  leaveAfterSend:()=>{order.push(['leave']);return {restore(){order.push(['restore']);}};},renderChats(){},applyLayout(){},deskOf:()=>null,toast(){},
  WosThreadTracker:{beforeSend:(sid,a,at,options)=>{assert.equal(typeof at,'number');assert.equal(options.defer,true);order.push(['seen',sid,a]);return {commit(){order.push(['commit']);},cancel(){order.push(['cancel']);}};}},
 };ctx.window=ctx;vm.createContext(ctx);vm.runInContext(send+'\nthis.send=sendChat;',ctx);return {ctx,order};
}
for(const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa'])for(const working of [false,true]) {
 test(`send/steer paints before navigation, not after custody wait: ${agent||'main'}/${working}`,()=>{
  const {ctx,order}=fixture(agent,working);ctx.send('w','Synthetic message','typing',null,{instructions:'fixture'});
  assert.deepEqual(order,[['seen','t',agent],['leave'],['enqueue',working?'run':'']]);
 });
 for(const save of ['ok','fail'])test(`send/steer Seen ${save==='ok'?'commits only after custody':'cancels on storage refusal'}: ${agent||'main'}/${working}`,async()=>{
  const {ctx,order}=fixture(agent,working,save);await ctx.send('w','Synthetic message','typing',null,{instructions:'fixture'});
  assert.deepEqual(order,[['seen','t',agent],['leave'],['enqueue',working?'run':''],...(save==='ok'?[['commit']]:[['cancel'],['draft'],['restore']])]);
 });
}
for(const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa'])for(const working of [false,true])test(`away share never acknowledges a thread: ${agent||'main'}/${working}`,async()=>{
 const {ctx,order}=fixture(agent,working,'ok');await ctx.send('w','Synthetic background share','typing',null,{sid:'t',away:true});
 assert.deepEqual(order,[['enqueue',working?'run':'']]);
});
