#!/usr/bin/env node
/* Trusted Chromium touch/clipboard coverage, NOT physical Safari installation proof.
 * Also usable after deployment: QA_ORIGIN=https://... QA_RESOLVE='MAP host ip'. */
const { chromium } = require('./tools/qa-playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:18964';
const out = process.env.QA_OUT;
if (!out) throw Error('Set QA_OUT to a private receipt directory');
fs.mkdirSync(out, {recursive:true});
const checks = [];
const check = (name, pass, detail) => { checks.push({name,pass:!!pass,detail}); assert.ok(pass,name); };
(async () => {
  const browser = await chromium.launch({headless:true,args:process.env.QA_RESOLVE ? ['--host-resolver-rules='+process.env.QA_RESOLVE] : []});
  let failure;
  try {
    for (const kind of ['iphone-browser','iphone-pwa','ipad-pwa','android-browser','android-pwa','generic-browser']) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:kind.startsWith('android') ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' : kind.startsWith('generic') ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' : kind.startsWith('ipad') ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
      // Live verification must never write workspace or owner data.
      await ctx.route('**/*', route => ['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({status:405,body:'Read-only QA'}));
      await ctx.addInitScript(kind => {
        localStorage.setItem('wos.tour.v1','true'); localStorage.setItem('wos.coached','true');
        Object.defineProperty(navigator,'standalone',{value:kind.endsWith('pwa')});
        if (kind.startsWith('ipad')) { Object.defineProperty(navigator,'platform',{value:'MacIntel'}); Object.defineProperty(navigator,'maxTouchPoints',{value:5}); }
        window.touchReceipt=[];
        for (const type of ['pointerdown','click']) document.addEventListener(type,e=>{if(e.target.closest?.('.home-pin-sheet')) touchReceipt.push({type,trusted:e.isTrusted});},true);
      }, kind);
      // Optional local candidate assets against real registry; receipt labels this, never deploys.
      if (process.env.QA_WEB_ROOT) await ctx.route('**/core/home-screen-apps.*', route => {
        const file = path.basename(new URL(route.request().url()).pathname);
        return route.fulfill({path:path.join(process.env.QA_WEB_ROOT,'core',file)});
      });
      const page = await ctx.newPage();
      await page.goto(origin+'/wizard-os-home/?shell=phone');
      await page.waitForFunction(()=>!!window.__wos?.openSheet);
      await page.evaluate(async()=>{await WizCore.appsLoaded();__wos.openSheet('launcher');});
      const registered = await page.evaluate(()=>WizCore.apps().APP.wisdom);
      assert.ok(registered && registered.url, 'Wisdom must exist in actual registry');
      const directURL = new URL(registered.url, origin).href;
      check(kind+' registered URL safe',new URL(directURL).origin===origin && !new URL(directURL).pathname.startsWith('/wizard-os-home'),{registeredURL:registered.url,directURL});
      const tile=page.locator('#launcher [data-app="wisdom"]').first();
      await tile.scrollIntoViewIfNeeded(); await page.waitForTimeout(650);
      const r=await tile.boundingBox(),cdp=await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
      await page.waitForTimeout(550);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const sheet=page.locator('.home-pin-sheet'); await sheet.waitFor();
      check(kind+' immediate two-step guide',await sheet.locator('ol > li').count()===2);
      check(kind+' only Copy link; no open/add links',await sheet.locator('button').count()===1 && await sheet.locator('button').innerText()==='Copy link' && await sheet.locator('a').count()===0);
      check(kind+' opening release inert',ctx.pages().length===1 && await sheet.locator('[role=status]').innerText()==='');
      const link=sheet.locator('textarea');
      check(kind+' canonical full URL',await link.inputValue()===directURL);
      const label = kind.startsWith('iphone') || kind.startsWith('ipad') ? 'Safari' : kind.startsWith('android') ? 'Chrome' : 'your browser';
      check(kind+' platform label',await sheet.locator('strong').first().innerText()==='Open this link in '+label);
      check(kind+' platform save instruction', (await sheet.locator('ol > li').nth(1).innerText()).includes(label==='Safari' ? 'Share → Add to Home Screen' : 'Install app'));
      // Actual browser clipboard write/read, permission granted; activation is a trusted touchscreen tap.
      await ctx.grantPermissions(['clipboard-read','clipboard-write']);
      await sheet.locator('button').tap();
      await page.waitForFunction(()=>document.querySelector('.home-pin-sheet [role=status]').textContent.startsWith('Copied.'));
      check(kind+' real clipboard readback',await page.evaluate(()=>navigator.clipboard.readText())===await link.inputValue());
      await ctx.clearPermissions();
      // Deterministic denial covers browsers/PWA contexts that reject the Clipboard API.
      await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}}));
      await sheet.locator('button').tap();
      await page.waitForFunction(()=>document.querySelector('.home-pin-sheet [role=status]').textContent.startsWith('Couldn’t'));
      check(kind+' denial honest and exact URL selected',await link.evaluate(e=>e.selectionStart===0 && e.selectionEnd===e.value.length));
      await link.tap();
      check(kind+' trusted tap selects link outside action guard',await link.evaluate(e=>document.activeElement===e && e.selectionStart===0 && e.selectionEnd===e.value.length));
      check(kind+' native selection/callout enabled',await link.evaluate(e=>getComputedStyle(e).webkitUserSelect==='text' && getComputedStyle(e).touchAction==='auto'));
      // A real long touch must leave the text control usable, not invoke a shell gesture.
      const lr=await link.boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:lr.x+30,y:lr.y+20}]}); await page.waitForTimeout(700);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      check(kind+' selection hold keeps sheet and no navigation',await sheet.count()===1 && ctx.pages().length===1);
      await link.tap();
      check(kind+' full link fits and remains selectable',await link.evaluate(e=>e.scrollHeight<=e.clientHeight+1 && e.selectionEnd===e.value.length));
      for (const width of [320,390]) {
        await page.setViewportSize({width,height:844});
        check(kind+' geometry '+width,await sheet.evaluate(e=>{const r=e.getBoundingClientRect(),t=e.querySelector('textarea');return r.left>=0&&r.right<=innerWidth&&t.scrollHeight<=t.clientHeight+1;}));
      }
      check(kind+' interactions trusted',await page.evaluate(()=>touchReceipt.length>=4 && touchReceipt.every(e=>e.trusted)));
      await page.screenshot({path:path.join(out,kind+'.png')});
      await page.evaluate(()=>__wosNativeBack());
      check(kind+' Back preserves launcher',await sheet.count()===0 && await page.locator('#launcher').evaluate(e=>e.classList.contains('open')));
      // Native bridge fixture regression: trusted action, real rendering; not an OS pin.
      await page.evaluate(()=>{
        window.nativeMessages=[];
        window.wizardHomeScreenPort={postMessage(raw){const m=JSON.parse(raw);nativeMessages.push(m);this.onmessage({data:JSON.stringify({requestId:m.requestId,status:m.op==='status'?'ready':'pending'})});}};
        WizHomeScreenApps.offer(WizCore.apps().APP.wisdom);
      });
      await page.waitForFunction(()=>document.querySelector('.home-pin-sheet button')?.disabled===false);
      await page.locator('.home-pin-sheet button').tap();
      check(kind+' native bridge fixture unchanged',await page.evaluate(()=>nativeMessages.some(m=>m.op==='pin'&&m.appId==='wisdom'&&m.icon.startsWith('data:image/png')&&!('url' in m))&&WizHomeScreenApps.state.pending));
      check(kind+' native has no browser guide',await page.locator('.home-pin-sheet textarea, .home-pin-sheet ol').count()===0);
      await ctx.close();
    }
  } catch(e) { failure=String(e.stack||e); }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({origin,candidateOverlay:process.env.QA_WEB_ROOT||null,checks,failure,limits:['Chromium touch emulation, not iOS Safari engine/physical phone or OS install proof']},null,2));
    console.log(JSON.stringify({checks:checks.length,failure,out})); if(failure)process.exitCode=1;
  }
})();
