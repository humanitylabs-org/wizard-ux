// QA: Ready status lines (feature/ready-status). Each finished thread carries the agent's hidden status tag
// (wizard_attention: needs_you / check / done / fyi + one-line ask + subject). Ready shows needs-you and
// test-this rows first with the exact ask as the preview, done/FYI rows go quiet and swipe straight to Done,
// a needs-you thread from an earlier day stays in Ready, and "By subject" groups Ready like the roundup.
//
// James, 10 Oct 2026: "differentiate tasks in ready by which ones are needs you / awaiting your action and which
// ones are done … I don't want the UX to get too cluttered."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-ready-status.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wos-ready-status-shots';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
// Newest first by time: fyi is the newest, needs-you the oldest of today, plus one needs-you from 3 days ago.
const FIX = {
  qa_rs_fyi: { title: 'QA rs FYI answer', t: now - 20, att: { state: 'fyi', ask: 'Good Arts Law is a 1990s copyright doctrine', subject: 'Research' } },
  qa_rs_done: { title: 'QA rs Done fix', t: now - 30, att: { state: 'done', ask: 'Sending pill is live', subject: 'Wizard OS' } },
  qa_rs_check: { title: 'QA rs Check build', t: now - 40, att: { state: 'check', ask: 'Try the new orb timing from the side button', subject: 'Wizard OS' } },
  qa_rs_needs: { title: 'QA rs Needs decision', t: now - 50, att: { state: 'needs_you', ask: 'Say "ship desks" if the preview feels right', subject: 'Wizard OS' } },
  qa_rs_old: { title: 'QA rs Old needs', t: now - 3 * 86400, att: { state: 'needs_you', ask: 'Approve the UPS and Cat6 purchase', subject: 'Home' } },
  qa_rs_plain: { title: 'QA rs Plain reply', t: now - 25, att: null },
};
const ARCH = new Set();
function fixSession(id) {
  const f = FIX[id];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: ARCH.has(id), hidden: false, message_count: 2,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: f.t - 120, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: 'assistant', content: `Long reply body for ${f.title} that should not be the preview when a status exists.`, timestamp: f.t },
    last_user_message: { role: 'user', content: `${f.title} ask`, timestamp: f.t - 120 },
    ...(f.att ? { wizard_attention: f.att } : {}) };
}
const rowsFor = id => [{ id: 1, session_id: id, role: 'user', content: `${FIX[id].title} ask`, timestamp: FIX[id].t - 120 }, { id: 2, session_id: id, role: 'assistant', content: `Answer for ${FIX[id].title}.`, timestamp: FIX[id].t }];
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
      for (const id of Object.keys(FIX)) if ((u.pathname.includes(id) || body.includes(id)) && /archive|hide|done|"archived":true/i.test(u.pathname + body)) ARCH.add(id);
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
    if (mm && FIX[mm[1]]) { const rows = rowsFor(mm[1]); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
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
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.removeItem('wos.chats.readyBySubject.v1'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_rs_needs')), 'thread list loaded with fixture threads');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(800);
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const R = async sel => `[data-chats="${await wid()}"] [data-sec="ready"] ${sel}`;
  const readyIds = async () => p.$$eval(await R('[data-chopen]'), els => els.map(e => e.dataset.chopen).filter(id => id.startsWith('qa_rs_')));
  const rowInfo = async id => p.evaluate(({ sel }) => { const e = document.querySelector(sel); if (!e) return null; return { cls: e.className, pv: e.querySelector('.pv')?.textContent || '', quiet: e.dataset.quiet === '1', op: getComputedStyle(e).opacity }; }, { sel: await R(`[data-chopen="${id}"]`) });

  try {
    const ids = await readyIds();
    ok(ids.includes('qa_rs_old'), '1 a needs-you thread from 3 days ago stays in Ready', ids);
    const pos = id => ids.indexOf(id);
    ok(pos('qa_rs_needs') >= 0 && pos('qa_rs_needs') < pos('qa_rs_check') && pos('qa_rs_check') < pos('qa_rs_fyi') && pos('qa_rs_check') < pos('qa_rs_done') && pos('qa_rs_check') < pos('qa_rs_plain'), '1 order: needs you, then test this, then the rest (even when newer)', ids);
    ok(pos('qa_rs_old') < pos('qa_rs_check'), '1 the older needs-you sorts with needs-you, above test-this', ids);

    const n = await rowInfo('qa_rs_needs');
    ok(n && /att-needs/.test(n.cls) && /^Needs you · Say "ship desks"/.test(n.pv.trim()), '2 needs-you row: amber label + the exact ask as preview', n);
    const c = await rowInfo('qa_rs_check');
    ok(c && /att-check/.test(c.cls) && /^Test this · Try the new orb timing/.test(c.pv.trim()), '2 test-this row: label + ask', c);
    const d = await rowInfo('qa_rs_done');
    ok(d && d.quiet && /Sending pill is live/.test(d.pv) && !/Long reply body/.test(d.pv), '2 done row is quiet and shows its one-line outcome', d);
    const f = await rowInfo('qa_rs_fyi');
    ok(f && f.quiet && /Good Arts Law/.test(f.pv), '2 FYI row is quiet with its one-liner', f);
    const pl = await rowInfo('qa_rs_plain');
    ok(pl && !pl.quiet && /Long reply body/.test(pl.pv), '2 a thread without a status keeps the old preview', pl);
    const hdr = await p.$eval(await R('.ch-sec-h'), e => e.textContent);
    ok(/need you/.test(hdr), '2 Ready header counts what needs you', hdr);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '1-ready-newest.png') });

    // 3. By subject: groups with something waiting first, "Other" last; persists.
    await p.locator(await R('[data-rdygroup="1"]')).tap(); await sleep(500);
    const subj = await p.$$eval(await R('.ch-subj span'), els => els.map(e => e.textContent));
    ok(subj[0] === 'Wizard OS' && subj.includes('Home') && subj.includes('Research') && subj[subj.length - 1] === 'Other', '3 By subject: Wizard OS (2 waiting) first, Other last', subj);
    const order = await readyIds();
    ok(order.indexOf('qa_rs_needs') < order.indexOf('qa_rs_done') && order.indexOf('qa_rs_done') < order.indexOf('qa_rs_old'), '3 rows sit under their subject', order);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '2-ready-by-subject.png') });
    ok(await p.evaluate(() => localStorage.getItem('wos.chats.readyBySubject.v1')) === '1', '3 the choice is remembered');
    await p.locator(await R('[data-rdygroup="0"]')).tap(); await sleep(400);
    ok((await p.$$(await R('.ch-subj'))).length === 0, '3 Newest turns grouping off');

    // 4. Swipe left on a quiet row files it straight to Done; on a needs-you row it opens the action sheet.
    async function swipe(id) {
      const box = await p.locator(await R(`[data-chopen="${id}"]`)).boundingBox();
      const y = box.y + box.height / 2, x0 = box.x + box.width - 30;
      await p.evaluate(({ x0, y, id, w }) => {
        const el = document.querySelector(`[data-chats="${w}"] [data-sec="ready"] [data-chopen="${id}"]`);
        const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', button: 0, isPrimary: true }));
        fire('pointerdown', x0); for (let i = 1; i <= 8; i++) fire('pointermove', x0 - i * 12); fire('pointerup', x0 - 96);
      }, { x0, y, id, w: await wid() });
      await sleep(900);
    }
    const w0 = writes.length;
    await swipe('qa_rs_done');
    ok(writes.slice(w0).some(w => /qa_rs_done/.test(w.p + w.body)), '4 swipe on a Done row archives it without opening', writes.slice(w0).map(w => w.p));
    ok(!(await p.$(`[data-chats="${await wid()}"] .ch-sheet`)), '4 no action sheet for the quiet swipe');
    ok(!(await readyIds()).includes('qa_rs_done'), '4 the filed row leaves Ready');
    const w1 = writes.length;
    await swipe('qa_rs_needs');
    ok(!!(await p.$(`[data-chats="${await wid()}"] .ch-sheet`)), '4 swipe on a needs-you row opens the action sheet (no auto-file)');
    ok(!writes.slice(w1).some(w => /qa_rs_needs/.test(w.p + w.body)), '4 needs-you row is not archived by a swipe');
    await p.keyboard.press('Escape'); await sleep(400);

    // 5. Opening a needs-you thread and coming back keeps it in Ready (cleared only by acting).
    await p.evaluate(() => __wos.openWizardThread('qa_rs_needs')); await sleep(1500);
    await p.keyboard.press('Escape'); await sleep(700);
    ok((await readyIds()).includes('qa_rs_needs'), '5 a needs-you thread stays in Ready after it is opened');
    ok(await p.evaluate(() => !!window.__wos && !!document.querySelector('.win')), '5 app still open after Back');
  } catch (e) { ok(false, 'suite crashed', String(e).split('\n')[0]); }

  ok(!writes.some(w => /\/v1\/runs$/.test(w.p)), 'zero /v1/runs writes (nothing reached Archimedes)');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\nready-status: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
