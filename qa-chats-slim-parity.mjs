// Cross-repository parity gate. QA_SERVICE points to the paired Service checkout.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),service=process.env.QA_SERVICE||path.join(here,'../service');
const {listRow,normalizeFull}=await import(path.join(service,'server/session-list-view.mjs'));
const {selectWindow}=await import(path.join(service,'server/session-list-window.mjs'));
const src=fs.readFileSync(new URL('./web/live.js',import.meta.url),'utf8');
const normalize=src.slice(src.indexOf('  const iso ='),src.indexOf('  /* ---- thread-seen'));
const seen=src.slice(src.indexOf('  const vis ='),src.indexOf('  function later('));
const groups=src.slice(src.indexOf('  const DAY ='),src.indexOf('  async function fetchDispositions'));
const sandbox={window:{WizConfig:{dayStart:n=>Math.floor(n/864e5)*864e5}},Date,Set,Map};
vm.runInNewContext(`const WEEK=7*864e5,WORKING=new Set(['submitting','queued','running','stopping']),ALIASES={started:'running',accepted:'queued',pending:'queued',waiting:'waiting_for_approval'},READY_OR_ATTENTION=new Set(['completed','failed','interrupted','waiting_for_approval','unknown']);${normalize}\n${seen}\n${groups}\nthis.test={normalize,groupWork,recordFor};`,sandbox);
const now=1800000000000,statuses=['','queued','running','started','accepted','waiting','waiting_for_approval','unknown','failed','interrupted','completed','cancelled'];
const rows=Array.from({length:720},(_,i)=>({id:`s${i}`,title:'Full untruncated title '+i,source:'wizard-mobile',status:statuses[i%statuses.length],archived:i%3===0,hidden:i%73===0,message_count:i%2?i:undefined,started_at:now/1000-i*3700,last_active:now/1000-i*3700,preview:'**cleaned** preview '.repeat(30),preview_role:i%2?'assistant':'user',preview_timestamp:now/1000-i*3700,wizard_request_preview:'Full request '.repeat(300),wizard_last_user_at:now/1000-i*3700,wizard_last_assistant_at:now/1000-i*3700+1}));
const plain=x=>JSON.parse(JSON.stringify(x));
for(const row of rows){
 const full=sandbox.test.normalize(row),compact=sandbox.test.normalize(listRow(row));
 assert.deepEqual(plain(full),plain(normalizeFull(row)));assert.deepEqual(plain(sandbox.test.recordFor(full,now)),plain(sandbox.test.recordFor(compact,now)),'unread input parity');
}
const before=sandbox.test.groupWork(rows.map(sandbox.test.normalize),now),selection=selectWindow(rows,{now}),after=sandbox.test.groupWork(selection.rows.map(sandbox.test.normalize),now);
for(const k of Object.keys(before))assert.deepEqual(after[k].map(s=>s.id),before[k].slice(0,k==='archive'?50:undefined).map(s=>s.id),k);
console.log(`PASS ${rows.length} normalized DTOs + exact unread fingerprints; all grouping sections; newest 50 actual Archive parity`);
