// Real-origin browser regression; all mutations fulfilled locally, SW blocked.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-return-position');
const EXEC = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const checks = [], writes = [], errors = [];
function ok(v, name, evidence) { checks.push({ name, pass: !!v, evidence }); console.log(v ? 'PASS' : 'FAIL', name, JSON.stringify(evidence)); v ? pass++ : fail++; }
const now = Date.now()/1000, archived = new Set();
function session(i) { return { id: 'qa_return_' + i, source: 'wizard-mobile', title: 'QA return position ' + String(i).padStart(2,'0'), status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now-600, last_active: now-i, wizard_last_user_at: now-300, wizard_last_assistant_at: now-i, wizard_activity_at: now-i, wizard_attention: { state: 'done', ask: 'Scroll return fixture completed', subject: 'Research' }, latest_message: { role:'assistant', content:'Fixture answer.', timestamp:now-i }, last_user_message: { role:'user', content:'Fixture question.', timestamp:now-300 } }; }
(async () => {
 let b;
 try {
  b = await chromium.launch({ executablePath: EXEC });
  const ctx = await b.newContext({ viewport:{width:412,height:892}, hasTouch:true,isMobile:true,deviceScaleFactor:2, serviceWorkers:'block', userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  await ctx.route('**/*', async r => {
   const q=r.request(), u=new URL(q.url()), m=q.method();
   const json=body=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(m!=='GET' && m!=='HEAD') { writes.push({method:m,path:u.pathname}); const sid=u.pathname.match(/\/sessions\/(qa_return_\d+)$/)?.[1]; if (sid && m==='PATCH' && JSON.parse(q.postData() || '{}').archived) archived.add(sid); return json({ok:true,state:{initializedAt:Date.now(),threads:{}}}); }
   if(process.env.QA_LIVE!=='1' && u.pathname.startsWith('/wizard-os-home/')) {
    const f=u.pathname.slice('/wizard-os-home/'.length)||'index.html', fp=path.join(WEB,'web',f);
    if(!f.includes('..') && fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({status:200,contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':undefined,body:fs.readFileSync(fp)});
   }
   if(u.pathname==='/wizard/hermes/api/sessions') { const all=Array.from({length:36},(_,i)=>{const s=session(i);s.archived=archived.has(s.id);return s;}); return json({object:'list',data:all,pagination:{returned:all.length,offset:0,limit:100,has_more:false},has_more:false}); }
   const mm=u.pathname.match(/\/api\/sessions\/(qa_return_\d+)\/messages$/);
   if(mm) return json({object:'list',data:[{id:1,session_id:mm[1],role:'user',content:'Fixture question',timestamp:now-300},{id:2,session_id:mm[1],role:'assistant',content:'Fixture answer. [Linked thread](/wizard/?session=qa_return_25)',timestamp:now-200}],pagination:{returned:2,offset:0,limit:500}});
   const sm=u.pathname.match(/\/api\/sessions\/(qa_return_(\d+))$/); if(sm)return json({session:session(+sm[2])});
   if(/\/wizard\/(thread-seen|thread-dispositions)$/.test(u.pathname)) return json({state:{initializedAt:Date.now(),threads:{}}});
   return r.continue();
  });
  await ctx.addInitScript(()=>{localStorage.clear();localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(URL_+'?open=chats');await p.waitForSelector('[data-chopen="qa_return_20"]');await sleep(1500);
  if (process.env.QA_FULL === '1') { await p.locator('.win [data-wact="full"]').first().tap(); await sleep(1700); }
  async function place() { return p.evaluate(()=>{const sc=document.querySelector('.ch-scroll'),r=sc.getBoundingClientRect();const rows=[...sc.querySelectorAll('[data-chopen]')];const a=rows.find(e=>e.getBoundingClientRect().bottom>r.top);return {top:sc.scrollTop,id:a?.dataset.chopen,y:a? a.getBoundingClientRect().top-r.top:0};}); }
  async function position() { await p.evaluate(()=>{const sc=document.querySelector('.ch-scroll');sc.scrollTop=1037;});await sleep(500);return place(); }
  async function openVisible() { const id=await p.evaluate(()=>{const sc=document.querySelector('.ch-scroll'),r=sc.getBoundingClientRect();return [...sc.querySelectorAll('[data-chopen]')].find(e=>{const b=e.getBoundingClientRect();return b.top>r.top+100 && b.bottom<r.bottom-100;}).dataset.chopen;});await p.locator(`[data-chopen="${id}"]`).tap();await p.waitForSelector('.ch-msgs .msg.a');await sleep(300);return id; }
  for(const mode of ['header','escape','history']) {
   const before=await position();await openVisible();
   if(mode==='header')await p.locator('[data-chback]').tap();else if(mode==='escape')await p.keyboard.press('Escape');else await p.goBack();
   await p.waitForSelector('.ch-list');await sleep(650);const after=await place();ok(Math.abs(before.top-after.top)<2 && before.id===after.id,mode+' Back restores list position',{before,after});
   await p.evaluate(()=>__wos.live.refresh());await sleep(600);const polled=await place();ok(Math.abs(after.top-polled.top)<2,'position survives refresh after '+mode,{after,polled});
  }
  const beforeDone=await position(), id=await openVisible();await p.locator('[data-chact="done"]').first().tap();await p.waitForSelector('.ch-list');await sleep(800);
  const afterDone=await place();ok(Math.abs(beforeDone.top-afterDone.top)<2 && beforeDone.id===afterDone.id,'Done returns to saved list location',{id,before:beforeDone,after:afterDone});
  ok(await p.locator(`.ch-scroll [data-chopen="${id}"]`).count()===0,'Done removes the archived row from Ready',id);
  // Archive the top visible anchor; its surviving neighbor keeps the same screen coordinate.
  await position();const old=await place();const neighbor=await p.evaluate(id=>{const sc=document.querySelector('.ch-scroll'),a=sc.querySelector(`[data-chopen="${id}"]`).nextElementSibling;return {id:a.dataset.chopen,y:a.getBoundingClientRect().top-sc.getBoundingClientRect().top};},old.id);
  await p.evaluate(id=>__wos.openWizardThread(id),old.id);await p.waitForSelector('.ch-msgs .msg.a');await p.locator('[data-chact="done"]').first().tap();await p.waitForSelector('.ch-list');await sleep(800);
  const next=await p.evaluate(id=>{const sc=document.querySelector('.ch-scroll'),a=sc.querySelector(`[data-chopen="${id}"]`);return {id,y:a.getBoundingClientRect().top-sc.getBoundingClientRect().top,top:sc.scrollTop};},neighbor.id);
  ok(Math.abs(neighbor.y-next.y)<2,'archiving the anchor keeps the surviving neighbor in place',{neighbor,next});
  // Expanded Archive must not steal the bookmark when the anchor moves sections.
  await p.evaluate(() => document.querySelector('[data-sectoggle="archive"]').click()); await sleep(350);
  await position(); const expanded = await place(); const survivor = await p.evaluate(id => { const sc=document.querySelector('.ch-scroll'),a=sc.querySelector(`[data-chopen="${id}"]`).nextElementSibling; return {id:a.dataset.chopen,y:a.getBoundingClientRect().top-sc.getBoundingClientRect().top}; }, expanded.id);
  await p.evaluate(id=>__wos.openWizardThread(id),expanded.id); await p.waitForSelector('.ch-msgs .msg.a'); await p.locator('[data-chact="done"]').first().tap(); await p.waitForSelector('.ch-list'); await sleep(800);
  const archiveResult=await p.evaluate(id=>{const sc=document.querySelector('.ch-scroll'),a=sc.querySelector(`[data-chopen="${id}"]`);return {y:a.getBoundingClientRect().top-sc.getBoundingClientRect().top,top:sc.scrollTop};},survivor.id);
  ok(Math.abs(survivor.y-archiveResult.y)<2,'expanded Archive keeps the surviving Ready neighbor in place',{survivor,archiveResult});
  ok(await p.locator(`.ch-sec[data-sec="archive"] [data-chopen="${expanded.id}"]`).count()===1,'archived anchor is still rendered in expanded Archive',expanded.id);
  // While reading a thread, a row above the saved viewport vanishes.
  const saved=await position();await openVisible();await p.evaluate(()=>{__wos.live.session('qa_return_0').archived=true;__wos.live.emit();});await p.keyboard.press('Escape');await p.waitForSelector('.ch-list');await sleep(650);
  const changed=await place();ok(saved.id===changed.id && Math.abs(saved.y-changed.y)<2,'updates above viewport preserve the visible row on return',{saved,changed});
  await p.fill('[data-chsearch]','QA return position 30');await sleep(450);ok((await place()).top===0 && await p.locator('.ch-scroll [data-chopen="qa_return_30"]').count()===1,'single-result search remains usable');
  await p.screenshot({path:path.join(OUT,'list-return.png')});
  ok(errors.length===0,'zero page errors',errors);ok(!writes.some(x=>/\/v1\/runs$/.test(x.path)),'zero agent sends',writes);
  ok(await p.evaluate(()=>!navigator.serviceWorker.controller),'service worker cannot bypass write fence');
  fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({pass,fail,checks,errors,writes,origin:URL_,live:process.env.QA_LIVE==='1'},null,2));
  console.log(`${pass} pass, ${fail} fail`);
 } catch(e){console.error(e);fail++;}finally{if(b)await b.close();}process.exitCode=fail?1:0;
})();
