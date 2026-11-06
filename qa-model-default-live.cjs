// Real served assets/catalogue; synthetic Telegram metadata and admission/STT stand-ins. No live writes.
const {chromium}=require('./tools/qa-playwright.cjs');const fs=require('fs'),path=require('path'),crypto=require('crypto');
const WEB=__dirname,HOST=new URL(require('./tools/qa-paths.cjs').origin()).hostname,URL_=`${require('./tools/qa-paths.cjs').origin()}/wizard-os-home/`;
const W={uploads:[],sessions:new Set(),runs:[],keys:new Map(),transcribes:0,assetVer:1,foreign:[]};
const src=fs.readFileSync(path.join(__dirname,'qa-device.cjs'),'utf8');
eval(src.slice(src.indexOf('async function boot('),src.indexOf('// addInitScript')).replace('async function boot(','global.boot=async function boot(').replaceAll(new URL(require('./tools/qa-paths.cjs').origin()).hostname,HOST));
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});let n=0;
for(const shell of ['phone','desktop']){
 const {ctx,p,errs}=await boot(b);if(shell==='desktop')await p.setViewportSize({width:1440,height:960});
 p.on('request',r=>{if(r.method()!=='GET')console.log('REQUEST',r.method(),r.url());});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
 const models=await (await ctx.request.get(`${require('./tools/qa-paths.cjs').origin()}/wizard/hermes/api/model/options`)).json();
 if(!models.model||!models.provider)throw Error('Live default unavailable');
 const json=(r,d)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});
 await ctx.route(`${require('./tools/qa-paths.cjs').origin()}/wizard-os-home/**`,r=>r.request().method()==='GET'?r.continue():r.fallback());
 await ctx.route('**/api/transcribe',r=>{W.transcribes++;return json(r,{text:'Synthetic live-asset voice reply',ms:1200});});
 await ctx.route('**/api/model/options',r=>r.continue());
 await ctx.route('**/wizard/hermes/api/sessions?*',r=>json(r,{data:[{id:'qa_old_thread',title:'Synthetic Telegram routing canary',source:'telegram',model:models.model,provider:null,status:'completed',message_count:2,updated_at:new Date().toISOString()}],has_more:false}));
 await p.goto(URL_+(shell==='desktop'?'desktop.html':''));await p.waitForFunction(()=>((window.__wos||window.__wux)?.live?.ok)&&WosDevice?.ready);
 await p.evaluate(()=>window.WosTour?.finish('qa'));await p.evaluate(()=>window.__wos ? __wos.openWizardThread('qa_old_thread') : __wux.openThread('qa_old_thread'));await p.waitForFunction(()=>WosModels.ready);await p.waitForTimeout(900);
 const result=await p.evaluate(()=>({route:WosModels.snapshot('qa_old_thread'),def:WosModels.defaultOption(),marker:typeof WosModels.currentRoute}));
 if(result.marker!=='function'||result.route.model!==models.model||result.route.provider!==models.provider)throw Error(JSON.stringify(result));
 const chip=await p.locator('.ch-model:visible').first().getAttribute('title');if(chip!==models.model)throw Error('Chip/send mismatch '+chip);n++;
 for(const file of ['core/chat-models.js','core/chat-power.js']){
  const res=await ctx.request.get(URL_+file);const body=await res.body();const expected=fs.readFileSync(path.join(WEB,'web',file));
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex');if(hash(body)!==hash(expected))throw Error('Served bytes mismatch '+file);n++;
 }
 const r0=W.runs.length, tr0=W.transcribes;
 // Shared nativeFinish path: synthetic local recorder bytes, real loaded production JS.
 if(shell==='phone'){const box=await p.locator('#orbWrap').boundingBox();await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await p.waitForTimeout(1400);await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}
 else { await p.locator('[data-chmic]:visible').click();await p.waitForTimeout(1400);await p.locator('[data-chmic]:visible').click(); }
 await p.waitForTimeout(2200);const run=W.runs[r0]?.body;
 if(W.runs.length!==r0+1||W.transcribes!==tr0+1||run?.session_id!=='qa_old_thread'||run?.model!==models.model||run?.provider!==models.provider||!run.require_model_lock){console.log('DIAG',await p.evaluate(()=>({voice:(window.__wos||window.__wux)?.voice,calls:window.__dev?.calls,toast:document.getElementById('toast')?.innerText,items:(window.__wos||window.__wux)?.outbox?.list?.(),V:window.__wos?.V&&{state:__wos.V.state,native:__wos.V.native,acc:__wos.V.acc,snap:__wos.V.snap},cfg:window.WizConfig?.urls})));throw Error('Native live JS route mismatch '+JSON.stringify({run,result,runs:W.runs.length-r0,stt:W.transcribes-tr0}));}n++;
 if(shell==='phone'){
  await p.evaluate(()=>__wos.openWizardThread('qa_old_thread'));await p.waitForTimeout(500);
  const before=W.runs.length,stt=W.transcribes;
  await p.evaluate(model=>{const wid=__wos.desks[__wos.idx].focus,id=WizardOSDevice.recStart('auto');WosModels.keepVoiceRoute(id,{model,provider:''});Object.assign(__wos.V,{native:id,kind:'auto',replyTo:{wid,sid:'qa_old_thread'},snap:null,acc:2000,files:[],cancelled:false});__wos.setVoice('think');__wos.nativeFinish(id,false);},models.model);
  await p.waitForTimeout(2200);const recovered=W.runs[before]?.body;
  if(W.runs.length!==before+1||W.transcribes!==stt+1||recovered?.session_id!=='qa_old_thread'||recovered?.model!==models.model||recovered?.provider!==models.provider||!recovered.require_model_lock)throw Error('Saved voice recovery route mismatch '+JSON.stringify(recovered));n++;
  if(!await p.evaluate(()=>__dev.calls.some(x=>x.startsWith('recDone:'))&&!/Choose a model|Recording saved/.test(document.getElementById('toast')?.innerText||'')))throw Error('Saved take unacknowledged/model warning');n++;
 }
 if(errs.length)throw Error(errs.join('\n'));n++;
 console.log('PASS',shell,'live assets + displayed/default route + voice reply admission',JSON.stringify({model:models.model,provider:models.provider,checks:shell==='phone'?7:5}));
 await ctx.close();
}
await b.close();console.log(n+' live checks passed (mock inference/transcription; real assets/catalogue)');})().catch(e=>{console.error(e);process.exit(1)});
