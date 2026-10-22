// Candidate-only own-screen QA, phone touch + desktop. No production calls or writes.
// PW=<playwright module> QA_APP_VIEWS_MODULE=<companion server/app-views.mjs>
// QA_CHROME=<optional Chrome binary> QA_OUT=<evidence dir> node qa-own-views.cjs
// Starts tools/qa-origin.cjs over this worktree. Registry is mocked from the real
// companion reader; own assets use its real serving function and temporary fixtures.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'own-view-qa'); fs.mkdirSync(OUT, { recursive:true });
const PORT = Number(process.env.QA_PORT || 9398), origin = `http://127.0.0.1:${PORT}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'own-view-fixtures-'));
const appsJsonPath = path.join(scratch, 'apps.json');
const ids = ['original-app', 'own-app', 'broken-app'];
const apps = ids.map(id => ({ id, name:id, status:'running', view:{ url:`/qa-apps/${id}/` } }));
fs.writeFileSync(appsJsonPath, JSON.stringify({ apps }));
for (const id of ids.slice(1)) {
  const root = path.join(scratch, 'views', id), build = path.join(root, 'builds', 'a'.repeat(64));
  fs.mkdirSync(build, { recursive:true });
  fs.writeFileSync(path.join(root, 'view.json'), JSON.stringify({ mode:'own', active:true, serving:'a'.repeat(64) }));
  fs.writeFileSync(path.join(build, '.ok'), '{}');
  fs.writeFileSync(path.join(build, 'index.html'), html(id, true));
}
function html(id, own = false) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${id}</title><style>html{color-scheme:dark}body{background:transparent;color:var(--wz-text);font-family:system-ui;padding:24px}input{background:var(--wz-surface);color:var(--wz-text);border:1px solid var(--wz-border);padding:12px}</style><script src="/wizard-os-home/core/app-client.js"></script>${id === 'broken-app' && own ? '<script src="missing.js"></script>' : ''}</head><body><h1>${own ? 'Your' : 'Original'} screen</h1><input id="draft" value="Unsent work"></body></html>`;
}
let passed = 0;
const ok = (c, label) => { assert.ok(c, label); console.log('PASS', label); passed++; };
(async () => {
  const source = process.env.QA_APP_VIEWS_MODULE; assert.ok(source, 'set QA_APP_VIEWS_MODULE to companion source');
  const { serveAppView } = await import(pathToFileURL(source));
  const { readApps } = await import(pathToFileURL(path.join(path.dirname(source), 'wizard-os-settings.mjs')));
  const server = spawn(process.execPath, ['tools/qa-origin.cjs', String(PORT), path.join(__dirname, 'web')], { cwd:__dirname, stdio:['ignore','pipe','inherit'] });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', c => reject(new Error('origin exited ' + c))); });
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.QA_CHROME ? { executablePath:process.env.QA_CHROME } : {}) });
    for (const phone of [true, false]) {
      const mode = phone ? 'phone' : 'desktop', shell = phone ? '__wos' : '__wux';
      const context = await browser.newContext({ viewport:phone ? { width:412, height:892 } : { width:1440, height:900 }, hasTouch:phone, isMobile:phone, ...(phone ? { userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' } : {}), serviceWorkers:'block' });
      const writes = [], errors = [];
      await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        const send = (body, contentType = 'application/json', status = 200) => route.fulfill({ status, contentType, body:typeof body === 'string' ? body : JSON.stringify(body) });
        if (req.method() !== 'GET') { writes.push(req.method() + ' ' + u.pathname); return send({ error:'qa refuses writes' }, 'application/json', 403); }
        if (u.origin !== origin) return send({}, 'application/json', 403);
        if (u.pathname.startsWith('/wizard/views/')) {
          let result;
          serveAppView({ method:'GET' }, { writeHead:(status, headers) => result = { status, headers }, end:body => result.body = body || '' }, u, { appsJsonPath, apps:readApps({ appsJsonPath, launcherPath:'' }).apps });
          return route.fulfill(result);
        }
        if (u.pathname.startsWith('/qa-apps/')) return send(html(u.pathname.split('/')[2]), 'text/html');
        if (u.pathname === '/wizard/v1/apps') return send(readApps({ appsJsonPath, launcherPath:'' }));
        if (u.pathname === '/wizard/v1/bootstrap') return send({ bootstrap:1, endpoints:{ apps:'/wizard/v1/apps' }, settings:{ agent:{ name:'Fixture Wizard' } }, capabilities:{} });
        if (u.pathname === '/wizard/hermes/api/sessions') return send({ data:[], has_more:false });
        if (u.pathname.endsWith('/thread-seen')) return send({ state:{ initializedAt:Date.now(), threads:{} } });
        if (u.pathname.endsWith('/thread-dispositions')) return send({ state:{} });
        if (u.pathname.startsWith('/wizard/')) return send({});
        if (/\/(data|summaries)\.js$/.test(u.pathname)) return send('', 'application/javascript');
        if (u.pathname.endsWith('/ux-changes.json')) return send([]);
        if (u.pathname.endsWith('/ux-version.txt')) return send('qa-own-view', 'text/plain');
        if (u.pathname.includes('/store-data/')) return send({});
        if (u.pathname.includes('/store-install/')) return send({}, 'application/json', 404);
        if (u.pathname.startsWith('/api/')) return send({});
        return route.continue();
      });
      await context.addInitScript(() => { if (parent === window) { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
      await page.goto(origin + '/wizard-os-home/' + (phone ? '?shell=phone&open=original-app' : 'desktop.html?shell=desktop&open=original-app'), { waitUntil:'domcontentloaded', timeout:45000 });
      await page.waitForFunction(s => !!window[s], shell).catch(async error => {
        console.log('STARTUP', JSON.stringify({ errors, state:await page.evaluate(() => ({ ready:document.readyState, scripts:[...document.scripts].map(s => s.src), shell:document.documentElement.dataset.shell, body:document.body.innerText.slice(0,400) })) }));
        await page.screenshot({ path:path.join(OUT, mode + '-startup-failure.png') }); throw error;
      }); await page.evaluate(() => WizCore.appsLoaded());
      const frame = id => page.locator(`iframe[data-own-app="${id}"]`);
      const tap = e => phone ? e.tap() : e.click();
      const openFromLauncher = async id => {
        await page.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=apps'));
        const tile = phone ? page.locator(`.lapp[data-app="${id}"]`).last() : page.locator('.pal-app').filter({ hasText:id });
        await tile.waitFor({ state:'visible' }); await tap(tile);
      };
      await frame('original-app').waitFor();
      ok(await frame('original-app').getAttribute('src') === '/qa-apps/original-app/', mode + ': deep link opens original URL');
      await openFromLauncher('own-app');
      await frame('own-app').waitFor();
      await page.waitForFunction(() => document.querySelector('iframe[data-own-app="own-app"]')?.dataset.ownReady === 'true');
      ok(await frame('own-app').getAttribute('src') === '/wizard/views/own-app/', mode + ': own mode opens views URL');
      const marker = page.locator('[data-own-original="own-app"]').first();
      ok(await marker.isVisible(), mode + ': Your version marker visible');
      const ownFrame = page.frames().find(f => f.url() === origin + '/wizard/views/own-app/');
      await ownFrame.waitForFunction(() => window.WizardApp?.hosted);
      await ownFrame.locator('#draft').fill('Keep this unsent');
      const identity = await ownFrame.evaluate(() => { window.qaIdentity = 'same-document'; return window.qaIdentity; });
      for (const skin of ['nebula', 'obsidian-light']) {
        await page.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin'));
        const familyId = await page.evaluate(s => WosSkin.familyOf(s), skin);
        const family = page.locator(`[data-skinfamily="${familyId}"]`);
        if (phone) await family.tap(); else await family.click();
        const palette = page.locator(`[data-skinpick="${skin}"]`);
        if (phone) await palette.tap(); else await palette.click();
        const close = page.locator(phone ? '#settings [data-stclose]' : '#dsettings [data-close]');
        if (phone) await close.tap(); else await close.click();
        await page.waitForFunction(s => document.querySelector('iframe[data-own-app="own-app"]')?.contentDocument?.documentElement.dataset.skin === s, skin);
        await page.waitForTimeout(3500); // the skin package's branded intro must finish
        const state = await ownFrame.evaluate(() => ({ skin:document.documentElement.dataset.skin, scheme:getComputedStyle(document.documentElement).colorScheme, text:getComputedStyle(document.body).color, canvas:getComputedStyle(document.body).backgroundColor, identity:window.qaIdentity, draft:document.querySelector('#draft').value }));
        ok(state.skin === skin && state.scheme === (skin === 'obsidian-light' ? 'light' : 'dark') && state.canvas === 'rgba(0, 0, 0, 0)' && state.identity === identity && state.draft === 'Keep this unsent', mode + ': Appearance v1 ' + skin + ' live, transparent, draft and document kept');
        await page.screenshot({ path:path.join(OUT, `${mode}-${skin}.png`) });
      }
      await ownFrame.evaluate(() => { history.pushState({}, '', '#nested'); });
      await page.evaluate(() => history.back()); await page.waitForTimeout(300);
      ok((await frame('own-app').count()) === 1 && page.url().startsWith(origin + '/wizard-os-home/'), mode + ': browser Back from nested view never exits shell or closes app');
      await tap(marker);
      await page.locator('[data-own-confirm="own-app"]').waitFor({ state:'visible' });
      ok(writes.length === 0, mode + ': Use original routes to shell Settings confirmation without a write');
      await page.evaluate(() => { document.querySelector('[data-own-confirm="own-app"]').click(); window.postMessage({ type:'wizard:own-view:revert', app:'own-app' }, location.origin); });
      await page.waitForTimeout(150);
      ok(writes.length === 0, mode + ': synthetic click and iframe-style message cannot revert');
      // Existing shell Back owns the Settings sheet.
      await page.evaluate(() => history.back()); await page.waitForTimeout(250);
      // Simulate the registry read after CLI revert; actual WAM revert + publication is
      // exercised by its Python suite, while this browser lane remains GET-only.
      const activeFile = path.join(scratch, 'views/own-app/view.json');
      fs.writeFileSync(activeFile, JSON.stringify({ mode:'own', active:false, serving:'a'.repeat(64) }));
      await page.evaluate(() => WizCore.refreshApps());
      await page.waitForFunction(() => document.querySelector('iframe[data-own-app="own-app"]')?.getAttribute('src') === '/qa-apps/own-app/');
      ok(await page.locator('[data-own-original="own-app"]').count() === 0, mode + ': registry-confirmed revert restores original and removes marker');
      await openFromLauncher('broken-app');
      await page.waitForFunction(() => document.querySelector('iframe[data-own-app="broken-app"]')?.getAttribute('src') === '/qa-apps/broken-app/');
      const note = await page.locator('.own-view-note').last().textContent();
      ok(note.includes('missing.js') && note.includes('original screen'), mode + ': broken file named; original URL restored');
      await page.waitForTimeout(1200); // let the desk and original app finish painting
      const fallback = await page.evaluate(() => { const f = document.querySelector('iframe[data-own-app="broken-app"]'), d = f.contentDocument; return { themed:f.closest('.win').classList.contains('wz-themed'), scheme:getComputedStyle(f).colorScheme, docScheme:f.contentWindow.getComputedStyle(d.documentElement).colorScheme }; });
      ok(fallback.themed && fallback.scheme === fallback.docScheme, mode + ': original fallback keeps Appearance and matching canvas scheme');
      await page.screenshot({ path:path.join(OUT, `${mode}-broken.png`) });
      ok(writes.length === 0, mode + ': zero writes');
      ok(errors.length === 0, mode + ': no page errors ' + errors.join(' | '));
      await context.close();
      fs.writeFileSync(path.join(scratch, 'views/own-app/view.json'), JSON.stringify({ mode:'own', active:true, serving:'a'.repeat(64) }));
    }
    console.log(`\n${passed} pass, 0 fail · candidate fixtures, no live install · shots ${OUT}`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => fs.rmSync(scratch, { recursive:true, force:true }));
