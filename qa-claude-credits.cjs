// Synthetic-only in-shell Claude credit proof. No owner state or network is admitted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=process.env.QA_PLAYWRIGHT_PATH?require(process.env.QA_PLAYWRIGHT_PATH):require('./tools/qa-playwright.cjs');
const F=require('./tools/qa-proof-fixture.cjs'),web=path.join(__dirname,'web'),out=process.env.QA_OUT||path.join(__dirname,'qa-out-claude-credits');fs.mkdirSync(out,{recursive:true});
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const snapshot=()=>({providers:[{id:'claude',name:'Claude',status:'ok',fetchedAt:new Date().toISOString(),limits:[{id:'weekly',label:'All models · weekly',remainingPercent:0}],paid:{type:'spend',enabled:true,currency:'USD',exponent:2,usedMinor:87500,limitMinor:null,balanceMinor:12345}},{id:'chatgpt',name:'ChatGPT',status:'ok',fetchedAt:new Date().toISOString(),limits:[{id:'weekly',label:'Weekly',remainingPercent:9}],paid:null}]});
(async()=>{let browser;const results=[],errors=[];try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const shell of ['phone','desktop']){
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:1000},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
  await ctx.routeWebSocket('**/*',ws=>ws.close());
  await ctx.route('**/*',async r=>{const u=new URL(r.request().url()),p=u.pathname;
   if(u.origin!==F.ORIGIN)return r.abort('blockedbyclient');
   if(p==='/wizard/ai-usage')return r.fulfill({json:snapshot()});
   if(p==='/wizard-os-home/data.js'||p==='/wizard-os-home/summaries.js')return r.fulfill({contentType:'application/javascript',body:p.endsWith('/data.js')?'window.WIZ_DATA={threads:[],projects:{}};':'window.WIZ_SUMMARIES={};'});
   if(p.startsWith('/wizard-os-home/')){const rel=decodeURIComponent(p.slice('/wizard-os-home/'.length)||'index.html'),file=path.resolve(web,rel);if(file.startsWith(web+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}
   return r.fulfill(F.response(p+u.search,r.request().method()));
  });
  await ctx.addInitScript(shell=>{for(const[k,v]of Object.entries({'wos.coached':'true','wos.welcome.v1':'done','wos.voiceTipSeen':'true','wos.skin':'nebula','wux.shell':shell,'wos.skin-tweaks.v1':JSON.stringify({version:1,off:{},preset:'none',mix:{}})}))localStorage.setItem(k,v);
   // This proof targets the shipped Resources cells on Desks Home, not AI apps'
   // new-chat Home. Pin the supported local view before boot; never owner Look.
   if(shell==='desktop')localStorage.setItem('wos.desktop-view.v1','classic');
  },shell);
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push({shell,error:String(e)}));
  await page.goto(F.ORIGIN+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'?shell=phone'),{waitUntil:'load'});
  await page.waitForFunction(shell=>document.documentElement.dataset.shell===shell&&window.WosResources&&window.WosSkin&&(shell!=='desktop'||window.__wux),shell,{timeout:30000});
  if(shell==='desktop'){
   await page.waitForFunction(()=>window.WosSkinHost?.layout==='classic');
   // desktop.html #logo -> desktop.js goHome() -> render() -> homeHtml().
   // Do not inject a resource widget into a hidden/non-Home desktop.
   await page.locator('#logo').click();
   await page.locator('#desktopHome').waitFor({state:'visible',timeout:15000});
   await page.waitForFunction(()=>window.__wux.homeOpen===true);
  }
  await page.waitForFunction(()=>window.WosResources?.state.ai,{timeout:30000});
  for(const skin of ['nebula','grove']){
   await page.evaluate(s=>WosSkin.set(s),skin);await page.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
   await page.waitForTimeout(700);
   const widget=page.locator(shell==='desktop'?'#desktopHome .rs-widget':'.rs-widget').first();await widget.waitFor({state:'visible',timeout:15000});
   const text=await widget.innerText();assert.ok(text.includes('$123.45'),text);assert.ok(!text.includes('$875')&&!text.includes('spent'),text);assert.ok(text.includes('100%')&&text.includes('91%'),text);
   const shot=path.join(out,`${shell}-${skin}-cells.png`);await page.screenshot({path:shot});
   results.push({shell,skin,variant:'cells',text,shot,skinTokens:await page.evaluate(()=>({base:getComputedStyle(document.documentElement).getPropertyValue('--wz-base').trim(),text:getComputedStyle(document.documentElement).getPropertyValue('--wz-text').trim()}))});
   // Details already have inherited phone evidence; they are not part of this
   // bounded cell-capture tail and must not prevent the four required captures.
  }
  await ctx.close();
 }
 assert.equal(results.length,4,'required phone/desktop × Nebula/Grove cell captures');
 assert.deepEqual(errors,[],'page errors');
 // Background APIs outside the fixture stay denied and are retained in the
 // refusal ledger; they must not broaden this capture-only fixture catalogue.
 console.log(JSON.stringify({ok:true,captures:results.length,errors,refused:F.refused(),out}));
}finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,refused:F.refused()},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
