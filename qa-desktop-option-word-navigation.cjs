'use strict';
// Exact-source synthetic browser acceptance; only the admitted forum runner executes it.
const { chromium } = require('./tools/qa-playwright.cjs');
const { ownerRead } = require('./tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(process.env.QA_SOURCE_ROOT || __dirname);
const out = process.env.QA_OUT; assert.ok(out, 'QA_OUT required'); fs.mkdirSync(out, { recursive: true });
const origin = 'http://127.0.0.1:18791', prefix = '/wizard-os-home/';
const report = { results: [], writes: [], foreign: [], runs: [], errors: [], assets: [] };
const now = Date.now(), ids = ['qa_option_one', 'qa_option_two'];
const sessions = ids.map((id, i) => ({ id, title: 'Synthetic shortcut thread ' + (i + 1), status: 'completed', message_count: 2,
  last_active: new Date(now - i * 60000).toISOString(), wizard_last_assistant_at: new Date(now - i * 60000).toISOString(), latest_message: { role: 'assistant', content: 'Synthetic answer.', timestamp: now / 1000 } }));
function save() { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2)); }
function actionWrites() { return report.writes.filter(r => r.path === '/wizard/thread-dispositions' || r.path === '/wizard/v1/boomerangs').length; }
async function check(name, p, fn) {
  try { await fn(); report.results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { report.results.push({ name, pass: false, error: String(e), stack: e.stack }); console.log('FAIL', name, String(e)); await p.screenshot({ path: path.join(out, name.replace(/[^a-z0-9]/gi, '-') + '.png') }).catch(() => {}); }
  finally {
    await p.keyboard.up('Alt').catch(() => {});
    // Reset only via the real sheet close control so a negative-control failure cannot poison later cases.
    const close = p.locator('.boom-sheet:visible [data-boom-close]');
    if (await close.count()) await close.first().click({ timeout: 1500 }).catch(() => {});
  }
  save();
}
async function open(p) {
  await p.evaluate(id => __wux.openThread(id), ids[0]);
  await p.waitForFunction(id => Object.values(__wux.wins).some(w => w.thread === id), ids[0]);
  await p.locator('.ch-compose textarea:visible').first().waitFor();
}
async function arrow(p, code) {
  await p.evaluate(() => { window.qaArrowEvents = []; });
  await p.keyboard.press('Alt+' + code);
  return p.evaluate(() => window.qaArrowEvents);
}
(async () => {
 const b = await chromium.launch({ executablePath: process.env.QA_CHROME, args: ['--no-sandbox', '--use-gl=swiftshader'] });
 try { for (const view of ['classic', 'ai-apps']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await ctx.routeWebSocket('**/*', ws => ws.close());
  await ctx.addInitScript(view => {
    for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': view, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
    document.addEventListener('keydown', e => { if (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.code)) (window.qaArrowEvents ||= []).push({ code: e.code, prevented: e.defaultPrevented, trusted: e.isTrusted }); });
  }, view);
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method();
    if (u.origin !== origin) { report.foreign.push(u.href); return r.abort(); }
    const json = value => r.fulfill({ json: value });
    if (/\/v1\/runs(?:\/|$)/.test(u.pathname) || (method === 'POST' && /\/api\/sessions(?:\/|$)/.test(u.pathname))) { report.runs.push(method + ' ' + u.pathname); return r.abort(); }
    if (!['GET', 'HEAD'].includes(method)) {
      report.writes.push({ method, path: u.pathname, body: q.postData(), view });
      // All writes are synthetic. There is no HTTP server or upstream connection.
      if (u.pathname === '/wizard/thread-seen') return json({ state: JSON.parse(q.postData() || '{}').state || { initializedAt: now, threads: {} } });
      return r.fulfill({ status: 403, json: { error: 'Synthetic QA refuses writes' } });
    }
    if (u.pathname.startsWith(prefix)) {
      const relative = u.pathname.slice(prefix.length) || 'desktop.html';
      if (/^(data|summaries)\.js$/.test(relative)) return r.fulfill({ contentType: 'application/javascript', body: '' });
      const file = path.resolve(root, 'web', relative), web = path.resolve(root, 'web');
      if (file.startsWith(web + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) { report.assets.push(relative); return r.fulfill({ path: file }); }
      return r.fulfill({ status: 404, body: 'Missing tracked fixture asset: ' + relative });
    }
    if (u.pathname === '/wizard/hermes/api/sessions') return json({ object: 'list', data: sessions, has_more: false, snapshot: 'synthetic-options' });
    const messages = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/(qa_option_one|qa_option_two)\/messages$/);
    if (messages) return json({ object: 'list', data: [{ id: 1, role: 'user', content: 'Synthetic question.', timestamp: now / 1000 - 60 }, { id: 2, role: 'assistant', content: 'Synthetic answer.', timestamp: now / 1000 }], pagination: { returned: 2 } });
    const session = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/(qa_option_one|qa_option_two)$/);
    if (session) return json({ session: sessions.find(s => s.id === session[1]) });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (u.pathname === '/wizard/v1/apps') return json({ apps: [] });
    if (u.pathname.startsWith('/wizard/')) return json(ownerRead(u.pathname));
    return r.fulfill({ status: 404, json: { error: 'Unregistered synthetic route' } });
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(7000); p.on('pageerror', e => report.errors.push({ view, error: e.message }));
  await p.goto(origin + prefix + 'desktop.html');
  await p.waitForFunction(() => window.__wux && !WosWelcome.active && !WosExperience.state.busy);
  if (view === 'ai-apps') await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop');
  for (const skin of ['nebula', 'grove']) {
    if (skin === 'grove') {
      await p.evaluate(() => __wux.openSettings('appearance'));
      const appearance = p.locator('[data-st-page="appearance"]'); if (await appearance.isVisible()) await appearance.click();
      await p.locator('[data-skinfamily="wizard"]').click(); await p.locator('[data-skinpick="grove"]').click();
      await p.evaluate(() => __wux.closeSettings());
      await p.waitForFunction(() => WosSkin.current === 'grove' && !WosExperience.state.busy);
    }
    const tag = view + '-' + skin;
    await check(tag + ' live skin and Appearance tokens', p, async () => {
      assert.equal(await p.evaluate(() => WosSkin.current), skin);
      assert.ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wz-panel').trim()));
      if (view === 'ai-apps') assert.equal(await p.evaluate(() => document.documentElement.dataset.aiApps), 'desktop');
    });
    for (const value of ['', '   ', 'alpha beta']) for (const code of ['ArrowLeft', 'ArrowRight']) {
      await check(tag + ' ' + code + ' composer=' + JSON.stringify(value), p, async () => {
        await open(p); const field = p.locator('.ch-compose textarea:visible').first(); await field.fill(value); await field.focus();
        const before = await p.evaluate(() => JSON.stringify(Object.values(__wux.wins).map(w => [w.id, w.thread]))), count = actionWrites();
        const events = await arrow(p, code);
        assert.deepEqual(events, [{ code, prevented: false, trusted: true }], 'trusted chord must bubble, unprevented');
        assert.equal(await field.inputValue(), value); assert.equal(await p.evaluate(() => JSON.stringify(Object.values(__wux.wins).map(w => [w.id, w.thread]))), before);
        assert.equal(await p.locator('.boom-sheet:visible').count(), 0); assert.equal(actionWrites(), count, 'no thread/disposition write');
      });
    }
    await check(tag + ' body focus and help hints', p, async () => {
      await open(p); await p.locator('.ch-compose textarea:visible').first().evaluate(n => n.blur());
      for (const code of ['ArrowLeft', 'ArrowRight']) assert.deepEqual(await arrow(p, code), [{ code, prevented: false, trusted: true }]);
      await p.keyboard.down('Alt'); await p.waitForTimeout(800);
      const hints = await p.locator('.kh-chip:visible').allTextContents();
      if (view === 'ai-apps') {
        const chips = await p.evaluate(() => WosSkinHost.keyChips().filter(h => h.el.matches?.('[data-chact="done"],[data-chact="snooze"]')).map(h => ({ action: h.el.dataset.chact, key: h.key })));
        assert.deepEqual(chips.sort((a, b) => a.action.localeCompare(b.action)), [{ action: 'done', key: 'E' }, { action: 'snooze', key: 'Z' }]);
      } else assert.ok(!hints.some(t => /^[←→]$/.test(t.trim())), JSON.stringify(hints));
      await p.screenshot({ path: path.join(out, tag + '-hints.png') }); await p.keyboard.up('Alt');
    });
    if (view === 'ai-apps') await check(tag + ' Z opens sheet, arrows never Someday, Z closes', p, async () => {
      await p.keyboard.up('Alt'); await open(p); await p.locator('.ch-compose textarea:visible').first().fill('');
      await p.locator('.ch-compose textarea:visible').first().evaluate(n => n.blur());
      await p.keyboard.press('Alt+KeyZ'); await p.locator('.boom-sheet:visible').waitFor();
      assert.ok(await p.locator('.boom-sheet:visible').evaluate(n => { const s = getComputedStyle(n); return s.opacity === '1' && !/rgba\([^)]*,\s*(?:0|0\.[0-9]+)\s*\)/.test(s.backgroundColor) && s.backgroundColor !== 'transparent'; }), 'text-bearing snooze panel is opaque');
      const count = actionWrites();
      for (const code of ['ArrowLeft', 'ArrowRight']) {
        assert.deepEqual(await arrow(p, code), [{ code, prevented: false, trusted: true }]);
        assert.equal(await p.locator('.boom-sheet:visible').count(), 1); assert.equal(actionWrites(), count);
      }
      await p.keyboard.down('Alt'); await p.waitForTimeout(800); await p.screenshot({ path: path.join(out, tag + '-snooze.png') }); await p.keyboard.up('Alt');
      await p.keyboard.press('Alt+KeyZ'); assert.equal(await p.locator('.boom-sheet:visible').count(), 0);
    });
  }
  await ctx.close();
 }
 assert.deepEqual(report.runs, [], 'zero agent runs'); assert.deepEqual(report.errors, [], 'no browser script errors');
 } finally { await b.close(); save(); }
 process.exitCode = report.results.some(r => !r.pass) ? 1 : 0;
})().catch(e => { report.fatal = { error: String(e), stack: e.stack }; save(); console.error(e); process.exitCode = 2; });
