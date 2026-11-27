'use strict';
// App feature switches in a reply's switch card (wizard-ux issue 1560, on for everyone), in a real
// browser. Disposable synthetic transport: a fake App Manager catalog (store-install/_feature-switches) whose app row
// stands for Calendar's own /api/switches state, every other write refused. Phone 390x844 + desktop 1440x960, Nebula +
// Grove. One reply carries [WIZARD_TWEAK_V1]{"ids":[core, app, app-not-updated, app-not-installed]}: the app row shows
// its name, description and current state; a tap flips it on its own frame and POSTs the owner route once; the fake
// app state (what the Tracker card reads) follows; the not-updated app is greyed "Update Notes first" + Update; the
// not-installed one is hidden. No tweak is turned on: app rows draw for everyone.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-app-switch-card.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-app-switch-card-evidence');
fs.mkdirSync(out, { recursive: true });
const CAL = 'wizard-calendar:drag-events', NOTES = 'wizard-notes:quick-links', GONE = 'wizard-gone:thing';
const MARK = o => `[WIZARD_TWEAK_V1]${JSON.stringify(o)}[/WIZARD_TWEAK_V1]`, now = Date.now();
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], posts: [], reads: 0 }; report.cases.push(entry);
      const calendar = { on: false };   // the app's own switch state (Calendar's DATA/switches.json)
      const listing = () => ({ channel: 'latest', channel_name: 'For testers', locked: false, note: '',
        switches: [{ id: 'wizard/sidebar-chats-view', kind: 'core', name: 'Thread tracker', on: false, locked: false, issues: [] },
          { id: CAL, kind: 'app', app: 'wizard-calendar', app_name: 'Calendar', switch: 'drag-events', name: 'Drag to move events', description: 'Drag an event to a new time or day.', author: 'wizard-calendar', on: calendar.on, default: false, issues: ['humanitylabs-org/wizard-calendar#19'], locked: false }],
        apps: [{ id: 'wizard-calendar', name: 'Calendar', ok: true }, { id: 'wizard-notes', name: 'Notes', ok: true }] });
      const reply = `The calendar change is in. It starts off; try it here:\n\n${MARK({ ids: ['wizard/sidebar-chats-view', CAL, NOTES, GONE] })}\n\nSay if dragging feels right.`;
      const row = { id: 'qa-app-switch', title: 'Synthetic app switch card', runtime: 'direct', status: 'completed', updated_at: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), message_count: 2, messageCount: 2, archived: false, preview: 'The calendar change is in.' };
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
          localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', off: {}, mix }));
        }, { shell, skin, mix: {} });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p === prefix + 'store-install/_feature-switches') {
            if (method === 'GET') { entry.reads++; return r.fulfill({ json: listing() }); }
            const body = q.postDataJSON(), h = q.headers();
            entry.posts.push({ body, store: h['x-wizard-store'], type: h['content-type'], origin: h.origin });
            if (body.id !== CAL || typeof body.on !== 'boolean' || h['x-wizard-store'] !== '1') return r.fulfill({ status: 400, json: { error: 'bad request' } });
            calendar.on = body.on;
            return r.fulfill({ json: { ...listing(), changed: { id: CAL, on: body.on, by: 'owner' } } });
          }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row], has_more: false } });
          if (p === '/wizard/hermes/api/sessions/qa-app-switch/messages') return r.fulfill({ json: { messages: [
            { role: 'user', content: 'Ship the calendar drag', timestamp: now / 1000 - 60 }, { role: 'assistant', content: reply, timestamp: now / 1000 - 59 }] } });
          if (p === '/wizard/hermes/api/sessions/qa-app-switch') return r.fulfill({ json: { session: row } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const listRow = page.locator('.ch-list [data-chopen="qa-app-switch"]').filter({ visible: true }).first();
        await listRow.waitFor(); await listRow.click();
        const card = page.locator('.ch-thread [data-chat-tweak-card]').filter({ visible: true }).first();
        await card.waitFor();
        const thread = page.locator('.ch-thread').filter({ visible: true }).first();
        const text = await thread.innerText(); entry.threadText = text.slice(0, 600);
        assert.doesNotMatch(text, /WIZARD_TWEAK|drag-events|quick-links|wizard-gone/, 'marker and ids never show as text');
        {
          const sw = page.locator(`.ch-thread [data-chat-tweak="${CAL}"]`).filter({ visible: true }).first();
          await sw.waitFor();
          entry.row = await sw.evaluate(b => ({ cls: b.className, role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'), name: b.querySelector('.st-tx b')?.textContent, by: b.querySelector('.tw-by')?.textContent, desc: b.querySelectorAll('.st-tx small')[1]?.textContent, disabled: b.disabled }));
          assert.deepEqual(entry.row, { cls: 'st-row tw-row', role: 'switch', checked: 'false', name: 'Drag to move events', by: 'by Calendar', desc: 'Drag an event to a new time or day.', disabled: false });
          const notes = page.locator(`.ch-thread [data-chat-tweak="${NOTES}"]`).filter({ visible: true }).first();
          assert.equal(await notes.isDisabled(), true, 'not-updated app row is greyed');
          assert.match(await notes.innerText(), /Notes[\s\S]*Update Notes first/);
          assert.equal(await page.locator('.ch-thread [data-chat-tweak-update="wizard-notes"]').filter({ visible: true }).count(), 1, 'Update button beside it');
          assert.equal(await page.locator(`[data-chat-tweak="${GONE}"]`).count(), 0, 'not-installed app hidden');
          await sw.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: path.join(out, stem + '-before-tap.png') });
          await page.evaluate(id => {
            window.tapReceipt = null;
            window.addEventListener('click', e => { if (!e.target.closest(`[data-chat-tweak="${id}"]`)) return;
              requestAnimationFrame(() => { const b = [...document.querySelectorAll(`.ch-thread [data-chat-tweak="${id}"]`)].find(x => x.getClientRects().length); window.tapReceipt = [b.getAttribute('aria-checked'), b.querySelector('.sw').classList.contains('on')]; }); }, { capture: true, once: true });
          }, CAL);
          await sw.click();
          await page.waitForFunction(() => window.tapReceipt);
          entry.tapReceipt = await page.evaluate(() => tapReceipt);
          assert.deepEqual(entry.tapReceipt, ['true', true], 'flipped on the tap frame');
          await page.waitForTimeout(400);
          assert.equal(entry.posts.length, 1, 'one POST');
          assert.deepEqual(entry.posts[0].body, { id: CAL, on: true });
          assert.equal(entry.posts[0].store, '1'); assert.match(entry.posts[0].type, /application\/json/); assert.equal(entry.posts[0].origin, origin);
          assert.equal(calendar.on, true, "the app's own switch state changed (what the Tracker card shows)");
          assert.equal(await sw.getAttribute('aria-checked'), 'true');
          await page.screenshot({ path: path.join(out, stem + '-on.png') });
          // Flip back off: the app follows again.
          await sw.click(); await page.waitForTimeout(400);
          assert.equal(calendar.on, false); assert.equal(await sw.getAttribute('aria-checked'), 'false');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected mutations: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = await pages[0].locator('body').innerText().catch(() => ''); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } throw e; }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
    assert.equal(report.cases.length, 4);
  } finally { await browser.close(); }
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.filter(c => c.pass).length, screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')) }));
})().catch(e => { console.error(e); process.exitCode = 1; });
