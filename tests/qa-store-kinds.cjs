// Parent-admitted forum QA only. Reuses qa-skin-panels-shell's isolated real-shell
// transport and qa-store-status's Store entry/Back checks. Never reaches a live API.
const {chromium}=require('../tools/qa-playwright.cjs');
const {ownerRead,seedOwner}=require('../tools/qa-desktop-frame-fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),out=process.env.QA_OUT;
const catalog=JSON.parse(fs.readFileSync(process.env.QA_CATALOG));
const ORIGIN='http://store-kinds.test';
const TYPES={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const result={synthetic:true,live:false,profiles:[],fixtureWrites:[]};
async function transport(ctx){
 await ctx.route('**/*',r=>{
  const req=r.request(),u=new URL(req.url());
  if(u.origin!==ORIGIN)return r.abort();
  const json=body=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(req.method()!=='GET'){result.fixtureWrites.push({method:req.method(),path:u.pathname});return json({});}
  if(u.pathname.includes('/store-data/wizard/v1/index/search'))return json(catalog);
  if(u.pathname.endsWith('/store-data/api/apps/installed'))return json({installed:[]});
  if(u.pathname.endsWith('/store-data/wizard/v1/installed-apps'))return json({wam:[],shell:[],complete:true,architecture:'amd64'});
  const rel=decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//,''))||'index.html',f=path.resolve(web,rel);
  if(f.startsWith(web+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({status:200,contentType:TYPES[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});
  return json(ownerRead(u.pathname));
 });
}
async function check(f){
 await f.locator('[data-kind="apps"]:not([disabled])').click();
 assert.equal(await f.locator('.row[data-app^="messenger|"]').count(),1,'Messenger visible in Apps');
 assert.equal(await f.locator('.row[data-app^="headless|"]').count(),0);
 await f.locator('.row[data-app^="messenger|"] .tx').click();
 assert.equal(await f.locator('#detail .d-stats > div').first().locator('b').innerText(),'App');
 assert.equal(await f.locator('#detail .d-how').innerText(),'Opens in its own Wizard window.');
 assert.doesNotMatch(await f.locator('#detail').innerText(),/Runs in the background|no screen needed/);
 assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);
 assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);
 await f.locator('[data-kind="agent-apps"]').click();
 assert.equal(await f.locator('.row[data-app^="messenger|"]').count(),0);
 assert.equal(await f.locator('.row[data-app^="headless|"]').count(),1);
 await f.locator('.row[data-app^="headless|"] .tx').click();
 assert.equal(await f.locator('#detail .d-how').innerText(),'Runs in the background. Ask your agent to use it — no screen needed.');
 await f.evaluate(()=>window.__wizardCloseOverlay());
 await f.evaluate(()=>window.__wizardCloseOverlay());
 await f.locator('#q').fill('Messenger');
 await f.locator('.row[data-app^="messenger|"]').waitFor();
 assert.match(await f.locator('.row[data-app^="messenger|"] small').innerText(),/^App ·/);
 await f.locator('.row[data-app^="messenger|"] .tx').click();
 // A click can schedule navigation after this task; screenshots must prove the loaded detail.
 await f.locator('#detail:not([hidden]) h2').waitFor({state:'visible'});
 assert.match(await f.locator('#detail h2').innerText(),/Messenger/);
 assert.equal(await f.locator('#detail .d-how').innerText(),'Opens in its own Wizard window.');
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const b=await chromium.launch({headless:true});
 try{for(const shell of ['phone','desktop']){
  const ctx=await b.newContext(shell==='phone'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',serviceWorkers:'block'}:{viewport:{width:1440,height:900},serviceWorkers:'block'});
  await transport(ctx);await ctx.addInitScript(seedOwner,{phone:true}); // established owner, without the helper's unrelated desktop fixture windows
  await ctx.addInitScript(shell=>{if(window!==top)return;localStorage.setItem('wux.shell',shell);localStorage.setItem('wos.skin','nebula');},shell);
  const p=await ctx.newPage();await p.goto(`${ORIGIN}/wizard-os-home/${shell==='desktop'?'desktop.html':''}?shell=${shell}&open=app-store`);
  await p.waitForFunction(sh=>document.documentElement.dataset.shell===sh,shell);
  await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/store/index.html')));
  // The iframe element can precede its navigation; wait for the actual Store frame.
  let f=p.frames().find(f=>f.url().includes('/store/index.html'));
  if(!f)f=await p.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/store/index.html')});
  await check(f);
  const marker=await f.evaluate(()=>window.__qaDocument=String(Math.random()));
  const skins=[];
  for(const skin of ['nebula','grove']){
   if(skin==='grove'){
    if(shell==='phone')await p.evaluate(()=>__wos.openSettings());else await p.locator('#settingsBtn').click();
    await p.locator(`${shell==='phone'?'#settings':'#dsettings'} [data-st-page="appearance"]`).click();
    const family=await p.evaluate(id=>WosSkin.familyOf(id),skin),card=p.locator(`[data-skinfamily="${family}"]:visible`).first();
    if(await card.count()&&await card.getAttribute('aria-pressed')!=='true')await card.click();
    await p.locator(`[data-skinpick="${skin}"]:visible`).first().click();
    await p.waitForFunction(id=>WosSkin.current===id,skin);
    if(shell==='phone')await p.evaluate(()=>__wos.closeSheets(true));
    else await p.keyboard.press('Alt+,');
   }
   await f.waitForFunction(sk=>document.documentElement.dataset.skin===sk,skin);
   assert.equal(await f.evaluate(()=>window.__qaDocument),marker);
   const tokens=await f.evaluate(()=>({ink:getComputedStyle(document.documentElement).getPropertyValue('--wz-text'),base:getComputedStyle(document.documentElement).getPropertyValue('--wz-base'),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.ok(tokens.ink.trim());assert.ok(tokens.base.trim());assert.equal(tokens.overflow,false);
   await p.waitForTimeout(800);await p.screenshot({path:path.join(out,`${shell}-${skin}.png`)});skins.push({skin,tokens,document_preserved:true});
  }
  result.profiles.push({shell,skins});await ctx.close();
 }
 const ctx=await b.newContext({colorScheme:'dark',serviceWorkers:'block'});await transport(ctx);const p=await ctx.newPage();await p.goto(ORIGIN+'/wizard-os-home/store/index.html');await check(p);
 result.standalone=await p.evaluate(()=>({hosted:top!==self,bg:getComputedStyle(document.body).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme}));
 assert.equal(result.standalone.hosted,false);assert.notEqual(result.standalone.bg,'rgb(255, 255, 255)');
 await p.locator('#detail:not([hidden]) h2').waitFor({state:'visible'});
 assert.match(await p.locator('#detail h2').innerText(),/Messenger/);
 await p.waitForTimeout(800);
 const heading=await p.locator('#detail h2').boundingBox();assert.ok(heading && heading.y>=0 && heading.y+heading.height<=await p.evaluate(()=>innerHeight),'standalone Messenger heading is on screen');
 result.standalone.title=await p.locator('#detail h2').innerText();result.standalone.hint=await p.locator('#detail .d-how').innerText();
 await p.screenshot({path:path.join(out,'standalone-dark.png')});await ctx.close();
 result.pass=true;fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(result,null,2));
 }finally{await b.close();}
})().catch(e=>{fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));console.error(e);process.exitCode=1;});
