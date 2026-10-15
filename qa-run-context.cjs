// Run on Thales. Static candidate files + fixture histories; all non-read requests fenced.
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const fs = require('fs'), path = require('path');
const base = process.env.QA_URL;
if (!base) throw Error('Set QA_URL to the private read-only QA origin /wizard-os-home/');
const web = process.env.QA_WEB_DIR || path.join(__dirname, 'web');
const out = process.env.QA_OUT || path.join(__dirname, 'qa-evidence');
fs.mkdirSync(out, { recursive: true });
let passed = 0;
function ok(v, label) { if (!v) throw Error(label); passed++; console.log('PASS', label); }
const t = Date.now()/1000 - 3600;
const original = '[Wizard follow-through] Cross-thread note from the "Mizel.ai · Orb handoff" thread. The microphone fix passed browser checks and is waiting for the build machine. Please release it at the next safe checkpoint.';
const rows = [
 {id:1,role:'user',content:'How is the Mac build?',timestamp:t},
 {id:2,role:'assistant',content:'The Mac build is being checked.',timestamp:t+20},
 {id:3,role:'system',content:'',display_kind:'run_context',timestamp:t+40,run_context:{kind:'cross_thread',from:'Mizel.ai · Orb handoff',summary:'The microphone fix passed browser checks and is waiting for the build machine.',requested_action:'Please release it at the next safe checkpoint.',original}},
 {id:4,role:'assistant',content:'This note was sent to the wrong thread.',timestamp:t+42},
];
const fixtures = {
 qa_context: rows,
 qa_legacy: rows.filter(r=>r.id!==3),
 qa_secret: [rows[0],rows[1],{...rows[2],run_context:{kind:'continuation',from:'Wizard follow-through',summary:'<img src=x onerror="window.pwned=true">',original:'<script>window.pwned=true</script>\n'+ 'long-token-'.repeat(600),redacted:true,original_truncated:true}},rows[3]],
 qa_waiting: rows.slice(0,3),
};
const session = id => ({id,title:'Run context · '+id,source:'wizard-mobile',status:id==='qa_waiting'?'running':'completed',wizard_last_user_at:t,wizard_activity_at:t+42,wizard_last_assistant_at:t+42,message_count:fixtures[id].length,last_user_message:{role:'user',content:'How is the Mac build?',timestamp:t},last_active:t+42});
(async()=>{
 const browser=await chromium.launch();
 for(const desktop of [false,true]) {
  const ctx=await browser.newContext({viewport:desktop?{width:1440,height:1000}:{width:393,height:852},hasTouch:!desktop,isMobile:!desktop,serviceWorkers:'block'});
  let writes=0; const errors=[];
  await ctx.route('**/*',async route=>{
   const q=route.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())) {writes++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
   if(u.pathname.startsWith('/wizard-os-home/')){
    const relative=u.pathname.slice('/wizard-os-home/'.length)||'index.html';
    const file=path.resolve(web,relative);
    if(file.startsWith(path.resolve(web)+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({status:200,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.html')?'text/html':undefined,body:fs.readFileSync(file)});
   }
   if(u.pathname==='/wizard/hermes/api/sessions') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:Object.keys(fixtures).map(session),total:Object.keys(fixtures).length})});
   const m=u.pathname.match(/\/sessions\/(qa_[a-z]+)(\/messages)?$/);
   if(m && fixtures[m[1]])return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(m[2]?{data:fixtures[m[1]],total:fixtures[m[1]].length}:{session:session(m[1])})});
   return route.continue();
  });
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
  await p.addInitScript(()=>localStorage.setItem('wos.coached','true'));
  await p.goto(desktop?base+'desktop/':base,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__wos&&window.WizLive);
  async function open(id){await p.evaluate(async id=>{await WizLive.refresh();__wos.openWizardThread(id)},id);await p.waitForFunction(()=>document.querySelector('.ch-msgs .msg'));await p.waitForTimeout(700);}
  await open('qa_context');
  const card=p.locator('[data-run-context]').last();
  await card.waitFor();
  ok(await card.locator('[data-later]').count()===1,`${desktop}: notice retained above context`);
  ok((await card.innerText()).includes('Mizel.ai · Orb handoff'),`${desktop}: source shown`);
  ok((await card.innerText()).includes('Requested action:'),`${desktop}: requested action shown`);
  const detail=card.locator('details');
  ok(!await detail.evaluate(e=>e.open),`${desktop}: original starts collapsed`);
  await detail.locator('summary').click();
  ok(await detail.locator('pre').innerText()===original,`${desktop}: exact original expands`);
  await p.evaluate(()=>WizLive.refresh()); await p.waitForTimeout(400);
  ok(await p.locator('[data-run-original]').last().evaluate(e=>e.open),`${desktop}: refresh preserves disclosure`);
  ok(!await p.locator('.msg.u').filter({hasText:'Mizel'}).count(),`${desktop}: incoming note never attributed to user`);
  ok(await p.evaluate(()=>{const c=document.querySelector('[data-run-context]');return Boolean(c?.nextElementSibling?.matches('.msg.a'))}),`${desktop}: answer follows context`);
  await detail.locator('summary').click();
  await card.scrollIntoViewIfNeeded();
  await p.screenshot({path:path.join(out,desktop?'desktop.png':'phone.png')});
  const parsed=await p.evaluate(rows=>WizChatKit.parseRows([...rows.slice(0,3),rows[2],rows[3]]),rows);
  ok(parsed.length===2&&!parsed[1].u&&parsed[1].later.context.from==='Mizel.ai · Orb handoff',`${desktop}: duplicate context ignored and turns separated`);
  await open('qa_legacy');
  ok((await p.locator('.ch-msgs').innerText()).includes('isn’t available in this history'),`${desktop}: honest missing-context fallback`);
  await open('qa_secret');
  await p.locator('[data-run-original] summary').click();
  ok(!await p.evaluate(()=>window.pwned),`${desktop}: incoming text cannot execute HTML`);
  ok((await p.locator('[data-run-context]').innerText()).includes('sensitive values have been omitted'),`${desktop}: redaction disclosed`);
  ok((await p.locator('[data-run-context]').innerText()).includes('shortened here'),`${desktop}: truncation disclosed`);
  ok(await p.locator('[data-run-context]').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${desktop}: long text fits card width`);
  await open('qa_waiting');
  ok(await p.locator('[data-run-context]').count()===1,`${desktop}: context visible before first answer`);
  ok(errors.length===0,`${desktop}: no page errors ${errors.join(';')}`);
  console.log('Blocked writes:',writes);await ctx.close();
 }
 await browser.close();console.log(`${passed} passed`);
})().catch(e=>{console.error(e);process.exit(1)});
