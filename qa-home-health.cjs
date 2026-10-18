// QA: system health checks in Home → Resources (moved from VPS Console, James 18 Oct 2026: "let's move the system
// health checks from VPS console into our resources view accessed from the home screen").
// Usage: QA_WEB_DIR=<repo> node qa-home-health.cjs <origin>/wizard-os-home/   Real Wizard reads; every write refused.
// Fixtures are explicitly marked; the first page reads the real /api/system/health.
let pw;try{pw=require('playwright');}catch{pw=require('playwright-core');}
const fs=require('fs'),path=require('path');
const URL_=process.argv[2]||'http://127.0.0.1:8923/wizard-os-home/',W=process.env.QA_WEB_DIR||'',OUT=process.env.QA_OUT||'';
let pass=0,fail=0,writes=0;const ok=(v,n,x='')=>{console.log(v?'PASS':'FAIL',n,v?'':x);v?pass++:fail++;};
const UA='Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36';
const iso=ms=>new Date(Date.now()-ms).toISOString();
const FIX={
  bad:{available:true,checkedAt:iso(120000),stale:false,status:'error',counts:{ok:0,warn:1,error:1},checks:[{key:'services',label:'Services',status:'warn',value:'1 failed',detail:'user: wizard-stt.service'},{key:'hermes-backup',label:'Hermes backup',status:'error',value:'needs attention',detail:'latest 3d ago; health check failed'}]},
  good:{available:true,checkedAt:iso(60000),stale:false,status:'ok',counts:{ok:2,warn:0,error:0},checks:[{key:'hermes-backup',label:'Hermes backup',status:'ok',value:'healthy',detail:''},{key:'services',label:'Services',status:'ok',value:'0 failed',detail:'system and user units clean'}]},
  stale:{available:true,checkedAt:iso(3*3600e3),stale:true,status:'ok',counts:{ok:1,warn:0,error:0},checks:[{key:'services',label:'Services',status:'ok',value:'0 failed',detail:''}]},
  none:{available:false,checks:[]},
};
async function ctxFor(b,size=[412,892],health=null){const c=await b.newContext({viewport:{width:size[0],height:size[1]},hasTouch:true,isMobile:true,serviceWorkers:'block',userAgent:UA,ignoreHTTPSErrors:true});await c.addInitScript(()=>localStorage.setItem('wos.coached','true'));
  await c.route('**/*',async r=>{const q=r.request(),u=q.url();if(!['GET','HEAD'].includes(q.method())){writes++;return r.fulfill({status:403,body:'{}'});}
    const m=u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if(W&&m&&!/^(data|summaries)\.js$/.test(m[1])){const f=m[1]||'index.html',p=path.join(W,'web',f);if(fs.existsSync(p))return r.fulfill({status:200,contentType:f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/javascript',body:fs.readFileSync(p)});}
    if(health&&/\/api\/system\/health(\?|$)/.test(u))return health==='503'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"health_unavailable"}'}):r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(FIX[health])});
    return r.continue();});return c;}
async function home(c){const p=await c.newPage(),errs=[];p.on('pageerror',e=>errs.push(String(e)));await p.goto(URL_);await p.waitForFunction(()=>window.WosResources?.state.server&&(window.WosResources.state.health||window.WosResources.state.healthError),null,{timeout:30000});await p.waitForTimeout(600);return {p,errs};}
(async()=>{const b=await pw.chromium.launch({executablePath:process.env.QA_CHROME||undefined});const allErrs=[];
  // 1. Real reading from this install.
  {const c=await ctxFor(b),{p,errs}=await home(c);allErrs.push(...errs);const st=await p.evaluate(()=>WosResources.state);const h=st.health;console.log('REAL HEALTH',JSON.stringify({counts:h?.counts,stale:h?.stale,checks:h?.checks?.map(x=>x.key+':'+x.status)}));
    ok(h&&h.available&&h.checks.length>=1,'Real /api/system/health reaches the shell with checks');
    ok(!h.checks.some(x=>['root-disk','memory','load'].includes(x.key))&&!h.checks.some(x=>x.key==='root-inodes'&&x.status==='ok'),'No Server readings or healthy inodes in Health',JSON.stringify(h.checks.map(x=>x.key)));
    const problems=await p.evaluate(()=>WosResources.healthProblems());const alert=p.locator('.home-desk .rs-health-alert');
    ok(problems.length?await alert.count()===1:await alert.count()===0,'Home alert line present exactly when a check needs attention',JSON.stringify(problems));
    if(problems.length)ok((await alert.innerText()).includes(problems[0].text),'Home alert names the failing check',await alert.innerText());
    if(OUT)await p.screenshot({path:OUT+'/home-real.png'});
    if(problems.length)await alert.tap();else{await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(300);await p.locator('[data-res-tab=health]').tap();}
    await p.waitForTimeout(500);ok(await p.locator('.rs-sheet [data-res-tab=health].selected').count()===1,'Health tab selected');
    const rows=await p.locator('.rs-sheet [data-health]').count();ok(rows===h.checks.length,'Health tab lists every check',`${rows} vs ${h.checks.length}`);
    const order=await p.$$eval('.rs-sheet [data-health]',els=>els.map(e=>e.className));const rank={'rs-h-error':0,'rs-h-warn':1,'rs-h-ok':2};ok(order.every((x,i)=>!i||rank[order[i-1]]<=rank[x]),'Problems listed first',JSON.stringify(order));
    for(const ck of h.checks){const t=await p.locator(`.rs-sheet [data-health="${ck.key}"]`).innerText();ok(t.includes(ck.label)&&(!ck.value||t.includes(ck.value)),`${ck.label} shows its live value`,t);}
    ok(await p.evaluate(()=>{const s=document.querySelector('.rs-detail-body');return s.scrollWidth<=s.clientWidth+1;}),'No horizontal overflow in Health tab');
    if(OUT)await p.screenshot({path:OUT+'/health-real.png'});
    await p.evaluate(()=>__wos.onBack());await p.waitForTimeout(500);ok(await p.evaluate(()=>!document.querySelector('.rs-sheet')&&__wos.idx===0&&!!document.querySelector('.device')),'Back closes Health and stays on Home');
    await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(400);ok(await p.locator('.rs-sheet [data-res-tab=server].selected').count()===1&&(await p.locator('.rs-sheet').innerText()).includes('GB free'),'Server zone still opens Devices');
    const tabs=await p.$$eval('.rs-sheet [data-res-tab]',els=>els.map(e=>e.textContent));ok(JSON.stringify(tabs)===JSON.stringify(['Devices','Health','AI accounts']),'Tabs: Devices · Health · AI accounts',JSON.stringify(tabs));
    const tb=await p.$$eval('.rs-sheet [data-res-tab]',els=>els.map(e=>e.getBoundingClientRect().height));ok(tb.every(x=>x>=36),'Tab targets are thumb-sized',JSON.stringify(tb));
    await c.close();}
  // 2. Fixture: error + warn. Alert is red, both named, tap lands on Health.
  for(const size of [[360,740],[412,892]]){const c=await ctxFor(b,size,'bad'),{p,errs}=await home(c);allErrs.push(...errs);const a=p.locator('.home-desk .rs-health-alert');
    ok(await a.count()===1&&(await a.getAttribute('class')).includes('rs-health-error'),`[fixture ${size.join('×')}] error check gives a red Home line`);
    const t=await a.innerText();ok(t.includes('Hermes backup needs attention')&&t.includes('Services 1 failed')&&t.indexOf('Hermes')<t.indexOf('Services'),'[fixture] errors named before warnings',t);
    const g=await p.evaluate(()=>{const w=document.querySelector('.home-desk .rs-widget').getBoundingClientRect(),d=document.querySelector('#dock').getBoundingClientRect(),al=document.querySelector('.home-desk .rs-health-alert').getBoundingClientRect();return{top:w.top,bottom:w.bottom,dock:d.top,right:w.right,vw:innerWidth,alertH:al.height};});
    ok(g.right<=g.vw&&g.bottom<=g.dock&&g.alertH>=36,`[fixture ${size.join('×')}] widget with alert fits above the dock`,JSON.stringify(g));
    if(OUT)await p.screenshot({path:`${OUT}/home-alert-${size.join('x')}.png`});
    await a.tap();await p.waitForTimeout(400);ok(await p.locator('.rs-sheet [data-res-tab=health].selected').count()===1,'[fixture] alert opens Health tab');
    const first=await p.locator('.rs-sheet [data-health]').first().getAttribute('data-health');ok(first==='hermes-backup','[fixture] failing check first',first);
    ok((await p.locator('.rs-sheet').innerText()).includes('2 need attention'),'[fixture] summary counts problems');
    if(OUT)await p.screenshot({path:`${OUT}/health-fixture-${size.join('x')}.png`});
    await p.evaluate(()=>history.back());await p.waitForTimeout(600);ok(await p.locator('.rs-sheet').count()===0&&await p.evaluate(()=>__wos.idx===0),'[fixture] browser Back closes Health, app stays');await c.close();}
  // 3. Fixture: all OK → no Home line, healthy summary.
  {const c=await ctxFor(b,[412,892],'good'),{p,errs}=await home(c);allErrs.push(...errs);ok(await p.locator('.rs-health-alert').count()===0,'[fixture] all healthy: no Home alert line');await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(300);await p.locator('[data-res-tab=health]').tap();await p.waitForTimeout(300);ok((await p.locator('.rs-sheet').innerText()).includes('all healthy'),'[fixture] Health summary says all healthy');await c.close();}
  // 4. Fixture: stale checks → amber Home line, labelled.
  {const c=await ctxFor(b,[412,892],'stale'),{p,errs}=await home(c);allErrs.push(...errs);const t=await p.locator('.rs-health-alert').innerText().catch(()=>'');ok(/Health checks last ran 3h ago/.test(t),'[fixture] stale checks flagged on Home',t);await c.close();}
  // 5. Fixture: no watchdog on this install / endpoint down → explicit, never fake greens.
  {const c=await ctxFor(b,[412,892],'none'),{p,errs}=await home(c);allErrs.push(...errs);ok(await p.locator('.rs-health-alert').count()===0,'[fixture] no checks set up: no Home line');await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(300);await p.locator('[data-res-tab=health]').tap();await p.waitForTimeout(300);ok((await p.locator('.rs-sheet').innerText()).includes('No health checks are set up'),'[fixture] setup hint shown');await c.close();}
  {const c=await ctxFor(b,[412,892],'503'),{p,errs}=await home(c);allErrs.push(...errs);await p.locator('[data-res-open=server]').tap();await p.waitForTimeout(300);await p.locator('[data-res-tab=health]').tap();await p.waitForTimeout(300);const t=await p.locator('.rs-sheet').innerText();ok(t.includes('Health checks unavailable')&&!/all healthy/.test(t),'[fixture] endpoint failure is explicit',t.slice(0,200));await c.close();}
  ok(allErrs.length===0,'No page errors',allErrs.join(' | '));ok(writes===0,'Zero writes');await b.close();console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);})().catch(e=>{console.error(e);process.exit(2);});
