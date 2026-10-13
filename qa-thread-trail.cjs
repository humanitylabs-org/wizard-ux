// QA: thread trail (feature/thread-trail). A thread opened from a link inside another thread returns to that
// thread on Done, Defer and Back, instead of dropping to the Chats list. Opening from the list still returns to the
// list, and Back never leaves the app.
//
// James, 10 Oct 2026: "where I click to a thread from another thread, if I hit done to archive it, it should push
// me just back one screen to the previous one I was on."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-thread-trail.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/developer/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wos-thread-trail-shots';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const origin = new URL(URL_).origin;

const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
const FIX = {
  qa_tt_sum: { title: 'QA trail summary', t: now - 30, rows: () => [row('user', 'Summarise my open threads', now - 300), row('assistant',
    `Here are your threads:\n\n- [Thread A](/wizard/?session=qa_tt_a): done.\n- [Thread B](/wizard/?session=qa_tt_b): needs you.\n- [Thread C](${origin}/wizard-os-home/?session=qa_tt_c): own-page link.`, now - 250)] },
  qa_tt_a: { title: 'QA trail A', t: now - 40, rows: () => [row('user', 'Thread A ask', now - 400), row('assistant', 'Thread A answer. See also [Thread B](/wizard/?session=qa_tt_b).', now - 350)] },
  qa_tt_b: { title: 'QA trail B', t: now - 41, rows: () => [row('user', 'Thread B ask', now - 400), row('assistant', 'Thread B answer.', now - 350)] },
  qa_tt_c: { title: 'QA trail C', t: now - 42, rows: () => [row('user', 'Thread C ask', now - 400), row('assistant', 'Thread C answer.', now - 350)] },
};
const ARCH = new Set(), DEF = new Set();
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: ARCH.has(id), hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    wizard_deferred: DEF.has(id) || undefined,
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      for (const id of Object.keys(FIX)) if (u.pathname.includes(id) || body.includes(id)) { if (/archive|hide|done/i.test(u.pathname + body)) ARCH.add(id); }
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      return json(200, { ok: true });
    }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    return r.continue();
  };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', routeFor());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_tt_sum'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_tt_sum')), 'thread list loaded with fixture threads');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);

  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const thread = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null);
  const S = async sel => `[data-chats="${await wid()}"] ${sel}`;
  const alive = () => p.evaluate(() => !!window.__wos && document.visibilityState === 'visible' && !!document.querySelector('.win'));
  async function waitThread(id) {
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`); }, id, { timeout: 20000 }).catch(() => {});
    await sleep(400);
  }
  async function openFromList(id) { await p.evaluate(id => __wos.openWizardThread(id), id); await waitThread(id); }
  async function tapLink(text) {
    const sel = await S(`.ch-msgs .msg.a a`);
    const loc = p.locator(sel, { hasText: text }).last();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.tap();
  }
  async function tapAct(a) {
    const sel = await S(`[data-chact="${a}"]`);
    await p.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
    await p.locator(sel).scrollIntoViewIfNeeded().catch(() => {});
    await p.locator(sel).tap(); await sleep(700);
  }
  const back = async () => { await p.keyboard.press('Escape'); await sleep(500); };

  try {
    // 1. Summary → link A → Done returns to the summary (James's case).
    await openFromList('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '1 summary thread open from the list');
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    ok(await thread() === 'qa_tt_a', '1 tapping a thread link opens that thread');
    await p.screenshot({ path: path.join(OUT, '1-linked-thread.png') });
    const w0 = writes.length;
    await tapAct('done'); await waitThread('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '1 Done on a linked thread returns to the thread you came from (not the list)', await thread());
    ok(writes.slice(w0).some(w => /qa_tt_a/.test(w.p + w.body)), '1 Done still archives the linked thread', writes.slice(w0).map(w => w.p));
    await p.screenshot({ path: path.join(OUT, '1-after-done.png') });

    // 2. Summary → link B → Back returns to the summary; Back again → list; the app stays open.
    await tapLink('Thread B'); await waitThread('qa_tt_b');
    ok(await thread() === 'qa_tt_b', '2 second link opens thread B');
    await back();
    ok(await thread() === 'qa_tt_sum', '2 Back on a linked thread returns to the summary thread', await thread());
    await back();
    ok(await thread() === null, '2 Back on the summary (opened from the list) returns to the list', await thread());
    ok(await alive(), '2 app still open after Back');

    // 3. Chain: summary → A → B; Defer on B → A; Back on A → summary; Back → list.
    await openFromList('qa_tt_sum');
    ARCH.delete('qa_tt_a'); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800);
    await openFromList('qa_tt_a'); // reopen from list is a fresh trail …
    await back(); ok(await thread() === null, '3 thread opened from the list: Back goes to the list (fresh trail)', await thread());
    await openFromList('qa_tt_sum');
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    await tapLink('Thread B'); await waitThread('qa_tt_b');
    ok(await thread() === 'qa_tt_b', '3 link inside a linked thread opens the next thread');
    await tapAct('defer'); await waitThread('qa_tt_a');
    ok(await thread() === 'qa_tt_a', '3 Defer steps back one thread (B → A)', await thread());
    await back();
    ok(await thread() === 'qa_tt_sum', '3 Back steps back again (A → summary)', await thread());
    await back();
    ok(await thread() === null, '3 Back from the root thread → list', await thread());

    // 4. Own-page link (…/wizard-os-home/?session=) keeps the trail too.
    await openFromList('qa_tt_sum');
    await tapLink('Thread C'); await waitThread('qa_tt_c');
    ok(await thread() === 'qa_tt_c', '4 own-page thread link opens thread C in place');
    await tapAct('done'); await waitThread('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '4 Done on an own-page-linked thread returns to the summary', await thread());

    // 5. Done on a thread opened from the list still goes to the list.
    ARCH.delete('qa_tt_b'); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800);
    await openFromList('qa_tt_b');
    await tapAct('done');
    ok(await thread() === null, '5 Done on a thread opened from the list returns to the list', await thread());
    ok(await alive(), '5 app still open');
  } catch (e) { ok(false, 'suite crashed', String(e).split('\n')[0]); }

  ok(!writes.some(w => /\/v1\/runs$/.test(w.p)), 'zero /v1/runs writes (nothing reached Archimedes)');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\nthread-trail: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
