'use strict';
// wizard-ux issue 1500 in a real browser (follow-up to 1487): phone 412x915 on Nebula and Grove, plus desktop 1440x900.
// A thread (Philosopher on Claude Fable, and the main agent) whose send failed while the Claude sign-in has EXPIRED
// (/wizard/ai-usage error.code expired, the Agent Service shape). The card must say the subscription is disconnected
// and offer Reconnect Claude (no Retry), with no generic "not processed… send it again" line above it and Claude named
// once in its title; the Chats list's Errors row (the desktop sidebar) offers Reconnect, never Retry; Home and
// Resources › AI accounts show Reconnect with no "Open the Claude app and press Connect" sentence. Synthetic transport.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://expired-reconnect.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'expired-reconnect-evidence');
const broken = process.env.QA_EXPECT === 'broken', tag = broken ? '-before' : '';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SUB = 'claude-subscription-directsdk-experimental';
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: SUB, model: 'claude-opus-4-8' } },
  { id: 'philosopher', label: 'Philosopher', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'p', hue: 30 }, model: { provider: SUB, model: 'claude-fable-5-1' } },
];
const row = { id: 'qa-p1', title: 'On virtue', source: 'wizard-mobile', status: 'failed', model: 'claude-fable-5-1', provider: SUB, updated_at: iso(now - 6e5), last_active: (now - 6e5) / 1000,
  message_count: 2, preview: 'What is virtue?', wizard_run_id: 'run_p1', wizard_last_run_id: 'run_p1', wizard_last_run_status: 'failed', wizard_last_user_at: (now - 6e5) / 1000, agent: 'philosopher' };
const usage = signedIn => ({ fetchedAt: iso(Date.now()), providers: [signedIn
  ? { id: 'claude', name: 'Claude', status: 'ok', fetchedAt: iso(Date.now()), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 70, resetsAt: iso(now + 864e5) }] }
  : { id: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: null, limits: [], error: { code: 'expired', message: 'Claude sign-in has expired. Open the Claude app and press Connect.' } }] });
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const view of [{ skin: 'nebula', phone: true }, { skin: 'grove', phone: true }, { skin: 'nebula', phone: false }, { skin: 'nebula', phone: true, main: true }]) {
      // main: the same failed thread on the main agent (parity with the routed Philosopher thread).
      const name = `${view.phone ? 'phone' : 'desktop'}-${view.skin}${view.main ? '-main' : ''}`, mine = view.main ? '' : 'philosopher';
      const context = await browser.newContext(view.phone
        ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' }
        : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      const errors = [], st = { signedIn: false };
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, phone }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return;
          sessionStorage.setItem('qa.seeded', '1');
          const shell = phone ? 'phone' : 'desktop';
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.desktop-view.v1': 'classic' })) localStorage.setItem(k, v);
        }, view);
        const prefs = { migrations: { 'launcher-seed-v1': true } };
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
          if (p === '/wizard/ai-usage') return r.fulfill({ json: usage(st.signedIn) });
          if (p === '/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          const agent = u.searchParams.get('agent') || '';
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: agent === mine ? [view.main ? { ...row, agent: undefined } : row] : [], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            if (decodeURIComponent(m[1]) !== row.id || agent !== mine) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'What is virtue?', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', timestamp: now / 1000 - 590 }] } : { session: row } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        const shot = n => page.screenshot({ path: path.join(out, `${name}-${n}${tag}.png`) });
        const seenText = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length).map(el => el.textContent.replace(/\s+/g, ' ').trim()), sel);
        // Home first (phone Home / desktop Home widget), then Resources › AI accounts.
        await page.goto(origin + prefix + (view.phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => window.WosAgents?.list?.length === 2, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(() => window.WosResources?.update?.(true));
        // Desktop without Home in view never reads usage for Home: the failed card asks for it itself.
        if (view.phone) await page.waitForFunction(() => window.WosUsage?.snap?.providers?.length, null, { timeout: 15000 });
        await nap(900);
        const home = { zone: await seenText('[data-res-open="ai"]'), reconnect: await seenText('.rs-reconnect button') };
        if (view.phone) await shot('1-home');
        const aiZone = page.locator('[data-res-open="ai"]').filter({ visible: true }).first();
        let sheet = { reconnect: [], notes: [] };
        if (await aiZone.count()) {
          await aiZone.click(); await nap(700);
          sheet = { reconnect: await seenText('.rs-sheet .us-reconnect'), notes: await seenText('.rs-sheet .us-notes') };
          await shot('2-ai-accounts');
          await page.evaluate(() => window.WosResources?.back?.()); await nap(300);
        }
        // The failed thread.
        const errRow = () => page.evaluate(() => [...document.querySelectorAll('.ch-err[data-errsid="qa-p1"]')].filter(el => el.getClientRects().length).map(el => [...el.querySelectorAll('.ch-err-b button')].map(b => b.textContent.trim())));
        await page.waitForFunction(() => window.WizLive?.session?.('qa-p1') || window.WizLive?.sessionFor?.('qa-p1', 'philosopher'), null, { timeout: 20000 }).catch(() => {});
        if (view.main) {
          await page.evaluate(() => __wos.openWizardThread('qa-p1'));
        } else if (view.phone) {
          await page.evaluate(() => __wos.openAgentChats('philosopher')); await nap(800);
          await page.locator('[data-chopen="qa-p1"]').filter({ visible: true }).first().click();
        } else {
          await page.evaluate(() => window.WizOpenAgentChats?.('philosopher')); await nap(1000);
          await page.locator('[data-chopen="qa-p1"]').filter({ visible: true }).first().click();
        }
        await page.waitForSelector('.ch-fail', { state: 'visible', timeout: 15000 });
        await nap(800);
        const errors1 = await errRow();
        const generic = await page.evaluate(() => [...document.querySelectorAll('.msg, .appr')].filter(el => el.getClientRects().length).some(el => /not processed|Send it again if you still want/.test(el.textContent)));
        if (!broken) await page.waitForSelector('.ch-fail [data-chreconnect]', { state: 'visible', timeout: 10000 }).catch(() => {});
        await nap(800);
        const card = () => page.evaluate(() => {
          const c = [...document.querySelectorAll('.ch-fail')].find(el => el.getClientRects().length);
          return c ? { text: c.querySelector('.lb')?.textContent + ' | ' + c.querySelector('p')?.textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()) } : null;
        });
        const first = await card();
        await shot('3-card');
        // One tap on the card's first button: record where it goes (the shell's WizOpenApp).
        await page.evaluate(() => { window.__opened = []; const o = window.WizOpenApp; window.WizOpenApp = (id, p) => { window.__opened.push([id, p || '']); return true; }; window.__realOpen = o; });
        await page.evaluate(() => [...document.querySelectorAll('.ch-fail')].find(el => el.getClientRects().length)?.querySelector('[data-chreconnect]')?.click());
        const opened = await page.evaluate(() => window.__opened);
        // Reconnected: the reading comes back signed in, the card offers Retry (send again).
        st.signedIn = true;
        await page.evaluate(() => window.WosUsage.load(true));
        await nap(900);
        const afterReconnect = await card();
        await shot('4-card-reconnected');
        const r = { name, home, sheet, first, errRows: errors1, generic, opened, afterReconnect, errors };
        report.push(r);
        if (broken) {
          assert.match(first.text, /Needs retry/, `${name}: main shows the generic Needs retry card for an expired sign-in`);
          assert.ok(first.buttons.includes('Retry'), `${name}: main offers Retry`);
          assert.deepEqual(home.reconnect, [], `${name}: main has no Reconnect on Home`);
          assert.deepEqual(sheet.reconnect, [], `${name}: main has no Reconnect in AI accounts`);
          assert.ok(generic, `${name}: main shows the generic not-processed line`);
        } else {
          assert.match(first.text, /This didn’t send because your Claude subscription is disconnected/, `${name}: the card says why`);
          assert.equal((first.text.split(' | ')[0].match(/Claude/g) || []).length, 1, `${name}: the title names Claude once`);
          assert.ok(!generic, `${name}: no generic not-processed line above the card`);
          for (const b of errors1) { assert.ok(!b.includes('Retry'), `${name}: the Errors row offers no Retry`); assert.equal(b[0], 'Reconnect Claude', `${name}: the Errors row offers Reconnect`); }
          assert.ok(!sheet.notes.some(n => /press Connect|Open the Claude app/.test(n)), `${name}: no Open-the-app sentence beside Reconnect`);
          assert.equal(first.buttons[0], 'Reconnect Claude', `${name}: Reconnect is the primary button`);
          assert.ok(!first.buttons.includes('Retry'), `${name}: no Retry while signed out`);
          assert.deepEqual(opened, [['wizard-claude', '/wizard-claude/?reconnect=1']], `${name}: one tap opens the Claude app at Reconnect`);
          assert.ok(afterReconnect.buttons.includes('Retry'), `${name}: after reconnecting the card offers Retry`);
          assert.ok(!afterReconnect.buttons.some(b => /Reconnect/.test(b)), `${name}: no Reconnect once signed in`);
          if (home.zone.length) assert.deepEqual(home.reconnect, ['Reconnect Claude'], `${name}: Home shows Reconnect Claude`);
          if (sheet.notes.length) assert.deepEqual(sheet.reconnect, ['Reconnect Claude'], `${name}: AI accounts shows Reconnect Claude`);
        }
        assert.deepEqual(errors, [], `${name}: no page errors`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
