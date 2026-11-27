'use strict';
// wizard-ux issue 1443 in a real browser: the AI apps desktop sidebar follows Settings › Chats › Default Chats (on for
// everyone; the switch wizard/sidebar-chats-view was removed). The real shell on a synthetic origin (every write answered locally, no box
// reached). The installed look comes the way an App Store look like Telegram Style does: an apps.json entry that
// provides `chats` with a wizard.chats-view/1 module, picked as `slots.chats.default` in the app list, its module
// fetched, linted and imported by core/chats-view.js. Its code is the shell's development provider
// (core/chats-fixture-view.js) under another id. Cases at 1440x900, Nebula + Grove:
//   fixture      the provider fills the sidebar list (stock rows hidden); a tap opens that thread in the main chat;
//                the collapsed rail hands the provider the rail's real width; opening the sidebar again moves it back
//   throws       a provider that fails to mount: a toast, and the stock rows come back (built-in Chats)
//   builtin      built-in Chats picked: the stock rows, nothing mounted; a row tap opens that thread in the main
//                chat column, never in a hidden second Chats window (issue 1460)
// QA_CASES=fixture,... picks cases; QA_OUT=<dir> keeps the screenshots; QA_EXPECT=broken (a build from before issue
// 1443, where the look needed a switch) asserts the sidebar keeps the stock rows with the look picked.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://sidebar-chats-view.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'sidebar-chats-view-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: false, preview: s.preview, wizard_attention: { subject: s.subject } });
const ROWS = [
  { id: 'qa-a1', title: 'Launch checklist', subject: 'Launch', at: now - 5 * 6e4, preview: 'Which date works?' },
  { id: 'qa-a2', title: 'Weekend plans', subject: 'Home', at: now - 60 * 6e4, preview: 'Here is a plan.' },
  { id: 'qa-a3', title: 'Voice keys', subject: 'Launch', at: now - 2 * 36e5, preview: 'Mapped the keys.' },
].map(shape);
// Two installed looks: one that works, one that throws when it mounts (the built-in fallback).
const FIXTURE = fs.readFileSync(path.join(repo, 'web/core/chats-fixture-view.js'), 'utf8');
const VIEW = id => FIXTURE.replace("id: 'chats-fixture', name: 'Chats by subject (fixture)'", `id: '${id}', name: 'QA look ${id}'`);
const LOOKS = ['qa-look', 'qa-broken'].map(id => ({ id, name: 'QA look ' + id, source: 'apps.json', url: `/${id}/`, provides: ['chats'], chats_view: { contract: 'wizard.chats-view/1', module: 'view.js' } }));
const CASES = (process.env.QA_CASES || 'fixture,throws,builtin').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const name of CASES) for (const skin of ['nebula', 'grove']) {
      const look = name.endsWith('fixture') ? 'qa-look' : name.endsWith('throws') ? 'qa-broken' : 'wizard-chats';
      const stem = `${name}-${skin}`, entry = { stem, errors: [], writes: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ skin, mix, look }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (p.includes('/v1/runs')) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) { entry.writes.push(method + ' ' + p); return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } }); }
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, endpoints: { apps: '/wizard/v1/apps', transcribe: 'api/transcribe', route: 'api/route' },
            capabilities: { voice: true, router: true, files: true, approvals: true, steer: true }, settings: { agent: { name: 'Wizard' } } } });
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: LOOKS, slots: { chats: { default: look } } } });
          if (p === '/qa-look/view.js') return r.fulfill({ contentType: 'text/javascript', body: VIEW('qa-look') });
          if (p === '/qa-broken/view.js') return r.fulfill({ contentType: 'text/javascript', body: VIEW('qa-broken').replace('mount(el, host) {', 'mount(el, host) { if (host) throw Error(\'QA: this look fails to mount\');') });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') ? [] : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps' && document.querySelector('.aad-side'), null, { timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.ok && WizLive.sessions.length === 3, null, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(900);
        const shot = n => page.screenshot({ path: path.join(out, `${stem}-${n}.png`) });
        const state = () => page.evaluate(() => {
          const shown = n => !!n && n.getClientRects().length > 0 && !n.closest('[hidden]');
          const view = document.querySelector('.aad-cview'), side = document.querySelector('.aad-side');
          return { view: shown(view), inRail: !!view?.closest('.aad-rail'), viewW: view ? Math.round(view.getBoundingClientRect().width) : 0,
            sideW: Math.round(side.getBoundingClientRect().width), fixture: shown(document.querySelector('.aad-cview [data-chats-fixture]')),
            fixtureRows: [...document.querySelectorAll('.aad-cview [data-fixture-thread]')].map(b => b.dataset.fixtureThread),
            stockRows: [...document.querySelectorAll('.aad-scroll .aad-rw')].filter(shown).map(n => n.dataset.sid),
            railList: shown(document.querySelector('.aad-rlist')), side: document.documentElement.dataset.aadSide,
            defaultId: window.WizChatsHost?.defaultId?.(), toast: document.querySelector('.toast, #toast, .wz-toast')?.textContent || '' };
        });
        let s = await state(); entry.first = s; await shot('1-sidebar');
        const winsNow = () => page.evaluate(() => ({ wins: Object.values(__wux.wins).map(w => [w.id, w.app, w.chatsProvider || '', w.thread || '']), ws: __wux.ws.map(d => d.wins), def: WizChatsHost.defaultId() }));
        entry.windows = await winsNow();
        if (name === 'fixture' && !broken) {
          assert.equal(s.defaultId, 'qa-look', 'the picked look is the Default Chats');
          assert.ok(s.view && s.fixture, 'the provider draws the sidebar list: ' + JSON.stringify(s));
          assert.deepEqual(s.stockRows, [], 'no stock rows under it');
          assert.deepEqual([...s.fixtureRows].sort(), ROWS.map(r => r.id).sort(), 'every thread listed by the provider');
          // a tap opens that thread in the main chat (the provider's host.openThread)
          await page.locator('.aad-cview [data-fixture-thread="qa-a2"]').click();
          await page.waitForFunction(() => [...document.querySelectorAll('#stage .ch-thread .msg')].some(n => n.getClientRects().length && /Here is a plan/.test(n.textContent)), null, { timeout: 8000 }).catch(() => {}); await nap(500);
          const opened = await page.evaluate(() => ({ chat: document.documentElement.hasAttribute('data-aad-chat'),
            thread: [...document.querySelectorAll('#stage .ch-thread .ch-head .ti b, .aad-ctop .aad-tt')].map(n => n.textContent).join(' | '),
            stillView: !!document.querySelector('.aad-cview [data-chats-fixture]'),
            reply: [...document.querySelectorAll('#stage .ch-thread .msg')].some(n => n.getClientRects().length && /Here is a plan/.test(n.textContent)),
            headerClear: (() => { const h = document.querySelector('.aad-panel .aad-head, .aad-panel > header, .aad-panel > :first-child').getBoundingClientRect(), v = document.querySelector('.aad-cview').getBoundingClientRect(); return v.top >= h.bottom - 1; })() }));
          entry.opened = opened; await shot('2-opened'); entry.windowsAfter = await winsNow();
          assert.ok(opened.chat, 'the thread docks in the main chat column');
          assert.match(opened.thread, /Weekend plans/, 'the tapped thread is open');
          assert.ok(opened.stillView, 'the sidebar keeps the provider list (no thread drawn in it)');
          assert.ok(opened.reply, 'the thread\'s messages show in the main chat');
          assert.ok(opened.headerClear, 'the provider list sits below the sidebar header');
          // the collapsed rail: the provider gets the rail's real width
          await page.locator('.aad-panel .aad-tog').click(); await nap(700);
          s = await state(); entry.rail = s; await shot('3-rail');
          assert.equal(s.side, 'rail');
          assert.ok(s.view && s.inRail && s.fixture, 'the provider list moves into the rail: ' + JSON.stringify(s));
          assert.ok(!s.railList, 'the rail\'s own counts are hidden');
          assert.ok(s.viewW > 20 && s.viewW <= s.sideW, 'rail width handed over: ' + s.viewW + ' of ' + s.sideW);
          await page.locator('.aad-rail .aad-rtog').click(); await nap(700);
          s = await state(); entry.reopened = s; await shot('4-open-again');
          assert.ok(s.view && !s.inRail && s.fixture, 'back in the open sidebar: ' + JSON.stringify(s));
        } else if (name === 'throws') {
          assert.ok(!s.view, 'a failing provider never owns the sidebar: ' + JSON.stringify(s));
          assert.equal(s.stockRows.length, 3, 'built-in rows come back');
        } else {
          // builtin, and an old build (QA_EXPECT=broken) for fixture: the stock rows, nothing mounted
          assert.ok(!s.view, name + ': nothing mounted ' + JSON.stringify(s));
          assert.equal(s.stockRows.length, 3, name + ': the stock rows ' + JSON.stringify(s));
        }
        if (name === 'builtin') {
          // wizard-ux issue 1460: a stock sidebar row opens in the main chat column, never in a second Chats window
          // that the layout does not show
          await page.locator('.aad-scroll .aad-rw[data-sid="qa-a2"]').first().click();
          await page.waitForFunction(() => [...document.querySelectorAll('#stage .ch-thread .msg')].some(n => n.getClientRects().length && /Here is a plan/.test(n.textContent)), null, { timeout: 8000 }).catch(() => {}); await nap(500);
          const w = await winsNow(), chats = w.wins.filter(x => x[1] === 'chats');
          const tapped = await page.evaluate(() => ({ chat: document.documentElement.hasAttribute('data-aad-chat'),
            reply: [...document.querySelectorAll('#stage .ch-thread .msg')].some(n => n.getClientRects().length && /Here is a plan/.test(n.textContent)),
            appsChats: [...document.querySelectorAll('.aad-vtab')].filter(n => n.getClientRects().length && /^\s*Chats\s*$/.test(n.textContent || '')).length }));
          entry.tapped = { ...tapped, windows: w }; await shot('6-row-tapped');
          assert.equal(chats.length, 1, 'one Chats window, no hidden second one: ' + JSON.stringify(w));
          assert.ok(tapped.chat && tapped.reply, 'the tapped thread shows in the main chat column: ' + JSON.stringify(entry.tapped));
          assert.equal(tapped.appsChats, 0, 'no extra Chats item under Apps');
        }
        assert.deepEqual(entry.errors, [], 'no page errors');
        entry.pass = true;
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`PASS desktop sidebar follows Default Chats${broken ? ' (old build: stock rows only)' : ''}: ${CASES.join(', ')} × nebula, grove`);
  } catch (e) { fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
