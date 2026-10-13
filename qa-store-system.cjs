// Focused real-index private peer QA. Every unsafe request is fenced before it can reach Telos.
const {chromium}=require(process.env.PW || '/Users/developer/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const BASE=process.argv[2] || 'https://store-window.staging.wizard.example/wizard-os-home/';
const OUT=process.env.QA_OUT || 'evidence'; fs.mkdirSync(OUT,{recursive:true});
let pass=0,fail=0; const cases=[],receipts=[],unsafe=[];
const ok=(v,label,detail='')=>{cases.push({label,pass:!!v,detail});if(v){pass++;console.log('PASS',label);}else{fail++;console.log('FAIL',label,detail);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function back(p,label){const n=await p.evaluate(()=>window.__storePops?.length||0);await p.evaluate(()=>history.back());await p.waitForFunction(n=>(window.__storePops?.length||0)>n,n,{timeout:4000});await wait(400);const r=await p.evaluate(()=>window.__storePops);receipts.push({label,pops:r});}
async function context(b,mobile){
 const c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile,ignoreHTTPSErrors:true,serviceWorkers:'block',...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'}:{})});
 await c.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){unsafe.push(q.method()+' '+q.url());return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA unsafe-request fence"}'});}return r.continue();});
 await c.addInitScript(()=>{window.__storePushes=0;const push=history.pushState.bind(history);history.pushState=(...args)=>{window.__storePushes++;return push(...args);};addEventListener('popstate',()=>{try{const top=window.top;top.__storePops=top.__storePops||[];top.__storePops.push({frame:window!==top,url:location.href,at:Date.now()});}catch(_){}},true);try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');}catch(_){} });
 return c;
}
async function swipeApps(p){const r=await p.locator('#orb').boundingBox();const cdp=await p.context().newCDPSession(p);const x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*18}]});await wait(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await p.locator('#launcher.open').waitFor();await wait(300);}
async function checkStore(p,mobile){
 const label=mobile?'phone':'desktop';const f=p.frameLocator('iframe[title="App Store"]');
 await f.locator('.kind:not([disabled])').first().waitFor({timeout:20000});
 ok(await f.locator('#discover .kind').count()===4&&await f.locator('#discover .hero,#discover .shelf,#discover .topic,#discover .tile').count()===0,label+': home contains only four browse choices, no featured/shelves/topics');
 const kinds=['apps','agent-apps','agents','connections'];
 for(const kind of kinds){
  const choice=f.locator('.kind[data-kind="'+kind+'"]');
  ok((await choice.locator('small').innerText()).length>10,label+': '+kind+' explains what it is for');
  await choice.click();await f.locator('#results:not([hidden]) .row').first().waitFor();
  ok(await f.locator('#results .row').count()>0&&await f.locator('#discover').isHidden(),label+': '+kind+' opens its existing clean list');
  await f.locator('#results .row').first().click();await f.locator('#detail:not([hidden])').waitFor();
  const detailBox=await p.locator('iframe[title="App Store"]').boundingBox();ok(detailBox&&detailBox.x>=0&&detailBox.y>=0&&detailBox.x+detailBox.width<=p.viewportSize().width+1,label+': '+kind+' detail keeps the app frame on-screen',JSON.stringify(detailBox));
  await back(p,label+' '+kind+' detail');ok(await f.locator('#results').isVisible(),label+': '+kind+' detail Back returns to its list');
  await back(p,label+' '+kind+' list');ok(await f.locator('#discover').isVisible(),label+': '+kind+' list Back returns to four choices');
  const box=await p.locator('iframe[title="App Store"]').boundingBox();ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=p.viewportSize().width+1,label+': '+kind+' navigation keeps the app frame on-screen',JSON.stringify(box));
 }
 await p.screenshot({path:path.join(OUT,label+'-browse.png')});
 ok(await p.locator('iframe[title="App Store"]').count()===1,label+': one normal URL-backed Store frame');
 ok(await p.locator('.wam-pal,.dapps,.dapps-card').count()===0,label+': no Store panel or overlay');
 const data=await p.evaluate(async()=>{const pre='/wizard-os-home/store-data/';return Promise.all(['wizard/v1/index/search?q=transcri','wizard/v1/index/tags','api/apps/installed','wizard/v1/wizard-apps'].map(async s=>{const r=await fetch(pre+s);return {status:r.status,body:await r.json()};}));});
 ok(data.every(d=>d.status===200)&&data[0].body.apps.some(a=>a.id==='transcriber')&&data[1].body.tags.length>0,label+': real index/search/tags and installed sources');
 ok(data[2].body.installed.some(a=>a.info.id==='transcriber')&&!/"(?:config|userConfig|form_fields|JWT_SECRET|mcp|health)"/.test(JSON.stringify(data.slice(2))),label+': real installed mark data without secret fields');
 for(const file of ['app.js','styles.css','core/apps.js','core/deeplink.js','desktop/desktop.js','store/store.js','store/store.css','system/system.js','system/system.css']) {
 const served=await p.evaluate(file=>fetch('/wizard-os-home/'+file).then(r=>r.text()),file);const local=fs.readFileSync(path.join(__dirname,'web',file),'utf8');
 ok(crypto.createHash('sha256').update(served).digest('hex')===crypto.createHash('sha256').update(local).digest('hex'),label+': peer serves exact '+file); }
 const rect=await p.locator('iframe[title="App Store"]').boundingBox();
 ok(rect.x>=0&&rect.x+rect.width<=p.viewportSize().width+1&&rect.y>=0,label+': normal Store frame wholly on visible desk',JSON.stringify(rect));
 if(rect.x<0||rect.y<0) console.log('GEOMETRY',JSON.stringify(await p.evaluate(()=>({viewport:[innerWidth,innerHeight,scrollX,scrollY],scrolled:[...document.querySelectorAll('*')].filter(e=>e.scrollLeft||e.scrollTop).map(e=>({id:e.id,cls:e.className,scroll:[e.scrollLeft,e.scrollTop]}))}))));
 await f.locator('.kind[data-kind="agent-apps"]').click();await f.locator('#results .row[data-app="transcriber"]').waitFor();
 ok(true,label+': real Agent apps list includes Transcriber');await f.locator('#results [data-back]').click();await f.locator('#discover').waitFor();
 await f.locator('#q').fill('transcri');await f.locator('#results .row[data-app="transcriber"] .get.have').waitFor();
 ok(await f.locator('#results .row[data-app="transcriber"]').innerText().then(t=>/installed/i.test(t)),label+': transcri finds Transcriber marked Installed');
 const afterSearch=await p.locator('iframe[title="App Store"]').boundingBox();ok(afterSearch.x>=0&&afterSearch.y>=0&&afterSearch.x+afterSearch.width<=p.viewportSize().width+1,label+': Store search keeps parent window on-screen',JSON.stringify(afterSearch));
 await p.screenshot({path:path.join(OUT,label+'-search.png')});
 await f.locator('#results .row[data-app="transcriber"]').scrollIntoViewIfNeeded();const frame=p.frames().find(f=>f.url().includes('/store/'));const scroll=await frame.evaluate(()=>document.scrollingElement.scrollTop);
 await f.locator('#results .row[data-app="transcriber"]').click();await f.locator('#detail:not([hidden])').waitFor();
 ok(await f.locator('#detail').innerText().then(t=>/Transcriber/.test(t)&&/Installed/.test(t)&&/Information/.test(t)),label+': app page shows name, installed state and information');
 ok(await f.locator('#detail [data-get]').count()===0,label+': installed app offers no lifecycle control');
 await p.screenshot({path:path.join(OUT,label+'-card.png')});
 await f.locator('#detail [data-back]').click();
 ok(await f.locator('#q').inputValue()==='transcri'&&await f.locator('#results').isVisible()&&Math.abs(await frame.evaluate(()=>document.scrollingElement.scrollTop)-scroll)<2,label+': card UI Back preserves query and scroll');
 await f.locator('#results .row[data-app="transcriber"]').click();await f.locator('#detail:not([hidden])').waitFor();await back(p,label+' card');
 ok(await f.locator('#results').isVisible()&&await f.locator('#q').inputValue()==='transcri'&&(!mobile||await p.evaluate(()=>window.__wos.idx!==0)),label+': real browser Back card → same Store');
 await back(p,label+' search');ok(await f.locator('#discover').isVisible()&&await f.locator('#q').inputValue()==='',label+': real browser Back search → Store front page');
 await f.locator('.kind[data-kind="agent-apps"]').click();await f.locator('#results .row').first().waitFor();await f.locator('#results .row[data-app="secret-drop"]').click();await f.locator('#detail:not([hidden])').waitFor();
 await f.locator('#detail [data-get]').click();await f.locator('#toast:not([hidden])').waitFor();ok(/ask your agent/i.test(await f.locator('#toast').innerText()),label+': Get explains browse-only instead of installing');
 await back(p,label+' detail');await back(p,label+' list');ok(await f.locator('#discover').isVisible(),label+': Back unwinds app page → list → front page');
 await back(p,label+' Store parent');
 if(mobile) ok(await p.evaluate(()=>window.__wos.idx===0)&&p.url().includes('/wizard-os-home/'),label+': real browser Back Store → Wizard Home');
 else ok(await p.locator('iframe[title="App Store"]').count()===0&&p.url().includes('/wizard-os-home/desktop.html'),label+': real browser Back Store → desktop parent');
}
(async()=>{const b=await chromium.launch();try{
 for(const mobile of [true,false]){const c=await context(b,mobile),p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));try{
 await p.goto(BASE+(mobile?'?shell=phone&view=apps':'desktop.html'),{waitUntil:'load'});await wait(1200);
 if(mobile){await p.locator('#launcher.open').waitFor();await p.locator('#launcherBody [data-app="shopping"]').first().waitFor();const tiles=await p.locator('#launcherBody [data-app]').evaluateAll(es=>es.map(e=>e.dataset.app));ok(tiles.includes('wizard')&&tiles.includes('shopping')&&!tiles.includes('maps'),'phone: existing My Apps tiles retained, Android natives absent');ok(await p.locator('#launcherBody .headless').count()===0&&!/\bSystem\b/.test(await p.locator('#launcherBody').innerText()),'phone: no PR3 System/dotted tile redesign');ok(!tiles.includes('system')&&tiles.filter(t=>t==='app-store').length===1,'phone: launcher lists only views you open, plus Get apps');await p.locator('#launcherBody [data-app="app-store"]').last().tap();await p.locator('#launcher.open').waitFor({state:'hidden'});}
 else{await p.keyboard.press('Meta+k');await p.locator('#palette:not([hidden])').waitFor();await p.locator('#palette .nm').getByText('Get apps', {exact:true}).click();await p.locator('#palette').waitFor({state:'hidden'});}
 await p.frameLocator('iframe[title="App Store"]').locator('.kind:not([disabled])').first().waitFor({timeout:20000});
 const id=await p.locator('iframe[title="App Store"]').evaluate(e=>e.closest('.win').dataset.win);
 if(mobile){await swipeApps(p);await p.locator('#launcherBody [data-app="app-store"]').last().tap();}else{await p.keyboard.press('Meta+k');await p.locator('#palette .nm').getByText('Get apps', {exact:true}).click();}
 await wait(500);ok(await p.locator('iframe[title="App Store"]').count()===1&&await p.locator('iframe[title="App Store"]').evaluate(e=>e.closest('.win').dataset.win)===id,(mobile?'phone':'desktop')+': Get apps reuses/focuses original normal window');
 await checkStore(p,mobile);
 ok(!errors.length,(mobile?'phone':'desktop')+': no page errors',errors.join('\n'));
 if(mobile){ok(await p.locator('[data-home-resources] .rs-widget').count()===1,'phone: current Home resource widget preserved');await p.locator('[data-res-open="server"]').tap();await back(p,'phone Home resources');ok(await p.locator('.rs-sheet').count()===0,'phone: resource dashboard browser Back smoke retained');}
 }catch(e){ok(false,(mobile?'phone':'desktop')+': scenario completed',String(e.stack));await p.screenshot({path:path.join(OUT,(mobile?'phone':'desktop')+'-failure.png')}).catch(()=>{});}finally{await c.close();}}
 // Standalone root/reload must stay without history growth, and framed boot must add no Store sentinel.
 const c=await context(b,true),p=await c.newPage();await p.goto(BASE+'store/');await p.locator('.kind:not([disabled])').first().waitFor();const standaloneEntry=p.url();ok([BASE+'store/',BASE+'store/index.html'].includes(standaloneEntry),'standalone: directory entry renders the canonical Store document',standaloneEntry);await p.locator('#q').click();let size=await p.evaluate(()=>history.length);for(let i=0;i<3;i++)await back(p,'standalone root '+i);ok(p.url()===standaloneEntry&&await p.evaluate(()=>history.length)<=size,'standalone: repeated real root Back stays without history growth');await p.reload();await p.locator('#q').click();size=await p.evaluate(()=>history.length);await back(p,'standalone reload');ok(p.url()===standaloneEntry&&await p.evaluate(()=>history.length)<=size,'standalone: reload reuses root guard');await p.screenshot({path:path.join(OUT,'standalone.png')});await c.close();
 // Real direct entry, normal window controls, frame boot pushes, reload and parent-root history floor.
 for(const mobile of [true,false]){const c=await context(b,mobile),p=await c.newPage();const root=BASE+(mobile?'?shell=phone&open=app-store':'desktop.html?view=store');await p.goto(root);const f=p.frameLocator('iframe[title="App Store"]');await f.locator('.kind:not([disabled])').first().waitFor();await wait(700);const frame=p.frames().find(f=>f.url().includes('/store/'));ok(await frame.evaluate(()=>window.__storePushes)===0,(mobile?'phone':'desktop')+': direct deep link uses regular frame with zero framed boot pushes');
 const win=p.locator('.win').filter({has:p.locator('iframe[title="App Store"]')});await win.locator(mobile?'[data-wact="full"]':'[data-wact="mono"]').click();await back(p,'normal full-window');ok(await p.locator('iframe[title="App Store"]').count()===1&&(mobile?await p.evaluate(()=>window.__wos.idx!==0):true),(mobile?'phone':'desktop')+': normal full-window control and Back keep Store');
 let h=await p.evaluate(()=>history.length);await p.reload();await p.frameLocator('iframe[title="App Store"]').locator('.kind:not([disabled])').first().waitFor();await wait(700);ok(await p.locator('iframe[title="App Store"]').count()===1&&await p.evaluate(()=>history.length)<=h,(mobile?'phone':'desktop')+': reload restores one app frame without duplicate history');
 await p.mouse.click(8,8);await back(p,'direct Store to parent');for(let i=0;i<2;i++){await wait(2200);await p.mouse.click(8,8);await back(p,'parent root '+i);}ok(p.url().startsWith(BASE)&&await p.evaluate(()=>history.length)<=h,(mobile?'phone':'desktop')+': repeated real parent-root Back stays without history growth');
 await c.close();}
 // System app: Home entry (phone) and Cmd-K (desktop); real overview, map focus, Back unwinds focus then window.
 for(const mobile of [true,false]){const c=await context(b,mobile),p=await c.newPage();const L=mobile?'phone':'desktop';const errors=[];p.on('pageerror',e=>errors.push(String(e)));try{
  await p.goto(BASE+(mobile?'?shell=phone':'desktop.html'));await wait(2500);
  if(mobile){await p.evaluate(()=>window.__wos.goDesk(0,true));await p.locator('[data-act="system"]').waitFor();ok(/your system/i.test(await p.locator('[data-act="system"]').getAttribute('aria-label')),'phone: Home System icon has a discoverable accessible name');
  const s=p.locator('[data-act="system"]'),g=p.locator('.home-tools [data-act="settings"]');const sr=await s.boundingBox(),gr=await g.boundingBox();
  ok(sr.width>=44&&sr.width<=48&&sr.height>=44&&sr.height<=48&&Math.abs(sr.y-gr.y)<2&&gr.x>=sr.x+sr.width,'phone: compact 44px System sits beside Settings',JSON.stringify({sr,gr}));
  ok(await p.locator('.home-attn [data-act="system"],.sys-card').count()===0&&await s.evaluate(e=>getComputedStyle(e).backgroundImage==='none'&&getComputedStyle(e).boxShadow==='none'),'phone: System no longer competes with attention cards or glows');
  await p.screenshot({path:path.join(OUT,'phone-home.png')});
  await g.tap();await p.locator('#settings.open').waitFor();await back(p,'phone Settings shortcut');ok(await p.locator('#settings.open').count()===0,'phone: adjacent Settings still opens and Back closes it');await p.locator('[data-act="system"]').tap();}
  else{await p.keyboard.press('Meta+k');await p.locator('#palette:not([hidden])').waitFor();await p.locator('#palette .nm').getByText('Your system',{exact:true}).click();}
  const sf=p.frameLocator('iframe[title="System"]');await sf.locator('.node.main').waitFor({timeout:20000});
  const st=await p.frames().find(x=>x.url().includes('/system/')).evaluate(()=>window.__system.state());
  ok(st.counts.agents>=1&&st.counts.apps>=1&&st.counts.conns>=1&&st.counts.routines>=1,L+': System shows real agents, agent apps, connections and routines',JSON.stringify(st.counts));
  const ov=await p.evaluate(()=>fetch('/wizard-os-home/store-data/system/v1/overview').then(r=>r.text()));ok(!/"(prompt|token|access_token|refresh_token|api_key|JWT_SECRET|config|userConfig)"/.test(ov)&&!/(sk-[A-Za-z0-9]{12}|eyJ[A-Za-z0-9_-]{20,})/.test(ov),L+': overview carries names and status only, no secret fields or token shapes');
  await sf.locator('.node[data-node^="p:"]').first().click();await sf.locator('#focus:not([hidden])').waitFor();ok(await sf.locator('.node.sel').count()===1&&await sf.locator('.node.lit').count()>=2,L+': tapping a node lights what it connects to');
  await p.mouse.click(4,4);await back(p,L+' system focus');ok(await sf.locator('#focus').isHidden()&&await p.locator('iframe[title="System"]').count()===1,L+': real Back clears the focus and keeps System open');
  await back(p,L+' system parent');
  if(mobile) ok(await p.evaluate(()=>window.__wos.idx===0)&&p.url().includes('/wizard-os-home/'),'phone: next Back returns to Wizard Home');
  else ok(p.url().includes('/wizard-os-home/desktop.html'),'desktop: Back stays inside Wizard');
  ok(!errors.length,L+': System no page errors',errors.join('\n'));
 }catch(e){ok(false,L+': System scenario completed',String(e.stack));await p.screenshot({path:path.join(OUT,L+'-system-failure.png')}).catch(()=>{});}finally{await c.close();}}
 ok(unsafe.length===0,'zero unsafe requests of any kind (no agent submissions or lifecycle attempts)',unsafe.join('\n'));
 }finally{await b.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({host:require('os').hostname(),source:process.env.SOURCE_SHA,base:BASE,pass,fail,cases,unsafe,popstateReceipts:receipts},null,2));console.log(`${pass} passed, ${fail} failed`);}process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
