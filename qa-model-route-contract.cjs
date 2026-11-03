// Deterministic model-route trust contract. Synthetic fixtures only; no model or real Wizard calls.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const WEB = process.env.QA_WEB_DIR ? path.join(process.env.QA_WEB_DIR, 'web') : path.join(__dirname, 'web');
let pass = 0;
async function check(name, fn) { if(process.env.QA_CASE && process.env.QA_CASE!==name)return;try{await fn();pass++;console.log('PASS',name);}catch(e){console.log('FAIL',name);throw e;} }
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
 let delayLock = null, badAck = false, admissionFail = false, runRuntime = {model:'claude-opus-5-5',provider:'anthropic',model_lock:'confirmed'};
 const timers = [];
 const context = { console, URL, Blob, AbortSignal, AbortController, crypto: require('crypto').webcrypto, Date, Map, Set, Promise,
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
    return response(200,{runtime:{...payload,provider:badAck?'wrong-provider':payload.provider,model_lock:'accepted',selection_version:(payload.selection_version||0)+1}});
   }
   if(/\/v1\/runs\/[^/]+$/.test(url)&&method==='GET') {
    const run_id=url.split('/').at(-1);
    // These four synthetic active runs belong to s1. Unknown/foreign runs are not fabricated.
    assert(['old-opus','wrong-active','unconfirmed-active','glm-active'].includes(run_id));
    return response(200,{run_id,session_id:'s1',runtime:{...runRuntime},status:'running'});
   }
   if(url.endsWith('/steer'))return response(200,{accepted:true,status:'accepted',run_id:url.split('/').at(-2)});
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
async function settled(b,id) { for(let i=0;i<150;i++){const it=b.c.WosOutbox.get(id);if(['sent','failed','empty','unconfirmed'].includes(it?.state))return it;await sleep(10)}throw Error('fixture did not settle'); }
function observed(b,it,before,state='sent',count=1) {
 const wires=b.bodies.slice(before), correlated=wires.filter(w=>w.key===it.id);
 console.log('OBSERVATION',JSON.stringify({id:it.id,before,after:b.bodies.length,state:it.state,error:it.error||'',errorStatus:it.errorStatus||0,route:{model:it.model,provider:it.provider},wires:wires.map(w=>({key:w.key,body:JSON.parse(w.body)}))}));
 assert.equal(it.state,state,it.error);assert.equal(wires.length,count,'exact NEW admission count');assert.equal(correlated.length,count,'every admission belongs to this outbox item');
 for(const wire of correlated){const p=JSON.parse(wire.body);assert.equal(p.session_id,it.sessionId);assert.equal(p.model,it.model);assert.equal(p.provider,it.provider);assert.equal(p.selection_version,it.selection_version);assert.equal(p.require_model_lock,true);}
 return {it,wire:correlated[0],p:correlated[0]&&JSON.parse(correlated[0].body)};
}
async function dispatch(b,o,state='sent',count=1) {
 const before=b.bodies.length,it=await b.c.WosOutbox.enqueue(o);await settled(b,it.id);return observed(b,it,before,state,count);
}
(async()=>{
 let b=boot();try {
  await b.c.WosModels.load();
  await check('Telegram reply with model-only metadata seals the configured default provider before native Send', async()=>{
   const def=b.c.WosModels.defaultOption();
   b.sessions.set('telegram',{id:'telegram',model:def.value,provider:''});
   const route=b.c.WosModels.snapshot('telegram');
   assert.equal(route.model,def.value);assert.equal(route.provider,def.provider);
   const {p}=await dispatch(b,{kind:'reply',sessionId:'telegram',audio:new Blob(['synthetic'],{type:'audio/aac'}),model:route.model,provider:route.provider});
   assert.equal(p.model,def.value);assert.equal(p.provider,def.provider);
  });
  await check('thread with no model metadata displays and sends the configured default',async()=>{
   const def=b.c.WosModels.defaultOption();b.sessions.set('blank',{id:'blank',model:'',provider:''});
   const route=b.c.WosModels.currentRoute('blank');assert.equal(route.model,def.value);assert.equal(route.provider,def.provider);
   assert.deepEqual(b.c.WosModels.snapshot('blank'),route);
   const {p}=await dispatch(b,{kind:'reply',sessionId:'blank',text:'synthetic blank'});assert.equal(p.model,def.value);assert.equal(p.provider,def.provider);
  });
  await check('unique model-only route completes its provider without changing model',async()=>{
   b.sessions.set('unique',{id:'unique',model:'gpt-5.4-mini',provider:''});
   assert.equal(b.c.WosModels.snapshot('unique').provider,'openai-codex');
  });
  await check('ambiguous non-default model stays unresolved; explicit private choice stays exact',async()=>{
   const m=b.c.WosModels, saved=m.options;
   m.options=[...saved,{value:'ambiguous',provider:'a'},{value:'ambiguous',provider:'b'}];
   b.sessions.set('ambiguous',{id:'ambiguous',model:'ambiguous',provider:''});
   assert.equal(m.snapshot('ambiguous').provider,'');
   const explicit=m.snapshot('',{model:'glm-5-3',provider:'custom:tinfoil-operator'});assert.equal(explicit.provider,'custom:tinfoil-operator');assert.equal(explicit.model,'glm-5-3');
   m.options=saved;
  });
  await check('existing reply seals the displayed model + provider + fail-closed lock',async()=>{
   const {p}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic reply'});
   assert.equal(p.model,'claude-opus-5-5');assert.equal(p.provider,'anthropic');
  });
  await check('selector GLM change acknowledged then reply uses GLM, despite stale session list',async()=>{
   await b.c.WosModels.setThreadModel('s1',{value:'glm-5-3',provider:'custom:tinfoil-operator'});
   const {p}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic GLM reply'});
   assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');
  });
  await check('voice and attachment-only reply keep selected GLM route',async()=>{
   const {p}=await dispatch(b,{kind:'reply',sessionId:'s1',audio:new Blob(['synthetic'],{type:'audio/webm'}),files:[{id:'synthetic-file'}]});
   assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');assert(p.wizard_file_ids.includes('synthetic-file'));
   const attachment=await dispatch(b,{kind:'reply',sessionId:'s1',files:[{id:'synthetic-attachment-only'}]});assert.equal(attachment.p.provider,'custom:tinfoil-operator');assert(attachment.p.wizard_file_ids.includes('synthetic-attachment-only'));
  });
  await check('new thread without explicit pick freezes the displayed default',async()=>{
   const def=b.c.WosModels.defaultOption(),{p}=await dispatch(b,{kind:'new',text:'synthetic new'});
   assert.equal(p.model,def.value);assert.equal(p.provider,def.provider);
  });
  await check('legacy recap Tinfoil label resolves to private transport, never default',async()=>{
   // Source-defined legacy shape: live.js projects model/provider without inventing a picker acknowledgement.
   const snapshot=b.c.WosModels.snapshot('private'),resolved=await b.c.WosModels.resolveRoute(snapshot);
   console.log('ALIAS',JSON.stringify({snapshot,resolved}));assert.equal(snapshot.provider,'tinfoil');
   assert.equal(resolved.model,'glm-5-3');assert.equal(resolved.provider,'custom:tinfoil-operator');
   const {p}=await dispatch(b,{kind:'reply',sessionId:'private',text:'synthetic'});
   assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');
  });
  await check('ambiguous legacy private label blocks with zero NEW inference requests',async()=>{
   const m=b.c.WosModels,providers=m.providers,opts=m.options;
   try {
    m.providers=providers.filter(p=>p.slug!=='tinfoil-operator').concat([{slug:'private-one',is_user_defined:true},{slug:'private-two',is_user_defined:true}]);
    m.options=opts.filter(o=>o.provider!=='custom:tinfoil-operator').concat([{value:'glm-5-3',provider:'custom:private-one'},{value:'glm-5-3',provider:'custom:private-two'}]);
    await assert.rejects(m.resolveRoute(m.snapshot('private')),/private provider is not verifiable/);
    const {it}=await dispatch(b,{kind:'reply',sessionId:'private',text:'synthetic ambiguous'},'failed',0);
    assert.match(it.error,/private provider is not verifiable/);assert.equal(it.text,'synthetic ambiguous');
   } finally {m.providers=providers;m.options=opts;}
  });
  await check('legacy private alias resolves before dispatch even with a cold catalogue',async()=>{
   const cold=boot();try {const {p}=await dispatch(cold,{kind:'reply',sessionId:'private',text:'synthetic cold alias'});assert.equal(p.provider,'custom:tinfoil-operator');assert.equal(p.model,'glm-5-3');}finally{cold.close();}
  });
  await check('switch during active run queues on chosen model instead of steering old model',async()=>{
   const before=b.calls.filter(x=>x.url.endsWith('/steer')).length;
   const {p}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic',steerRunId:'old-opus'});
   assert.equal(b.calls.filter(x=>x.url.endsWith('/steer')).length,before);
   assert.equal(p.model,'glm-5-3');assert.equal(p.provider,'custom:tinfoil-operator');
  });
  await check('actual wrong provider cannot be hidden by requested provider metadata',async()=>{
   const before=b.calls.filter(x=>x.url.endsWith('/steer')).length;
   b.runtime({model:'glm-5-3',provider:'wrong-public-provider',model_lock:'confirmed',requested:{model:'glm-5-3',provider:'custom:tinfoil-operator'}});
   const {p}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic wrong provider',steerRunId:'wrong-active'});
   assert.equal(b.calls.filter(x=>x.url.endsWith('/steer')).length,before);
   assert.equal(p.provider,'custom:tinfoil-operator');
  });
  await check('requested private metadata without confirmed runtime cannot authorize steer',async()=>{
   const before=b.calls.filter(x=>x.url.endsWith('/steer')).length;
   b.runtime({model:'glm-5-3',provider:'custom',model_lock:'accepted',requested:{model:'glm-5-3',provider:'custom:tinfoil-operator'}});
   await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic unconfirmed',steerRunId:'unconfirmed-active'});
   assert.equal(b.calls.filter(x=>x.url.endsWith('/steer')).length,before);
  });
  await check('same-model active run permits verified steer',async()=>{
   b.runtime({model:'glm-5-3',provider:'custom:tinfoil-operator',model_lock:'confirmed'});
   const before=b.calls.length,{it}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic',steerRunId:'glm-active'},'sent',0);
   assert(it.steered);const steers=b.calls.slice(before).filter(x=>x.url.endsWith('/steer'));assert.equal(steers.length,1);assert.equal(steers[0].key,it.id);assert.equal(steers[0].payload.provider,'custom:tinfoil-operator');
  });
  await check('outage rejects and retry preserves model, provider, key and body',async()=>{
   b.fail(true);const {it,wire:first}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic unavailable'},'failed');
   assert.equal(it.errorStatus,400);const before=b.bodies.length;b.sessions.get('s1').model='gpt-6.1-sol';b.fail(false);assert.equal(b.c.WosOutbox.retry(it.id),true);await settled(b,it.id);
   const {wire:second}=observed(b,it,before);assert.equal(second.body,first.body);assert.equal(second.key,first.key);assert.equal(JSON.parse(second.body).model,'glm-5-3');
  });
  await check('pending selector save blocks sending instead of choosing old or default route',async()=>{
   let res;const p=new Promise(r=>res=r);b.lockDelay(p);
   const task=b.c.WosModels.setThreadModel('s1',{value:'gpt-6.1-sol',provider:'openai-codex'});
   try {const {it}=await dispatch(b,{kind:'reply',sessionId:'s1',text:'synthetic'},'failed',0);assert.match(it.error,/saving/);}
   finally {res();await task;b.lockDelay(null);}
  });
  await check('newer authoritative selection on another device replaces local override',async()=>{
   const s=b.sessions.get('s1'),version=b.c.WosModels.snapshot('s1').selection_version;s.model='glm-5-3';s.provider='custom:tinfoil-operator';s.modelLockAt=version-1;
   b.c.WosModels.reconcile([s]);assert.equal(b.c.WosModels.snapshot('s1').model,'gpt-6.1-sol');
   s.modelLockAt=version+1;b.c.WosModels.reconcile([s]);assert.equal(b.c.WosModels.snapshot('s1').model,'glm-5-3');
   await b.c.WosModels.setThreadModel('s1',{value:'gpt-6.1-sol',provider:'openai-codex'});
  });
  await check('older native model-only take completes its saved provider without changing model',async()=>{
   const store=new Map();b.c.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
   b.c.WosModels.keepVoiceRoute('legacy-model-only',{model:'gpt-5.4-mini',provider:''});
   const saved=b.c.WosModels.voiceRoute('legacy-model-only');assert.equal(saved.model,'gpt-5.4-mini');assert.equal(saved.provider,'openai-codex');
  });
  await check('native recovery reads persisted send-time route after selector changes and page reload',async()=>{
   const store=new Map(), storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};b.c.localStorage=storage;
   b.c.WosModels.keepVoiceRoute('synthetic-native-take',{model:'glm-5-3',provider:'custom:tinfoil-operator'});
   const recovered=boot();recovered.c.localStorage=storage;
   const frozen=recovered.c.WosModels.voiceRoute('synthetic-native-take');assert.equal(frozen.model,'glm-5-3');assert.equal(frozen.provider,'custom:tinfoil-operator');
   recovered.c.WosModels.forgetVoiceRoute('synthetic-native-take');assert.equal(recovered.c.WosModels.voiceRoute('synthetic-native-take'),null);recovered.close();
  });
  await check('wrong backend acknowledgement never claims model selected',async()=>{
   b.badAck(true);await assert.rejects(b.c.WosModels.setThreadModel('s1',{value:'glm-5-3',provider:'custom:tinfoil-operator'}),/confirm/);
   assert.throws(()=>b.c.WosModels.snapshot('s1'),/not confirmed/);
  });
  await check('old already-frozen unpinned request stays unsent',async()=>{
   const it={id:'legacy',kind:'reply',sessionId:'private',state:'queued',createdAt:Date.now(),attempts:0,text:'synthetic old',model:'glm-5-3',provider:'custom:tinfoil-operator',body:JSON.stringify({session_id:'private',input:'synthetic old'})};
   const before=b.bodies.length;b.c.WosOutbox._items.set(it.id,it);await b.c.WosOutbox.pump();await settled(b,it.id);observed(b,it,before,'failed',0);assert.match(it.error,/Stored route does not match/);
  });
 } finally {b.close()}
 if(process.env.QA_CASE)assert.equal(pass,1,'exactly one requested case executed');
 console.log(`${pass} model-route contracts passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
