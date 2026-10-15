// Isolated real-shell browser contract tests; no request is ever continued/fetched.
// QA_PLAYWRIGHT=/external/path/playwright QA_CHROME=/path/to/chrome node tools/qa-scroll-capture.cjs
// QA_ROOT selects a source checkout (also permits baseline comparison); QA_OUT stores JSON evidence.
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(process.env.QA_ROOT || path.join(__dirname, '..'));
const OUT = path.resolve(process.env.QA_OUT || 'qa-scroll-capture-results');
const helper = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/scroll-capture.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const results = [], writes = [], errors = [];
const now = Date.now() / 1000;
const sessions = Array.from({length: 36}, (_, i) => ({ id: 'qa_sc_' + i, title: 'Capture fixture ' + i, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', status: 'completed', message_count: 2, started_at: now-600, last_active: now-i, wizard_last_user_at: now-300, wizard_last_assistant_at: now-i, wizard_activity_at: now-i, latest_message: {role:'assistant', content:'Fixture answer', timestamp:now-i}, last_user_message:{role:'user',content:'Fixture ask',timestamp:now-300} }));
const messages = id => [{id:1,session_id:id,role:'user',content:'Fixture question',timestamp:now-300},{id:2,session_id:id,role:'assistant',content:Array.from({length:70},(_,i)=>`Paragraph ${i}: synthetic ${id} content for scroll-capture lifecycle verification.`).join('\n\n'),timestamp:now-100}];
function ok(mode, name, value, detail) { const row={mode,name,pass:!!value,detail}; results.push(row); console.log(value?'PASS':'FAIL',mode,name,detail===undefined?'':JSON.stringify(detail)); }
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME || undefined});
 try { for(const enabled of [false,true]) {
  const mode=enabled?'helper-on':'helper-off';
  const ctx=await browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;
   const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
   if(!['GET','HEAD'].includes(q.method())) { writes.push({method:q.method(),path:p}); return json(p==='/wizard/thread-seen'?{state:{initializedAt:Date.now(),threads:{}}}:{ok:true}); }
   if(p.startsWith('/wizard-os-home/')) {
    const rel=decodeURIComponent(p.slice('/wizard-os-home/'.length))||'index.html';
    const file=path.resolve(ROOT,'web',rel);
    if(file.startsWith(path.join(ROOT,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()) return r.fulfill({status:200,contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    if(rel==='data.js')return r.fulfill({contentType:'application/javascript',body:'window.DATA = {};'});
    if(rel==='summaries.js')return r.fulfill({contentType:'application/javascript',body:'window.SUMMARIES = {};'});
   }
   if(p==='/wizard/v1/bootstrap')return json({bootstrap:1,settings:{agent:{name:'QA Agent'}},capabilities:{voice:true,files:true,router:true},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs',transcribe:'/wizard/voice/transcribe',route:'/wizard/v1/route',upload:'/wizard/files/upload'}});
   if(p==='/wizard/hermes/api/sessions')return json({data:sessions,has_more:false});
   if(/\/messages$/.test(p))return json({data:messages(p.split('/').at(-2)),has_more:false});
   if(/\/api\/sessions\/qa_sc_\d+$/.test(p))return json({session:sessions.find(s=>s.id===p.split('/').at(-1))});
   if(p==='/wizard/thread-seen')return json({state:{initializedAt:Date.now(),threads:{}}});
   if(p.endsWith('/model/options'))return json({model:'qa-model',provider:'qa-provider',providers:[{slug:'qa-provider',name:'QA',authenticated:true,is_current:true,models:['qa-model']}]});
   return json({}); // All unknown reads stay synthetic too. No real backend or origin required.
  });
  const p=await ctx.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push({mode,error:String(e)}));
  await p.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
  await p.goto('http://scroll-capture.invalid/wizard-os-home/');
  await p.waitForFunction(()=>window.__wos?.live?.session('qa_sc_0'));
  await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(700);
  if(enabled)await p.evaluate(helper);
  await p.evaluate(()=>{window.qaOwner=()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return {w,el:document.querySelector(`[data-chats="${w.id}"]`)};};window.qaScroller=()=>qaOwner().el.querySelector('.ch-msgs,.ch-scroll');});
  const open=async id=>{await p.evaluate(id=>__wos.openWizardThread(id),id);await p.waitForFunction(id=>qaOwner().w.thread===id&&qaOwner().el.querySelector('.ch-msgs .msg.a'),id);await p.waitForTimeout(400);};
  const begin=async id=>p.evaluate(id=>{const e=qaScroller();e.scrollTop=160;window.qaOld=e;window.qaSaved=e.scrollTop;const b=__wosScrollCapture.search();return {search:b,start:__wosScrollCapture.start(id)};},id);
  const paint=async()=>p.evaluate(()=>{const {w,el}=qaOwner();w.thread?__wos.chats.renderThread(w,el):__wos.chats.renderChatList(w,el);});
  try {
   ok(mode,'synthetic session list in actual Wizard UI',await p.locator('[data-chopen="qa_sc_0"]').count()>0);
   if(enabled){
    const b=await begin('list');ok(mode,'visible overflowing list discovered',!!b.start,b);
    await p.evaluate(()=>__wosScrollCapture.move('list',420));await paint();
    ok(mode,'same-list repaint held',await p.evaluate(()=>qaScroller()===qaOld&&!!__wosScrollCapture.check('list')));
    await p.evaluate(()=>__wosScrollCapture.end('list'));await p.waitForTimeout(100);
    ok(mode,'list hold flushed and reading position restored',await p.evaluate(()=>qaScroller()!==qaOld&&Math.abs(qaScroller().scrollTop-qaSaved)<2));
   }
   await open('qa_sc_0');
   ok(mode,'normal scrolling works',await p.evaluate(()=>{let e=qaScroller();e.scrollTop=220;return e.scrollTop===220;}));
   if(enabled){
    let b=await begin('thread');ok(mode,'visible thread discovered',!!b.start,b);
    await p.evaluate(()=>{__wosScrollCapture.move('thread',600);const c=__wos.chats.ch(qaOwner().w.id);window.qaTurns=c.turns;window.qaShape=JSON.stringify(c.turns[0]);});
    await paint();ok(mode,'same-thread repaint held during acquisition',await p.evaluate(()=>qaScroller()===qaOld&&!!__wosScrollCapture.check('thread')));
    await p.evaluate(()=>__wosScrollCapture.end('thread'));await p.waitForTimeout(100);
    ok(mode,'thread hold flushed and reading position restored',await p.evaluate(()=>qaScroller()!==qaOld&&Math.abs(qaScroller().scrollTop-qaSaved)<2));
    // Stream payload uses real shell turn cache and renderer, not a surrogate DOM.
    await begin('stream');
    const stream=await p.evaluate(()=>{const c=__wos.chats.ch(qaOwner().w.id);const t=c.turns.at(-1);if(!t.a?.text)return false;t.a.text+='\n\nQA_STREAM_MARKER';return true;});
    await paint();ok(mode,'stream repaint queued without mutation or capture abort',stream&&await p.evaluate(()=>!!__wosScrollCapture.check('stream')&&!qaScroller().textContent.includes('QA_STREAM_MARKER')));
    await p.evaluate(()=>__wosScrollCapture.end('stream'));await p.waitForTimeout(500); // shell's existing scroll-idle guard is 350ms
    const flushed=await p.evaluate(()=>({shown:qaScroller().textContent.includes('QA_STREAM_MARKER'),held:__wos.chats.ch(qaOwner().w.id).held,cache:__wos.chats.ch(qaOwner().w.id).turns.at(-1).a?.text.includes('QA_STREAM_MARKER'),same:qaScroller()===qaOld,tail:qaScroller().textContent.slice(-150)}));
    ok(mode,'stream update appears after end flush',flushed.shown,flushed);
    await begin('old-thread');await p.evaluate(()=>__wosScrollCapture.move('old-thread',700));await open('qa_sc_1');
    const nav=await p.evaluate(()=>{const e=qaScroller(),top=e.scrollTop;const stale=__wosScrollCapture.move('old-thread',0),ended=__wosScrollCapture.end('old-thread');return {stale,ended,same:qaScroller()===e,top,saved:e.scrollTop,thread:qaOwner().w.thread};});
    ok(mode,'navigation invalidates old token; stale cleanup cannot scroll new thread',nav.stale===null&&nav.ended===false&&nav.top===nav.saved&&nav.thread==='qa_sc_1',nav);
    for(const kind of ['same-height-text','append']){
     await begin(kind);await p.evaluate(kind=>{const e=qaScroller();if(kind==='append')e.append(document.createElement('p'));else {const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.data.includes('Paragraph')){n.data=n.data.replace('Paragraph','PARAGRAPH');break;}}}},kind);
     await p.waitForTimeout(50);ok(mode,kind+' mutation cancels and restores',await p.evaluate(kind=>!__wosScrollCapture.check(kind)&&Math.abs(qaOld.scrollTop-qaSaved)<2&&!qaOld.dataset.wosScrollCapture,kind));
    }
    await begin('cancel');await p.evaluate(()=>__wosScrollCapture.move('cancel',500));
    ok(mode,'explicit cancellation restores once, wrong token ignored',await p.evaluate(()=>__wosScrollCapture.end('wrong')===false&&__wosScrollCapture.end('cancel')===true&&__wosScrollCapture.end('cancel')===false&&qaOld.scrollTop===qaSaved));
    // Capture only the helper's 30s timer; invoke deterministically without sleeping.
    await p.evaluate(()=>{const native=setTimeout;window.qaNativeTimeout=native;window.setTimeout=(f,ms,...args)=>{if(ms===30000){window.qaDeadline=()=>f(...args);return native(()=>{},60000);}return native(f,ms,...args);};});
    await begin('timeout');await p.evaluate(()=>{setTimeout=qaNativeTimeout;__wosScrollCapture.move('timeout',650);qaDeadline();});
    ok(mode,'30s helper deadline restores and clears marker',await p.evaluate(()=>!__wosScrollCapture.check('timeout')&&qaOld.scrollTop===qaSaved&&!qaOld.dataset.wosScrollCapture));
    await p.evaluate(()=>{const o=document.createElement('div');o.id='qaCover';o.style='position:fixed;inset:0;z-index:2147483647;background:black';document.body.append(o);});
    ok(mode,'occluded thread rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>document.getElementById('qaCover').remove());
    await p.evaluate(()=>{qaScroller().style.transform='scale(.8)';});
    ok(mode,'scaled scroll surface rejected (pixel geometry must match)',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>qaScroller().style.transform='');
    await p.evaluate(()=>{qaScroller().style.height='20px';qaScroller().style.flex='none';});
    ok(mode,'too-small surface rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>{qaScroller().style.height='';qaScroller().style.flex='';});
    await p.evaluate(()=>__wos.goDesk(0));await p.waitForTimeout(600);ok(mode,'background chat rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(600);
   }
   await p.keyboard.press('Escape');await p.waitForTimeout(400);
   ok(mode,'Back from thread returns to list and keeps app open',await p.evaluate(()=>qaOwner().w.thread==null&&!!window.__wos&&document.visibilityState==='visible'));
   await p.keyboard.press('Escape');await p.waitForTimeout(400);
   ok(mode,'Back at root keeps app open',await p.evaluate(()=>!!window.__wos&&document.visibilityState==='visible'&&location.hostname==='scroll-capture.invalid'));
   await p.screenshot({path:path.join(OUT,mode+'.png')});
  }catch(e){ok(mode,'suite completed',false,String(e));console.log('DIAGNOSTIC',await p.evaluate(()=>({keys:Object.keys(window.__wos||{}),text:document.body.innerText.slice(0,1000)})));}
  await ctx.close();
 }
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({root:ROOT,results,writes,errors},null,2));}
 const passed=results.filter(r=>r.pass).length,failed=results.length-passed;
 console.log(JSON.stringify({passed,failed,writesIntercepted:writes.length,pageErrors:errors}));process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
