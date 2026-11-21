'use strict';
// wizard-ux issue 1489 in a real browser: on the Channels list (wizard/chat-channels on, no channel open) the + starts a
// blank new chat, exactly as on Activity, and only the list's own "+ New channel" row opens the name form. Checked on the
// phone (the stock Chats list's round +) and the AI apps desktop (the sidebar's + and ⌥N), Nebula + Grove. Synthetic
// transport only (no box is reached; writes are answered in memory).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead (the + opens the name form), as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-channels-plus.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channels-plus-evidence');
const broken = process.env.QA_EXPECT === 'broken', SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1'], createdAt: iso(now - 9e8) }];
const ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', at: now - 36e5 },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 6e5 },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
const report = [];

async function setup(browser, skin, phone) {
  const context = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ skin, spaces, phone }) => {
    if (window !== top) return;
    if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
    const shell = phone ? { 'wos.shell': 'phone', 'wux.shell': 'phone' } : { 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps' };
    for (const [k, v] of Object.entries({ ...shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
      'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
  }, { skin, spaces: SPACES, phone });
  const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== origin) return r.abort();
    if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
    if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
    if (p.startsWith(prefix)) {
      const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
    }
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
  await page.waitForFunction(() => (window.__wos || window.__wux) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
  await page.waitForFunction(() => true, null, { timeout: 15000 });
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page, errors };
}

// What the + did: the name-the-channel form, or a blank new chat (a New chat thread with its empty message box).
const state = page => page.evaluate(() => {
  const vis = el => !!el && el.getClientRects().length > 0;
  const form = [...document.querySelectorAll('[data-chspacepicker]')].some(vis);
  const draft = [...document.querySelectorAll('.ch-thread textarea, .aad-home textarea, .ch-compose textarea')].some(t => vis(t) && !t.closest('.ch-chan-compose, [data-chspacepicker]'));
  return { form, draft };
});

(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) for (const phone of [true, false]) {
      const stem = `${phone ? 'phone' : 'ai-apps'}-${skin}${broken ? '-before' : ''}`, entry = { stem }; report.push(entry);
      const { context, page, errors } = await setup(browser, skin, phone);
      try {
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (phone) await page.evaluate(() => __wos.openSheet('inbox'));
        else { await vis('.aad-chan .ch-chan-tabs').waitFor({ timeout: 15000 }); if (await page.locator('.aad-cx').filter({ visible: true }).count()) await vis('.aad-cx').click(); }
        await vis('[data-chview="channels"]').click(); await nap(400);
        await vis('.ch-chan-list').waitFor();
        await page.screenshot({ path: path.join(out, stem + '-1-channels.png') });
        if (phone) {
          entry.fab = await vis('.ch-fab').evaluate(b => ({ label: b.getAttribute('aria-label'), newChannel: b.hasAttribute('data-chchannew') }));
          await vis('.ch-fab').click();
        } else await vis('.aad-new').click();
        await nap(700);
        entry.plus = await state(page);
        await page.screenshot({ path: path.join(out, stem + '-2-plus.png') });
        if (broken) assert.ok(entry.plus.form, `${stem}: main opens the name form`);
        else {
          assert.deepEqual(entry.plus, { form: false, draft: true }, `${stem}: + starts a blank new chat, no name form`);
          if (phone) assert.deepEqual(entry.fab, { label: 'New chat', newChannel: false });
        }
        if (!broken) {
          // ⌥N on the AI apps desktop, back on the Channels list: a new chat too.
          if (!phone) {
            await page.keyboard.press('Escape'); await nap(300);
            await vis('[data-chview="channels"]').click(); await nap(300);
            await page.locator('body').click({ position: { x: 900, y: 450 } }).catch(() => {});
            await page.keyboard.press('Alt+KeyN'); await nap(600);
            entry.altN = await state(page);
            assert.equal(entry.altN.form, false, `${stem}: ⌥N never opens the name form`);
          }
          // The "+ New channel" row still opens the name form.
          if (phone) { await page.evaluate(() => __wos.openSheet('inbox')); await nap(300); }
          else await page.keyboard.press('Escape');
          await vis('[data-chview="channels"]').click(); await nap(400);
          await vis('.ch-chan-add[data-chchannew]').click(); await nap(500);
          entry.row = await state(page);
          await page.screenshot({ path: path.join(out, stem + '-3-new-channel-row.png') });
          assert.equal(entry.row.form, true, `${stem}: the + New channel row opens the name form`);
        }
        entry.errors = errors;
        assert.deepEqual(errors, [], `${stem}: no page errors`);
        entry.pass = true;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, `report${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
