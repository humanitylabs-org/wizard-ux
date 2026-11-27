'use strict';
// Plain alert rows (wizard-ux issue 1941, switch wizard/plain-alert-rows) in a real browser, disposable synthetic box only.
// Phone 412x915 and Classic desktop 1440x960, Nebula and a light skin, with Inbox rows (on for everyone):
//   switch on: an alert in Chats › Inbox (a Notifications item routed to Chats) is drawn as a thread row: the same row
//   layout as the thread rows around it (Inbox rows: round avatar, the source name on the label line, bold title, one
//   preview line, time on the right, the unread dot, an Archive button), marked as an alert only by a small bell before
//   the label. No amber background, outline, yellow tile, yellow pill or yellow time. A snoozed alert looks like a
//   read thread (dimmed) and keeps the bell. Tap opens the alert, Shift+F10 (hold) opens the Alert actions sheet with
//   Archive, a folded group keeps its count, the row's Archive archives it (all of a group).
//   QA_SWITCH=off: today's amber rows, unchanged (QA_WEB=<git archive main>/web gives byte-identical list-*.html).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://plain-alert-rows-1941.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'plain-alert-rows-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const SW = process.env.QA_SWITCH !== 'off', ROWS = true; // Inbox rows are on for everyone (wizard-ux issue 1779)
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), sec = Math.floor(now / 1000), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const THREADS = {
  'qa-new': { title: 'Weather tomorrow', at: now - 20 * M, msgs: [['user', 'Tell me the weather in Lisbon tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind from the north.', 30]] },
  'qa-read': { title: 'Garden plan', at: now - 90 * M, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall, herbs near the door.', 60]] },
};
// One alert that needs him (never folded), two from the same place (folded into one row with a count), one snoozed.
const notesFresh = () => [
  { id: 'qa-alert', title: 'System alert', message: 'The nightly backup did not finish: the disk is 96% full.', time: sec - 5 * 60, source: 'agent', priority: 4, read: false, archived: false },
  { id: 'qa-fyi-a', title: 'Calendar synced', message: 'Three new events from your work calendar.', time: sec - 40 * 60, source: 'agent', priority: 3, read: false, archived: false },
  { id: 'qa-fyi-b', title: 'Mail sorted', message: 'Twelve newsletters moved to Later.', time: sec - 50 * 60, source: 'agent', priority: 3, read: false, archived: false },
  { id: 'qa-snoozed', title: 'Update ready', message: 'WizardOS 0.40 can be installed tonight.', time: sec - 3 * 3600, source: 'agent', priority: 4, read: true, archived: false },
];
let NOTES;
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)[1], latest_message: { role: s.msgs.at(-1)[0], content: s.msgs.at(-1)[1], timestamp: s.at / 1000 }, last_assistant_at: iso(s.at) });
const SEEN = () => ({ state: { initializedAt: 1, threads: { 'direct:qa-read': { updatedAt: iso(THREADS['qa-read'].at), assistantActivityAt: iso(THREADS['qa-read'].at), seenAt: THREADS['qa-read'].at + 60e3 } } } });
const report = { origin, web, switch: SW ? 'on' : 'off', rows: ROWS ? 'on' : 'off', cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], marks: [] }; report.cases.push(entry);
      NOTES = notesFresh();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SW ? { 'wizard/plain-alert-rows': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p.includes('/v1/runs')) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            if (method === 'POST' && p === '/notifications/api/mark') { const b = q.postDataJSON() || {}; entry.marks.push(b); for (const n of NOTES) if ((b.ids || []).includes(n.id)) { if ('read' in b) n.read = !!b.read; if ('archived' in b) { n.archived = !!b.archived; if (b.archived) n.read = true; } } return r.fulfill({ json: { ok: true } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === '/notifications/api/items') return r.fulfill({ json: { items: NOTES.filter(n => !n.archived) } });
          if (p === '/notifications/api/count') return r.fulfill({ json: { unread: NOTES.filter(n => !n.archived && !n.read).length, needs: 0 } });
          if (p === '/notifications/api/marks') return r.fulfill({ json: { marks: {} } });
          if (p.startsWith('/notifications/')) return r.fulfill({ json: {} });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: {}, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{ id: 'notifications', name: 'Notifications', type: 'agent', source: 'apps.json' }] } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null, stay: [] } });
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: [], next: null, check: null } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([k, s]) => raw(k, s)), has_more: false } });
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
        if (SW) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/plain-alert-rows'), null, { timeout: 15000 });
        await page.waitForFunction(() => (window.WosBell?.items?.() || []).length >= 4, null, { timeout: 15000 }).catch(() => {});
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        await vis('.ch-list [data-chopen="qa-new"]').waitFor({ timeout: 15000 });
        await vis('.ch-list [data-chnotif="qa-alert"]').waitFor({ timeout: 15000 });
        // Snoozed folded at the bottom: open it so the snoozed alert is on screen too.
        const snz = page.locator('.ch-list [data-sectoggle="snoozed"]').filter({ visible: true }).first();
        if (await snz.count() && (await snz.getAttribute('aria-expanded')) !== 'true') { await snz.click(); await nap(400); }
        await nap(600);
        // Each row as a person sees it: its parts and its look.
        const lay = () => page.evaluate(DUMP => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          const css = n => { if (!n) return null; const c = getComputedStyle(n); return { bg: c.backgroundColor, shadow: c.boxShadow, border: c.borderTopWidth + ' ' + c.borderTopStyle, color: c.color, opacity: c.opacity, radius: c.borderRadius }; };
          return [...list.querySelectorAll('.ch-row-wrap')].filter(w => w.getClientRects().length).map(w => {
            const b = w.querySelector('.ch-row'), r = b.getBoundingClientRect(), av = w.querySelector('.ch-ib-av') || w.querySelector('.emo');
            const from = w.querySelector('.ch-ib-from') || w.querySelector('.ch-al-from') || w.querySelector('.ch-notif-from'), time = w.querySelector('time'), title = w.querySelector('.ch-ib-t') || w.querySelector('.tp b');
            return { id: b.dataset.chopen || b.dataset.chnotif || '', alert: !!b.dataset.chnotif, group: b.dataset.chnotifGroup || '', sec: w.closest('section[data-sec]')?.dataset.sec || '',
              cls: w.className, wrap: css(w), row: css(b), from: from?.textContent.trim() || '', fromCss: css(from), time: time?.textContent.trim() || '', timeCss: css(time), title: title?.textContent.trim() || '', titleWeight: title ? getComputedStyle(title).fontWeight : '',
              pv: (w.querySelector('.ch-ib-pv') || w.querySelector('.pv'))?.textContent.trim() || '', bell: !!w.querySelector('.ch-al-mk svg'), count: w.querySelector('.ch-al-n')?.textContent.trim() || w.querySelector('.ch-notif-n')?.textContent.trim() || '',
              dot: w.querySelector('.ch-ib-mk .ch-chan-dot.new') ? 'new' : w.querySelector('.ch-ib-mk .ch-chan-dot') ? 'needs' : '', arch: !!w.querySelector('.ch-ib-arch'),
              avatar: av ? { round: getComputedStyle(av).borderRadius, w: Math.round(av.getBoundingClientRect().width), bg: getComputedStyle(av).backgroundColor } : null, x: Math.round(r.x), h: Math.round(r.height), textX: Math.round((w.querySelector('.ch-ib-bd') || w.querySelector('.bd'))?.getBoundingClientRect().x || 0), ...(DUMP ? { html: w.outerHTML.slice(0, 2500) } : {}) };
          });
        }, !!process.env.QA_DUMP);
        entry.first = await lay();
        await shot('1-inbox');
        if (SW) {
          const by = Object.fromEntries(entry.first.map(r => [r.id, r]));
          const t = by['qa-new'], alert = by['qa-alert'], grp = entry.first.find(r => r.group), snoozed = by['qa-snoozed'];
          assert.ok(alert && grp && snoozed && t, 'rows present ' + JSON.stringify(entry.first.map(r => r.id)));
          for (const a of [alert, grp, snoozed]) {
            assert.ok(!/ch-notif-wrap/.test(a.cls), 'no amber card wrap on ' + a.id);
            assert.equal(a.wrap.bg, t.wrap.bg, 'same row background as a thread on ' + a.id);
            assert.ok(a.wrap.shadow === 'none' || [t, by['qa-read']].some(x => x.wrap.shadow === a.wrap.shadow), 'no amber outline (none, or the thread rows\' divider) on ' + a.id + ': ' + a.wrap.shadow);
            assert.equal(a.row.bg, t.row.bg, 'same button background as a thread on ' + a.id);
            assert.equal(a.row.shadow, t.row.shadow, 'same button outline as a thread on ' + a.id);
            assert.equal(a.h, t.h, 'same row height as a thread on ' + a.id);
            assert.equal(a.x, t.x, 'same row inset as a thread on ' + a.id);
            assert.equal(a.textX, t.textX, 'the words start where a thread\'s do on ' + a.id);
            assert.ok(a.bell, 'the one quiet marker (a small bell) on ' + a.id);
            assert.ok(a.fromCss, 'the source label on ' + a.id); assert.equal(a.fromCss.bg, t.fromCss ? t.fromCss.bg : 'rgba(0, 0, 0, 0)', 'no pill behind the label on ' + a.id);
            assert.ok([t, by['qa-read']].some(x => x.timeCss.color === a.timeCss.color), 'the time in a thread row\'s colour on ' + a.id + ': ' + a.timeCss.color);
            assert.ok(a.time && a.title && a.pv, 'time, title and preview on ' + a.id + ' ' + JSON.stringify(a));
            if (ROWS) {
              assert.ok(a.avatar && a.avatar.round === '50%' && a.avatar.w === t.avatar.w, 'round avatar like a thread on ' + a.id + ' ' + JSON.stringify(a.avatar));
              assert.equal(a.avatar.bg, t.avatar.bg, 'no yellow tile behind the avatar on ' + a.id);
              assert.ok(a.arch, 'Archive button on ' + a.id);
            }
          }
          assert.ok(/Archimedes|Wizard|Hermes|\S/.test(alert.from), 'the label line names the source ' + alert.from);
          assert.ok(/System alert/.test(alert.title) && /backup/.test(alert.pv), 'title + one preview line ' + JSON.stringify(alert));
          if (ROWS) { assert.equal(alert.dot, 'needs', 'a needs-you alert carries the needs dot'); assert.equal(snoozed.dot, '', 'snoozed: no dot'); }
          assert.equal(grp.count, '2', 'the folded group keeps its count');
          assert.equal(snoozed.titleWeight, by['qa-read'].titleWeight, 'snoozed: the title weight of a read thread'); assert.equal(snoozed.timeCss.color, by['qa-read'].timeCss.color, 'snoozed: the time colour of a read thread');
          assert.equal(snoozed.sec, ROWS ? 'snoozed' : snoozed.sec, 'snoozed alert in Snoozed');
          // Tap opens the alert.
          await vis('.ch-list [data-chnotif="qa-alert"]').click();
          await vis('.ch-notif-thread').waitFor({ timeout: 10000 });
          entry.opened = true;
          await shot('2-open');
          await back(); await nap(800);
          await vis('.ch-list [data-chnotif="qa-alert"]').waitFor({ timeout: 10000 });
          // Hold / context menu opens the Alert actions sheet with Archive.
          await vis('.ch-list [data-chnotif="qa-alert"]').focus();
          await page.keyboard.press('Shift+F10');
          const sheet = vis('.ch-sheet[aria-label="Alert actions"]');
          await sheet.waitFor({ timeout: 5000 });
          entry.sheet = (await sheet.innerText()).replace(/\s+/g, ' ').trim();
          assert.ok(/Archive|Done/.test(entry.sheet), 'Alert actions offers Archive: ' + entry.sheet);
          await page.keyboard.press('Escape'); await nap(400);
          if (await sheet.count() && await sheet.isVisible().catch(() => false)) { await back(); await nap(400); }
          if (ROWS) {
            // The row's Archive: the group's button archives every item in it.
            await vis(`.ch-list .ch-row-wrap:has([data-chnotif-group]) .ch-ib-arch`).click();
            await page.waitForFunction(() => !document.querySelector('.ch-list [data-chnotif-group]'), null, { timeout: 8000 });
            const m = entry.marks.find(x => x.archived);
            assert.ok(m && ['qa-fyi-a', 'qa-fyi-b'].every(id => m.ids.includes(id)), 'Archive on the group row archived both ' + JSON.stringify(entry.marks));
            await vis('.ch-list [data-chnotif="qa-alert"] ~ .ch-ib-arch, .ch-list .ch-row-wrap:has([data-chnotif="qa-alert"]) .ch-ib-arch').click();
            await page.waitForFunction(() => !document.querySelector('.ch-list section[data-sec="ready"] [data-chnotif="qa-alert"]'), null, { timeout: 8000 });
            assert.ok(entry.marks.some(x => x.archived && x.ids.includes('qa-alert')), 'Archive on the alert row archived it');
            await nap(600);
            entry.final = await lay();
            await shot('3-after-archive');
          }
        } else {
          fs.writeFileSync(path.join(out, `list-${stem}.html`), await page.evaluate(() => [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length).innerHTML.replace(/\b\d+(m|h)\b/g, 'T')));
          assert.ok(entry.first.some(r => /ch-notif-wrap/.test(r.cls)), 'switch off: today\'s alert rows');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SW ? 'on' : 'off', rows: ROWS ? 'on' : 'off', cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]) }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
