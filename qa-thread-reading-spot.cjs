// One thread place through every return route, plus bottom following. No live writes.
// [DOC=1] node qa-thread-reading-spot.cjs <origin>
const assert = require('node:assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const { context, DOC } = require('./tools/qa-thread-place.cjs');
const ORIGIN = process.argv[2], SID = 'qa_thread_reading_spot';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext(context);
  const page = await ctx.newPage(), checks = [], errors = [];
  let revision = 0, expanded = false;
  const now = Date.now() / 1000;
  const rows = () => Array.from({ length: 180 + revision * 2 }, (_, i) => ({ id: i + 1, session_id: SID, role: i % 2 ? 'assistant' : 'user', content: (expanded && i === 175 ? 'A layout change below the reader. '.repeat(150) : '') + `Row ${i}. ` + 'A stable reading line with enough words to wrap on a phone. '.repeat(12), timestamp: now - 1000 + i }));
  const session = () => ({ id: SID, source: 'wizard-mobile', title: 'QA thread reading spot', status: 'completed', archived: false, hidden: false, message_count: rows().length, started_at: now - 1000, last_active: now + revision, wizard_last_user_at: now - 10, wizard_last_assistant_at: now - 9 + revision, latest_message: rows().at(-1), last_user_message: rows().at(-2) });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const q = r.request(), u = new URL(q.url()), json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (!['GET', 'HEAD'].includes(q.method())) return json({ ok: true });
    if (u.pathname === '/wizard/hermes/api/sessions') return json({ object: 'list', data: [session()], has_more: false, pagination: { returned: 1, has_more: false } });
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) return json({ object: 'list', data: rows(), pagination: { returned: rows().length } });
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session() });
    return r.continue();
  });
  await page.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (_) {} });
  const evaluate = (action, extra) => page.evaluate(({ sid, action, extra }) => {
    const w = Object.values(__wos.wins).find(w => w.app === 'chats' && w.thread === sid);
    const n = w && document.querySelector(`[data-chats="${w.id}"] .ch-msgs`);
    const doc = n?.closest('.wos-doc-thread'), sc = doc ? document.scrollingElement : n;
    const top = n && (doc ? n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom : n.getBoundingClientRect().top);
    if (action === 'desk') return __wos.desks.find(d => d.wins.includes(w.id)).id;
    if (action === 'park') { n.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); sc.scrollTop = extra === 'bottom' ? sc.scrollHeight : sc.scrollHeight * .42; (doc ? document : n).dispatchEvent(new Event('scroll')); n.dispatchEvent(new TouchEvent('touchend', { bubbles: true })); return; }
    if (action === 'stray') { n.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('wos:boomerang')); return; }
    if (action === 'bump') { const s = __wos.live.session(sid); s.messageCount += 2; s.lastAssistantAt = new Date().toISOString(); return; }
    if (action === 'resize') { const form = n.closest('.ch-thread').querySelector('textarea'); form.value = 'Composer line\n'.repeat(4); form.dispatchEvent(new Event('input', { bubbles: true })); window.dispatchEvent(new Event('resize')); return; }
    if (!n) return null;
    const seen = {}; let anchor = null;
    for (const e of n.querySelectorAll('[data-morph-key]')) { const key = e.dataset.morphKey, nth = seen[key] || 0; seen[key] = nth + 1; const r = e.getBoundingClientRect(); if (r.height && r.bottom > top + 1) { anchor = { key, nth, off: r.top - top }; break; } }
    return { anchor, top: sc.scrollTop, gap: sc.scrollHeight - sc.scrollTop - sc.clientHeight, doc: !!doc, count: n.querySelectorAll('.msg').length, lastKey: [...n.querySelectorAll('[data-morph-key]')].at(-1)?.dataset.morphKey, place: JSON.parse(localStorage.getItem('wizard.mobile.reading-positions.v1') || '{}')[sid] };
  }, { sid: SID, action, extra });
  const open = async () => { await page.evaluate(id => __wos.openWizardThread(id), SID); await page.waitForFunction(id => [...document.querySelectorAll('[data-chats]')].some(el => __wos.wins[el.dataset.chats]?.thread === id && el.querySelectorAll('.msg.a').length > 10), SID); await sleep(3400); };
  const check = (name, before, after) => { const ok = !!before?.anchor && before.anchor.key === after?.anchor?.key && before.anchor.nth === after.anchor.nth && Math.abs(before.anchor.off - after.anchor.off) <= 4 && after.doc === DOC; checks.push({ name, ok, before, after }); console.log(name, JSON.stringify({ ok, before, after })); };
  try {
    await page.goto(ORIGIN); await page.waitForFunction(() => window.__wos?.live?.ok); await open();
    for (const route of ['reopen', 'reload', 'reload-layout-change', 'other-app-back', 'home', 'other-screen', 'home-app-desk', 'home-app-row', 'live-update']) {
      await evaluate('park'); await sleep(400);
      const before = await evaluate('read'), desk = await evaluate('desk');
      const goThread = () => page.evaluate(id => __wos.goDesk(__wos.desks.findIndex(d => d.id === id)), desk);
      if (route === 'reopen') { await page.keyboard.press('Escape'); await sleep(400); await open(); }
      if (route.startsWith('reload')) { if (route === 'reload-layout-change') expanded = true; await page.reload(); await page.waitForFunction(() => window.__wos?.live?.ok); await open(); }
      if (route === 'other-app-back') { assert.equal(await page.evaluate(() => WizOpenApp('messenger')), true); await sleep(600); await evaluate('stray'); await page.evaluate(() => __wos.onBack()); await sleep(600); await goThread(); }
      if (route === 'home') { await page.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(600); await evaluate('stray'); await goThread(); }
      if (route === 'other-screen') { await page.keyboard.press('Escape'); await sleep(600); await open(); }
      if (route.startsWith('home-app')) { await page.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(400); assert.equal(await page.evaluate(() => WizOpenApp('wizard-claude')), true); await sleep(600); await page.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(600); await evaluate('stray'); await sleep(600); if (route.endsWith('row')) await open(); else await goThread(); }
      if (route === 'live-update') { revision++; await evaluate('bump'); await sleep(6000); }
      await sleep(3400); check(route, before, await evaluate('read'));
    }
    await evaluate('park', 'bottom'); await sleep(800); const bottomBefore = await evaluate('read');
    revision++; await evaluate('bump');
    await page.waitForFunction(({ sid, lastKey }) => { const w = Object.values(__wos.wins).find(w => w.thread === sid); return [...document.querySelectorAll(`[data-chats="${w.id}"] .ch-msgs [data-morph-key]`)].at(-1)?.dataset.morphKey !== lastKey; }, { sid: SID, lastKey: bottomBefore.lastKey }, { timeout: 20000 });
    await sleep(1600); const bottomAfter = await evaluate('read');
    const ok = bottomBefore.gap < 2 && bottomAfter.gap < 2 && bottomAfter.doc === DOC;
    checks.push({ name: 'at-bottom-live-update', ok }); console.log('at-bottom-live-update', JSON.stringify({ ok, before: bottomBefore, after: bottomAfter }));
    await evaluate('resize'); await sleep(1400); const resized = await evaluate('read'); checks.push({ name: 'at-bottom-composer-resize', ok: resized.gap < 2 });
    assert.deepEqual(errors, []); assert.ok(checks.every(c => c.ok), 'every return route and bottom update must preserve the place');
  } finally { console.log(JSON.stringify({ doc: DOC, ok: checks.length === 11 && checks.every(c => c.ok), checks: checks.map(({ name, ok }) => ({ name, ok })), errors })); await page.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
