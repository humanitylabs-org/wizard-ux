// QA: New chat always opens a brand-new, blank chat (James, 20 Oct 2026: "New chat should always go to a brand new
// chat. It should never go to some existing thread that's trying to get sent").
//  1 phone: send a new chat that cannot be delivered (writes refused, so it stays unsent on the phone)
//  2 tap New chat again: the composer is blank and the unsent message is NOT in it
//  3 the unsent message is still reachable from the Chats list's send pill
//  4 a message sent from THIS open of New chat (orb-style, same window) still shows here
//  5 Back from New chat returns to the list and the app stays open
// Every non-GET request is refused by qa-origin; nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9381 <worktree>/web (background), then node qa-new-chat-blank.cjs [url]
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || (process.env.TMPDIR || '/tmp') + '/qa-new-chat-blank';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(x).slice(0, 400)); } };
const STALE = 'QA stale unsent new chat about humanity branding';
(async () => {
  const br = await chromium.launch({ executablePath: process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome' });
  const ctx = await br.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => { if (!/localStorage/.test(e.message)) errs.push(e.message); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_ + '?open=chats'); await p.waitForTimeout(3500);
  const wid = await p.evaluate(() => document.querySelector('[data-chats]')?.dataset.chats || '');
  ok(!!wid, 'phone: Chats window open', wid);
  const thread = () => p.evaluate(id => window.__wos?.wins?.[id]?.thread ?? null, wid);
  const pendingTexts = () => p.evaluate(id => [...document.querySelectorAll(`[data-chats="${id}"] .msg.u.pending`)].map(e => e.textContent), wid);

  // 1. A new chat that stays unsent on the phone.
  await p.tap('[data-chfab]'); await p.waitForTimeout(700);
  ok((await thread()) === '__new__', 'tap New chat opens a new chat', await thread());
  const ta = p.locator(`[data-chats="${wid}"] .ch-compose textarea`).first();
  await ta.tap(); await ta.fill(STALE); await p.waitForTimeout(150);
  await p.locator(`[data-chats="${wid}"] button.ch-send`).first().tap();
  await p.waitForTimeout(2500);
  ok((await thread()) === null, 'send leaves to the Chats list', await thread());
  const unsent = await p.evaluate(t => (window.WosOutbox?.unsent() || []).filter(it => it.kind === 'new' && (it.text || '').includes(t)).map(it => ({ state: it.state, wid: it.wid })), STALE);
  ok(unsent.length === 1, 'the new chat is still unsent on the phone (writes refused)', unsent);
  await p.screenshot({ path: OUT + '/1-list-with-unsent.png' });

  // 2. New chat again: brand new and blank.
  await p.tap('[data-chfab]'); await p.waitForTimeout(900);
  ok((await thread()) === '__new__', 'second New chat tap opens a new chat', await thread());
  const pend = await pendingTexts();
  ok(!pend.some(t => t.includes(STALE)), 'the unsent message does NOT appear in the new chat', pend);
  ok(pend.length === 0, 'the new chat shows no pending messages at all', pend);
  ok(await p.locator(`[data-chats="${wid}"] .ch-empty.nc-classic, [data-chats="${wid}"] .nc-key, [data-chats="${wid}"] .nc-tip`).count() > 0, 'the blank new-chat hint is showing');
  ok((await ta.inputValue()) === '', 'the composer is empty', await ta.inputValue());
  await p.screenshot({ path: OUT + '/2-new-chat-blank.png' });

  // 4. A send made from THIS open (orb-style, same window) still shows in it.
  await p.evaluate(id => window.WosOutbox.enqueue({ kind: 'new', text: 'QA sent from this open', wid: id, source: 'orb' }), wid);
  await p.waitForTimeout(900);
  const pend2 = await pendingTexts();
  ok(pend2.some(t => t.includes('QA sent from this open')) && !pend2.some(t => t.includes(STALE)), 'a send from this open shows here; the old one still does not', pend2);

  // 5. Back returns to the list; the app stays open; the stale message is reachable from the send pill.
  await p.goBack().catch(() => {}); await p.waitForTimeout(900);
  ok((await thread()) === null && await p.evaluate(() => !!window.__wos && document.visibilityState === 'visible'), 'Back returns to the list and the app stays open', await thread());
  ok(await p.locator(`[data-chats="${wid}"] [data-sendpill]`).count() > 0, 'unsent messages are still reachable from the Chats send pill');
  await p.screenshot({ path: OUT + '/3-list-pill.png' });

  // A reopen after a reload: old unsent new-chat messages stay out of a restored New chat too.
  await p.tap('[data-chfab]'); await p.waitForTimeout(600);
  await p.reload(); await p.waitForTimeout(3500);
  const wid2 = await p.evaluate(() => document.querySelector('[data-chats]')?.dataset.chats || '');
  const restored = await p.evaluate(id => window.__wos?.wins?.[id]?.thread ?? null, wid2);
  if (restored === '__new__') {
    const pend3 = await p.evaluate(id => [...document.querySelectorAll(`[data-chats="${id}"] .msg.u.pending`)].map(e => e.textContent), wid2);
    ok(pend3.length === 0, 'restored New chat after reload is blank', pend3);
  } else console.log('INFO reload restored', restored, '(New chat not restored; skipped)');

  ok(errs.length === 0, 'no page errors', errs);
  await br.close();
  console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
