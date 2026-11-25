'use strict';
// Inbox keeps every thread until archived (wizard-ux issue 1810, switch wizard/inbox-until-archived) in a real browser.
// Disposable synthetic transport only. Phone 412x915 and Classic desktop 1440x960:
//   switch on: Chats › Inbox has one list (Working, then Inbox, no Recent); an unread thread opened and left with Back
//   stays in Inbox, now read; an old read thread is in Inbox too; the header count and the badge count are the Inbox
//   count; Archive in the thread removes it from Inbox and it shows under Archived.
//   QA_SWITCH=off: today's Ready / Recent split (opening a thread moves it to Recent).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-inbox-1810.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-inbox-until-archived-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula').split(','), SW = process.env.QA_SWITCH !== 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const D = 864e5;
let THREADS;
const fresh = () => ({
  'qa-chat-1': { title: 'Weather tomorrow', at: now - 20 * M, msgs: [['user', 'Tell me the weather tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind.', 30]] },
  'qa-chat-2': { title: 'Dentist slot', at: now - 50 * M, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Thursday 10:00 is free at the practice on Main Street.', 60]] },
  'qa-old': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall, herbs near the door.', 60]] },
});
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.archived ? { archived: true } : {}) });
// qa-old was read three days ago: a seen record at its last reply.
const SEEN = () => ({ state: { initializedAt: 1, threads: { 'qa-old': { updatedAt: iso(now - 3 * D), assistantActivityAt: iso(now - 3 * D + 60e3), seenAt: now - 3 * D + 120e3 } } } });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      THREADS = fresh();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SW ? { 'wizard/inbox-until-archived': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            const pm = /^\/wizard\/hermes\/api\/sessions\/([^/]+)$/.exec(p);
            if (method === 'PATCH' && pm && THREADS[decodeURIComponent(pm[1])]) { const s = THREADS[decodeURIComponent(pm[1])], b = q.postDataJSON() || {}; if ('archived' in b) s.archived = !!b.archived; return r.fulfill({ json: { session: raw(decodeURIComponent(pm[1]), s) } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: [], next: null, check: null } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'oldest', channel_total: 0, view: 'list', list_version: 1 } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([sid, s]) => raw(sid, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]), s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            entry.reads = (entry.reads || []).concat(sid + (m[2] ? ':messages' : ''));
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        // Which section each thread row sits in, and the section headers with their counts, as a person sees them.
        const lay = () => page.evaluate(() => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          const secs = [...list.querySelectorAll('section.ch-sec[data-sec]')].map(s => ({ k: s.dataset.sec, h: (s.querySelector('.ch-sec-h span')?.textContent || '').trim(), n: (s.querySelector('.ch-sec-h small')?.textContent || '').trim(), rows: [...s.querySelectorAll('[data-chopen]')].map(r => r.dataset.chopen) }));
          return { secs, where: Object.fromEntries(secs.flatMap(s => s.rows.map(r => [r, s.k]))) };
        });
        const openSecs = async () => { for (const k of ['ready', 'recent', 'archived']) { const h = page.locator(`.ch-list section[data-sec="${k}"] > .ch-sec-h, .ch-list section[data-sec="${k}"] .ch-sec-hl > .ch-sec-h`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(200); } } };
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        await nap(800); await openSecs();
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        entry.before = await lay();
        await shot('1-inbox');
        // 1. Open the unread thread, then Back.
        await vis('.ch-list [data-chopen="qa-chat-1"]').click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Sunny, 18 °C, light wind.').waitFor({ timeout: 10000 });
        await nap(600);
        if (!phone) await thread().getByText('Sunny, 18 °C, light wind.').click();
        await back(); await nap(800); await openSecs();
        await vis('.ch-list [data-chopen="qa-chat-2"]').waitFor({ timeout: 10000 });
        entry.afterRead = await lay();
        entry.readMark = await page.evaluate(() => { const r = [...document.querySelectorAll('.ch-list [data-chopen="qa-chat-1"]')].find(n => n.getClientRects().length); return r ? r.className + ' ' + (r.closest('.ch-row, [class*="row"]')?.className || '') : null; });
        await shot('2-after-read');
        if (SW) {
          assert.equal(entry.afterRead.where['qa-chat-1'], 'ready', 'opened and read, it stays in Inbox: ' + JSON.stringify(entry.afterRead));
          assert.ok(!entry.afterRead.secs.some(s => s.k === 'recent'), 'no Recent section: ' + JSON.stringify(entry.afterRead.secs));
          assert.equal(entry.afterRead.where['qa-old'], 'ready', 'an old read thread is in Inbox too');
          const inbox = entry.afterRead.secs.find(s => s.k === 'ready');
          assert.equal(inbox.h, 'Inbox', 'the section is called Inbox');
          assert.equal(inbox.n, String(inbox.rows.length), 'the header count is the Inbox count');
          entry.badge = await page.evaluate(() => window.WizCore?.activityReady?.(window.WizLive));
          assert.equal(entry.badge, inbox.rows.length, 'the badge count is the Inbox count');
          // 2. Archive it from the thread: gone from Inbox, in Archived.
          await vis('.ch-list [data-chopen="qa-chat-1"]').click();
          await thread().getByText('Sunny, 18 °C, light wind.').waitFor({ timeout: 10000 });
          const arch = page.locator('.ch-tacts > button').filter({ visible: true }).filter({ hasText: /Archive/ }).first();
          await arch.click();
          await page.waitForFunction(() => ![...document.querySelectorAll('.ch-thread')].some(n => n.getClientRects().length), null, { timeout: 5000 }).catch(() => {});
          await nap(800); await openSecs();
          entry.afterArchive = await lay();
          await shot('3-after-archive');
          assert.ok(entry.writes.some(x => x.method === 'PATCH' && x.path.endsWith('/qa-chat-1')), 'archive went to the box');
          assert.notEqual(entry.afterArchive.where['qa-chat-1'], 'ready', 'archived: gone from Inbox ' + JSON.stringify(entry.afterArchive));
          assert.equal(entry.afterArchive.where['qa-chat-1'], 'archived', 'archived: in Archived ' + JSON.stringify(entry.afterArchive));
        } else {
          assert.equal(entry.afterRead.where['qa-chat-1'], 'recent', 'switch off: read moves to Recent as today ' + JSON.stringify(entry.afterRead));
          assert.ok(entry.afterRead.secs.find(s => s.k === 'ready')?.h !== 'Inbox', 'switch off: the section keeps its name');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SW ? 'on' : 'off', cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
