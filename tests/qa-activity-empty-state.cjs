'use strict';
// wizard-ux issue 1731 in a real browser: Chats › Activity on a fresh box shows one friendly empty state, never a stack
// of empty sections ('None', 'Nothing needs you.', an empty count pill, the Ready sort menu). As soon as a section holds
// a chat it appears with its header; Snoozed appears when a chat is snoozed and goes again when it is unsnoozed.
// Phone 412x915 and the AI apps desktop 1440x900, in Nebula and Light, plus a live skin change. Synthetic transport only
// (no box is reached; writes are answered in memory). QA_WEB=<another tree>/web QA_EXPECT=broken runs the baseline and
// asserts the old empty sections are there; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://activity-empty.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'activity-empty-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const AGENTS = [{ id: 'hermes', label: 'Wizard', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: false, preview: 'Hello! How can I help?', ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const ACT = ['working', 'ready', 'recent', 'snoozed', 'archived', 'archive'];
const cases = (process.env.QA_CASES || 'phone,ai-apps').split(','), skins = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of skins) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`, entry = { stem, errors: [] }; report.push(entry);
      const ROWS = [], DISP = {};
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ phone, skin }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
        }, { phone, skin });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/thread-dispositions') { const b = q.postDataJSON(); const rec = { deferred: !!b.deferred, updatedAt: new Date().toISOString() }; DISP[b.sessionId] = rec; return r.fulfill({ json: { record: rec } }); }
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Hi', timestamp: now / 1000 - 60 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 50 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (!phone) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.ok, null, { timeout: 15000 });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox'));
        await page.evaluate(() => document.fonts.ready); await nap(800);
        const shot = n => page.screenshot({ path: path.join(out, `${stem}-${n}.png`) });
        const list = phone ? '.ch-list' : '.aad-side';
        // The Activity sections drawn now, with their header counts and the Ready sort control.
        const state = () => page.evaluate(({ phone, list, ACT }) => {
          const seen = e => !!e && e.getClientRects().length > 0, root = [...document.querySelectorAll(list)].find(seen);
          if (!root) return { missing: true };
          const secs = phone ? [...root.querySelectorAll('.ch-sec[data-sec]')].filter(seen).map(s => s.dataset.sec).filter(k => ACT.includes(k))
            : [...root.querySelectorAll('.aad-sec[data-sec]')].filter(seen).map(s => s.dataset.sec).filter(k => ACT.includes(k));
          const pills = phone ? [...root.querySelectorAll('.ch-sec-h small')].filter(seen).map(s => s.textContent) : [...root.querySelectorAll('.aad-sec :is(.aad-sec-n, .aad-sec-m)')].filter(seen).map(s => s.textContent);
          const nones = [...root.querySelectorAll(phone ? '.ch-none' : '.aad-empty')].filter(seen).map(s => s.textContent.trim());
          const sort = [...root.querySelectorAll(phone ? '[data-chactorder]' : '.aad-act-orderb')].filter(seen).length;
          const empty = [...root.querySelectorAll(phone ? '.ch-act-empty' : '.aad-act-empty')].filter(seen).map(e => {
            const r = e.getBoundingClientRect(), b = e.querySelector('button'), c = document.createElement('canvas').getContext('2d');
            let el = e, bg = 'rgba(0, 0, 0, 0)'; while (el && el !== document.documentElement) { const g = getComputedStyle(el); if (g.backgroundColor !== 'rgba(0, 0, 0, 0)' || g.backgroundImage !== 'none') { bg = g.backgroundColor; break; } el = el.parentElement; }
            c.fillStyle = bg; c.fillRect(0, 0, 1, 1);
            return { text: e.innerText.replace(/\s+/g, ' ').trim(), button: b ? b.innerText.trim() : '', box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], panelAlpha: c.getImageData(0, 0, 1, 1).data[3], color: getComputedStyle(e).color };
          });
          return { secs, pills, nones, sort, empty };
        }, { phone, list, ACT });
        // (On the AI apps desktop the sidebar repaints when Chats draws (WosSkinHost.rendered); in a real send the thread
        // being typed in draws. Here no thread is open, so the harness gives that same signal.)
        const refresh = async () => { await page.evaluate(async () => { await WizLive.refresh(); WizLive.emit(); }); await nap(300); await page.evaluate(() => window.WosSkinHost?.rendered?.('list', null)); await nap(400); };
        // The lists repaint on their own schedule: read again until the wanted sections show (or 5 s pass).
        const settle = async ok => { let st; for (let i = 0; i < 25; i++) { st = await state(); if (ok(st)) break; await nap(200); } return st; };
        // 1. Fresh box: only the empty state.
        entry.fresh = await state();
        await shot('1-fresh');
        if (broken) {
          assert.ok(entry.fresh.secs.length >= 4, 'baseline draws the empty sections: ' + JSON.stringify(entry.fresh));
          entry.pass = true; continue;
        }
        assert.deepEqual(entry.fresh.secs, [], 'no Activity sections on a fresh box: ' + JSON.stringify(entry.fresh));
        assert.deepEqual(entry.fresh.nones, [], 'no None lines');
        assert.equal(entry.fresh.sort, 0, 'no Ready sort menu');
        assert.equal(entry.fresh.empty.length, 1, 'one friendly empty state');
        assert.match(entry.fresh.empty[0].text, /No chats yet/);
        assert.ok(entry.fresh.empty[0].button, 'a way to start a chat');
        assert.ok(entry.fresh.empty[0].box[2] > 150 && entry.fresh.empty[0].box[3] > 30, 'the empty state has room: ' + JSON.stringify(entry.fresh.empty[0].box));
        assert.equal(entry.fresh.empty[0].panelAlpha, 255, 'the empty state sits on an opaque panel');
        // A live skin change keeps it right.
        const other = skin === 'nebula' ? 'obsidian-light' : 'nebula';
        await page.evaluate(id => WosSkin.set(id), other).catch(() => {});
        await nap(900); entry.liveSkin = { to: other, applied: await page.evaluate(() => WosSkin.current || document.documentElement.dataset.skin || ''), state: await state() };
        assert.equal(entry.liveSkin.applied, other, 'the skin changed live');
        assert.equal(entry.liveSkin.state.empty.length, 1, 'still one empty state after the skin change');
        assert.equal(entry.liveSkin.state.empty[0].panelAlpha, 255);
        await shot('1b-live-skin-' + other);
        await page.evaluate(id => WosSkin.set(id), skin).catch(() => {}); await nap(600);
        // The start button opens a new chat.
        if (phone) { await page.locator('.ch-act-empty button').filter({ visible: true }).first().click(); await nap(600);
          entry.newChat = await page.evaluate(() => !!document.querySelector('.ch-compose textarea, [data-chcompose] textarea') && [...document.querySelectorAll('textarea')].some(t => t.getClientRects().length));
          await page.evaluate(() => __wos.onBack()); await nap(600);
          if (!(await page.locator('.ch-list').filter({ visible: true }).count())) { await page.evaluate(() => __wos.openSheet('inbox')); await nap(600); }
        } else { await page.locator('.aad-act-empty button').filter({ visible: true }).first().click(); await nap(600);
          entry.newChat = await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA' || [...document.querySelectorAll('textarea')].some(t => t.getClientRects().length)); }
        assert.ok(entry.newChat, 'the button starts a new chat');
        // 2. A first message: while it runs it is the Inbox's only row (no Working section beside Inbox: wizard-ux issues
        // 1829 and 1779, Inbox rows on for everyone), then it stays in Inbox once answered.
        ROWS.push(shape({ id: 'qa-1', title: 'First chat', status: 'running', at: Date.now() }));
        await refresh(); entry.working = await settle(st => st.secs.length > 0); await shot('2-working');
        assert.deepEqual(entry.working.secs, ['ready'], 'only Inbox: ' + JSON.stringify(entry.working));
        assert.equal(entry.working.empty.length, 0, 'no empty state once a chat exists');
        assert.ok(entry.working.pills.every(t => t.trim()), 'no empty count pill: ' + JSON.stringify(entry.working.pills));
        Object.assign(ROWS[0], shape({ id: 'qa-1', title: 'First chat', at: Date.now() }));
        await refresh(); entry.ready = await settle(st => st.secs.includes('ready')); await shot('3-ready');
        assert.deepEqual(entry.ready.secs, ['ready'], 'only Ready: ' + JSON.stringify(entry.ready));
        assert.equal(entry.ready.sort, 1, 'the Ready sort shows while Ready has a chat');
        assert.ok(entry.ready.pills.every(t => t.trim()), 'no empty count pill');
        // 3. Snooze: Snoozed appears; unsnooze: it goes.
        await page.evaluate(() => WizLive.defer('qa-1')); await nap(300); await page.evaluate(() => window.WosSkinHost?.rendered?.('list', null));
        entry.snoozed = await settle(st => st.secs.includes('snoozed')); await shot('4-snoozed');
        assert.ok(entry.snoozed.secs.includes('snoozed'), 'Snoozed appears: ' + JSON.stringify(entry.snoozed));
        assert.ok(!entry.snoozed.secs.includes('ready'), 'Ready went: ' + JSON.stringify(entry.snoozed));
        assert.equal(entry.snoozed.sort, 0, 'no Ready sort without Ready');
        await page.evaluate(() => WizLive.restore('qa-1')); await nap(300); await page.evaluate(() => window.WosSkinHost?.rendered?.('list', null));
        entry.unsnoozed = await settle(st => !st.secs.includes('snoozed')); await shot('5-unsnoozed');
        assert.ok(!entry.unsnoozed.secs.includes('snoozed'), 'Snoozed went: ' + JSON.stringify(entry.unsnoozed));
        assert.ok(entry.unsnoozed.secs.length >= 1 && entry.unsnoozed.secs.every(k => k === 'ready' || k === 'recent'), JSON.stringify(entry.unsnoozed));
        assert.deepEqual(entry.errors, []);
        entry.pass = true;
      } catch (e) { entry.fail = String(e && e.stack || e); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const e of report) console.log((e.pass ? 'PASS ' : 'FAIL ') + e.stem + (e.fail ? '\n  ' + e.fail.split('\n').slice(0, 3).join('\n  ') : ''));
  process.exitCode = report.every(e => e.pass) ? 0 : 1;
})();
