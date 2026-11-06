'use strict';
// Reuse the closed real-shell transport; no owner data, providers or inference.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('./qa-playwright.cjs'),closed=require('./qa-closed-shell.cjs');
const OUT=process.env.QA_OUT;assert(OUT);fs.mkdirSync(OUT,{recursive:true});
const catalog={provider:'openai-codex',model:'gpt-6.1-sol',providers:[
 {slug:'openai-codex',authenticated:true,models:['gpt-6-astra','gpt-6.1-sol']},
 {slug:'anthropic',authenticated:true,models:['claude-opus-5-5','claude-sonnet-5','claude-sonnet-5-5','claude-haiku-4-5']},
 {slug:'claude-subscription-directsdk-experimental',authenticated:true,models:['claude-sonnet-5[1m]']}
]};
const report={synthetic:true,source:process.env.QA_SOURCE_SHA,cases:[],captures:[],errors:[]};
(async()=>{
 const browser=await chromium.launch({headless:true});closed.setBrowser(browser);
 try{
  for(const phone of [false,true]){
   const kind=phone?'phone':'desktop',root=phone?'__wos':'__wux';report.phase=kind+'-boot';
   const {c}=await closed.boot(phone,async c=>{
    c.on('page',p=>{p.on('pageerror',e=>report.errors.push({kind,error:e.message}));});
    await c.addInitScript(phone=>{if(window!==top)return;localStorage.setItem(phone?'wos.mobile-view.v1':'wos.desktop-view.v1','ai-apps');},phone);
    await c.route('http://wizard-qa.invalid/wizard/hermes/api/model/options',r=>r.fulfill({json:catalog}));
    await c.route('http://wizard-qa.invalid/wizard-claude/api/accounts',r=>r.fulfill({json:{accounts:[{id:'synthetic-native',source:'native',status:'ready'}]}}));
   });
   const p=closed.getPage();
   try{
    await p.waitForFunction(()=>window.WosExperience && document.documentElement.dataset.aiApps==='on');
    await p.evaluate(()=>WosExperience.whenReady());
    const wid=await p.evaluate(({phone,root})=>{const api=window[root];const app=WizCore.apps(phone?'mobile':'desktop').APPS.find(a=>a.id==='wizard');const admitted=phone?api.openApp(app):api.openApp(app.id);if(admitted===false)throw Error('Chats open refused');const w=Object.values(api.wins).find(w=>w.app==='chats'&&!w.agent);if(!w)throw Error('No main Chats window');api.chats.openNewDraft(w.id,'');return w.id;},{phone,root});
    await p.waitForFunction(()=>WosModels.ready&&WosModels.defaultOption()?.value==='gpt-6.1-sol');
    const chip=p.locator(`[data-chats="${wid}"] .ch-mlabel [data-chmodel]`);
    for(const skin of ['nebula','sepia']){
     report.phase=kind+'-'+skin+'-compact';
     await p.evaluate(({root,wid})=>window[root].chats.openNewDraft(wid,''),{root,wid});
     await p.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
     await p.waitForFunction(s=>document.documentElement.dataset.skin===s&&!WosExperience.state.busy,skin);
     await closed.settle(p);assert.match((await chip.innerText()).trim(),/^Sol/);
     await chip.click();const popup=p.locator('.ch-mpop');await popup.waitFor({state:'visible'});
     const sonnet=popup.locator('[data-mpick]').filter({has:p.locator('b',{hasText:/^Sonnet$/})});
     await sonnet.waitFor({state:'visible'});
     const before=await p.evaluate(()=>({model:WosModels.defaultOption().value,provider:WosModels.defaultOption().provider,shell:document.documentElement.dataset.shell}));
     assert.equal(before.shell,kind);
     const bounds=await popup.locator('.ch-sheet-b').boundingBox();const v=p.viewportSize();
     assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=v.width+1&&bounds.y+bounds.height<=v.height+1);
     const file=path.join(OUT,`${kind}-${skin}-compact-sonnet.png`);await p.screenshot({path:file});report.captures.push({file,phone,skin});
     await sonnet.click();
     await p.waitForFunction(({root,wid})=>window[root].chats.ch(wid).newModel?.model==='claude-sonnet-5-5',{root,wid});
     const after=await p.evaluate(({root,wid})=>{const picked=window[root].chats.ch(wid).newModel;const d=WosModels.defaultOption();return {picked,default:{model:d.value,provider:d.provider},catalogMatch:WosModels.options.some(o=>o.value===picked.model&&o.provider===picked.provider)};},{root,wid});
     assert.deepEqual(after.picked,{model:'claude-sonnet-5-5',provider:'anthropic'});
     assert.deepEqual(after.default,{model:before.model,provider:before.provider});assert.ok(after.catalogMatch);
     await p.evaluate(({root,wid})=>window[root].chats.openNewDraft(wid,''),{root,wid});assert.match((await chip.innerText()).trim(),/^Sol/);
     report.cases.push({kind,skin,bounds,before,after});
    }
   }finally{await c.close();}
  }
  assert.equal(report.cases.length,4);assert.deepEqual(report.errors,[]);assert.deepEqual(closed.report.unknown,[]);assert.deepEqual(closed.report.refusedWrites,[]);report.pass=true;
 }catch(e){report.error=e.stack;throw e;}
 finally{await browser.close();report.transport=closed.report;fs.writeFileSync(path.join(OUT,'sonnet-report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
