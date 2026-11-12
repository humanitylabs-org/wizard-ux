'use strict';
// Narrow desktop, one app at a time (switch wizard/narrow-one-app, wizard-ux issue 1314), in a real browser. Synthetic
// origin, no owner reads or writes reach a box (the pane-layout harness's transport). AI apps desktop view on two skins.
// Per width (960, 640, 420): switch off = today's layout (QA_EXPECT=off for main); switch on = no left sidebar beside an
// app, the app fills the main area, Chats is the first row of the right Apps column above a divider, the split / pane
// modes are not offered; Chats at 960 = list beside the chat, narrower = list, then the chat with Back; Back from the list
// returns to the app; the app keeps its state (an unsent field) and the chat stays open across the switch.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://narrow.test';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'narrow-one-app-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(','), WIDTHS = (process.env.QA_WIDTHS || '960,640,420').split(',').map(Number);
const ON = process.env.QA_EXPECT !== 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString();
const ROWS = [['qa-a', 'Trip to Lisbon'], ['qa-b', 'Quarterly numbers'], ['qa-c', 'Dinner ideas']].map(([id, title], i) => ({ id, title, runtime: 'direct', status: 'completed',
  updated_at: iso(now - (i + 1) * 36e5), updatedAt: iso(now - (i + 1) * 36e5), last_active: (now - (i + 1) * 36e5) / 1000, message_count: 2, messageCount: 2, preview: 'Here you go.' }));
const box = (page, s) => page.evaluate(s => { const n = document.querySelector(s); if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); const cs = getComputedStyle(n); return cs.visibility === 'hidden' || cs.display === 'none' || !b.width ? null : { x: Math.round(b.x), w: Math.round(b.width) }; }, s);
const report = { web, on: ON, cases: [] };
(async () => {
  const browser = await chromium.launch();
  let page;
  try {
    for (const skin of SKINS) for (const W of WIDTHS) {
      const stem = `${skin}-${W}-${ON ? 'on' : 'off'}`, entry = { stem }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: W, height: 760 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [], writes = [];
      await context.routeWebSocket('**/*', ws => ws.close());
      const mix = ON ? { 'wizard/narrow-one-app': true } : {};
      await context.addInitScript(({ skin, mix }) => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
          'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
      }, { skin, mix });
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses all writes' } }); }
        if ([prefix + 'store/index.html', prefix + 'agents/index.html'].includes(u.pathname)) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{background:#fff;color:#111}</style><h1>Synthetic app</h1><input value="">' });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
        const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages/.exec(u.pathname);
        if (m) return r.fulfill({ json: { data: [{ id: 'u1', role: 'user', content: 'Plan it for ' + m[1], created_at: now / 1000 - 99 }, { id: 'a1', role: 'assistant', content: 'Done: a plan for ' + m[1] + '.', created_at: now / 1000 - 90 }], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) {
          const f = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
          if (abs.startsWith(web + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + prefix + 'desktop.html');
      await page.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy && document.querySelector('.ch-compose'));
      const settle = async () => { await page.waitForTimeout(350); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      const shot = async name => { await settle(); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
      const ds = () => page.evaluate(() => ({ ...document.documentElement.dataset }));
      await settle();
      entry.on = await page.evaluate(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/narrow-one-app'));
      await shot('1-home');
      // an app: the store, with an unsent word typed into it
      await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
      const store = page.frameLocator('iframe[src*="/store/index.html"]').locator('input');
      await store.waitFor(); await store.fill('unsent words');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split') || document.documentElement.dataset.aadOne === 'app');
      await shot('2-app');
      entry.app = { side: await box(page, '.aad-side'), app: await box(page, '#stage > .wsp[data-aad-role="app"]'), dock: await box(page, '.aad-vt'), chats: await box(page, '.aad-vt .aad-vchats'), modes: await box(page, '.aad-ptop .aad-modes'), ds: await ds() };
      if (ON) {
        assert.equal(entry.app.side, null, stem + ': no sidebar beside the app');
        assert.ok(entry.app.chats, stem + ': Chats row in the Apps column');
        assert.ok(entry.app.app && entry.app.app.x <= 1 && entry.app.app.x + entry.app.app.w === entry.app.dock.x, stem + ': the app fills the main area ' + JSON.stringify(entry.app));
        assert.equal(entry.app.modes, null, stem + ': no pane modes');
        assert.ok(await page.evaluate(() => { const c = document.querySelector('.aad-vt .aad-vchats'), s = c.nextElementSibling; return s && s.matches('hr.aad-vtsep') && c.closest('.aad-vt').querySelector('.aad-vchats, .aad-vtab') === c; }), stem + ': Chats first, a divider under it');
        // Chats: from the app, one tap
        await page.click('.aad-vt .aad-vchats');
        await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'chats');
        await shot('3-chats');
        entry.chats = { side: await box(page, '.aad-side'), list: await box(page, '.aad-side .aad-scroll'), ds: await ds() };
        assert.ok(entry.chats.side, stem + ': the chats list shows');
        await page.click('.aad-side .aad-row[data-id="qa-a"], .aad-side [data-sid="qa-a"]').catch(async () => { await page.evaluate(() => __wux.openThread('qa-a')); });
        await page.waitForFunction(() => /qa-a/.test(location.href + JSON.stringify(WizCore?.route?.() || '')) || document.querySelector('.ch-msgs') && document.body.innerText.includes('Done: a plan for qa-a'));
        await shot('4-thread');
        entry.thread = { side: await box(page, '.aad-side'), chat: await box(page, '#stage > .wsp[data-aad-role="chat"], #stage > .wsp:not([hidden]) .win .dchats'), back: await box(page, '.aad-oneback'), ds: await ds() };
        if (W >= 720) assert.ok(entry.thread.side, stem + ': list beside the chat at half width');
        else {
          assert.equal(entry.thread.side, null, stem + ': the chat alone when narrower');
          assert.ok(entry.thread.back, stem + ': a Back button on the thread');
          await page.click('.aad-oneback'); await settle();
          assert.ok(await box(page, '.aad-side'), stem + ': Back shows the list');
          await shot('5-list-again');
        }
        // Back from the list (or the app's row) returns to the app, its word still there
        await page.click('.aad-vt .aad-vtab[data-app="app-store"]');
        await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'app');
        assert.equal(await store.inputValue(), 'unsent words', stem + ': the app kept its state');
        await shot('6-app-again');
        await page.click('.aad-vt .aad-vchats');
        await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'chats');
        await settle();
        assert.ok(await page.evaluate(() => document.body.innerText.includes('Done: a plan for qa-a')) || W < 720, stem + ': the chat is still open');
        if (W < 720) { assert.ok(await box(page, '.aad-oneback'), stem + ': back on the open thread'); await page.click('.aad-oneback'); await settle(); }
        assert.ok(await box(page, '.aad-onelist'), stem + ': Back to the app from the list');
        await page.click('.aad-onelist');
        await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'app');
        await shot('7-back-to-app');
      }
      assert.deepEqual(errors, [], stem + ': page errors');
      entry.writes = writes;
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS narrow one-app', ON ? 'on' : 'off', SKINS.join(','), WIDTHS.join(','));
  } catch (e) { await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; }
  finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
