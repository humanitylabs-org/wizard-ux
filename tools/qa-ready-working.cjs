'use strict';
// Forum-only, synthetic-service QA. Reuse the tracker rig's shell/skins/static-byte replay;
// all dynamic reads and writes are intercepted at the unroutable synthetic origin.
const { chromium } = require('./qa-playwright.cjs');
const { mount, service } = require('./qa-thread-tracker.cjs');
const fx = require('./qa-proof-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const OUT = path.resolve(process.argv[2] || process.env.TMPDIR + '/qa-ready-working');
fs.mkdirSync(OUT, { recursive: true });
let passed = 0;
const check = (label, ok) => { if (!ok) throw Error(label); console.log('PASS ' + label); passed++; };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const tag = shell + '/' + skin, svc = service(); let helper = true;
      const now = Math.floor(Date.now() / 1000);
      const row = (id, title, background) => ({ ...fx.row, id, title, status: 'completed', wizard_status: 'completed', message_count: 2,
        last_active: now, wizard_last_assistant_at: now, wizard_last_user_at: now - 30,
        wizard_attention: { state: 'needs_you', ask: "Messenger chats won't open on click and a fix is underway. Say what happens when you open Messenger." },
        wizard_background: background });
      svc.sessionRows = () => [row('tt-main', 'Messenger settings', helper ? 'helper' : ''), row('tt-other', 'Plain needs-you thread', '')];
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [] });
      if (shell === 'desktop') {
        await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps');
      } else {
        await page.getByText('Ready', { exact: true }).first().click();
      }
      await page.waitForFunction(() => window.WizLive?.session('tt-main')?.background === 'helper');
      const working = shell === 'desktop' ? page.locator('#aad-sec-working') : page.locator('.ch-sec[data-sec="working"]');
      const header = shell === 'desktop' ? page.locator('.aad-sec[data-sec="working"]') : working.locator('[data-sectoggle="working"]');
      if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
      const mainRow = shell === 'desktop' ? working.locator('[data-sid="tt-main"]') : working.locator('[data-chopen="tt-main"]');
      await mainRow.waitFor({ state: 'visible' });
      check(tag + ': helper thread is visible in Working', await mainRow.isVisible());
      check(tag + ': retained amber ask is visible', /Needs you:.*Messenger chats won't open/.test(await mainRow.innerText()));
      check(tag + ': retained helper badge is visible', await mainRow.getByText('Helper still working', { exact: true }).isVisible());
      if (shell === 'desktop') {
        check(tag + ': accessible name retains ask and helper state', /Needs you:.*Messenger chats won't open.*Helper still working/.test(await mainRow.locator('button.aad-row').getAttribute('aria-label')));
        check(tag + ': expanded ask and badge fit the clickable row', await mainRow.evaluate(el => { const button = el.querySelector('.aad-row').getBoundingClientRect(), title = el.querySelector('.aad-row-t').getBoundingClientRect(); return title.top >= button.top && title.bottom <= button.bottom && button.height > 36; }));
      }
      const before = await page.evaluate(() => {
        const L = window.WizLive, s = L.session('tt-main'), g = L.workGroups(L.unified());
        return { working: g.working.some(x => x.id === s.id), ready: g.ready.some(x => x.id === s.id),
          unread: L.visibleUnread(L.unified()).map(x => x.id), orb: window.WizCore.workspaceNav.chatsCount(L),
          ask: s.attention.ask };
      });
      check(tag + ': not in Ready or orb count', before.working && !before.ready && !before.unread.includes('tt-main') && before.orb === before.unread.length);
      check(tag + ': plain idle ask still Ready', await page.evaluate(() => window.WizLive.workGroups(window.WizLive.unified()).ready.some(x => x.id === 'tt-other')));
      const alternate = skin === 'nebula' ? 'grove' : 'nebula';
      await page.evaluate(id => window.WosSkin.set(id), alternate);
      await page.waitForFunction(id => document.documentElement.dataset.skin === id, alternate);
      check(tag + ': live skin change preserves Working and ask', await mainRow.isVisible() && (await mainRow.innerText()).includes('Needs you:'));
      await page.evaluate(id => window.WosSkin.set(id), skin);
      await page.waitForFunction(id => document.documentElement.dataset.skin === id, skin);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
      const geometry = await mainRow.evaluate(el => { const r = el.getBoundingClientRect(); const ask = el.querySelector('.att.needs, .aad-working-ask'); return { visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight, color: ask && getComputedStyle(ask).color, skin: document.documentElement.dataset.skin }; });
      check(tag + ': screenshot has visible row and themed ask', geometry.visible && geometry.color && geometry.skin === skin);
      await page.screenshot({ path: path.join(OUT, `working-helper-${shell}-${skin}.png`) });
      // Exercise Chats' exposed production navigation/filter API and its rendered rows,
      // rather than reaching into the private STATUS/FILTERS closure.
      if (shell === 'desktop') {
        await page.evaluate(() => window.WosExperience.chooseDesktopView('classic'));
        await page.waitForFunction(() => !document.documentElement.dataset.layout);
      }
      const filterWin = await page.evaluate(() => {
        const api = window.__wux || window.__wos;
        api.openChatsList?.();
        const w = Object.values(api.wins).find(w => w.app === 'chats' && !w.thread);
        if (!w) throw Error('Chats list window missing');
        // Desktop's shared list pane is a production Chats window (id::list),
        // separate from the right-hand thread pane's state.
        const id = window.__wux ? w.id + '::list' : w.id;
        api.chats.setFilter(window.__wux ? { id } : w, 'needs');
        if (api.chats.ch(id).filter !== 'needs') throw Error('Needs-you filter was not selected');
        return id;
      });
      const filtered = page.locator(`[data-chats="${filterWin}"] .ch-scroll`).first();
      await filtered.locator('[data-chopen="tt-other"]').waitFor({ state: 'visible' });
      check(tag + ': Needs-you list excludes helper but retains idle ask', await filtered.locator('[data-chopen="tt-main"]').count() === 0 && await filtered.locator('[data-chopen="tt-other"]').isVisible());
      helper = false; await page.evaluate(() => window.WizLive.refresh());
      await page.waitForFunction(() => !window.WizLive.session('tt-main').background);
      await filtered.locator('[data-chopen="tt-main"]').waitFor({ state: 'visible' });
      check(tag + ': helper completion moves the same thread to Ready and Needs-you', await page.evaluate(() => { const L = window.WizLive, g = L.workGroups(L.unified()); return !g.working.some(x => x.id === 'tt-main') && g.ready.some(x => x.id === 'tt-main'); }) && await filtered.locator('[data-chopen="tt-main"]').isVisible());
      check(tag + ': no page errors or real-service requests', ctx.errors.length === 0 && svc.reqs.every(r => !/https?:/.test(r)));
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed, failed: 0, scope: 'Synthetic data and intercepted writes; phone + desktop, Nebula + Grove, live skin switches. Not physical-device QA.' }, null, 2));
    console.log(`${passed} passed, 0 failed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
