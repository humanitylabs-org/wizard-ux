// Focused real-index private peer QA. Every unsafe request is fenced before it can reach Telos.
const {chromium}=require(process.env.PW || '/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const BASE=process.argv[2] || 'https://store-window.staging.wizard001.com/wizard-os-home/';
const OUT=process.env.QA_OUT || 'evidence'; fs.mkdirSync(OUT,{recursive:true});
let pass=0,fail=0; const cases=[],receipts=[],unsafe=[];
const ok=(v,label,detail='')=>{cases.push({label,pass:!!v,detail});if(v){pass++;console.log('PASS',label);}else{fail++;console.log('FAIL',label,detail);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function back(p,label){const n=await p.evaluate(()=>window.__storePops?.length||0);await p.evaluate(()=>history.back());await p.waitForFunction(n=>(window.__storePops?.length||0)>n,n,{timeout:4000});await wait(400);const r=await p.evaluate(()=>window.__storePops);receipts.push({label,pops:r});}
async function context(b,mobile){
 const c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile,ignoreHTTPSErrors:true,serviceWorkers:'block',...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'}:{})});
 await c.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){unsafe.push(q.method()+' '+q.url());return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA unsafe-request fence"}'});}return r.continue();});
 await c.addInitScript(()=>{addEventListener('popstate',()=>{try{const top=window.top;top.__storePops=top.__storePops||[];top.__storePops.push({frame:window!==top,url:location.href,at:Date.now()});}catch(_){}},true);try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');}catch(_){} });
 return c;
}
async function swipeApps(p){const r=await p.locator('#orb').boundingBox();const cdp=await p.context().newCDPSession(p);const x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*18}]});await wait(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await p.locator('#launcher.open').waitFor();await wait(300);}
async function checkStore(p,mobile){
 const label=mobile?'phone':'desktop';const f=p.frameLocator('iframe[title="App Store"]');
 await f.locator('[data-wam-id="transcriber"]').waitFor({timeout:20000});
 ok(await p.locator('iframe[title="App Store"]').count()===1,label+': one normal URL-backed Store frame');
 ok(await p.locator('.wam-pal,.dapps,.dapps-card').count()===0,label+': no Store panel or overlay');
 const data=await p.evaluate(async()=>{const pre='/wizard-os-home/store-data/';return Promise.all(['wizard/v1/index/search?q=transcri','wizard/v1/index/tags','api/apps/installed','wizard/v1/wizard-apps'].map(async s=>{const r=await fetch(pre+s);return {status:r.status,body:await r.json()};}));});
 ok(data.every(d=>d.status===200)&&data[0].body.apps.some(a=>a.id==='transcriber')&&data[1].body.tags.length>0,label+': real index/search/tags and installed sources');
 ok(data[2].body.installed.some(a=>a.info.id==='transcriber')&&!/"(?:config|userConfig|form_fields|JWT_SECRET|mcp|health)"/.test(JSON.stringify(data.slice(2))),label+': real installed mark data without secret fields');
 const served=await p.evaluate(()=>fetch('/wizard-os-home/store/store.js').then(r=>r.text()));const local=fs.readFileSync(path.join(__dirname,'web/store/store.js'),'utf8');
 ok(crypto.createHash('sha256').update(served).digest('hex')===crypto.createHash('sha256').update(local).digest('hex'),label+': peer serves exact candidate Store source');
 await f.locator('#query').fill('transcri');await f.locator('.lrow[data-wam-id="transcriber"] .wam-have').waitFor();
 ok(await f.locator('.lrow[data-wam-id="transcriber"]').innerText().then(t=>/installed/i.test(t)),label+': transcri finds Transcriber marked Installed');
 await p.screenshot({path:path.join(OUT,label+'-search.png')});
 await f.locator('[data-wam-id="transcriber"]').click();await f.locator('#card:not([hidden])').waitFor();
 ok(await f.locator('#card').innerText().then(t=>/Transcriber/.test(t)&&/installation is being connected/.test(t)),label+': inherited card and honest disconnected installation state');
 ok(await f.locator('#card [data-wam-do="stop"]').isDisabled(),label+': mutation control explicitly unavailable');
 await p.screenshot({path:path.join(OUT,label+'-card.png')});
 await f.locator('[data-wam-back]').click();
 ok(await f.locator('#query').inputValue()==='transcri'&&await f.locator('#browse').isVisible(),label+': card UI Back preserves query');
 await f.locator('[data-wam-id="transcriber"]').click();await back(p,label+' card');
 ok(await f.locator('#browse').isVisible()&&await f.locator('#query').inputValue()==='transcri',label+': real browser Back card → same Store');
 await back(p,label+' Store parent');
 if(mobile) ok(await p.evaluate(()=>window.__wos.idx===0)&&p.url().includes('/wizard-os-home/'),label+': real browser Back Store → Wizard Home');
 else ok(await p.locator('iframe[title="App Store"]').count()===0&&p.url().includes('/wizard-os-home/desktop.html'),label+': real browser Back Store → desktop parent');
}
(async()=>{const b=await chromium.launch();try{
 for(const mobile of [true,false]){const c=await context(b,mobile),p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));try{
 await p.goto(BASE+(mobile?'?shell=phone&view=apps':'desktop.html'),{waitUntil:'load'});await wait(1200);
 if(mobile){await p.locator('#launcher.open').waitFor();await p.locator('#launcherBody [data-app="wisdom"]').first().waitFor();const tiles=await p.locator('#launcherBody [data-app]').evaluateAll(es=>es.map(e=>e.dataset.app));ok(tiles.includes('wizard')&&tiles.includes('wisdom')&&tiles.includes('shopping')&&!tiles.includes('maps'),'phone: existing My Apps tiles retained, Android natives absent');ok(await p.locator('#launcherBody .headless').count()===0&&!/\bSystem\b/.test(await p.locator('#launcherBody').innerText()),'phone: no PR3 System/dotted tile redesign');await p.locator('#launcherBody [data-app="app-store"]').last().tap();await p.locator('#launcher.open').waitFor({state:'hidden'});}
 else{await p.keyboard.press('Meta+k');await p.locator('#palette:not([hidden])').waitFor();await p.locator('#palette .nm').getByText('Get apps', {exact:true}).click();await p.locator('#palette').waitFor({state:'hidden'});}
 await p.frameLocator('iframe[title="App Store"]').locator('[data-wam-id="transcriber"]').waitFor({timeout:20000});
 const id=await p.locator('iframe[title="App Store"]').evaluate(e=>e.closest('.win').dataset.win);
 if(mobile){await swipeApps(p);await p.locator('#launcherBody [data-app="app-store"]').last().tap();}else{await p.keyboard.press('Meta+k');await p.locator('#palette .nm').getByText('Get apps', {exact:true}).click();}
 await wait(500);ok(await p.locator('iframe[title="App Store"]').count()===1&&await p.locator('iframe[title="App Store"]').evaluate(e=>e.closest('.win').dataset.win)===id,(mobile?'phone':'desktop')+': Get apps reuses/focuses original normal window');
 await checkStore(p,mobile);
 ok(!errors.length,(mobile?'phone':'desktop')+': no page errors',errors.join('\n'));
 if(mobile){ok(await p.locator('[data-home-resources] .rs-widget').count()===1,'phone: current Home resource widget preserved');await p.locator('[data-res-open="server"]').tap();await back(p,'phone Home resources');ok(await p.locator('.rs-sheet').count()===0,'phone: resource dashboard browser Back smoke retained');}
 }catch(e){ok(false,(mobile?'phone':'desktop')+': scenario completed',String(e.stack));await p.screenshot({path:path.join(OUT,(mobile?'phone':'desktop')+'-failure.png')}).catch(()=>{});}finally{await c.close();}}
 // Standalone root/reload must stay without history growth, and framed boot must add no Store sentinel.
 const c=await context(b,true),p=await c.newPage();await p.goto(BASE+'store/');await p.locator('[data-wam-id="transcriber"]').waitFor();await p.locator('#query').click();let size=await p.evaluate(()=>history.length);for(let i=0;i<3;i++)await back(p,'standalone root '+i);ok(p.url()===BASE+'store/'&&await p.evaluate(()=>history.length)<=size,'standalone: repeated real root Back stays without history growth');await p.reload();await p.locator('#query').click();size=await p.evaluate(()=>history.length);await back(p,'standalone reload');ok(p.url()===BASE+'store/'&&await p.evaluate(()=>history.length)<=size,'standalone: reload reuses root guard');await p.screenshot({path:path.join(OUT,'standalone.png')});await c.close();
 ok(!unsafe.some(u=>/\/v1\/runs\b|\/app-lifecycle\//.test(u)),'zero real agent submissions or lifecycle attempts',unsafe.join('\n'));
 }finally{await b.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({host:require('os').hostname(),source:process.env.SOURCE_SHA,base:BASE,pass,fail,cases,unsafe,popstateReceipts:receipts},null,2));console.log(`${pass} passed, ${fail} failed`);}process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
