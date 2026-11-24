'use strict';
// wizard-ux issue 1504 in a real browser: with Channels on (wizard/chat-channels), the orb badge, Home's Ready count and
// the Activity Ready list show the same number. 2 green (finished, unread) + 4 amber (needs you, already opened) threads,
// one of them Claude's. Phone 412x915 and desktop 1440x900 (Classic), Nebula + Grove. Disposable synthetic transport only.
// QA_WEB=<main>/web QA_EXPECT=broken checks the bug on main; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://activity-ready.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'activity-ready-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: !!s.archived, preview: s.preview || 'Done.', ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const ask = a => ({ state: 'needs_you', ask: a });
const ROWS = [
  { id: 'qa-g1', title: 'Weekend plans', at: now - 40 * 6e4, preview: 'Here is a plan.' },
  { id: 'qa-g2', title: 'Press notes', at: now - 70 * 6e4, preview: 'Notes are ready.' },
  { id: 'qa-y1', title: 'Launch checklist', at: now - 2 * 36e5, attention: ask('Pick a date') },
  { id: 'qa-y2', title: 'Store listing', at: now - 3 * 36e5, attention: ask('Approve the text') },
  { id: 'qa-y3', title: 'Invoice', at: now - 5 * 36e5, attention: ask('Which account?') },
  { id: 'qa-r1', title: 'Voice keys', at: now - 6 * 36e5 },
  { id: 'qa-w1', title: 'Drafting', status: 'running', at: now - 5 * 6e4, preview: 'Drafting…' },
].map(shape);
const CLAUDE = [{ id: 'qa-cy', title: 'Essay outline', at: now - 4 * 36e5, attention: ask('Short or long?') }].map(shape);
const READ = ['qa-y1', 'qa-y2', 'qa-y3', 'qa-cy', 'qa-r1'];   // the amber ones were already opened: still needs you
const cases = (process.env.QA_CASES || 'phone,desktop').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`, entry = { stem, errors: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ phone, skin, mix }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { phone, skin, mix });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') === 'claude' ? CLAUDE : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...ROWS, ...CLAUDE].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.ok && (window.WizLive.agentSessions?.claude || []).length === 1, null, { timeout: 15000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(ids => { for (const id of ids) WizLive.markSeen(id); WizLive.emit(); }, READ);
        await page.evaluate(() => document.fonts.ready); await nap(800);
        const shot = n => page.screenshot({ path: path.join(out, `${stem}-${n}.png`) });
        const num = t => Number(String(t || '').trim().replace(/\D+/g, '') || 0);
        if (phone) {
          entry.home = num(await page.locator('.now-card[data-act="ready"] .n').first().textContent().catch(() => '0'));
          await shot('home');
          await page.evaluate(() => __wos.openSheet('inbox')); await nap(900);
          entry.orb = num(await page.locator('#orbBadge').textContent());
        } else {
          await page.evaluate(() => __wux.goHome()); await nap(700);
          entry.home = num((/(\d+) (?:unread|ready)/.exec(await page.locator('.home-line').filter({ visible: true }).first().innerText()) || [])[1]);
          await shot('home');
          await page.evaluate(() => __wux.openChatsList()); await nap(900);
          entry.orb = num(await page.locator('#wsList .ws .dbg').first().textContent().catch(() => '0'));
        }
        const sec = page.locator('.ch-sec[data-sec="ready"]').filter({ visible: true }).first();
        entry.activity = num(await sec.locator('.ch-sec-h small').textContent());
        if (await sec.getAttribute('class').then(c => !c.includes('open'))) { await sec.locator('.ch-sec-h').click(); await nap(400); }
        entry.rows = await sec.locator('[data-chopen]').evaluateAll(n => [...new Set(n.map(x => x.dataset.chopen))]);
        await shot('activity');
        assert.equal(entry.activity, 6, 'Activity Ready lists the 2 green + 4 amber: ' + JSON.stringify(entry));
        if (broken) assert.ok(entry.orb !== 6 || entry.home !== 6, 'main: a badge disagrees with Activity ' + JSON.stringify(entry));
        else { assert.equal(entry.orb, 6, 'badge = Activity Ready ' + JSON.stringify(entry)); assert.equal(entry.home, 6, 'Home = Activity Ready ' + JSON.stringify(entry)); }
        assert.deepEqual(entry.errors, []);
        entry.pass = true;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report.map(({ stem, home, orb, activity, pass }) => ({ stem, home, orb, activity, pass }))));
})().catch(e => { console.error(e); process.exit(1); });
