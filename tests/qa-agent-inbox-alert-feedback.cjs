'use strict';
// Alert rules feedback (wizard-ux issue 1589; box half wizard-agent-service issue 552; on for everyone since wizard-ux
// issue 1778, no switch) in a real browser. Disposable synthetic transport only: a fake box serves the channel store (Daily, Alerts, Trip), the
// Alerts channel's one agent post, the alert records (one ordinary, the day's collapsed "More alerts today" with its
// count), the Later list, a Daily thread whose history ends with the sweep card (with rules_flag), and answers
// PATCH /wizard/v1/agent-inbox/<id> {action: not_urgent | should_alert} with the example counts.
// Phone 390x844 and Classic desktop 1440x960, Nebula + Grove:
//   1. the Alerts channel shows the alert records with Not urgent (>= 44 px), the collapsed one with its count;
//   2. Not urgent sends exactly one PATCH and the alert leaves Alerts; on the collapsed one it clears it;
//   3. the sweep card (the Daily thread from the Inbox tab) carries Should have alerted on its items, the rules
//      line, and the Later list opens in place with Should have alerted; a tap sends one PATCH and marks it;
//   4. a live skin change repaints the block.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://agent-inbox-alerts.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'agent-inbox-alert-feedback-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const rid = c => 'inbox_' + c.repeat(24);
const AL = rid('a'), COL = rid('c'), W1 = rid('1'), DN = rid('f'), L1 = rid('2'), CARD = 'sweep_' + 'e'.repeat(24);
const CHANNELS = [
  { id: 'alerts', agent: 'hermes', name: 'Alerts', order: -1, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 0, kind: 'alerts' },
  { id: 'trip', agent: 'hermes', name: 'Trip', order: 0, createdAt: iso(now - 8e8), archived: false, pinned: false },
];
const THREADS = {
  'qa-alert-1': { title: 'Alert: build failed', at: now - 30 * M, channel: 'alerts', msgs: [['assistant', 'The nightly build failed on main. I restarted it.', 0]] },
  'qa-daily-1': { title: 'Daily · Thu 19 Nov', at: now - 5 * M, msgs: [['user', 'signal sweep', 0], ['assistant', 'The card is posted below.', 30]] },
  'qa-chat-1': { title: 'Weekend plans', at: now - 20 * M, channel: 'trip', msgs: [['user', 'What should we do on Saturday?', 0], ['assistant', 'A walk by the river.', 60]] },
};
const boxFresh = () => ({
  alerts: [
    { id: AL, kind: 'alert', agent: 'hermes', thread_id: 'alert_' + 'a'.repeat(24), title: 'Payment failed: Netflix', ask: 'Your card was declined for €15.99. Update it before Friday.', severity: 'high', state: 'new', created_at: now - 9 * M, updated_at: now - 9 * M },
    { id: COL, kind: 'alert', agent: 'hermes', thread_id: 'alert_' + 'c'.repeat(24), title: 'More alerts today', ask: '4 more alerts today. They wait in the next sweep; the alert rules may be too loose.', severity: 'high', state: 'new', alert_collapsed: true, alert_extra: 4, created_at: now - 20 * M, updated_at: now - 3 * M },
  ],
  later: [
    { id: L1, kind: 'fyi', agent: 'hermes', thread_id: 'mail_1', title: 'School newsletter', ask: 'Sports day moved to Friday 14:00.', state: 'new', updated_at: now - 40 * M },
    { id: rid('3'), kind: 'note', agent: 'hermes', thread_id: 'mail_2', title: 'Parcel shipped', ask: 'Arrives Monday.', state: 'surfaced', updated_at: now - 50 * M },
  ],
  ex: { not_urgent: 2, should_alert: 1 },
});
const cardView = () => ({ schema: 'wizard.agent-sweep/1', id: CARD, at: now - 2 * M, day: '2026-11-19', thread_id: 'qa-daily-1', agent: 'hermes',
  waiting: { items: [{ id: W1, agent: 'hermes', thread_id: 'qa-chat-1', title: 'Dentist slot', ask: 'Tuesday 10:00 or Thursday 16:00?', recommendation: 'Tuesday: your calendar is free', options: [{ token: 'tuesday' }, { token: 'thursday' }], default_option: 'tuesday', confirm: false, seen: 1, link: '/wizard-os-home/?session=qa-chat-1', state: 'surfaced' }], more: 0, link: '/wizard-os-home/?inbox=waiting' },
  done: { items: [{ id: DN, title: 'Tax form filed', link: '/wizard-os-home/?session=qa-chat-1' }], more: 0, link: '/wizard-os-home/?inbox=done' },
  running: { count: 0, stale: 0, link: '/wizard-os-home/?inbox=running' }, later: { count: 2, link: '/wizard-os-home/?inbox=later' }, parked: { count: 0, link: '/wizard-os-home/?inbox=parked' },
  missing: 0, rules_flag: { day: '2026-11-19', alerts: 5, cap: 3, link: '/wizard-os-home/?inbox=alert-rules' }, yes_to_all: { count: 1, skipped: 0 } });
const cardRow = () => { const v = cardView(); return { id: v.id, role: 'assistant', session_id: v.thread_id, timestamp: v.at / 1000, display_kind: 'agent_sweep', content: '**Signal sweep**\n\n**Waiting on you** (1)', agent_sweep: v }; };
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.channel ? { channel: s.channel } : {}) });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], patches: [], inboxReads: 0 }; report.cases.push(entry);
      const box = boxFresh();
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.view.v1': 'channels',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            const m = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && m) {
              const body = q.postDataJSON(); entry.patches.push({ id: m[1], ...body });
              await nap(600);
              const rec = [...box.alerts, ...box.later].find(x => x.id === m[1]) || (m[1] === W1 || m[1] === DN ? { id: m[1], kind: 'needs_you', state: 'surfaced' } : null);
              if (!rec) return r.fulfill({ status: 404, json: { error: 'not_found' } });
              box.ex[body.action]++;
              if (body.action === 'not_urgent') { box.alerts = box.alerts.filter(x => x.id !== rec.id); if (!rec.alert_collapsed) { rec.kind = 'fyi'; box.later.unshift(rec); } else rec.state = 'archived'; }
              rec.feedback = body.action;
              return r.fulfill({ json: { record: rec, examples: box.ex } });
            }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p.startsWith('/wizard/v1/agent-inbox')) {
            entry.inboxReads++;
            if (p === '/wizard/v1/agent-inbox/sweep') return r.fulfill({ json: { card: cardView() } });
            if (p === '/wizard/v1/agent-inbox' && u.searchParams.get('kind') === 'alert') return r.fulfill({ json: { records: box.alerts.filter(x => x.state === 'new' || x.state === 'surfaced'), check: null, stay: [] } });
            if (p === '/wizard/v1/agent-inbox' && u.searchParams.get('state') === 'new,surfaced') return r.fulfill({ json: { records: box.later, check: null, stay: [] } });
            if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null, stay: ['qa-daily-1'] } });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - 864e5), channels: CHANNELS } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel');
            const data = Object.entries(THREADS).filter(([, s]) => s.channel === id).map(([tid, s]) => ({ ...raw(tid, s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = THREADS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600, rows = s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt }));
            if (m[2] && id === 'qa-daily-1') rows.push(cardRow());
            return r.fulfill({ json: m[2] ? { messages: rows } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/desktop-chats'), null, { timeout: 15000 });
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const openList = () => page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await openList();
        await vis('.ch-chan-open[data-chchan="alerts"]').waitFor({ timeout: 15000 });
        await vis('.ch-chan-open[data-chchan="alerts"]').click();
        await vis('.ch-chan-feed').getByText('The nightly build failed').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready); await nap(1200);
        // 1. The Alerts channel: both alert records, Not urgent, the collapsed count.
        const block = vis('.ch-alerts');
        await block.waitFor({ timeout: 8000 });
        const fb = action => page.locator(`[data-chalertfb="${action}"]`).filter({ visible: true }).evaluateAll(b => b.map(x => { const r = x.getBoundingClientRect(); return { id: x.dataset.id, text: x.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; }));
        entry.alertsBefore = await fb('not_urgent');
        assert.deepEqual(entry.alertsBefore.map(b => b.id), [COL, AL], 'two alerts, newest news first');
        assert.ok(entry.alertsBefore.every(b => b.h >= 44 && b.w >= 44 && b.text === 'Not urgent'), JSON.stringify(entry.alertsBefore));
        assert.equal(await block.locator('.ch-al-i.collapsed .ch-al-n').innerText(), '4', 'the collapsed alert shows its count');
        await block.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, stem + '-1-alerts.png') });
        // Live skin change.
        const colour = () => block.evaluate(n => getComputedStyle(n).backgroundColor + ' / ' + getComputedStyle(n.querySelector('[data-chalertfb]')).backgroundColor);
        entry.colour = await colour();
        const other = skin === 'nebula' ? 'grove' : 'nebula';
        await page.evaluate(s => WosSkin.set(s), other); await nap(700);
        entry.colourOther = await colour();
        assert.notEqual(entry.colourOther, entry.colour, `the ${other} skin repaints the block (${entry.colour} → ${entry.colourOther})`);
        await page.evaluate(s => WosSkin.set(s), skin); await nap(500);
        // 2. Not urgent: one PATCH; the alert leaves Alerts. Then the collapsed one: cleared.
        await vis(`[data-chalertfb="not_urgent"][data-id="${AL}"]`).click();
        entry.sending = await vis(`[data-chalertfb="not_urgent"][data-id="${AL}"]`).innerText().catch(() => '');
        await page.waitForFunction(id => !document.querySelector(`[data-chalertfb="not_urgent"][data-id="${id}"]`), AL, { timeout: 8000 });
        assert.deepEqual(entry.patches, [{ id: AL, action: 'not_urgent' }], 'exactly one PATCH');
        entry.toast1 = await page.locator('.toast, #toast, [data-toast]').filter({ visible: true }).first().innerText().catch(() => '');
        await page.screenshot({ path: path.join(out, stem + '-2-not-urgent.png') });
        await vis(`[data-chalertfb="not_urgent"][data-id="${COL}"]`).click();
        await page.waitForFunction(() => !document.querySelector('.ch-alerts'), null, { timeout: 8000 });
        assert.deepEqual(entry.patches.map(x => x.id), [AL, COL]);
        // 3. The sweep card in the Daily thread (a row in the Activity list).
        await openList();
        if (await page.locator('[data-chchanback]').filter({ visible: true }).count()) await vis('[data-chchanback]').click();
        await vis('.ch-tabbar [data-chtab="inbox"]').click();
        await vis('.ch-list [data-chopen="qa-daily-1"]').click();
        const card = vis('.ch-sweep');
        await card.waitFor({ timeout: 10000 });
        entry.cardBefore = await fb('should_alert');
        assert.deepEqual(entry.cardBefore.map(b => b.id), [W1, DN], 'Should have alerted on the Waiting and Done items');
        assert.ok(entry.cardBefore.every(b => b.h >= 44), JSON.stringify(entry.cardBefore));
        assert.match(await card.innerText(), /Alert rules let 5 alerts through on 2026-11-19 \(more than 3\): check the rules/);
        await vis('[data-chsweeplater]').click();
        await card.getByText('School newsletter').waitFor({ timeout: 6000 });
        entry.laterButtons = await fb('should_alert');
        assert.deepEqual(entry.laterButtons.map(b => b.id), [W1, DN, AL, L1, rid('3')], 'the Later list (with the alert just marked Not urgent) carries it too');
        await vis(`[data-chalertfb="should_alert"][data-id="${L1}"]`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, stem + '-3-sweep-later.png') });
        await vis(`[data-chalertfb="should_alert"][data-id="${L1}"]`).click();
        await page.waitForFunction(id => !document.querySelector(`[data-chalertfb="should_alert"][data-id="${id}"]`), L1, { timeout: 8000 });
        assert.deepEqual(entry.patches.at(-1), { id: L1, action: 'should_alert' });
        assert.equal(entry.patches.length, 3);
        await card.getByText('Marked · alerts like this get through next time').first().waitFor();
        await page.screenshot({ path: path.join(out, stem + '-4-should-have-alerted.png') });
        assert.deepEqual(entry.refused, [], 'nothing refused');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
