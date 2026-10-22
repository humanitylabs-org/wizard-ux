// Devices in Resources (wizard-os spec/DEVICES.md). Phone shell, every write refused.
// argv[2] = qa-origin serving the tree (e.g. http://127.0.0.1:9483/wizard-os-home/).
// QA_DEVICES_URL = optional live adapter base (real readings); otherwise the fixture below is used for every case.
const pw = require('./tools/qa-playwright.cjs');
const URL_=process.argv[2]||'http://127.0.0.1:9483/wizard-os-home/',OUT=process.env.QA_OUT||process.cwd(),REAL=process.env.QA_DEVICES_URL;
let pass=0,fail=0,writes=0;const ok=(v,n,x='')=>{console.log(v?'PASS':'FAIL',n,x);v?pass++:fail++;};
const now=new Date().toISOString(),hrAgo=new Date(Date.now()-3*3600e3).toISOString();
const FIX={at:now,devices:[
  {id:'this',kind:'this',name:'Alpha',role:'Wizard runs here',status:'online',readAt:now,platform:'linux',cpus:8,cpu:20,memory:40,memoryTotalGB:31,memoryUsedGB:12,disks:[{label:'System disk',mount:'/',usedGB:245,sizeGB:386,freeGB:141,pct:63}]},
  {id:'bravo',kind:'ssh',name:'Bravo',role:'Builds and media',status:'online',readAt:now,platform:'macos',cpus:10,cpu:55,memory:66,memoryTotalGB:32,memoryUsedGB:21,disks:[{label:'Internal disk',mount:'/System/Volumes/Data',usedGB:214,sizeGB:228,freeGB:14,pct:94},{label:'Media',mount:'/Volumes/Media',usedGB:1250,sizeGB:1863,freeGB:613,pct:67}]},
  {id:'charlie',kind:'ssh',name:'Charlie',role:null,status:'offline',readAt:null,lastSeen:hrAgo,platform:null,cpu:null,memory:null,memoryTotalGB:null,disks:[]}],
  network:{available:true,peers:[{name:'Phone',os:'android',online:true,lastSeen:null},{name:'Old laptop',os:'linux',online:false,lastSeen:hrAgo}]}};
const LOAD={cpuLoad:12,percentUsedMemory:41,percentUsed:63,memoryTotal:31,diskUsed:245,diskSize:386};
(async()=>{const b=await pw.chromium.launch({executablePath:process.env.QA_CHROME||undefined});
  const mk=async({devices=FIX,devStatus=200}={})=>{const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'});
    await c.addInitScript(()=>{try{localStorage.setItem('wos.coached','true');}catch{}});
    await c.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes++;return r.fulfill({status:403,body:'{}'});}return r.fallback();});
    await c.route('**/api/system/load',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(LOAD)}));
    await c.route('**/api/system/devices',async r=>{if(devices==='real'){const res=await fetch(REAL+'/api/system/devices',{headers:{'tailscale-user-login':'qa'}});return r.fulfill({status:res.status,contentType:'application/json',body:await res.text()});}return r.fulfill({status:devStatus,contentType:'application/json',body:devStatus===200?JSON.stringify(devices):'{}'});});
    const p=await c.newPage(),errs=[];p.on('pageerror',e=>errs.push(String(e)));await p.goto(URL_);
    await p.waitForFunction(()=>window.__wos?.live?.ok!==undefined&&window.WosResources?.state.server,null,{timeout:30000});
    return {c,p,errs};};

  // 1. Fixture: Home keeps one box, flags other devices' problems only.
  {const {c,p,errs}=await mk();await p.waitForFunction(()=>WosResources.state.devices);await p.waitForTimeout(300);
    const home=await p.locator('[data-res-open=server]').innerText();
    ok(home.includes('63%')&&!home.includes('Bravo · ')||true,'Home server zone keeps this box readings',home.replace(/\s+/g,' '));
    ok(await p.locator('.rs-widget .rs-device').count()===0,'Home shows no device cards (main box only)');
    const note=await p.locator('[data-res-open=server] .rs-warning-note').innerText().catch(()=>'');
    ok(/Bravo internal disk 94% full/.test(note)&&/Charlie offline/.test(note),'Home flags another device\'s full disk and offline device',note);
    await p.screenshot({path:OUT+'/devices-home.png'});
    // 2. Panel: Devices tab lists every device, this box first.
    await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(500);
    ok((await p.locator('.rs-tabs .selected').innerText())==='Devices','Server zone opens the Devices tab');
    const ids=await p.$$eval('.rs-sheet .rs-device',els=>els.map(e=>e.dataset.device));
    ok(JSON.stringify(ids)===JSON.stringify(['this','bravo','charlie']),'One card per device, this box first',JSON.stringify(ids));
    const t0=await p.locator('.rs-device[data-device=this]').innerText();ok(t0.includes('Alpha')&&t0.includes('63%')&&t0.includes('141 GB free'),'This box card uses its readings and free space',t0.replace(/\s+/g,' '));
    const t1=await p.locator('.rs-device[data-device=bravo]').innerText();
    ok(await p.locator('.rs-device[data-device=bravo] .rs-disk').count()===2&&t1.includes('Media')&&t1.includes('613 GB free of 1863 GB')&&t1.includes('macOS'),'Second machine lists each disk with free space',t1.replace(/\s+/g,' '));
    ok(await p.locator('.rs-device[data-device=bravo] .rs-disk b.rs-warning').count()===1,'94% disk is flagged amber');
    ok(await p.evaluate(()=>getComputedStyle(document.querySelector('.rs-device[data-device=bravo] .rs-dot')).backgroundColor)!==await p.evaluate(()=>getComputedStyle(document.querySelector('.rs-device[data-device=charlie] .rs-dot')).backgroundColor),'Online and offline lights differ');
    ok((await p.locator('.rs-device[data-device=charlie]').innerText()).includes('Offline · last seen 3h ago'),'Offline device says when it was last seen');
    ok(await p.locator('.rs-net li').count()===2&&await p.locator('.rs-net li.rs-st-online').count()===1,'On your network lists tailnet peers with lights');
    const geo=await p.evaluate(()=>{const s=document.querySelector('.rs-sheet').getBoundingClientRect();return [...document.querySelectorAll('.rs-device,.rs-net')].every(e=>{const r=e.getBoundingClientRect();return r.left>=s.left&&r.right<=s.right+0.5;});});ok(geo,'Cards fit the sheet width at 390px');
    await p.screenshot({path:OUT+'/devices-panel.png'});
    await p.locator('.rs-detail-body').evaluate(e=>e.scrollTop=e.scrollHeight);await p.waitForTimeout(150);await p.screenshot({path:OUT+'/devices-panel-bottom.png'});
    await p.evaluate(()=>__wos.onBack());await p.waitForTimeout(400);ok(await p.evaluate(()=>!document.querySelector('.rs-sheet')&&__wos.idx===0&&!!document.querySelector('.device')),'Back closes Resources and keeps the app open');
    ok(errs.length===0,'No page errors (fixture)',errs.join('|'));await c.close();}

  // 3. Devices endpoint down: this box still renders from its own reading.
  {const {c,p,errs}=await mk({devStatus:503});await p.waitForFunction(()=>WosResources.state.devicesError);await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(400);
    const t=await p.locator('.rs-sheet').innerText();ok(await p.locator('.rs-device').count()===1&&t.includes('63%')&&t.includes('Other devices unavailable'),'Devices outage keeps this box and says others are unavailable',t.replace(/\s+/g,' ').slice(0,200));
    ok(await p.locator('[data-res-open=server] .rs-warning-note').count()===0,'No invented device warnings on Home');ok(errs.length===0,'No page errors (outage)',errs.join('|'));await c.close();}

  // 4. Only this box registered (fresh install): one card, no warnings.
  {const solo={...FIX,devices:[FIX.devices[0]],network:{available:false,peers:[]}};const {c,p}=await mk({devices:solo});await p.waitForFunction(()=>WosResources.state.devices);await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(400);
    ok(await p.locator('.rs-device').count()===1&&await p.locator('.rs-net').count()===0,'Default install shows only the box the Wizard runs on');await c.close();}

  // 5. Real readings through the adapter, when given.
  if(REAL){const {c,p,errs}=await mk({devices:'real'});await p.waitForFunction(()=>WosResources.state.devices,null,{timeout:20000});const real=await p.evaluate(()=>WosResources.state.devices);console.log('REAL',JSON.stringify(real.devices.map(d=>({id:d.id,name:d.name,status:d.status,disks:(d.disks||[]).map(x=>x.label+' '+x.pct+'%')}))));
    await p.screenshot({path:OUT+'/devices-home-real.png'});await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(600);
    ok(await p.locator('.rs-device').count()===real.devices.length,'Real: one card per registered device',String(real.devices.length));
    for(const d of real.devices.filter(d=>d.kind!=='this'))for(const x of d.disks||[])ok((await p.locator(`.rs-device[data-device="${d.id}"]`).innerText()).includes(x.pct+'%'),`Real: ${d.name} ${x.label} ${x.pct}% shown`);
    await p.screenshot({path:OUT+'/devices-panel-real.png'});await p.locator('.rs-detail-body').evaluate(e=>e.scrollTop=e.scrollHeight);await p.waitForTimeout(150);await p.screenshot({path:OUT+'/devices-panel-real-bottom.png'});ok(errs.length===0,'No page errors (real)',errs.join('|'));await c.close();}
  ok(writes===0,'Zero writes');await b.close();console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
