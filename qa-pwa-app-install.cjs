#!/usr/bin/env node
/* Real packaged browser QA with synthetic registry/frontends. OS installation is a physical-device gate. */
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:18961';
const out = process.env.QA_OUT;
if (!out) throw Error('Set QA_OUT to a private receipt directory');
fs.mkdirSync(out,{recursive:true});
const checks = [], errors = [];
const check = (name, pass, detail) => { checks.push({name,pass:!!pass,detail}); assert.ok(pass,name+': '+JSON.stringify(detail)); };
(async () => {
  const browser = await chromium.launch({headless:true});
  let failure = null;
  try {
    if (process.env.QA_BASELINE === '1') {
      const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      await page.addInitScript(()=>{localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.coached','true');});
      await page.goto(origin+'/wizard-os-home/?shell=phone');
      await page.waitForFunction(()=>!!window.__wos?.openSheet);
      await page.evaluate(async()=>{await WizCore.appsLoaded();__wos.openSheet('launcher');});
      const tile=page.locator('#launcher [data-app="wisdom"]').first();await tile.scrollIntoViewIfNeeded();await page.waitForTimeout(600);
      const b=await tile.boundingBox(), cdp=await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
      await page.waitForTimeout(550);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      check('baseline browser hold has no install action',await page.locator('.home-pin-sheet').count()===0);
      check('baseline has no per-app manifest endpoint',(await page.request.get(origin+'/wizard-os-home/install/wisdom/manifest.webmanifest')).status()===404);
      await page.screenshot({path:path.join(out,'baseline.png')});
      return;
    }
    for (const [kind, userAgent] of [
      ['android','Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'],
      ['ios','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1']
    ]) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent});
      await ctx.addInitScript(() => { localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.coached','true'); });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push({kind,error:String(e)}));
      await page.goto(origin+'/wizard-os-home/install/wisdom/');
      await page.locator('#instructions').waitFor();
      check(kind+' browser install page does not launch workspace or app',await page.locator('iframe').count()===0 && new URL(page.url()).pathname.endsWith('/wisdom/'));
      check(kind+' manual instructions',await page.locator('#instructions').innerText().then(s=>s.includes(kind==='ios'?'Share → Add to Home Screen':'⋮ menu')));
      const metadata = await page.evaluate(()=>({title:document.title,apple:document.querySelector('[name="apple-mobile-web-app-title"]').content,icon:document.querySelector('[rel="apple-touch-icon"]').href,manifest:document.querySelector('[rel="manifest"]').href}));
      check(kind+' iOS metadata is app-specific',metadata.title==='Wisdom' && metadata.apple==='Wisdom' && metadata.icon.includes('wisdom.png'),metadata);
      const manifest = await (await ctx.request.get(metadata.manifest)).json();
      const second = await (await ctx.request.get(origin+'/wizard-os-home/install/wizard-signal/manifest.webmanifest')).json();
      check(kind+' separate stable manifest identity and scope',manifest.id!==second.id && manifest.scope!==second.scope && manifest.start_url.startsWith(manifest.scope),{manifest,second});
      const client = await ctx.newCDPSession(page);
      const parsed = await client.send('Page.getAppManifest');
      check(kind+' Chromium parses served manifest',parsed.errors.length===0,parsed.errors);
      const installability = await client.send('Page.getInstallabilityErrors');
      check(kind+' Chromium installability diagnostic',installability.installabilityErrors.length===0,installability);
      await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}}));
      await page.locator('#copy').click();
      check(kind+' copy denied selects exact safe canonical link',await page.locator('#address').evaluate(e=>e.selectionEnd===e.value.length && e.value===location.origin+'/wizard-os-home/install/wisdom/'));
      check(kind+' 390px control geometry',await page.evaluate(()=>[...document.querySelectorAll('a,button,input')].filter(e=>!e.hidden).every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>=44&&r.left>=0&&r.right<=innerWidth;})));
      await page.screenshot({path:path.join(out,kind+'-install.png')});
      await page.setViewportSize({width:320,height:667});
      check(kind+' narrow guide fits without horizontal scrolling',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.setViewportSize({width:390,height:844});
      // Deterministic prompt lifecycle injection tests our gesture handler, not OS installation.
      await page.evaluate(()=>{
        const event=new Event('beforeinstallprompt',{cancelable:true});
        window.promptCalls=0;
        event.prompt=()=>{window.promptCalls++;window.promptActivation=navigator.userActivation.isActive;return Promise.resolve();};
        event.userChoice=Promise.resolve({outcome:'dismissed'}); dispatchEvent(event);
      });
      check(kind+' no auto prompt',await page.evaluate(()=>promptCalls===0));
      await page.locator('#prompt').click();
      check(kind+' prompt called only by active user gesture',await page.evaluate(()=>promptCalls===1&&promptActivation));
      check(kind+' dismissal never claims installation',!(await page.locator('#instructions').innerText()).includes('installed'));
      await page.locator('#launch').click();
      await page.waitForFunction(()=>document.querySelector('#session')?.contentWindow?.__wos?.singleApp==='wisdom');
      const session = page.frames().find(f=>f.url().includes('?app-session=wisdom'));
      await session.waitForFunction(()=>!!document.querySelector('#singleApp iframe'));
      check(kind+' launched app uses existing isolated session',await session.evaluate(()=>__wos.singleApp==='wisdom'&&!__wos.wins&&document.querySelectorAll('#singleApp iframe').length===1));
      check(kind+' no workspace writes on launch',await page.evaluate(()=>!localStorage.getItem('wos.wins4')&&!localStorage.getItem('wux.wins')));
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#session')?.contentWindow?.__wos?.singleApp==='wisdom');
      check(kind+' launch survives reload',true);
      await page.screenshot({path:path.join(out,kind+'-launched.png')});
      // Simulate navigator.standalone separately: no claim of a physical Safari install.
      await ctx.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
      await page.goto(origin+'/wizard-os-home/install/wizard-signal/');
      await page.waitForFunction(()=>document.querySelector('#session')?.contentWindow?.__wos?.singleApp==='wizard-signal');
      check(kind+' saved canonical URL launches when standalone',true);
      await page.goto(origin+'/wizard-os-home/install/wisdom/?install=1');
      await page.locator('#instructions').waitFor();
      check(kind+' standalone handoff stays guide with honest escape limitation',await page.locator('iframe').count()===0 && (await page.locator('#instructions').innerText()).includes('cannot force'));
      check(kind+' handoff removes marker before Safari saves URL',page.url()===origin+'/wizard-os-home/install/wisdom/');
      await ctx.close();
    }
    const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await ctx.addInitScript(()=>{localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.coached','true');});
    const page = await ctx.newPage();
    await page.goto(origin+'/wizard-os-home/?shell=phone');
    await page.waitForFunction(()=>!!window.__wos?.openSheet);
    await page.evaluate(async()=>{await WizCore.appsLoaded();__wos.openSheet('launcher');});
    const tile=page.locator('#launcher [data-app="wisdom"]').first(); await tile.scrollIntoViewIfNeeded();
    // The sheet slides in; coordinates sampled during that animation hit empty space.
    await page.waitForTimeout(600);
    const cdp=await ctx.newCDPSession(page);
    async function hold() {
      const b=await tile.boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
      await page.waitForTimeout(550);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    await hold();
    check('browser trusted hold opens fallback sheet',await page.locator('.home-pin-sheet').count()===1);
    check('opening release does not open another page',ctx.pages().length===1);
    await page.screenshot({path:path.join(out,'browser-pin-sheet.png')});
    const popupPromise=ctx.waitForEvent('page');
    await page.locator('.home-pin-sheet button').first().tap();
    const popup=await popupPromise;await popup.waitForLoadState();
    check('fallback action opens app-specific install guide',await popup.locator('#instructions').count()===1);
    await popup.close();
    await page.evaluate(()=>__wosNativeBack());
    check('Back closes only pin sheet, preserving launcher',await page.locator('.home-pin-sheet').count()===0&&await page.locator('#launcher').evaluate(e=>e.classList.contains('open')));
    await page.waitForTimeout(750);await tile.tap();
    check('ordinary tap still opens a desk',await page.evaluate(()=>!!__wos.wins&&!__wos.singleApp));
    // Native port contract: fixture replies model native status; no OS pin claim.
    await page.evaluate(()=>{
      window.nativeMessages=[];
      window.wizardHomeScreenPort={postMessage(raw){const m=JSON.parse(raw);nativeMessages.push(m);this.onmessage({data:JSON.stringify({requestId:m.requestId,status:m.op==='status'?'ready':'pending'})});}};
      WizHomeScreenApps.offer(WizCore.apps('mobile').APP.wisdom);
    });
    await page.waitForFunction(()=>document.querySelector('.home-pin-sheet button')?.disabled===false);
    await page.locator('.home-pin-sheet button').first().tap();
    check('native bridge retains pin payload and pending semantics',await page.evaluate(()=>nativeMessages.some(m=>m.op==='pin'&&m.appId==='wisdom'&&m.icon.startsWith('data:image/png'))&&WizHomeScreenApps.state.pending));
    check('native bridge never shows browser handoff controls',await page.locator('.home-pin-sheet input').count()===0);
    await ctx.close();
    check('install document has no runtime errors',errors.length===0,errors);
  } catch(error) {
    failure=String(error.stack||error); console.error(failure);
    let index=0;for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:path.join(out,'failure-'+index+++'.png')}).catch(()=>{});
  }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({origin,checks,errors,failure,limits:['Chromium mobile UA/standalone emulation, not physical Android or iPhone installation','beforeinstallprompt/native bridge fixtures are handler tests','Synthetic registry and app bodies; real shipped shell/install documents']},null,2));
    console.log(JSON.stringify({checks:checks.length,failed:checks.filter(c=>!c.pass).length,failure,out}));
    if(failure)process.exitCode=1;
  }
})();
