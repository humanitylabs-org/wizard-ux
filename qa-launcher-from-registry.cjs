// Launcher-only acceptance: real registry + preference HTTP; exported owner workspaces/agent
// catalogue replayed identically across origins. App iframe bodies are inert (not app-internal QA).
// QA_EXPORT_DIR=<private snapshots> QA_SHOTS=<private dir> node qa-launcher-from-registry.cjs
//   <origin> <result.json> [baseline.json]. Use QA_ALLOW_SEED=1 only for an isolated copied store.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const origin = process.argv[2], output = process.argv[3], baseline = process.argv[4];
if (!origin || !output || !process.env.QA_EXPORT_DIR) throw Error('origin, result and QA_EXPORT_DIR required');
const exported = p => JSON.parse(fs.readFileSync(path.join(process.env.QA_EXPORT_DIR,p),'utf8'));
const workspace = exported('workspaces-export.json'), agents = exported('agents-export.json');
const shots = process.env.QA_SHOTS || path.dirname(output); fs.mkdirSync(shots,{recursive:true});
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.QA_CHROME,headless:true,args:['--no-sandbox']});
  const result={}, errors=[], writes=[], seeds=[];
  try {
    for(const skin of ['nebula','signal']) for(const state of ['fresh-defaults','owner-export']) for(const shell of ['phone','desktop']) {
      const mobile=shell==='phone', key=[shell,skin,state].join('-');
      if (process.env.QA_CASE && key !== process.env.QA_CASE) continue;
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile,
        ...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'}:{})});
      await context.addInitScript(skin=>localStorage.setItem('wos.skin',skin),skin);
      await context.route('**/*',async route=>{
        const req=route.request(), url=new URL(req.url());
        if (!['GET','HEAD'].includes(req.method())) {
          if(process.env.QA_ALLOW_SEED==='1'&&url.pathname==='/wizard/v1/ui-preferences/seed'&&req.method()==='POST') { seeds.push(JSON.parse(req.postData())); return route.continue(); }
          writes.push({path:url.pathname,method:req.method()}); return route.fulfill({status:403,contentType:'application/json',body:'{"error":"launcher QA read-only"}'});
        }
        if(url.pathname==='/wizard/v1/workspaces')return route.fulfill({status:state==='owner-export'?200:403,contentType:'application/json',body:JSON.stringify(state==='owner-export'?workspace:{error:'fresh-defaults fixture disables workspace restore'})});
        if(url.pathname==='/wizard/v1/agents')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(agents)});
        // Deliberately no unrelated installed-app code in launcher acceptance.
        if(req.resourceType()==='document'&&req.frame().parentFrame())return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Launcher QA inert app body</title>'});
        return route.continue();
      });
      const page=await context.newPage();page.on('pageerror',e=>errors.push({key,error:String(e),stack:e.stack}));
      await page.goto(origin+'/wizard-os-home/'+(mobile?'':'desktop.html'),{waitUntil:'load'});
      await page.waitForFunction(mobile=>mobile?!!window.__wos:!!window.__wux,mobile,{timeout:20000});
      await page.evaluate(()=>window.WizCore.appsLoaded?.());
      // First-run setup may precede the tour. Keep its visible Skip control, rather than marking it done in storage.
      const skip=page.getByRole('button',{name:/Skip tour/i});
      if(await skip.count())await skip.first().click({force:true});
      await page.waitForTimeout(1800);
      const entry=await page.evaluate(mobile=>{
        const {APPS}=window.WizCore.apps(mobile?'mobile':'desktop');
        const host=mobile?window.__wos:window.__wux;
        const wins=Object.values(host.wins).map(w=>({app:w.app,appId:w.appId||'',title:w.title||''}));
        return {apps:APPS.map(a=>({id:a.id,name:a.name,kind:a.kind,url:a.url||''})),native:APPS.filter(a=>a.kind==='native').map(a=>({id:a.id,name:a.name,href:a.href})),
          sigils:APPS.map(a=>({id:a.id,...window.WizSigil.of(a.sigil||a)})),windows:wins,
          quick:[...document.querySelectorAll('.home-apps [data-app]')].map(e=>({id:e.dataset.app,name:e.textContent.trim()})),
          shortcutNames:APPS.map(a=>({id:a.id,name:window.WizHomeScreenPolicy.displayName(a)}))};
      },mobile);
      await page.screenshot({path:path.join(shots,path.basename(output,'.json')+'-'+key+'-home.png'),fullPage:false});
      if(mobile){
        await page.evaluate(()=>window.__wos.openSheet('launcher'));
        await page.waitForTimeout(700);
        Object.assign(entry,await page.evaluate(()=>{
          const root=document.querySelector('#launcherBody');
          const group=[...root.querySelectorAll('.lgroup')].find(g=>g.querySelector('h4')?.textContent==='Recent');
          return {grid:[...root.querySelectorAll('[data-app]')].map(e=>({id:e.dataset.app,name:(e.querySelector('.nm')||e).textContent.trim()})),recents:[...(group?.querySelectorAll('[data-app]')||[])].map(e=>e.dataset.app)};
        }));
      }else{
        await page.evaluate(()=>window.__wux.openPicker());await page.waitForTimeout(700);
        entry.grid=await page.locator('.pal-app .nm').allTextContents();entry.recents=[];
      }
      await page.screenshot({path:path.join(shots,path.basename(output,'.json')+'-'+key+'-grid.png'),fullPage:false});
      result[key]=entry;
      await context.close();
    }
    fs.writeFileSync(output,JSON.stringify({result,errors,writes,seeds},null,2)+'\n');
    assert.deepEqual(errors,[],'zero page errors');
    console.log('PASS '+Object.keys(result).length+' launcher cases, zero page errors; '+seeds.length+' isolated seed requests; '+writes.length+' unrelated writes blocked');
    if(baseline){
      const expected=JSON.parse(fs.readFileSync(baseline,'utf8')).result;
      for(const key of Object.keys(expected))for(const field of Object.keys(expected[key]))assert.deepEqual(result[key][field],expected[key][field],key+' '+field);
      console.log('PASS identical apps/native/recents/grid/desktopQuick/windows/sigils/shortcutNames in all 8 cases');
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
