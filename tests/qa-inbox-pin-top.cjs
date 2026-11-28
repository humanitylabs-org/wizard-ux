'use strict';
// Pin to top (wizard-ux issue 1887, on for everyone: the switch wizard/inbox-pin-top was removed), in a real browser on a
// disposable synthetic box. Phone 412x915 and Classic desktop 1440x960, Nebula and a light skin:
//   - the owner opens a read row's menu (Shift+F10, as hold / right-click) and taps Pin to top: it shows first, above
//     today's Daily, with the pin mark, the same row look; the pin is written to the box's pin list (ui-preferences);
//   - an agent pins a thread through the box (PATCH ui-preferences {op:'add', key:'pinnedChats'}): after the shell's
//     next preferences read it shows on top too, even a quiet thread that was in Sent; it does not add to the Inbox
//     count or the badge while it is read;
//   - newer activity on another thread never moves the pinned rows; Unpin (row menu) puts each back in normal order;
//   QA_EXPECT=broken: the script reports what main does instead of failing.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://inbox-pin-top-1887.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'inbox-pin-top-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), SW = true;
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
const boxFresh = () => ({ pins: [], records: [{ id: REC, kind: 'needs_you', failed: true, state: 'new', agent: 'hermes', thread_id: 'qa-bg', title: 'Renew the parking permit', last_update: 'Stalled: the council site asked for a login.', created_at: now - 3 * 3600e3, updated_at: now - 30 * M }], patches: [] });
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)?.[1] || '', latest_message: { role: s.msgs.at(-1)?.[0], content: s.msgs.at(-1)?.[1], timestamp: s.at / 1000 },
  ...(s.msgs.some(m => m[0] === 'assistant') ? { last_assistant_at: iso(s.at) } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + sid, wizard_last_run_status: 'running' } : {}),
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.quiet ? { wizard_quiet_reply: true } : {}), ...(s.channel ? { channel: s.channel } : {}), ...(s.archived ? { archived: true } : {}) });
// Seen: every thread but qa-new was read at its last reply (qa-new is the one new reply).
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).filter(([k]) => k !== 'qa-new').map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } });
const SENT = () => ({ rows: [{ id: 'sent_' + 'c'.repeat(24), at: now - 5 * D, source: 'orb', text: 'Urgent: the kitchen tap is leaking', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-urgent', urgent: true, tags: [] }], next: null, check: null });
const BROKEN = process.env.QA_EXPECT === 'broken';
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
        const mix = { 'wizard/desktop-chats': true, ...(process.env.QA_SMART ? { 'wizard/smart-inbox': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        const prefs = () => ({ migrations: { 'launcher-seed-v1': true }, pinnedChats: BOX.pins.slice() });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p, body: q.postData() || '' });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (p === '/wizard/v1/ui-preferences' && (method === 'PUT' || method === 'PATCH')) {
              const b = q.postDataJSON() || {};
              if (Array.isArray(b.pinnedChats)) BOX.pins = b.pinnedChats.slice();
              for (const o of Array.isArray(b.ops) ? b.ops : []) if (o.key === 'pinnedChats') BOX.pins = o.op === 'add' ? (BOX.pins.includes(o.item) ? BOX.pins : BOX.pins.concat(o.item)) : BOX.pins.filter(x => x !== o.item);
              return r.fulfill({ json: prefs() });
            }
            const am = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && am) return r.fulfill({ json: { record: BOX.records[0] } });
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
            if (u.searchParams.get('kind') === 'needs_you') return r.fulfill({ json: { records: BOX.records.filter(x => x.state === 'new'), check: null, stay: ['qa-daily'] } });
            return r.fulfill({ json: { records: [], check: null, stay: ['qa-daily'] } });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs() });
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
            if (sid === 'qa-bg') return r.fulfill({ json: m[2] ? { messages: [] } : { session: { ...raw('qa-bg', { title: 'Renew the parking permit', at: now - 30 * M, msgs: [['user', 'x', 0], ['assistant', 'y', 1]] }), hidden: true } } });
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
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const lay = () => page.evaluate(() => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          const sec = list.querySelector('section.ch-sec[data-sec="ready"]');
          const rows = [...(sec?.querySelectorAll('.ch-sec-b > .ch-row-wrap') || [])].map(w => {
            const b = w.querySelector('.ch-row');
            return { id: b.dataset.chopen || b.dataset.chrunopen || b.dataset.chnotif || '', pinned: w.classList.contains('pinned'), mark: !!w.querySelector('.ch-ib-pin'), av: !!w.querySelector('.ch-ib-av'), pv: !!w.querySelector('.ch-ib-pv'), title: w.querySelector('.ch-ib-t')?.textContent.trim() || '', h: Math.round(b.getBoundingClientRect().height) };
          });
          const head = sec?.querySelector('.ch-sec-h small')?.textContent.trim() || list.closest('[data-chats]')?.querySelector('.ch-tbar small, .ch-tbar .ch-tb-n')?.textContent.trim() || '';
          return { rows, ids: rows.map(r => r.id), head, badge: window.WizCore?.activityReady?.(window.WizLive) };
        });
        const menu = async (id, word) => {
          await vis(`.ch-list [data-chopen="${id}"]`).focus();
          await page.keyboard.press('Shift+F10');
          const b = vis('.ch-sheet [data-rspin]'); await b.waitFor({ timeout: 5000 });
          const said = (await b.textContent()).trim();
          if (word) await b.click(); else await page.keyboard.press('Escape');
          await nap(700);
          return said;
        };
        await vis('.ch-list section[data-sec="ready"] [data-chopen]').waitFor({ timeout: 15000 });
        await page.waitForFunction(() => !!document.querySelector('.ch-list .ch-ib-wrap.pinned [data-chopen="qa-daily"]'), null, { timeout: 15000 }).catch(() => {});
        await nap(600);
        entry.first = await lay();
        await shot('0-before-pin');
        // The thread the owner pins: a read reply (QA_SMART=1, with wizard/smart-inbox on: the first unpinned thread row).
        const T = process.env.QA_SMART ? entry.first.rows.find(r => !r.pinned && r.id.startsWith('qa-') && r.id !== 'qa-bg')?.id : 'qa-read';
        entry.target = T;
        const check = (ok, msg) => { if (BROKEN) { if (!ok) (entry.broken = entry.broken || []).push(msg); } else assert.ok(ok, msg); };
        // Smart inbox (QA_SMART=1) keeps Daily out of Inbox; then pinned rows simply come first.
        const SMART = !!process.env.QA_SMART, rest = entry.first.ids.filter(id => id !== T);
        check(SMART || entry.first.ids[0] === 'qa-daily', 'before any pin: Daily first ' + JSON.stringify(entry.first.ids));
        // 1. The owner pins a read thread from its row menu.
        entry.menuWord = await menu(T, true);
        if (SW || BROKEN) check(entry.menuWord === 'Pin to top', 'menu says Pin to top: ' + entry.menuWord);
        await page.waitForFunction(() => window.WosChatPins?.pending?.() === 0, null, { timeout: 8000 }).catch(() => {});
        entry.ownerPinned = await lay();
        await shot('1-owner-pinned');
        if (SW || BROKEN) {
          const L = entry.ownerPinned, r0 = L.rows[0] || {};
          check(JSON.stringify(L.ids) === JSON.stringify([T, ...rest]), 'owner pin: first, above Daily, the rest unchanged ' + JSON.stringify(L.ids));
          check(r0.pinned && r0.mark && r0.av && r0.pv, 'pinned row: same row with the pin mark ' + JSON.stringify(r0));
          check(BOX.pins.includes(T), 'the pin is on the box ' + JSON.stringify(BOX.pins));
          check(L.ids.length === entry.first.ids.length && L.badge === entry.first.badge && L.head === entry.first.head, `count unchanged: ${entry.first.head}/${entry.first.badge} -> ${L.head}/${L.badge}`);
        }
        // 2. An agent pins a thread through the box (the quiet reply that sits in Sent); the shell reads it on its next pull.
        BOX.pins = BOX.pins.concat('qa-quiet');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(() => !!document.querySelector('.ch-list section[data-sec="ready"] [data-chopen="qa-quiet"]'), null, { timeout: 8000 }).catch(() => {});
        await nap(600);
        entry.agentPinned = await lay();
        await shot('2-agent-pinned');
        if (SW || BROKEN) {
          const L = entry.agentPinned;
          check(JSON.stringify(L.ids) === JSON.stringify([T, 'qa-quiet', ...rest.filter(id => id !== 'qa-quiet')]), 'agent pin: on top in pin order, above Daily ' + JSON.stringify(L.ids));
          check(L.rows[1]?.pinned && L.rows[1]?.mark, 'agent-pinned row has the pin mark');
          check(L.badge === entry.first.badge && L.head === entry.first.head, `a read pinned thread does not add to the count: ${entry.first.head}/${entry.first.badge} -> ${L.head}/${L.badge}`);
          check(L.rows.every(r => r.h === L.rows[0].h || !r.av), 'same row height ' + JSON.stringify(L.rows.map(r => r.h)));
        }
        // 3. Unpin both from the row menu: back to normal order (the quiet thread back in Sent).
        entry.unpinWord = await menu(T, true);
        if (SW || BROKEN) check(entry.unpinWord === 'Unpin', 'pinned row menu says Unpin: ' + entry.unpinWord);
        if (entry.agentPinned.ids.includes('qa-quiet')) await menu('qa-quiet', true);
        await page.waitForFunction(() => window.WosChatPins?.pending?.() === 0, null, { timeout: 8000 }).catch(() => {});
        await nap(600);
        entry.unpinned = await lay();
        await shot('3-unpinned');
        check(JSON.stringify(entry.unpinned.ids) === JSON.stringify(entry.first.ids), 'unpinned: normal order again ' + JSON.stringify(entry.unpinned.ids) + ' vs ' + JSON.stringify(entry.first.ids));
        if (SW) check(!BOX.pins.length, 'box pin list empty ' + JSON.stringify(BOX.pins));
        if (!BROKEN) assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        if (!BROKEN) assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = !entry.broken;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SW ? 'on' : 'off', cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + (c.broken ? c.broken.join(' | ') : String(c.failure).split('\n')[0])) }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
