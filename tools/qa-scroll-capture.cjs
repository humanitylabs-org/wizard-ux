// Real-shell contract: all network is synthetic; non-GET/HEAD is always 403.
// QA_PLAYWRIGHT and QA_CHROME select an external Playwright/Chrome installation.
const fs = require('fs'), path = require('path');
const { chromium } = require('./qa-playwright.cjs');
const ROOT = path.resolve(process.env.QA_ROOT || path.join(__dirname, '..'));
const OUT = path.resolve(process.env.QA_OUT || 'qa-scroll-capture-results');
fs.mkdirSync(OUT, { recursive: true });
const results = [], writes = [], errors = [];
const now = Date.now() / 1000;
const sessions = Array.from({length: 6}, (_, i) => ({ id: 'qa_sc_' + i, title: 'Capture fixture ' + i, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', status: 'completed', message_count: 150, started_at: now-600, last_active: now-i, wizard_last_user_at: now-300, wizard_last_assistant_at: now-i, wizard_activity_at: now-i, latest_message: {role:'assistant', content:'Fixture answer', timestamp:now-i}, last_user_message:{role:'user',content:'Fixture ask',timestamp:now-300} }));
const messages = id => Array.from({length:75},(_,i)=>[
 {id:i*2+1,session_id:id,role:'user',content:`Question ${i}`,timestamp:now-600+i*2},
 {id:i*2+2,session_id:id,role:'assistant',content:`ROW ${String(i).padStart(2,'0')} synthetic answer for document scrolling.\n\nSecond paragraph of fixture message ${i}.`,timestamp:now-599+i*2}]).flat();
function ok(mode,name,value,detail) { results.push({mode,name,pass:!!value,detail}); console.log(value?'PASS':'FAIL',mode,name,detail===undefined?'':JSON.stringify(detail)); }
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME || undefined});
 try { for(const [android,skin] of [[false,'obsidian'],[true,'obsidian'],[true,'landscapes']]) {
  const mode=(android?'android-':'browser-')+skin;
  const ctx=await browser.newContext({viewport:android?{width:412,height:915}:{width:1280,height:900},deviceScaleFactor:2.625,isMobile:android,hasTouch:android,userAgent:android?'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 WizardOS-Android/0.9.42':'Mozilla/5.0 Chrome/140 Safari/537.36',serviceWorkers:'block'});
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;
   const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
   if(!['GET','HEAD'].includes(q.method())) { writes.push({method:q.method(),path:p}); return r.fulfill({status:403,body:'QA blocks writes'}); }
   if(p.startsWith('/wizard-os-home/')) {
    const rel=decodeURIComponent(p.slice('/wizard-os-home/'.length))||'index.html',file=path.resolve(ROOT,'web',rel);
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
   return json({});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push({mode,error:String(e)}));
  p.on('console', m=>{if(m.type()==='error') console.log('BROWSER_ERROR',m.text());});
  await p.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
  try {
   await p.goto('http://scroll-capture.invalid/wizard-os-home/');
   if(!android) {
    await p.locator('[data-chopen="qa_sc_0"]').first().click();
    await p.waitForSelector('.ch-msgs .msg.a');
    ok(mode,'desktop mode remains off',await p.evaluate(()=>!document.documentElement.classList.contains('wos-doc-scroll')));
    ok(mode,'desktop retains fixed document and inner scrolling',await p.evaluate(()=>{const s=document.querySelector('.ch-msgs');s.scrollTop=300;return scrollY===0&&s.scrollTop===300&&document.scrollingElement.scrollHeight<=innerHeight;}));
    await p.screenshot({path:path.join(OUT,mode+'-desktop.png')});
    await ctx.close();continue;
   }
   await p.waitForFunction(()=>window.__wos?.live?.session('qa_sc_0'));
   await p.evaluate(skin=>{__wos.goDesk(1);window.WosSkin?.set?.(skin);document.documentElement.dataset.skin=skin;},skin);await p.waitForTimeout(700);
   await p.waitForFunction(()=>!document.querySelector('.mz-intro'),null,{timeout:30000});
   await p.evaluate(()=>{window.qaOwner=()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return {w,el:document.querySelector(`[data-chats="${w.id}"]`)};};window.qaScroller=()=>document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:qaOwner().el.querySelector('.ch-msgs');});
   const open=async id=>{await p.evaluate(id=>__wos.openWizardThread(id),id);await p.waitForFunction(id=>qaOwner().w.thread===id&&qaOwner().el.querySelector('.ch-msgs .msg.a'),id);await p.waitForTimeout(600);await p.evaluate(()=>qaOwner().el.querySelector('.ch-msgs').dispatchEvent(new Event('wheel',{bubbles:true})));await p.waitForTimeout(500);};
   const paint=async()=>p.evaluate(()=>{const {w,el}=qaOwner();__wos.chats.renderThread(w,el);});
   const metrics=()=>p.evaluate(()=>{const {el}=qaOwner(),r=s=>el.querySelector(s).getBoundingClientRect().toJSON();return {top:scrollY,height:document.scrollingElement.scrollHeight,vh:innerHeight,head:r('.ch-head'),composer:r('.ch-compose'),first:r('.msg'),last:[...el.querySelectorAll('.msg')].at(-1).getBoundingClientRect().toJSON(),innerTop:el.querySelector('.ch-msgs').scrollTop,composerUncovered:(()=>{const b=el.querySelector('.ch-compose').getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.ch-compose');})()};});
   await open('qa_sc_0');
   ok(mode,'mode limited to native Android app',await p.evaluate(()=>document.documentElement.classList.contains('wos-doc-scroll'))===android);
   if(android) {
    let m=await metrics();ok(mode,'document is long',m.height>m.vh*2,m);
    await p.evaluate(()=>window.scrollTo(0,450));await p.waitForTimeout(450);
    m=await metrics();ok(mode,'window scroll moves messages, not inner overflow',m.top===450&&m.innerTop===0&&m.first.top<0,m);
    ok(mode,'header and composer stay in viewport',m.head.top>=0&&m.head.bottom<m.vh&&m.composer.top>m.head.bottom&&m.composer.bottom<=m.vh+1&&m.composerUncovered,m);
    await p.evaluate(()=>window.scrollTo(0,1e9));await p.waitForTimeout(500);
    m=await metrics();ok(mode,'last message fully above composer at bottom',m.last.bottom<=m.composer.top+1&&m.last.top>=m.head.bottom,m);
    // Stream/arrival through the real turn cache + real renderer.
    await p.evaluate(()=>{const c=__wos.chats.ch(qaOwner().w.id);c.turns.push(...__wos.chats.toTurns([{id:99901,role:'user',content:'New question',timestamp:Date.now()/1000},{id:99902,role:'assistant',content:'NEW_MESSAGE_SENTINEL',timestamp:Date.now()/1000}]));});
    await paint();await p.waitForTimeout(500);
    ok(mode,'new message while following remains at bottom',await p.evaluate(()=>{const s=qaScroller();return s.scrollHeight-s.scrollTop-s.clientHeight<2&&qaOwner().el.textContent.includes('NEW_MESSAGE_SENTINEL');}));
    // Top auto-load prepends 15 older turns and retains the first previously visible message.
    const anchor=await p.evaluate(()=>{const n=qaOwner().el.querySelector('.msg');window.qaAnchorText=n.textContent;return n.textContent;});
    await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(650);
    const older=await p.evaluate(()=>{const n=[...qaOwner().el.querySelectorAll('.msg')].find(n=>n.textContent===qaAnchorText);return {show:__wos.chats.ch(qaOwner().w.id).show,top:scrollY,y:n?.getBoundingClientRect().top,head:qaOwner().el.querySelector('.ch-head').getBoundingClientRect().bottom};});
    ok(mode,'reaching top loads older and preserves reading anchor',older.show>=120&&older.top>0&&Math.abs(older.y-older.head-12)<100,{anchor,...older});
    await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(500);m=await metrics();
    ok(mode,'first message reachable below header',m.first.top>=m.head.bottom&&m.first.bottom<m.composer.top,m);
    await open('qa_sc_2');await p.evaluate(()=>window.scrollTo(0,600));await p.waitForTimeout(600);await open('qa_sc_3');await open('qa_sc_2');
    ok(mode,'per-thread reading position restored',Math.abs((await metrics()).top-600)<3,await metrics());
    await p.evaluate(()=>qaOwner().el.querySelector('.ch-msgs').dispatchEvent(new Event('wheel',{bubbles:true})));
    await p.evaluate(()=>window.scrollTo(0,450));await p.waitForTimeout(400);
    await p.locator('[data-chlatest]').click();await p.waitForTimeout(2200);
    ok(mode,'jump to latest uses document',await p.evaluate(()=>{const s=qaScroller();return s.scrollHeight-s.scrollTop-s.clientHeight<2;}),await metrics());
    await p.waitForFunction(()=>!document.querySelector('.mz-intro'),null,{timeout:30000});
    await p.screenshot({path:path.join(OUT,mode+'-thread.png')});
    await p.setViewportSize({width:412,height:550});await p.waitForTimeout(450);
    m=await metrics();ok(mode,'resized keyboard viewport keeps following and composer visible',m.composer.bottom<=550+1&&m.last.bottom<=m.composer.top+1,m);
    await p.setViewportSize({width:412,height:915});await p.waitForTimeout(450);
    await p.evaluate(()=>__wos.goDesk(0));await p.waitForTimeout(650);
    ok(mode,'leaving desk restores fixed shell',await p.evaluate(()=>!document.documentElement.classList.contains('wos-doc-scroll')&&scrollY===0));
    await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(650);
   } else {
    ok(mode,'browser retains fixed document and inner scrolling',await p.evaluate(()=>{const s=qaScroller();s.scrollTop=300;return scrollY===0&&s.scrollTop===300&&document.scrollingElement.scrollHeight<=innerHeight;}));
    await p.waitForFunction(()=>!document.querySelector('.mz-intro'),null,{timeout:30000});
    await p.screenshot({path:path.join(OUT,mode+'-desktop.png')});
   }
   await p.keyboard.press('Escape');await p.waitForTimeout(400);
   ok(mode,'nested Back returns to list without exiting',await p.evaluate(()=>qaOwner().w.thread==null&&!!window.__wos&&document.visibilityState==='visible'&&!document.documentElement.classList.contains('wos-doc-scroll')));
   for(let i=0;i<2;i++)await p.keyboard.press('Escape');
   ok(mode,'Back at root never exits',await p.evaluate(()=>!!window.__wos&&document.visibilityState==='visible'&&location.hostname==='scroll-capture.invalid'));
  }catch(e){ok(mode,'suite completed',false,String(e));await p.screenshot({path:path.join(OUT,mode+'-failure.png')});console.log('DIAGNOSTIC',await p.evaluate(()=>({keys:Object.keys(window.__wos||{}),text:document.body.innerText.slice(0,700),html:document.documentElement.className,ancestors:(()=>{let n=document.querySelector('.ch-msgs'),a=[];while(n){const s=getComputedStyle(n);a.push({tag:n.tagName,cls:n.className,rect:n.getBoundingClientRect().toJSON(),transform:s.transform,position:s.position,overflow:s.overflow});n=n.parentElement;}return a;})()})));}
  await ctx.close();
 }
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({root:ROOT,results,writes,errors},null,2));}
 const passed=results.filter(r=>r.pass).length,failed=results.length-passed;
 console.log(JSON.stringify({passed,failed,writesBlocked:writes.length,pageErrors:errors}));process.exitCode=failed||errors.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
