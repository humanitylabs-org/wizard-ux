#!/usr/bin/env node
/* Run against tools/qa-pages-server.mjs (Agent Service #134 + recording Hermes stub).
   QA_OUT, QA_CHROME and argv[2] follow the other browser suites. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const origin=(process.argv[2]||'http://127.0.0.1:8994').replace(/\/wizard-os-home\/?$/,'').replace(/\/$/,'');
const out=process.env.QA_OUT||path.join(process.env.TMPDIR||require('node:os').tmpdir(),'qa-pages');fs.mkdirSync(out,{recursive:true});
let passed=0;const ok=(v,s)=>{assert.ok(v,s);console.log('PASS '+s);passed++;};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
 try {
 for(const shell of ['desktop','phone']){
  const ctx=await browser.newContext({viewport:shell==='desktop'?{width:1280,height:800}:{width:412,height:892},hasTouch:shell==='phone',isMobile:shell==='phone',...(shell==='phone'?{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'}:{})});
  await ctx.addInitScript(()=>{try { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.tour.v1','done');localStorage.setItem('wos.desktop.tour.v1','done'); } catch (_) {} });
  const p=await ctx.newPage(), errors=[];p.on('pageerror',e=>errors.push(e.message));
  const slug='qa-'+shell+'-'+Date.now();await p.request.post(origin+'/__qa/seed?slug='+slug);
  const entry=origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'');
  await p.goto(entry+'?open=pages');
  const root=p.locator('.pg-host');await root.locator('[data-pg-open="'+slug+'"]').waitFor({timeout:20000});
  ok(await p.evaluate(()=>WizCore.apps(document.documentElement.dataset.shell).APPS.some(a=>a.id==='pages'&&a.system)),'['+shell+'] Pages system tile admitted');
  ok(await root.locator('.pg-row').count()>0,'['+shell+'] seeded page listed');
  await root.locator('[data-pg-open="'+slug+'"]').click();await root.locator('.pg-frame').waitFor();
  ok((await root.locator('iframe').getAttribute('sandbox'))==='allow-scripts allow-forms allow-popups allow-downloads','['+shell+'] opaque frame sandbox');
  const frame=()=>p.frames().find(f=>f.url().includes('/pages/'+slug+'/'));
  await p.waitForFunction(s=>document.querySelector('.pg-frame')?.contentWindow!==null,slug);
  await p.waitForTimeout(200);
  await frame().waitForFunction(()=>window.security?.status || window.security?.fetchError);
  const security=await frame().evaluate(()=>security);
  // CORS with opaque Origin blocks reading the response; the server-side refusal is also checked directly.
  const denied=await p.request.get(origin+'/wizard/v1/sessions',{headers:{Origin:'null'}});
  ok(denied.status()===403&&(await denied.json()).error==='opaque_origin'&&security.storage==='SecurityError'&&(security.status===403||security.fetchError),'['+shell+'] sandbox fetch refused and localStorage throws');
  fs.writeFileSync(path.join(out,shell+'-security.json'),JSON.stringify({insideFrame:security,opaqueRequestStatus:denied.status(),body:await denied.json()},null,2));
  // Edit twice; exact API readbacks ensure the durable writes, not merely a toast.
  await root.locator('[data-pg="edit"]').click();await root.locator('textarea.pg-editor').waitFor();
  const initial=await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json());
  const versions=await p.request.get(origin+'/wizard/v1/pages/'+slug+'/history?file=doc.md').then(r=>r.json());
  const v1=versions.versions[0].commit;
  for(const v of ['# Version two\n\nOwner edit.','# Version three\n\nSecond owner edit.']){
   await root.locator('textarea.pg-editor').fill(v);await root.locator('[data-pg="save"]').click();await root.locator('.pg-status').filter({hasText:'Saved'}).waitFor();
   ok((await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json())).text===v,'['+shell+'] saved and read back '+v.split('\n')[0]);
  }
  // Concurrent agent write produces real service 409, not a fake response.
  const old=await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json());
  await p.request.put(origin+'/wizard/v1/pages/'+slug+'/doc.md',{data:{text:'# Agent concurrent edit',version:old.version}});
  await root.locator('textarea.pg-editor').fill('# My preserved edit');await root.locator('[data-pg="save"]').click();await root.locator('.pg-conflict').waitFor();
  ok((await root.locator('.pg-conflict').innerText()).includes('# Agent concurrent edit')&&(await root.locator('textarea.pg-editor').inputValue())==='# My preserved edit','['+shell+'] conflict preserves both texts');
  await root.locator('[data-pg="mine"]').click();await root.locator('.pg-status').filter({hasText:'Saved'}).waitFor();
  ok((await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json())).text==='# My preserved edit','['+shell+'] Keep mine resaves against current version');
  // Unsaved Back must not leak a layer; then discard and open history.
  await root.locator('textarea.pg-editor').fill('unsaved');p.once('dialog',d=>d.dismiss());await root.locator('[data-pg="back"]').click();ok(await root.locator('textarea.pg-editor').isVisible(),'['+shell+'] Back cancel retains unsaved draft');
  p.once('dialog',d=>d.accept());await root.locator('[data-pg="back"]').click();await root.locator('[data-pg="history"]').click();await root.locator('[data-pg-version]').first().waitFor();
  const hist=await p.request.get(origin+'/wizard/v1/pages/'+slug+'/history?file=doc.md').then(r=>r.json());
  await root.locator('[data-pg-version="'+hist.versions.findIndex(v=>v.commit===v1)+'"]').click();await root.locator('[data-pg="restore"]').click();await root.locator('.pg-frame').waitFor();
  ok((await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json())).text===initial.text,'['+shell+'] Restore version one persisted');
  // Wrong source, null origin, correct shape: still cannot prompt or save.
  const runsBefore=(await p.request.get(origin+'/__qa/records').then(r=>r.json())).filter(r=>r.path==='/wizard/hermes/v1/runs').length;
  await p.evaluate(()=>window.postMessage({type:'wizard-page:feedback',id:'spoof',text:'DO NOT SEND'},'*'));
  await p.evaluate(()=>{const s=document.createElement('iframe');s.sandbox='allow-scripts';s.srcdoc='<script>parent.postMessage({type:"wizard-page:feedback",id:"spoof-frame",text:"DO NOT SEND"},"*")<\/script>';s.id='spoof';document.body.appendChild(s);});
  await p.waitForTimeout(150);ok(await root.locator('.pg-confirm').count()===0,'['+shell+'] spoofed window and opaque non-page frame ignored');
  await p.locator('#spoof').evaluate(e=>e.remove());
  await frame().locator('#feedback').click();await root.locator('.pg-confirm').waitFor();
  await p.screenshot({path:path.join(out,shell+'-confirm.png')});
  await frame().evaluate(()=>parent.postMessage({type:'wizard-page:feedback',id:'second',text:'Second request'},'*'));
  await p.waitForTimeout(80);ok(await root.locator('.pg-confirm').count()===1,'['+shell+'] one pending feedback consent at a time');
  ok((await root.locator('.pg-confirm').innerText()).includes('wizard_1_pagesqa'),'['+shell+'] feedback names destination thread before sending');
  ok((await p.request.get(origin+'/__qa/records').then(r=>r.json())).filter(r=>r.path==='/wizard/hermes/v1/runs').length===runsBefore,'['+shell+'] unconfirmed feedback never sends');
  await root.locator('[data-pg-confirm]').click();
  for(let i=0;i<100;i++){const rs=await p.request.get(origin+'/__qa/records').then(r=>r.json());if(rs.some(x=>x.path==='/api/sessions/wizard_1_pagesqa/chat/stream'&&JSON.stringify(x.body).includes('/pages/'+slug+'/')))break;await p.waitForTimeout(200);}
  await root.locator('.pg-confirm').waitFor({state:'detached'});
  const records=await p.request.get(origin+'/__qa/records').then(r=>r.json());const run=records.filter(r=>r.path==='/wizard/hermes/v1/runs'&&JSON.stringify(r.body).includes('/pages/'+slug+'/')).at(-1);
  const delivered=records.find(r=>r.path==='/api/sessions/wizard_1_pagesqa/chat/stream'&&JSON.stringify(r.body).includes('/pages/'+slug+'/'));
  ok(delivered?.body.message.includes('[Page feedback · QA '+slug),'['+shell+'] stub received model-locked Hermes stream for feedback');
  ok(run?.body.session_id==='wizard_1_pagesqa'&&JSON.stringify(run.body).includes('[Page feedback · QA '+slug),'['+shell+'] labelled feedback arrived at stub in page thread');
  fs.writeFileSync(path.join(out,shell+'-feedback.json'),JSON.stringify({ingress:run,upstream:delivered},null,2));
  // Bridge save: opaque child asks shell to save only a relative page file.
  const current=await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json());
  await frame().evaluate(({version})=>parent.postMessage({type:'wizard-page:save',id:'bridge-save',slug:'not-the-host-slug',file:'doc.md',text:'# Bridge saved',version},'*'),current);
  await frame().waitForFunction(()=>results.some(r=>r.id==='bridge-save'));
  ok(await frame().evaluate(()=>results.find(r=>r.id==='bridge-save').ok),'['+shell+'] source-bound bridge save acknowledged');
  ok((await p.request.get(origin+'/wizard/v1/pages/'+slug+'/doc.md').then(r=>r.json())).text==='# Bridge saved','['+shell+'] bridge save read back at host slug');
  for(const skin of ['nebula','obsidian-light']){
   ok(await p.evaluate(s=>WosSkin.set(s)===s,skin),'['+shell+'] selected skin '+skin);await p.waitForTimeout(200);
   await p.screenshot({path:path.join(out,shell+'-'+skin+'-page.png')});
  }
  await root.locator('[data-pg="edit"]').click();await root.locator('textarea.pg-editor').waitFor();
  await p.screenshot({path:path.join(out,shell+'-light-editor.png')});
  await p.keyboard.press('Escape');await root.locator('.pg-frame').waitFor();ok(true,'['+shell+'] shell Back peels editor to page');
  await p.keyboard.press('Escape');await root.locator('[data-pg-open="'+slug+'"]').waitFor();
  await p.screenshot({path:path.join(out,shell+'-light-list.png')});ok(true,'['+shell+'] shell Back peels page to list');
  await p.keyboard.press('Escape');await root.waitFor({state:'detached'});ok(true,'['+shell+'] list Back closes Pages, never browser-exits');
  // Doc-only path uses shared markdown in shell, not the raw /pages/ response.
  const docSlug=slug+'-doc';await p.request.post(origin+'/__qa/seed?slug='+docSlug+'&docOnly=1&noThread=1');
  await p.goto(entry+'?open=pages');await p.locator('[data-pg-open="'+docSlug+'"]').click();await p.locator('.pg-doc h1').waitFor();ok(await p.locator('.pg-frame').count()===0,'['+shell+'] doc-only page renders shared markdown');
  await p.locator('[data-pg="feedback"]').click();await p.locator('.pg-confirm').waitFor();
  ok((await p.locator('.pg-confirm').innerText()).includes('New thread'),'['+shell+'] missing thread offers new-thread feedback');
  await p.locator('[aria-label="Feedback text"]').fill('Feedback for a new page thread.');await p.locator('[data-pg-confirm]').click();await p.locator('.pg-confirm').waitFor({state:'detached'});
  let newDelivery;
  for(let i=0;i<100;i++){const rs=await p.request.get(origin+'/__qa/records').then(r=>r.json());newDelivery=rs.find(x=>/\/api\/sessions\/[^/]+\/chat\/stream$/.test(x.path)&&JSON.stringify(x.body).includes('/pages/'+docSlug+'/'));if(newDelivery)break;await p.waitForTimeout(200);}
  ok(newDelivery&&newDelivery.body.session_id!=='wizard_1_pagesqa','['+shell+'] new-thread feedback delivered to newly created session');
  // Availability fallback on the very same Agent Service; no launcher tile or JS exceptions.
  await ctx.route('**/wizard/v1/pages',r=>r.fulfill({status:404,contentType:'application/json',body:'{"error":"not_found"}'}));
  await p.goto(entry);await p.waitForFunction(()=>window.WizCore?.appsLoaded&&window.WosPages);await p.evaluate(()=>WizCore.appsLoaded());
  ok(await p.evaluate(()=>!WosPages.available&&!WizCore.apps(document.documentElement.dataset.shell).APPS.some(a=>a.id==='pages')&&!WosPages.match('/pages/anything/')),'['+shell+'] absent API hides tile and leaves link sheet fallback');
  ok(errors.length===0,'['+shell+'] no page errors: '+JSON.stringify(errors));
  await ctx.close();
 }
 console.log('TOTAL '+passed+' pass, 0 fail');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed,failed:0},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1;});
