// Fault injection for the shipped outbox in a real browser; never contacts Wizard.
// Thales only. Each case owns an isolated browser context and fixture upload/run ledger.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(ROOT, 'qa-live', 'voice-custody');
const origin = 'http://127.0.0.1:9736';
let pass=0, fail=0; const results=[];
const ok=(condition,name,detail='')=>{results.push({name,passed:!!condition,detail}); console.log(condition?'PASS':'FAIL',name,detail); condition?pass++:fail++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const audio=Array.from({length:8192},(_,i)=>i%251), hash=crypto.createHash('sha256').update(Buffer.from(audio)).digest('hex');
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const engine=process.env.QA_ENGINE==='webkit'?webkit:chromium;
  const browser=await engine.launch({...(process.env.QA_ENGINE==='webkit'?{}:{executablePath:process.env.CHROMIUM}),headless:true});
  // WebKit does not expose Blob POST bodies to route.request().postDataBuffer().
  // Receive real bytes over loopback instead of substituting the expected fixture bytes.
  let active;
  const server=require('http').createServer(async(req,res)=>{
    if(req.url!=='/wizard/files/upload'||req.method!=='POST'||!active){res.writeHead(404);return res.end();}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
    active.events.push('upload');active.uploads.push({bytes:bytes.length,hash:crypto.createHash('sha256').update(bytes).digest('hex')});
    res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({file:{id:'voice-'+active.uploads.length,bytes:bytes.length,mime:'audio/webm'}}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(9736,'127.0.0.1',resolve);});
  try {
  async function fixture(fault='none') {
    const ctx=await browser.newContext({viewport:{width:412,height:892},hasTouch:true});
    const W={down:true, sttDown:false, events:[],uploads:[],runs:new Map(),calls:[],drop:false,badReceipt:false,empty:false};
    await ctx.addInitScript(({fault})=>{
      window.__fault={idb:fault==='put'||fault==='all',open:fault==='open',ls:fault==='all',route:false};
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(window.__fault.idb)throw new DOMException('Injected quota','QuotaExceededError');return put.apply(this,args);};
      const open=indexedDB.open.bind(indexedDB);
      indexedDB.open=(...args)=>{if(window.__fault.open)throw new DOMException('Injected unavailable','SecurityError');return open(...args);};
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(...args){if(window.__fault.ls)throw new DOMException('Injected quota','QuotaExceededError');return set.apply(this,args);};
      window.WosModels={snapshot:(sid,route)=>route||{model:'fixture-model',provider:'fixture-provider'},resolveRoute:async s=>{if(window.__fault.route)await new Promise(()=>{});return s;},matchesRuntime:()=>true};
      window.WizConfig={voicePrompt:()=>'',transcribe:async blob=>{const r=await fetch('/stt',{method:'POST',body:blob});if(!r.ok)throw new Error('STT down');return r.json();}};
    },{fault});
    await ctx.route('**/*',async route=>{
      const q=route.request(),u=new URL(q.url());
      if(u.origin!==origin)throw new Error('QA egress rejected: '+u.origin);
      if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/chats.css"></head><body style="background:#141124;color:white"><form class="ch-compose"><textarea aria-label="Message"></textarea></form><div id="voice"></div><script src="/outbox.js"></script></body></html>'});
      if(u.pathname==='/outbox.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'web/outbox.js'))});
      if(u.pathname==='/chats.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(ROOT,'web/core/chats.css'))});
      if(u.pathname==='/stt'){W.events.push('stt');return W.sttDown?route.abort('connectionrefused'):route.fulfill({json:{text:W.empty?'':'Original recorded words'}});}
      if(q.method()==='POST'){
        if(W.down)return route.abort('connectionrefused');
        if(u.pathname==='/wizard/files/upload'){active=W;return route.continue();}
        if(u.pathname==='/wizard/hermes/api/sessions')return route.fulfill({status:201,json:{}});
        if(u.pathname==='/wizard/hermes/v1/runs'){
          const key=q.headers()['idempotency-key'],body=q.postData();W.calls.push({key,body});
          if(W.runs.has(key)&&W.runs.get(key).body!==body)return route.fulfill({status:409,json:{error:'idempotency key conflict'}});
          if(!W.runs.has(key))W.runs.set(key,{body,runId:'run-'+W.runs.size});
          if(W.drop){W.drop=false;return route.abort('connectionreset');}
          if(W.badReceipt){W.badReceipt=false;return route.fulfill({status:202,body:'{broken',contentType:'application/json'});}
          return route.fulfill({status:202,json:{run_id:W.runs.get(key).runId,status:'queued'}});
        }
        throw new Error('Unexpected write '+u.pathname);
      }
      return route.fulfill({status:404,body:''});
    });
    const page=await ctx.newPage();await page.goto(origin);await page.evaluate(()=>WosOutbox.load());
    const add=(extras={})=>page.evaluate(async({audio,extras})=>{
      const blob=new Blob([new Uint8Array(audio)],{type:'audio/webm'});
      const it=await WosOutbox.enqueue({kind:'reply',sessionId:'thread-original',model:'model-original',provider:'provider-original',audio:blob,text:'',typed:'Typed context',source:'chat',...extras});return it.id;
    },{audio,extras});
    const row=id=>page.evaluate(id=>{const x=WosOutbox.get(id);return x&&{id:x.id,state:x.state,durable:x.durable,audio:x.audio?.size,audioFile:x.audioFile,body:x.body,model:x.model,provider:x.provider,sessionId:x.sessionId,storageError:x.storageError,attempts:x.attempts,error:x.error};},id);
    const retry=async id=>{await page.evaluate(id=>WosOutbox.retry(id),id);await sleep(300);};
    const wait=async(id,state)=>{await page.waitForFunction(({id,state})=>WosOutbox.get(id)?.state===state,{id,state},{timeout:10000});};
    return{ctx,page,W,add,row,retry,wait};
  }
  for(const fault of ['put','open']){
    const f=await fixture(fault),id=await f.add();await sleep(350);
    ok((await f.row(id)).audio===audio.length,`${fault}: original Blob retained after failed device save`);
    ok(!!await f.page.locator('.ch-compose [data-custody-notice]').count(),`${fault}: calm persistent composer warning`);
    await f.page.screenshot({path:path.join(OUT,fault+'-warning.png')});
    await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());await sleep(250);
    const row=await f.row(id);
    ok(row?.audio===audio.length,`${fault}: full recording and typed context survive reload`);
    if(row?.audio){f.W.down=false;await f.retry(id);await f.wait(id,'sent');
      ok(f.W.uploads.every(u=>u.hash===hash&&u.bytes===audio.length),`${fault}: exact original bytes confirmed by upload receipt`);
      const runs=[...f.W.runs.values()];ok(runs.length===1&&JSON.parse(runs[0].body).session_id==='thread-original'&&JSON.parse(runs[0].body).model==='model-original'&&JSON.parse(runs[0].body).provider==='provider-original',`${fault}: same destination/model/provider, one run`);
      ok(!(await f.row(id)).audio,`${fault}: audio released only after server receipts`);
    } else ok(false,`${fault}: delivery after reload unavailable`);
    await f.ctx.close();
  }
  {
    const f=await fixture('all'),id=await f.add();await sleep(300);
    const r=await f.row(id);ok(r.audio===audio.length&&!r.durable,'both stores fail: retains full RAM Blob and explicitly non-durable');
    ok(/Keep Wizard open/.test(await f.page.locator('.ch-compose').textContent()),'both stores fail: persistent keep-open notice');
    const guarded=await f.page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;});
    ok(guarded,'both stores fail: navigation/reload warning');
    for(let k=0;k<8;k++){await f.page.evaluate(()=>{for(const it of WosOutbox._items.values())if(it.state==='waiting')it.nextAt=0;WosOutbox.pump();});await sleep(100);}
    const after=await f.row(id);ok(after.state==='waiting'&&after.attempts>=6&&after.audio===audio.length,'both stores fail: retry budget never abandons RAM audio');
    f.W.down=false;f.W.sttDown=true;f.W.events=[];await f.retry(id);
    ok(f.W.events[0]==='upload'&&f.W.uploads[0]?.hash===hash,'both stores fail: upload-first protects original bytes before STT');
    ok((await f.row(id)).audio===audio.length,'STT failure after upload: keeps original Blob until admission');
    await f.page.evaluate(()=>{window.__fault.idb=false;window.__fault.ls=false;WosOutbox.pump();});
    await f.page.waitForFunction(id=>WosOutbox.get(id)?.durable,id,{timeout:5000});
    const restored=await f.row(id),notice=await f.page.locator('.ch-compose').textContent();
    // WebKit may still reject Blob IDB writes after the injected fault is lifted. A durable
    // fallback must say backup-kept, never falsely claim primary storage recovered or RAM-only.
    ok(restored.durable&&(restored.storageError?/backup copy is kept/.test(notice)&&!/Keep Wizard open/.test(notice):!await f.page.locator('[data-custody-notice]').count()),'storage returns: full item durable with accurate primary or backup notice');
    await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());await sleep(250);
    ok((await f.row(id))?.audio===audio.length,'storage returns: original audio survives restart');
    f.W.sttDown=false;await f.retry(id);await f.wait(id,'sent');ok(f.W.runs.size===1,'storage returns: one admitted run');await f.ctx.close();
  }
  for(const fault of ['none','put']){
    const f=await fixture(fault);f.W.down=false;f.W.drop=true;
    const id=await f.add();await sleep(400);const frozen=await f.row(id);
    ok(frozen.state==='waiting'&&frozen.audio===audio.length&&!!frozen.body,`${fault}: lost accepted response keeps Blob and exact frozen body`);
    await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());await sleep(250);
    await f.retry(id);await f.wait(id,'sent');
    ok(f.W.runs.size===1&&f.W.calls.length>=2&&f.W.calls.every(c=>c.key===id&&c.body===frozen.body),`${fault}: lost response + kill/reload reconciles to exactly one run`);
    ok(f.W.uploads.length===1,`${fault}: persisted upload receipt reused after restart`);await f.ctx.close();
  }
  {
    const f=await fixture();f.W.down=false;f.W.badReceipt=true;const id=await f.add();await sleep(350);
    ok((await f.row(id)).state==='waiting'&&(await f.row(id)).audio===audio.length,'malformed sent response is uncertain, never counted sent');
    await f.retry(id);await f.wait(id,'sent');ok(f.W.runs.size===1,'malformed response reconciles without duplicate');await f.ctx.close();
  }
  {
    const f=await fixture(); const id=await f.add();await sleep(200);
    await f.page.close(); const p=await f.ctx.newPage();f.page=p;await p.goto(origin);await p.evaluate(()=>WosOutbox.load());await sleep(150);
    ok(await p.evaluate(id=>WosOutbox.get(id)?.audio?.size===8192,id),'kill tab mid-upload: original persisted audio recovered');
    f.W.down=false;await p.evaluate(id=>WosOutbox.retry(id),id);await p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',id);
    ok(f.W.runs.size===1,'kill tab mid-upload: exactly one run after recovery');await f.ctx.close();
  }
  {
    const f=await fixture();const id=await f.page.evaluate(async audio=>{const it=await WosOutbox.stage({kind:'reply',sessionId:'pinned-thread',model:'pinned-model',provider:'pinned-provider',audio:new Blob([new Uint8Array(audio)],{type:'audio/webm'})});return it.id;},audio).catch(()=>null);
    ok(!!id,'pre-transcription stage owns audio before a network wait');
    if(id){await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());
      ok((await f.row(id))?.state==='failed'&&(await f.row(id))?.audio===audio.length,'restart during pre-send STT: visible retained recording, original destination');
      f.W.down=false;await f.retry(id);await f.wait(id,'sent');const body=JSON.parse([...f.W.runs.values()][0].body);
      ok(body.session_id==='pinned-thread'&&body.model==='pinned-model'&&body.provider==='pinned-provider','pre-send recovery keeps sealed route');}
    await f.ctx.close();
  }
  {
    const f=await fixture();f.W.down=false;f.W.empty=true;
    const id=await f.add({typed:''});await sleep(400);
    await f.page.evaluate(id=>{const it=WosOutbox.get(id);it.createdAt=Date.now()-120000;WosOutbox.pump();},id);await sleep(200);
    ok((await f.row(id))?.audio===audio.length,'empty transcript: original recording remains recoverable, never expiry-deleted');
    ok(f.W.runs.size===0,'empty transcript: no empty agent run');await f.ctx.close();
  }
  {
    const f=await fixture();f.W.down=false;
    const ids=await f.page.evaluate(async audio=>{
      const blob=new Blob([new Uint8Array(audio)],{type:'audio/webm'});
      const held=await WosOutbox.stage({kind:'reply',sessionId:'sealed',agent:'private-agent',model:'private-model',provider:'private-provider',audio:blob,typed:'original words',nativeId:'fixture-native'});
      const sent=await WosOutbox.enqueue({custodyId:held.id,text:''});
      return [held.id,sent.id];
    },audio);
    await f.wait(ids[0],'sent');
    ok(ids[0]===ids[1]&&f.W.runs.size===1,'staged recording reuses one custody/admission identity');
    const body=JSON.parse([...f.W.runs.values()][0].body);
    ok(body.session_id==='sealed'&&body.agent==='private-agent'&&body.model==='private-model'&&body.provider==='private-provider'&&body.input.includes('original words'),'staged delivery preserves sealed route and typed composer');
    const native=await f.page.evaluate(async audio=>(await WosOutbox.enqueue({nativeId:'fixture-native',audio:new Blob([new Uint8Array(audio)]),kind:'new'})).id,audio);
    ok(native===ids[0]&&f.W.runs.size===1,'native recovery cannot enqueue a second copy');await f.ctx.close();
  }
  {
    const f=await fixture();const id=await f.page.evaluate(async audio=>{
      const it=await WosOutbox.stage({kind:'new',intent:'command',audio:new Blob([new Uint8Array(audio)])});
      await WosOutbox.transition(it.id,'held','Handled locally');return it.id;
    },audio);
    await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());f.W.down=false;await sleep(200);
    ok((await f.row(id))?.state==='held'&&f.W.runs.size===0,'handled local command remains held across reload');
    await f.page.evaluate(id=>WosOutbox.remove(id),id);await f.page.reload();await f.page.evaluate(()=>WosOutbox.load());
    ok((await f.row(id))?.state==='sent'&&f.W.runs.size===0,'explicit discard tombstone prevents replay after reload');await f.ctx.close();
  }
  await browser.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({host:require('os').hostname(),engine:process.env.QA_ENGINE||'chromium',source:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'web/outbox.js'))).digest('hex'),pass,fail,results},null,2));
  console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
  } finally { await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=2;});
