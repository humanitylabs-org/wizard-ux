import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const chats = read('web/core/chats.js');
for (const ok of [true,false]) test(`attention and failure dismiss are optimistic, backend ok=${ok}`, async () => {
  const gates = [], notices = [];
  const c = {window:null,fetch:()=>{const g=deferred();gates.push(g);return g.promise;}};c.window=c;
  vm.runInNewContext(read('web/core/chat-errors.js'),c);const E=c.WosErrors;
  E.items=[{id:'a',canRetry:false},{id:'b',canRetry:false}];E.onChange(()=>notices.push(E.items.map(x=>x.id)));
  const pending=E.dismissAttention('a');assert.deepEqual(Array.from(E.items,x=>x.id),['b']);assert.equal(E.gone.has('a'),true);assert.equal(notices.length,1);
  assert.equal(await E.dismissAttention('a'),false,'double tap does not send twice');
  gates[0].resolve({ok,status:ok?200:500});assert.equal(await pending,ok);assert.equal(E.gone.has('a'),ok);assert.deepEqual(Array.from(E.items,x=>x.id),ok?['b']:['a','b']);
  const failure=E.dismissFailure('s');assert.equal(E.dismissed('s'),true);
  gates[1].resolve({ok,status:ok?200:500});assert.equal(await failure,ok);assert.equal(E.dismissed('s'),ok);assert.equal(E.busy.size,0);
});
for(const ok of [true,false])test(`Snooze cancel updates its state before I/O and rolls back on failure=${!ok}`,async()=>{
  const g=deferred(),events=[];
  const c={window:null,Event,CustomEvent:class extends Event{constructor(type,opts){super(type);this.detail=opts?.detail;}},URLSearchParams,Date,Intl,location:{search:'',pathname:'/'},localStorage:{getItem:()=>null,setItem(){}},setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,document:{hidden:false,querySelectorAll:()=>[],addEventListener(){},activeElement:null},addEventListener(){},dispatchEvent:e=>events.push(e.type),fetch:async(_,opts)=>opts?.method==='DELETE'?g.promise:{ok:true,json:async()=>({schedules:[{id:'return-a',kind:'return',thread:'s',when:{once:'2027-01-01T12:00:00Z'},timezone:'UTC'}]})}};c.window=c;
  vm.runInNewContext(read('web/core/scheduled-reminders.js').replace('window.WosBoomerang={','window.WosBoomerang={cancel,'),c);const B=c.WosBoomerang;await B.refresh();assert.equal(B.nextFor('s').id,'return-a');
  const p=B.cancel('return-a');assert.equal(B.nextFor('s'),null);await B.refresh();assert.equal(B.nextFor('s'),null,'stale polling does not put a pending cancellation back');
  g.resolve({ok,status:ok?200:500,json:async()=>({error:'fixture failure'})});
  if(ok)await p;else{await assert.rejects(p,/fixture failure/);assert.equal(B.nextFor('s').id,'return-a');}
  assert.ok(events.includes('wos:boomerang'));
});
test('archive, mark unread, notification actions and pin force UX paint before promises settle',()=>{
  assert.match(chats,/const pending = LIVE.markUnread\(sid\); paintActionLists\(\);/);
  assert.match(chats,/paintActionLists\(\); const ok = await pending; paintActionLists\(\);/);
  assert.match(chats,/const on = PIN.toggle\(sid\); paintActionLists\(\);/);
  const helper=chats.split('\n').find(line=>line.includes('function paintActionLists('));assert.doesNotMatch(helper,/holdList|requestAnimationFrame|setTimeout/);
});
for (const ok of [true, false]) test(`recording custody deletion acknowledges the tap before storage; rollback=${!ok}`, async () => {
  const gate=deferred(),notices=[];let recordings=[{id:'take',state:'held',createdAt:Date.now(),audio:{type:'audio/aac',size:100},durable:true}];
  const c={window:null,localStorage:{getItem:()=>null,setItem(){}},document:{querySelector:()=>null},addEventListener(){},setInterval:()=>0,URL,Blob};c.window=c;c.__wux={toast:(...a)=>notices.push(a)};
  c.WosOutbox={recordings:()=>recordings,onChange(){},remove:()=>gate.promise.then(()=>{if(ok)recordings=[];return ok;})};
  vm.runInNewContext(read('web/core/cancelled.js').replace('window.WosCancelled = {','window.WosCancelled = { _remove: remove,'),c);
  const pending=c.WosCancelled._remove('take');assert.match(c.WosCancelled.html(),/data-cx="delete"[^>]*disabled[^>]*>Deleting…/);
  gate.resolve();await pending;assert.equal(c.WosCancelled.html().includes('data-cxid="take"'),!ok);assert.doesNotMatch(c.WosCancelled.html(),/Deleting…/);assert.equal(notices.some(n=>n[0]==='!'),!ok);
});
for (const ok of [true, false]) test(`Unsent delete registers before its promise and renders settled result=${ok}`, async () => {
  const gate=deferred(),notices=[],button={disabled:false,textContent:'Delete'};let renders=0,calls=0;
  const c={window:null,addEventListener(){},document:{},navigator:{userAgent:'Fixture'},location:{host:'fixture'},localStorage:{getItem:()=>null},setTimeout};c.window=c;
  vm.runInNewContext(read('web/core/settings.js'),c);
  const ctx={root:{querySelectorAll:()=>[{dataset:{ubid:'take'},querySelector:()=>button}]},outbox:{get:()=>({id:'take'}),remove:()=>{calls++;return gate.promise;}},render(){renders++;button.disabled=false;button.textContent='Delete';},toast:(...a)=>notices.push(a)};
  c.WosSettings.unsentAction(ctx,'take','local','delete');c.WosSettings.unsentAction(ctx,'take','local','delete');
  assert.equal(button.disabled,true);assert.equal(button.textContent,'Deleting…');assert.equal(calls,1);assert.equal(renders,0);
  gate.resolve(ok);await flush();assert.equal(renders,1);assert.equal(button.disabled,false);assert.equal(notices[0][0],ok?'✕':'!');
});
test('desktop close removes the window and renders synchronously, without backend work',()=>{
  const src=read('web/desktop/desktop.js');for(const name of ['removeWin','closeWin']){const i=src.indexOf(`  function ${name}(`),body=src.slice(i,src.indexOf('\n  }',i)+4);assert.doesNotMatch(body,/\bawait\b|fetch\(|\.then\(/);assert.match(body,name==='removeWin'?/delete W\[id\]/:/removeWin\(id, internal\)/);}
});
