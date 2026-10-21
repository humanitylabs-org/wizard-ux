// Isolated in-shell fixture QA. No live box, accounts, Docker or external writes.
// QA_PLAYWRIGHT and QA_CHROME select the installed browser; QA_SHOTS holds evidence.
const {spawn} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pw = require('./tools/qa-playwright.cjs');
const port = Number(process.env.QA_PORT || 19473), origin = `http://127.0.0.1:${port}`;
const shots = process.env.QA_SHOTS || path.join(process.env.TMPDIR || process.cwd(), 'recommended-evidence');
const selection = {source:'standard',repo:'oscarhenrycollins/wizard-cloudflare',commit:'a'.repeat(40),operation:'install'};
const fixture = spawn(process.execPath, ['tools/fake-setup-api.cjs',String(port)], {cwd:__dirname,stdio:['ignore','pipe','inherit']});
const reports=[];
let browser;
(async()=>{
  fs.mkdirSync(shots,{recursive:true});
  await new Promise((resolve,reject)=>{fixture.stdout.on('data',b=>{if(String(b).includes('fake-setup-api'))resolve();});fixture.on('error',reject);fixture.on('exit',c=>reject(Error('fixture exited '+c)));});
  browser=await pw.chromium.launch({executablePath:process.env.QA_CHROME || undefined,headless:true});
  for(const mode of ['desktop','phone']) {
    await fetch(origin+'/__fake/reset',{method:'POST'});
    const ctx=await browser.newContext({viewport:mode==='phone'?{width:390,height:844}:{width:1440,height:960},isMobile:mode==='phone',hasTouch:mode==='phone'});
    let installed=false,posts=0,pulls=0,failed=false;
    const sequence=[],errors=[];
    await ctx.addInitScript(mode=>{localStorage.setItem('wux.shell',mode);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');},mode);
    await ctx.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      if(u.origin!==origin) return route.abort();
      if(u.pathname==='/wizard/v1/bootstrap') {const r=await route.fetch();const b=await r.json();b.endpoints={apps:'/wizard/v1/apps'};return json(b);}
      if(u.pathname==='/wizard/v1/setup/seen') {sequence.push('seen');return route.continue();}
      if(u.pathname==='/wizard/v1/apps') {
        await new Promise(r=>setTimeout(r,150)); // expose apps-changed/open registry race
        return json({apps:installed?[{id:'wizard-cloudflare',name:'Cloudflare',url:'/wizard-cloudflare/',source:'apps.json',status:'running'}]:[]});
      }
      if(u.pathname==='/wizard-os-home/store-install/_recommended') {
        if(req.method()==='POST') {pulls++;sequence.push('prefetch');return json({state:'running'});}
        return json({apps:[{id:'wizard-cloudflare',name:'Cloudflare',summary:'Publish websites, back up files and manage domains.',installed,selection},
          {id:'wizard-connectors',name:'Connected accounts',summary:'Google',installed:false,selection:null,unavailable:'Not published for this Wizard yet. Try again after an update.'}]});
      }
      if(u.pathname==='/wizard-os-home/store-install/wizard-cloudflare') {
        if(req.method()==='POST') {posts++;assert.deepEqual(req.postDataJSON(),selection);assert.equal(req.headers()['x-wizard-store'],'1');return json({state:'installing'});}
        if(failed)return json({state:'failed',error:'Download failed. Try again.'});
        installed=true;return json({state:'installed',selection});
      }
      if(u.pathname==='/wizard-cloudflare/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><h1>Cloudflare sign-in fixture</h1><button>Sign in to Cloudflare</button></body></html>'});
      return route.continue();
    });
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(origin+'/wizard-os-home/?shell='+mode,{waitUntil:'load'});
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/setup/')));
    const f=page.frames().find(f=>f.url().includes('/setup/'));
    await f.locator('[data-recommended="wizard-cloudflare"]').waitFor();
    await page.waitForFunction(()=>!!window.WosSkin);
    for(const skin of ['nebula','obsidian-light']) {
      await page.evaluate(s=>WosSkin.set(s),skin);
      await f.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
      assert.equal(await f.locator('.recommended').count(),1);
      assert.equal(await f.locator('[data-recommended="wizard-connectors"]').isDisabled(),true);
      const surface=await f.evaluate(()=>({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,
        overflow:document.documentElement.scrollWidth>innerWidth,text:getComputedStyle(document.querySelector('.recommended h2')).color}));
      assert.equal(surface.html,'rgba(0, 0, 0, 0)');assert.equal(surface.body,'rgba(0, 0, 0, 0)');assert.equal(surface.overflow,false);
      const file=path.join(shots,`${mode}-${skin}.png`);await page.screenshot({path:file});
      reports.push({mode,skin,surface,screenshot:file});
    }
    assert.ok(pulls>=1);assert.ok(sequence.indexOf('seen')<sequence.indexOf('prefetch'));
    // Existing nested Back still returns to Setup, never closes it.
    await f.locator('[data-act="open-phone"]').click();
    await f.waitForFunction(()=>__setup.state.screen==='phone');
    await page.evaluate(()=>window.__wosNativeBack());
    await f.waitForFunction(()=>__setup.state.screen==='list');
    assert.equal(page.isClosed(),false);
    // Real shell must accept Setup as the sender and wait for registration before opening.
    await f.locator('[data-recommended="wizard-cloudflare"]').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/wizard-cloudflare/')),{},{timeout:15000});
    const cf=page.frames().find(f=>f.url().includes('/wizard-cloudflare/'));
    assert.equal(await cf.locator('h1').textContent(),'Cloudflare sign-in fixture');
    assert.equal(posts,1);assert.deepEqual(errors,[]);
    reports.push({mode,installPosts:posts,prefetchRequests:pulls,sequence,signInOpened:true,backStayed:true,errors});
    await ctx.close();
  }
  fs.writeFileSync(path.join(shots,'report.json'),JSON.stringify(reports,null,2)+'\n');
  console.log(JSON.stringify({passed:true,reports},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();fixture.kill();});
