// Synthetic, write-blocked browser regression using the shipping shell, not a mocked tile renderer.
// QA_PLAYWRIGHT=/path/to/playwright node qa-launcher-freshness.cjs [--expect-stale]
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const stale = process.argv.includes('--expect-stale');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({viewport:mobile ? {width:412,height:892} : {width:1440,height:900}});
      let apps = [], calls = 0, failure = false, delay = 0;
      const blockedWrites = [];
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (!['GET','HEAD','OPTIONS'].includes(req.method())) {
          blockedWrites.push(u.pathname); return route.fulfill({json:{}});
        }
        if (u.pathname === '/wizard/v1/bootstrap') return route.fulfill({json:{bootstrap:1,endpoints:{apps:'/wizard/v1/apps'},capabilities:{},settings:{agent:{name:'Wizard'}}}});
        if (u.pathname === '/wizard/v1/apps') {
          calls++;
          if (delay) await new Promise(r => setTimeout(r,delay));
          return route.fulfill({status:failure ? 503 : 200,json:{apps,in_development:[]}});
        }
        // No private sessions, messages, credentials, or external providers are accessed.
        if (u.pathname.startsWith('/wizard/hermes/')) return route.fulfill({json:{sessions:[],agents:[],messages:[],ok:true}});
        if (u.pathname.startsWith('/wizard-os-home/')) {
          const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
          if (['data.js','summaries.js'].includes(rel)) return route.fulfill({body:'window.WIZ_DATA = {threads: []};',contentType:'application/javascript'});
          const file = path.resolve(__dirname,'web',rel);
          if (file.startsWith(path.resolve(__dirname,'web') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({body:fs.readFileSync(file),contentType:type});
          }
        }
        return route.fulfill({json:{ok:true,agents:[],sessions:[],apps:[]}});
      });
      const page = await ctx.newPage();
      await page.addInitScript(() => { localStorage.setItem('wos.coached','true'); });
      await page.goto('https://wizard.test/wizard-os-home/' + (mobile ? 'index.html?shell=phone' : 'desktop.html'),{waitUntil:'networkidle'});
      await page.waitForFunction(m => m ? !!window.__wos : !!window.__wux, mobile);
      await page.evaluate(() => window.WizCore.appsLoaded());
      const open = () => page.evaluate(m => m ? __wos.openSheet('launcher') : __wux.openPicker(), mobile);
      const close = () => page.evaluate(m => m ? __wos.closeSheets() : __wux.closePalette(), mobile);
      const tile = page.locator(mobile ? '#launcherBody [data-app="messenger"]' : '#palList button').filter({hasText:'Messenger'});
      await open(); await close();
      apps = [{id:'messenger',name:'Messenger',url:'/messenger/',status:'running',system:false,source:'apps.json'}];
      await open(); await page.waitForTimeout(300);
      if (stale) {
        assert.equal(await tile.count(),0,'baseline must reproduce missing visible tile');
        console.log(JSON.stringify({shell:mobile?'mobile':'desktop',reproduced_stale:true,calls,blockedWrites}));
      } else {
        await tile.waitFor({state:'visible',timeout:10000}).catch(async e => { console.log('Failed picker', JSON.stringify({mobile,calls,dom:await page.evaluate(()=>({body:document.querySelector('#launcherBody')?.textContent.slice(0,700),pal:document.querySelector('#palList')?.textContent.slice(0,700),launcher:document.querySelector('#launcher')?.className,skin:document.documentElement.dataset.skin,mine:document.documentElement.dataset.mine}))})); throw e; });
        assert.equal(await tile.count(),1);
        await close();
        apps.push({id:'fixture-focus',name:'Focus fixture',url:'/fixture-focus/'});
        // Window focus without a visibilitychange: the desktop remained visible.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(() => !!WizCore.apps('desktop').APP['fixture-focus']);
        failure = true;
        await open(); await page.evaluate(() => WizCore.refreshApps());
        await tile.waitFor({state:'visible',timeout:10000}).catch(async e => { console.log('Failed picker', JSON.stringify({mobile,calls,dom:await page.evaluate(()=>({body:document.querySelector('#launcherBody')?.textContent.slice(0,700),pal:document.querySelector('#palList')?.textContent.slice(0,700),launcher:document.querySelector('#launcher')?.className,skin:document.documentElement.dataset.skin,mine:document.documentElement.dataset.mine}))})); throw e; });
        assert.equal(await tile.count(),1,'failed fetch preserves existing visible tile');
        failure = false; delay = 200;
        const before = calls;
        await page.evaluate(async () => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
          await Promise.all([WizCore.refreshApps(),WizCore.refreshApps()]);
        });
        assert.equal(calls,before+1,'overlapping focus/visibility/explicit requests coalesce');
        assert.equal(blockedWrites.filter(u => /\/api\/sessions|\/runs/.test(u)).length,0);
        console.log(JSON.stringify({shell:mobile?'mobile':'desktop',visible_messenger:true,focus_refresh:true,failure_preserved:true,deduped:true,blockedWrites}));
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e);process.exitCode=1; });
