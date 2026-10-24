// QA (orb in the composer, James 23 Oct 2026): in a full-screen thread the orb takes the mic button's seat at the
// right end of the composer row, so it never floats over the conversation (Retry, Done, links). Typed words swap
// the orb for Send in that same seat (exactly like the old mic); the text box keeps today's width and the model
// chip stays inside it. A focused, empty text box shows the orb's existing typing palette and a tap dictates.
// Every request is intercepted; nothing leaves the browser.
// Usage: QA_WEB_DIR=<repo> [QA_SHOTS=dir] node qa-orb-composer.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin();
const URL_ = ORIGIN + '/wizard-os-home/';
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const now = Date.now() / 1000;
const THREADS = Array.from({ length: 6 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 4, preview: 'Preview line', last_active: now - i * 600, started_at: now - 9000 }));
const MSGS = [
  { id: 1, role: 'user', content: 'Why are the reports not unread?', timestamp: now - 900 },
  { id: 2, role: 'assistant', content: 'Those 9 threads will show as unread once Wizard refreshes on your phone. '.repeat(6), timestamp: now - 880 },
  { id: 3, role: 'user', content: 'Fix it please', timestamp: now - 300 },
  { id: 4, role: 'assistant', content: 'Done. The last line of this reply sits right above the composer, where the old orb used to cover it.', timestamp: now - 280 },
];
const VW = 412, VH = 892;
const writes = [];

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { if (!/\/thread-seen$/.test(u.pathname)) writes.push(u.pathname); return json(200, { state: { initializedAt: Date.now(), threads: {} } }); }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html';
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join(require('./tools/qa-paths.cjs').repoRoot, 'web', f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (/\/hermes\/api\/sessions$/.test(u.pathname)) return json(200, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(200, { object: 'list', data: MSGS.map(x => ({ ...x, session_id: mm[1] })), pagination: { has_more: false } });
    const sm = u.pathname.match(/\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) return json(200, { session: THREADS.find(t => t.id === sm[1]) || THREADS[0] });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return json(200, { state: { initializedAt: Date.now(), threads: {} } });
    return json(200, {});
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(700);
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const chatsDesk = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')));
  await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(600);
  const cid = await p.evaluate(() => __wos.desks[__wos.idx].focus);
  await p.evaluate(id => __wos.setFull(id, true), cid); await p.waitForTimeout(700);
  await p.locator(`.win[data-win="${cid}"] [data-chopen]`).first().tap().catch(() => {}); await p.waitForTimeout(1200);

  const geo = () => p.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > .2 && el.getBoundingClientRect().width > 0;
    const c = document.querySelector('.win.full .ch-compose'), dev = document.querySelector('#device');
    const orb = document.querySelector('#orbWrap'), dock = document.querySelector('#dock');
    const send = c?.querySelector('.ch-send'), mic = c?.querySelector('.ch-mic'), ta = c?.querySelector('textarea'), row = c?.querySelector('.ch-row2');
    const scroll = document.querySelector('.win.full .ch-scroll');
    return { orb: r(orb), orbVis: vis(orb) && vis(dock), send: r(send), sendVis: vis(send), micVis: vis(mic), ta: r(ta), row: r(row), comp: r(c), scroll: r(scroll),
      cls: dev.className, mode: dev.dataset.orbMode || '', voice: __wos.voice };
  });
  let g = await geo();
  ok(!!g.comp, 'full-screen thread shows the composer', JSON.stringify(g));
  ok(g.orbVis && g.orb.w <= 46, 'orb visible and mic-sized', JSON.stringify(g.orb));
  ok(g.orbVis && g.orb.y >= g.row.y - 3 && g.orb.b <= g.row.b + 3, 'orb sits inside the composer row', JSON.stringify({ orb: g.orb, row: g.row }));
  ok(g.orbVis && g.orb.x >= g.ta.r, 'orb sits to the right of the text box', JSON.stringify({ orb: g.orb, ta: g.ta }));
  ok(g.orbVis && g.orb.y >= g.comp.y - 1, 'orb never covers the conversation (stays below the composer top)', JSON.stringify({ orb: g.orb, comp: g.comp }));
  ok(!g.micVis && !g.sendVis, 'old mic and Send hidden while the box is empty', JSON.stringify(g));
  ok(g.ta.w >= VW - 120, 'text box keeps its width (≥ ' + (VW - 120) + 'px)', g.ta.w);
  await shot('1-thread-orb-in-composer');

  // focus the empty box: the orb shows its typing palette; tap dictates
  await p.locator('.win.full .ch-compose textarea').tap(); await p.waitForTimeout(500);
  g = await geo();
  ok(/field-dictation/.test(g.cls), 'focused empty box: orb in dictation mode', g.cls);
  ok(g.orbVis && g.orb.y >= g.row.y - 3 && g.orb.b <= g.row.b + 3, 'focused: orb still in the composer row', JSON.stringify({ orb: g.orb, row: g.row }));
  await shot('2-focused-dictation-orb');
  const lbl = await p.evaluate(() => document.querySelector('#orbWrap').getAttribute('aria-label'));
  ok(/Dictate/i.test(lbl), 'orb announces dictation', lbl);

  // type: Send takes the orb's seat; model chip untouched
  await p.keyboard.type('Also make the orb blue');
  await p.waitForTimeout(400);
  g = await geo();
  ok(g.sendVis && !g.orbVis, 'typed words: Send replaces the orb in the same seat', JSON.stringify({ send: g.send, orbVis: g.orbVis }));
  ok(g.sendVis && g.send.y >= g.row.y - 3 && g.send.r <= VW, 'Send sits in the composer row', JSON.stringify(g.send));
  ok(g.ta.w >= VW - 120, 'typing: text box keeps its width', g.ta.w);
  await shot('3-typing-send');

  // clear: the orb returns
  await p.evaluate(() => { const t = document.querySelector('.win.full .ch-compose textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(() => getComputedStyle(document.querySelector('#dock')).opacity === '1', null, { timeout: 4000 }).catch(() => {});
  g = await geo();
  ok(g.orbVis && !g.sendVis, 'cleared box: orb returns', JSON.stringify(g));
  await p.evaluate(() => document.activeElement?.blur()); await p.waitForTimeout(400);

  // back to the thread list: the orb returns to the corner
  await p.evaluate(() => history.back()); await p.waitForTimeout(900);
  g = await geo();
  ok(!g.comp && g.orbVis, 'thread list: orb back in the corner', JSON.stringify(g));
  await shot('4-list-corner');

  ok(!errs.length, 'no page errors', errs.join(' | '));
  ok(!writes.length, 'no writes', writes.join(','));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
