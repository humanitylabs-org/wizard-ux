// QA for Share + the text selection menu (feature/share-select, Wizard OS 0.9.7), phone shell with a fake Android bridge.
//  1 Share under a response calls Android's share sheet (WizardOSNative.shareText) with "From Archimedes:" + the text
//  2 Selecting words in a chat shows Wizard's own menu (Copy · Share · Quote · Search · Select all) and tells the
//    native view the selection is ours (selection(3)); Android's toolbar stays quiet for it
//  3 Copy · Share (selected words only, header only on his words) · Quote (into this thread's reply box) · Search ·
//    Select all (whole message)
//  4 Settings → Text selection menu: switching an item off removes it from the menu (kept across reloads)
//  5 Back with words selected lets go of them and stays in the app; a text field keeps Android's menu (selection(2))
//  6 Browser / old app (no WizardOSNative.selection): no Wizard menu (the platform's own toolbar applies)
//  7 Selection colour is Wizard violet
// Fixture thread merged into real Wizard reads; EVERY non-GET request is intercepted, nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &  then  QA_WEB_DIR=<worktree> node qa-share-select.cjs [url]
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/wos097';
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000, SID = 'qa_share_sel';
const ANSWER = 'Telegram is where James shares the useful answers. This second sentence is longer so there is plenty to select.';
const rows = () => [
  { id: 1, role: 'user', content: 'My own question with words I might share myself.', timestamp: now - 600 },
  { id: 2, role: 'assistant', content: ANSWER, timestamp: now - 590 },
].map(x => ({ ...x, session_id: SID }));
const session = () => ({ id: SID, source: 'wizard-mobile', title: 'QA share select', status: 'completed', archived: false, hidden: false, message_count: 2,
  started_at: now - 600, last_active: now - 5, wizard_last_user_at: now - 600, wizard_last_assistant_at: now - 590, wizard_activity_at: now - 5, wizard_run_id: '',
  latest_message: { role: 'assistant', content: ANSWER, timestamp: now - 590 }, last_user_message: { role: 'user', content: 'My own question', timestamp: now - 600 } });
const writes = [];
async function fence(ctx) {
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') { writes.push(u.pathname); return json(200, {}); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') { const res = await r.fetch(); const p = await res.json(); p.data = [session()].concat(p.data || []); return json(200, p); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { const all = rows(); return json(200, { object: 'list', data: all, pagination: { limit: 500, offset: 0, returned: all.length } }); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json(200, { session: session() });
    return r.continue();
  });
}
async function until(fn, ms = 6000, step = 100) { const t = Date.now() + ms; while (Date.now() < t) { const v = await fn(); if (v) return v; await sleep(step); } return await fn(); }
const NATIVE = withSel => `(() => { window.__qaN = []; const c = (k, ...a) => window.__qaN.push([k, ...a]);
  window.WizardOSNative = { platform: () => 'android:0.9.7', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake() {},
    shareText: (t, title) => c('shareText', t, title), shareFile: (b, n, m) => c('shareFile', n, m)${withSel ? ', selection: s => c("selection", s)' : ''} }; })()`;

async function open(ctx, withSel = true) {
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(NATIVE(withSel));
  const url = new URL(URL_); url.searchParams.set('open', 'chats');
  await p.goto(url.href); await p.waitForTimeout(4000);
  await p.evaluate(sid => { const r = [...document.querySelectorAll(`.ch-list [data-chopen="${sid}"]`)].find(x => x.getBoundingClientRect().width > 0); r && r.click(); }, SID);
  await until(() => p.evaluate(() => !!document.querySelector('.ch-msgs .msg.a .bub p')), 8000);
  return { p, errs };
}
const T = `[...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0)`;
const select = (p, sel, from = 0, to = 22) => p.evaluate(([sel, from, to]) => { const t = eval(window.__T); const e = t.querySelector(sel); const n = e.firstChild; const r = document.createRange(); r.setStart(n, from); r.setEnd(n, Math.min(to, n.length)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return String(s); }, [sel, from, to]);
const N = p => p.evaluate(() => window.__qaN.splice(0));
const menu = p => until(() => p.evaluate(() => window.WosSelMenu?.state.open ? window.WosSelMenu.state : null), 2500);
const tap = (p, id) => p.evaluate(id => document.querySelector(`.selmenu [data-sm="${id}"]`).click(), id);

(async () => {
  const b = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(t => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); window.__T = t; }, T);
  await fence(ctx);
  const { p, errs } = await open(ctx);
  ok(await p.evaluate(() => !!document.querySelector('.ch-msgs .msg.a .bub p')), 'fixture thread opens');
  // 1 Share button under the response
  await N(p);
  await p.evaluate(() => { const t = eval(window.__T); t.querySelector('[data-mshare]').click(); });
  await sleep(300);
  const sh = (await N(p)).filter(c => c[0] === 'shareText');
  ok(sh.length === 1 && sh[0][1] === 'From Archimedes:\n\n' + ANSWER, '1 Share under a response opens Android share with "From Archimedes:" over the message', sh);
  // 2 selection → our menu
  const picked = await select(p, '.msg.a .bub p', 0, 22);
  const m = await menu(p);
  const calls = await N(p);
  ok(m && m.items.join(',') === 'copy,share,quote,search,all', '2 selecting words shows Wizard’s menu: Copy · Share · Quote · Search · Select all', m);
  ok(calls.some(c => c[0] === 'selection' && c[1] === 3), '2 the native view is told the selection is Wizard’s own (Android toolbar stays quiet)', calls);
  const geo = await p.evaluate(() => { const m = document.querySelector('.selmenu').getBoundingClientRect(), r = getSelection().getRangeAt(0).getBoundingClientRect(); return { m: [m.left, m.top, m.right, m.bottom], r: [r.left, r.top, r.right, r.bottom], vw: innerWidth }; });
  ok(geo.m[3] <= geo.r[1] || geo.m[1] >= geo.r[3], '2 the menu sits above or below the words, never over them', geo);
  ok(geo.m[0] >= 0 && geo.m[2] <= geo.vw, '2 the menu stays on screen', geo);
  await p.screenshot({ path: path.join(SHOTS, 'web-menu.png') });
  // 3a Copy
  await tap(p, 'copy'); await sleep(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  const after = await p.evaluate(() => ({ sel: String(getSelection()), open: window.WosSelMenu.state.open }));
  ok(clip === picked.trim(), '3 Copy puts the selected words on the clipboard', { clip, picked });
  ok(!after.sel && !after.open, '3 Copy lets go of the selection and closes the menu', after);
  ok((await N(p)).some(c => c[0] === 'selection' && c[1] === 0), '3 the native view hears the selection is gone');
  // 3b Share selected words (his) → header
  await select(p, '.msg.a .bub p', 0, 22); await menu(p); await N(p);
  await tap(p, 'share'); await sleep(300);
  const s2 = (await N(p)).filter(c => c[0] === 'shareText');
  ok(s2.length === 1 && s2[0][1] === 'From Archimedes:\n\n' + picked.trim(), '3 Share sends only the selected words, with "From Archimedes:" on top', s2);
  // 3c Share my own words → no header
  const mine = await select(p, '.msg.u .bub p', 0, 15); await menu(p); await N(p);
  await tap(p, 'share'); await sleep(300);
  const s3 = (await N(p)).filter(c => c[0] === 'shareText');
  ok(s3.length === 1 && s3[0][1] === mine.trim(), '3 Share of my own words sends them as they are (no "From Archimedes")', s3);
  // 3d Quote
  await select(p, '.msg.a .bub p', 0, 22); await menu(p);
  await tap(p, 'quote'); await sleep(300);
  const ta = await p.evaluate(() => { const t = eval(window.__T); const x = t.querySelector('.ch-compose textarea'); return { v: x.value, focused: document.activeElement === x }; });
  ok(ta.v === '> ' + picked.trim() + '\n\n' && ta.focused, '3 Quote puts the words in this thread’s reply box as a quote, ready to type', ta);
  await p.evaluate(() => { const t = eval(window.__T); const x = t.querySelector('.ch-compose textarea'); x.value = ''; x.dispatchEvent(new Event('input', { bubbles: true })); x.blur(); });
  // 3e Select all
  await select(p, '.msg.a .bub p', 5, 12); await menu(p);
  await tap(p, 'all'); await sleep(500);
  const all = await p.evaluate(() => ({ sel: String(getSelection()).trim(), open: window.WosSelMenu.state.open }));
  ok(all.sel === ANSWER && all.open, '3 Select all selects the whole message and keeps the menu', all);
  // 3f Search
  await p.evaluate(() => { window.__qaSearch = []; const o = window.__wos.openSearch; window.__wos.openSearch = (q, t) => { window.__qaSearch.push([q, t]); return true; }; window.__wos.__o = o; });
  await select(p, '.msg.a .bub p', 0, 22); await menu(p);
  await tap(p, 'search'); await sleep(300);
  const srch = await p.evaluate(() => window.__qaSearch);
  ok(srch.length === 1 && srch[0][0] === picked.trim(), '3 Search looks the words up in Wizard Search', srch);
  // 4 Settings toggle
  await p.evaluate(() => window.__wos.openSettings()); await sleep(600);
  const grp = await p.evaluate(() => { const g = document.querySelector('#settingsBody [data-selmenu]'); return g ? [...g.querySelectorAll('[data-smset]')].map(b => b.dataset.smset + (b.querySelector('.sw.on') ? ':on' : ':off')).join(',') : null; });
  ok(grp === 'copy:on,share:on,quote:on,search:on,all:on', '4 Settings lists the menu items, all on by default', grp);
  await p.evaluate(() => document.querySelector('#settingsBody [data-smset="quote"]').click()); await sleep(200);
  const grp2 = await p.evaluate(() => document.querySelector('#settingsBody [data-smset="quote"] .sw.on') ? 'on' : 'off');
  ok(grp2 === 'off', '4 tapping Quote switches it off', grp2);
  await p.evaluate(() => window.__wos.closeSheets()); await sleep(500);
  await select(p, '.msg.a .bub p', 0, 22); const m4 = await menu(p);
  ok(m4 && !m4.items.includes('quote') && m4.items.length === 4, '4 the menu no longer offers Quote', m4);
  // 5 Back
  const back = await p.evaluate(() => window.__wos.onBack ? (window.__wos.onBack(), true) : false); await sleep(400);
  const b5 = await p.evaluate(() => ({ sel: String(getSelection()), open: window.WosSelMenu.state.open, thread: !!eval(window.__T), log: (window.__backLog || []).slice(-2) }));
  ok(back && !b5.sel && !b5.open && b5.thread, '5 Back lets go of the selected words first; the thread stays open', b5);
  // 5b text field keeps Android's menu
  await N(p);
  const box = await p.evaluate(() => { const t = eval(window.__T); const r = t.querySelector('.ch-compose textarea').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 }; });
  await p.touchscreen.tap(box.x, box.y); await sleep(200);
  await p.evaluate(() => { const t = eval(window.__T); const x = t.querySelector('.ch-compose textarea'); x.value = 'draft words here'; x.focus(); x.setSelectionRange(0, 5); document.dispatchEvent(new Event('selectionchange')); });
  await sleep(500);
  const c5 = await N(p), st5 = await p.evaluate(() => window.WosSelMenu.state.open);
  ok(c5.some(c => c[0] === 'selection' && c[1] === 2) && !st5, '5 a press in the reply box keeps Android’s own menu (Paste) and shows no Wizard menu', { c5, st5 });
  await p.evaluate(() => { const t = eval(window.__T); const x = t.querySelector('.ch-compose textarea'); x.value = ''; x.dispatchEvent(new Event('input', { bubbles: true })); x.blur(); });
  // 7 colour
  const col = await p.evaluate(() => getComputedStyle(document.querySelector('.msg .bub p'), '::selection').backgroundColor);
  ok(/143, 99, 255/.test(col), '7 selected words are highlighted in Wizard violet', col);
  // 8 drag the menu off the words (James, 12 Oct): real touch stream through CDP, so touch-action and pointer capture count
  const cdp = await ctx.newCDPSession(p);
  const touch = async (pts) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const line = (x0, y0, x1, y1, n = 14) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
  const mrect = () => p.evaluate(() => { const r = document.querySelector('.selmenu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const centre = sel => p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  await select(p, '.msg.a .bub p', 0, 40); await menu(p); await N(p);
  ok(await p.evaluate(() => !!document.querySelector('.selmenu [data-smgrip]')), '8 the menu shows a grip so it reads as movable');
  await sleep(300); const r0 = await mrect();
  const [sx, sy] = await centre('.selmenu [data-sm="share"]'); // start the drag ON a button: it must move, not share
  await touch(line(sx, sy, sx + 30, sy + 260)); await sleep(500);
  const r1 = await mrect(), st8 = await p.evaluate(() => ({ ...window.WosSelMenu.state, sel: String(getSelection()) })), n8 = await N(p);
  ok(Math.abs(r1.t - r0.t - 260) <= 3 && Math.abs(r1.l - r0.l - 30) <= 3, '8 dragging the menu moves it with the finger', { r0, r1 });
  ok(st8.open && st8.sel.length > 20 && st8.moved, '8 after the drop the menu stays open and the words stay selected', st8);
  ok(!n8.some(c => c[0] === 'shareText'), '8 a drag that started on Share did not share', n8);
  await p.screenshot({ path: path.join(SHOTS, 'menu-dragged.png') });
  // 8b scrolling the thread leaves a moved menu where it was dropped
  await p.evaluate(() => { const t = eval(window.__T); const m = t.querySelector('.ch-msgs'); m.scrollTop = Math.max(0, m.scrollTop - 40); m.dispatchEvent(new Event('scroll')); }); await sleep(500);
  const r2 = await mrect();
  ok(Math.abs(r2.t - r1.t) <= 1 && await p.evaluate(() => window.WosSelMenu.state.open), '8 scrolling keeps the moved menu where it was dropped', { r1, r2 });
  // 8c the menu stays on screen however far it is flung
  await touch(line((r2.l + r2.r) / 2, (r2.t + r2.b) / 2, 900, 2000)); await sleep(300);
  const r3 = await mrect(); const vp = await p.evaluate(() => [innerWidth, innerHeight]);
  ok(r3.l >= 0 && r3.r <= vp[0] && r3.t >= 0 && r3.b <= vp[1], '8 a moved menu is kept on screen', { r3, vp });
  // 8d a short tap still runs the button after a move
  const [cx, cy] = await centre('.selmenu [data-sm="copy"]');
  await touch([[cx, cy], [cx + 2, cy + 1]]); await sleep(400);
  const clip8 = await p.evaluate(() => navigator.clipboard.readText()), o8 = await p.evaluate(() => window.WosSelMenu.state.open);
  ok(clip8 === ANSWER.slice(0, 40).trim() && !o8, '8 a tap (under 6 px of movement) on Copy still copies after a move', { clip8, o8 });
  // 8e the next selection is placed above the words again
  await select(p, '.msg.a .bub p', 0, 22); const m8 = await menu(p);
  const geo8 = await p.evaluate(() => { const m = document.querySelector('.selmenu').getBoundingClientRect(), r = getSelection().getRangeAt(0).getBoundingClientRect(); return { m: [m.top, m.bottom], r: [r.top, r.bottom] }; });
  ok(m8 && !m8.moved && (geo8.m[1] <= geo8.r[0] || geo8.m[0] >= geo8.r[1]), '8 a new selection places the menu next to its words again', { m8, geo8 });
  await p.evaluate(() => getSelection().removeAllRanges()); await sleep(200);
  ok(!errs.length, 'no page errors', errs);
  await p.close();
  // 6 old app / browser
  const o = await open(ctx, false);
  await select(o.p, '.msg.a .bub p', 0, 22); await sleep(900);
  ok(!(await o.p.evaluate(() => window.WosSelMenu.state.open)), '6 an older app or a browser keeps its own toolbar (no Wizard menu)');
  await o.p.close();
  ok(!writes.filter(w => /\/v1\/runs$/.test(w)).length, 'no runs were posted (fence)', writes);
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
