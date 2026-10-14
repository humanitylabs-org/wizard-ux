// QA: a thread left open on an unattended screen must not mark new replies read.
// James, 14 Oct 2026: "Our PRs — daily review" reached his phone inbox already marked read. A Mac Chrome tab sat
// on that thread and auto-marked the new reply read 14 s after it landed, while he was on his phone.
// Rule: an open thread clears new replies only while James is at that screen (page opened, brought to the front,
// or touched / clicked / typed / scrolled within the last minute). His first input when he returns clears it.
// Fully stubbed: shell from the tree under test, Wizard API faked, nothing leaves the box.
// Usage: QA_WEB_DIR=<tree> node qa-attended-read.cjs
const QA_ORIGIN = (process.env.WIZARD_QA_ORIGIN || 'https://wizard.example.ts.net').replace(/\/+$/, ''); // the Wizard under test (env; see docs/qa-targets.md)
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const W = process.env.QA_WEB_DIR || __dirname;
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
const ORIGIN = QA_ORIGIN;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ID = 'qa_ar_thread';
let replyAt = Date.now() / 1000 - 600, replies = 1;
let seenState = null;
const seenPuts = [];
function session() {
  return { id: ID, source: 'wizard-mobile', title: 'QA · Attended read', status: 'completed', archived: false, hidden: false, message_count: 1 + replies,
    started_at: replyAt - 3600, last_active: replyAt, wizard_last_user_at: replyAt - 3600, wizard_last_assistant_at: replyAt, wizard_activity_at: replyAt,
    latest_message: { role: 'assistant', content: `Reply ${replies}`, timestamp: replyAt }, last_user_message: { role: 'user', content: 'Ask', timestamp: replyAt - 3600 } };
}
function rows() {
  const r = [{ id: 1, session_id: ID, role: 'user', content: 'Ask', timestamp: replyAt - 3600 }];
  for (let k = 0; k < replies; k++) r.push({ id: 2 + k, session_id: ID, role: 'assistant', content: `Reply ${k + 1}`, timestamp: replyAt - (replies - 1 - k) });
  return r;
}
const ct = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.webmanifest') ? 'application/manifest+json' : f.endsWith('.txt') ? 'text/plain' : 'application/javascript';

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.origin !== ORIGIN) return r.abort();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const wm = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (wm && m === 'GET') {
      const f = wm[1] || 'index.html', p = path.join(W, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: ct(f), body: '' });
      return r.fulfill({ status: 200, contentType: ct(f), body: fs.readFileSync(p) });
    }
    if (u.pathname === '/wizard/thread-seen') {
      if (m === 'PUT') { const st = JSON.parse(q.postData() || '{}'); seenPuts.push({ at: Date.now(), rec: st.threads?.[`direct:${ID}`] || null }); seenState = st; }
      return json(200, { state: seenState });
    }
    if (m !== 'GET') return json(200, { ok: true });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(200, { data: [session()], has_more: false });
    if (u.pathname === `/wizard/hermes/api/sessions/${ID}/messages`) { const d = rows(); return json(200, { object: 'list', data: d, pagination: { limit: 500, offset: 0, returned: d.length } }); }
    if (u.pathname === `/wizard/hermes/api/sessions/${ID}`) return json(200, { session: session() });
    return json(200, {});
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.clock.install(); // time flows normally; fastForward jumps it to simulate James walking away
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {} });
  await p.goto(ORIGIN + '/wizard-os-home/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(id => window.__wos?.live?.ok && window.__wos.live.session(id), ID, { timeout: 60000 });
  const isNew = () => p.evaluate(id => window.__wos.live.isNew(window.__wos.live.session(id)), ID);
  // A neutral touch on the thread's own text (James reading), never on a control.
  const touchThread = async () => { const bb = await p.getByText('Ask', { exact: true }).last().boundingBox(); await p.touchscreen.tap(bb.x + 4, bb.y + bb.height / 2); await sleep(400); };
  const threadOpen = () => p.evaluate(id => Object.values(window.__wos.wins).some(w => w.app === 'chats' && w.thread === id), ID);
  const newReply = async () => { replies++; replyAt += 5; await p.evaluate(() => window.__wos.live.refresh()); await sleep(900); };

  // Open the thread (James reads it): it is read.
  await p.evaluate(id => window.__wos.openWizardThread(id), ID); await sleep(1500);
  const open = await p.evaluate(id => Object.values(window.__wos.wins).some(w => w.app === 'chats' && w.thread === id), ID);
  ok(open, '0 the thread is open in a Chats window on the front desk');
  ok(!(await isNew()), '0 opening the thread marks it read');

  // 1. James is at the screen: a reply that lands in the open thread counts as read (unchanged behaviour).
  await touchThread();
  ok(await threadOpen(), '1 touching the thread text keeps it open');
  await newReply();
  ok(!(await isNew()), '1 attended: a new reply in the open thread is marked read at once');

  // 2. James walks away (the Mac-tab case): a reply that lands stays UNREAD, locally and in the synced state.
  await p.clock.fastForward(70_000); await sleep(300);
  const putsBefore = seenPuts.length;
  await newReply();
  ok(await isNew(), '2 unattended (no input for 70 s): a new reply in the open thread stays unread');
  const synced = seenPuts.slice(putsBefore).map(x => x.rec?.messageCount);
  ok(!synced.includes(1 + replies), '2 no read-state write for the new reply reaches the other devices', { synced, want: 1 + replies });
  await newReply();
  ok(await isNew(), '2 still unread after a further reply and refresh');

  // 3. James comes back and touches the screen: the thread in front of him clears at once.
  await touchThread();
  ok(!(await isNew()), '3 his first touch on return marks the open thread read');

  // 4. Bringing the app back to the front (visibilitychange → visible) counts as being there.
  await p.clock.fastForward(70_000); await sleep(300);
  await newReply();
  ok(await isNew(), '4 away again: the reply is unread');
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(900);
  ok(!(await isNew()), '4 returning to the app (visible again) marks the open thread read');

  // 5. Keyboard return on the desktop-style path: a key press counts too.
  await p.clock.fastForward(70_000); await sleep(300);
  await newReply();
  ok(await isNew(), '5 away: unread');
  await p.keyboard.press('Shift'); await sleep(500);
  ok(!(await isNew()), '5 a key press on return marks it read');

  ok(await threadOpen(), 'the thread stayed open throughout');
  ok(errs.length === 0, 'no page errors', errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
