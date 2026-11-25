'use strict';
// Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows) in a real browser, disposable synthetic box only.
// Phone 412x915 and Classic desktop 1440x960, Nebula and a light skin:
//   switch on: Chats › Inbox holds only what needs the owner: a new reply, a read reply (rows stay), needs you, a failure,
//   a waiting background task (agent inbox record, its thread hidden) and a Chats alert; never a quiet "nothing needed"
//   reply or his own send still working with no answer. Today's Daily, a #priority thread and an urgent one are pinned
//   first, in that order. Each row has a round avatar, the sender line (tag or agent), the title, one preview line, the
//   time and the unread dot. The header count = the rows = the badge. Archive on a row archives the thread (gone from
//   Inbox, in Archived); Archive on the task row archives its record. Opening a read row and coming back keeps it.
//   QA_SWITCH=off: today's Inbox, unchanged (no Signal rows; the quiet reply and the working send are where they were).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-inbox-rows-1779.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-inbox-rows-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), SW = process.env.QA_SWITCH !== 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, D = 864e5;
const REC = 'inbox_' + 'b'.repeat(24), TODAY = new Date(now).toISOString().slice(0, 10);
const CHANNELS = [
  { id: 'daily', agent: 'hermes', name: 'Daily', order: -2, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 0, kind: 'daily' },
  { id: 'priority', agent: 'hermes', name: '🔥 Priority', order: 0, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'trip', agent: 'hermes', name: '✈️ Trip', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
];
let THREADS, BOX;
const fresh = () => ({
  'qa-new': { title: 'Weather tomorrow', at: now - 20 * M, channel: 'trip', msgs: [['user', 'Tell me the weather in Lisbon tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind from the north.', 30]] },
  'qa-read': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall, herbs near the door.', 60]] },
  'qa-needs': { title: 'Dentist slot', at: now - 50 * M, attention: { state: 'needs_you', ask: 'Tuesday 10:00 or Thursday 16:00?' }, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Two slots are free. Tuesday 10:00 or Thursday 16:00?', 60]] },
  'qa-failed': { title: 'Book the train', at: now - 70 * M, status: 'failed', msgs: [['user', 'Book the 9:10 train to Porto', 0]] },
  'qa-quiet': { title: 'Sent to Miguel', at: now - 10 * M, quiet: true, attention: { state: 'done', ask: 'Sent.' }, msgs: [['user', 'Sent to Miguel, done', 0], ['assistant', 'Noted.', 20]] },
  'qa-working': { title: 'Summarise the report', at: now - 2 * M, status: 'running', msgs: [['user', 'Summarise the quarterly report', 0]] },
  'qa-daily': { title: 'Daily · today', at: now - 4 * 3600e3, channel: 'daily', msgs: [['user', 'signal sweep', 0], ['assistant', 'Two things wait on you; the rest is done.', 30]] },
  'qa-prio': { title: 'Tax return', at: now - 2 * D, channel: 'priority', msgs: [['user', 'File the tax return', 0], ['assistant', 'Drafted; one number to confirm.', 60]] },
  'qa-urgent': { title: 'Call the plumber', at: now - 5 * D, msgs: [['user', 'Urgent: the kitchen tap is leaking', 0], ['assistant', 'The plumber can come at 15:00.', 60]] },
});
const boxFresh = () => ({ records: [{ id: REC, kind: 'needs_you', failed: true, state: 'new', agent: 'hermes', thread_id: 'qa-bg', title: 'Renew the parking permit', last_update: 'Stalled: the council site asked for a login.', created_at: now - 3 * 3600e3, updated_at: now - 30 * M }], patches: [] });
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)?.[1] || '', latest_message: { role: s.msgs.at(-1)?.[0], content: s.msgs.at(-1)?.[1], timestamp: s.at / 1000 },
  ...(s.msgs.some(m => m[0] === 'assistant') ? { last_assistant_at: iso(s.at) } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + sid, wizard_last_run_status: 'running' } : {}),
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.quiet ? { wizard_quiet_reply: true } : {}), ...(s.channel ? { channel: s.channel } : {}), ...(s.archived ? { archived: true } : {}) });
// Seen: every thread but qa-new was read at its last reply (qa-new is the one new reply).
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).filter(([k]) => k !== 'qa-new').map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } });
const SENT = () => ({ rows: [{ id: 'sent_' + 'c'.repeat(24), at: now - 5 * D, source: 'orb', text: 'Urgent: the kitchen tap is leaking', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-urgent', urgent: true, tags: [] }], next: null, check: null });
const report = { origin, web, switch: SW ? 'on' : 'off', cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      THREADS = fresh(); BOX = boxFresh();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SW ? { 'wizard/inbox-rows': true } : {}) };
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
            const am = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && am) { const b = q.postDataJSON() || {}; BOX.patches.push({ id: am[1], ...b }); const rec = BOX.records.find(x => x.id === am[1]); if (!rec) return r.fulfill({ status: 404, json: { error: 'not_found' } }); if (b.action === 'archive') rec.state = 'archived'; return r.fulfill({ json: { record: rec } }); }
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
          if (p === '/wizard/v1/sent') return r.fulfill({ json: SENT() });
          if (p === '/wizard/v1/agent-inbox') {
            if (u.searchParams.get('kind') === 'needs_you') { entry.needsReads = (entry.needsReads || 0) + 1; return r.fulfill({ json: { records: BOX.records.filter(x => x.state === 'new'), check: null, stay: ['qa-daily'] } }); }
            return r.fulfill({ json: { records: [], check: null, stay: ['qa-daily'] } });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - D), channels: CHANNELS } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/v1/channels/daily/days') return r.fulfill({ json: { today: 'qa-daily', days: [{ day: TODAY, sessionId: 'qa-daily', title: 'Daily · today', opener: 'signal sweep', count: 2, lastAt: iso(now - 4 * 3600e3) }], next: null } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel'), data = Object.entries(THREADS).filter(([, s]) => s.channel === id).map(([k, s]) => ({ ...raw(k, s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([k, s]) => raw(k, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]);
            if (sid === 'qa-bg') return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Renew the parking permit', timestamp: now / 1000 - 3 * 3600 }, { role: 'assistant', content: 'The council site asked for a login; I stopped there.', timestamp: now / 1000 - 1800 }] } : { session: { ...raw('qa-bg', { title: 'Renew the parking permit', at: now - 30 * M, msgs: [['user', 'x', 0], ['assistant', 'y', 1]] }), hidden: true } } });
            const s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/desktop-chats'), null, { timeout: 15000 });
        if (SW) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/inbox-rows'), null, { timeout: 15000 });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        // The Inbox as a person sees it: each row in order with its parts.
        const lay = () => page.evaluate(() => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          const sec = list.querySelector('section.ch-sec[data-sec="ready"]');
          const rows = [...(sec?.querySelectorAll('.ch-sec-b > .ch-row-wrap') || [])].map(w => {
            const b = w.querySelector('.ch-row'), r = b.getBoundingClientRect(), av = w.querySelector('.ch-ib-av');
            return { id: b.dataset.chopen || b.dataset.chrunopen || b.dataset.chnotif || '', pinned: w.classList.contains('pinned'), from: w.querySelector('.ch-ib-from')?.textContent.trim() || '', title: w.querySelector('.ch-ib-t')?.textContent.trim() || '', pv: w.querySelector('.ch-ib-pv')?.textContent.trim() || '',
              time: w.querySelector('.ch-ib-l1 time')?.textContent.trim() || '', dot: w.querySelector('.ch-ib-mk .ch-chan-dot.new') ? 'new' : w.querySelector('.ch-ib-mk .ch-chan-dot') ? 'needs' : '', arch: !!w.querySelector('.ch-ib-arch'),
              avatar: av ? { round: getComputedStyle(av).borderRadius, w: Math.round(av.getBoundingClientRect().width), text: av.textContent.trim(), svg: !!av.querySelector('svg, .ag-sig') && Math.round((av.querySelector('svg, .ag-sig')?.getBoundingClientRect().width) || 0) >= 20 } : null, h: Math.round(r.height) };
          });
          const secs = [...list.querySelectorAll('section.ch-sec[data-sec]')].map(s => ({ k: s.dataset.sec, h: (s.querySelector('.ch-sec-h span')?.textContent || '').trim(), n: (s.querySelector('.ch-sec-h small')?.textContent || '').trim(), rows: [...s.querySelectorAll('[data-chopen],[data-chrunopen]')].map(r => r.dataset.chopen || r.dataset.chrunopen) }));
          const panel = sec ? getComputedStyle(sec.querySelector('.ch-sec-b')).backgroundColor : '';
          return { rows, secs, panel, ids: rows.map(r => r.id), where: Object.fromEntries(secs.flatMap(s => s.rows.map(r => [r, s.k]))) };
        });
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        await vis('.ch-list [data-chopen="qa-new"]').waitFor({ timeout: 15000 });
        if (SW) await page.waitForFunction(() => !!document.querySelector('.ch-list [data-chrunopen="qa-bg"]') && !!document.querySelector('.ch-list .ch-ib-wrap.pinned [data-chopen="qa-daily"]') && !!document.querySelector('.ch-list .ch-ib-wrap.pinned [data-chopen="qa-urgent"]'), null, { timeout: 15000 }).catch(() => {});
        await nap(600);
        entry.first = await lay();
        await shot('1-inbox');
        if (SW) {
          const L = entry.first, ids = L.ids;
          assert.deepEqual(ids.slice(0, 3), ['qa-daily', 'qa-prio', 'qa-urgent'], 'pinned first: Daily, then #priority / urgent ' + JSON.stringify(ids));
          assert.ok(L.rows.slice(0, 3).every(r => r.pinned), 'pinned rows are marked');
          for (const id of ['qa-new', 'qa-read', 'qa-needs', 'qa-failed', 'qa-bg']) assert.ok(ids.includes(id), id + ' is in Inbox ' + JSON.stringify(ids));
          for (const id of ['qa-quiet', 'qa-working']) assert.ok(!ids.includes(id), id + ' is not in Inbox ' + JSON.stringify(ids));
          assert.ok(!L.secs.some(s => s.k === 'recent' || s.k === 'working'), 'no Recent and no Working section ' + JSON.stringify(L.secs.map(s => s.k)));
          const by = Object.fromEntries(L.rows.map(r => [r.id, r]));
          assert.equal(by['qa-new'].from, 'Trip', 'sender line = first tag');
          assert.equal(by['qa-new'].avatar.text, '✈️', 'avatar = the tag emoji');
          assert.ok(by['qa-read'].avatar.svg && by['qa-read'].from, 'no tag: the agent icon and name');
          assert.equal(by['qa-new'].pv, 'Sunny, 18 °C, light wind from the north.', 'preview = the latest agent message');
          assert.equal(by['qa-needs'].pv, 'Tuesday 10:00 or Thursday 16:00?', 'needs you: the ask');
          assert.equal(by['qa-new'].dot, 'new', 'unread dot'); assert.equal(by['qa-read'].dot, '', 'read: no dot'); assert.equal(by['qa-needs'].dot, 'needs', 'needs you: amber');
          assert.ok(/Failed/.test(by['qa-bg'].pv), 'the failed background task says so: ' + by['qa-bg'].pv);
          for (const r of L.rows) { assert.ok(r.avatar && r.avatar.round === '50%' && r.avatar.w >= 40, 'round avatar ' + JSON.stringify(r)); assert.ok(r.time, 'time on ' + r.id); assert.ok(r.title, 'title on ' + r.id); assert.ok(r.arch, 'Archive button on ' + r.id); }
          assert.ok(L.panel && !/transparent|\/\s*0?\.\d|rgba\([^)]*,\s*0?\.\d+\)|rgba\([^)]*,\s*0\)/.test(L.panel), 'the Inbox panel is opaque: ' + L.panel);
          const inbox = L.secs.find(s => s.k === 'ready');
          assert.equal(inbox.h, 'Inbox'); assert.equal(inbox.n, String(L.rows.length), 'the header count is the row count');
          entry.badge = await page.evaluate(() => window.WizCore?.activityReady?.(window.WizLive));
          assert.equal(entry.badge, L.rows.length, 'the badge count is the Inbox count');
          // Open the read row and come back: it stays.
          await vis('.ch-list [data-chopen="qa-read"]').click();
          const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
          await thread().getByText('Tomatoes by the wall, herbs near the door.').waitFor({ timeout: 10000 });
          await nap(500); await back(); await nap(800);
          await vis('.ch-list [data-chopen="qa-new"]').waitFor({ timeout: 10000 });
          entry.afterOpen = await lay();
          assert.ok(entry.afterOpen.ids.includes('qa-read'), 'opened and back: still in Inbox');
          // Archive from the row.
          await vis('.ch-list [data-chibarch="qa-read"]').click();
          await page.waitForFunction(() => ![...document.querySelectorAll('.ch-list section[data-sec="ready"] [data-chopen="qa-read"]')].some(n => n.getClientRects().length), null, { timeout: 5000 });
          await nap(900);
          entry.afterArchive = await lay();
          assert.ok(entry.writes.some(x => x.method === 'PATCH' && x.path.endsWith('/qa-read')), 'archive went to the box');
          assert.ok(!entry.afterArchive.ids.includes('qa-read'), 'archived: gone from Inbox');
          // Archive the waiting task's record from its row.
          await vis(`.ch-list [data-chibrec="${REC}"]`).click();
          await page.waitForFunction(() => ![...document.querySelectorAll('.ch-list [data-chrunopen="qa-bg"]')].some(n => n.getClientRects().length), null, { timeout: 5000 });
          assert.ok(BOX.patches.some(x => x.id === REC && x.action === 'archive'), 'record archive went to the box');
          await nap(600);
          entry.final = await lay();
          await shot('2-after-archive');
          assert.equal(entry.final.secs.find(s => s.k === 'ready').n, String(entry.final.rows.length), 'count follows');
        } else {
          // QA_WEB=<main>/web gives the same list, byte for byte (cmp the list-*.html files).
          fs.writeFileSync(path.join(out, `list-${stem}.html`), await page.evaluate(() => [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length).innerHTML.replace(/\b\d+(m|h)\b/g, 'T')));
          assert.equal(entry.first.rows.filter(r => r.avatar).length, 0, 'switch off: no Signal rows');
          assert.equal(entry.needsReads || 0, 0, 'switch off: the box is never asked for waiting tasks');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SW ? 'on' : 'off', cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
