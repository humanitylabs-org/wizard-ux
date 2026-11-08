'use strict';
// Offline synthetic shell proof. Execute only through the forum light queue.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');
const F = require('./tools/qa-closed-shell.cjs');
const OUT = process.env.QA_OUT; assert(OUT); fs.mkdirSync(OUT, { recursive: true });
const results = [], captures = [];
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.QA_CHROME, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }); F.setBrowser(browser);
 try {
  for (const phone of [true, false]) for (const after of ['stay', 'list']) {
   for (const action of ['archive', 'snooze', 'unread', 'typed', 'voice']) {
    const { c } = await F.boot(phone, null, null, { after }); const p = F.getPage();
    try {
     const id = await p.evaluate(phone => {
      if (phone) {
       __wos.goDesk(1); const wid = __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats');
       __wos.openChat(wid, 'badge-read-ready'); return wid;
      }
      __wux.openThread('badge-read-ready'); return Object.values(__wux.wins).find(w => w.app === 'chats' && w.thread === 'badge-read-ready').id;
     }, phone);
     const root = p.locator(`[data-chats="${id}"]`);
     await root.locator('.ch-msgs .msg.a').waitFor();
     if (action === 'archive') await root.locator('[data-chact="done"]').first()[phone ? 'tap' : 'click']();
     if (action === 'snooze') { await root.locator('[data-chact="snooze"]').first()[phone ? 'tap' : 'click'](); await p.locator('[data-boom-someday]')[phone ? 'tap' : 'click'](); await p.locator('.boom-sheet').waitFor({ state: 'detached' }); }
     if (action === 'unread') await p.evaluate(({ phone, id }) => (phone ? __wos.chats : __wux.chats).threadAct(id, 'badge-read-ready', 'unread'), { phone, id });
     if (action === 'typed') { await root.locator('.ch-compose textarea').fill('Synthetic phone action reply'); await root.locator('.ch-send')[phone ? 'tap' : 'click'](); }
     if (action === 'voice') await p.evaluate(({ phone, id }) => (phone ? __wos.chats : __wux.chats).sendVoiceTo(id, 'badge-read-ready', new Blob([new Uint8Array(4000)], { type: 'audio/webm' })), { phone, id });
     // Archive (James, 7 Nov 2026): the phone returns to the chats list; desktop opens the next chat in the list.
     let expected = phone && after === 'list' ? null : 'badge-read-ready';
     if (action === 'archive' && phone) expected = null;
     if (action === 'archive' && !phone) {
      await p.waitForFunction(({ id }) => (__wux.wins[id]?.thread ?? null) !== 'badge-read-ready', { id });
      expected = await p.evaluate(({ id }) => __wux.wins[id]?.thread ?? null, { id });
      assert(expected !== 'badge-read-ready', 'desktop archive opens the next chat or the list, never stays: ' + expected);
     }
     await p.waitForFunction(({ phone, id, expected }) => ((phone ? __wos : __wux).wins[id]?.thread ?? null) === expected, { phone, id, expected });
     if (action === 'unread' && expected) assert(await p.evaluate(() => WizLive.isNew(WizLive.session('badge-read-ready'))), 'explicit unread survives its synchronous repaint');
     if (action === 'archive') assert(await p.evaluate(() => WizLive.session('badge-read-ready').archived), 'archive changed record state');
     if (action === 'snooze') assert(await p.evaluate(() => WizLive.session('badge-read-ready').deferred), 'snooze changed record state');
     await p.waitForTimeout(500);
     assert.equal(await p.evaluate(({ phone, id }) => (phone ? __wos : __wux).wins[id]?.thread ?? null, { phone, id }), expected, 'late state update cannot jump elsewhere');
     results.push({ phone, after, action, expected, passed: true }); console.log('PASS', JSON.stringify(results.at(-1)));
    } finally { await c.close(); }
   }
   const { c, s } = await F.boot(phone, null, null, { after }); const p = F.getPage();
   try {
    await p.evaluate(phone => (phone ? __wos : __wux).openSettings('chat-after-action'), phone);
    await p.locator('[data-chat-after="stay"]').waitFor();
    for (const skin of ['nebula', 'sepia']) {
     await p.evaluate(skin => WosSkin.set(skin), skin); await F.settle(p);
     await p.locator(`[data-chat-after="${after}"]`).scrollIntoViewIfNeeded();
     assert.equal(await p.locator(`[data-chat-after="${after}"]`).getAttribute('aria-checked'), 'true');
     const name = `${phone ? 'phone' : 'desktop'}-${after}-${skin}.png`, file = path.join(OUT, name);
     const box = await p.locator('[role="radiogroup"][aria-label="After actions on your phone"]').boundingBox();
     assert(box && box.width > 100 && box.x >= 0, 'setting visible inside shell');
     await p.screenshot({ path: file });
     captures.push({ file, phone, after, skin, box, shell: await p.locator('html').getAttribute('data-shell') });
    }
    // Actual control and confirmed owner preference, not only a preseeded value.
    const next = after === 'stay' ? 'list' : 'stay'; await p.locator(`[data-chat-after="${next}"]`)[phone ? 'tap' : 'click']();
    await p.waitForFunction(next => WizConfig.chatAfterAction() === next && !document.querySelector('[data-chat-after][disabled]'), next);
    assert.equal(s.preferences.chatAfterAction, next);
    assert.equal(await p.locator(`[data-chat-after="${next}"]`).getAttribute('aria-checked'), 'true');
   } finally { await c.close(); }
  }
  assert.equal(F.report.errors.length, 0, JSON.stringify(F.report.errors));
  assert.equal(F.report.unknown.length, 0, JSON.stringify(F.report.unknown));
  assert.equal(results.length, 20); assert.equal(captures.length, 8);
 } finally {
  fs.writeFileSync(path.join(OUT, 'phone-chat-action-receipt.json'), JSON.stringify({ results, captures, fixture: F.report }, null, 2));
  await browser.close();
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
