'use strict';
// Bounded emergency smoke: synthetic origin, no owner API or real writes.
const {chromium}=require('../tools/qa-playwright.cjs');
const {ownerRead}=require('../tools/qa-desktop-frame-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),out=process.env.QA_OUT||'emergency-layout-evidence';fs.mkdirSync(out,{recursive:true});
const origin='https://emergency.test',prefix='/wizard-os-home/';
const thread={id:'qa-thread',title:'Synthetic recovery thread',status:'completed',source:'wizard-mobile',updated_at:'2026-11-05T00:00:00Z',message_count:2,latest_message:{role:'assistant',content:'Synthetic completed reply.',timestamp:'2026-11-05T00:00:00Z'},wizard_attention:{kind:'check',summary:'Synthetic review'}};
const report={synthetic:true,cases:[],failures:[]};const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
(async()=>{const browser=await chromium.launch();try{
 for(const mode of ['normal','callback','missing'])for(const skin of ['nebula','sepia']){
  const row={mode,skin,imports:[],errors:[],writes:[],checks:[]};report.cases.push(row);
  const context=await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'block'});await context.routeWebSocket('**/*',ws=>ws.close());
  await context.addInitScript(skin=>{if(window!==top)return;for(const[k,v]of Object.entries({'wos.shell':'desktop','wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':skin,'wos.desktop-view.v1':'ai-apps'}))localStorage.setItem(k,v);
   const wins={restored:{id:'restored',app:'chats',thread:'qa-thread'}},ws=[{id:'drestored',wins:['restored'],focus:'restored',mono:false}];for(const[k,v]of Object.entries({wins,ws,cur:0,homeOpen:false}))localStorage.setItem('wux.desk.'+k,JSON.stringify(v));
  },skin);
  await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==origin)return r.abort();
   if(!['GET','HEAD'].includes(q.method())){row.writes.push(q.method()+' '+u.pathname);return r.fulfill({status:403,json:{error:'synthetic read-only smoke'}});}
   if(u.pathname.endsWith('/layouts/ai-apps/layout.js')){row.imports.push(u.search);if(mode==='missing')return r.fulfill({status:503,body:'Synthetic forced import failure'});}
   if(u.pathname==='/wizard/hermes/api/sessions')return r.fulfill({json:{object:'list',data:[thread],has_more:false,total:1}});
   if(u.pathname==='/wizard/hermes/api/sessions/qa-thread')return r.fulfill({json:{session:thread}});
   if(u.pathname==='/wizard/hermes/api/sessions/qa-thread/messages')return r.fulfill({json:{data:[{id:'u',role:'user',content:'Synthetic request.'},{id:'a',role:'assistant',content:'Synthetic completed reply.'}],has_more:false}});
   if(u.pathname==='/wizard/v1/ui-preferences')return r.fulfill({json:{migrations:{'launcher-seed-v1':true}}});
   if(u.pathname.startsWith('/wizard/'))return r.fulfill({json:ownerRead(u.pathname)});
   if(u.pathname.startsWith(prefix)){const file=path.resolve(root,u.pathname.slice(prefix.length)||'index.html');if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
    if(mode==='callback'&&u.pathname.endsWith('/layouts/ai-apps/desktop.js')){let body=fs.readFileSync(file,'utf8');const entry='export default function desktop(api) {';assert.equal(body.split(entry).length,2);body=body.replace(entry,entry+"\n api.on('render',()=>{if(globalThis.__emergencyFault){globalThis.__emergencyFaults=(globalThis.__emergencyFaults||0)+1;throw Error('Synthetic emergency callback fault');}}); ");return r.fulfill({contentType:'text/javascript',body});}
    return r.fulfill({path:file});}}
   return r.fulfill({json:{apps:[],agents:[],sessions:[],connected:false}});
  });
  const p=await context.newPage();p.on('pageerror',e=>row.errors.push(e.stack));
  try{
   await p.goto(origin+prefix+'desktop.html',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.WosExperience&&!WosExperience.state.busy&&(!WosSkinHost.layoutState.loading),null,{timeout:30000});
   if(mode==='missing'){
    await p.waitForFunction(()=>document.documentElement.dataset.layoutRecovery==='chats',null,{timeout:15000});
    assert.ok(row.imports.length>=4);assert.ok(new Set(row.imports).size>=4);
    await p.locator('[data-layout-recovery-chat] .pane-list .ch-row[data-chat="qa-thread"]').waitFor({state:'visible',timeout:15000});
    await p.locator('[data-layout-recovery-chat] .pane-list .ch-row[data-chat="qa-thread"]').click();
    await p.locator('[data-layout-recovery-chat] .pane-main .ch-compose textarea').fill('Synthetic unsent recovery draft');
    row.checks.push('four failed import attempts; shared Chats list clickable and composer editable');
   }else{
    await p.locator('.aad-side').waitFor({state:'visible',timeout:15000});
    if(mode==='callback'){
     row.before=await p.evaluate(()=>{globalThis.__emergencyScene=document.querySelector('.aad');globalThis.__emergencyFault=true;for(let i=0;i<3;i++)WosSkinHost.rendered('thread',document.body);return WosSkinHost.layoutState;});
     assert.equal(row.before.active,true);assert.equal(row.before.disabled,false);assert.equal(await p.evaluate(()=>__emergencyFaults),3);assert.equal(await p.evaluate(()=>__emergencyScene===document.querySelector('.aad')),true);
    }
    await p.locator('.aad-r[data-id="qa-thread"]').click();await p.locator('.win .pane-main .ch-compose textarea').fill('Synthetic unsent retained draft');
    row.checks.push(mode==='callback'?'three faults retain exact sidebar; chat click and typing work':'normal AI apps boot; chat click and typing work');
   }
   assert.equal(await p.locator('#wsList').isVisible(),false);assert.equal(await p.evaluate(()=>WosSkinHost.layout), 'ai-apps');
   await p.screenshot({path:path.join(out,mode+'-'+skin+'.png')});assert.deepEqual(row.errors,[]);row.pass=true;
  }catch(e){row.error=e.stack;report.failures.push({mode,skin,error:e.stack});await p.screenshot({path:path.join(out,mode+'-'+skin+'-failed.png')}).catch(()=>{});row.state=await p.evaluate(()=>({data:{...document.documentElement.dataset},layout:window.WosSkinHost?.layoutState})).catch(()=>null);}
  await context.close();save();
 }
}finally{await browser.close();}console.log(JSON.stringify(report));assert.equal(report.cases.length,6);assert.equal(report.failures.length,0);console.log('EMERGENCY_LAYOUT_SMOKE_PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
