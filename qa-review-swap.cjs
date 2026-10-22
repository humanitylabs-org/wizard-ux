// QA: a visible Review (bound) view follows a NEW reply's link. James, 19 Oct 2026: on desktop the Review pane
// kept showing the old Outline after a newer reply linked the new one, because a visible view never rebound.
// Usage (Thales): QA_WEB_DIR=<tree> PW=<playwright module dir> node qa-review-swap.cjs [origin]
const pw = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || require('./tools/qa-paths.cjs').origin(), WEB = process.env.QA_WEB_DIR;
let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); };
(async () => {
  const b = await pw.chromium.launch({ headless: true }), ctx = await b.newContext();
  await ctx.route('**/*', r => { const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    const m = WEB && u.pathname.match(/^\/wizard-os-home\/((?:core\/|desktop\/)?[a-z0-9-]+\.js)$/);
    if (m && fs.existsSync(path.join(WEB, 'web', m[1]))) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(WEB, 'web', m[1])) });
    return r.continue(); });
  const p = await ctx.newPage(); await p.goto(ORIGIN + '/wizard-os-home/?shell=desktop');
  await p.waitForFunction(() => window.WosBoundView && window.WizCore?.apps, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  const r = await p.evaluate(() => {
    const A = window.WizCore.apps('desktop'), wins = { c: { id: 'c', app: 'chats', thread: 's1' } }; let n = 0;
    const H = { windows: () => Object.values(wins), win: id => wins[id], findApp: A.findApp, appAt: A.appAt, APP: A.APP, linkTitle: () => 'x', title: () => 't',
      visible: () => true, close: id => delete wins[id], reload: () => {}, open: w => { const id = 'b' + (++n); wins[id] = { id, ...w }; }, from: () => ({}) };
    const M = window.WosBoundView.create(H), el = document.createElement('div');
    const reply = (msgs) => { el.innerHTML = '<div class="ch-msgs">' + msgs.map(h => `<div class="msg a"><div class="bub">${h}</div></div>`).join('') + '</div>'; M.shown('c', el); return Object.values(wins).filter(w => w.bound).map(w => w.appId); };
    const first = reply(['<a href="/wizard-os-home/?open=meditation">Old</a>']);
    const same = reply(['<a href="/wizard-os-home/?open=meditation">Old</a>']);
    const next = reply(['<a href="/wizard-os-home/?open=meditation">Old</a>', '<a href="/wizard-os-home/?open=outline-streaming-demo">Open Outline</a>']);
    return { first, same, next };
  });
  ok(r.first.length === 1, 'a reply with an app link binds a Review view', r);
  ok(r.same.join() === r.first.join(), 're-rendering the same reply keeps the visible view', r);
  ok(r.next.length === 1 && r.next[0] === 'outline-streaming-demo', 'a new reply linking another app replaces the visible Review view', r);
  await b.close(); console.log(`review-swap: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
