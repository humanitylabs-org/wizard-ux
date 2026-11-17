'use strict';
// wizard-ux issue 1488 in a real browser: phone 412x915, Nebula and Grove. A routed agent's thread (Philosopher)
// whose last send failed shows "Needs retry · <model>" and the red Error mark in the header. Tap Dismiss while the
// Agent Service refuses the save (409, as main-only services did): the card and the header mark go on the same
// frame, no "Couldn't dismiss" toast, and after a reload the card stays gone. Synthetic transport only (no box).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://failure-dismiss.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'failure-dismiss-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'philosopher', label: 'Philosopher', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'p', hue: 30 }, model: { provider: 'anthropic', model: 'claude-fable' } },
];
const row = { id: 'qa-p1', title: 'On virtue', source: 'wizard-mobile', status: 'failed', model: 'claude-fable', provider: 'anthropic', updated_at: iso(now - 6e5), last_active: (now - 6e5) / 1000,
  message_count: 2, preview: 'What is virtue?', wizard_run_id: 'run_p1', wizard_last_run_id: 'run_p1', wizard_last_run_status: 'failed', wizard_last_user_at: (now - 6e5) / 1000, agent: 'philosopher' };
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of ['nebula', 'grove']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      const errors = [], dismissals = [];
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return;
          sessionStorage.setItem('qa.seeded', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
        }, { skin });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (/^\/wizard\/session-failure\/[^/]+\/dismiss$/.test(p)) { dismissals.push(q.postData()); return r.fulfill({ status: 409, json: { error: 'unsupported_action', check: 'agent.unsupported_action' } }); }
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          const agent = u.searchParams.get('agent') || '';
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: agent === 'philosopher' ? [row] : [], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            if (decodeURIComponent(m[1]) !== row.id || agent !== 'philosopher') return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'What is virtue?', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', timestamp: now / 1000 - 590 }] } : { session: row } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /chat-errors|dismiss/i.test(m.text())) errors.push(m.text()); });
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const open = async () => {
          await page.goto(origin + prefix + 'index.html?phone');
          await page.waitForFunction(() => window.__wos && window.WosAgents?.list?.length === 2, null, { timeout: 20000 });
          await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
          await page.waitForFunction(() => window.WizLive?.session?.('qa-p1'), null, { timeout: 20000 });
          await page.evaluate(() => __wos.openAgentChats('philosopher'));
          await nap(800);
          await page.locator('[data-chopen="qa-p1"]').filter({ visible: true }).first().click();
          await nap(1200);
        };
        const state = () => page.evaluate(() => {
          const seen = el => !!el && el.getClientRects().length > 0;
          const card = [...document.querySelectorAll('.ch-fail')].find(seen), mark = [...document.querySelectorAll('.ch-head-sti.failed')].find(seen);
          const t = document.getElementById('toast');
          return { card: !!card, mark: !!mark, toast: t && t.classList.contains('show') ? t.textContent.trim() : '' };
        });
        await open();
        const before = await state();
        assert.equal(before.card, true, `${skin}: the Needs retry card shows`);
        assert.equal(before.mark, true, `${skin}: the header shows the Error mark`);
        await page.screenshot({ path: path.join(out, `${skin}-1-card${broken ? '-before' : ''}.png`) });
        // Tap Dismiss and read the very next frame.
        const next = await page.evaluate(() => new Promise(resolve => {
          const b = [...document.querySelectorAll('.ch-fail [data-chdismiss]')].find(el => el.getClientRects().length);
          b.click();
          requestAnimationFrame(() => {
            const seen = el => !!el && el.getClientRects().length > 0;
            resolve({ card: [...document.querySelectorAll('.ch-fail')].some(seen), mark: [...document.querySelectorAll('.ch-head-sti.failed')].some(seen) });
          });
        }));
        await nap(900);
        const after = await state();
        await page.screenshot({ path: path.join(out, `${skin}-2-after-dismiss${broken ? '-before' : ''}.png`) });
        await open();
        const reloaded = await state();
        await page.screenshot({ path: path.join(out, `${skin}-3-after-reload${broken ? '-before' : ''}.png`) });
        report.push({ skin, before, next, after, reloaded, dismissals, errors });
        if (broken) {
          assert.match(after.toast, /Couldn’t dismiss/, `${skin}: main says it couldn't dismiss`);
          assert.equal(after.card, true, `${skin}: main keeps the card`);
        } else {
          assert.deepEqual(next, { card: false, mark: false }, `${skin}: the card and the header mark go on the next frame`);
          assert.deepEqual({ card: after.card, mark: after.mark }, { card: false, mark: false }, `${skin}: still gone after the refusal`);
          assert.doesNotMatch(after.toast, /Couldn/, `${skin}: no error toast`);
          assert.deepEqual({ card: reloaded.card, mark: reloaded.mark }, { card: false, mark: false }, `${skin}: still gone after a reload`);
          assert.ok(dismissals.some(b => JSON.parse(b || '{}').agent_id === 'philosopher'), `${skin}: the save names the thread's own agent`);
          assert.ok(dismissals.length >= 2, `${skin}: the refused save is tried again quietly (reload)`);
        }
        assert.deepEqual(errors, [], `${skin}: no page errors`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
