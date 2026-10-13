// QA: Home cards (James, 11 Oct 2026). Yesterday opens beside Home like any app (even when an old review desk
// sits far down the strip); Unread and Working open the Chats window filtered to just those threads; Back clears
// the filter and lands back on Home; the example-phrase chips are gone from Home and empty desks.
// Usage: node qa-home-cards.cjs [origin=http://127.0.0.1:9431/wizard-os-home/]   (every write is intercepted)
let pw; try { pw = require('/home/developer/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9431/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/developer/.hermes/cache/scratch/home-cards';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0, runs = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (/\/v1\/runs|\/api\/sessions/.test(u.pathname) && q.method() === 'POST') runs++;
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && u.origin === ORIGIN) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} });
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 });
  await p.waitForFunction(() => window.WizLive && window.WizLive.ok, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const S = () => p.evaluate(() => ({ idx: __wos.idx, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].app).join('+')) }));
  const home = async () => { await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(700); };
  const tapCard = async act => { await p.locator(`.home-desk [data-act="${act}"]`).tap(); await p.waitForTimeout(900); };
  const pressBack = async () => { await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(700); };

  await home();
  ok(await p.locator('.home-desk .say, .home-desk .hint-row').count() === 0, 'Home: no example-phrase chips');
  ok(await p.locator('.empty-desk .say').count() === 0, 'empty desks: no example-phrase chips');
  await p.screenshot({ path: `${SHOTS}/01-home.png` });

  // Park a review desk far down the strip, as the bug had it (third desk and beyond).
  await p.evaluate(() => { __wos.goDesk(1, true); __wos.openWin({ app: 'frame', appId: 'link', url: '/wizard-os-home/', title: 'Filler' }); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { __wos.goDesk(__wos.desks.length - 1, true); __wos.openWin({ app: 'review', z: { level: 'day', day: '2026-10-10' } }); });
  await p.waitForTimeout(800);
  let s = await S(); const farAt = s.names.indexOf('review');
  ok(farAt >= 3, 'setup: an old review desk sits far down the strip', JSON.stringify(s));
  const reviews0 = s.names.filter(n => n === 'review').length;
  await home(); await tapCard('yesterday');
  s = await S();
  const chatsAt = s.names.findIndex(n => /chats/.test(n));
  ok(s.names[s.idx] === 'review' && s.idx === 1, 'Yesterday: opens on the desk directly next to Home (desk 2), like any app', JSON.stringify(s));
  ok(s.names.filter(n => n === 'review').length === reviews0, 'Yesterday: existing review desk moved, not duplicated', JSON.stringify(s));
  await p.screenshot({ path: `${SHOTS}/02-yesterday.png` });

  // Fresh strip: no review desk yet → still beside.
  await p.evaluate(() => { for (const id of Object.keys(__wos.wins)) if (__wos.wins[id].app === 'review') __wos.closeWin(id); });
  await home(); await tapCard('yesterday'); s = await S();
  ok(s.names[s.idx] === 'review' && s.idx === 1, 'Yesterday (no review open): new desk directly next to Home', JSON.stringify(s));

  // Unread card → Chats with an Unread chip in the search field.
  const L = () => p.evaluate(() => { const w = __wos.wins[__wos.desks[__wos.idx].focus]; const el = document.querySelector(`[data-chats="${w.id}"]`);
    return { app: w.app, chips: el ? [...el.querySelectorAll('.ch-search .ch-chip')].map(c => c.textContent.replace('✕', '').trim()) : [], rows: el ? el.querySelectorAll('.ch-scroll .ch-row').length : -1,
      count: el?.querySelector('.ch-count')?.textContent || '', empty: !!el?.querySelector('.ch-empty'), secs: el ? el.querySelectorAll('.ch-sec[data-sec]').length : -1, newBtn: el ? el.querySelectorAll('.ch-top [data-chnew]').length : -1,
      fbtn: !!el?.querySelector('.ch-search [data-chfbtn]'), oldBar: !!el?.querySelector('.ch-filter') }; });
  await home();
  const homeN = await p.evaluate(() => Number(document.querySelector('.home-desk [data-act="unread"] .n')?.textContent || -1));
  await tapCard('unread'); let f = await L();
  ok(f.app === 'chats' && f.chips.join() === 'Unread', 'Unread: opens Chats with an "Unread" chip inside the search field', JSON.stringify(f));
  ok(!f.oldBar && f.fbtn, 'Unread: no separate "All chats" bar; filter button sits in the search field', JSON.stringify(f));
  ok(f.rows === homeN || (homeN === 0 && f.empty), 'Unread: list count matches the Home card', `home ${homeN} list ${f.rows}`);
  ok(/Tap ✕ to see all chats/.test(f.count), 'Unread: first time, one coach line says how to see all chats', f.count);
  ok(f.newBtn === 0, 'no New chat "+" up top', JSON.stringify(f));
  await p.screenshot({ path: `${SHOTS}/03-unread.png` });
  await pressBack(); s = await S(); f = await L().catch(() => ({}));
  ok(s.idx === 0, 'Unread: Back takes the chip off and returns to Home', JSON.stringify(s));
  ok(await p.evaluate(() => !document.querySelector('.ch-chip')), 'Unread: chip gone after Back');
  ok(await p.evaluate(() => !!document.querySelector('.device') && document.visibilityState === 'visible'), 'Back: app still open');

  // Working card → Working chip; its ✕ clears.
  const workN = await p.evaluate(() => Number(document.querySelector('.home-desk [data-act="working"] .n')?.textContent || -1));
  await tapCard('working'); let g = await L();
  ok(g.app === 'chats' && g.chips.join() === 'Working', 'Working: opens Chats with a "Working" chip', JSON.stringify(g));
  ok(g.rows === workN || (workN === 0 && g.rows === 0), 'Working: list count matches the Home card', `home ${workN} list ${g.rows}`);
  ok(!/Tap ✕/.test(g.count), 'coach line shows only the first time', g.count);
  await p.screenshot({ path: `${SHOTS}/04-working.png` });
  await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chchipx]`).click()); await p.waitForTimeout(400);
  g = await L(); ok(g.chips.length === 0 && g.secs > 0, 'Working: ✕ on the chip shows every chat again', JSON.stringify(g));

  // A Home card's chip never lingers after leaving the Chats desk.
  await home(); await tapCard('unread'); await home();
  ok(await p.evaluate(() => !document.querySelector('.ch-chip')), 'card chip does not linger after swiping away');

  // Filter button → sheet → pick Needs you; chip appears; Back closes the sheet first.
  await home(); await tapCard('unread'); await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chchipx]`).click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chfbtn]`).click()); await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => { const el = document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"]`); return { open: !!el.querySelector('.ch-fsheet'), opts: [...el.querySelectorAll('.ch-fopt')].map(b => b.textContent.trim()) }; });
  ok(sheet.open && ['Unread', 'Needs you', 'Check', 'Working'].every(x => sheet.opts.some(o => o.startsWith(x))), 'Filter button opens a sheet with Unread / Needs you / Check / Working (+ subjects)', JSON.stringify(sheet));
  await p.screenshot({ path: `${SHOTS}/05-filter-sheet.png` });
  await pressBack(); ok(await p.evaluate(() => !document.querySelector('.ch-fsheet')), 'Back closes the filter sheet first');
  await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chfbtn]`).click()); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll(`[data-chats="${__wos.desks[__wos.idx].focus}"] .ch-fopt`)].find(b => b.textContent.startsWith('Needs you')).click()); await p.waitForTimeout(400);
  f = await L(); ok(f.chips.join() === 'Needs you' && /chats?/.test(f.count), 'Sheet: picking Needs you puts a chip in the field with a count', JSON.stringify(f));
  // Subject chip combines with status
  await pressBack(); f = await L(); ok(f.chips.length === 0, 'Back takes a picked chip off (stays on Chats)', JSON.stringify(f));

  // Typing "unr" suggests "Filter: Unread"; tapping it makes the chip and clears the text.
  const inp = `[data-chats="${await p.evaluate(() => __wos.desks[__wos.idx].focus)}"] [data-chsearch]`;
  await p.locator(inp).tap(); await p.locator(inp).type('unr', { delay: 40 }); await p.waitForTimeout(500);
  const sug = await p.evaluate(() => [...document.querySelectorAll(`[data-chats="${__wos.desks[__wos.idx].focus}"] .ch-sugrow`)].map(b => b.lastElementChild.textContent.trim()));
  ok(sug[0] === 'Filter: Unread' && sug.some(x => /^New chat/.test(x)), 'Typing "unr" suggests Filter: Unread first, New chat last', JSON.stringify(sug));
  await p.screenshot({ path: `${SHOTS}/06-suggest.png` });
  await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chsug]`).click()); await p.waitForTimeout(400);
  f = await L(); ok(f.chips.join() === 'Unread' && (await p.locator(inp).inputValue()) === '', 'Tapping the suggestion makes the chip and clears the typed word', JSON.stringify(f));
  await p.evaluate(() => document.querySelector(`[data-chats="${__wos.desks[__wos.idx].focus}"] [data-chchipx]`).click()); await p.waitForTimeout(300);

  // Held orb on the Chats list: "filter by working" / "search budget" / "clear filters".
  const cmd = async t => { await p.evaluate(t => __wos.handleText(t, 'command', false, 300, null), t); await p.waitForTimeout(900); return L(); };
  f = await cmd('Filter by working.'); ok(f.chips.join() === 'Working', 'Voice: "filter by working" → Working chip', JSON.stringify(f));
  f = await cmd('Show me only unread'); ok(f.chips.join() === 'Unread', 'Voice: "show me only unread" → Unread chip', JSON.stringify(f));
  f = await cmd('Clear filters'); ok(f.chips.length === 0, 'Voice: "clear filters" → all chats', JSON.stringify(f));
  f = await cmd('Search budget'); ok((await p.locator(inp).inputValue()) === 'budget', 'Voice: "search budget" types into the search field', await p.locator(inp).inputValue());
  f = await cmd('Filter by zebra crossing'); ok((await p.locator(inp).inputValue()) === 'zebra crossing' && f.chips.length === 0, 'Voice: "filter by <no match>" falls back to a search', JSON.stringify(f));
  await pressBack(); ok((await p.locator(inp).inputValue()) === '', 'Back clears search text first');
  ok(runs === 0, 'no agent runs from any filter command', String(runs));

  ok(!errs.length, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
