'use strict';
// Quiet inbox: replies typed in a thread (wizard-ux issue 1808; on for everyone since wizard-ux issue 1778, no switch)
// in a real browser. Disposable synthetic transport only: a fake box lists two threads the owner replied in, the Agent
// Service's Sent log rows for those replies (source reply, route thread) and, on the thread whose newest answer
// needed nothing from him, the list row's wizard_quiet_reply mark.
//   "Clips edit failure": he wrote "Sent to Miguel, done", the agent answered fyi "Nothing needed from you." (quiet).
//   "Mac app": he asked "is the mac app ready?", the agent answered fyi (not quiet: he asked).
// Phone 412x915 and Classic desktop 1440x960, Nebula + Light (obsidian-light):
//   Inbox's Ready lists Mac app (green, unread) and not Clips edit failure, which sits in Recent with no unread mark;
//   Sent lists both replies as "Reply" with the agent's one-line answer ("Done · nothing needed from you" / "Done · you
//   asked") and no routing correction; a tap on the quiet row opens its thread.
// QA_SHOTS=1 names the phone Nebula Inbox shot after.png for the pitch.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://quiet-replies.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'quiet-replies-evidence');
const shots = process.env.QA_SHOTS === '1';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const fyi = ask => ({ state: 'fyi', ask });
const THREADS = {
  'qa-clips': { title: 'Clips edit failure', at: now - 4 * M, quiet: true, attention: fyi('Clip edit is with Miguel. Nothing needed from you.'),
    msgs: [['user', 'Why did the clips edit fail?', 0], ['assistant', 'The export hit a codec error; I re-ran it and sent the fixed clip to your folder.', 40], ['user', 'Sent to Miguel, done', 300], ['assistant', 'Great, the clip edit is with Miguel now. Nothing needed from you.', 320]] },
  'qa-mac': { title: 'Mac app', at: now - 9 * M, attention: fyi('The Mac app build is still running.'),
    msgs: [['user', 'Build the mac app', 0], ['assistant', 'Started the Mac build.', 30], ['user', 'is the mac app ready?', 280], ['assistant', 'Not yet, the build is still running. About ten minutes left.', 300]] },
  'qa-old': { title: 'Weather tomorrow', at: now - 3 * H, seen: true, attention: fyi('Sunny tomorrow, 18 °C.'),
    msgs: [['user', 'Tell me the weather tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind.', 30]] },
};
const id = c => 'sent_' + c.repeat(24);
const SENT = [
  { id: id('a'), at: now - 4 * M - 20e3, source: 'reply', text: 'Sent to Miguel, done', route: 'thread', decided_by: 'owner_words', rules_matched: ['statement'], model: '', tags: [], urgent: false, thread_id: 'qa-clips', record_id: null, state: 'done', wants_reply: false, outcome: 'fyi', quiet: true, answer: 'Clip edit is with Miguel. Nothing needed from you.' },
  { id: id('b'), at: now - 9 * M - 20e3, source: 'reply', text: 'is the mac app ready?', route: 'thread', decided_by: 'owner_words', rules_matched: ['short_question'], model: '', tags: [], urgent: false, thread_id: 'qa-mac', record_id: null, state: 'done', wants_reply: true, outcome: 'fyi', quiet: false, answer: 'The Mac app build is still running.' },
  { id: id('c'), at: now - 20 * M, source: 'typed', text: 'Why did the clips edit fail?', route: 'agent', decided_by: 'owner_words', rules_matched: ['typed'], model: '', tags: [], urgent: false, thread_id: 'qa-clips', record_id: null, state: 'done', would_route: 'agent', would_decided_by: 'owner_words', would_rules: [] },
];
const raw = (sid, s) => {
  const t0 = s.at / 1000 - 330, last = s.msgs.at(-1), lastUser = [...s.msgs].reverse().find(m => m[0] === 'user');
  return { id: sid, title: s.title, runtime: 'direct', source: 'wizard-mobile', status: 'completed', updated_at: iso(s.at), last_active: t0 + last[2], message_count: s.msgs.length,
    preview: last[1], wizard_last_assistant_at: t0 + last[2], wizard_last_user_at: t0 + lastUser[2], wizard_attention: s.attention,
    latest_message: { role: last[0], content: last[1], timestamp: t0 + last[2] }, last_user_message: { role: 'user', content: lastUser[1], timestamp: t0 + lastUser[2] },
    ...(s.quiet ? { wizard_quiet_reply: true } : {}) };
};
// The owner has read the old thread; the two replies' answers are newer than anything he saw.
const SEEN = { initializedAt: 1, threads: { 'direct:qa-old': { seenAt: now, updatedAt: iso(THREADS['qa-old'].at), messageCount: 2, assistantActivityAt: iso(now) } } };
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], sentReads: 0 }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
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
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: SEEN } });
          if (p === '/wizard/v1/sent') { entry.sentReads++; return r.fulfill({ json: { rows: SENT, next: null, check: null } }); }
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
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
            const t0 = s.at / 1000 - 330;
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
        const count = sel => page.locator(sel).filter({ visible: true }).count();
        await vis('.ch-list [data-chopen="qa-mac"]').waitFor({ timeout: 15000 });
        await nap(1500); // the Sent log and the seen state have landed
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const inSec = (sec, sid) => count(`.ch-list section[data-sec="${sec}"] [data-chopen="${sid}"]`);
        const unread = sid => page.locator(`.ch-list [data-chopen="${sid}"]`).filter({ visible: true }).first().evaluate(n => n.classList.contains('unread'));
        entry.isNew = await page.evaluate(() => Object.fromEntries(['qa-clips', 'qa-mac', 'qa-old'].map(id => [id, !!window.WizLive?.isNew(window.WizLive.session(id))])));
        entry.sections = { clipsReady: await inSec('ready', 'qa-clips'), clipsRecent: await inSec('recent', 'qa-clips'), macReady: await inSec('ready', 'qa-mac') };
        // 1. Inbox: the question's answer is in Ready (unread); the "done" reply's answer is not, and is not unread.
        assert.equal(entry.sections.macReady, 1, 'the answer to his question is in Inbox / Ready: ' + JSON.stringify(entry.sections));
        assert.equal(await unread('qa-mac'), true, 'and unread (green)');
        assert.equal(entry.sections.clipsReady, 0, '"Sent to Miguel, done" answered fyi stays out of Ready: ' + JSON.stringify(entry.sections));
        assert.equal(entry.sections.clipsRecent, 1, 'it is in Recent, where read threads are');
        assert.equal(await unread('qa-clips'), false, 'no green dot');
        assert.deepEqual(entry.isNew, { 'qa-clips': false, 'qa-mac': true, 'qa-old': false }, 'unread counts agree');
        await shot('1-inbox');
        if (shots && phone && skin === 'nebula') fs.copyFileSync(path.join(out, `${stem}-1-inbox.png`), path.join(out, 'after.png'));
        // 2. Sent: both replies as rows that stayed in their chat (Sent rows, issue 1814), no routing correction on the rows.
        await vis('.ch-tabbar [data-chtab="sent"]').click();
        await vis('.ch-sr-row').waitFor({ timeout: 8000 });
        const rows = () => page.locator('.ch-sr-row').filter({ visible: true }).evaluateAll(b => b.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
        entry.rows = await rows();
        assert.equal(entry.rows.length, 3, JSON.stringify(entry.rows));
        assert.match(entry.rows[0], /Sent to Miguel, done.*Noted in its chat · Done/, entry.rows[0]);
        assert.match(entry.rows[1], /is the mac app ready\?.*Replied in its chat · Done/, entry.rows[1]);
        assert.match(entry.rows[2], /Why did the clips edit fail\?.*Replied in chat · Done/, entry.rows[2]);
        assert.equal(await count('.ch-sr-row [data-chsentfix], .ch-sr-row [data-rssentfix]'), 0, 'corrections live in the row\'s actions sheet');
        await shot('2-sent');
        // 3. A tap on the quiet reply opens its thread.
        await vis(`[data-chsent="${id('a')}"]`).click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Great, the clip edit is with Miguel now. Nothing needed from you.').waitFor({ timeout: 10000 });
        await shot('3-thread');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.deepEqual(entry.refused.filter(x => x.reason === 'unexpected-write'), [], 'no unexpected writes');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
