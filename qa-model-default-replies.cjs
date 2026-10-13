// Native bridge/browser regression for model-only Telegram reply metadata. Every write is mocked.
const {chromium}=require(process.env.PW || 'playwright-core');
const fs=require('fs'),path=require('path');
const WEB=process.env.QA_WEB_DIR||__dirname,URL_='https://private.wizard001.com/wizard-os-home/';
const W={uploads:[],sessions:new Set(),runs:[],keys:new Map(),transcribes:0,assetVer:1,foreign:[]};
const src=fs.readFileSync(path.join(__dirname,'qa-device.cjs'),'utf8');
eval(src.slice(src.indexOf('async function boot('),src.indexOf('// addInitScript')).replace('async function boot(','global.boot=async function boot('));
let pass=0,fail=0;const ok=(v,n,d)=>{console.log((v?'PASS ':'FAIL ')+n+(d?' '+JSON.stringify(d):''));v?pass++:fail++;};
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
for(const model of ['fixture-model','']){
 const {ctx,p,errs}=await boot(b);
 await ctx.route('**/wizard/hermes/api/sessions?*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id:'qa_old_thread',title:'Telegram fixture',source:'telegram',model,provider:null,status:'completed',message_count:2,updated_at:new Date().toISOString()}],has_more:false})}));
 await p.goto(URL_);await p.waitForFunction(()=>__wos?.live?.ok && WosDevice?.ready);
 await p.evaluate(()=>WosTour?.finish('qa'));await p.waitForTimeout(500);
 await p.evaluate(()=>__wos.openWizardThread('qa_old_thread'));await p.waitForFunction(()=>WosModels.ready);await p.waitForTimeout(700);
 const r0=W.runs.length, tr0=W.transcribes;
 const header=await p.locator('.ch-model:visible').first().innerText();
 ok(header.includes('Fixture Model'),'header displays configured route for '+(model?'model-only':'missing-model'),header);
 const box=await p.locator('#orbWrap').boundingBox();
 await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await p.waitForTimeout(1200);
 ok(await p.evaluate(()=>__wos.voice==='listen'&&!!__wos.V.native),'orb records native take '+model);
 await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await p.waitForTimeout(2600);
 const d=await p.evaluate(()=>({calls:__dev.calls,takes:Object.keys(__dev.takes),voice:__wos.voice,toast:document.getElementById('toast')?.innerText}));
 ok(W.runs.length===r0+1,'one native voice reply admitted without choosing model '+model,d);
 const run=W.runs[r0]?.body;
 ok(run?.session_id==='qa_old_thread'&&run.model==='fixture-model'&&run.provider==='fixture'&&run.require_model_lock===true,'native reply uses same displayed model/provider and exact thread '+model,run);
 ok(W.transcribes===tr0+1,'native audio transcribed exactly once '+model);
 ok(d.calls.some(x=>x.startsWith('recStop:'))&&d.calls.some(x=>x.startsWith('recDone:')),'native recording durably handed off '+model);
 ok(!/Choose a model|Recording saved/.test(d.toast||''),'no false model-selection warning '+model,d.toast);
 await p.evaluate(()=>__wos.openWizardThread('qa_old_thread'));await p.waitForTimeout(500);
 await p.evaluate(()=>__wosNativeBack());
 ok(!p.isClosed()&&await p.evaluate(()=>!!__wos&&!__wos.wins[__wos.desks[__wos.idx].focus]?.thread),'Back returns to chat list and stays in app '+model);
 ok(errs.length===0,'no page errors '+model,errs);
 await ctx.close();
}
await b.close();console.log(`${pass} pass ${fail} fail`);process.exit(fail?1:0);})().catch(e=>{console.error(e);process.exit(2)});
