/* Thales-only acceptance. Run via durable worker; never a local browser fallback.
 * QA_ORIGIN is the isolated read-only preview; QA_BASELINE is a read-only origin of the base SHA.
 * Ordinary GETs remain live. No existing thread is opened and every mutation is independently refused. */
'use strict';
const { chromium } = require('./qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const candidate = process.env.QA_ORIGIN, baseline = process.env.QA_BASELINE, out = process.env.QA_OUT;
if (!candidate || !baseline || !out) throw Error('Set QA_ORIGIN, QA_BASELINE, QA_OUT');
fs.mkdirSync(out, { recursive:true });
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.QA_CHROME ? { executablePath:process.env.QA_CHROME } : {}) });
  const results = [], allErrors = [], baselineNotes = [];
  try {
    for (const [name, origin, expected] of [['baseline',baseline,false],['candidate',candidate,true]]) {
      for (const shell of ['phone','desktop']) for (const skin of ['nebula','obsidian']) {
        if (process.env.QA_ONLY && !process.env.QA_ONLY.split(',').includes(name+'-'+shell+'-'+skin)) continue;
        const id = `${name}-${shell}-${skin}`, errors = [], blocked = [];
        const context = await browser.newContext({ viewport: shell === 'phone' ? {width:390,height:844} : {width:1440,height:1000}, isMobile:shell==='phone',hasTouch:shell==='phone',timezoneId:'Asia/Bangkok',serviceWorkers:'block' });
        await context.addInitScript(({ skin }) => { try { if (!sessionStorage.getItem('qa.seeded')) { localStorage.setItem('wos.skin',skin); localStorage.setItem('wos.tour.v1','true'); sessionStorage.setItem('qa.seeded','1'); } } catch (_) {} /* seed once: later picks must survive navigation */ /* sandboxed app frames have no storage */ }, {skin});
        await context.route('**/*', async route => {
          const q=route.request(), url=new URL(q.url());
          if (!['GET','HEAD'].includes(q.method())) { blocked.push({method:q.method(),path:url.pathname}); return route.fulfill({status:403,contentType:'application/json',body:'{"error":"QA blocks all writes"}'}); }
          // Baseline code comes from the exact base SHA, with the same live read-only data source.
          if (!expected && process.env.QA_BASELINE_WEB && url.pathname.startsWith('/wizard-os-home/')) {
            const rel=url.pathname.slice('/wizard-os-home/'.length)||'index.html', base=path.resolve(process.env.QA_BASELINE_WEB), file=path.resolve(base,rel);
            if (file.startsWith(base+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({path:file});
          }
          return route.continue();
        });
        const page = await context.newPage(); page.on('pageerror',e=>errors.push(String(e)));
        try {
          await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?view=skin&shell='+shell, {waitUntil:'domcontentloaded'});
          await page.waitForFunction(() => !!(window.__wos || window.__wux), null, {timeout:20000});
          await page.locator('[data-stgroup="look"]').waitFor({state:'visible',timeout:20000});
          if (expected) {
            // Picking Miguel's skin brings his tweaks; one disclosure under the picker lists them.
            await page.waitForFunction(()=>window.WosExperience && !window.WosExperience.state.busy);
            await page.locator('[data-skinfamily="mizel"]').click();
            await page.locator('[data-skinpick="obsidian"]').click();
            await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosExperience.state.active.length===7, null,{timeout:25000});
            assert.equal(await page.locator('[data-experience]').count(),0);
            await page.locator('[data-tweakset] > summary').click();
            assert.equal(await page.locator('[data-tweak-toggle]').count(),7);
            const ids=await page.locator('[data-tweak-toggle]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tweakToggle));
            for (const tweak of ids) {
              await page.locator(`[data-tweak-toggle="${tweak}"]`).click();
              await page.waitForFunction(id=>!window.WosExperience.state.busy && !window.WosExperience.state.active.includes(id),tweak);
              await page.locator(`[data-tweak-toggle="${tweak}"]`).click();
              await page.waitForFunction(id=>!window.WosExperience.state.busy && window.WosExperience.state.active.includes(id),tweak);
            }
            await page.screenshot({path:path.join(out,id+'-tweaks.png'),fullPage:true});
            // Leave his skin for the run's own skin unless it is his: tweaks follow the skin.
            if (skin!=='obsidian') {
              await page.locator('[data-skinfamily="wizard"]').click();
              await page.locator(`[data-skinpick="${skin}"]`).click();
              await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosExperience.state.active.length===0);
              assert.equal(await page.locator('[data-tweak-toggle="wizard/two-orbs"]').getAttribute('aria-checked'),'false');
              await page.locator('[data-skinfamily="mizel"]').click();
              await page.locator('[data-skinpick="obsidian"]').click();
              await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosExperience.state.active.length===7);
            }
            // Exercise the real shared model facade on the list without opening a private thread or sending.
            const shellPath=shell==='desktop'?'desktop.html':'';
            await page.goto(origin+'/wizard-os-home/'+shellPath+'?view=chats&shell='+shell,{waitUntil:'domcontentloaded'});
            await page.locator('[data-part="model-pills"] button').first().waitFor({state:'visible',timeout:20000});
            await page.locator('[data-part="model-pills"]').screenshot({path:path.join(out,id+'-model-pills.png')});
            await page.locator('[data-part="model-pills"] button').first().click();
            await page.waitForFunction(()=>document.querySelector('[data-part="model-pills"] [aria-pressed="true"]'));
            await page.goto(origin+'/wizard-os-home/'+shellPath+'?view=home&shell='+shell,{waitUntil:'domcontentloaded'});
            await page.locator('[data-home-resources] .rs-barsw').waitFor({state:'visible',timeout:20000});
            // Home repaints the live bars host while polling; re-resolve and retry instead of holding a stale node.
            for (let n=0;;n++) { try { await page.locator('[data-home-resources]').screenshot({path:path.join(out,id+'-resources.png'),timeout:5000}); break; } catch(e) { if (n>=3 || !/not attached/i.test(String(e))) throw e; await page.waitForTimeout(300); } }
            await page.goto(origin+'/wizard-os-home/'+shellPath+'?view=skin&shell='+shell,{waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>window.WosExperience && !window.WosExperience.state.busy);
            await page.locator('[data-skinfamily="wizard"]').click();
            await page.locator('[data-skinpick="nebula"]').click();
            await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosExperience.state.active.length===0);
            if (!await page.locator('[data-tweakset]').evaluate(n=>n.open)) await page.locator('[data-tweakset] > summary').click();
            await page.locator('[data-tweak-toggle="wizard/two-orbs"]').click();
            await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosSkinHost.layoutState.active && window.WosSkinHost.layout==='two-orb');
            await page.locator('[data-tweak-toggle="wizard/two-orbs"]').click();
            await page.waitForFunction(()=>!window.WosExperience.state.busy && window.WosSkinHost.layout==='classic');
            await page.screenshot({path:path.join(out,id+'-own.png'),fullPage:true});
          } else { assert.equal(await page.locator('[data-tweakset]').count(),0); await page.screenshot({path:path.join(out,id+'-look.png'),fullPage:true}); }
          // Real in-app nested Back. Keep Settings itself mounted; do not count a stable URL as proof.
          // Desktop shows the Settings index beside the page (no Back button); Back-never-exits is the phone contract.
          if (shell==='phone') { await page.locator('[data-st-back]:visible').click();
          await page.waitForFunction(()=>[...document.querySelectorAll('[data-settings-page]')].some(el=>el.dataset.settingsPage===''));}
          assert.ok(await page.evaluate(()=>!!(window.__wos||window.__wux)));
          assert.equal(errors.length,0,errors.join('\n'));
          results.push({id,pass:true,blocked,errors});
        } catch(e) { await page.screenshot({path:path.join(out,id+'-failure.png'),fullPage:true}).catch(()=>{}); results.push({id,pass:false,error:String(e),blocked,errors}); (expected?allErrors:baselineNotes).push(id+': '+String(e)); }
        finally { await context.close(); }
      }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,allErrors,baselineNotes},null,2)); }
  console.log(JSON.stringify({out,passed:results.filter(r=>r.pass).length,total:results.length,candidatePassed:results.filter(r=>r.pass&&r.id.startsWith('candidate')).length,allErrors,baselineNotes},null,2));
  if (allErrors.length) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
