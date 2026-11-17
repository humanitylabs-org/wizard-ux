'use strict';
// ux#1495: at a medium desktop width (the narrower one-app window, ONE in layouts/ai-apps/desktop.js, with the app bar
// along the bottom) the Chats message bar must sit fully above the bar, never behind it. James's window was about
// 980 x 940. Real browser, synthetic origin, every write refused. Per skin x width: Home, Chats in front with a new chat,
// and Chats with an open thread; the visible composer (.ch-compose) must end above the bar's top and its field must be
// the element hit at its centre. QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the bug instead, for the baseline.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://composer.test';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'one-app-composer-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const SIZES = (process.env.QA_SIZES || '980x940,900x760,720x700,1060x800').split(',').map(s => s.split('x').map(Number));
const BROKEN = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString();
const ROWS = [['qa-a', 'Trip to Lisbon'], ['qa-b', 'Quarterly numbers']].map(([id, title], i) => ({ id, title, runtime: 'direct', status: 'completed',
  updated_at: iso(now - (i + 1) * 36e5), updatedAt: iso(now - (i + 1) * 36e5), last_active: (now - (i + 1) * 36e5) / 1000, message_count: 2, messageCount: 2, preview: 'Here you go.' }));
const report = { web, cases: [] };
// the composer the owner sees: the visible .ch-compose (Home's floating one or the chat's), its field, and the bar
const measure = page => page.evaluate(() => {
  const vis = n => { if (!n || !n.getClientRects().length) return false; const cs = getComputedStyle(n), b = n.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && b.width > 40 && b.height > 20 && b.bottom > 0 && b.top < innerHeight; };
  const bar = document.querySelector('.aad-vt'), bb = bar && bar.getBoundingClientRect();
  const comps = [...document.querySelectorAll('.ch-compose')].filter(vis).filter(c => vis(c.querySelector('textarea')));
  return { ds: { one: document.documentElement.dataset.aadOne, tabs: document.documentElement.dataset.aadTabs }, bar: bb && { top: Math.round(bb.top), h: Math.round(bb.height) },
    comps: comps.map(c => { const b = c.getBoundingClientRect(), ta = c.querySelector('textarea'), tb = ta.getBoundingClientRect();
      const hit = document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height / 2);
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), fieldHit: hit === ta || c.contains(hit) }; }) };
});
(async () => {
  const browser = await chromium.launch();
  let page;
  try {
    for (const skin of SKINS) for (const [W, H] of SIZES) {
      const stem = `${skin}-${W}x${H}`, entry = { stem }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [];
      await context.routeWebSocket('**/*', ws => ws.close());
      await context.addInitScript(({ skin }) => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
          'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) })) localStorage.setItem(k, v);
      }, { skin });
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 403, json: { error: 'QA refuses all writes' } });
        if ([prefix + 'store/index.html', prefix + 'agents/index.html'].includes(u.pathname)) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Synthetic app</h1>' });
        if (u.pathname === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
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
      await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      const check = async name => {
        await settle(); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) });
        const m = await measure(page); entry[name] = m;
        assert.equal(m.ds.tabs, 'bar', stem + ' ' + name + ': the narrower window has the app bar');
        assert.ok(m.bar && m.comps.length, stem + ' ' + name + ': a visible message bar ' + JSON.stringify(m));
        const ok = m.comps.every(c => c.bottom <= m.bar.top + 1 && c.fieldHit);
        if (BROKEN) return ok;
        assert.ok(ok, stem + ' ' + name + ': the message bar sits fully above the app bar ' + JSON.stringify(m));
        return ok;
      };
      await settle();
      const results = [];
      results.push(await check('1-home'));
      // Chats in front (the bar's first item), then a new chat (⌥N's own path)
      await page.evaluate(() => document.querySelector('.aad-vt .aad-vchats')?.click());
      await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'chats');
      await page.evaluate(() => __wux.newChat?.());
      results.push(await check('2-new-chat'));
      await page.evaluate(() => __wux.openThread('qa-a'));
      await page.waitForFunction(() => document.body.innerText.includes('Done: a plan for qa-a'));
      results.push(await check('3-thread'));
      entry.ok = results;
      if (BROKEN) assert.ok(results.some(x => !x), stem + ': expected the message bar behind the app bar on this build');
      assert.deepEqual(errors, [], stem + ': page errors');
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log((BROKEN ? 'PASS (broken as expected) ' : 'PASS ') + 'message bar above the app bar', SKINS.join(','), SIZES.map(s => s.join('x')).join(','));
  } catch (e) { await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; }
  finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
