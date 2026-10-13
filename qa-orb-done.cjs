// QA: where the orb sits in full-screen Chats (feature/orb-above-done).
// James, 10 Oct 2026: in full screen the corner orb sat in the bottom-right corner, in the way. It now sits in
// the right-hand column above the composer, so Done (at the end of a reply) and ↓ Latest (when scrolled up)
// end up directly below it and never underneath it.
//
// Fixture threads merged into the real session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9483 <tree>/web &  then  node qa-orb-done.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/developer/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9483/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wos-orb-done-shots';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VW = 412, VH = 892;
const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
const LONG = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}. ` + 'This is a long reply line that wraps across the phone width so the thread scrolls. '.repeat(3)).join('\n\n');
const FIX = {
  qa_od_long: { title: 'QA orb above Done', t: now - 30, rows: () => [row('user', 'Give me a long answer', now - 300), row('assistant', LONG, now - 250)] },
};
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: false, hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
const route = async r => {
  const q = r.request(), u = new URL(q.url()), m = q.method();
  const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (m !== 'GET' && m !== 'HEAD') {
    const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
    writes.push({ m, p: u.pathname });
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
const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
const overlap = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', route);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_od_long'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_od_long')), 'thread list loaded with the fixture thread');
  try {
    await p.evaluate(() => __wos.openWizardThread('qa_od_long'));
    await p.waitForFunction(() => document.querySelector('.win .ch-msgs .msg.a') && document.querySelector('[data-chact="done"]'), null, { timeout: 20000 }).catch(() => {});
    await sleep(500);
    const wid = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
    await p.evaluate(id => __wos.setFull(id, true), wid); await sleep(900);
    const geo = () => p.evaluate(() => {
      const bx = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
      const we = document.querySelector('.win.full'), nb = we?.querySelector('.ch-msgs');
      const lt = we?.querySelector('[data-chlatest]');
      return { full: document.querySelector('#device').classList.contains('orb-corner'), orb: bx(document.querySelector('#orbWrap')), comp: bx(we?.querySelector('.ch-compose')),
        send: bx(we?.querySelector('.ch-compose .ch-send')), done: bx(we?.querySelector('[data-chact="done"]')), defer: bx(we?.querySelector('[data-chact="defer"]')),
        latest: lt && !lt.hidden ? bx(lt) : null, msgs: bx(nb), atBottom: nb ? nb.scrollHeight - nb.scrollTop - nb.clientHeight < 4 : null };
    });
    await p.evaluate(() => { const nb = document.querySelector('.win.full .ch-msgs'); nb.scrollTop = nb.scrollHeight; nb.dispatchEvent(new Event('scroll')); });
    await sleep(700);
    let g = await geo();
    ok(g.full && g.orb, 'full-screen Chats shows the corner orb', g);
    ok(g.orb && g.comp && g.orb.b <= g.comp.y + 1, 'orb sits above the composer (not in the bottom-right corner)', { orb: g.orb, comp: g.comp });
    ok(g.orb && g.orb.r >= VW - 24, 'orb stays on the right edge', g.orb);
    ok(!overlap(g.orb, g.send), 'orb never covers Send', { orb: g.orb, send: g.send });
    ok(g.atBottom && g.done && !overlap(g.orb, g.done) && g.done.y >= g.orb.b - 1 && g.done.b <= g.comp.y + 1, 'at the latest: Done sits below the orb, fully visible above the composer', { orb: g.orb, done: g.done, comp: g.comp, atBottom: g.atBottom });
    ok(g.done && Math.abs((g.done.x + g.done.r) / 2 - (g.orb.x + g.orb.r) / 2) < 40, 'Done lines up under the orb (same right-hand column)', { orb: g.orb, done: g.done });
    ok(!overlap(g.orb, g.defer), 'orb never covers Defer', { orb: g.orb, defer: g.defer });
    await p.screenshot({ path: path.join(OUT, '1-full-at-latest.png') });
    // scroll up: ↓ Latest appears directly below the orb, clear of it
    await p.evaluate(() => { const nb = document.querySelector('.win.full .ch-msgs'); nb.scrollTop = 200; nb.dispatchEvent(new Event('scroll')); });
    await sleep(700);
    g = await geo();
    ok(!!g.latest, 'scrolled up: ↓ Latest shows', g);
    ok(g.latest && !overlap(g.orb, g.latest) && g.latest.y >= g.orb.b - 1, '↓ Latest sits below the orb, not under it', { orb: g.orb, latest: g.latest });
    ok(g.latest && g.comp && g.latest.b <= g.comp.y + 1, '↓ Latest stays above the composer', { latest: g.latest, comp: g.comp });
    await p.screenshot({ path: path.join(OUT, '2-full-scrolled-up.png') });
    // tap the orb: it records, controls fan out on screen and stay off the composer
    await p.touchscreen.tap(g.orb.x + g.orb.w / 2, g.orb.y + g.orb.h / 2); await sleep(900);
    const arcs = await p.evaluate(() => ['#arcCancel', '#arcPause', '#arcAttach'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, o: +getComputedStyle(document.querySelector(q)).opacity }; }));
    const voice = await p.evaluate(() => __wos.voice);
    ok(voice === 'listen', 'tapping the orb starts a voice reply', voice);
    ok(arcs.every(a => a.x >= 0 && a.r <= VW && a.y >= 0 && a.b <= VH && a.o > .5), 'Cancel · Pause · Attach fan out on screen', arcs);
    ok(arcs.every(a => a.b <= g.comp.y + 2), 'voice controls stay above the composer', { comp: g.comp, arcs });
    await p.screenshot({ path: path.join(OUT, '3-full-recording.png') });
    const hit = await p.evaluate(() => ['#arcCancel', '#arcPause', '#arcAttach'].map(q => { const el = document.querySelector(q), r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el.contains(t) ? 'ok' : q + '→' + (t?.id || t?.className); }));
    ok(hit.every(h => h === 'ok'), 'voice controls are tappable (nothing on top of them)', hit);
    await p.locator('#arcCancel').tap(); await sleep(500);
    // leaving full screen puts the orb back in the dock centre
    await p.evaluate(id => __wos.setFull(id, false), wid); await sleep(800);
    g = await geo();
    ok(!g.full && g.orb && Math.abs(g.orb.x + g.orb.w / 2 - VW / 2) < 4, 'out of full screen the orb is back in the centre of the dock', g.orb);
  } catch (e) { ok(false, 'run completed', String(e)); }
  ok(errs.length === 0, 'no page errors', errs);
  ok(writes.every(w => w.p === '/wizard/thread-seen'), 'no writes reach Wizard', writes);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); console.log('shots', OUT);
  process.exit(fail ? 1 : 0);
})();
