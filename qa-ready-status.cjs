// QA: Ready status lines (feature/ready-status). Each finished thread carries the agent's hidden status tag
// (wizard_attention: needs_you / check / done / fyi + one-line ask + subject). Ready shows needs-you and
// test-this rows first with the exact ask as the preview, done/FYI rows go quiet and swipe straight to Done,
// a needs-you thread from an earlier day files under its own day (Past week) with a "need you" count, and "By subject" groups Ready like the roundup.
// Ready has three orders: Newest (pure recency, labels never move rows), Priority (needs you, test this, rest)
// and By subject. James, 10 Oct 2026: "Newest, I actually want to not use the labels … the newest appears at the
// top. Then … another option … priority … and that's where it should sort how it is now."
//
// James, 10 Oct 2026: "differentiate tasks in ready by which ones are needs you / awaiting your action and which
// ones are done … I don't want the UX to get too cluttered."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-ready-status.cjs [url]
const pw = require('./tools/qa-playwright.cjs');
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('wos-ready-status-shots');
const EXEC = process.env.QA_CHROME || (process.env.QA_CHROME || undefined);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
// Newest first by time: fyi is the newest, needs-you the oldest of today, plus one needs-you from 3 days ago.
const FIX = {
  qa_rs_working: { title: 'QA rs Working reply', t: now - 10, status: 'running', att: null },
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
  return { id, source: 'wizard-mobile', title: f.title, status: f.status || 'completed', archived: ARCH.has(id), hidden: false, message_count: 2,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: f.t - 120, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: 'assistant', content: `Long reply body for ${f.title} that should not be the preview when a status exists.`, timestamp: f.t },
    last_user_message: { role: 'user', content: `${f.title} ask`, timestamp: f.t - 120 },
    ...(f.att ? { wizard_attention: f.att } : {}) };
}
const rowsFor = id => [{ id: 1, session_id: id, role: 'user', content: `${FIX[id].title} ask`, timestamp: FIX[id].t - 120 }, { id: 2, session_id: id, role: 'assistant', content: `Answer for ${FIX[id].title}.`, timestamp: FIX[id].t }];
const writes = [];
const PREFS = { archiveAfterDays: 7, compact: false, readyOrder: 'newest', subjectOrder: [], pinnedChats: [] };
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    // Box preferences stay in the fixture: the live box's saved order must not reset the suite's choices on reload.
    if (u.pathname === '/wizard/v1/ui-preferences') {
      if (m === 'PUT') { try { Object.assign(PREFS, JSON.parse((q.postDataBuffer() || Buffer.alloc(0)).toString())); } catch (e) {} }
      return json(200, PREFS);
    }
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      // Read-state writes carry thread ids (one of them ends in "done"): they never archive anything.
      if (u.pathname !== '/wizard/thread-seen') for (const id of Object.keys(FIX)) if ((u.pathname.includes(id) || body.includes(id)) && /archive|hide|done|"archived":true/i.test(u.pathname + body)) ARCH.add(id);
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
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); if (!sessionStorage.getItem('qaInit')) { sessionStorage.setItem('qaInit', '1'); localStorage.removeItem('wos.chats.readyBySubject.v1'); localStorage.removeItem('wos.chats.readyOrder.v1'); localStorage.removeItem('wos.chats.subjectOrder.v1'); } } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_rs_needs')), 'thread list loaded with fixture threads');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(800);
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const R = async sel => `[data-chats="${await wid()}"] [data-sec="ready"] ${sel}`;
  const W = async sel => `[data-chats="${await wid()}"] [data-sec="working"] ${sel}`;
  // Ready pages at 40 rows and the live list is long, so expand it before reading (as James would tap Show more).
  const expandReady = async () => p.evaluate(sel => { const b = document.querySelector(sel); if (b) b.click(); }, await R('[data-secmore]'));
  const readyIds = async () => { await expandReady(); await sleep(150); return p.$$eval(await R('[data-chopen]'), els => els.map(e => e.dataset.chopen).filter(id => id.startsWith('qa_rs_'))); };
  const rowInfo = async id => p.evaluate(({ sel }) => { const e = document.querySelector(sel); if (!e) return null; return { cls: e.className, pv: e.querySelector('.pv')?.textContent || '', quiet: e.dataset.quiet === '1', op: getComputedStyle(e).opacity }; }, { sel: await R(`[data-chopen="${id}"]`) });

  try {
    const workingVisual = await p.evaluate(sel => {
      const row = document.querySelector(sel), session = window.__wos.live.session('qa_rs_working');
      return row && session ? {
        inWorking: window.__wos.live.workGroups().working.some(thread => thread.id === session.id),
        unreadState: window.__wos.live.isNew(session),
        unreadClass: row.classList.contains('unread'),
        titleWeight: Number(getComputedStyle(row.querySelector('.tp b')).fontWeight),
      } : null;
    }, await W('[data-chopen="qa_rs_working"]'));
    ok(workingVisual?.inWorking && workingVisual.unreadState && !workingVisual.unreadClass && workingVisual.titleWeight <= 600,
      '0 Working stays unbolded even when its read state is unread', workingVisual);

    const ids = await readyIds();
    ok(!ids.includes('qa_rs_old'), '1 a needs-you thread from 3 days ago is NOT in Ready (Ready is today only)', ids);
    const pastHas = await p.evaluate(w => { const sec = document.querySelector(`[data-chats="${w}"] [data-sec="pastWeek"]`); return { has: !!window.__wos.live.workGroups().pastWeek.find(s => s.id === 'qa_rs_old'), wait: sec?.querySelector('.ch-sec-h .wait')?.textContent || '' }; }, await wid());
    ok(pastHas.has && /need you/.test(pastHas.wait), '1 it files under Past week, whose header counts it as need you', pastHas);
    const onNow = async () => p.$$eval(await R('.ch-rdy-bar button'), els => els.map(e => `${e.textContent}${e.classList.contains('on') ? '*' : ''}`));
    ok(JSON.stringify(await onNow()) === JSON.stringify(['Newest*', 'Priority', 'By subject']), '1 three orders, Newest is the default', await onNow());
    // Newest: pure recency, the labels never move a row.
    ok(JSON.stringify(ids) === JSON.stringify(['qa_rs_fyi', 'qa_rs_plain', 'qa_rs_done', 'qa_rs_check', 'qa_rs_needs']), '1 Newest: newest at the top, status labels ignored', ids);
    // Priority: needs you, then test this, then the rest (newest first within each).
    await p.locator(await R('[data-rdyorder="priority"]')).tap(); await sleep(500);
    const pids = await readyIds(), pos = id => pids.indexOf(id);
    ok(JSON.stringify(pids) === JSON.stringify(['qa_rs_needs', 'qa_rs_check', 'qa_rs_fyi', 'qa_rs_plain', 'qa_rs_done']), '1 Priority: needs you, then test this, then the rest (even when newer)', pids);
    ok(JSON.stringify(await onNow()) === JSON.stringify(['Newest', 'Priority*', 'By subject']), '1 Priority is highlighted', await onNow());
    ok((await p.$$(await R('.ch-subj'))).length === 0, '1 Priority adds no subsection headers');
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '1b-ready-priority.png') });
    // Priority survives a reload; Newest returns to recency.
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
    await p.evaluate(() => __wos.goDesk(1)); await sleep(1000);
    ok((await readyIds())[0] === 'qa_rs_needs' && (await onNow())[1] === 'Priority*', '1 Priority is remembered across a reload', await readyIds());
    // Paging: Priority orders the whole Ready list before the first 40 are cut.
    const paged = await p.evaluate(() => {
      const L = __wos.live, base = Date.now();
      const mk = (i, st) => ({ id: 'pg' + i, title: 'pg' + i, status: 'completed', previewAt: new Date(base - i * 60000).toISOString(), attention: st ? { state: st, ask: 'x', subject: '' } : null });
      const list = Array.from({ length: 45 }, (_, i) => mk(i, i === 44 ? 'needs_you' : null));
      return L.readyByPriority(list).slice(0, 40).map(s => s.id).indexOf('pg44');
    });
    ok(paged === 0, '1 Priority puts a needs-you row from deep in the list on the first page', paged);
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(500);
    ok((await readyIds())[0] === 'qa_rs_fyi', '1 back to Newest: the newest thread is at the top again', await readyIds());
    // Oldest (James, 23 Oct 2026): tapping Newest again lists today's Ready oldest first, newest at the bottom.
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(500);
    const old1 = await readyIds();
    ok(JSON.stringify(await onNow()) === JSON.stringify(['Oldest*', 'Priority', 'By subject']), '1d tapping Newest again shows Oldest', await onNow());
    ok(old1[0] === 'qa_rs_needs' && old1[old1.length - 1] === 'qa_rs_fyi' && !old1.includes('qa_rs_old'), '1d Oldest: oldest of today on top, newest at the bottom, older days stay out', old1);
    const oldPaged = await p.evaluate(() => { const L = window.__wos.live; const now = Date.now();
      const mk = (i, extra) => ({ id: 'po' + i, title: 'po' + i, status: 'completed', updatedAt: new Date(now - i * 1000).toISOString(), ...extra });
      const list = Array.from({ length: 50 }, (_, i) => mk(i)).concat([mk(60, { status: 'waiting_for_approval' }), mk(1, { id: 'podef', deferred: true })]);
      const g = L.workGroups(list, now), r = L.readyByOldest(g.ready).map(s => s.id); return { first: r[0], second: r[1], last: r[r.length - 1], def: g.deferred.map(s => s.id).join() }; });
    ok(oldPaged.first === 'po60' && oldPaged.second === 'po49' && oldPaged.last === 'po0' && oldPaged.def === 'podef', '1d Oldest keeps approvals pinned on top; snoozed threads leave Ready', oldPaged);
    const yOrder = await p.evaluate(w => ['yesterday', 'pastWeek'].every(k => { const want = window.__wos.live.workGroups()[k].map(s => s.id);
      const got = [...document.querySelectorAll(`[data-chats="${w}"] [data-sec="${k}"] [data-chopen]`)].map(e => e.dataset.chopen);
      return got.length === 0 || JSON.stringify(got) === JSON.stringify(want.slice(0, got.length)); }), await wid());
    ok(yOrder, '1d Yesterday and Past week stay newest first', yOrder);
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(500);
    ok((await readyIds())[0] === 'qa_rs_fyi', '1d tapping again returns to Newest', await readyIds());

    const n = await rowInfo('qa_rs_needs');
    ok(n && /att-needs/.test(n.cls) && /^Needs you: Say "ship desks"/.test(n.pv.trim()), '2 needs-you row: "Needs you:" label then the exact ask', n);
    const c = await rowInfo('qa_rs_check');
    ok(c && /att-check/.test(c.cls) && /^Your call: Try the new orb timing/.test(c.pv.trim()), '2 check row: "Your call:" label (a judgment call, not QA) then the ask', c);
    const d = await rowInfo('qa_rs_done');
    ok(d && d.quiet && /^Done: Sending pill is live/.test(d.pv.trim()) && !/Long reply body/.test(d.pv), '2 done row is quiet and shows its one-line outcome', d);
    const f = await rowInfo('qa_rs_fyi');
    ok(f && f.quiet && /^FYI: .*Good Arts Law/.test(f.pv.trim()), '2 FYI row is quiet with its one-liner', f);
    const pl = await rowInfo('qa_rs_plain');
    ok(pl && !pl.quiet && /Long reply body/.test(pl.pv) && !/^(Needs you|Your call|Done|FYI|Deferred):/.test(pl.pv.trim()), '2 a thread without a status keeps the old preview, no label', pl);

    const labStyle = await p.evaluate(() => {
      const out = {};
      for (const [id, k] of [['qa_rs_needs','needs'],['qa_rs_check','check'],['qa_rs_done','done'],['qa_rs_fyi','fyi']]) {
        const r = document.querySelector(`[data-sec="ready"] [data-chopen="${id}"]`); if (!r) continue;
        const em = r.querySelector('.pv em.att'), pv = r.querySelector('.pv'), ic = r.querySelector('.emo');
        if (!em) { out[k] = null; continue; }
        const e = getComputedStyle(em), v = getComputedStyle(pv), i = getComputedStyle(ic);
        out[k] = { sameColourAsIcon: e.color === i.color, sameWeight: e.fontWeight === v.fontWeight, sameSize: e.fontSize === v.fontSize };
      }
      return out;
    });
    ok(['needs','check','done','fyi'].every(k => labStyle[k] && labStyle[k].sameColourAsIcon && labStyle[k].sameWeight && labStyle[k].sameSize), '2 label is in its icon\'s colour at the preview\'s own weight and size', labStyle);
    // 2b. Status icons (James, 10 Oct 2026): the row icon is the status; no per-thread ✦ star, no dots for untagged rows.
    const icons = await p.evaluate(sel => Object.fromEntries([...document.querySelectorAll(sel)].filter(e => e.dataset.chopen.startsWith('qa_rs_')).map(e => [e.dataset.chopen, (e.querySelector('.emo.sti')?.className || '').replace('emo sti ', '')])), await R('[data-chopen]'));
    ok(icons.qa_rs_needs === 'needs' && icons.qa_rs_check === 'check' && icons.qa_rs_done === 'done' && icons.qa_rs_fyi === 'fyi', '2b each status has its own icon (hand / flask / check / info)', icons);
    ok(icons.qa_rs_plain === 'none', '2b a thread with no status gets the neutral icon', icons);
    ok(await p.evaluate(sel => ![...document.querySelectorAll(sel)].some(e => e.textContent.includes('✦')), await R('.ch-row .emo')), '2b no ✦ star anywhere in Ready');
    const solid = await p.evaluate(sel => { const r = {}; for (const k of ['done', 'fyi']) { const f = document.querySelector(sel + ` .emo.sti.${k} svg .f`); r[k] = f && getComputedStyle(f).fill; } return r; }, await R(''));
    ok(solid.done && solid.done !== 'none' && solid.fyi && solid.fyi !== 'none' && solid.done !== solid.fyi, '2b done and FYI icons are solid, in different colours', solid);
    // 2c. Bold = unread, plain = read, for every status (inbox rule); status never fades a row or sets its weight.
    const weightOf = async id => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.querySelector('.tp b'); return { unread: e.classList.contains('unread'), w: +getComputedStyle(b).fontWeight, op: +getComputedStyle(e).opacity }; }, await R(`[data-chopen="${id}"]`));
    const before = {}; for (const id of ['qa_rs_needs', 'qa_rs_check', 'qa_rs_done', 'qa_rs_fyi', 'qa_rs_plain']) before[id] = await weightOf(id);
    ok(Object.values(before).every(v => v && v.unread && v.w >= 700 && v.op === 1), '2c unread rows are bold at full strength, whatever their status', before);
    await p.evaluate(() => __wos.live.markSeen(['qa_rs_needs', 'qa_rs_check', 'qa_rs_done', 'qa_rs_fyi', 'qa_rs_plain']));
    await sleep(600);
    const after = {}; for (const id of ['qa_rs_needs', 'qa_rs_check', 'qa_rs_done', 'qa_rs_fyi', 'qa_rs_plain']) after[id] = await weightOf(id);
    const readOnes = Object.entries(after).filter(([, v]) => v && !v.unread);
    ok(readOnes.length >= 2 && readOnes.every(([, v]) => v.w <= 500 && v.op === 1), '2c read rows are plain (needs-you and test-this included)', after);
    const hdr = await p.$eval(await R('.ch-sec-h'), e => e.textContent);
    ok(/need you/.test(hdr), '2 Ready header counts what needs you', hdr);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '1a-ready-newest.png') });

    // 3. By subject: groups with something waiting first, "Other" last; persists.
    await p.locator(await R('[data-rdyorder="subject"]')).tap(); await sleep(500);
    await expandReady(); await sleep(150);
    const subjW = await p.$$eval(await R('.ch-subj'), els => els.map(e => ({ name: e.querySelector('span')?.textContent, waiting: /waiting/.test(e.textContent) })));
    const subj = subjW.map(x => x.name), firstQuiet = subjW.findIndex(x => !x.waiting);
    ok(subj.includes('Wizard OS') && !subj.includes('Home') && subj.includes('Research') && subj[subj.length - 1] === 'Other'
      && (firstQuiet < 0 || subjW.slice(firstQuiet).every(x => !x.waiting)) && subj.indexOf('Wizard OS') < firstQuiet,
      '3 By subject: groups with something waiting first (Wizard OS among them), Other last', subjW);
    const order = await readyIds();
    ok(order.indexOf('qa_rs_needs') < order.indexOf('qa_rs_done') && order.indexOf('qa_rs_done') < order.indexOf('qa_rs_fyi') && order.indexOf('qa_rs_fyi') < order.indexOf('qa_rs_plain') && !order.includes('qa_rs_old'), '3 rows sit under their subject (older days stay out of Ready)', order);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '2-ready-by-subject.png') });
    ok(await p.evaluate(() => localStorage.getItem('wos.chats.readyOrder.v1')) === 'subject', '3 the choice is remembered');
    // 3b. James, 12 Oct 2026: "next to each subject on the right side … an up arrow and a down arrow … and move to
    // top, and you keep a memory of the order". Each header carries ⤒ ↑ ↓; the order survives a reload.
    const names = async () => p.$$eval(await R('.ch-subj'), els => els.map(e => e.querySelector('span')?.textContent));
    const mv = async (dir, name) => { const sel = await R(`.ch-subj [data-subjmove="${dir}"][data-subjkey="${name}"]`);
      const hit = await p.evaluate(s => { const b = document.querySelector(s); if (!b) return 'missing'; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === b || b.contains(t) ? 'ok' : (t?.className || 'none'); }, sel);
      if (hit === 'ok') await p.locator(sel).tap(); await sleep(350); return hit; };
    const n0 = await names();
    const sj0 = await p.$$eval(await R('.ch-subj'), els => els.map(e => { const bs = [...e.querySelectorAll('[data-subjmove]')]; const r = e.getBoundingClientRect(); return { n: bs.length, dis: bs.filter(b => b.disabled).map(b => b.dataset.subjmove).join(','), right: bs.length ? r.right - bs[bs.length - 1].getBoundingClientRect().right : -1, h: bs[0]?.getBoundingClientRect().height || 0 }; }));
    ok(n0.length >= 3 && sj0.every(x => x.n === 3 && x.right < 12 && x.h >= 28), '3b every subject header has ⤒ ↑ ↓ at its right edge, thumb-sized', sj0);
    const topG = await p.$eval(await R('.ch-subj [data-subjmove="top"]'), b => ({ t: b.textContent, n: b.querySelectorAll('.ch-subj-2up i').length, gap: (() => { const [a, c] = b.querySelectorAll('.ch-subj-2up i'); return a && c ? c.getBoundingClientRect().left - a.getBoundingClientRect().right : 99; })() }));
    ok(topG.t === '↑↑' && topG.n === 2 && topG.gap < 0, '3b move to top reads as two up arrows set tight side by side', topG);
    ok(sj0[0].dis === 'top,up' && sj0[sj0.length - 1].dis === 'down', '3b first subject cannot go up, last cannot go down', sj0.map(x => x.dis));
    const h1 = await mv('up', n0[1]); const n1 = await names();
    ok(h1 === 'ok' && n1[0] === n0[1] && n1[1] === n0[0], '3b ↑ swaps a subject with the one above', { h1, n0, n1 });
    const h2 = await mv('down', n1[0]); const n2 = await names();
    ok(h2 === 'ok' && JSON.stringify(n2) === JSON.stringify(n0), '3b ↓ moves it back down', { h2, n2 });
    const lastN = n0[n0.length - 1]; const h3 = await mv('top', lastN); const n3 = await names();
    ok(h3 === 'ok' && n3[0] === lastN && n3.length === n0.length, '3b ⤒ moves the last subject (Other) to the top', { h3, n3 });
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wos.chats.subjectOrder.v1') || '[]'));
    ok(saved[0] === lastN, '3b the order is remembered on the device', saved);
    await p.evaluate(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), await R('.ch-sec-h')); await sleep(300);
    await p.screenshot({ path: path.join(OUT, '2b-subject-reordered.png') });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
    await p.evaluate(() => __wos.goDesk(1)); await sleep(1000); await expandReady(); await sleep(150);
    const n4 = await names();
    // Live threads can leave Ready between loads (a subject empties): compare the subjects both renders share.
    ok(n4.length >= 3 && JSON.stringify(n4) === JSON.stringify(n3.filter(x => n4.includes(x))), '3b the order survives a reload', { n3, n4 });
    ok(!writes.some(x => /\/v1\/runs|\/api\/sessions/.test(x.p)), '3b reordering writes nothing to Archimedes', writes.map(x => x.p));
    // 3c. James, 12 Oct 2026: Android Back on By subject / Priority goes back to the default Newest list, the
    // Chats desk stays open, and Back on Newest goes on as before (here: to Home).
    const deskNow = () => p.evaluate(() => __wos.idx ?? __wos.state?.idx ?? null);
    const onBar = async () => p.$$eval(await R('.ch-rdy-bar button.on'), els => els.map(e => e.dataset.rdyorder));
    const d0 = await deskNow();
    const b1 = await p.evaluate(() => { __wos.onBack(); return (window.__backLog || []).slice(-1)[0]; }); await sleep(400);
    ok(b1 === 'ready-order' && JSON.stringify(await onBar()) === '["newest"]' && (await p.$$(await R('.ch-subj'))).length === 0 && (await deskNow()) === d0,
      '3c Back on By subject returns to Newest and Chats stays open', { b1, on: await onBar(), d0, d1: await deskNow() });
    ok(await p.evaluate(() => localStorage.getItem('wos.chats.readyOrder.v1')) === 'newest', '3c Newest is remembered after Back');
    await p.locator(await R('[data-rdyorder="priority"]')).tap(); await sleep(400);
    const b2 = await p.evaluate(() => { __wos.onBack(); return (window.__backLog || []).slice(-1)[0]; }); await sleep(400);
    ok(b2 === 'ready-order' && JSON.stringify(await onBar()) === '["newest"]', '3c Back on Priority returns to Newest too', { b2, on: await onBar() });
    const b3 = await p.evaluate(() => { __wos.onBack(); return (window.__backLog || []).slice(-1)[0]; }); await sleep(500);
    ok(b3 === 'home', '3c a second Back on Newest goes on as before (Home), never exits', b3);
    await p.evaluate(() => __wos.goDesk(1)); await sleep(700);
    await p.locator(await R('[data-rdyorder="subject"]')).tap(); await sleep(400); await expandReady(); await sleep(150);
    await mv('top', n0[0]); // leave the fixture order roughly as it was for the rest of the suite
    await p.evaluate(() => localStorage.removeItem('wos.chats.subjectOrder.v1'));
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(400);
    ok((await p.$$(await R('.ch-subj'))).length === 0, '3 Newest turns grouping off');
    // The old two-way toggle's "By subject" carries over to the three-way choice.
    await p.evaluate(() => { localStorage.removeItem('wos.chats.readyOrder.v1'); localStorage.setItem('wos.chats.readyBySubject.v1', '1'); });
    delete PREFS.readyOrder; // a box that never saved an order (as before box-wide preferences)
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
    await p.evaluate(() => __wos.goDesk(1)); await sleep(1000);
    ok((await p.$$(await R('.ch-subj'))).length > 0, '3 an old "By subject" setting carries over');
    await p.locator(await R('[data-rdyorder="newest"]')).tap(); await sleep(400);

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
