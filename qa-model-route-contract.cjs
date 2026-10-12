// Deterministic model-route trust contract. Synthetic fixtures only; no model or real Wizard calls.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const WEB = process.env.QA_WEB_DIR ? path.join(process.env.QA_WEB_DIR, 'web') : path.join(__dirname, 'web');
let pass = 0;
async function check(name, fn) { await fn(); pass++; console.log('PASS', name); }
const options = { provider:'openai-codex', model:'gpt-6.1-sol', providers:[
 {slug:'openai-codex', authenticated:true, is_current:true, models:['gpt-6.1-sol','gpt-5.4-mini']},
 {slug:'tinfoil-operator', authenticated:true, is_user_defined:true, models:['glm-5-3']},
 {slug:'anthropic', authenticated:true, models:['claude-opus-5-5']},
]};
const sleep = n => new Promise(r=>setTimeout(r,n));
function boot() {
 const sessions = new Map([
  ['s1',{id:'s1',model:'claude-opus-5-5',provider:'anthropic'}],
  ['private',{id:'private',model:'glm-5-3',provider:'tinfoil'}],
 ]), store = new Map(), calls = [], bodies = [];
 let delayLock = null, badAck = false, admissionFail = false, runRuntime = {model:'claude-opus-5-5',provider:'anthropic'};
 const timers = [];
 const context = { console, URL, Blob, crypto: require('crypto').webcrypto, Date, Map, Set, Promise,
  document:{documentElement:{dataset:{}},addEventListener(){}},
  addEventListener(){}, localStorage:{getItem:()=>null,setItem(){}},
  indexedDB:{open(){throw Error('fixture uses text fallback')}},
  setTimeout:(fn,n)=>{const h=setTimeout(fn,n);h.unref();timers.push(h);return h;}, clearTimeout,
  WizLive:{session:id=>sessions.get(id)}, WizConfig:{transcribe:async()=>({text:'synthetic voice'}),voicePrompt:()=>''},
  async fetch(url, init={}) {
   const method=init.method||'GET', payload=init.body&&typeof init.body==='string'?JSON.parse(init.body):null;
   calls.push({url,method,payload,key:init.headers?.['Idempotency-Key']});
   const response = (status,value)=>({ok:status>=200&&status<300,status,json:async()=>value});
   if(url.endsWith('/api/model/options'))return response(200,options);
   if(url.endsWith('/model')) {
    if(delayLock)await delayLock;
    return response(200,{runtime:{...payload,provider:badAck?'wrong-provider':payload.provider,model_lock:'accepted'}});
   }
   if(/\/v1\/runs\/[^/]+$/.test(url)&&method==='GET')return response(200,{runtime:runRuntime,status:'running'});
   if(url.endsWith('/steer'))return response(200,{status:'accepted'});
   if(url.endsWith('/api/sessions'))return response(201,{session:{id:payload.id}});
   if(url.endsWith('/files/upload'))return response(201,{file:{id:'synthetic-audio',filename:'voice.webm'}});
   if(url.endsWith('/v1/runs')){
    bodies.push({body:init.body,key:init.headers['Idempotency-Key']});
    if(admissionFail)return response(400,{error:'selected provider unavailable'});
    return response(202,{run_id:'synthetic-run',status:'queued'});
   }
   throw Error('unhandled fixture url '+url);
  }
 };
 context.window=context; vm.createContext(context);
 for(const f of ['core/chat-models.js','outbox.js'])vm.runInContext(fs.readFileSync(path.join(WEB,f),'utf8'),context,{filename:f});
 return {c:context,sessions,calls,bodies,lockDelay:p=>delayLock=p,badAck:v=>badAck=v,fail:v=>admissionFail=v,runtime:v=>runRuntime=v,close:()=>timers.forEach(clearTimeout)};
}
async function settled(b,id) { for(let i=0;i<150;i++){const it=b.c.WosOutbox.get(id);if(['sent','failed','empty'].includes(it?.state))return it;await sleep(10)}throw Error('fixture did not settle'); }
(async()=>{
 let b=boot();try {
  await b.c.WosModels.load();
  await check('existing reply seals the displayed model + provider + fail-closed lock',async()=>{
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic reply'});await settled(b,it.id);
   const p=JSON.parse(b.bodies.at(-1).body);assert.equal(p.model,'claude-opus-5-5');assert.equal(p.provider,'anthropic');assert.equal(p.require_model_lock,true);
  });
  await check('selector GLM change acknowledged then reply uses GLM, despite stale session list',async()=>{
   await b.c.WosModels.setThreadModel('s1',{value:'glm-5-3',provider:'custom:tinfoil-operator'});
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic GLM reply'});await settled(b,it.id);
   const p=JSON.parse(b.bodies.at(-1).body);assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');assert.equal(p.require_model_lock,true);
  });
  await check('voice and attachment-only reply keep selected GLM route',async()=>{
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',audio:new Blob(['synthetic'],{type:'audio/webm'}),files:[{id:'synthetic-file'}]});await settled(b,it.id);
   const p=JSON.parse(b.bodies.at(-1).body);assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');assert.equal(p.require_model_lock,true);assert(p.wizard_file_ids.includes('synthetic-file'));
  });
  await check('new thread without explicit pick freezes the displayed default',async()=>{
   const it=await b.c.WosOutbox.enqueue({kind:'new',text:'synthetic new'});await settled(b,it.id);
   const p=JSON.parse(b.bodies.at(-1).body);assert.equal(p.model,'gpt-6.1-sol');assert.equal(p.provider,'openai-codex');assert.equal(p.require_model_lock,true);
  });
  await check('legacy recap Tinfoil label resolves to private transport, never default',async()=>{
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'private',text:'synthetic'});await settled(b,it.id);
   assert.equal(JSON.parse(b.bodies.at(-1).body).provider,'custom:tinfoil-operator');
  });
  await check('switch during active run queues on chosen model instead of steering old model',async()=>{
   const before=b.calls.filter(x=>x.url.endsWith('/steer')).length;
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic',steerRunId:'old-opus'});await settled(b,it.id);
   assert.equal(b.calls.filter(x=>x.url.endsWith('/steer')).length,before);
   assert.equal(JSON.parse(b.bodies.at(-1).body).model,'glm-5-3');
  });
  await check('same-model active run permits verified steer',async()=>{
   b.runtime({model:'glm-5-3',provider:'custom:tinfoil-operator'});
   const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic',steerRunId:'glm-active'});assert((await settled(b,it.id)).steered);
  });
  await check('outage rejects and retry preserves model, provider, key and body',async()=>{
   b.fail(true);const it=await b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic unavailable'});assert.equal((await settled(b,it.id)).state,'failed');
   const first=b.bodies.at(-1);b.sessions.get('s1').model='gpt-6.1-sol';b.fail(false);b.c.WosOutbox.retry(it.id);await sleep(30);await settled(b,it.id);
   const second=b.bodies.at(-1);assert.equal(second.body,first.body);assert.equal(second.key,first.key);assert.equal(JSON.parse(second.body).model,'glm-5-3');
  });
  await check('pending selector save blocks sending instead of choosing old or default route',async()=>{
   let res;const p=new Promise(r=>res=r);b.lockDelay(p);
   const task=b.c.WosModels.setThreadModel('s1',{value:'gpt-6.1-sol',provider:'openai-codex'});
   await assert.rejects(b.c.WosOutbox.enqueue({kind:'reply',sessionId:'s1',text:'synthetic'}),/saving/);res();await task;b.lockDelay(null);
  });
  await check('wrong backend acknowledgement never claims model selected',async()=>{
   b.badAck(true);await assert.rejects(b.c.WosModels.setThreadModel('s1',{value:'glm-5-3',provider:'custom:tinfoil-operator'}),/confirm/);
   assert.equal(b.c.WosModels.snapshot('s1').model,'gpt-6.1-sol');
  });
  await check('old already-frozen unpinned request stays unsent',async()=>{
   const it={id:'legacy',kind:'reply',sessionId:'private',state:'queued',createdAt:Date.now(),attempts:0,text:'synthetic old',model:'glm-5-3',provider:'custom:tinfoil-operator',body:JSON.stringify({session_id:'private',input:'synthetic old'})};
   b.c.WosOutbox._items.set(it.id,it);await b.c.WosOutbox.pump();assert.equal(it.state,'failed');assert.match(it.error,/model lock/);
  });
 } finally {b.close()}
 console.log(`${pass} model-route contracts passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
