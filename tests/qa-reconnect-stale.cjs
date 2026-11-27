'use strict';
// wizard-ux issue 1799 in a real browser: phone 412x915 (Nebula) and desktop 1440x900.
// A thread whose send failed while Claude was signed out carries the Agent Service's stored diagnosis
// (wizard_reconnect, provider-reconnect.mjs). Two cases:
//  A. The owner already signed Claude back in (the /wizard/ai-usage reading says Claude is ok): the thread card,
//     its Chats row and the Errors row must offer a plain Retry, never "Claude sign-in expired" / "Sign in".
//  B. Claude reads signed out when the thread is shown (the sign-in card is right), then the owner signs back in:
//     the card's promise ("Sign in to Claude and it will send … on its own") holds: the saved message is sent again
//     once (a POST /v1/runs with wizard_retry_run_id), without a tap.
// Synthetic transport, every production write answered locally. QA_EXPECT=broken (QA_WEB=<main>/web) asserts the
// old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://reconnect-stale.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reconnect-stale-evidence');
const broken = process.env.QA_EXPECT === 'broken', tag = broken ? '-before' : '';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const AGENTS = [{ id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'claude', model: 'claude-haiku-4-5' } }];
const baseRow = signedIn => ({ id: 'qa-s1', title: 'Test', source: 'wizard-mobile', status: 'failed', model: 'claude-haiku-4-5', provider: 'claude',
  updated_at: iso(now - 6e5), last_active: (now - 6e5) / 1000, message_count: 1, preview: 'Test', wizard_run_id: 'run_s1', wizard_last_run_id: 'run_s1',
  wizard_last_run_status: 'failed', wizard_last_user_at: (now - 6e5) / 1000, wizard_safe_error: 'Claude sign-in expired', wizard_retry_run_id: 'run_s1',
  wizard_reconnect: { kind: 'provider_signed_out', provider: 'claude', app_id: 'wizard-claude', app_name: 'Claude', run_id: 'run_s1', installed: true, app_status: signedIn ? 'connected' : 'expired' } });
const usage = signedIn => ({ fetchedAt: iso(Date.now()), providers: [signedIn
  ? { id: 'claude', name: 'Claude', status: 'ok', fetchedAt: iso(Date.now()), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 70, resetsAt: iso(now + 864e5) }] }
  : { id: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: null, limits: [], error: { code: 'expired', message: 'Claude sign-in has expired.' } }] });
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const view of [{ phone: true, case: 'A' }, { phone: false, case: 'A' }, { phone: true, case: 'B' }, { phone: false, case: 'B' }]) {
      const name = `${view.phone ? 'phone' : 'desktop'}-${view.case}`;
      const context = await browser.newContext(view.phone
        ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' }
        : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      const errors = [], st = { signedIn: view.case === 'A', resent: false }, runs = [];
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ phone }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return;
          sessionStorage.setItem('qa.seeded', '1');
          const shell = phone ? 'phone' : 'desktop';
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.desktop-view.v1': 'classic' })) localStorage.setItem(k, v);
        }, view);
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        const row = () => st.resent ? { ...baseRow(true), status: 'running', wizard_last_run_status: 'running', wizard_run_id: 'run_s2', wizard_reconnect: undefined, wizard_safe_error: undefined } : baseRow(st.signedIn);
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (method === 'POST' && p === '/wizard/hermes/v1/runs') {
            let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
            runs.push(body); st.resent = true;
            return r.fulfill({ status: 202, json: { run_id: 'run_s2', status: 'queued' } });
          }
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
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row()], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            if (decodeURIComponent(m[1]) !== 'qa-s1') return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Test', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', timestamp: now / 1000 - 590 }] } : { session: row() } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        const shot = n => page.screenshot({ path: path.join(out, `${name}-${n}${tag}.png`) });
        const card = () => page.evaluate(() => {
          const c = [...document.querySelectorAll('.ch-fail')].find(el => el.getClientRects().length);
          return c ? { text: c.querySelector('.lb')?.textContent + ' | ' + c.querySelector('p')?.textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()) } : null;
        });
        const rowsSeen = () => page.evaluate(() => [...document.querySelectorAll('.ch-row-wrap, .ch-err')].filter(el => el.getClientRects().length && el.querySelector('[data-chopen="qa-s1"], [data-errsid="qa-s1"]') || el.matches?.('[data-errsid="qa-s1"]'))
          .filter(el => el.getClientRects().length).map(el => el.textContent.replace(/\s+/g, ' ').trim()));
        await page.goto(origin + prefix + (view.phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => window.WosAgents?.list?.length === 1, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(() => window.WosUsage?.load?.(true));
        await page.waitForFunction(() => window.WizLive?.session?.('qa-s1'), null, { timeout: 20000 }).catch(() => {});
        await page.evaluate(() => window.__wos?.openWizardThread ? __wos.openWizardThread('qa-s1') : window.WizOpenAgentChats?.('hermes'));
        if (!view.phone) { await nap(800); const l = page.locator('[data-chopen="qa-s1"]').filter({ visible: true }).first(); if (await l.count()) await l.click(); }
        await page.waitForSelector('.ch-fail', { state: 'visible', timeout: 15000 });
        await nap(1200);
        const first = await card();
        await shot('1-card');
        const r = { name, first, errors, runs };
        if (view.case === 'A') {
          // The Chats list (phone: Back to the list; desktop: the sidebar list is already visible).
          if (view.phone) { await page.evaluate(() => window.__wos?.openAgentChats ? __wos.openAgentChats('hermes') : null); await nap(1000); }
          r.rows = await rowsSeen();
          await shot('2-list');
          r.signInButtons = await page.evaluate(() => [...document.querySelectorAll('.ch-row-signin')].filter(el => el.getClientRects().length).length);
          if (broken) {
            assert.match(first.text, /Claude sign-in expired/, `${name}: main shows the stale sign-in card`);
          } else {
            assert.doesNotMatch(first.text, /sign-in expired|disconnected/, `${name}: no sign-in card once Claude is signed in`);
            assert.ok(first.buttons.includes('Retry'), `${name}: the card offers Retry`);
            assert.ok(!first.buttons.some(b => /Sign in|Reconnect/.test(b)), `${name}: no Sign in button once signed in`);
            assert.ok(!r.rows.some(t => /sign-in expired/.test(t)), `${name}: no row says sign-in expired`);
            assert.equal(r.signInButtons, 0, `${name}: no row Sign in button`);
          }
        } else {
          assert.match(first.text, /Claude sign-in expired/, `${name}: while signed out the sign-in card shows`);
          // The owner signs Claude back in elsewhere (Home, the Claude app): the reading comes back ok.
          st.signedIn = true;
          await page.evaluate(() => window.WosUsage.load(true));
          await nap(4000);
          await page.evaluate(() => window.WizLive?.refresh?.());
          await nap(1500);
          r.afterSignIn = await card();
          r.runs = runs;
          await shot('2-after-signin');
          if (broken) {
            assert.equal(runs.length, 0, `${name}: main never resends on its own`);
          } else {
            assert.equal(runs.length, 1, `${name}: the saved message is sent again once, without a tap`);
            assert.equal(runs[0].wizard_retry_run_id, 'run_s1', `${name}: the resend is the saved request (idempotent with the box's own resend)`);
            assert.ok(!r.afterSignIn || !/sign-in expired/.test(r.afterSignIn.text), `${name}: no sign-in card after signing in`);
          }
        }
        report.push(r);
        assert.deepEqual(errors, [], `${name}: no page errors`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
