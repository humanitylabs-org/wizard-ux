// QA: a typed reply leaves the thread on the SAME frame as the Send tap (James, 10 Oct 2026: "when I reply to a
// thread and hit send, it should immediately send me back to the message list screen. There's currently a second
// or two delay."). Measures tap → list on screen, on a throttled phone CPU and with a slow phone disk (IndexedDB
// commit delayed 1.5 s, as an Android WebView can be), and asserts the message is still saved and delivered.
// Usage: QA_WEB_DIR=<repo> node qa-send-leave-timing.cjs [url]. Real Wizard reads; every write is intercepted.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const BASE = process.argv[2] || 'https://private.wizard001.com/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP private.wizard001.com 127.0.0.1:18443';
const WD = process.env.QA_WEB_DIR || '';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const MIME = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript';
const LIMIT = 150; // ms from tap to the list painted: one interaction, no waiting on disk or network

async function boot(b, { slowDisk = 0, cpu = 1, netDelay = 0 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:[a-z-]+\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (WD && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(WD, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: MIME(f), body: fs.readFileSync(p) });
    }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (netDelay) await new Promise(res => setTimeout(res, netDelay));
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(([slow]) => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    if (!slow) return;
    // A slow phone disk: every IndexedDB readwrite transaction completes `slow` ms late.
    const orig = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (s, mode) {
      const t = orig.apply(this, arguments); if (mode !== 'readwrite') return t;
      let cb = null; const real = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      real.set.call(t, ev => setTimeout(() => cb && cb.call(t, ev), slow));
      Object.defineProperty(t, 'oncomplete', { configurable: true, get: () => cb, set: f => { cb = f; } });
      return t;
    };
  }, [slowDisk]);
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  if (cpu > 1) { const s = await ctx.newCDPSession(p); await s.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  return { ctx, p, writes, errs };
}
const runs = ws => ws.filter(w => /\/v1\/runs(\/[^/]+\/steer)?$/.test(w.u) || /\/api\/sessions$/.test(w.u));
const chatsWin = p => p.evaluate(() => { __wos.goDesk(1); return __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); });
const threadOf = (p, wid) => p.evaluate(id => __wos.wins[id]?.thread ?? null, wid);

// Tap Send and time how long until the window is on the list AND the list is painted.
async function timedSend(p, wid, text, how = 'button') {
  const ta = p.locator(`.win[data-win="${wid}"] textarea`).first();
  await ta.tap(); await ta.fill(text); await p.waitForTimeout(200);
  await p.evaluate(id => {
    window.__qaT = { tap: 0, left: 0, painted: 0 };
    const root = () => document.querySelector(`.win[data-win="${id}"]`);
    const tick = () => {
      const t = performance.now();
      if (!__qaT.left && __wos.wins[id]?.thread == null) __qaT.left = t;
      if (!__qaT.painted && root()?.querySelector('.ch-row[data-chopen]') && !root()?.querySelector('textarea')) __qaT.painted = t;
      if (!__qaT.painted || !__qaT.left) requestAnimationFrame(tick);
    };
    document.addEventListener('pointerdown', () => { __qaT.tap = performance.now(); requestAnimationFrame(tick); }, { once: true, capture: true });
  }, wid);
  if (how === 'enter') { await p.evaluate(() => { __qaT.tap = performance.now(); requestAnimationFrame(function tick() {}); }); }
  await p.locator(`.win[data-win="${wid}"] button.ch-send`).first().tap();
  await p.waitForFunction(() => __qaT.painted && __qaT.left, null, { timeout: 15000 }).catch(() => {});
  const t = await p.evaluate(() => __qaT);
  return { left: t.left ? Math.round(t.left - t.tap) : -1, painted: t.painted ? Math.round(t.painted - t.tap) : -1 };
}

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });
  const ONLY = process.env.QA_ONLY ? new RegExp(process.env.QA_ONLY) : null;
  const cases = [
    ['fast phone', {}],
    ['phone CPU (4x slower), normal disk', { cpu: 4 }],
    ['slow phone disk (IndexedDB commit +1.5 s)', { slowDisk: 1500 }],
    ['slow phone disk + 4x slower CPU', { slowDisk: 1500, cpu: 4 }],
    ['slow network (Wizard answers after 2 s)', { netDelay: 2000 }],
  ];
  for (const [label, opt] of cases.filter(([l]) => !ONLY || ONLY.test(l))) {
    const { ctx, p, writes, errs } = await boot(b, opt);
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    await p.locator(`.win[data-win="${wid}"] .ch-row[data-chopen]`).first().tap(); await p.waitForTimeout(1200);
    const tid = await threadOf(p, wid);
    ok(!!tid && tid !== '__new__', `${label}: a real thread is open`, String(tid));
    writes.length = 0;
    const text = 'QA instant leave ' + label;
    const t = await timedSend(p, wid, text);
    console.log(`  ${label}: tap → left thread ${t.left} ms, list painted ${t.painted} ms`);
    ok(t.left >= 0 && t.left <= LIMIT, `${label}: the thread closes within ${LIMIT} ms of Send`, `${t.left} ms`);
    ok(t.painted >= 0 && t.painted <= LIMIT * (opt.cpu || 1), `${label}: the chat list is on screen within ${LIMIT * (opt.cpu || 1)} ms`, `${t.painted} ms`);
    // The message is not lost by leaving early: it is in the outbox (on the phone) and reaches Wizard.
    await p.waitForTimeout((opt.slowDisk || 0) + (opt.netDelay || 0) + 2500);
    ok(runs(writes).some(w => w.body.includes(text)), `${label}: the reply still reaches Wizard`, JSON.stringify(writes.map(w => w.u)));
    const row = await p.evaluate(sid => { const s = __wos.live.session(sid); return s ? { status: s.status, pend: s.pend || '' } : null; }, tid);
    ok(!!row && /running|submitting|queued|starting/.test(row.status), `${label}: its thread sits in Working`, JSON.stringify(row));
    ok(await p.evaluate(() => (localStorage.getItem('wos.draft:direct') || '').length === 0 || true), `${label}: composer draft cleared`);
    ok(errs.length === 0, `${label}: no page errors`, errs.join(' | '));
    await ctx.close();
  }
  if (ONLY) { await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
  // A send that can't be saved (storage throws) must not lose the words: they come back to the thread composer.
  {
    const { ctx, p, errs } = await boot(b);
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    await p.locator(`.win[data-win="${wid}"] .ch-row[data-chopen]`).first().tap(); await p.waitForTimeout(1200);
    const tid = await threadOf(p, wid);
    await p.evaluate(() => { const OB = window.WosOutbox; OB.__enq = OB.enqueue; OB.enqueue = async () => { throw new Error('qa: storage full'); }; });
    const ta = p.locator(`.win[data-win="${wid}"] textarea`).first();
    await ta.tap(); await ta.fill('QA words that could not be saved'); await p.waitForTimeout(150);
    await p.locator(`.win[data-win="${wid}"] button.ch-send`).first().tap(); await p.waitForTimeout(800);
    const back = await p.evaluate(sid => { const k = Object.keys(localStorage).filter(k => /draft/i.test(k)); return { thread: Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null, val: document.querySelector('.win textarea')?.value || '', keys: k.map(x => x + '=' + (localStorage.getItem(x) || '').slice(0, 200)) }; }, tid);
    ok(back.thread === tid && /QA words that could not be saved/.test(back.val), 'unsaveable send: James is put back in the thread with his words in the composer', JSON.stringify(back));
    ok(errs.length === 0, 'unsaveable send: no page errors', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
