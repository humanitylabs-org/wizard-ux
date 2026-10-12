// Thales-only real CDP scroll regression. Candidate assets at the real origin, SW blocked,
// EVERY non-GET/HEAD request fulfilled locally. Deterministic session/message fixtures, no sends.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-scroll');
const EXEC = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0, revision = 1, messageReads = 0;
const checks = [], writes = [], now = Date.now() / 1000, SID = 'qa_scroll_live';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(value, name, evidence = {}) { checks.push({ name, pass: !!value, evidence }); if (value) { pass++; console.log('PASS', name, JSON.stringify(evidence)); } else { fail++; console.log('FAIL', name, JSON.stringify(evidence)); } }
function rows() {
  const a = [];
  for (let i = 0; i < 26; i++) a.push({ id: i + 1, session_id: SID, role: i % 2 ? 'assistant' : 'user', content: `Paragraph ${i}. ` + 'Readable words in a settled earlier reply for sustained slow scrolling. '.repeat(6), timestamp: now - 600 + i });
  for (let i = 1; i <= revision; i++) { a.push({ id: 100 + i * 2, session_id: SID, role: 'assistant', content: '', timestamp: now - 100 + i, tool_calls: [{ id: 'step' + i, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: 'Scroll step ' + i }] }); a.push({ id: 101 + i * 2, session_id: SID, role: 'tool', content: '{"ok":true}', timestamp: now - 99 + i, tool_call_id: 'step' + i }); }
  return a;
}
function session(i) { return { id: i === 0 ? SID : 'qa_scroll_' + i, source: 'wizard-mobile', title: `QA slow scroll ${String(i).padStart(2, '0')} revision ${revision}`, status: 'running', archived: false, hidden: false, message_count: rows().length, started_at: now - 600, last_active: now - i + revision, wizard_last_user_at: now - 300, wizard_last_assistant_at: now - i + revision, wizard_activity_at: now - i + revision, wizard_run_id: 'qa-scroll-run', latest_message: { role: 'tool', content: 'Revision ' + revision, timestamp: now + revision }, last_user_message: { role: 'user', content: 'Read without replacing the scroller', timestamp: now - 300 } }; }
async function until(fn, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; }
(async () => {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), m = q.method();
      const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (m !== 'GET' && m !== 'HEAD') { writes.push({ method: m, path: u.pathname }); return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } }); }
      if (process.env.QA_LIVE !== '1' && u.pathname.startsWith('/wizard-os-home/')) {
        const f = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
        if (!f.includes('..')) { const fp = path.join(WEB, 'web', f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : undefined, body: fs.readFileSync(fp) }); }
      }
      if (u.pathname === '/wizard/hermes/api/sessions') {
        const off = +(u.searchParams.get('offset') || 0), all = Array.from({ length: 50 }, (_, i) => session(i)), lim = +(u.searchParams.get('limit') || 100), page = all.slice(off, off + lim);
        return json({ object: 'list', data: page, has_more: off + page.length < all.length, pagination: { limit: lim, offset: off, returned: page.length, has_more: off + page.length < all.length } });
      }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { messageReads++; const all = rows(), off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim); return json({ object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
      if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session(0) });
      if (u.pathname.includes('/v1/runs/qa-scroll-run')) return u.pathname.endsWith('/events') ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-scroll-run', status: 'running', session_id: SID });
      if (/\/wizard\/(thread-seen|thread-dispositions)/.test(u.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
      return r.continue();
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('wos.coached', 'true');
      window.__scrollTrace = { touchstart: 0, touchend: 0, touchcancel: 0, pointercancel: 0, scroll: 0, paints: 0 };
      for (const name of ['touchstart', 'touchend', 'touchcancel', 'pointercancel', 'scroll']) document.addEventListener(name, e => { if (e.target.closest?.('[data-chats]')) window.__scrollTrace[name]++; }, { capture: true, passive: true });
      const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      Object.defineProperty(Element.prototype, 'innerHTML', { get() { return d.get.call(this); }, set(v) { if (this.hasAttribute('data-chats')) window.__scrollTrace.paints++; return d.set.call(this, v); } });
    });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(ORIGIN + '?open=chats');
    await p.waitForSelector(`[data-chopen="${SID}"]`);
    await sleep(1300);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ id: 0, x, y }] });
    async function drag(sel, duration, name) {
      await p.evaluate(sel => { const e = document.querySelector(sel); e.scrollTop = sel === '.ch-msgs' ? 500 : 0; }, sel);
      await sleep(600);
      const pt = await p.evaluate(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(); window.__heldScroller = e; window.__dragBefore = { top: e.scrollTop, paints: __scrollTrace.paints, reads: 0 }; return { x: r.right - 16, y: r.top + Math.min(r.height - 80, 480), height: r.height, scrollHeight: e.scrollHeight, top: e.scrollTop }; }, sel);
      console.log('GEOMETRY', name, JSON.stringify(pt));
      const readsBefore = messageReads;
      await touch('touchStart', pt.x, pt.y);
      const count = Math.round(duration / 150); let firstMove = true;
      for (let i = 1; i <= count; i++) {
        await touch('touchMove', pt.x, pt.y - 30 - i * 1.4);
        if (firstMove) { firstMove = false; await sleep(80); }
        if (i % 16 === 0) { revision++; await p.evaluate(() => __wos.live.refresh()); }
        await sleep(150);
      }
      const during = await p.evaluate(sel => ({ attached: document.contains(__heldScroller), top: __heldScroller.scrollTop, currentTop: document.querySelector(sel).scrollTop, paints: __scrollTrace.paints - __dragBefore.paints, trace: __scrollTrace, before: __dragBefore.top }), sel);
      ok(Math.abs(during.currentTop - pt.top) > 30, name + ': real finger scroll changes scrollTop', during);
      ok(during.trace.pointercancel > 0, name + ': native scrolling produced pointercancel', during.trace);
      ok(during.attached && during.paints === 0, name + ': no subtree replacement throughout sustained touch', during);
      if (sel === '.ch-msgs') ok(messageReads > readsBefore + 1, name + ': messages continue loading while repaint held', { readsBefore, messageReads });
      await touch('touchEnd');
      const flushed = await until(() => p.evaluate(() => !document.contains(__heldScroller)), 3000);
      const expected = sel === '.ch-msgs' ? 'Scroll step ' + revision : 'revision ' + revision;
      // The last fixture revision may still be in the ordinary message polling window at lift.
      // Require both the queued paint's automatic flush and eventual inclusion of every new step.
      const latest = await until(() => p.evaluate(({ sel, expected }) => document.querySelector(sel).textContent.includes(expected), { sel, expected }), 6000);
      ok(flushed && latest, name + ': latest coalesced update automatically flushes after lift', { flushed, latest, revision });
      await p.screenshot({ path: path.join(OUT, name + '.png') });
    }
    await drag('.ch-scroll', 18000, 'list-slow-18s');
    // A fast real flick produces native scroll events after touchEnd. Paints must wait for
    // those events to settle, not merely for pointerup/touchend.
    await p.evaluate(() => { document.querySelector('.ch-scroll').scrollTop = 0; }); await sleep(600);
    const fb = await p.locator('.ch-scroll').boundingBox();
    await p.evaluate(() => {
      window.__inertiaNode = document.querySelector('.ch-scroll');
      window.__inertia = { ended: false, postEndScrolls: 0, violations: [], last: 0 };
      document.addEventListener('scroll', e => { if (e.target === __inertiaNode) { __inertia.last = performance.now(); if (__inertia.ended) __inertia.postEndScrolls++; } }, true);
      const observer = new MutationObserver(() => {
        if (__inertia.ended && !document.contains(__inertiaNode) && performance.now() - __inertia.last < 300) __inertia.violations.push(performance.now() - __inertia.last);
      }); observer.observe(__inertiaNode.closest('[data-chats]'), { childList: true });
    });
    await touch('touchStart', fb.x + fb.width - 16, fb.y + 480);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', fb.x + fb.width - 16, fb.y + 480 - i * 22); await sleep(12); }
    await touch('touchEnd'); await p.evaluate(() => { __inertia.ended = true; });
    revision++; await p.evaluate(() => __wos.live.refresh()); await sleep(1600);
    const inertia = await p.evaluate(() => __inertia);
    ok(inertia.postEndScrolls > 0, 'real flick produced post-lift native inertia', inertia);
    ok(inertia.violations.length === 0, 'no background subtree paint before native inertia settles', inertia);
    ok(await until(() => p.evaluate(() => !document.contains(__inertiaNode)), 3000), 'list pending update flushes after native inertia');
    // Search is an explicit action; updates must not delay it.
    await p.fill('[data-chsearch]', 'QA slow scroll 00');
    await sleep(500);
    ok(await p.locator(`[data-chopen="${SID}"]`).count() === 1, 'search still shows the exact fixture row');
    await p.fill('[data-chsearch]', '');
    await p.locator('[data-chsearch]').blur();
    await sleep(600);
    const row = p.locator(`[data-chopen="${SID}"]`); const rb = await row.boundingBox();
    await touch('touchStart', rb.x + 100, rb.y + rb.height / 2); await sleep(650); await touch('touchEnd');
    ok(await p.locator('.ch-sheet').count() === 1, 'real row long-press opens actions sheet');
    await p.keyboard.press('Escape'); await sleep(500);
    ok(await p.locator('.ch-sheet').count() === 0 && await p.locator('.ch-list').count() > 0, 'Back closes sheet without leaving list');
    await row.tap();
    await p.waitForSelector('.ch-msgs .msg.a .bub p'); await sleep(1000);
    await drag('.ch-msgs', 18000, 'thread-slow-18s');
    // Selection keeps the established two-minute cap; actual selection + updates, then clear.
    await p.evaluate(() => { const e = document.querySelector('.ch-msgs .msg.a .bub p'); window.__selected = e; const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); });
    revision++; await p.evaluate(() => __wos.live.refresh()); await sleep(4500);
    ok(await p.evaluate(() => document.contains(__selected) && String(getSelection()).length > 20), 'selection survives new steps');
    await p.evaluate(() => getSelection().removeAllRanges());
    ok(await until(() => p.evaluate(() => !document.contains(__selected)), 3000), 'clearing selection flushes pending steps');
    await p.evaluate(() => {
      const e = document.querySelector('.ch-msgs .msg.a .bub p'); window.__cappedSelection = e;
      const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r);
    }); await sleep(100);
    // Jump wall time, not event delivery: the established selection cap remains bounded.
    await p.evaluate(() => { window.__realNow = Date.now; Date.now = () => __realNow() + 121000; });
    revision++; await p.evaluate(() => __wos.live.refresh());
    ok(await until(() => p.evaluate(() => !document.contains(__cappedSelection)), 6000), 'forgotten selection expires at the retained two-minute cap');
    await p.evaluate(() => getSelection().removeAllRanges()); // keep the clock monotonic for subsequent cache reads
    // Cancellation and visibility recovery use real CDP touchCancel plus lifecycle events (not fake touch).
    await p.evaluate(() => { const e = document.querySelector('.ch-msgs'); e.scrollTop = 500; window.__cancelNode = e; }); await sleep(500);
    const mb = await p.locator('.ch-msgs').boundingBox();
    await touch('touchStart', mb.x + mb.width - 15, mb.y + 250);
    revision++; await p.evaluate(() => __wos.live.refresh()); await sleep(4500);
    await touch('touchCancel');
    ok(await until(() => p.evaluate(() => !document.contains(__cancelNode)), 3000), 'touchCancel releases ownership and flushes pending steps');
    await p.evaluate(() => { window.__visibilityNode = document.querySelector('.ch-msgs'); });
    await touch('touchStart', mb.x + mb.width - 15, mb.y + 250);
    revision++; await p.evaluate(() => __wos.live.refresh()); await sleep(4500);
    await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    ok(await until(() => p.evaluate(() => !document.contains(__visibilityNode)), 3000), 'visibility lifecycle recovers a missing touch end');
    await touch('touchEnd');
    await touch('touchStart', mb.x + mb.width - 15, mb.y + 250);
    revision++; await p.evaluate(() => __wos.live.refresh()); await sleep(4500);
    await p.goBack(); await sleep(1000);
    ok(await p.locator('.ch-list').count() > 0 && p.url().startsWith(ORIGIN), 'history Back during a held touch retains app and list');
    await touch('touchCancel'); // release the old route without a synthesized tap on the new list
    revision++; await p.evaluate(() => __wos.live.refresh());
    ok(await until(() => p.evaluate(rev => !!document.querySelector('.ch-list')?.textContent.includes('revision ' + rev), revision), 3000), 'navigation discards stale touch ownership; new list still updates');
    await p.keyboard.press('Escape'); await sleep(300);
    ok(p.url().startsWith(ORIGIN) && await p.locator('#device').count() > 0, 'root Back stays inside app');
    ok(errors.length === 0, 'zero page errors', errors);
    ok(await p.evaluate(() => !navigator.serviceWorker.controller), 'service worker cannot bypass write fence');
    console.log('FENCE locally fulfilled non-GET/HEAD requests', writes.length);
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ origin: ORIGIN, source: WEB, pass, fail, checks, errors, locallyFulfilledWrites: writes, messageReads, revision }, null, 2));
    console.log(`${pass} pass, ${fail} fail`);
  } catch (e) { console.error(e); fail++; } finally { if (b) await b.close(); }
  process.exitCode = fail ? 1 : 0;
})();
