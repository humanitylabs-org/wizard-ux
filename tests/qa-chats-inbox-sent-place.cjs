'use strict';
// Every thread in exactly one place, Inbox or Sent (wizard-ux issue 1829), in a real browser. Disposable synthetic
// transport only. Phone 412x915, Classic desktop and the AI apps desktop's Chats sidebar (1440x960), Inbox until archived on for everyone (Inbox rows
// are on for everyone). A mixed set of threads, each with what the box says about it:
//   qa-quiet  "Sent to Miguel, done", answered fyi "Nothing needed from you." (quiet reply)     → Sent only
//   qa-mac    "is the mac app ready?", answered fyi (he asked)                                   → Inbox only
//   qa-needs  answered needs you                                                                 → Inbox only
//   qa-failed the run failed                                                                     → Inbox only
//   qa-run    had an answer, then he sent again and it is working now                            → Sent only (Working)
//   qa-alert  a scheduled report he didn't start (no Sent row)                                   → Inbox only
// Then qa-quiet's newest outcome turns needs you: it moves from Sent to Inbox live, no reload. Opening an Inbox thread
// keeps it in Inbox. Inbox until archived is on for everyone (issue 1810).
// The routing above is triage, so it is Smart inbox only (wizard-ux issue 1962): QA_SMART=on turns wizard/smart-inbox on
// and checks it (qa-alert, a thread he didn't start, finishes in Sent there too; #1883). Off (the default run, everyone's
// default): nothing leaves Inbox. All six are in Inbox (qa-run in Inbox › Working, qa-quiet's FYI reply in Inbox and
// counted), Sent lists the five threads he sent into (so a thread can be in both) and its sheet has no routing corrections.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-place-1829.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-inbox-sent-place-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,aiapps').split(','), SW = process.env.QA_SMART === 'on', ROWS = true; // Inbox rows are on for everyone (wizard-ux issue 1779)
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const fyi = ask => ({ state: 'fyi', ask });
let THREADS, SENT;
const fresh = () => ({
  'qa-quiet': { title: 'Clip edit', at: now - 5 * M, quiet: true, attention: fyi('Clip edit is with Miguel. Nothing needed from you.'), msgs: [['user', 'Send the clip edit to Miguel', 0], ['assistant', 'Sent.', 20], ['user', 'Sent to Miguel, done', 200], ['assistant', 'Nothing needed from you.', 220]] },
  'qa-mac': { title: 'Mac app', at: now - 8 * M, attention: fyi('The Mac app build is still running.'), msgs: [['user', 'is the mac app ready?', 0], ['assistant', 'The Mac app build is still running.', 30]] },
  'qa-needs': { title: 'Flight booking', at: now - 12 * M, attention: { state: 'needs_you', ask: 'Which seat do you want, window or aisle?' }, msgs: [['user', 'Book the Friday flight', 0], ['assistant', 'Which seat do you want, window or aisle?', 30]] },
  'qa-failed': { title: 'Photo export', at: now - 15 * M, status: 'failed', msgs: [['user', 'Export the album', 0], ['assistant', 'Starting the export.', 30]] },
  'qa-run': { title: 'Mine is not displaying this', at: now - 2 * M, status: 'running', msgs: [['user', 'Mine is not displaying this', 0], ['assistant', 'Looking at it.', 20], ['user', 'Check the phone build too', 100]] },
  'qa-alert': { title: 'Morning report', at: now - 20 * M, attention: fyi('Three meetings today, first at 9.'), msgs: [['assistant', 'Three meetings today, first at 9.', 0]] },
});
const sid = c => 'sent_' + c.repeat(24);
const freshSent = () => [
  { id: sid('a'), at: now - 2 * M, source: 'reply', text: 'Check the phone build too', route: 'thread', decided_by: 'owner_words', rules_matched: ['typed'], tags: [], urgent: false, thread_id: 'qa-run', record_id: null, state: 'running', wants_reply: true },
  { id: sid('b'), at: now - 5 * M, source: 'reply', text: 'Sent to Miguel, done', route: 'thread', decided_by: 'owner_words', rules_matched: ['no_reply:done'], tags: [], urgent: false, thread_id: 'qa-quiet', record_id: null, state: 'done', wants_reply: false, quiet: true, answer: 'Nothing needed from you.' },
  { id: sid('c'), at: now - 8 * M, source: 'reply', text: 'is the mac app ready?', route: 'thread', decided_by: 'owner_words', rules_matched: ['short_question'], tags: [], urgent: false, thread_id: 'qa-mac', record_id: null, state: 'done', wants_reply: true, answer: 'The Mac app build is still running.' },
  { id: sid('d'), at: now - 12 * M, source: 'orb', text: 'Book the Friday flight', route: 'agent', decided_by: 'owner_words', rules_matched: ['task_verb'], tags: [], urgent: false, thread_id: 'qa-needs', record_id: null, state: 'needs_you', wants_reply: true },
  { id: sid('e'), at: now - 15 * M, source: 'typed', text: 'Export the album', route: 'agent', decided_by: 'owner_words', rules_matched: ['typed'], tags: [], urgent: false, thread_id: 'qa-failed', record_id: null, state: 'failed', wants_reply: true },
  { id: sid('f'), at: now - 40 * M, source: 'orb', text: 'Send the clip edit to Miguel', route: 'agent', decided_by: 'owner_words', rules_matched: ['task_verb'], tags: [], urgent: false, thread_id: 'qa-quiet', record_id: null, state: 'done', wants_reply: true },
  { id: sid('0'), at: now - 50 * M, source: 'orb', text: 'Mine is not displaying this', route: 'agent', decided_by: 'owner_words', rules_matched: ['task_verb'], tags: [], urgent: false, thread_id: 'qa-run', record_id: null, state: 'done', wants_reply: true },
];
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', preview_role: s.msgs.at(-1)?.[0],
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.quiet ? { wizard_quiet_reply: true } : {}) });
// Everything was read before (so a quiet answer is not what keeps a thread anywhere).
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).map(([id, s]) => [id, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: now }])) } });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) {
      const phone = shell === 'phone', aad = shell === 'aiapps', stem = `${shell}-${SW ? (ROWS ? 'rows' : 'on') : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      THREADS = fresh(); SENT = freshSent();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SW ? { 'wizard/smart-inbox': true } : {}) };
        await context.addInitScript(({ shell, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': shell === 'aiapps' ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: SENT, next: null, check: null } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'recent' } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = THREADS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (aad) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const openSecs = aad ? async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.aad-side .aad-sec[data-sec="${k}"]`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } } : async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.ch-list section[data-sec="${k}"] > .ch-sec-h, .ch-list section[data-sec="${k}"] .ch-sec-hl > .ch-sec-h`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } };
        // Inbox as a person sees it: each thread row and the section it sits in (Snoozed / Archived are not Inbox).
        const inbox = () => page.evaluate(aad => {
          if (aad) {
            const out = {};
            for (const b of document.querySelectorAll('.aad-side .aad-sec-b[id^="aad-sec-"]')) for (const r of b.querySelectorAll('.aad-rw[data-sid]')) if (r.getClientRects().length) out[r.dataset.sid] = b.id.slice(8);
            return out;
          }
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          const out = {};
          for (const s of list.querySelectorAll('section.ch-sec[data-sec]')) for (const r of s.querySelectorAll('[data-chopen]')) if (r.getClientRects().length) out[r.dataset.chopen] = s.dataset.sec;
          return out;
        }, aad);
        const rowSel = id => aad ? `.aad-side .aad-rw[data-sid="${id}"] .aad-row` : `.ch-list [data-chopen="${id}"]`;
        // Sent as a person sees it: the thread each visible Sent row opens.
        const sentThreads = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-chsentthread]')].filter(n => n.getClientRects().length).map(n => n.dataset.chsentthread))].sort());
        const tab = async k => { await vis(`.ch-tabbar [data-chtab="${k}"]`).click(); await nap(700); };
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        await vis(rowSel('qa-mac')).waitFor({ timeout: 15000 });
        await nap(800); await openSecs();
        const place = async (tag = '1') => {
          await tab('inbox'); await openSecs(); const i = await inbox(); await shot(tag + '-inbox');
          await tab('sent'); await vis('[data-chsentthread]').waitFor({ timeout: 8000 }).catch(() => {}); const s = await sentThreads(); await shot(tag + '-sent');
          await tab('inbox');
          const inInbox = Object.entries(i).filter(([, k]) => ['ready', 'working', 'recent', 'saved'].includes(k)).map(([id]) => id).sort();
          return { inbox: i, inInbox, sent: s, both: inInbox.filter(id => s.includes(id)) };
        };
        // The box's Sent log has been read (the lists repaint when it lands).
        await page.waitForFunction(() => window.WizLive?.sentLog?.state?.().ok, null, { timeout: 15000 }); await nap(1200);
        entry.before = await place();
        if (SW) {
          assert.deepEqual(entry.before.both, [], 'never in both Inbox and Sent: ' + JSON.stringify(entry.before));
          assert.deepEqual(entry.before.inInbox, ['qa-failed', 'qa-mac', 'qa-needs'], 'Inbox: what needs him ' + JSON.stringify(entry.before));
          assert.deepEqual(entry.before.sent, ['qa-alert', 'qa-quiet', 'qa-run'], 'Sent: what needs nothing (quiet done, working, not his) ' + JSON.stringify(entry.before));
          assert.ok(!Object.values(entry.before.inbox).includes('working'), 'no Working section in Inbox');
          // Opening an Inbox thread keeps it there (#1810).
          await vis(rowSel('qa-mac')).click();
          await page.locator('.ch-thread').filter({ visible: true }).first().getByText('The Mac app build is still running.').first().waitFor({ timeout: 10000 });
          await nap(500); await back(); await nap(800); await openSecs();
          entry.afterOpen = await inbox();
          assert.equal(entry.afterOpen['qa-mac'], 'ready', 'opened, still in Inbox');
          // qa-quiet's newest outcome turns needs you: it leaves Sent and enters Inbox, live.
          THREADS['qa-quiet'].quiet = false; THREADS['qa-quiet'].attention = { state: 'needs_you', ask: 'Miguel asked for the raw files. Send them?' }; THREADS['qa-quiet'].at = Date.now();
          SENT = SENT.map(r => r.id === sid('b') ? { ...r, state: 'needs_you', quiet: false } : r);
          await page.evaluate(() => { window.WizLive?.refresh?.(); window.WizLive?.sentLog?.fresh?.(); });
          await tab('inbox'); await openSecs();
          await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.getClientRects().length), rowSel('qa-quiet'), { timeout: 20000 });
          entry.moved = await place('2');
          assert.deepEqual(entry.moved.both, [], 'never in both after the move: ' + JSON.stringify(entry.moved));
          assert.ok(entry.moved.inInbox.includes('qa-quiet'), 'needs you now: in Inbox ' + JSON.stringify(entry.moved));
          assert.ok(!entry.moved.sent.includes('qa-quiet'), 'needs you now: gone from Sent ' + JSON.stringify(entry.moved));
          assert.equal(await page.evaluate(() => window.WizCore?.activityReady?.(window.WizLive)), entry.moved.inInbox.length, 'the badge count is the Inbox count');
        } else {
          // Issue 1962: Smart inbox off, nothing is routed out of Inbox.
          assert.deepEqual(entry.before.inInbox, ['qa-alert', 'qa-failed', 'qa-mac', 'qa-needs', 'qa-quiet', 'qa-run'], 'off: every thread is in Inbox ' + JSON.stringify(entry.before));
          assert.equal(entry.before.inbox['qa-quiet'], 'ready', 'off: the FYI "nothing needed" reply is in Inbox ' + JSON.stringify(entry.before));
          assert.equal(entry.before.inbox['qa-run'], 'working', 'off: a running thread he started is in Inbox › Working');
          assert.deepEqual(entry.before.sent, ['qa-failed', 'qa-mac', 'qa-needs', 'qa-quiet', 'qa-run'], 'off: Sent lists every thread he sent into ' + JSON.stringify(entry.before));
          assert.deepEqual(entry.before.both, entry.before.sent, 'off: a thread can be in both');
          assert.equal(await page.evaluate(() => window.WizCore?.activityReady?.(window.WizLive)), 5, 'off: the badge counts the quiet reply too (5 Ready, qa-run is Working)');
          // No routing corrections in Sent's sheet.
          await tab('sent'); await vis('[data-chsentthread="qa-mac"]').click({ button: 'right' }); await vis('.ch-sheet').waitFor({ timeout: 5000 });
          entry.sheet = await vis('.ch-sheet').innerText(); await shot('3-sent-sheet');
          assert.ok(!/Should have replied|Didn.t need a reply/.test(entry.sheet), 'off: no routing corrections ' + entry.sheet);
          await back(); await nap(400); await tab('inbox');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, `report-${SW ? (ROWS ? 'rows' : 'on') : 'off'}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SW ? (ROWS ? 'on+rows' : 'on') : 'off', cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), before: report.cases.map(c => [c.stem, c.before]) }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
