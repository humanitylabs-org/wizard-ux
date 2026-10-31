// Synthetic-only real-shell DOM proof. Point at tools/share-people-preview.cjs; never owner origin.
const {chromium} = require('./tools/qa-playwright.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const BASE=process.env.PREVIEW_URL||'http://127.0.0.1:9581/';
const OUT=process.env.QA_OUT||path.join(__dirname,'qa-share-people');
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const browser=await chromium.launch();
  try {
    const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const p=await ctx.newPage(), errors=[]; p.on('pageerror',e=>errors.push(e.message));
    await p.goto(BASE); assert.equal((await (await p.request.get(new URL('/__preview/receipt',BASE).href)).json()).synthetic,true);
    await p.waitForSelector('[data-shs-people]');
    assert.deepEqual(await p.locator('[data-shs-people] .shs-nm').allTextContents(),['Test Person A','Test Person C','Test Person B']);
    assert.equal(await p.locator('iframe[src*="messenger"]').count(),0,'People loads before Messenger opens');
    for (const skin of ['nebula','sepia']) {
      await p.evaluate(k=>WosSkin.set(k),skin); await p.waitForTimeout(800);
      await p.screenshot({path:path.join(OUT,`share-people-phone-${skin}.png`)});
      const geom=await p.locator('.shs-b').evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,bg:getComputedStyle(el).backgroundColor}));
      assert.ok(geom.w<=390&&geom.h<=844); assert.ok(!geom.bg.includes('rgba('),'solid sheet '+geom.bg);
    }
    await p.evaluate(()=>__wos.onBack()); await p.waitForSelector('.wos-share',{state:'detached'});
    await p.getByRole('button',{name:/STAGING · synthetic people/}).click(); await p.waitForSelector('.wos-share.on');
    await p.mouse.click(195,110); await p.waitForSelector('.wos-share',{state:'detached'});
    await p.getByRole('button',{name:/STAGING · synthetic people/}).click(); await p.waitForSelector('.wos-share.on');
    await p.locator('[data-shs-target="test-b"]').click();
    const receiver=p.frameLocator('iframe[src*="messenger"]');
    await receiver.locator('#recipient').getByText('Test Person B',{exact:true}).waitFor();
    assert.match(await receiver.locator('#draft').inputValue(),/Synthetic item/);
    assert.equal(await receiver.getByRole('button',{name:'Send disabled in preview'}).isDisabled(),true);
    assert.equal(await p.locator('.wos-share').count(),0);
    assert.deepEqual(errors,[]); console.log('PASS real shell: cached recent shares + lastActivity order, cold Messenger, two skins, outside, Back, direct target staged with SDK, no sends');
    await ctx.close();
    const empty=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await empty.route('**/__preview/bootstrap.js',async route=>{const response=await route.fetch();let src=await response.text();src=src.replace("accepts:['text','url','image','file'],targets}","accepts:['text','url','image','file'],targets:[]}");await route.fulfill({response,body:src});});
    const ep=await empty.newPage(); await ep.goto(BASE); await ep.waitForSelector('.wos-share.on');
    assert.equal(await ep.locator('[data-shs-people]').count(),0); assert.equal(await ep.locator('[data-shs-apps] [data-shs-app="messenger"]').count(),1);
    console.log('PASS empty cache: no People spinner, Messenger Apps fallback'); await empty.close();
    const missing=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await missing.route('**/wizard/v1/apps',r=>r.fulfill({json:{schema:1,apps:[],in_development:[],slots:{},parking:[]}}));
    // Do not wait for the bootstrap's Messenger-only demo button in the uninstalled fixture.
    const mp=await missing.newPage(); await mp.goto(BASE); await mp.waitForFunction(()=>!!window.WosShareSheet&&!!window.WosChat&&(window.WosAgents?.list||[]).length>0);
    await mp.evaluate(()=>{window.__result=WosShareSheet.show({text:'Synthetic'},()=> 'unsupported');});
    await mp.waitForSelector('.wos-share.on'); assert.equal(await mp.locator('[data-shs-people]').count(),0);
    assert.equal(await mp.locator('[data-shs-app="messenger"]').count(),0); await mp.evaluate(()=>WosShareSheet.back());
    console.log('PASS no installed Messenger: no People row or stale cached names'); await missing.close();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
