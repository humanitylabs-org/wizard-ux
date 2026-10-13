// Real served assets/catalogue; synthetic Telegram metadata and admission/STT stand-ins. No live writes.
const {chromium}=require(process.env.PW||'playwright-core');const fs=require('fs'),path=require('path'),crypto=require('crypto');
const WEB=__dirname,HOST='wizard.tailc0f369.ts.net',URL_=`https://${HOST}/wizard-os-home/`;
const W={uploads:[],sessions:new Set(),runs:[],keys:new Map(),transcribes:0,assetVer:1,foreign:[]};
const src=fs.readFileSync(path.join(__dirname,'qa-device.cjs'),'utf8');
eval(src.slice(src.indexOf('async function boot('),src.indexOf('// addInitScript')).replace('async function boot(','global.boot=async function boot(').replaceAll('private.wizard001.com',HOST));
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});let n=0;
for(const shell of ['phone','desktop']){
 const {ctx,p,errs}=await boot(b);if(shell==='desktop')await p.setViewportSize({width:1440,height:960});
 const models=await (await ctx.request.get(`https://${HOST}/wizard/hermes/api/model/options`)).json();
 if(!models.model||!models.provider)throw Error('Live default unavailable');
 const json=(r,d)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});
 await ctx.route(`https://${HOST}/wizard-os-home/**`,r=>r.continue());
 await ctx.route('**/api/model/options',r=>r.continue());
 await ctx.route('**/wizard/hermes/api/sessions?*',r=>json(r,{data:[{id:'qa_old_thread',title:'Synthetic Telegram routing canary',source:'telegram',model:models.model,provider:null,status:'completed',message_count:2,updated_at:new Date().toISOString()}],has_more:false}));
 await p.goto(URL_+(shell==='desktop'?'desktop.html':''));await p.waitForFunction(()=>((window.__wos||window.__wux)?.live?.ok)&&WosModels?.ready&&WosDevice?.ready);
 await p.evaluate(()=>window.WosTour?.finish('qa'));await p.evaluate(()=>window.__wos ? __wos.openWizardThread('qa_old_thread') : __wux.openThread('qa_old_thread'));await p.waitForTimeout(900);
 const result=await p.evaluate(()=>({route:WosModels.snapshot('qa_old_thread'),def:WosModels.defaultOption(),marker:typeof WosModels.currentRoute}));
 if(result.marker!=='function'||result.route.model!==models.model||result.route.provider!==models.provider)throw Error(JSON.stringify(result));
 const chip=await p.locator('.ch-model:visible').first().getAttribute('title');if(chip!==models.model)throw Error('Chip/send mismatch '+chip);n++;
 for(const file of ['core/chat-models.js','core/chat-power.js']){
  const res=await ctx.request.get(URL_+file);const body=await res.body();const expected=fs.readFileSync(path.join(WEB,'web',file));
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex');if(hash(body)!==hash(expected))throw Error('Served bytes mismatch '+file);n++;
 }
 const r0=W.runs.length, tr0=W.transcribes;
 // Shared nativeFinish path: synthetic local recorder bytes, real loaded production JS.
 if(shell==='phone')await p.evaluate(()=>{const id=WizardOSDevice.recStart('auto');Object.assign(__wos.V,{native:id,kind:'auto',replyTo:{sid:'qa_old_thread'},snap:null,acc:2000});__wos.setVoice('think');__wos.nativeFinish(id,false);});
 else { await p.locator('[data-chmic]:visible').click();await p.waitForTimeout(1400);await p.locator('[data-chmic]:visible').click(); }
 await p.waitForTimeout(2200);const run=W.runs[r0]?.body;
 if(W.runs.length!==r0+1||W.transcribes!==tr0+1||run?.session_id!=='qa_old_thread'||run?.model!==models.model||run?.provider!==models.provider||!run.require_model_lock)throw Error('Native live JS route mismatch '+JSON.stringify({run,result,runs:W.runs.length-r0,stt:W.transcribes-tr0}));n++;
 if(errs.length)throw Error(errs.join('\n'));n++;
 console.log('PASS',shell,'live assets + displayed/default route + native reply admission',JSON.stringify({model:models.model,provider:models.provider,checks:5}));
 await ctx.close();
}
await b.close();console.log(n+' live checks passed (mock inference/transcription; real assets/catalogue)');})().catch(e=>{console.error(e);process.exit(1)});
