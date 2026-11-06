import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
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
