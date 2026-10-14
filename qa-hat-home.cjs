// Home hat regression. Run only on Thales /Volumes/ThalesMedia, under worker.lock.
// No shell asset overrides; real GETs, every browser write rejected. Outbox observations
// are explicit test sinks, never agent admissions. Baseline mode proves new expectations red.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {chromium}=require(process.env.PLAYWRIGHT_PATH);
const BASE=process.argv[2],OUT=process.env.QA_OUT;
if(!BASE||!OUT||!OUT.startsWith('/Volumes/ThalesMedia/')||os.hostname().toLowerCase().indexOf('thales')<0)throw Error('Thales evidence placement required');
fs.mkdirSync(OUT,{recursive:true});
const cases=[],errors=[],writes=[],assets={},screenshots=[];
const check=(value,name,detail)=>{cases.push({name,pass:!!value,...(detail===undefined?{}:{detail})});console.log(value?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const nap=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
async function context(kind){
 const c=await browser.newContext({viewport:kind==='phone'?{width:412,height:892}:{width:1440,height:920},isMobile:kind==='phone',hasTouch:kind==='phone',permissions:['microphone'],userAgent:kind==='phone'?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'});
 await c.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){writes.push({method:q.method(),url:q.url()});return r.fulfill({status:403,body:'{}'});}return r.continue();});
 await c.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wux.hotkeys.v1',JSON.stringify({AltRight:true,MetaRight:true}));window.__popReceipts=[];addEventListener('popstate',()=>__popReceipts.push({url:location.href,at:Date.now()}),true);});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));
 p.on('response',r=>{let u=new URL(r.url());if(u.pathname.startsWith('/wizard-os-home/')&&/\.(js|css)$/.test(u.pathname)&&r.status()===200)r.body().then(x=>{assets[u.pathname]=crypto.createHash('sha256').update(x).digest('hex');}).catch(()=>{});});
 return {c,p};
}
const entry=kind=>BASE+(BASE.includes('?')?'&':'?')+'shell='+kind;
async function shot(p,name){const f=path.join(OUT,name+'.png');await p.screenshot({path:f});screenshots.push(f);}
async function wait(p,kind){await p.waitForFunction(k=>k==='desktop'?window.__wux?.live?.ok:window.__wos?.live?.ok,kind,{timeout:45000});await nap(800);}
async function home(p){await p.evaluate(()=>__wux.goHome());await nap(100);}
async function back(p){const n=await p.evaluate(()=>__popReceipts.length);await p.evaluate(()=>history.back());await p.waitForFunction(n=>__popReceipts.length>n,n,{timeout:5000});await nap(150);}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const {c,p}=await context('desktop');
 await p.goto(entry('desktop'));await wait(p,'desktop');
 if(process.env.QA_BASELINE==='1'){
  check(await p.evaluate(()=>!!window.__wux?.homeOpen&&!!document.querySelector('#desktopHome')&&!document.querySelector('#desktopHome').hidden),'deep link opens actual dedicated Home');
  await p.click('#logo');
  check(await p.evaluate(()=>!document.querySelector('#palette')||document.querySelector('#palette').hidden),'hat does not launch search palette');
  check(await p.locator('#searchBtn').count()===1,'explicit search is separate from Home');
  await shot(p,'baseline-desktop-red');
  await c.close();
  const m=await context('phone');await m.p.goto(entry('phone'));await wait(m.p,'phone');await m.p.evaluate(()=>__wos.openOverview());await nap(250);
  check(await m.p.locator('.ov-home img.wizard-brand-mark').count()===1,'mobile overview uses supplied hat');
  await m.p.evaluate(()=>{__wos.closeOverview();__wos.openApp(WizCore.apps('phone').APP.shopping);});await nap(400);
  check(await m.p.locator('.dhome img.wizard-brand-mark').count()>0,'mobile Home dock uses supplied hat');await m.c.close();return;
 }
 check(await p.evaluate(()=>__wux.homeOpen&&getComputedStyle(document.querySelector('#desktopHome')).display!=='none'),'exact HTTPS deep link opens Home');
 check(await p.locator('#desktopHome .home-time').isVisible()&&await p.locator('#desktopHome .home-card').count()===2,'Home contains clock, attention and Working');
 check((await p.locator('#wiz-staging-tag').innerText()).includes('Hat Home'),'visible read-only staging marker');
 check(await p.evaluate(()=>document.querySelector('#logo').getAttribute('aria-current')==='page'&&document.querySelectorAll('.wsp:not([hidden])').length===0),'Home owns active nav; all desktops parked');
 await shot(p,'desktop-home');
 await p.click('#wsList [data-ws="0"]');
 await p.evaluate(()=>__wux.newChat());
 const wid=await p.evaluate(()=>__wux.ws[__wux.cur].focus);
 await p.locator(`.win[data-win="${wid}"] textarea`).fill('QA retained Home draft — never send');
 const before=await p.evaluate(()=>JSON.stringify({wins:__wux.wins,ws:__wux.ws,cur:__wux.cur}));
 await p.click('#logo');
 check(await p.evaluate(()=>__wux.homeOpen&&document.querySelector('#palette').hidden),'hat opens Home, never palette');
 check(await p.evaluate(b=>JSON.stringify({wins:__wux.wins,ws:__wux.ws,cur:__wux.cur})===b,before),'hat preserves every app, desktop and focus');
 check(await p.evaluate(()=>document.activeElement.id==='desktopHome'),'Home focus cannot stay in hidden composer');
 await p.evaluate(()=>{__wux.live.emit();});await nap(500);
 check(await p.evaluate(()=>__wux.homeOpen&&!document.activeElement.closest('.wsp')),'live refresh cannot steal Home focus');
 await p.click('#desktopHome .app-chip[data-app="wizard"]');await nap(150);
 check(!(await p.evaluate(()=>__wux.homeOpen))&&await p.locator(`.win[data-win="${wid}"] textarea`).inputValue()==='QA retained Home draft — never send','Home Chats chip restores draft and actual composer');
 check(await p.evaluate(id=>document.activeElement.closest('.win')?.dataset.win===id,wid),'reopening same parked app restores input focus');
 await p.keyboard.press('Alt+KeyF');await home(p);
 check(await p.evaluate(()=>__wux.ws[__wux.cur].mono&&!document.body.classList.contains('desktop-fullscreen'))&&await p.locator('#logo').isVisible(),'Home temporarily restores chrome without resetting fullscreen');
 await p.keyboard.press('Alt+KeyF');
 check(await p.evaluate(()=>__wux.ws[__wux.cur].mono&&__wux.homeOpen),'fullscreen chord on Home cannot mutate parked preference');
 await p.click('#wsList [data-ws="0"]');
 check(await p.evaluate(()=>document.body.classList.contains('desktop-fullscreen')),'numbered desktop restores fullscreen');
 await p.keyboard.press('Escape');await home(p);
 const url=p.url(),len=await p.evaluate(()=>history.length);
 await back(p);await back(p);await p.keyboard.press('Meta+w');
 check(await p.evaluate(()=>__wux.homeOpen)&&p.url()===url&&!p.isClosed(),'real repeated root Back and Close stay on Home');
 check(await p.evaluate(n=>history.length<=n,len),'root Back creates no history growth');
 await p.click('#searchBtn');
 check(await p.locator('#palette').isVisible(),'explicit search opens palette on Home');
 await p.keyboard.press('Escape');await p.keyboard.press('Meta+k');
 check(await p.locator('#palette').isVisible(),'Command-K still opens search');
 await p.keyboard.press('Escape');
 for(const route of ['/apps','/search']){await p.evaluate(path=>dispatchEvent(new CustomEvent('wizard:open',{detail:{path}})),route);check(await p.locator('#palette').isVisible(),'native wizard:open '+route+' retains launch semantics');await p.keyboard.press('Escape');}
 await p.evaluate(()=>{__wux.openInbox();__wux.openSettings();__wux.openUsage();__wux.openPalette();__wux.goHome();});
 check(await p.evaluate(()=>['#inbox','#dsettings','.usage-ov','#palette'].every(s=>document.querySelector(s).hidden)),'hat closes navigation sheets');
 // Attention is not attendance: emit an artificially unread local observation only,
 // never patch live data. Spy on the local seen callback while Home hides a real thread.
 await p.evaluate(()=>{window.__sid=__wux.live.sessions[0].id;__wux.openThread(__sid);});await nap(500);await home(p);
 await p.evaluate(()=>{window.__seen=[];window.__originalSeen=__wux.live.markSeen;__wux.live.markSeen=sid=>__seen.push(sid);window.__originalNew=__wux.live.isNew;__wux.live.isNew=()=>true;__wux.chats.markVisibleThreadsSeen();});
 check(await p.evaluate(()=>__seen.length===0),'parked threads never marked seen while on Home');
 await p.click('#wsList [data-ws="0"]');
 check(await p.evaluate(()=>__seen.includes(__sid)),'returning visible desktop re-establishes read observation');
 await p.evaluate(()=>{__wux.live.markSeen=__originalSeen;__wux.live.isNew=__originalNew;window.__sink=[];__wux.outbox.enqueue=async x=>{__sink.push({kind:x.kind,sid:x.sessionId||'',instructions:x.instructions||'',bytes:x.audio?.size||0});return{id:'qa-home-sink'};};});
 await home(p);await p.evaluate(()=>__wux.ask('QA context sink only'));
 check(await p.evaluate(()=>__sink[0].instructions.includes('Home screen in front.')&&!__sink[0].instructions.includes('Window in front:')),'Home ask context never describes parked app');
 await p.evaluate(()=>__wux.talk('start'));await p.waitForFunction(()=>__wux.voice==='listen');await nap(1400);await p.evaluate(()=>__wux.talk('send'));await p.waitForFunction(()=>__sink.length===2);
 check(await p.evaluate(()=>__sink[1].kind==='new'&&!__sink[1].sid&&__sink[1].bytes>1200),'voice started on Home targets new chat with real captured bytes');
 await p.evaluate(()=>__wux.openThread(__sid));await nap(400);await p.evaluate(()=>__wux.recordReply(__wux.ws[__wux.cur].focus,__sid));await p.waitForFunction(()=>__wux.voice==='listen');await nap(1400);await home(p);
 check(await p.locator('#voicePill').isVisible()&&await p.evaluate(()=>__wux.voice==='listen'),'hat preserves ongoing pinned voice and visible controls');
 await p.evaluate(()=>__wux.talk('send'));await p.waitForFunction(()=>__sink.length===3);
 check(await p.evaluate(()=>__sink[2].kind==='reply'&&__sink[2].sid===__sid&&__sink[2].bytes>1200),'reply voice stays pinned across Home navigation (test sink only)');
 await home(p);
 await p.click('#desktopHome .app-chip[data-app="shopping"]');await nap(200);
 const frame=p.frameLocator('.win.focus iframe');
 await frame.locator('body').waitFor();await nap(1500);
 const hosted=await p.evaluate(()=>{const f=document.querySelector('.win.focus iframe');return{url:f.contentWindow.location.href,title:f.contentDocument.title,text:f.contentDocument.body.innerText.slice(0,1800)};});
 check(hosted.url.includes('/wizard-shopping/')&&!hosted.url.includes('/wizard-os-home/')&&hosted.text.length>100,'Home chip loads real registered Shopping, not nested shell',hosted);
 const field=frame.locator('input').first();await field.fill('hat-home retained shopping filter');
 const fid=await p.evaluate(()=>{window.__frameRef=document.querySelector('.win.focus iframe');window.__docRef=__frameRef.contentDocument;return __wux.ws[__wux.cur].focus;});
 await shot(p,'desktop-real-shopping');await p.click('#logo');await p.click('#wsList [data-ws="0"]');
 check(await p.evaluate(()=>document.querySelector('.win.focus iframe')===__frameRef&&__frameRef.contentDocument===__docRef)&&await field.inputValue()==='hat-home retained shopping filter','Home retains actual hosted iframe/document and filter draft');
 await p.click('#logo');await p.keyboard.press('Alt+2');
 check(await p.evaluate(()=>__wux.ws.length===2&&__wux.cur===1&&!__wux.homeOpen),'Home plus-slot creates real second desktop');
 await p.click('#logo');await p.click('#wsList [data-ws="0"]');
 check(await p.evaluate(id=>__wux.ws[0].focus===id,fid)&&await field.inputValue()==='hat-home retained shopping filter','numbered desktop safely restores installed app');
 await p.click('#logo');await p.reload();await wait(p,'desktop');
 check(await p.evaluate(()=>__wux.homeOpen&&__wux.ws.length===2&&Object.values(__wux.wins).some(w=>w.appId==='shopping')),'reload persists Home plus parked apps/desktops');
 await p.click('#wsList [data-ws="0"]');await p.evaluate(()=>__wux.focusWin(Object.values(__wux.wins).find(w=>w.thread==='__new__').id));
 check((await p.locator('.win.focus textarea').inputValue())==='QA retained Home draft — never send','reload restores unsent chat draft after Home');
 await c.close();
 const m=await context('phone');await m.p.goto(entry('phone'));await wait(m.p,'phone');
 check(await m.p.evaluate(()=>__wos.idx===0),'exact phone deep link opens Home');
 await m.p.evaluate(()=>__wos.openApp(WizCore.apps('phone').APP.shopping));await nap(1600);
 check(await m.p.locator('.dhome img.wizard-brand-mark').count()>0,'mobile dock Home uses supplied white hat');
 const mobileId=await m.p.evaluate(()=>{const w=__wos.wins[__wos.desks[__wos.idx].focus];window.__mobileFrame=document.querySelector(`[data-win="${w.id}"] iframe`);return w.id;});
 await m.p.locator('.dhome').first().tap();await nap(400);
 check(await m.p.evaluate(()=>__wos.idx===0&&__wos.wins[Object.keys(__wos.wins).find(k=>__wos.wins[k].appId==='shopping')]!==null),'mobile hat navigates Home and parks app');
 await m.p.evaluate(()=>__wos.openOverview());await nap(300);
 check(await m.p.locator('.ov-home img.wizard-brand-mark').count()===1,'mobile overview Home uses supplied hat');
 await shot(m.p,'phone-overview-hat');await m.p.locator('.ov-home').tap();await nap(300);
 check(await m.p.evaluate(()=>__wos.idx===0&&!document.querySelector('#overview')?.classList.contains('on')),'overview hat returns Home');
 await m.p.evaluate(id=>__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(id)),true),mobileId);await nap(400);
 check(await m.p.evaluate(id=>document.querySelector(`[data-win="${id}"] iframe`)===__mobileFrame,mobileId),'mobile return preserves installed-app iframe');
 check(await m.p.locator('.ddot.sig:not(.dhome) svg').count()>0&&await m.p.locator('#orb').isVisible(),'mobile app sigils and orb retained');
 await m.p.locator('.dhome').first().tap();await nap(300);const mu=m.p.url();await back(m.p);
 check(await m.p.evaluate(()=>__wos.idx===0)&&m.p.url()===mu&&!m.p.isClosed(),'phone real root Back stays in Wizard');
 await shot(m.p,'phone-home');
 await m.c.close();
 check(errors.length===0,'zero unexpected page errors',errors);
 check(!writes.some(w=>/\/v1\/runs|\/api\/sessions$/.test(w.url)),'zero actual or attempted agent admissions',writes);
})().catch(e=>{errors.push(String(e.stack||e));check(false,'suite completed',String(e));}).finally(async()=>{
 if(browser)await browser.close();const pass=cases.filter(c=>c.pass).length,fail=cases.length-pass;
 const report={base:BASE,worker:os.hostname(),placement:OUT,baseline:process.env.QA_BASELINE==='1',assetOverrides:false,pass,fail,cases,errors,writes,assets,screenshots};fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass,fail,count:cases.length,worker:report.worker}));process.exitCode=fail?1:0;
});
