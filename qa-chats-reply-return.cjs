// Real-origin browser regression; all mutations fulfilled locally, SW blocked.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-reply-return');
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
  async function samples(label, before) { const out=[]; for (const t of [0, 400, 1500, 4000]) { if (t) await sleep(t - (out.at(-1)?.t||0)); const a=await place(); out.push({t, ...a}); } const okAll=out.every(a=>a.id===before.id && Math.abs(a.y-before.y)<2); ok(okAll, label, {before, out}); }
  // Typed reply from a list-opened thread: the phone steps back to the list at the reading position.
  for (const how of ['button', 'enter']) {
   const before=await position(); const id=await openVisible();
   await p.locator('.ch-compose textarea').fill('QA reply '+how);
   if (how==='button') await p.locator('.ch-compose .ch-send').tap(); else await p.locator('.ch-compose textarea').press('Enter');
   await p.waitForSelector('.ch-list', {timeout: 5000}).catch(()=>{});
   await samples('typed reply ('+how+') returns to list position', before);
  }
  // Done from a list-opened thread.
  { const before=await position(); const id=await openVisible(); await p.locator('[data-chact="done"]').first().tap(); await p.waitForSelector('.ch-list'); await samples('Done returns to list position over time', before); }
  ok(errors.length===0,'zero page errors',errors);
  ok(await p.evaluate(()=>!navigator.serviceWorker.controller),'service worker cannot bypass write fence');
  fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({pass,fail,checks,errors,writes,origin:URL_,live:process.env.QA_LIVE==='1'},null,2));
  console.log(`${pass} pass, ${fail} fail`);
 } catch(e){console.error(e);fail++;}finally{if(b)await b.close();}process.exitCode=fail?1:0;
})();
