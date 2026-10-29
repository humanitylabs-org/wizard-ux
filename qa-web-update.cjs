// QA: the "Update ready" banner is one shared component (core/web-update.js) in BOTH shells (James, 14 Oct:
// "reload on desktop should follow a similar UX to mobile, and link to the thread that's doing it").
// Desktop: top-bar pill names the thread, Thread opens it in a window, Threads ▾ list, Esc folds the list and
// the shell stays, Reload is held while recording, Reload swaps in the new version. Phone: same component.
// Usage: node tools/qa-origin.cjs 9391 <worktree>/web & node qa-web-update.cjs http://127.0.0.1:9391/wizard-os-home/
// Negative control: point it at an origin serving daily before this change; the desktop checks must FAIL.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:9391/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('wux-web-update-qa');
const EXEC = process.env.QA_CHROME || (process.env.QA_CHROME || undefined);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const V = n => (0xabc0000 + n).toString(16);
const S = { ver: 1, changes: null, writes: [] };

async function ctxFor(b, kind) {
  const opts = kind === 'phone'
    ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1512, height: 920 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
  const ctx = await b.newContext({ ...opts, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    if (/\/wizard-os-home\/ux-version\.txt/.test(u)) return r.fulfill({ status: 200, contentType: 'text/plain', body: V(S.ver) + '\n' });
    if (/\/wizard-os-home\/ux-changes\.json/.test(u)) return S.changes ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(S.changes) }) : r.fulfill({ status: 404, body: '' });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { S.writes.push(q.method() + ' ' + u.replace(/^https?:\/\/[^/]+/, '')); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.continue();
  });
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  return { ctx, p, errs };
}
const one = base => ({ v: 1, head: V(base + 1), updates: [
  { before: V(base), after: V(base + 1), at: Date.now() / 1000, changes: [{ sha: 'aaa1111', what: 'Drop the edge tabs', thread: 'qa_bound_views', title: 'Wizard OS · Bound views' }] },
  { before: V(base - 1), after: V(base), at: Date.now() / 1000 - 3600, changes: [{ sha: 'old0000', what: 'Older change', thread: 'qa_old', title: 'Wizard OS · Old thing' }] },
] });
const msgOf = p => p.locator('#dvWeb .dv-um').evaluate(e => [...e.children].map(x => x.textContent).join(' / ')).catch(() => '');

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  /* ---------- desktop ---------- */
  {
    S.ver = 10; S.changes = null;
    const { ctx, p, errs } = await ctxFor(b, 'desktop');
    await p.goto(BASE + '?shell=desktop', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wux && window.__wux.shell === 'desktop', null, { timeout: 30000 });
    await sleep(2500); // first check records the loaded version
    ok(await p.evaluate(() => !!window.WizWebUpdate), 'desktop loads the shared update banner (core/web-update.js)');
    ok(!(await p.locator('#dvWeb').isVisible().catch(() => false)), 'desktop: no banner while nothing changed');
    S.changes = one(S.ver); S.ver++;
    await p.evaluate(() => window.WizWebUpdate.check(true)); await sleep(800);
    ok(await p.locator('#dvWeb').isVisible().catch(() => false), 'desktop: a deploy raises the banner');
    const msg = await msgOf(p);
    ok(msg === 'Update ready / Bound views', 'desktop: banner names the thread the update came from', msg);
    ok(await p.locator('#dvWeb .dv-wtop button').evaluateAll(bs => bs.map(x => x.textContent).join('|')).catch(() => '') === 'Thread|Reload', 'desktop: Thread then Reload');
    const box = await p.locator('#dvWeb').boundingBox().catch(() => null);
    ok(box && box.y >= 0 && box.y + box.height <= 34 && box.x > 1512 / 2 && await p.locator('#bar .bar-r #dvWeb').count() === 1, 'desktop: a one-line pill in the top bar (covers no window)', JSON.stringify(box));
    await p.screenshot({ path: OUT + '/desktop-one.png' });
    await p.locator('#dvWeb [data-web-thread="qa_bound_views"]').click(); await sleep(800);
    ok(await p.evaluate(() => Object.values(window.__wux.wins).some(w => w.app === 'chats' && w.thread === 'qa_bound_views')), 'desktop: Thread opens that thread in a Chats window');
    ok(await p.locator('#dvWeb').isVisible(), 'desktop: banner stays up after opening the thread');
    // Second deploy joins; several threads → Threads ▾ list.
    S.changes.updates.unshift({ before: V(S.ver), after: V(S.ver + 1), at: Date.now() / 1000, changes: [
      { sha: 'bbb2222', what: 'Selection menu drags out of the way', thread: 'qa_selmenu', title: 'Wizard OS · Selection menu drag' },
      { sha: 'ccc3333', what: 'Tidy whitespace', thread: null, title: null }] });
    S.ver++;
    await p.evaluate(() => window.WizWebUpdate.check(true)); await sleep(800);
    ok(await msgOf(p) === 'Update ready / Selection menu drag', 'desktop: a second deploy joins the banner, newest first');
    await p.locator('#dvWeb [data-web="list"]').click(); await sleep(300);
    const rows = await p.locator('#dvWeb .dv-wr b').allTextContents();
    ok(rows.join('|') === 'Selection menu drag|Tidy whitespace|Bound views', 'desktop: Threads list, each thread once', rows.join('|'));
    await p.screenshot({ path: OUT + '/desktop-list.png' });
    await p.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
    await p.keyboard.press('Escape'); await sleep(300);
    ok(await p.locator('#dvWeb .dv-wl').count() === 0 && await p.locator('#dvWeb').isVisible() && await p.evaluate(() => window.__wux.shell === 'desktop'), 'desktop: Esc folds the list, banner and shell stay');
    await p.locator('#dvWeb [data-web="list"]').click(); await sleep(300);
    await p.locator('#dvWeb [data-web-thread="qa_selmenu"]').click(); await sleep(800);
    ok(await p.evaluate(() => Object.values(window.__wux.wins).some(w => w.app === 'chats' && w.thread === 'qa_selmenu')), 'desktop: a row in the list opens its thread');
    // Held while recording.
    await p.evaluate(() => window.__wux.talk()); await sleep(900);
    const rec = await p.evaluate(() => window.__wux.voice);
    await p.locator('#dvWeb [data-web="go"]').click(); await sleep(600);
    ok(rec !== 'idle' && await p.evaluate(() => !window.__wosReloading), 'desktop: Reload is held while recording', rec);
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => { try { window.__wux.talk(); } catch (_) {} });
    for (let i = 0; i < 20 && await p.evaluate(() => window.__wux.voice) !== 'idle'; i++) { await p.evaluate(() => document.querySelector('[data-voice-cancel],[data-act="cancel"],.vc-cancel')?.click()); await sleep(300); }
    const idle = await p.evaluate(() => window.__wux.voice === 'idle');
    if (idle) {
      await p.locator('#dvWeb [data-web="go"]').click();
      await p.waitForFunction(() => window.__wux && window.__wux.shell === 'desktop' && !window.__wosReloading, null, { timeout: 30000 }).catch(() => {});
      await sleep(2500);
      ok(await p.evaluate(() => !document.querySelector('#dvWeb') && window.__wux.shell === 'desktop'), 'desktop: Reload swaps in the new version, banner gone');
    } else ok(false, 'desktop: could not stop the test recording to try Reload');
    ok(!errs.length, 'desktop: no page errors', errs.join(' | '));
    await ctx.close();
  }

  /* ---------- phone: same component ---------- */
  {
    S.ver = 50; S.changes = null;
    const { ctx, p, errs } = await ctxFor(b, 'phone');
    await p.goto(BASE + '?shell=phone', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 30000 });
    await sleep(2500);
    S.changes = one(S.ver); S.ver++;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(800);
    ok(await msgOf(p) === 'Update ready / Bound views', 'phone: same banner text');
    const box = await p.locator('#dvWeb').boundingBox().catch(() => null);
    ok(box && box.y < 120 && box.width > 360, 'phone: strip under the status bar', JSON.stringify(box));
    await p.screenshot({ path: OUT + '/phone-one.png' });
    await p.locator('#dvWeb [data-web-thread]').click(); await sleep(800);
    ok(await p.evaluate(() => Object.values(window.__wos.wins).some(w => w.app === 'chats' && w.thread === 'qa_bound_views')), 'phone: Thread opens the thread');
    ok(!errs.length, 'phone: no page errors', errs.join(' | '));
    await ctx.close();
  }
  ok(!S.writes.some(w => /\/v1\/runs|\/messages/.test(w)), 'nothing was sent to the agent', S.writes.join(', '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
