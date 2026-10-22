// Read-only browser regression: actual catalog, service workers off, all writes intercepted.
const {chromium}=require('./qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
(async()=>{
 const origin=process.argv[2]||'http://127.0.0.1:8796';
 const out=process.env.QA_OUTPUT||process.env.TMPDIR; assert(out); fs.mkdirSync(out,{recursive:true});
 const args=['--no-sandbox'];
 if(new URL(origin).hostname!=='127.0.0.1') args.push(`--host-resolver-rules=MAP ${new URL(origin).hostname} ${execFileSync('tailscale',['ip','-4'],{encoding:'utf8'}).trim()}`);
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args});
 const result=[];
 try{for(const control of [true,false]){
  const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await ctx.newPage();
  const writes=[];
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(req.method()!=='GET'){
    writes.push({path:u.pathname,body:req.postData()});
    if(u.pathname.includes('/store-install/wizard-music'))return route.fulfill({json:{state:'failed',error:'PrivateError: wizard-music: release does not support amd64'}});
    return route.abort();
   }
   if(u.pathname.endsWith('/store/store.js')||u.pathname.endsWith('/store/store-status.js')){
    const rel='web/store/'+path.basename(u.pathname);
    const body=control?execFileSync('git',['show','a4af0f7:'+rel],{encoding:'utf8'}):fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
    return route.fulfill({contentType:'text/javascript',body});
   }
   if(u.pathname.endsWith('/wizard/v1/installed-apps')){
    const r=await route.fetch({url:'http://127.0.0.1:9584'+u.pathname});return route.fulfill({json:{...await r.json(),architecture:'amd64'}});
   }
   return route.continue();
  });
  await page.goto(origin+'/wizard-os-home/store/index.html?app=wizard-music&source=owner-private',{waitUntil:'load'});
  await page.locator('#detail h2').waitFor();
  if(control){
   await page.locator('#detail [data-get]').click();
   await page.waitForFunction(()=>!document.getElementById('toast').hidden);
   assert.match(await page.locator('#toast').innerText(),/release does not support amd64/);assert.equal(writes.length,1);
  }else{
   await page.waitForFunction(()=>document.getElementById('detail').textContent.includes('Not compatible'));
   assert.equal(await page.locator('#detail [data-get]').count(),0);
   assert.match(await page.locator('#detail').innerText(),/runs on arm64, not this Wizard \(amd64\)/);
   assert.equal(writes.length,0);
  }
  await page.screenshot({path:path.join(out,control?'music-old.png':'music-fixed.png'),fullPage:true});
  result.push({control,writes,detail:await page.locator('#detail').innerText()});await ctx.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'architecture-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
