// Regression: an old thread whose voice take pinned an incomplete model route (catalogue not loaded yet)
// must send once the owner picks a model; re-picking must never leave "Choose a model before sending" stuck.
// Real catalogue shape: default anthropic/claude-opus-5-5, thread on the subscription route claude-opus-5-5[1m].
const {chromium}=require(process.env.PW || 'playwright-core');
const fs=require('fs'),path=require('path');
const WEB=process.env.QA_WEB_DIR||__dirname,URL_='https://wizard.tailc0f369.ts.net/wizard-os-home/';
const W={uploads:[],sessions:new Set(),runs:[],keys:new Map(),transcribes:0,assetVer:1,foreign:[]};
const src=fs.readFileSync(path.join(__dirname,'qa-device.cjs'),'utf8');
eval(src.slice(src.indexOf('async function boot('),src.indexOf('// addInitScript')).replace('async function boot(','global.boot=async function boot('));
let pass=0,fail=0;const ok=(v,n,d)=>{console.log((v?'PASS ':'FAIL ')+n+(d?' '+JSON.stringify(d):''));v?pass++:fail++;};
const SUB='claude-subscription-directsdk-experimental', SID='qa_old_guard_thread';
const CATALOGUE={model:'claude-opus-5-5',provider:'anthropic',providers:[
  {slug:'anthropic',name:'Anthropic',authenticated:true,is_current:true,models:['claude-opus-5-5','claude-opus-5','claude-sonnet-5']},
  {slug:'openai-codex',name:'OpenAI Codex',authenticated:true,is_current:false,models:['gpt-6-astra','gpt-6-sol']},
  {slug:SUB,name:'Claude subscription',authenticated:true,is_current:false,models:['claude-opus-5-5[1m]','claude-opus-5[1m]']}]};
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
for(const delayCatalogue of [true,false]){
 const tag=delayCatalogue?' (catalogue late)':' (catalogue ready)';
 const {ctx,p,errs}=await boot(b);
 let release;const gate=new Promise(r=>release=r);if(!delayCatalogue)release();
 const sess={id:SID,title:'Thread running nine hours possible bug',source:'api_server',model:'claude-opus-5-5[1m]',provider:null,status:'completed',message_count:2,updated_at:new Date().toISOString()};
 await ctx.route('**/wizard/hermes/api/model/options',async r=>{await gate;r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(CATALOGUE)});});
 await ctx.route('**/wizard/hermes/api/sessions?*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[sess],has_more:false})}));
 await ctx.route(`**/wizard/hermes/api/sessions/${SID}/model*`,async r=>{const body=JSON.parse(r.request().postData()||'{}');sess.model=body.model;sess.provider=body.provider;sess.wizard_model_lock_updated_at=Date.now()/1000;
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({runtime:{model_lock:'accepted',model:body.model,provider:body.provider,selection_version:sess.wizard_model_lock_updated_at}})});});
 await p.goto(URL_);await p.waitForFunction(()=>__wos?.live?.ok && WosDevice?.ready);
 await p.evaluate(()=>WosTour?.finish('qa'));await p.waitForTimeout(500);
 await p.evaluate(id=>__wos.openWizardThread(id),SID);await p.waitForTimeout(900);
 const box=await p.locator('#orbWrap').boundingBox();const tap=()=>p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 const r0=W.runs.length;
 await tap();await p.waitForTimeout(1200);
 ok(await p.evaluate(()=>__wos.voice==='listen'&&!!__wos.V.native),'orb records native take'+tag);
 await tap();await p.waitForTimeout(2600);
 let toast=await p.evaluate(()=>document.getElementById('toast')?.innerText||'');
 if(delayCatalogue){
  // Catalogue still loading: no route can be verified, so nothing may be admitted yet.
  ok(W.runs.length===r0,'no admission while the route is unverifiable'+tag,toast);
  release();await p.waitForFunction(()=>WosModels.ready);await p.waitForTimeout(300);
  // Owner re-picks Opus in the header, exactly like James did.
  await p.evaluate(id=>WosModels.setThreadModel(id,WosModels.find('claude-opus-5-5','anthropic')),SID);await p.waitForTimeout(300);
  await p.evaluate(()=>{const t=document.getElementById('toast');if(t)t.innerText='';});
  await tap();await p.waitForTimeout(2600);
  toast=await p.evaluate(()=>document.getElementById('toast')?.innerText||'');
 }
 ok(W.runs.length===r0+1,'exactly one voice reply admitted'+tag,{runs:W.runs.length-r0,toast});
 const run=W.runs[r0]?.body;
 const want=delayCatalogue?{model:'claude-opus-5-5',provider:'anthropic'}:{model:'claude-opus-5-5[1m]',provider:SUB};
 ok(run?.session_id===SID&&run.model===want.model&&run.provider===want.provider&&run.require_model_lock===true,'reply uses the shown route and exact thread'+tag,run&&{model:run.model,provider:run.provider,sid:run.session_id});
 ok(!/Choose a model/.test(toast),'no stuck model warning'+tag,toast);
 ok(errs.length===0,'no page errors'+tag,errs);
 await ctx.close();
}
await b.close();console.log(`${pass} pass ${fail} fail`);process.exit(fail?1:0);})().catch(e=>{console.error(e);process.exit(2)});
