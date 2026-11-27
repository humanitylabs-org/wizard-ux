'use strict';
// wizard-ux issue 1990 in a real browser (James, 27 Nov 2026: "When I reply to a thread in my inbox and it jumps back to
// my inbox screen, that card should immediately disappear from inbox. Don't make me wait three seconds before it
// disappears."). Disposable synthetic transport only (no write reaches a box). Phone 412x915 (slow disk, 4x slower CPU,
// after-send "list") and Classic desktop 1440x960. He opens an Inbox row, replies (typed; on the phone also an orb voice
// take) and is back on the Inbox. From the first paint after the send the row is never an Inbox row while the run
// starts: with Smart inbox on (QA_SMART=on) it is in Sent › Working; off (everyone's default, issue 1962: nothing is
// routed out of Inbox) it is in Inbox › Working on top. QA_KINDS: done (a read answer) and record (a background task
// waiting on him, the case that broke: its hidden worker thread was listed only on the box's next list read, ~3 s later,
// so the task row stayed). The box's list is QA_LAG ms behind (default 3 s: it still leaves the hidden thread out), and
// such a stale read must not bring the row back. When the run finishes needing him (QA_FINISH) the thread is in Inbox
// again, typed or voice (a voice reply used to stay in Working for a full minute). A send the box refuses puts the row
// back in Inbox, with Retry.
// QA_EXPECT=broken (with QA_WEB=<main worktree>/web) checks the baseline still fails (the record rows).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://inbox-reply-1990.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'inbox-reply-leaves-evidence');
// Which Inbox row he replies from: done (a read answer) | needs (needs you) | unread | record (a background task waiting
// on him: its worker thread is hidden, the row is the box's agent-inbox record; the case James hit).
const KINDS = (process.env.QA_KINDS || process.env.QA_KIND || 'done,record').split(',');
let KIND = KINDS[0];
const SLOW = +(process.env.QA_SLOW_DISK ?? 1500), CPU = +(process.env.QA_CPU || 4); // a phone WebView: slow disk, slow CPU
const BOX = process.env.QA_BOX || 'live', ADMIT = +(process.env.QA_ADMIT || 600), LAG = +(process.env.QA_LAG ?? 3000), FINISH = +(process.env.QA_FINISH || 8000);
const ROW = '[data-chopen="qa-reply"],[data-chrunopen="qa-reply"]';
const SMART = process.env.QA_SMART === 'on', BROKEN = process.env.QA_EXPECT === 'broken';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(',');
const MODES = (process.env.QA_MODES || 'typed,voice,refused').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const fresh = () => ({
  'qa-reply': { title: 'Flight options', hidden: KIND === 'record', at: now - 6 * M, attention: KIND === 'needs' ? { state: 'needs_you', ask: 'Which one should I book, 9:10 or 14:40?' } : { state: 'done', ask: 'Two flights on Friday, 9:10 and 14:40.' }, msgs: [['user', 'What flights are there on Friday?', 0], ['assistant', 'Two flights on Friday, 9:10 and 14:40.', 30]] },
  'qa-other': { title: 'Mac app', at: now - 9 * M, attention: { state: 'done', ask: 'The Mac app build is ready.' }, msgs: [['user', 'is the mac app ready?', 0], ['assistant', 'The Mac app build is ready.', 30]] },
});
const sid = c => 'sent_' + c.repeat(24);
const FINISHED = { done: false };
const RECORDS = [{ id: 'inbox_' + 'a'.repeat(24), agent: 'hermes', kind: 'needs_you', state: 'new', thread_id: 'qa-reply', title: 'Flight options', ask: 'Which one should I book, 9:10 or 14:40?', created_at: now - 20 * M, updated_at: now - 6 * M }];
const freshSent = () => [
  { id: sid('a'), at: now - 6 * M, source: 'typed', text: 'What flights are there on Friday?', route: 'agent', decided_by: 'owner_words', rules_matched: ['question'], tags: [], urgent: false, thread_id: 'qa-reply', record_id: null, state: 'done', wants_reply: true },
  { id: sid('b'), at: now - 9 * M, source: 'typed', text: 'is the mac app ready?', route: 'agent', decided_by: 'owner_words', rules_matched: ['short_question'], tags: [], urgent: false, thread_id: 'qa-other', record_id: null, state: 'done', wants_reply: true },
];
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', preview_role: s.msgs.at(-1)?.[0], wizard_last_assistant_at: s.at / 1000,
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.hidden ? { hidden: true } : {}),
  ...(s.runId ? { wizard_run_id: s.runId, wizard_last_run_id: s.runId, wizard_last_run_status: s.runStatus, wizard_last_run_idempotency_key: s.key } : {}) });
const report = { origin, web, smart: SMART, cases: [] };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const kind of KINDS) for (const shell of SHELLS) for (const mode of MODES) {
      if (mode === 'voice' && shell !== 'phone') continue; // the orb take is the phone's voice reply
      KIND = kind;
      const phone = shell === 'phone', stem = `${shell}-${mode}-${KIND}-${SMART ? 'smart' : 'off'}`;
      const entry = { stem, errors: [], writes: [] }; report.cases.push(entry);
      const THREADS = fresh(); let SENT = freshSent(); FINISHED.done = false;
      const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).filter(([id]) => !(KIND === 'unread' && id === 'qa-reply')).map(([id, s]) => [id, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: now }])) } });
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, serviceWorkers: 'block', permissions: ['microphone'], ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(SMART ? { 'wizard/smart-inbox': true } : {}) };
        await context.addInitScript(({ shell, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.voiceTipSeen': 'true',
            'wos.chats.afterAction.v1': 'list', 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, mix });
        // A slow phone disk (as an Android WebView can be): every IndexedDB readwrite transaction completes late.
        await context.addInitScript(slow => {
          if (!slow) return;
          const orig = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (s, mode) {
            const t = orig.apply(this, arguments); if (mode !== 'readwrite') return t;
            let cb = null; const real = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
            real.set.call(t, ev => setTimeout(() => cb && cb.call(t, ev), slow));
            Object.defineProperty(t, 'oncomplete', { configurable: true, get: () => cb, set: f => { cb = f; } });
            return t;
          };
        }, mode === 'refused' ? 0 : SLOW); // the refusal is about the box's answer, not the disk
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (p === '/wizard/hermes/v1/runs') {
              await nap(ADMIT); // the box takes its time to admit the run, like a real one
              if (mode === 'refused') return r.fulfill({ status: 400, json: { error: 'qa refused' } }).catch(() => {});
              // A box that lists the run once admitted: queued, then running (QA_BOX=live); stale keeps "completed".
              // The box's list is LAG ms behind (QA_LAG, default 2 s): until then it still lists the thread as it was
              // before the reply (a hidden worker thread: not listed at all); then it is listed (the box's owner turn
              // un-hides it) and running.
              // FINISH ms after it was accepted the run is done and needs him again: the thread is back in Inbox (and the
              // task's record is answered, so it is no row of its own).
              if (BOX === 'live') {
                const t = THREADS['qa-reply'], key = q.headers()['idempotency-key'] || '';
                setTimeout(() => Object.assign(t, { hidden: false, status: 'running', runId: 'qa-run-1', key, runStatus: 'running' }), LAG);
                setTimeout(() => { Object.assign(t, { status: 'completed', runStatus: 'completed', at: Date.now(), attention: { state: 'needs_you', ask: 'Booked 9:10. Add it to your calendar?' },
                  msgs: [...t.msgs, ['user', 'Book the 9:10 one', 60], ['assistant', 'Booked 9:10. Add it to your calendar?', 90]] }); FINISHED.done = true; }, FINISH);
              }
              return r.fulfill({ status: 202, json: { run_id: 'qa-run-1', status: 'queued' } }).catch(() => {});
            }
            if (/transcribe/.test(p)) return r.fulfill({ json: { text: 'Book the 9:10 one', ms: 4 } });
            if (p === '/wizard/files/upload') return r.fulfill({ json: { file: { id: 'qa-up-' + Date.now(), filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
            if (p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            return r.fulfill({ json: { ok: true } });
          }
          if (!p.startsWith(prefix) && /transcribe/.test(p)) return r.fulfill({ json: { text: 'Book the 9:10 one', ms: 4 } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: SENT, next: null, check: null } });
          // A background task waiting on him (QA_KIND=record): its worker thread is hidden, the Inbox row is the record.
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: KIND === 'record' && u.searchParams.get('kind') === 'needs_you' && !FINISHED.done ? RECORDS : [], check: null } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'recent' } });
          // The box still lists the thread as it was (completed) while the run is admitted: a stale read.
          // Like Hermes, the list leaves hidden threads out (a worker thread is read by id only).
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([id, s]) => raw(id, s)), has_more: false } });
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
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await page.waitForFunction(() => window.WizLive?.sentLog?.state?.().ok, null, { timeout: 15000 }); await nap(1200);
        await vis(`.ch-list :is(${ROW})`).waitFor({ timeout: 15000 });
        const where = () => page.evaluate(ROW => {
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          if (!list) return { list: false };
          const row = [...list.querySelectorAll(ROW)].find(n => n.getClientRects().length);
          return { list: true, tab: document.querySelector('.ch-tabbar [data-chtab][aria-selected="true"], .ch-tabbar [data-chtab].on')?.dataset.chtab || '', sec: row ? row.closest('section[data-sec]')?.dataset.sec || '?' : null };
        }, ROW);
        entry.start = await where();
        assert.equal(entry.start.sec, 'ready', 'the read thread waits in Inbox first ' + JSON.stringify(entry.start));
        await page.screenshot({ path: path.join(out, stem + '-0-inbox.png') });
        // Every paint of the visible list from now on: in which section the row is, with ms since the send tap.
        if (CPU > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
        const press = l => phone ? l.tap() : l.click();
        await press(vis(`.ch-list :is(${ROW})`));
        await vis('.ch-thread .ch-compose textarea').waitFor({ timeout: 10000 });
        await page.locator('.ch-thread').filter({ visible: true }).first().getByText('Two flights on Friday').first().waitFor({ timeout: 10000 });
        await nap(400);
        if (mode !== 'voice') await vis('.ch-compose textarea').fill('Book the 9:10 one');
        const orbAt = async () => { const o = await page.locator('#orbWrap').boundingBox(); await page.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); };
        if (mode === 'voice') { await orbAt(); await nap(2500); }
        await page.evaluate(ROW => {
          window.__qaSeen = []; const t0 = performance.now();
          const look = () => {
            const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
            const row = list && [...list.querySelectorAll(ROW)].find(n => n.getClientRects().length);
            const v = !list ? 'thread' : row ? row.closest('section[data-sec]')?.dataset.sec || '?' : 'none';
            const last = window.__qaSeen.at(-1); if (!last || last.v !== v) window.__qaSeen.push({ t: Math.round(performance.now() - t0), v });
          };
          const tick = () => { look(); if (performance.now() - t0 < 12000) requestAnimationFrame(tick); };
          new MutationObserver(look).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
          requestAnimationFrame(tick);
        }, ROW);
        if (mode === 'voice') await orbAt(); else await press(vis('.ch-compose .ch-send'));
        const sentAt = Date.now();
        await nap(150);
        await page.screenshot({ path: path.join(out, stem + '-1-after-send.png') });
        await nap(mode === 'refused' ? 7000 : Math.max(4500, LAG + 3500));
        await page.screenshot({ path: path.join(out, stem + '-2-later.png') });
        entry.seen = await page.evaluate(() => window.__qaSeen);
        entry.outbox = await page.evaluate(() => [...(window.WosOutbox?._items?.values?.() || [])].map(i => ({ kind: i.kind, state: i.state, sid: i.sessionId, error: i.error })));
        entry.sent = await page.evaluate(() => [...document.querySelectorAll('[data-chsentthread]')].map(n => n.dataset.chsentthread));
        // The desktop keeps the list beside the thread: what it showed before the send (Inbox) is not a paint after it.
        const firstList = phone ? entry.seen.findIndex(x => x.v !== 'thread') : Math.max(0, entry.seen.findIndex(x => x.v !== 'ready'));
        assert.ok(firstList >= 0, 'Wizard went back to the Inbox ' + JSON.stringify(entry.seen));
        const onList = entry.seen.slice(firstList);
        if (mode === 'refused') {
          assert.equal(onList.at(-1).v, 'ready', 'a refused send puts the row back in Inbox ' + JSON.stringify(entry.seen));
          entry.retry = await page.evaluate(() => document.body.innerText.includes('Retry'));
          assert.ok(entry.retry, 'the refused send offers Retry');
        } else {
          const wantNow = SMART ? 'none' : 'working';
          const inboxReady = onList.filter(x => x.v === 'ready' || x.v === 'recent' || x.v === '?');
          assert.deepEqual(inboxReady, [], 'the row is never an Inbox row once the Inbox shows ' + JSON.stringify(entry.seen));
          assert.equal(onList[0].v, wantNow, `first Inbox paint: row ${wantNow} ` + JSON.stringify(entry.seen));
          if (SMART) {
            // The phone's view switcher; the desktop list keeps its Inbox · Sent tabs.
            if (await page.evaluate(() => !!window.WizCore?.chatsSwitcher?.on?.())) await page.evaluate(() => window.WizCore.chatsSwitcher.pick('sent'));
            else await vis('.ch-tabbar [data-chtab="sent"]').click();
            await nap(900);
            entry.sentNow = await page.evaluate(() => [...document.querySelectorAll('[data-chsentthread="qa-reply"]')].filter(n => n.getClientRects().length).map(n => n.closest('section[data-sec]')?.dataset.sec || n.closest('[data-sec]')?.dataset.sec || 'sent'));
            await page.screenshot({ path: path.join(out, stem + '-3-sent.png') });
            assert.ok(entry.sentNow.length, 'the replied thread is in Sent ' + JSON.stringify(entry.sentNow));
            if (await page.evaluate(() => !!window.WizCore?.chatsSwitcher?.on?.())) await page.evaluate(() => window.WizCore.chatsSwitcher.pick('inbox'));
            else await vis('.ch-tabbar [data-chtab="inbox"]').click();
          }
          // The run finishes needing him: the thread is back in Inbox (the hold let go), typed or voice.
          for (let until = Date.now() + FINISH + 15000; !FINISHED.done && Date.now() < until;) await nap(200);
          assert.ok(FINISHED.done, 'the box accepted the run and finished it');
          // The next list read (on its own schedule; asked for here so the test need not wait for it).
          await page.evaluate(() => window.WizLive?.refresh?.());
          for (let until = Date.now() + 8000; Date.now() < until; await nap(400)) { entry.finished = await where(); if (entry.finished.sec === 'ready') break; }
          if (process.env.QA_DEBUG) entry.finishedRows = await page.evaluate(ROW => [...document.querySelectorAll(ROW)].map(n => [n.closest('section[data-sec]')?.dataset.sec, n.getClientRects().length, n.outerHTML.slice(0, 200)]), ROW);
          if (process.env.QA_DEBUG) entry.finishedRow = await page.evaluate(() => { const s = window.WizLive?.session?.('qa-reply'); return s && { status: s.status, key: s.lastRunKey, runStatus: s.lastRunStatus, pend: s.pend, hidden: s.hidden }; });
          await page.screenshot({ path: path.join(out, stem + '-3-finished.png') });
          assert.equal(entry.finished.sec, 'ready', 'the finished answer that needs him is in Inbox again ' + JSON.stringify(entry.finished));
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, `report-${SMART ? 'smart' : 'off'}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ smart: SMART, expect: BROKEN ? 'broken' : 'fixed', cases: report.cases.map(c => ({ stem: c.stem, pass: !!c.pass, seen: c.seen, finishedRow: c.finishedRow, finishedRows: c.finishedRows, outboxLast: process.env.QA_DEBUG ? c.outbox : undefined, outbox: process.env.QA_DEBUG ? c.outbox : undefined, writes: process.env.QA_DEBUG ? c.writes : undefined, failure: c.failure && String(c.failure).split('\n')[0] })) }, null, 1));
  const bad = BROKEN ? !failed.some(c => /-record-/.test(c.stem) && !/refused/.test(c.stem)) : failed.length > 0;
  if (bad || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
