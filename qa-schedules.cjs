// Run on Thales against tools/qa-origin.cjs (candidate assets, live read-only APIs).
// Scheduler + synthetic chat API intercepted; all other mutations refused.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const BASE = process.argv[2], OUT = process.env.QA_SHOTS;
if (!BASE || !OUT) throw Error('Supply candidate origin and QA_SHOTS');
fs.mkdirSync(OUT, { recursive: true });
const checks = [], errors = [], writes = [], screenshots = [];
function check(v, name, detail) { checks.push({ pass: !!v, name, detail }); assert.ok(v, name); console.log('PASS', name); }
(async () => {
  const { schedulerFixture } = await import('./tests/fixtures/scheduler.mjs');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME });
  try {
    for (const phone of [true, false]) {
      const kind = phone ? 'phone-390' : 'desktop', fixture = schedulerFixture();
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' } : {}) });
      const synthetic = { id: 'chat-brief', title: 'Daily notes', created_at: '2026-10-21T06:00:00Z', updated_at: '2026-10-21T07:00:00Z', messages: [] };
      await ctx.route('**/*', async route => {
        const q = route.request(), u = new URL(q.url()), json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname.startsWith('/wizard/v1/schedules')) { const d = fixture.handle(u.pathname, q.method(), q.postData() ? q.postDataJSON() : {}); return json(d.body, d.status); }
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ kind, method: q.method(), path: u.pathname, forwarded: false }); return json({ error: 'QA refuses production writes' }, 403); }
        if (u.pathname === '/wizard/hermes/api/sessions') return json({ sessions: u.searchParams.has('agent') ? [] : [synthetic], has_more: false });
        if (u.pathname.startsWith('/wizard/hermes/api/sessions/chat-brief')) return json(u.pathname.endsWith('/messages') ? { messages: [] } : { session: synthetic, ...synthetic });
        return route.continue();
      });
      await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (_) { /* sandboxed child frames have no storage */ } navigator.sendBeacon = () => false; });
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push({ kind, error: String(e), stack: e.stack }));
      const open = view => p.evaluate(v => WizCore.deeplink.route('/wizard-os-home/?view=' + v), view);
      const tap = async selector => { for (let i = 0; ; i++) { try { const el = p.locator(selector + ':visible').first(); await el.scrollIntoViewIfNeeded(); if (phone) await el.tap(); else await el.click(); return; } catch (e) { if (i >= 2 || !/not attached|detached/i.test(String(e))) throw e; } } };
      const shot = async name => { await p.locator('.mz-intro').waitFor({ state: 'detached' }); const f = path.join(OUT, `${kind}-${name}.png`); await p.screenshot({ path: f }); screenshots.push(f); };
      await p.goto(BASE); await p.waitForFunction(() => window.WizLive?.ok && (window.__wos || window.__wux) && window.WosSchedules?.available, null, { timeout: 60000 });
      check(await p.evaluate(() => innerWidth) === (phone ? 390 : 1440), kind + ': actual CSS viewport');
      for (const skin of ['nebula', 'obsidian']) {
        await open('skin'); await p.locator('[data-skinpick="' + skin + '"]:visible').waitFor(); await tap('[data-skinpick="' + skin + '"]');
        await p.waitForFunction(s => WosSkin.current === s && document.documentElement.dataset.skin === s, skin);
        await p.locator('.mz-intro').waitFor({ state: 'detached' });
        check(await p.locator(`[data-skinpick="${skin}"][aria-pressed="true"]`).count() === 1, kind + ': real picker ' + skin);
        await open('settings'); await tap('[data-st-page="schedules"]');
        await p.locator('[data-sc-row="morning"]').waitFor();
        check(await p.locator('[data-settings-feature="schedules"]').innerText().then(t => ['Every day 07:00', 'Every 5 min', 'Daily notes', 'Last run · unavailable'].every(x => t.includes(x))), `${kind} ${skin}: scheduler list`);
        const geometry = await p.locator('[data-settings-feature="schedules"]').evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth, buttons: [...e.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => ({ label: b.textContent, height: b.getBoundingClientRect().height })) }));
        check(geometry.scroll <= geometry.width && geometry.buttons.every(b => b.height >= 48), `${kind} ${skin}: fits and touch targets ≥48px`, geometry);
        await shot(skin + '-list');
        await tap('[data-sc="edit"][data-sc-id="morning"]'); await p.locator('[data-sc-field="name"]').fill('Retained schedule draft');
        await p.locator('[data-sc-field="prompt"]').fill('Do not lose this prompt'); await p.evaluate(() => WosSettings.refresh());
        check(await p.locator('[data-sc-field="name"]').inputValue() === 'Retained schedule draft', `${kind} ${skin}: live rerender retains draft`);
        const hit = await p.locator('[data-sc="save"]').evaluate(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.right - 12].every(x => [r.top + 12, r.bottom - 12].every(y => b.contains(document.elementFromPoint(x, y)))); });
        if (!hit) { await shot(skin + '-edit-hit-failure'); console.log(await p.locator('[data-sc="save"]').evaluate(b => { const r = b.getBoundingClientRect(); const pick = (e) => e && ({ tag: e.tagName, cls: e.className, rect: e.getBoundingClientRect().toJSON(), max: getComputedStyle(e).maxHeight, position: getComputedStyle(e).position }); return { button: pick(b), sheet: pick(b.closest('.sc-sheet')), scrim: pick(b.closest('.sc-scrim')), root: pick(b.closest('#settings')), hit: pick(document.elementFromPoint(r.left + r.width / 2, r.bottom - 2)) }; })); }
        check(hit, `${kind} ${skin}: Save fully above shell chrome`);
        if (!phone) {
          await p.locator('[data-sc="save"]').focus(); await p.keyboard.press('Tab');
          check(await p.locator('[data-sc-field="name"]').evaluate(e => document.activeElement === e), `${kind} ${skin}: dialog traps Tab`);
          await p.keyboard.press('Shift+Tab');
          check(await p.locator('[data-sc="save"]').evaluate(e => document.activeElement === e), `${kind} ${skin}: dialog traps Shift+Tab`);
        }
        await shot(skin + '-edit');
        await p.evaluate(() => { window.__scheduleDocument = document; history.back(); });
        await p.locator('.sc-sheet').waitFor({ state: 'detached' });
        check(await p.locator('#settingsBody').getAttribute('data-settings-page') === 'schedules' && await p.evaluate(() => document === window.__scheduleDocument), `${kind} ${skin}: browser Back closes sheet only`);
        await p.evaluate(() => history.back()); await p.waitForFunction(() => document.querySelector('#settingsBody').dataset.settingsPage === '');
        check(await p.evaluate(() => document === window.__scheduleDocument && !!(window.__wos || window.__wux)), `${kind} ${skin}: browser Back returns to Settings, not exit`);
      }
      await open('schedules');
      await tap('[data-sc="toggle"][data-sc-id="morning"]'); await p.locator('[data-sc="toggle"][data-sc-id="morning"][aria-checked="false"]').waitFor();
      check(fixture.calls.filter(c => c.method === 'PATCH').length === 1 && fixture.jobs[0].enabled === false, kind + ': toggle PATCH readback');
      await tap('[data-sc="run"][data-sc-id="morning"]'); await p.waitForFunction(() => !document.querySelector('[data-sc="run"][disabled]'));
      check(fixture.calls.filter(c => c.path.endsWith('/run')).length === 1, kind + ': Run now request');
      await tap('[data-sc="new"]'); await p.locator('[data-sc-field="name"]').fill('New fixture schedule'); await p.locator('[data-sc-field="prompt"]').fill('A fixture only'); await p.locator('[data-sc-field="kind"]').selectOption('every'); await p.locator('[data-sc-field="timing"]').fill('10'); await tap('[data-sc="save"]');
      await p.locator('[data-sc-row="created"]').waitFor(); check(fixture.jobs.at(-1).when.every === 10, kind + ': create through owner API');
      await tap('[data-sc="edit"][data-sc-id="created"]'); await p.locator('[data-sc-field="name"]').fill('Edited fixture schedule'); await tap('[data-sc="save"]'); await p.locator('.sc-sheet').waitFor({ state: 'detached' });
      check(fixture.jobs.at(-1).name === 'Edited fixture schedule', kind + ': edit PATCH');
      await tap('[data-sc="delete"][data-sc-id="created"]'); check(fixture.jobs.some(j => j.id === 'created'), kind + ': no delete before confirm'); await tap('[data-sc="confirm-delete"]'); await p.locator('[data-sc-row="created"]').waitFor({ state: 'detached' });
      check(!fixture.jobs.some(j => j.id === 'created'), kind + ': confirmed delete');
      await tap('[data-sc="import"]'); await p.locator('[data-sc="confirm-import"]').waitFor();
      check(fixture.calls.filter(c => c.path.endsWith('import-hermes')).every(c => c.body.dryRun === true) && (await p.locator('.sc-sheet').innerText()).includes('not imported: script job'), kind + ': import dry-run, script skipped');
      await shot('obsidian-import-preview'); await tap('[data-sc="confirm-import"]'); await p.locator('[data-sc="confirm-import"]').waitFor({ state: 'detached' });
      check(fixture.jobs.at(-1).enabled === false && fixture.calls.filter(c => c.path.endsWith('import-hermes')).at(-1).body.dryRun === false, kind + ': confirmed import paused');
      await tap('[data-sc="close"]');
      await tap('[data-sc="chat"][data-sc-id="morning"]'); await p.waitForFunction(() => Object.values((window.__wos || window.__wux).wins).some(w => w.thread === 'chat-brief'));
      check(true, kind + ': destination opens exact chat');
      await open('schedules'); await tap('[data-sc="new"]'); await p.locator('[data-sc-field="name"]').fill('Skin-change draft');
      const before = await p.locator('.sc-row').first().evaluate(e => getComputedStyle(e).backgroundColor);
      // Palette screenshots above use the real picker. This live context update
      // exercises an already-open editor without deliberately navigating away.
      await p.evaluate(() => WosSkin.set('nebula'));
      await p.waitForFunction(() => WosSkin.current === 'nebula');
      check(await p.locator('[data-sc-field="name"]').inputValue() === 'Skin-change draft' && before !== await p.locator('.sc-row').first().evaluate(e => getComputedStyle(e).backgroundColor), kind + ': skin change repaints without losing editor');
      await tap('[data-sc="close"]'); fixture.missing = true; await p.evaluate(() => WosSchedules.load()); await open('settings');
      check(await p.locator('[data-st-page="schedules"]').count() === 0 && await p.locator('[data-settings-feature="schedules"]').count() === 0, kind + ': 404 hides entire section');
      await ctx.close();
    }
    check(errors.length === 0, 'no uncaught page errors', errors);
  } finally {
    await browser.close(); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, errors, writes, screenshots, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length, forwardedWrites: 0 }, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
