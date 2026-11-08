'use strict';
// Chat tweak card (WIZARD_TWEAK_V1) in a real browser. Disposable synthetic transport only: no owner API reads or
// writes, every unexpected write refused. Phone 390x844 + desktop 1440x960, Nebula + Grove. A synthetic thread whose
// replies carry a tweak card: off -> tap -> on (same-frame paint while the tweak's own files are held 3 s), both
// cards in sync, Settings › Look shows the same switch on, Look's switch turns it off and the cards follow.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-tweak-card.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-tweak-card-evidence');
fs.mkdirSync(out, { recursive: true });
const EXPECTED_CASES = 4, HOLD_MS = 3000, now = Date.now(), nap = ms => new Promise(r => setTimeout(r, ms));
const report = { origin, web, cases: [] };
// MAIN: an off-by-default tweak this shell can wear. OTHER: one it can't (shown disabled, labelled).
const PLAN = { phone: { main: 'wizard/desktop-chats', other: 'miguel/ai-apps', only: 'Desktop only' },
  desktop: { main: 'wizard/pin-buttons', other: 'wizard/desktop-chats', only: 'Phone only' } };
const MARK = o => `[WIZARD_TWEAK_V1]${JSON.stringify(o)}[/WIZARD_TWEAK_V1]`;
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', { main, other, only } = PLAN[shell], stem = `${shell}-${skin}`;
      const entry = { stem, main, other, errors: [], refused: [], writes: [], held: [] }; report.cases.push(entry);
      const first = `The new switch is live. It starts off.\n\n${MARK({ id: main })}\n\nSay if it reads right.`;
      const second = `Here are the others too:\n\n${MARK({ ids: [main, other, 'wizard/not-installed'] })}`;
      const row = { id: 'qa-tweak', title: 'Synthetic tweak card', runtime: 'direct', status: 'completed', updated_at: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), message_count: 4, messageCount: 4, archived: false, preview: second };
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, skin }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
        }, { shell, skin });
        let hold = false;
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            // The tweak's own code arrives late: the switch must already show the tap.
            if (hold && f.startsWith(`tweaks/${main}/tweak.`)) { entry.held.push(f); await new Promise(res => setTimeout(res, HOLD_MS)); }
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          // No Pages here: Look stays on this device (look-sync "absent"), no writes.
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row], has_more: false } });
          if (p === '/wizard/hermes/api/sessions/qa-tweak/messages') return r.fulfill({ json: { messages: [
            { role: 'user', content: 'Ship the switch', timestamp: now / 1000 - 60 }, { role: 'assistant', content: first, timestamp: now / 1000 - 59 },
            { role: 'user', content: 'And the others?', timestamp: now / 1000 - 30 }, { role: 'assistant', content: second, timestamp: now / 1000 - 29 }] } });
          if (p === '/wizard/hermes/api/sessions/qa-tweak') return r.fulfill({ json: { session: row } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), shell);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        assert.equal(await page.evaluate(id => WosExperience.state.tweaks.find(t => t.id === id)?.on, main), false, stem + ': tweak starts off');
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const listRow = page.locator('.ch-list [data-chopen="qa-tweak"]').filter({ visible: true }).first();
        await listRow.waitFor();
        entry.listText = await listRow.innerText(); assert.doesNotMatch(entry.listText, /WIZARD_TWEAK|\{"ids?"/, 'Chats list preview hides the marker');
        await listRow.click();
        const cards = page.locator('.ch-thread [data-chat-tweak-card]').filter({ visible: true });
        await cards.nth(1).waitFor();
        const thread = page.locator('.ch-thread').filter({ visible: true }).first();
        const text = await thread.innerText(); entry.threadText = text.slice(0, 600);
        assert.doesNotMatch(text, /WIZARD_TWEAK|\{"ids?"/, 'marker never shows as text');
        assert.match(text, /It starts off\.[\s\S]*Say if it reads right\./);
        const sw = page.locator(`.ch-thread [data-chat-tweak="${main}"]`).filter({ visible: true });
        assert.equal(await sw.count(), 2, 'two cards name the main tweak');
        for (const v of await sw.evaluateAll(b => b.map(x => x.getAttribute('aria-checked')))) assert.equal(v, 'false');
        const look = await sw.first().evaluate(b => ({ cls: b.className, role: b.getAttribute('role'), name: b.querySelector('.st-tx b')?.textContent, by: b.querySelector('.tw-by')?.textContent, sw: !!b.querySelector('.sw > i'), bg: getComputedStyle(b.closest('.ch-tweak')).backgroundColor, img: getComputedStyle(b.closest('.ch-tweak')).backgroundImage }));
        entry.look = look;
        assert.equal(look.cls, 'st-row tw-row'); assert.equal(look.role, 'switch'); assert.ok(look.sw && look.name && /^by /.test(look.by), 'Look\'s own switch row');
        assert.ok(/gradient/.test(look.img) && !/rgba\([^)]*,\s*0\)$/.test(look.bg), 'card painted opaque');
        const otherRow = page.locator(`.ch-thread [data-chat-tweak="${other}"]`).filter({ visible: true }).first();
        assert.equal(await otherRow.isDisabled(), true, 'other-shell tweak is disabled');
        assert.match(await otherRow.innerText(), new RegExp(only));
        assert.match(await thread.innerText(), /This tweak isn’t installed on this Wizard/);
        await sw.first().scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        // Tap: the switch flips on the tap's own frame, both cards, while the tweak's files are still held.
        hold = true;
        await page.evaluate(id => {
          window.tapReceipt = null;
          window.addEventListener('click', e => { if (!e.target.closest(`[data-chat-tweak="${id}"]`)) return;
            requestAnimationFrame(() => { window.tapReceipt = { checked: [...document.querySelectorAll(`.ch-thread [data-chat-tweak="${id}"]`)].filter(b => b.getClientRects().length).map(b => [b.getAttribute('aria-checked'), b.querySelector('.sw').classList.contains('on')]), stateOn: WosExperience.state.tweaks.find(t => t.id === id)?.on }; }); }, { capture: true, once: true });
        }, main);
        const t0 = Date.now(); await sw.first().click();
        await page.waitForFunction(() => window.tapReceipt);
        entry.tapReceipt = await page.evaluate(() => tapReceipt);
        assert.deepEqual(entry.tapReceipt.checked, [['true', true], ['true', true]], 'same-frame paint on both cards');
        await page.waitForFunction(id => WosExperience.state.tweaks.find(t => t.id === id)?.on === true && !WosExperience.state.busy, main, { timeout: 15000 });
        entry.settledMs = Date.now() - t0; hold = false;
        // When the tweak's files were fetched on the tap, the tap painted HOLD_MS before they arrived (recorded, not required:
        // a shell may have them cached from boot). The rAF receipt above is the same-frame proof either way.
        entry.heldProof = entry.held.length > 0 && entry.settledMs >= HOLD_MS - 200;
        for (const v of await sw.evaluateAll(b => b.map(x => x.getAttribute('aria-checked')))) assert.equal(v, 'true');
        await page.screenshot({ path: path.join(out, stem + '.png') });  // one shot per shell x skin: both cards on, the other-shell and not-installed rows below
        // Settings › Look shows the same switch, on. Its tap turns it off; the cards follow.
        if (phone) await page.evaluate(() => __wos.openSheet('settings')); else await page.evaluate(() => __wux.openSettings('look'));
        await nap(400); const lookPage = page.locator('[data-st-page="appearance"]').filter({ visible: true }).first(); if (await lookPage.isVisible().catch(() => false)) await lookPage.click();
        const lookRow = page.locator(`[data-tweak-toggle="${main}"]`).filter({ visible: true }).first();
        await lookRow.waitFor(); await lookRow.scrollIntoViewIfNeeded();
        assert.equal(await lookRow.getAttribute('aria-checked'), 'true', 'Settings › Look shows the same state');
        await lookRow.click();
        await page.waitForFunction(id => WosExperience.state.tweaks.find(t => t.id === id)?.on === false && !WosExperience.state.busy, main, { timeout: 15000 });
        await page.waitForFunction(id => { const b = [...document.querySelectorAll(`[data-chat-tweak-card] [data-chat-tweak="${id}"]`)]; return b.length >= 2 && b.every(x => x.getAttribute('aria-checked') === 'false'); }, main, { timeout: 5000 });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected mutations');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = await pages[0].locator('body').innerText().catch(() => ''); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } throw e; }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
    assert.equal(report.cases.length, EXPECTED_CASES);
  } finally { await browser.close(); }
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.filter(c => c.pass).length, screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')) }));
})().catch(e => { console.error(e); process.exitCode = 1; });
