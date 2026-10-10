// QA: quiet voice reply + one-line orb timer + Defer at the bottom of Ready (feature/reply-quiet-defer-today).
// James, 10 Oct 2026: "When I hit reply inside a thread, a giant pillbox pops up and covers my orb. That doesn't
// seem necessary. I know I'm replying. The orb animates. Also, the timer on the orb is on like two lines…
// defer could just go at the bottom of today … and just change the status to deferred."
//
//  1 composer mic in a thread (normal + full screen): recording starts with NO pill over the orb, at any moment
//  2 the recording timer is one line in both layouts
//  3 Deferred threads sit at the bottom of Ready with a "Deferred" status; there is no Deferred section
//  4 a deferred needs-you thread doesn't count toward "N need you"
//  5 Defer from a thread: back to the list, row at the bottom of Ready marked Deferred, saved like Wizard
//  6 Restore clears the status; the row stays in Ready
//
// Real Wizard reads; fixture threads merged in; EVERY write is intercepted (zero reach Archimedes).
// Usage: QA_WEB_DIR=<tree> node qa-reply-defer.cjs [origin url, default the Agent Service on :8923]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wos-reply-defer-shots';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VW = 412, VH = 892;
const now = Date.now() / 1000;
const FIX = {
  qa_rd_plain: { title: 'QA rd Plain thread', t: now - 20, att: { state: 'fyi', ask: 'Plain answer for the defer test', subject: 'Research' } },
  qa_rd_needs: { title: 'QA rd Needs you', t: now - 40, att: { state: 'needs_you', ask: 'Pick the desk layout', subject: 'Wizard OS' } },
  qa_rd_check: { title: 'QA rd Test this', t: now - 60, att: { state: 'check', ask: 'Try the timer', subject: 'Wizard OS' } },
  qa_rd_plain_ref: { title: 'QA rd Plain reference', t: now - 30, att: null },
  qa_rd_def: { title: 'QA rd Deferred today', t: now - 10, att: { state: 'fyi', ask: 'Read this later', subject: 'Research' }, def: true },
  qa_rd_def_old: { title: 'QA rd Deferred needs', t: now - 3 * 86400, att: { state: 'needs_you', ask: 'Approve the purchase', subject: 'QA rd Home' }, def: true },
};
const DEF = Object.fromEntries(Object.entries(FIX).filter(([, f]) => f.def).map(([id]) => [`direct:${id}`, { sessionId: id, runtime: 'direct', deferred: true, updatedAt: new Date(Date.now() - 60000).toISOString() }]));
const LONG = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}. ` + 'A long reply line that wraps across the phone width so the thread scrolls. '.repeat(3)).join('\n\n');
function fixSession(id) {
  const f = FIX[id];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: false, hidden: false, message_count: 2, runtime: 'direct',
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: f.t - 120, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: 'assistant', content: `Reply body for ${f.title}.`, timestamp: f.t },
    last_user_message: { role: 'user', content: `${f.title} ask`, timestamp: f.t - 120 },
    ...(f.att ? { wizard_attention: f.att } : {}) };
}
const rowsFor = id => [{ id: 1, session_id: id, role: 'user', content: `${FIX[id].title} ask`, timestamp: FIX[id].t - 120 }, { id: 2, session_id: id, role: 'assistant', content: LONG, timestamp: FIX[id].t }];
const writes = [];
const route = async r => {
  const q = r.request(), u = new URL(q.url()), m = q.method();
  const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
  if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
  const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (m !== 'GET' && m !== 'HEAD') {
    const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
    writes.push({ m, p: u.pathname, body });
    if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
    if (u.pathname === '/wizard/thread-dispositions') {
      const b = JSON.parse(body || '{}'), rec = { sessionId: b.sessionId, runtime: b.runtime, deferred: b.deferred, updatedAt: new Date().toISOString() };
      if (FIX[b.sessionId]) DEF[`${b.runtime}:${b.sessionId}`] = rec;
      return json(200, { record: rec });
    }
    return json(200, { ok: true });
  }
  if (!u.pathname.startsWith('/wizard/')) return r.continue();
  if (u.pathname === '/wizard/thread-dispositions') {
    const res = await r.fetch(); let p = {}; try { p = await res.json(); } catch (e) {}
    p.state = { ...(p.state || {}), ...DEF };
    return json(200, p);
  }
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
const overlap = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await ctx.grantPermissions(['microphone']).catch(() => {});
  await ctx.route('**/*', route);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.removeItem('wos.chats.readyBySubject.v1'); localStorage.removeItem('wos.chats.readyOrder.v1');
    localStorage.setItem('wos.chats.sections.v1', JSON.stringify({ ready: true })); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rd_plain') && window.__wos.live.session('qa_rd_def')?.deferred, null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_rd_def')?.deferred), 'thread list loaded with fixture threads (two deferred)');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(800);
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const W = async sel => `[data-chats="${await wid()}"] ${sel}`;
  const R = async sel => W(`[data-sec="ready"] ${sel}`);
  // Ready pages at 40 rows and the live list is long now, so deferred fixtures (always last) sit behind "Show more":
  // expand Ready before reading it, as James would.
  const expandReady = async () => p.evaluate(sel => { const b = document.querySelector(sel); if (b) b.click(); }, await R('[data-secmore]'));
  const readyIds = async () => { await expandReady(); await sleep(150); return p.$$eval(await R('[data-chopen]'), els => els.map(e => e.dataset.chopen).filter(id => id.startsWith('qa_rd_'))); };
  const rowInfo = async id => (await expandReady(), p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; return { cls: e.className, pv: (e.querySelector('.pv')?.textContent || '').trim(), sec: e.closest('[data-sec]')?.dataset.sec }; }, await W(`[data-chopen="${id}"]`)));

  // Samples the voice layer for `ms`: any moment the status pill shows, and where it sits relative to the orb.
  const watchPill = ms => p.evaluate(ms => new Promise(res => {
    const bx = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const seen = []; const t0 = performance.now();
    (function f() {
      const tx = document.getElementById('transcript'), v = tx?.closest('.voice');
      const shown = !!v && v.classList.contains('tx') && +getComputedStyle(tx).opacity > 0.05;
      if (shown) seen.push({ t: Math.round(performance.now() - t0), text: tx.textContent.trim().slice(0, 80), box: bx(tx), orb: bx(document.getElementById('orbWrap')) });
      if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(seen);
    })();
  }), ms);
  const timerGeo = () => p.evaluate(() => {
    const t = document.getElementById('timer'), b = t.getBoundingClientRect(), cs = getComputedStyle(t);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
    return { text: t.textContent, h: Math.round(b.height), w: Math.round(b.width), x: Math.round(b.x), r: Math.round(b.right), lines: Math.round((b.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2) / lh), op: +cs.opacity };
  });
  async function micTake(label, shot) {
    const mic = await W('.ch-compose [data-chmic]');
    await p.locator(mic).tap();
    const seen = await watchPill(2600);
    const voice = await p.evaluate(() => __wos.voice);
    ok(voice === 'listen', `1 ${label}: the composer mic starts a voice reply`, voice);
    ok(seen.length === 0, `1 ${label}: no pill pops up over the orb while the reply records`, seen.slice(0, 2));
    const tg = await timerGeo();
    ok(tg.op > 0.5 && tg.lines === 1, `2 ${label}: the recording timer is on one line`, tg);
    ok(tg.x >= 0 && tg.r <= VW, `2 ${label}: the timer stays on screen`, tg);
    await p.screenshot({ path: path.join(OUT, shot) });
    await p.locator('#arcCancel').tap(); await sleep(600);
    ok(await p.evaluate(() => __wos.voice) === 'idle', `1 ${label}: Cancel ends the take`);
  }

  try {
    // ---- 1–2 composer mic, normal window then full screen ----
    await p.evaluate(() => __wos.openWizardThread('qa_rd_check'));
    await p.waitForFunction(() => document.querySelector('.win .ch-msgs .msg.a') && document.querySelector('.ch-compose [data-chmic]'), null, { timeout: 20000 }).catch(() => {});
    await sleep(600);
    await micTake('thread', '1-reply-recording.png');
    const w0 = await wid();
    await p.evaluate(id => __wos.setFull(id, true), w0); await sleep(900);
    await micTake('full-screen thread', '2-reply-recording-full.png');
    // the orb's own take (not the composer mic) keeps the timer on one line in the corner too
    const orb = await p.evaluate(() => { const b = document.getElementById('orbWrap').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await p.touchscreen.tap(orb.x, orb.y); await sleep(1300);
    const tg = await timerGeo();
    ok(await p.evaluate(() => __wos.voice) === 'listen' && tg.lines === 1 && tg.r <= VW, '2 orb take in full screen: timer on one line, on screen', tg);
    await p.screenshot({ path: path.join(OUT, '3-orb-recording-full.png') });
    await p.locator('#arcCancel').tap(); await sleep(600);
    await p.evaluate(id => __wos.setFull(id, false), w0); await sleep(700);
    await p.locator(await W('[data-chback]')).tap(); await sleep(800);

    // ---- 3–4 Deferred sits at the bottom of Ready ----
    ok(!(await p.$(await W('[data-sec="deferred"]'))), '3 there is no separate Deferred section');
    let ids = await readyIds();
    ok(ids.includes('qa_rd_def') && ids.includes('qa_rd_def_old'), '3 deferred threads (today and 3 days old) sit in Ready', ids);
    ok(ids.slice(-2).sort().join() === 'qa_rd_def,qa_rd_def_old', '3 deferred rows are the bottom of Ready, even the newest one', ids);
    const d = await rowInfo('qa_rd_def'), dOld = await rowInfo('qa_rd_def_old');
    ok(d && /\bdeferred\b/.test(d.cls) && /^Deferred: Read this later/.test(d.pv), '3 a deferred row reads "Deferred: <its line>"', d);
    ok(dOld && /^Deferred: Approve the purchase/.test(dOld.pv) && !/att-needs/.test(dOld.cls), '3 a deferred needs-you row shows Deferred, not Needs you', dOld);
    // Same weight as every other thread (James, 10 Oct 2026: "don't fade it and make it hard to read … just add the
    // label"): no opacity, the title and preview read exactly like a plain row, and the label is coloured like the others.
    const look = await p.evaluate(() => {
      const sel = id => `[data-sec="ready"] [data-chopen="${id}"]`, css = el => el && getComputedStyle(el);
      const d = document.querySelector(sel('qa_rd_def')), n = document.querySelector(sel('qa_rd_plain_ref'));
      const pick = (row) => row && { op: +css(row).opacity, title: [css(row.querySelector('.tp b')).color, css(row.querySelector('.tp b')).fontWeight].join(' '),
        pv: [css(row.querySelector('.pv')).color, css(row.querySelector('.pv')).webkitLineClamp].join(' ') };
      const lab = d?.querySelector('em.att.deferred');
      return { d: pick(d), n: pick(n), label: lab && { text: lab.textContent, color: css(lab).color, weight: css(lab).fontWeight }, pvColor: d && css(d.querySelector('.pv')).color };
    });
    ok(look.d && look.d.op === 1, '3 a deferred row is not faded (full opacity)', look);
    ok(look.d && look.n && look.d.title === look.n.title && look.d.pv === look.n.pv, '3 a deferred row reads like any other thread (same title and preview styling)', look);
    const dot = await p.evaluate(() => { const d = document.querySelector('[data-sec="ready"] [data-chopen="qa_rd_def"]'); return d && { icon: (d.querySelector('.emo.sti')?.className || '').replace('emo sti ', ''), filled: !!d.querySelector('.pv .st.unread') }; });
    ok(dot && dot.icon === 'deferred' && !dot.filled, '3 a deferred row wears the Deferred (clock) icon, never the unread dot', dot);
    const iconColor = await p.evaluate(() => { const i = document.querySelector('[data-sec="ready"] [data-chopen="qa_rd_def"] .emo.sti'); return i && getComputedStyle(i).color; });
    const pvWeight = await p.evaluate(() => { const v = document.querySelector('[data-sec="ready"] [data-chopen="qa_rd_def"] .pv'); return v && getComputedStyle(v).fontWeight; });
    // Labels blend in (James, 10 Oct 2026): the icon's colour, the preview's own weight — never brighter or bolder.
    ok(look.label && look.label.text === 'Deferred:' && look.label.color !== look.pvColor && look.label.color === iconColor && look.label.weight === pvWeight, '3 "Deferred:" is a label in its icon\'s colour at the preview\'s weight, like Needs you / Test this', { look, iconColor, pvWeight });
    const hdr = await p.evaluate(async sel => {
      const h = document.querySelector(sel); const m = (h?.querySelector('b.wait')?.textContent || '').match(/^(\d+) need you/);
      const sec = h?.closest('[data-sec]'); const rows = [...sec.querySelectorAll('[data-chopen]')];
      const want = rows.filter(r => !r.classList.contains('deferred') && (r.classList.contains('att-needs') || r.querySelector('.sti.needs, .sti.approval'))).length;
      return { got: m ? +m[1] : 0, want };
    }, await R('.ch-sec-h'));
    ok(hdr.got === hdr.want, '4 "N need you" leaves deferred threads out', hdr);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'end' }), await W('[data-chopen="qa_rd_def_old"]')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '4-ready-deferred-bottom.png') });

    // ---- 5 Defer from a thread ----
    await p.evaluate(() => __wos.openWizardThread('qa_rd_plain'));
    await p.waitForFunction(() => document.querySelector('.ch-tacts [data-chact="defer"]'), null, { timeout: 20000 }).catch(() => {});
    const wd = writes.length;
    await p.locator(await W('.ch-tacts [data-chact="defer"]')).tap(); await sleep(400);
    const toast = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
    ok(await p.evaluate(() => !Object.values(__wos.wins).find(w => w.app === 'chats')?.thread), '5 Defer steps back to the list');
    const pl = await rowInfo('qa_rd_plain');
    ok(pl && pl.sec === 'ready' && /^Deferred: /.test(pl.pv), '5 the thread is in Ready, marked Deferred, at once', pl);
    ids = await readyIds();
    ok(ids.slice(-3).includes('qa_rd_plain') && ids.indexOf('qa_rd_plain') > ids.indexOf('qa_rd_check'), '5 it moved to the bottom of Ready', ids);
    ok(/Deferred/.test(toast) && !/Moved to Deferred/.test(toast), '5 the toast says Deferred (no section to move to)', toast);
    const pw1 = writes.slice(wd).find(x => x.p === '/wizard/thread-dispositions');
    ok(pw1 && JSON.parse(pw1.body).deferred === true && JSON.parse(pw1.body).sessionId === 'qa_rd_plain', '5 saved through /wizard/thread-dispositions like Wizard', pw1);
    await sleep(1500);
    ok(/^Deferred: /.test((await rowInfo('qa_rd_plain'))?.pv || ''), '5 Deferred survives the save and refresh');

    // ---- 6 Restore ----
    await p.evaluate(() => __wos.openWizardThread('qa_rd_plain'));
    await p.waitForFunction(() => document.querySelector('.ch-tacts [data-chact]'), null, { timeout: 20000 }).catch(() => {});
    const acts = await p.$$eval(await W('.ch-tacts [data-chact]'), els => els.map(e => e.dataset.chact));
    ok(acts.join() === 'restore,done', '6 a deferred thread offers Restore · Done', acts);
    const wr = writes.length;
    await p.locator(await W('.ch-tacts [data-chact="restore"]')).tap(); await sleep(1200);
    const pr = await rowInfo('qa_rd_plain');
    const pw2 = writes.slice(wr).find(x => x.p === '/wizard/thread-dispositions');
    ok(pw2 && JSON.parse(pw2.body).deferred === false, '6 Restore saves deferred:false', pw2);
    if (await p.evaluate(() => !!Object.values(__wos.wins).find(w => w.app === 'chats')?.thread)) { await p.locator(await W('[data-chback]')).tap(); await sleep(700); }
    const pr2 = await rowInfo('qa_rd_plain');
    ok(pr2 && pr2.sec === 'ready' && !/\bdeferred\b/.test(pr2.cls) && !/^Deferred/.test(pr2.pv), '6 restored: still in Ready, status cleared', pr2 || pr);
    ids = await readyIds();
    ok(ids.indexOf('qa_rd_plain') < ids.indexOf('qa_rd_def'), '6 restored row leaves the deferred tail', ids);

    // Priority: needs you → test this → rest, Deferred still last. By subject keeps the Deferred line.
    await p.locator(await R('[data-rdyorder="priority"]')).tap(); await sleep(500);
    ids = await readyIds();
    ok(ids.slice(-2).sort().join() === 'qa_rd_def,qa_rd_def_old' && ids.indexOf('qa_rd_needs') < ids.indexOf('qa_rd_check'), 'Priority: needs you first, deferred still at the bottom', ids);
    await p.locator(await R('[data-rdyorder="subject"]')).tap(); await sleep(500);
    const ds = await rowInfo('qa_rd_def_old');
    ok(ds && /^Deferred: /.test(ds.pv), 'By subject: deferred rows keep their Deferred line', ds);
    const subjHdr = await p.$$eval(await R('.ch-subj'), els => els.map(e => e.textContent));
    ok(subjHdr.some(t => /^QA rd Home/.test(t)) && !subjHdr.some(t => /^QA rd Home.*waiting/.test(t)), 'By subject: a deferred needs-you is not counted as waiting', subjHdr);
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(300);
    ok(await p.evaluate(() => !!document.querySelector('.win')), 'app still open');
  } catch (e) { ok(false, 'suite crashed', String(e).split('\n')[0]); }

  ok(!writes.some(w => /\/v1\/runs$/.test(w.p)), 'zero /v1/runs writes (nothing reached Archimedes)', writes.map(w => w.p));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\nreply-defer: ${pass} passed, ${fail} failed`); console.log('shots', OUT);
  process.exit(fail ? 1 : 0);
})();
