'use strict';
// Archive in a background task's thread clears its Inbox row (wizard-ux issue 1928), in a real browser, disposable
// synthetic box only, every write intercepted, service workers blocked. Phone 412x915 (QA_SHELLS=phone,classic for the
// desktop too), Nebula and a light skin, James's switches: wizard/inbox-until-archived,
// wizard/smart-inbox, wizard/catch-me-up (Sent as threads is on for everyone).
//   1. Hidden worker thread T1 (needs_you) + record R1: the Inbox shows R1's row. Open it, Archive in the thread: the
//      session PATCH {archived: true} and PATCH /wizard/v1/agent-inbox/R1 {action: archive} are both sent; back on the
//      list there is no ibrec:R1 row and the Inbox count dropped by one, with no reload.
//   2. T2 already archived on load, R2 still new: no R2 row.
//   3. T3 opened from a link in another thread (#1920: Archive steps back to the linking thread): R3's row is gone when
//      you go back to the list.
//   4. Undo right after the archive in 1 brings T1 and R1's row back.
//   6. A record whose thread is snoozed (on another device, or here from inside the thread) is not in the Inbox, also
//      after a reload.
//   5. Smart inbox on, R4 whose thread's last status line is check: not in the Inbox, no Needs you dot anywhere for it;
//      the needs_you record and a waiting_for_approval thread keep the amber dot.
// QA_EXPECT=broken: run against main (QA_WEB=<main>/web) and print what fails instead of failing.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://inbox-archive-record-1928.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'inbox-archive-record-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), BROKEN = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, D = 864e5;
const rid = c => 'inbox_' + c.repeat(24);
const R1 = rid('1'), R2 = rid('2'), R3 = rid('3'), R4 = rid('4'), R5 = rid('5');
let THREADS, BOX, DISP;
const fresh = () => ({
  'qa-read': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall, herbs near the door.', 60]] },
  'qa-link': { title: 'Morning roundup', at: now - 40 * M, msgs: [['user', 'What is open?', 0], ['assistant', 'One task waits on you: [Renew the passport](/wizard/?session=qa-bg3).', 60]] },
  'qa-appr': { title: 'Pay the plumber', at: now - 25 * M, status: 'waiting_for_approval', msgs: [['user', 'Pay the plumber', 0], ['assistant', 'Waiting for your approval to pay €120.', 30]] },
  'qa-bg1': { hidden: true, title: 'Fix archive navigation', at: now - 10 * M, attention: { state: 'needs_you', ask: 'Archive in a thread opened from a link: which way should it go?' }, msgs: [['user', 'Fix archive navigation', 0], ['assistant', 'Two ways it can go. Which one?', 60]] },
  'qa-bg2': { hidden: true, archived: true, title: 'Order printer ink', at: now - 50 * M, attention: { state: 'needs_you', ask: 'Black only or all four?' }, msgs: [['user', 'Order printer ink', 0], ['assistant', 'Black only or all four?', 60]] },
  'qa-bg3': { hidden: true, title: 'Renew the passport', at: now - 30 * M, attention: { state: 'needs_you', ask: 'Which photo should I upload?' }, msgs: [['user', 'Renew the passport', 0], ['assistant', 'Which photo should I upload?', 60]] },
  'qa-bg5': { hidden: true, title: 'Book the dentist', at: now - 15 * M, attention: { state: 'needs_you', ask: 'Tuesday or Thursday?' }, msgs: [['user', 'Book the dentist', 0], ['assistant', 'Tuesday or Thursday?', 60]] },
  'qa-bg4': { hidden: true, title: 'Signal chat names', at: now - 20 * M, attention: { state: 'check', ask: 'Renamed the chats. Check they look right.' }, msgs: [['user', 'Rename the Signal chats', 0], ['assistant', 'Renamed the chats. Check they look right.', 60]] },
});
const rec = (id, thread, title, ask, min) => ({ id, kind: 'needs_you', state: 'new', worker: true, agent: 'hermes', thread_id: thread, title, last_update: ask, created_at: now - 3 * 3600e3, updated_at: now - min * M });
const boxFresh = () => ({ records: [
  rec(R1, 'qa-bg1', 'Fix archive navigation', 'Archive in a thread opened from a link: which way should it go?', 10),
  rec(R2, 'qa-bg2', 'Order printer ink', 'Black only or all four?', 50),
  rec(R3, 'qa-bg3', 'Renew the passport', 'Which photo should I upload?', 30),
  rec(R4, 'qa-bg4', 'Signal chat names', 'Renamed the chats. Check they look right.', 20),
  rec(R5, 'qa-bg5', 'Book the dentist', 'Tuesday or Thursday?', 15),
], patches: [] });
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)?.[1] || '', latest_message: { role: s.msgs.at(-1)?.[0], content: s.msgs.at(-1)?.[1], timestamp: s.at / 1000 },
  ...(s.msgs.some(m => m[0] === 'assistant') ? { last_assistant_at: iso(s.at) } : {}),
  ...(s.attention ? { wizard_attention: s.attention } : {}), archived: !!s.archived, hidden: !!s.hidden });
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], checks: [] }; report.cases.push(entry);
      const check = (c, name, extra) => { entry.checks.push({ name, ok: !!c, ...(c ? {} : { extra }) }); if (!BROKEN) assert.ok(c, name + (extra === undefined ? '' : ' ' + JSON.stringify(extra))); };
      THREADS = fresh(); BOX = boxFresh(); DISP = { 'direct:qa-bg5': { deferred: true, updatedAt: iso(now - 5 * M) } }; // snoozed on another device
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/inbox-until-archived': true, 'wizard/smart-inbox': true, 'wizard/catch-me-up': true };
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
            const body = (() => { try { return q.postDataJSON() || {}; } catch (_) { return {}; } })();
            entry.writes.push({ method, path: p, body });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: body.state } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            if (method === 'PUT' && p === '/wizard/thread-dispositions') { const rec = { sessionId: body.sessionId, deferred: !!body.deferred, updatedAt: new Date().toISOString() }; DISP[`${body.runtime || 'direct'}:${body.sessionId}`] = rec; return r.fulfill({ json: { record: rec } }); }
            const am = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && am) {
              BOX.patches.push({ id: am[1], ...body }); const x = BOX.records.find(y => y.id === am[1]);
              if (!x) return r.fulfill({ status: 404, json: { error: 'not_found' } });
              // The box's own rules (wizard-agent-service server/agent-inbox.mjs patch): archive → archived, snooze → new.
              if (body.action === 'archive') x.state = 'archived'; else if (body.action === 'snooze') { x.state = 'new'; x.snoozed_at = Date.now(); } else return r.fulfill({ status: 400, json: { error: 'unknown action' } });
              x.updated_at = Date.now(); return r.fulfill({ json: { record: x } });
            }
            const pm = /^\/wizard\/hermes\/api\/sessions\/([^/]+)$/.exec(p);
            if (method === 'PATCH' && pm && THREADS[decodeURIComponent(pm[1])]) { const s = THREADS[decodeURIComponent(pm[1])]; if ('archived' in body) s.archived = !!body.archived; return r.fulfill({ json: { session: raw(decodeURIComponent(pm[1]), s) } }); }
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
          if (p === '/wizard/v1/agent-inbox') {
            if (u.searchParams.get('kind') === 'needs_you') return r.fulfill({ json: { records: BOX.records.filter(x => x.state === 'new'), check: null, stay: [] } });
            return r.fulfill({ json: { records: [], check: null, stay: [] } });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/thread-dispositions') return r.fulfill({ json: { state: DISP } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          // The box's list never carries a hidden worker thread (wizard-agent-service docs/agent-inbox.md).
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([k, s]) => raw(k, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]), s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/smart-inbox'), null, { timeout: 15000 });
        const openList = () => phone ? page.evaluate(() => __wos.openSheet('inbox')) : page.evaluate(() => __wux.openChatsList());
        await openList();
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const lay = () => page.evaluate(() => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length); if (!list) return null;
          const inbox = list.querySelector('section.ch-sec[data-sec="ready"]');
          const rows = [...(inbox?.querySelectorAll('.ch-sec-b > .ch-row-wrap') || [])].map(w => ({ key: w.dataset.morphKey || '', dot: !!w.querySelector('.ch-ib-mk .ch-chan-dot:not(.new)') }));
          const allDots = [...list.querySelectorAll('.ch-row-wrap')].map(w => ({ key: w.dataset.morphKey || '', open: w.querySelector('[data-chopen],[data-chrunopen]')?.getAttribute('data-chopen') || w.querySelector('[data-chrunopen]')?.dataset.chrunopen || '', needs: !!w.querySelector('.ch-chan-dot:not(.new)') }));
          const n = Number(window.WizCore?.activityReady?.(window.WizLive));
          return { keys: rows.map(r => r.key), rows, allDots, badge: n, count: (window.__wos || window.__wux) && (list.closest('[data-chats]') ? null : null) };
        });
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        await page.waitForFunction(k => !!document.querySelector(`.ch-list [data-morph-key="ibrec:${k}"]`), R1, { timeout: 15000 }).catch(() => {});
        await nap(1500);
        entry.first = await lay(); await shot('1-inbox');
        const keys = entry.first?.keys || [];
        check(keys.includes('ibrec:' + R1), '1 the Inbox shows R1\'s row', keys);
        check(!keys.includes('ibrec:' + R2), '2 R2 (its thread already archived) is not in the Inbox', keys);
        check(!keys.includes('ibrec:' + R4), '5 R4 (its thread says check) is not in the Inbox', keys);
        check(!keys.includes('ibrec:' + R5), '6 R5 (its thread snoozed on another device) is not in the Inbox', keys);
        check(!(entry.first?.allDots || []).some(r => (r.key === 'ibrec:' + R4 || r.open === 'qa-bg4') && r.needs), '5 no Needs you dot on any row for R4', entry.first?.allDots);
        check(entry.first?.rows.find(r => r.key === 'ibrec:' + R1)?.dot, '5 the needs_you record keeps its amber dot', entry.first?.rows);
        check(entry.first?.rows.find(r => r.key === 'row:qa-appr')?.dot, '5 the approval thread keeps its amber dot', entry.first?.rows);
        const before = entry.first?.badge;
        // 1. Open R1's row, Archive in the thread.
        await vis(`.ch-list [data-morph-key="ibrec:${R1}"] [data-chrunopen]`).click();
        await vis('[data-chact="done"]').waitFor({ timeout: 10000 });
        await nap(500); await shot('2-thread');
        const w0 = entry.writes.length;
        await vis('[data-chact="done"]').click();
        await nap(250);
        if (!phone) await openList();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-list')].some(n => n.getClientRects().length), null, { timeout: 5000 }).catch(() => {});
        entry.afterArchive = await lay();
        await shot('3-after-archive');
        const ws = entry.writes.slice(w0);
        check(ws.some(x => x.method === 'PATCH' && x.path === '/wizard/hermes/api/sessions/qa-bg1' && x.body.archived === true), '1 the session PATCH {archived: true} was sent', ws);
        await page.waitForFunction(() => true); await nap(600);
        const ws2 = entry.writes.slice(w0);
        check(ws2.some(x => x.method === 'PATCH' && x.path === `/wizard/v1/agent-inbox/${R1}` && x.body.action === 'archive'), '1 the record archive was sent', ws2);
        check(!(entry.afterArchive?.keys || []).includes('ibrec:' + R1), '1 no ibrec:R1 row right after the archive', entry.afterArchive?.keys);
        check(entry.afterArchive?.badge === before - 1, '1 the Inbox count dropped by one', { before, after: entry.afterArchive?.badge });
        // 4. Undo.
        const undo = page.locator('.ch-undo [data-chundo]');
        if (await undo.count()) {
          await undo.first().click();
          await page.waitForFunction(k => !!document.querySelector(`.ch-list [data-morph-key="ibrec:${k}"]`), R1, { timeout: 6000 }).catch(() => {});
          await nap(1200);
          entry.afterUndo = await lay(); await shot('4-after-undo');
          check(entry.writes.some(x => x.method === 'PATCH' && x.path === '/wizard/hermes/api/sessions/qa-bg1' && x.body.archived === false), '4 Undo restores the thread', entry.writes.slice(w0));
          check((entry.afterUndo?.keys || []).includes('ibrec:' + R1), '4 Undo brings R1\'s row back', entry.afterUndo?.keys);
          check(entry.afterUndo?.badge === before, '4 the count is back', { before, after: entry.afterUndo?.badge });
          check(BOX.records.find(x => x.id === R1).state === 'new', '4 the record is waiting on the box again', BOX.records.find(x => x.id === R1));
        } else check(false, '4 an Undo was offered');
        // Reload: R1 stays where Undo left it, R2 and R4 stay out.
        await page.reload(); await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/smart-inbox'), null, { timeout: 15000 });
        await openList(); await vis('.ch-tabbar').waitFor({ timeout: 15000 }); await nap(2000);
        entry.reload = await lay();
        check(!(entry.reload?.keys || []).includes('ibrec:' + R2) && !(entry.reload?.keys || []).includes('ibrec:' + R4), '2/5 after a reload R2 and R4 stay out', entry.reload?.keys);
        check((entry.reload?.keys || []).includes('ibrec:' + R3), '3 R3 is in the Inbox before its archive', entry.reload?.keys);
        // 3. Linked thread: open the roundup, tap the link to T3, Archive → back on the roundup, then the list.
        await page.evaluate(() => { const a = window.__wos || window.__wux; a.openWizardThread ? a.openWizardThread('qa-link') : a.openThread('qa-link'); });
        const link = page.locator('.ch-msgs .msg.a a').filter({ visible: true }).filter({ hasText: 'Renew the passport' }).last();
        await link.waitFor({ timeout: 10000 }); await link.click();
        await page.waitForFunction(() => /Which photo should I upload/.test([...document.querySelectorAll('.ch-msgs')].filter(n => n.getClientRects().length).map(n => n.textContent).join(' ')), null, { timeout: 10000 }).catch(() => {});
        await vis('[data-chact="done"]').waitFor({ timeout: 10000 }); await nap(400);
        const w3 = entry.writes.length;
        await vis('[data-chact="done"]').click(); await nap(900);
        entry.linkBack = await page.evaluate(() => [...document.querySelectorAll('.ch-msgs')].filter(n => n.getClientRects().length).map(n => n.textContent).join(' ').includes('One task waits on you'));
        check(entry.linkBack, '3 Archive on the linked thread steps back to the roundup');
        if (phone) await page.evaluate(() => __wos.onBack()); else await openList();
        await nap(1200);
        entry.afterLink = await lay(); await shot('5-after-linked-archive');
        check(!(entry.afterLink?.keys || []).includes('ibrec:' + R3), '3 R3\'s row is gone from the Inbox', entry.afterLink?.keys);
        check(entry.writes.slice(w3).some(x => x.path === `/wizard/v1/agent-inbox/${R3}` && x.body.action === 'archive'), '3 the record archive was sent', entry.writes.slice(w3));
        // 6. Snooze R1's thread from inside it (the Snooze picker's LIVE.defer), back to the list, then reload.
        await vis(`.ch-list [data-morph-key="ibrec:${R1}"] [data-chrunopen]`).click();
        await vis('[data-chact="done"]').waitFor({ timeout: 10000 }); await nap(400);
        // QA_SNOOZE=live: the bare LIVE.defer call instead of the thread's Snooze button and the picker's Someday.
        if (process.env.QA_SNOOZE === 'live') check(await page.evaluate(() => window.WizLive.defer('qa-bg1')), '6 the thread snoozed');
        else { await vis('[data-chact="snooze"]').click(); await vis('[data-boom-someday]').click(); await page.waitForFunction(() => window.WizLive.session('qa-bg1')?.deferred === true && !window.WizLive.busy('qa-bg1'), null, { timeout: 8000 }).catch(() => {}); check(await page.evaluate(() => window.WizLive.session('qa-bg1')?.deferred === true), '6 the thread snoozed'); }
        if (phone) await page.evaluate(() => __wos.onBack()); else await openList();
        await nap(1200);
        entry.afterSnooze = await lay(); await shot('6-after-snooze');
        check(!(entry.afterSnooze?.keys || []).includes('ibrec:' + R1), '6 R1 is out of the Inbox once its thread is snoozed', entry.afterSnooze?.keys);
        await page.reload(); await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/smart-inbox'), null, { timeout: 15000 });
        await openList(); await vis('.ch-tabbar').waitFor({ timeout: 15000 }); await nap(2000);
        entry.snoozeReload = await lay();
        check(!(entry.snoozeReload?.keys || []).includes('ibrec:' + R1) && !(entry.snoozeReload?.keys || []).includes('ibrec:' + R5), '6 after a reload both snoozed tasks stay out', entry.snoozeReload?.keys);
        check(entry.errors.length === 0, 'no browser errors', entry.errors);
        check(entry.refused.filter(x => x.reason === 'unexpected-write').length === 0, 'no unexpected writes', entry.refused);
        entry.pass = entry.checks.every(c => c.ok);
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  for (const c of report.cases) for (const k of c.checks) console.log(k.ok ? 'PASS' : 'FAIL', c.stem, k.name, k.ok ? '' : JSON.stringify(k.extra ?? '').slice(0, 300));
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure || c.checks.filter(k => !k.ok).map(k => k.name).join('; ')).split('\n')[0]) }));
  if (BROKEN) { if (!failed.length) { console.log('QA_EXPECT=broken but every check passed'); process.exitCode = 1; } }
  else if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
