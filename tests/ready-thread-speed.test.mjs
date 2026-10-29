import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

const chatKitSource = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const row = { id: 'wizard_speed', title: 'Synthetic Ready', source: 'wizard-mobile', status: 'completed', message_count: 2,
  wizard_retry_input: 'Synthetic request',
  wizard_last_user_at: 100, wizard_last_assistant_at: 200, wizard_activity_at: 200,
  wizard_attention: {state:'done',ask:'Synthetic answer saved'} };
const messages = [{id:1,role:'user',content:'Synthetic request',timestamp:100},{id:2,role:'assistant',content:'SYNTHETIC_CURRENT_ANSWER',timestamp:200}];
function setup(agent = '', detailRow = row) {
  const h = helperWorkingHarness({source:liveSource(),row,detail:{session:detailRow},agent});
  // sessionInfo's legacy fallback needs the shipped parser, just like the shell.
  // Keep this dependency local to these tests; do not substitute a parseRows stub.
  vm.runInContext(chatKitSource, vm.createContext(h.context), {filename:'web/core/chat-kit.js'});
  assert.equal(typeof h.context.WosChat.parseRows, 'function');
  const original = h.context.fetch, reads = [];
  h.context.fetch = async (url, init) => {
    reads.push(String(url));
    if (String(url).includes('/messages?')) return {ok:true,json:async()=>({data:structuredClone(messages),has_more:false})};
    return original(url,init);
  };
  return {...h,reads};
}
test('known main history does not wait for optional detail; cold unknown still discovers scope first', async () => {
  const h=setup(); await h.poll(); h.L.sessions[0].detailNeeded=true; const release=h.deferDetail();
  await h.L.messages(row.id);
  assert.equal(h.reads.filter(u=>u.includes('/messages?')).length,1);
  assert.equal(h.reads.filter(u=>u.includes('view=detail')).length,0);
  assert.equal(new URL(h.reads.find(u=>u.includes('/messages?')),'https://fixture.invalid').searchParams.get('limit'),'500');
  release();
  const cold=setup(), done=cold.deferDetail();
  const pending=cold.L.messages(row.id);
  await new Promise(r=>setImmediate(r));
  assert.equal(cold.reads.filter(u=>u.includes('/messages?')).length,0);
  done(); await pending;
  assert.equal(cold.reads.filter(u=>u.includes('view=detail')).length,1);
  assert.equal(cold.reads.filter(u=>u.includes('/messages?')).length,1);
  assert.equal(new URL(cold.reads.find(u=>u.includes('/messages?')),'https://fixture.invalid').searchParams.get('limit'),'500');
  assert.equal(cold.L.session(row.id).request,'Synthetic request');
});
test('legacy detail without retry metadata explicitly reads user input before the requested history', async () => {
  const {wizard_retry_input, ...legacy}=row;
  const h=setup('',legacy),done=h.deferDetail(),pending=h.L.messages(row.id);
  await new Promise(r=>setImmediate(r));
  assert.equal(h.reads.filter(u=>u.includes('/messages?')).length,0);
  done();const transcript=await pending;
  const history=h.reads.filter(u=>u.includes('/messages?'));
  assert.equal(history.length,2,'one legacy retry-input fallback plus the requested transcript, not duplicate open reads');
  assert.equal(new URL(history[0],'https://fixture.invalid').searchParams.get('limit'),'100');
  assert.equal(new URL(history[1],'https://fixture.invalid').searchParams.get('limit'),'500');
  assert.equal(h.L.session(row.id).request,'Synthetic request');
  const turns=h.context.WosChat.parseRows(transcript);
  assert.equal(turns.length,1);
  assert.equal(turns[0].u.text,'Synthetic request');
  assert.equal(turns[0].a.text,'SYNTHETIC_CURRENT_ANSWER');
});
for (const agent of ['synthetic-profile','synthetic-container','synthetic-restricted','synthetic-private']) test(`known ${agent} reads stay scoped and out of persistent history cache`,async()=>{
  const h=setup(agent); await h.poll();
  await h.L.messages(row.id);
  assert.ok(h.reads.find(u=>u.includes('/messages?')&&u.includes(`agent=${agent}`)));
  assert.equal(h.L.cachedMessages(row.id),null);
  assert.equal(h.reads.filter(u=>u.includes('view=detail')).length,0);
});
test('one open joins a warm read; separate opens keep independent generations and content invalidation',async()=>{
  const h=setup(); await h.poll();
  h.L.warm(row.id);
  await h.L.messages(row.id);
  assert.equal(h.reads.filter(u=>u.includes('/messages?')).length,1);
  assert.equal(h.L.cachedMessages(row.id).at(-1).content,'SYNTHETIC_CURRENT_ANSWER');
  h.L.sessions[0].activityAt='metadata-only';
  assert.ok(h.L.cachedMessages(row.id));
  h.L.sessions[0].lastUserAt=201; h.L.sessions[0].messageCount=3;
  assert.equal(h.L.cachedMessages(row.id),null);
});
test('Ready preloading is scheduled at main-list truth, prioritizes current answers, and skips hidden/save-data tabs',async()=>{
  const h=setup(); await h.poll();
  assert.ok(h.timers.some(t=>t.ms===0));
  h.context.document.hidden=true; h.L.warm(row.id);
  assert.equal(h.reads.filter(u=>u.includes('/messages?')).length,0);
  h.context.document.hidden=false; h.context.navigator.connection={saveData:true};h.L.warm(row.id);
  assert.equal(h.reads.filter(u=>u.includes('/messages?')).length,0);
});
