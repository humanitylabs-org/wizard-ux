'use strict';
// Inbox row preview is plain text (wizard-os issue 974), in a real browser on a disposable synthetic box. Phone
// 412x915 (Inbox rows and Pin to top are on for everyone), the Morning thread pinned on top: its row reads
// "Morning · Fri 27 Nov. Workout · Meditate · MindFeed", never the agent's raw Markdown ("**", "[Workout](/morning/)")
// nor the reply-button marker or its labels. A second thread's Markdown reply reads as words too.
//   QA_AGENT_SERVICE=<wizard-agent-service checkout>: the list rows come from that Service's real list builder
//   (server/session-list-view.mjs listRow, list v1, what boxes serve); without it, the older raw rows (live.js
//   normalizer). QA_EXPECT=broken (QA_WEB=<main>/web, and/or the Service's main): records what main shows instead.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://inbox-preview-plain-974.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'inbox-preview-plain-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), BROKEN = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const B = (group) => `[WIZARD_BUTTONS_V1]{"group":"${group}","buttons":[{"id":"done","label":"Done"}]}[/WIZARD_BUTTONS_V1]`;
const MORNING = `**Morning · Fri 27 Nov.**\n[Workout](/morning/)\n${B('Workout')}\n[Meditate](/meditate/)\n${B('Meditate')}\n[MindFeed](/mindfeed/)\n${B('MindFeed')}`;
const THREADS = {
  'qa-morning': { title: 'Morning', at: now - 60 * M, msgs: [['user', 'Morning checklist', 0], ['assistant', MORNING, 30]] },
  'qa-links': { title: 'Reading list', at: now - 20 * M, msgs: [['user', 'What should I read?', 0], ['assistant', '## Two picks\n- **[Deep Work](https://example.test/deep)** by Cal Newport\n- [Atomic Habits](https://example.test/atomic)', 30]] },
};
const EXPECT = { 'qa-morning': 'Morning · Fri 27 Nov. Workout · Meditate · MindFeed', 'qa-links': 'Two picks · Deep Work by Cal Newport · Atomic Habits' };
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length,
  preview: s.msgs.at(-1)[1], latest_message: { role: s.msgs.at(-1)[0], content: s.msgs.at(-1)[1], timestamp: s.at / 1000 }, last_assistant_at: iso(s.at) });
const report = { origin, web, service: process.env.QA_AGENT_SERVICE || '', cases: [] };
(async () => {
  const listRow = process.env.QA_AGENT_SERVICE ? (await import(pathToFileURL(path.join(process.env.QA_AGENT_SERVICE, 'server/session-list-view.mjs')).href)).listRow : null;
  const listData = () => Object.entries(THREADS).map(([k, s]) => listRow ? listRow(raw(k, s)) : raw(k, s));
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) {
      const entry = { stem: `phone-${skin}`, errors: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ skin, mix }) => {
          if (window !== top || sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: method === 'PUT' && p === '/wizard/v1/channels/read' ? { at: {} } : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: [], next: null, check: null } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null, stay: [] } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true }, pinnedChats: ['qa-morning'] } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - 864e5), channels: [] } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: listData(), has_more: false, ...(listRow ? { list_version: 1, view: 'list' } : {}) } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]), s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: s.at / 1000 - 600 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(() => __wos.openSheet('inbox'));
        await page.waitForFunction(() => !!document.querySelector('.ch-list .ch-ib-wrap.pinned [data-chopen="qa-morning"]') && !!document.querySelector('.ch-list [data-chopen="qa-links"]'), null, { timeout: 15000 });
        await nap(700);
        entry.rows = await page.evaluate(() => [...document.querySelectorAll('.ch-list .ch-ib-wrap')].filter(w => w.getClientRects().length).map(w => ({ id: w.querySelector('.ch-row')?.dataset.chopen || '', pinned: w.classList.contains('pinned'),
          pv: w.querySelector('.ch-ib-pv')?.textContent.trim() || '', shown: (() => { const n = w.querySelector('.ch-ib-pv'); return n ? n.scrollWidth > n.clientWidth ? 'ellipsis' : 'full' : ''; })() })));
        await page.evaluate(() => document.fonts.ready); await nap(300);
        await page.screenshot({ path: path.join(out, `phone-${skin}-inbox.png`) });
        const by = Object.fromEntries(entry.rows.map(r => [r.id, r]));
        assert.equal(entry.rows[0]?.id, 'qa-morning', 'Morning is pinned on top');
        for (const id of Object.keys(EXPECT)) {
          if (BROKEN) { entry[id] = by[id].pv; continue; }
          assert.equal(by[id].pv, EXPECT[id], `${id} preview`);
          assert.doesNotMatch(by[id].pv, /\*|\]\(|WIZARD_|\[Done\]|#/, `${id}: no Markdown or marker text`);
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: BROKEN ? 'broken' : 'fixed', list: listRow ? 'v1 (Agent Service listRow)' : 'raw', cases: report.cases.length, passed: report.cases.length - failed.length,
    previews: report.cases.map(c => (c.rows || []).map(r => `${r.id}: ${r.pv}`)), failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]) }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
