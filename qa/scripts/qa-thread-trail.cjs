// QA: thread trail (feature/thread-trail). A thread opened from a link inside another thread returns to that
// thread on Done, Defer and Back, instead of dropping to the Chats list. Opening from the list still returns to the
// list, and Back never leaves the app.
//
// James, 10 Oct 2026: "where I click to a thread from another thread, if I hit done to archive it, it should push
// me just back one screen to the previous one I was on."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-thread-trail.cjs [url]
const pw = require('../../tools/qa-playwright.cjs');
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || require('../../tools/qa-paths.cjs').workPath('wos-thread-trail-shots');
const EXEC = process.env.QA_CHROME || (process.env.QA_CHROME || undefined);
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
    `${'Roundup context paragraph.\n\n'.repeat(20)}Here are your threads:\n\n- [Thread A](/wizard/?session=qa_tt_a): done.\n- [Thread B](/wizard/?session=qa_tt_b): needs you.\n- [Thread C](${origin}/wizard-os-home/?session=qa_tt_c): own-page link.\n\n${'Remaining roundup notes.\n\n'.repeat(25)}`, now - 250)] },
  qa_tt_a: { title: 'QA trail A', t: now - 40, rows: () => [row('user', 'Thread A ask', now - 400), row('assistant', 'Thread A answer. See also [Thread B](/wizard/?session=qa_tt_b).', now - 350)] },
  qa_tt_b: { title: 'QA trail B', t: now - 41, rows: () => [row('user', 'Thread B ask', now - 400), row('assistant', 'Thread B answer.', now - 350)] },
  qa_tt_c: { title: 'QA trail C', t: now - 42, rows: () => [row('user', 'Thread C ask', now - 400), row('assistant', 'Thread C answer.', now - 350)] },
};
const ARCH = new Set(), DEF = new Set();
const HOLD = new Map(); // session id -> release(): its history read waits until the test lets it land
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', title: f.title, status: 'completed', archived: ARCH.has(id), hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    wizard_deferred: DEF.has(id) || undefined,
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
// QA_OFFLINE=1: no Wizard behind the page (a builder or CI host). The shell comes straight from QA_WEB_DIR/web and every
// /wizard/* read is answered here (fixture threads only), so the suite needs no origin server and no Agent Service.
const OFFLINE = process.env.QA_OFFLINE === '1';
const { ownerRead } = require('../../tools/qa-desktop-frame-fixture.cjs');
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (OFFLINE && m === 'GET' && u.pathname.startsWith('/wizard-os-home/')) {
      const root = path.resolve(WEB || path.join(__dirname, '..', '..'), 'web'), rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html', f = path.resolve(root, rel);
      if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return r.fulfill({ status: 404, body: '' });
    }
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      for (const id of Object.keys(FIX)) if (u.pathname.includes(id) || body.includes(id)) { if (/archive|hide|done/i.test(u.pathname + body)) ARCH.add(id); }
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      if (u.pathname === '/wizard/thread-dispositions') { let d = {}; try { d = JSON.parse(body); } catch (e) {} if (d.deferred) DEF.add(d.sessionId); else DEF.delete(d.sessionId); return json(200, { record: { sessionId: d.sessionId, deferred: !!d.deferred, updatedAt: new Date().toISOString() } }); }
      if (u.pathname.endsWith('/transcribe')) { await sleep(1500); return json(200, {text: 'QA linked voice reply'}); }
      if (u.pathname.endsWith('/files/upload')) return json(200, {file:{id:'qa_voice',filename:'voice.webm',mime:'audio/webm',bytes:4000}});
      if (u.pathname.endsWith('/v1/runs')) return json(202, {run_id:'qa_trail_run',status:'queued'});
      if (/\/route$/.test(u.pathname)) return json(200, {cmd:{route:'view'},ms:1});
      return json(200, { ok: true });
    }
    if (!u.pathname.startsWith('/wizard/')) return OFFLINE ? r.fulfill({ status: 404, body: '' }) : r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const p = OFFLINE ? ownerRead(u.pathname) : await (await r.fetch()).json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]] && HOLD.has(mm[1])) await HOLD.get(mm[1]).wait;
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    if (OFFLINE) return u.pathname === '/wizard/v1/bootstrap' ? json(200, { bootstrap: 1, settings: {}, capabilities: {}, endpoints: {} }) : json(200, ownerRead(u.pathname));
    return r.continue();
  };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers:'block' });
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

    // 2b. Back while the linked thread's read is still out (James, 23 Oct 2026: Morning projects → linked working
    // thread → Back showed the linked thread's messages under the Morning header until the 60 s re-read). Thread B is
    // already on this device from case 2, so it paints from its cached copy while its server read waits.
    await openFromList('qa_tt_sum');
    { let release; HOLD.set('qa_tt_b', { wait: new Promise(r => { release = r; }) });
      await tapLink('Thread B');
      await p.waitForFunction(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === 'qa_tt_b' && /Thread B answer/.test(document.querySelector(`[data-chats="${w.id}"] .ch-msgs`)?.textContent || ''); }, null, { timeout: 8000 }).catch(() => {});
      const body = async () => p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'), el = document.querySelector(`[data-chats="${w.id}"]`); return { thread: w.thread, title: el?.querySelector('.ch-head .ti b')?.textContent || '', text: el?.querySelector('.ch-msgs')?.textContent || '' }; });
      ok(/Thread B answer/.test((await body()).text), '2b linked thread paints its cached copy while its read is out', await body());
      await back(); await sleep(1500);
      let s2 = await body();
      ok(s2.thread === 'qa_tt_sum' && s2.title === 'QA trail summary' && /Here are your threads/.test(s2.text) && !/Thread B answer/.test(s2.text), '2b Back during the linked read shows the summary’s own messages, not the linked thread’s', { ...s2, text: s2.text.slice(0, 160) });
      release(); HOLD.delete('qa_tt_b'); await sleep(900);
      s2 = await body();
      ok(s2.thread === 'qa_tt_sum' && /Here are your threads/.test(s2.text) && !/Thread B answer/.test(s2.text), '2b the late linked read cannot paint over the summary', { ...s2, text: s2.text.slice(0, 160) });
      await tapLink('Thread B'); await waitThread('qa_tt_b');
      ok((await body()).thread === 'qa_tt_b', '2b the summary’s links still work after that Back');
      await back(); await back();
      ok(await thread() === null && await alive(), '2b nested Back then root Back: list, app still open', await thread()); }

    // 3. Chain: summary → A → B; Done on B → A; Back on A → summary; Back → list.
    await openFromList('qa_tt_sum');
    ARCH.delete('qa_tt_a'); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800);
    await openFromList('qa_tt_a'); // reopen from list is a fresh trail …
    await back(); ok(await thread() === null, '3 thread opened from the list: Back goes to the list (fresh trail)', await thread());
    await openFromList('qa_tt_sum');
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    await tapLink('Thread B'); await waitThread('qa_tt_b');
    ok(await thread() === 'qa_tt_b', '3 link inside a linked thread opens the next thread');
    // Snooze now opens its time picker (#365), so the one-tap step back here is Done.
    await tapAct('done'); await waitThread('qa_tt_a');
    ok(await thread() === 'qa_tt_a', '3 Done steps back one thread (B → A)', await thread());
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

    // 5b. Issue 1902 (James, 26 Nov 2026): Archive on a linked thread lands on the linking thread at its reading position,
    // with its draft, and the linked thread is archived. Then Back → list, and root Back keeps Wizard open.
    const unarchive = async (...ids) => { for (const id of ids) ARCH.delete(id); await p.evaluate(ids => { for (const id of ids) { const s = __wos.live.session(id); if (s) s.archived = false; } }, ids); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800); };
    const view = () => p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'), el = document.querySelector(`[data-chats="${w.id}"]`), a = [...(el?.querySelectorAll('.ch-msgs .msg.a') || [])];
      return { thread: w.thread, title: el?.querySelector('.ch-head .ti b')?.textContent || '', last: a.at(-1)?.textContent || '', top: el?.querySelector('.ch-msgs')?.scrollTop ?? -1, draft: el?.querySelector('textarea')?.value ?? null }; });
    await unarchive('qa_tt_a', 'qa_tt_b');
    await openFromList('qa_tt_sum');
    // Typed like a person (key presses end the opening settle, so the reader's own scroll below is his saved place).
    await p.locator(await S('textarea')).pressSequentially('Roundup draft kept on Archive'); await sleep(80);
    await p.locator(await S('.ch-msgs a')).filter({ hasText: 'Thread A' }).last().scrollIntoViewIfNeeded(); await sleep(900);
    const top5 = (await view()).top;
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    await p.screenshot({ path: path.join(OUT, '5b-linked-thread-before-archive.png') });
    await tapAct('done'); await waitThread('qa_tt_sum');
    const v5 = await view();
    ok(v5.thread === 'qa_tt_sum' && v5.title === 'QA trail summary' && /Remaining roundup notes/.test(v5.last), '5b Archive on a linked thread shows the linking thread (header and last bubble)', { ...v5, last: v5.last.slice(-80) });
    ok(Math.abs(v5.top - top5) < 4, '5b the linking thread keeps its reading position', { top5, top: v5.top });
    ok(v5.draft === 'Roundup draft kept on Archive', '5b the linking thread keeps its draft', v5.draft);
    ok(await p.evaluate(() => !!__wos.live.session('qa_tt_a')?.archived), '5b the linked thread is archived');
    ok(await p.evaluate(() => /Archived/.test(document.querySelector('.toast, #toast, [role="status"]')?.textContent || document.body.innerText)), '5b the Archived toast still shows');
    await p.screenshot({ path: path.join(OUT, '5b-after-archive-linking-thread.png') });
    await p.locator(await S('textarea')).fill(''); await sleep(80);
    await back(); ok(await thread() === null, '5b Back from the linking thread → list', await thread());
    await p.evaluate(() => window.__wosNativeBack?.()); await sleep(300); ok(await alive(), '5b root Back keeps Wizard open');

    // 5c. Snooze (Someday, a real tap in the picker) on a linked thread lands where Archive lands: the linking thread.
    await unarchive('qa_tt_a', 'qa_tt_b');
    await openFromList('qa_tt_sum'); await tapLink('Thread B'); await waitThread('qa_tt_b');
    await tapAct('snooze'); await p.waitForSelector('[data-boom-someday]', { timeout: 8000 }).catch(() => {});
    await p.locator('[data-boom-someday]').tap().catch(() => {}); await sleep(900); await waitThread('qa_tt_sum');
    ok(await p.waitForFunction(() => !document.querySelector('.boom-sheet') && !!__wos.live.session('qa_tt_b')?.deferred, null, { timeout: 5000 }).then(() => true, () => false), '5c the picker closed and the linked thread is snoozed');
    ok(await thread() === 'qa_tt_sum', '5c Snooze on a linked thread returns to the linking thread', await thread());
    await back(); ok(await thread() === null, '5c Back after that → list', await thread());

    // 5d. Snooze on a thread opened from the list keeps today's landing on the phone: the chats list.
    DEF.clear(); await unarchive('qa_tt_a', 'qa_tt_b'); await p.evaluate(() => { const s = __wos.live.session('qa_tt_b'); if (s) s.deferred = false; });
    await openFromList('qa_tt_b');
    await tapAct('snooze'); await p.waitForSelector('[data-boom-someday]', { timeout: 8000 }).catch(() => {});
    await p.locator('[data-boom-someday]').tap().catch(() => {}); await sleep(900);
    ok(await thread() === null, '5d Snooze on a list-opened thread still lands on the list', await thread());
    ok(await alive(), '5d app still open');
    await unarchive('qa_tt_a', 'qa_tt_b', 'qa_tt_c');

    const idle = async id => p.evaluate(id => { const s=__wos.live.session(id); Object.assign(s,{status:'completed',runId:'',archived:false}); },id);
    const type = async text => { await p.locator(await S('textarea')).fill(text); await sleep(80); };
    const send = async () => p.locator(await S('button.ch-send')).tap();
    const prepare = async () => { await openFromList('qa_tt_sum'); await idle('qa_tt_a'); await tapLink('Thread A'); await waitThread('qa_tt_a'); };
    const runsSince = n => writes.slice(n).filter(w=>/\/v1\/runs$/.test(w.p)).map(w=>JSON.parse(w.body));
    // Cases 6-13 are the leave-after-send path, which runs only with After actions = Chats list (the default is now
    // Stay on this chat, #1068); cases 1-5d above ran under the default.
    await p.evaluate(() => localStorage.setItem('wos.chats.afterAction.v1', 'list'));
    // 6. Actual Send with an outstanding save: return to the link's reading position, retaining the parent's draft.
    await openFromList('qa_tt_sum'); await type('Roundup draft stays here'); await p.locator(await S('textarea')).press('End'); // a key press ends the opening settle, as a person's touch does
    await p.locator(await S('.ch-msgs a')).filter({hasText:'Thread A'}).last().scrollIntoViewIfNeeded(); await sleep(900); // let the scroll settle before measuring
    const parentTop = await p.locator(await S('.ch-msgs')).evaluate(e=>e.scrollTop);
    await idle('qa_tt_a'); await tapLink('Thread A'); await waitThread('qa_tt_a');
    await p.evaluate(()=>{const ob=WosOutbox; window.qaEnqueue=ob.enqueue.bind(ob); ob.enqueue=async spec=>{window.qaSpec=spec; await new Promise(r=>window.qaSave=r); return qaEnqueue(spec);};});
    await type('QA linked typed reply'); const n6=writes.length; await send(); await sleep(150);
    ok(await thread()==='qa_tt_sum','6 typed send returns to roundup before local storage completes',await thread());
    if(await thread()==='qa_tt_sum') {
      await waitThread('qa_tt_sum');
      const top=await p.locator(await S('.ch-msgs')).evaluate(e=>e.scrollTop);
      ok(Math.abs(top-parentTop)<4,'6 roundup reading position restored',{parentTop,top});
      ok(await p.locator(await S('textarea')).inputValue()==='Roundup draft stays here','6 parent draft retained');
    } else {ok(false,'6 roundup reading position restored');ok(false,'6 parent draft retained');}
    await p.evaluate(()=>{qaSave();WosOutbox.enqueue=qaEnqueue;}); await sleep(1800);
    ok(runsSince(n6).some(r=>r.session_id==='qa_tt_a'&&r.input.includes('QA linked typed reply')),'6 reply delivered to linked child, not parent');
    ok(await thread()==='qa_tt_sum','6 asynchronous delivery does not pop parent again');
    await p.screenshot({path:path.join(OUT,'6-reply-back-to-roundup.png')});
    await back();ok(await thread()===null,'6 parent Back returns to list');

    // 7. Nested reply returns exactly one level; subsequent Back retains the remaining trail.
    await prepare();await idle('qa_tt_b');await tapLink('Thread B');await waitThread('qa_tt_b');
    await type('QA nested reply');await send();await sleep(600);
    ok(await thread()==='qa_tt_a','7 nested reply B → A');await back();
    ok(await thread()==='qa_tt_sum','7 remaining trail A → roundup');

    // 8. Save rejection returns the child composer and restores its trail.
    await prepare();await p.evaluate(()=>{WosOutbox.enqueue=async()=>{throw Error('QA disk rejected');};});
    await type('QA retained on save failure');await send();await sleep(500);
    ok(await thread()==='qa_tt_a'&&await p.locator(await S('textarea')).inputValue()==='QA retained on save failure','8 save failure restores child and words');
    await back();ok(await thread()==='qa_tt_sum','8 failed-send recovery preserves parent trail');
    await p.evaluate(()=>WosOutbox.enqueue=qaEnqueue);

    // 9. A delayed rejection cannot steal a newer navigation, even when it ends back at the same parent.
    await prepare();await p.evaluate(()=>{WosOutbox.enqueue=()=>new Promise((r,j)=>window.qaReject=j);});
    await type('QA delayed save failure');await send();await sleep(200);
    await openFromList('qa_tt_c');await openFromList('qa_tt_sum');
    await p.evaluate(()=>{qaReject(Error('QA delayed rejection'));WosOutbox.enqueue=qaEnqueue;});await sleep(400);
    ok(await thread()==='qa_tt_sum','9 late failure leaves newer navigation alone');
    await openFromList('qa_tt_a');
    ok(await p.locator(await S('textarea')).inputValue()==='QA delayed save failure','9 failed message remains recoverable in child');

    // 10. The shared composer-mic send path also returns once, with its audio and typed words pinned.
    await prepare();await type('QA typed with voice');
    const n10=writes.length;
    await p.evaluate(wid=>{window.qaVoiceSend=__wos.chats.sendVoiceTo(wid,'qa_tt_a',new Blob([new Uint8Array(4000)],{type:'audio/webm'}));},await wid());
    await sleep(300);ok(await thread()==='qa_tt_sum','10 composer voice returns to roundup');
    await sleep(2200);
    const v10=await p.evaluate(()=>WosOutbox.forThread('qa_tt_a').filter(x=>x.typed==='QA typed with voice').map(x=>({sid:x.sessionId,audio:!!(x.audio||x.audioFile),typed:x.typed})));
    ok(v10.some(x=>x.sid==='qa_tt_a'&&x.audio),'10 voice and typed composer stay pinned to child',v10);
    ok(await thread()==='qa_tt_sum','10 voice completion leaves roundup open');

    // 11. Real orb taps + fake microphone; slow transcription cannot pop twice or redirect the message.
    await prepare();
    const tapOrb=async()=>{const r=await p.locator('#orbWrap').boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);};
    await tapOrb();await sleep(1400);ok(await p.evaluate(()=>__wos.voice)==='listen','11 orb recording started');
    const n11=writes.length;await tapOrb();await sleep(400);
    ok(await thread()==='qa_tt_sum','11 orb send returns to roundup immediately');
    await sleep(4500);
    if(!runsSince(n11).some(r=>r.session_id==='qa_tt_a')) console.log('VOICE DEBUG',writes.slice(n11).map(w=>({p:w.p,body:w.body.slice(0,250)})),await p.evaluate(()=>({voice:__wos.voice,out:WosOutbox.forThread('qa_tt_a').map(x=>({kind:x.kind,state:x.state,error:x.error,text:x.text,typed:x.typed})),pill:document.querySelector('#txRouteText')?.textContent})));
    ok(runsSince(n11).some(r=>r.session_id==='qa_tt_a'),'11 orb reply targets child after return',runsSince(n11).map(r=>r.session_id));
    ok(await thread()==='qa_tt_sum','11 orb completion leaves roundup open');
    await back();await p.evaluate(()=>window.__wosNativeBack());await sleep(250);
    ok(await alive(),'11 nested and root Back keep Wizard open');

    await openFromList('qa_tt_c');await idle('qa_tt_c');await type('QA direct list reply');await send();await sleep(300);
    ok(await thread()===null,'12 direct list reply returns to list');
    await p.evaluate(id=>__wos.openChat(id,'__new__'),await wid());await sleep(300);
    await type('QA new chat');await send();await sleep(300);
    ok(await thread()===null,'12 new chat send returns to list');

    await prepare();await type('QA voice save failure');
    await p.evaluate(async wid=>{WosOutbox.enqueue=async()=>{throw Error('QA voice save failed');};try{await __wos.chats.sendVoiceTo(wid,'qa_tt_a',new Blob([new Uint8Array(4000)],{type:'audio/webm'}));}catch{}finally{WosOutbox.enqueue=qaEnqueue;}},await wid());
    ok(await thread()==='qa_tt_a'&&await p.locator(await S('textarea')).inputValue()==='QA voice save failure','13 voice save failure restores child composer');
    await back();ok(await thread()==='qa_tt_sum','13 voice save failure restores linked trail');

    const dc=await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',ignoreHTTPSErrors:true});
    await dc.route('**/*',routeFor());const dp=await dc.newPage();await dp.goto(URL_+'desktop.html',{waitUntil:'domcontentloaded'});
    await dp.waitForFunction(()=>window.__wux?.live?.session('qa_tt_sum'));
    const dr=await dp.evaluate(async()=>{const x=__wux;x.openThread('qa_tt_sum');await new Promise(r=>setTimeout(r,500));const w=Object.values(x.wins).find(w=>w.app==='chats'&&w.thread==='qa_tt_sum');x.chats.openChat(w.id,'qa_tt_b',{via:'link'});const left=x.chats.leaveAfterSend(w.id,'qa_tt_b',false);return {left,thread:w.thread};});
    ok(dr.left===false&&dr.thread==='qa_tt_b','14 desktop reply keeps thread beside list',dr);
    // 15. Desktop (issue 1902): Archive on a thread opened from a link (a real click) goes back to the linking thread; Archive
    // on a thread opened from the list still opens the next chat in the list.
    ARCH.clear(); DEF.clear(); await dp.evaluate(()=>{for(const id of ['qa_tt_a','qa_tt_b','qa_tt_c']){const s=__wux.live.session(id);if(s){s.archived=false;s.deferred=false;}}__wux.live.refresh?.();}); await sleep(800);
    const dwin=sid=>dp.evaluate(sid=>{const w=Object.values(__wux.wins).find(w=>w.app==='chats'&&w.thread);return w?{id:w.id,thread:w.thread,trail:(__wux.chats.ch?.(w.id)?.trail||null)}:null;},sid);
    const dwait=sid=>dp.waitForFunction(sid=>Object.values(__wux.wins).some(w=>w.app==='chats'&&w.thread===sid&&document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`)),sid,{timeout:15000}).catch(()=>{});
    await dp.evaluate(()=>__wux.openThread('qa_tt_sum')); await dwait('qa_tt_sum'); await sleep(400);
    let dw=await dwin();
    await dp.locator(`[data-chats="${dw.id}"] .ch-msgs .msg.a a`,{hasText:'Thread A'}).last().click(); await dwait('qa_tt_a'); await sleep(400);
    ok((await dwin())?.thread==='qa_tt_a','15 desktop: a thread link opens the linked thread',await dwin());
    dw=await dwin(); await dp.locator(`[data-chats="${dw.id}"] [data-chact="done"]`).first().click(); await dwait('qa_tt_sum'); await sleep(500);
    ok((await dwin())?.thread==='qa_tt_sum','15 desktop: Archive on the linked thread goes back to the linking thread',await dwin());
    ok(await dp.evaluate(()=>!!__wux.live.session('qa_tt_a')?.archived),'15 desktop: the linked thread is archived');
    await dp.screenshot({path:path.join(OUT,'15-desktop-after-archive.png')});
    await dp.evaluate(()=>__wux.openThread('qa_tt_b')); await dwait('qa_tt_b'); await sleep(400);
    dw=await dwin(); await dp.locator(`[data-chats="${dw.id}"] [data-chact="done"]`).first().click(); await sleep(900);
    dw=await dwin();
    // (Which chat is next depends on the drawn sections; it is opened fresh, as from the list: no link trail, no step back.)
    ok(!!dw&&!!dw.thread&&dw.thread!=='qa_tt_b'&&Array.isArray(dw.trail)&&dw.trail.length===0,'15 desktop: Archive on a list-opened thread opens the next chat in the list',dw);
    await dc.close();
  } catch (e) { ok(false, 'suite crashed', String(e)); console.log('STATE', await p.evaluate(()=>({url:location.href,idx:__wos.idx,desks:__wos.desks,wins:__wos.wins,body:document.body.innerText.slice(-1500)}))); }

  const newIds = new Set(writes.filter(w=>w.m==='POST' && w.p==='/wizard/hermes/api/sessions').map(w=>JSON.parse(w.body).id).filter(Boolean));
  ok(writes.filter(w => /\/v1\/runs$/.test(w.p)).every(w => { const id=JSON.parse(w.body).session_id;return /^qa_tt_/.test(id)||newIds.has(id); }), 'all intercepted replies target fixture threads or the fixture-created new chat');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\nthread-trail: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
