// QA: "Wizard apps" → "agent apps" (launch prep, 23 Oct 2026). Screenless apps an agent uses are "Agent apps";
// apps with a screen are plain "Apps". Checks the Apps sheet (stock skin and Miguel's kinds skin, "For agents"
// opened) and an agent's page (Apps / Agent apps sections, the Add app sheet) on two skins, and that no visible
// text says "Wizard app(s)". Screenshots to QA_OUT.
// Usage: QA_OUT=<dir> node qa-agent-apps-term.cjs http://127.0.0.1:9742/wizard-os-home/   (tools/agents-fixture.mjs)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9742/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const OUT = process.env.QA_OUT || 'qa-agent-apps-term-out'; fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, label, d = '') => { if (v) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, String(d).slice(0, 300)); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const WIZ = /wizard apps?\b/i;
const APPS = { apps: [
  { id: 'meeting-recorder', name: 'Meeting Recorder', url: '/__fixture/apps/meeting-recorder/', desc: 'Records meetings', source: 'apps.json' },
  { id: 'transcriber', name: 'Transcriber', url: '', desc: 'Speech to text for your agent', source: 'apps.json', system: true },
  { id: 'browser', name: 'Browser', url: '', desc: 'A web browser your agent drives', source: 'apps.json', system: true },
] };

async function page(b, skin, mobile = true) {
  const c = await b.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await c.addInitScript(([s, A]) => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); if (s) localStorage.setItem('wos.skin', s); localStorage.setItem('wux.apps.v1', JSON.stringify(A.apps.filter(a => a.url))); localStorage.setItem('wux.apps.backend.v1', JSON.stringify(A.apps.filter(a => !a.url))); } catch (e) {} }, [skin, APPS]);
  await c.route('**/*', r => {
    const u = r.request().url();
    if (!u.startsWith(ORIGIN)) return r.fulfill({ status: 204, body: '' });
    if (/\/wizard\/v1\/apps(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPS) });
    return r.continue();
  });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE, { waitUntil: 'load' }); await wait(2500);
  return { c, p, errs };
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') }).then(() => console.log('SHOT', path.join(OUT, n + '.png')));

(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  try {
    for (const skin of ['', 'obsidian']) {
      const tag = skin || 'nebula';
      const { c, p, errs } = await page(b, skin);
      const worn = await p.evaluate(() => document.documentElement.dataset.skin || ''); ok(skin ? worn === skin : !['obsidian', 'obsidian-light', 'landscapes'].includes(worn), `${tag}: skin worn`, worn);
      // ---- Apps sheet ----
      await p.evaluate(() => __wos.openSheet('launcher')); await wait(700);
      const heads = await p.$$eval('#launcherBody .lgroup h4', hs => hs.map(h => h.firstChild.textContent.trim()));
      if (skin === 'obsidian') {
        await p.locator('#launcherBody [data-fatoggle]').click(); await wait(500);
        const h2 = await p.$$eval('#launcherBody .lgroup h4', hs => hs.map(h => h.textContent.trim()));
        ok(h2.includes('Agent apps'), `${tag}: For agents holds an "Agent apps" group`, JSON.stringify(h2));
        ok(await p.locator('#launcherBody .kg-wiz [data-appinfo="transcriber"]').count() === 1, `${tag}: screenless Transcriber sits under Agent apps`);
        await p.locator('#launcherBody .kg-wiz').scrollIntoViewIfNeeded().catch(() => {});
      } else {
        ok(heads.includes('Apps'), `${tag}: the screen-apps group is called "Apps"`, JSON.stringify(heads));
      }
      const lt = await p.locator('#launcherBody').innerText();
      ok(!WIZ.test(lt), `${tag}: Apps sheet never says "Wizard app(s)"`, lt.match(WIZ)?.[0]);
      await wait(600); await shot(p, `${tag}-apps-sheet`);
      await p.evaluate(() => __wos.closeSheets(true)); await wait(300);
      // ---- Agents → an agent's page ----
      if (await p.locator('.home-tools [data-act="agents"]').isVisible().catch(() => false)) await p.locator('.home-tools [data-act="agents"]').click(); else await p.evaluate(() => window.WizOpenApp('agents'));
      const f = await (await p.waitForSelector('iframe[title="Agents"]', { timeout: 15000 })).contentFrame();
      await f.waitForSelector('.ag-row', { timeout: 15000 }); await wait(500);
      ok(!WIZ.test(await f.locator('.ag').innerText()), `${tag}: Agents list never says "Wizard app(s)"`);
      await shot(p, `${tag}-agents-list`);
      // A non-main agent has the editable app sections; make one if the fixture has none.
      let row = f.locator('.ag-row').filter({ hasNotText: 'Main agent' }).first();
      if (!(await row.count())) {
        await f.locator('[data-new]').click(); await f.locator('#agName').fill('Helper'); await f.locator('[data-next]').click(); await wait(200);
        await f.locator('.ag-choice[data-pick="provider"][data-v="tinfoil"]').click(); await wait(200); // step 2 needs a provider
        await f.locator('[data-next]').click(); await wait(200); await f.locator('[data-create]').click(); await f.waitForSelector('.ag-hero', { timeout: 8000 });
      } else { await row.click(); await f.waitForSelector('.ag-hero', { timeout: 8000 }); }
      await wait(400);
      const secs = await f.$$eval('.ag-sec', s => s.map(x => x.firstChild.textContent.trim()));
      ok(secs.includes('Apps') && secs.includes('Agent apps'), `${tag}: agent page shows "Apps" and "Agent apps" sections`, JSON.stringify(secs));
      const addBtn = f.locator('[data-add="wizard"]');
      ok(await addBtn.count() === 1 && (await addBtn.innerText()).trim() === 'Add app', `${tag}: button reads "Add app"`, await addBtn.innerText().catch(() => ''));
      ok(!WIZ.test(await f.locator('.ag').innerText()), `${tag}: agent page never says "Wizard app(s)"`, (await f.locator('.ag').innerText()).match(WIZ)?.[0]);
      await addBtn.scrollIntoViewIfNeeded(); await wait(300); await shot(p, `${tag}-agent-page`);
      await addBtn.click(); await wait(400);
      const sheet = await f.locator('body').innerText();
      ok(/Add app/.test(sheet) && /Apps have their own screen/.test(sheet) && !WIZ.test(sheet), `${tag}: Add app sheet title and note`, sheet.match(WIZ)?.[0]);
      await shot(p, `${tag}-add-app-sheet`);
      ok(!errs.length, `${tag}: no page errors`, errs.join(' | '));
      await c.close();
    }
  } catch (e) { ok(false, 'run threw ' + e.message); }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
