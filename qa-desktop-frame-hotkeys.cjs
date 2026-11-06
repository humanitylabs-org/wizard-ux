'use strict';
// Sealed synthetic browser QA; run only through the forum heavy queue.
// No live API, owner app, history, message, provider, microphone or native bridge access.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, devices } = require('./tools/qa-playwright.cjs');
const { ownerRead, seedOwner, appScript } = require('./tools/qa-desktop-frame-fixture.cjs');
const TREE = process.env.QA_TREE || __dirname, OUT = process.env.QA_OUT;
assert(OUT, 'QA_OUT is mandatory'); fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://wizard.test', PREFIX = '/wizard-os-home/';
const report = { passed: [], failedCase: null, requests: [], writesRefused: [], errors: [], journal: [], source: process.env.QA_SOURCE_SHA || 'unbound' };
let active = 'setup', browser, page;
const check = async (name, fn) => { active = name; await snapshot(page, 'before: ' + name); await fn(); await snapshot(page, 'after: ' + name); report.passed.push(name); console.log('PASS', name); };
const appHTML = instrument => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic app</title>
<style>html{color-scheme:dark}body{background:var(--wz-base,#101018);color:var(--wz-ink,#f1f1fa);font:18px system-ui;padding:24px}input{display:block;background:var(--wz-panel,#20202c);color:inherit;padding:12px;width:80%;border:1px solid #777}</style>
<h1>Synthetic app — no private data</h1><input id="field" value="unsent fixture"><button id="appButton">App control</button>
<script>(${appScript.toString()})(${instrument});<\/script>`;
function staticFile(p) {
  if (!p.startsWith(PREFIX)) return null;
  const root = path.resolve(TREE, 'web'), file = path.resolve(root, decodeURIComponent(p.slice(PREFIX.length) || 'index.html'));
  return file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}
async function route(r, instrument = true) {
  const q = r.request(), u = new URL(q.url()); report.requests.push({ method: q.method(), url: q.url() });
  if (!['GET', 'HEAD'].includes(q.method())) { report.writesRefused.push({ method: q.method(), path: u.pathname }); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"isolated QA refuses every write"}' }); }
  if (u.origin !== ORIGIN) return r.abort('blockedbyclient');
  if (u.pathname === '/qa-desktop-frame/') return r.fulfill({ contentType: 'text/html', body: appHTML(instrument) });
  // All dynamic reads are synthetic, including aliases under the static prefix.
  if (/^\/wizard\//.test(u.pathname) || /^\/wizard-os-home\/(installed-apps|app-logos|api|store\/api)/.test(u.pathname)) {
    const body = ownerRead(u.pathname);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  }
  const file = staticFile(u.pathname);
  return file ? r.fulfill({ path: file }) : r.fulfill({ status: 404, body: '' });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function settle(p) {
  await p.waitForFunction(() => window.WosWelcome?.log.some(s => s.startsWith('boot:')) && !window.WosExperience?.state?.busy);
  const owner = await p.evaluate(() => ({ active: WosWelcome.active, log: WosWelcome.log, welcome: !!document.getElementById('wosWelcome'), state: localStorage.getItem('wos.welcome.v1') }));
  assert(owner.log.includes('boot:true:done:false'), JSON.stringify(owner));
  assert.equal(owner.active, false, 'real Welcome controller must be inactive'); assert.equal(owner.welcome, false); assert.equal(owner.state, 'done');
  await stable(p);
}
async function stable(p) {
  // Host-side polling; do not await mocked/never-finished page promises. Ignore
  // infinite scenery, but not actual finite desk/window/palette transitions.
  await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)));
}
async function snapshot(p, label) {
  if (!p) return null;
  const state = await p.evaluate(() => ({ welcome: window.WosWelcome?.active, welcomeLog: window.WosWelcome?.log, palMode: window.__wux?.palMode, cur: window.__wux?.cur, homeOpen: window.__wux?.homeOpen, ws: window.__wux?.ws, hasFocus: document.hasFocus(), active: document.activeElement?.outerHTML?.slice(0, 250), frames: [...document.querySelectorAll('.win[data-win^="fixture"] > .wbody iframe, .win[data-win^="fixture"] iframe')].map(f => { const d = f.contentDocument; return { win: f.closest('.win').dataset.win, src: f.src, hooked: !!d?.__wuxHooked, hasFocus: d?.hasFocus(), active: d?.activeElement?.id, loadId: f.contentWindow?.fixtureLoadId, bridge: f.contentWindow?.fixtureBridge, events: f.contentWindow?.fixtureEvents }; }) }));
  report.journal.push({ label, ...state }); fs.writeFileSync(path.join(OUT, 'journal.json'), JSON.stringify(report.journal, null, 2)); return state;
}
async function context(phone = false, instrument = true) {
  const c = await browser.newContext({ ...(phone ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), serviceWorkers: 'allow', colorScheme: 'dark' });
  await c.addInitScript(require('./tools/qa-no-service-workers.cjs').blockServiceWorkerRegistration);
  await c.route('**/*', r => route(r, instrument));
  await c.routeWebSocket('**/*', ws => ws.close());
  await c.addInitScript(seedOwner, { phone });
  return c;
}
const field = (p, i) => p.frameLocator(`.win[data-win="fixture${i}"] iframe`).locator('#field');
const cur = p => p.evaluate(() => __wux.cur);
async function picker(p, chord, i = 0) {
  await stable(p); await field(p, i).focus(); await p.keyboard.press(chord);
  assert.equal(await p.evaluate(() => __wux.palMode), 'apps');
  await p.keyboard.press('Escape'); assert.equal(await p.evaluate(() => __wux.palMode), ''); await stable(p);
}
(async () => {
  try {
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking'] });
    const c = await context(); page = await c.newPage(); page.on('pageerror', e => report.errors.push(String(e)));
    await page.goto(ORIGIN + PREFIX + 'desktop.html');
    await page.waitForFunction(() => window.__wux && document.documentElement.dataset.shell === 'desktop'); await settle(page);
    await field(page, 0).waitFor();
    await check('REGRESSION: frame window capture cannot strand desktop switching', async () => {
      await field(page, 0).focus();
      const before = await snapshot(page, 'regression: focused before trusted chord');
      assert.equal(before.welcome, false); assert.equal(before.cur, 0); assert.equal(before.homeOpen, false); assert.equal(before.palMode, '');
      const first = before.frames.find(f => f.win === 'fixture0'); assert(first.hooked && first.hasFocus && first.active === 'field', JSON.stringify(first));
      assert.equal(first.bridge.registrations.filter(r => r.type === 'keydown').length, 1);
      await page.keyboard.press('Alt+2');
      const after = await snapshot(page, 'regression: after trusted chord');
      const app = after.frames.find(f => f.win === 'fixture0');
      assert.equal(app.events.filter(e => e.type === 'keydown' && e.code === 'Digit2' && e.trusted).length, 1, 'trusted chord must reach the app');
      const forwards = app.bridge.calls.filter(e => e.type === 'keydown' && e.code === 'Digit2' && e.trusted);
      if (process.env.QA_NEGATIVE_CONTROL === '1') { assert.equal(forwards.length, 0, 'baseline Document adapter must specifically be stranded'); assert.equal(after.welcome, false); }
      else assert.equal(forwards.length, 1, 'candidate forwards the original trusted event once');
      assert.equal(await cur(page), 1, 'Alt+2 from focused app input must switch without a desktop click');
    });
    // Baseline must reach this exact oracle and fail there, not merely fail startup.
    if (process.env.QA_NEGATIVE_CONTROL === '1') throw Error('Original code unexpectedly passed the regression');
    await check('same event reaches shell once; app window state and unsent text persist', async () => {
      await page.keyboard.press('Alt+1'); await stable(page); await field(page, 0).fill('keep my unsent text');
      await page.keyboard.press('Alt+]'); assert.equal(await cur(page), 1, 'one next-window chord must move one desktop, not skip to desktop 3');
      await stable(page); await field(page, 1).focus(); await page.keyboard.press('Alt+['); assert.equal(await cur(page), 0); assert.equal(await page.evaluate(() => __wux.homeOpen), false, 'duplicate previous dispatch would reach Home');
      assert.equal(await field(page, 0).inputValue(), 'keep my unsent text');
      await stable(page); await field(page, 0).focus(); await page.keyboard.press('Alt+2'); await stable(page);
    });
    await check('open-app chords work in app input, without clicking desktop', async () => {
      await picker(page, 'Alt+o', 1); // onKey reserves Ctrl/Meta for the OS; native Menu is a separate bridge.
    });
    await check('app typing, select-all and ordinary arrows retain app ownership', async () => {
      await field(page, 1).focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('still typing'); await page.keyboard.press('ArrowLeft');
      assert.equal(await field(page, 1).inputValue(), 'still typing'); assert.equal(await cur(page), 1); assert.equal(await page.evaluate(() => __wux.palMode), '');
    });
    await check('repeated desk switches and picker navigation never need a desk click', async () => {
      for (let i = 0; i < 8; i++) {
        const from = await cur(page), next = from === 0 ? 1 : 0;
        await stable(page); await field(page, from).focus(); await page.keyboard.press(from === 0 ? 'Alt+]' : 'Alt+[');
        assert.equal(await cur(page), next); assert.equal(await page.evaluate(() => __wux.homeOpen), false);
        await picker(page, 'Alt+o', next);
      }
    });
    await check('keydown, keyup and frame blur clear held modifiers and key hints', async () => {
      const i = await cur(page); await field(page, i).focus(); await page.keyboard.down('Alt'); await wait(400);
      assert.equal(await page.locator('#keyHints').isVisible(), true); await page.keyboard.up('Alt'); assert.equal(await page.locator('#keyHints').isVisible(), false);
      await page.keyboard.down('Alt'); await wait(400); assert.equal(await page.locator('#keyHints').isVisible(), true);
      await page.locator('#searchBtn').focus(); assert.equal(await page.locator('#keyHints').isVisible(), false); await page.keyboard.up('Alt');
      await field(page, i).focus(); await page.keyboard.type('x'); assert.equal(await cur(page), i);
    });
    await check('autorepeat cannot toggle the app picker twice or create extra desktops', async () => {
      const i = await cur(page); await field(page, i).focus(); await page.keyboard.down('Alt'); await page.keyboard.down('o');
      assert.equal(await page.evaluate(() => __wux.palMode), 'apps'); await page.keyboard.down('o'); assert.equal(await page.evaluate(() => __wux.palMode), 'apps');
      await page.keyboard.up('o'); await page.keyboard.up('Alt'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => __wux.ws.length), 3);
    });
    await check('frame reload installs one fresh bridge', async () => {
      await page.keyboard.press('Alt+1'); await stable(page);
      const f = page.locator('.win[data-win="fixture0"] iframe'), id = await f.evaluate(f => f.contentWindow.fixtureLoadId);
      await field(page, 0).focus(); await page.keyboard.press('Alt+r');
      await page.waitForFunction(old => { const f = document.querySelector('.win[data-win="fixture0"] iframe'); return f?.contentWindow?.fixtureLoadId && f.contentWindow.fixtureLoadId !== old && f.contentDocument.__wuxHooked; }, id);
      const registrations = await f.evaluate(f => f.contentWindow.fixtureBridge.registrations);
      assert.equal(registrations.filter(r => r.type === 'keydown').length, 1); assert.equal(registrations.filter(r => r.type === 'keyup').length, 1);
      await field(page, 0).focus(); await page.keyboard.press('Alt+]'); assert.equal(await cur(page), 1);
    });
    await check('app stopImmediatePropagation retains ownership', async () => {
      await page.keyboard.press('Alt+1'); await stable(page);
      await field(page, 0).evaluate(n => { n.ownerDocument.defaultView.fixturePolicy = 'immediate'; });
      await field(page, 0).focus(); await page.keyboard.press('Alt+2'); assert.equal(await cur(page), 0);
      await field(page, 0).evaluate(n => { n.ownerDocument.defaultView.fixturePolicy = ''; });
      await page.keyboard.press('Alt+2'); assert.equal(await cur(page), 1);
    });
    await check('opaque/nested frames remain outside the shortcut bridge and cannot message-dispatch a chord', async () => {
      const before = await cur(page);
      await page.evaluate(() => { window.postMessage({ type: 'wizard:keydown', key: '3', altKey: true }, '*'); }); await wait(50); assert.equal(await cur(page), before);
      // A nested sandboxed document is not a shell-owned app frame. Its keys
      // must not gain shell authority, even though the QA driver can target it.
      const i = await cur(page), outer = page.locator(`.win[data-win="fixture${i}"] iframe`);
      for (const opaque of [false, true]) {
        await outer.evaluate((f, opaque) => { const n = f.contentDocument.createElement('iframe'); n.id = 'nested'; if (opaque) n.setAttribute('sandbox', 'allow-scripts'); n.srcdoc = '<input id="nestedField" value="synthetic nested text">'; f.contentDocument.body.append(n); }, opaque);
        const nested = page.frameLocator(`.win[data-win="fixture${i}"] iframe`).frameLocator('#nested').locator('#nestedField');
        await nested.focus(); await page.keyboard.press(before === 0 ? 'Alt+2' : 'Alt+1'); assert.equal(await cur(page), before);
        assert.equal(await outer.evaluate(f => f.contentDocument.querySelector('#nested').contentDocument === null), opaque);
        await outer.evaluate(f => f.contentDocument.querySelector('#nested').remove());
      }
      const code = fs.readFileSync(path.join(TREE, 'web/desktop/desktop.js'), 'utf8');
      const hook = code.slice(code.indexOf('  function watchFrame(f, el)'), code.indexOf('\n  function render()'));
      assert(!hook.includes('postMessage')); assert(!hook.includes('querySelectorAll'));
    });
    await check('shell release reload preserves desks and established-owner boot', async () => {
      const before = await page.evaluate(() => ({ ws: __wux.ws, cur: __wux.cur }));
      await page.reload(); await page.waitForFunction(() => window.__wux?.ws.length === 3); await settle(page);
      assert.deepEqual(await page.evaluate(() => ({ ws: __wux.ws, cur: __wux.cur })), before);
      await field(page, before.cur).waitFor(); await picker(page, 'Alt+o', before.cur);
    });
    for (const skin of ['nebula', 'landscapes']) await check('in-shell skin proof and opaque picker: ' + skin, async () => {
      const i = await cur(page); await field(page, i).fill('skin change keeps this unsent text');
      await page.locator('#settingsBtn').click(); await page.locator('#dsettings [data-st-page="appearance"]').click();
      await page.locator(`#dsettings [data-skinfamily="${skin === 'nebula' ? 'wizard' : 'mizel'}"]`).click();
      await page.locator(`#dsettings [data-skinpick="${skin}"]`).click();
      await page.waitForFunction(skin => WosSkin.current === skin && !document.querySelector('#dsettings [aria-busy="true"]') && !window.WosExperience?.state?.busy, skin);
      await page.locator('.mz-intro').waitFor({ state: 'detached' }); await stable(page);
      assert.equal(await page.locator(`#dsettings [data-skinpick="${skin}"]`).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: path.join(OUT, 'settings-' + skin + '.png'), animations: 'disabled', caret: 'hide' });
      await page.keyboard.press('Alt+,'); await stable(page);
      assert.equal(await field(page, i).inputValue(), 'skin change keeps this unsent text');
      await field(page, i).focus(); await page.keyboard.press('Alt+o'); await stable(page);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
      await page.screenshot({ path: path.join(OUT, 'desktop-' + skin + '.png'), animations: 'disabled', caret: 'hide' });
      const card = page.locator('.pal-card'); const box = await card.boundingBox(); assert(box);
      const clip = { x: Math.ceil(box.x + 16), y: Math.ceil(box.y + 16), width: Math.floor(box.width - 32), height: Math.floor(box.height - 32) };
      const before = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      await page.evaluate(() => { const n = document.createElement('div'); n.id = 'qa-noise'; n.textContent = 'LOUD BACKGROUND TEXT '.repeat(2000); n.style.cssText = 'position:fixed;inset:0;z-index:1;background:red;color:lime;font:40px monospace;pointer-events:none'; document.body.append(n); });
      const noisy = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }); fs.writeFileSync(path.join(OUT, skin + '-panel-clear.png'), before); fs.writeFileSync(path.join(OUT, skin + '-panel-noisy.png'), noisy);
      await page.evaluate(() => document.getElementById('qa-noise').remove()); assert(before.equals(noisy), 'picker text panel must paint identically over loud text'); await page.keyboard.press('Escape');
    });
    await check('uninstrumented app still supports trusted desktop and picker chords', async () => {
      const uc = await context(false, false), p = await uc.newPage(); p.on('pageerror', e => report.errors.push('uninstrumented: ' + String(e)));
      try {
        await p.goto(ORIGIN + PREFIX + 'desktop.html'); await p.waitForFunction(() => window.__wux?.ws.length === 3); await settle(p);
        await field(p, 0).waitFor(); await field(p, 0).focus(); await p.keyboard.press('Alt+2'); assert.equal(await cur(p), 1);
        await picker(p, 'Alt+o', 1); await snapshot(p, 'uninstrumented trusted proof');
      } finally { await uc.close(); }
    });
    await check('phone shell boots with the same exact candidate sources', async () => {
      const pc = await context(true), p = await pc.newPage(); p.on('pageerror', e => report.errors.push('phone: ' + String(e)));
      await p.goto(ORIGIN + PREFIX); await p.waitForFunction(() => window.__wos && document.documentElement.dataset.shell !== 'desktop'); await settle(p);
      await p.screenshot({ path: path.join(OUT, 'phone-boot.png'), animations: 'disabled' }); await pc.close();
    });
    await check('standalone synthetic app fallback is dark and still editable', async () => {
      const p = await c.newPage(); await p.goto(ORIGIN + '/qa-desktop-frame/'); await p.locator('#field').fill('standalone unsent text');
      assert.equal(await p.locator('body').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(16, 16, 24)');
      await p.screenshot({ path: path.join(OUT, 'fixture-standalone-dark.png') }); await p.close();
    });
    await check('zero uncaught page exceptions', async () => assert.deepEqual(report.errors, []));
  } catch (e) {
    report.failedCase = active; report.failure = String(e.stack || e); console.error('FAIL', active, e);
    if (page) await snapshot(page, 'FAIL: ' + active).catch(e => { report.diagnosticError = String(e); });
    if (page) await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)); if (browser) await browser.close();
  }
})();
