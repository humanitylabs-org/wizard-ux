'use strict';
// A narrower desktop window, one app at a time (James, 12 Nov 2026, the approved mockup), in a real browser. Synthetic
// origin, no owner reads or writes reach a box (the pane-layout harness's transport). AI apps desktop view on two skins.
// Per width: 1440 = today's layout (the Apps column at the right, no app bar). Under 1100: no left sidebar beside an app,
// the app fills the main area above the bottom app bar (Chats first, the orb at its centre, All apps last), the split /
// pane modes are not offered; one click Chats <-> the app; Chats from 680 = list beside the chat, narrower = list, then the
// chat with a visible Back (Esc the same; at the list it stays); the app keeps its state (an unsent field).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://narrow.test';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'one-app-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(','), WIDTHS = (process.env.QA_WIDTHS || '1440,900,720,600').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString();
const ROWS = [['qa-a', 'Trip to Lisbon'], ['qa-b', 'Quarterly numbers'], ['qa-c', 'Dinner ideas']].map(([id, title], i) => ({ id, title, runtime: 'direct', status: 'completed',
  updated_at: iso(now - (i + 1) * 36e5), updatedAt: iso(now - (i + 1) * 36e5), last_active: (now - (i + 1) * 36e5) / 1000, message_count: 2, messageCount: 2, preview: 'Here you go.' }));
const box = (page, s) => page.evaluate(s => { const n = document.querySelector(s); if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); const cs = getComputedStyle(n); return cs.visibility === 'hidden' || cs.display === 'none' || !b.width ? null : { x: Math.round(b.x), w: Math.round(b.width) }; }, s);
const report = { web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  let page;
  try {
    for (const skin of SKINS) for (const W of WIDTHS) {
      const ON = W < 1100, stem = `${skin}-${W}`, entry = { stem }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: W, height: 760 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [], writes = [];
      await context.routeWebSocket('**/*', ws => ws.close());
      const mix = {};
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
      await shot('1-home');
      // an app: the store, with an unsent word typed into it
      await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
      const store = page.frameLocator('iframe[src*="/store/index.html"]').locator('input');
      await store.waitFor(); await store.fill('unsent words');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split') || document.documentElement.dataset.aadOne === 'app');
      await shot('2-app');
      const vbox = s => page.evaluate(s => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(), cs = getComputedStyle(n); return cs.visibility === 'hidden' || !b.width ? null : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }, s);
      entry.app = { side: await box(page, '.aad-side'), app: await vbox('#stage > .wsp[data-aad-role="app"]'), dock: await vbox('.aad-vt'), chats: await vbox('.aad-vt .aad-vchats'), orb: await vbox('.aad-orb'), all: await vbox('.aad-vt .aad-vall'), modes: await box(page, '.aad-ptop .aad-modes'), ds: await ds() };
      if (!ON) {
        assert.equal(entry.app.ds.aadOne, undefined, stem + ': today\'s layout'); assert.notEqual(entry.app.ds.aadTabs, 'bar'); assert.equal(entry.app.chats, null, stem + ': no Chats item');
        assert.ok(entry.app.dock && entry.app.dock.x + entry.app.dock.w === W && entry.app.dock.h > 600, stem + ': the Apps column at the right');
      } else {
        assert.equal(entry.app.side, null, stem + ': no sidebar beside the app');
        assert.equal(entry.app.ds.aadTabs, 'bar'); assert.equal(entry.app.ds.aadDockEdge, 'bottom');
        const d = entry.app.dock, a = entry.app.app;
        assert.ok(d && d.x === 0 && d.w === W && d.y + d.h === 760 && d.h < 90, stem + ': the bar along the bottom ' + JSON.stringify(d));
        assert.ok(a && a.x <= 1 && a.x + a.w >= W - 1 && a.y + a.h <= d.y + 1, stem + ': the app fills the main area above the bar ' + JSON.stringify(entry.app));
        assert.ok(entry.app.chats && entry.app.all && entry.app.chats.x < entry.app.all.x, stem + ': Chats first, All apps last');
        const o = entry.app.orb; assert.ok(o && Math.abs(o.x + o.w / 2 - W / 2) <= 2 && o.y >= d.y - 2, stem + ': the orb at the bar\'s centre ' + JSON.stringify(o));
        assert.ok(await page.evaluate(() => [...document.querySelectorAll('.aad-vt .aad-vtab')].every(t => { const r = t.getBoundingClientRect(); return r.width > 20 && getComputedStyle(t).visibility !== 'hidden'; })), stem + ': every open app shows in the bar');
        assert.equal(entry.app.modes, null, stem + ': no pane modes');
        // Chats: from the app, one click, painted on the click's own frame
        const sameFrame = await page.evaluate(() => new Promise(res => { const c = document.querySelector('.aad-vt .aad-vchats'); c.click(); res(document.documentElement.dataset.aadOne); }));
        assert.equal(sameFrame, 'chats', stem + ': Chats in front on the same frame as the click');
        await shot('3-chats');
        entry.chats = { side: await box(page, '.aad-side'), list: await box(page, '.aad-side .aad-scroll'), ds: await ds() };
        assert.ok(entry.chats.side, stem + ': the chats list shows');
        await page.click('.aad-side .aad-row[data-id="qa-a"], .aad-side [data-sid="qa-a"]', { timeout: 3000 }).catch(async () => { await page.evaluate(() => __wux.openThread('qa-a')); });
        await page.waitForFunction(() => /qa-a/.test(location.href + JSON.stringify(WizCore?.route?.() || '')) || document.querySelector('.ch-msgs') && document.body.innerText.includes('Done: a plan for qa-a'));
        await shot('4-thread');
        entry.thread = { side: await box(page, '.aad-side'), chat: await box(page, '#stage > .wsp[data-aad-role="chat"], #stage > .wsp:not([hidden]) .win .dchats'), back: await box(page, '.aad-oneback'), ds: await ds() };
        if (W >= 680) assert.ok(entry.thread.side, stem + ': list beside the chat from 680 px');
        else {
          assert.equal(entry.thread.side, null, stem + ': the chat alone when narrower');
          assert.ok(entry.thread.back && entry.thread.back.x < W / 2, stem + ': a visible Back at the top left');
          await page.keyboard.press('Escape'); await settle();
          assert.ok(await box(page, '.aad-side'), stem + ': Esc shows the list');
          await shot('5-list-again');
          await page.keyboard.press('Escape'); await settle();
          assert.ok(await box(page, '.aad-side'), stem + ': at the list Back stays put');
          await page.evaluate(() => __wux.openThread('qa-a')); await settle();
          await page.click('.aad-oneback'); await settle();
          assert.ok(await box(page, '.aad-side'), stem + ': the visible Back shows the list');
        }
        // one click on the app: in front again, its word still there
        await page.click('.aad-vt .aad-vtab[data-app="app-store"]');
        await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'app');
        assert.equal(await store.inputValue(), 'unsent words', stem + ': the app kept its state');
        await shot('6-app-again');
        if (W === 900) {
          // resizing across the widths (Codex review): the chat alone with Back at 600, today's layout again from 1100
          await page.click('.aad-vt .aad-vchats'); await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'chats');
          await page.evaluate(() => __wux.openThread('qa-b')); await settle();
          await page.setViewportSize({ width: 600, height: 760 }); await settle();
          assert.ok(await box(page, '.aad-oneback'), stem + ': Back appears after shrinking to 600');
          assert.equal(await box(page, '.aad-side'), null, stem + ': the chat alone after shrinking');
          await page.setViewportSize({ width: 1200, height: 760 }); await settle();
          const wideDs = await ds();
          assert.equal(wideDs.aadOne, undefined, stem + ': wide again = today'); assert.notEqual(wideDs.aadTabs, 'bar'); assert.ok(await box(page, '.aad-side'));
          assert.equal(await box(page, '.aad-vt .aad-vchats'), null, stem + ': no Chats item when wide');
          await shot('8-wide-again');
        }
      }
      assert.deepEqual(errors, [], stem + ': page errors');
      entry.writes = writes;
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS desktop one app at a time', SKINS.join(','), WIDTHS.join(','));
  } catch (e) { await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; }
  finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
