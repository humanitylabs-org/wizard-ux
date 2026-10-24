// E2E: real Wizard shell (candidate) + a /messenger/ fixture app speaking WizardApp.share.receive.
// node share-sheet-e2e.cjs <outDir> [base=http://127.0.0.1:9561/wizard-os-home/]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
// Usage: node qa-share-sheet.cjs <outDir> <base, e.g. http://127.0.0.1:<preview port>/wizard-os-home/>
const OUT = process.argv[2], BASE = process.argv[3];
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Messenger fixture</title>
<script src="/wizard-os-home/core/app-client.js"></script></head><body style="background:#111;color:#eee;font:16px system-ui">
<h1>Messenger fixture</h1><p id="to">no share yet</p><textarea id="draft" rows="4" cols="40"></textarea>
<script>
  window.__got = [];
  WizardApp.ready({ name: 'messenger' }).then(() => {
    WizardApp.share.receive({ accepts: ['text', 'url'],
      targets: [{ id: 'p-miguel', name: 'Miguel', detail: 'Wizard' }, { id: 'p-novaire', name: 'Novaire', detail: 'Telegram' }, { id: 'g-team', name: 'AI Wizards team', detail: 'Group' }],
      receive: item => { window.__got.push(item); document.getElementById('to').textContent = 'to: ' + (item.target || '(pick)'); document.getElementById('draft').value = item.text; return true; } });
  });
</script></body></html>`;
const results = [];
const step = (name, ok, extra = '') => { results.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Bangkok',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  await ctx.route('**/*', route => {
    const r = route.request(), u = new URL(r.url());
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return route.fulfill({ status: 403, body: '{}' });
    if (u.pathname === '/messenger/' || u.pathname === '/messenger/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
    if (u.pathname.startsWith('/messenger/')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {}
    // Stand-in for the Android bridge: record what would reach the system tray.
    window.__native = [];
    window.WizardOSNative = new Proxy({}, { get: (_, k) => k === 'shareText' ? ((t, title) => { window.__native.push({ t, title }); return 'shared'; }) : undefined, has: (_, k) => k === 'shareText' });
  });
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.WosShareSheet && window.WizOpenApp, null, { timeout: 90000 });
  await p.waitForTimeout(2500);

  // 0. No receiver yet: Share goes straight out (old behaviour, no sheet).
  let r = await p.evaluate(() => window.WosChat.shareText('before any receiver'));
  step('no receiver → straight to the system tray', r === 'shared' && !(await p.$('.wos-share')) && (await p.evaluate(() => window.__native.length)) === 1, r);

  // 1. Open Messenger once: it registers as a receiver with its people.
  await p.evaluate(() => window.WizOpenApp('messenger'));
  await p.waitForFunction(() => window.WosShareSheet._state().receivers.messenger?.targets?.length === 3, null, { timeout: 20000 });
  step('Messenger registers with 3 direct targets', true);
  await p.evaluate(() => window.__wos.onBack?.());
  await p.waitForTimeout(800);

  // 2. Real reply Share button in a Chats thread.
  await p.evaluate(() => window.__wos.goDesk?.(0));
  await p.waitForTimeout(500);
  const sid = await p.evaluate(() => { const s = window.__wos.live?.sessions?.find?.(x => x.message_count > 2) || window.__wos.live?.sessions?.[0]; return s?.id; });
  if (sid) await p.evaluate(id => window.__wos.openWizardThread(id), sid);
  console.log('thread', sid);
  const btn = await p.waitForSelector('[data-mshare]', { timeout: 30000 }).catch(() => null);
  let shareFrom = 'reply Share button';
  if (btn) { await btn.scrollIntoViewIfNeeded(); await btn.click(); }
  else { shareFrom = 'WosChat.shareText (no thread rendered)'; p.evaluate(() => { window.__res = window.WosChat.shareText('Hello Miguel, look at this'); }); }
  await p.waitForSelector('.wos-share.on', { timeout: 5000 });
  await p.waitForTimeout(300);
  const sheet = await p.evaluate(() => ({ people: [...document.querySelectorAll('.wos-share .shs-person .shs-nm')].map(n => n.textContent),
    apps: [...document.querySelectorAll('.wos-share .shs-app .shs-nm')].map(n => n.textContent), other: !!document.querySelector('[data-shs-other]'),
    order: [...document.querySelectorAll('.wos-share .shs-sub')].map(n => n.textContent) }));
  await p.screenshot({ path: OUT + '/sheet-phone.png' });
  step('sheet opens from ' + shareFrom + ': People → Wizard apps → Other apps…', sheet.people.join() === 'Miguel,Novaire,AI Wizards team' && sheet.apps.join() === 'Messenger' && sheet.other && sheet.order.join() === 'People,Wizard apps', JSON.stringify(sheet));

  // 3. Back closes the sheet (cancelled), never exits.
  await p.evaluate(() => window.__wos.onBack());
  await p.waitForTimeout(300);
    step('Back closes the sheet, the thread it came from stays open', !(await p.$('.wos-share')) && (await p.evaluate(() => window.__native.length)) === 1 && (!btn || (await p.$('[data-mshare]')) !== null));

  // 4. Tap Miguel: Messenger opens with the text in his composer, acked once.
  p.evaluate(() => { window.__res = window.WosChat.shareText('Hello Miguel, look at this'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(350);
  await p.click('.shs-person[data-shs-target="p-miguel"]');
  const fr = () => p.frames().find(f => /\/messenger\//.test(f.url()));
  await p.waitForFunction(() => true); await p.waitForTimeout(1500);
  const got = await fr()?.evaluate(() => window.__got);
  const res = await p.evaluate(() => window.__res);
  await p.screenshot({ path: OUT + '/after-miguel.png' });
  step('tap Miguel → Messenger composer gets the text, receipt "shared"', got?.length === 1 && got[0].target === 'p-miguel' && got[0].text === 'Hello Miguel, look at this' && res === 'shared', JSON.stringify({ got, res }));
  step('item acked: nothing left pending', (await p.evaluate(() => window.WosShareSheet._state().pending.length)) === 0);
  step('nothing reached the Android tray', (await p.evaluate(() => window.__native.length)) === 1);

  // 5. Recency: Novaire chosen → moves to the front next time.
  await p.evaluate(() => window.__wos.onBack?.()); await p.waitForTimeout(500);
  p.evaluate(() => { window.__res = window.WosChat.shareText('second'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(350);
  await p.click('.shs-person[data-shs-target="p-novaire"]'); await p.waitForTimeout(1200);
  await p.evaluate(() => window.__wos.onBack?.()); await p.waitForTimeout(500);
  p.evaluate(() => { window.__res = window.WosChat.shareText('third'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(350);
  const order2 = await p.evaluate(() => [...document.querySelectorAll('.wos-share .shs-person .shs-nm')].map(n => n.textContent).join());
  step('recent person moves to the front', order2.startsWith('Novaire,Miguel'), order2);

  // 6. Other apps… → old path (Android tray) with the receipt it returns.
  await p.click('[data-shs-other]'); await p.waitForTimeout(400);
  const nat = await p.evaluate(() => window.__native);
  step('Other apps… → Android tray gets the text', nat.length === 2 && nat[1].t === 'third' && (await p.evaluate(() => window.__res)) === 'shared', JSON.stringify(nat[1]));

  // 7. App tile (no person) → app gets target null.
  p.evaluate(() => { window.__res = window.WosChat.shareText('pick someone'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(350);
  await p.click('.shs-app[data-shs-app="messenger"]'); await p.waitForTimeout(1500);
  const got2 = await fr()?.evaluate(() => window.__got.at(-1));
  step('Messenger tile → app receives with no target (it asks who)', got2?.target === null && got2?.text === 'pick someone', JSON.stringify(got2));

  // 8. Tap outside → cancelled.
  await p.evaluate(() => window.__wos.onBack?.()); await p.waitForTimeout(500);
  p.evaluate(() => { window.__res = window.WosChat.shareText('nope'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(350);
  await p.mouse.click(200, 60); await p.waitForTimeout(300);
  step('tap outside → cancelled (not reported as shared)', (await p.evaluate(() => window.__res)) === 'cancelled');

  // 9. Desktop shell + a second skin screenshot.
  const d = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await d.route('**/*', route => { const r2 = route.request(), u = new URL(r2.url()); if (r2.method() !== 'GET' && r2.method() !== 'HEAD') return route.fulfill({ status: 403, body: '{}' }); if (u.pathname === '/messenger/') return route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }); return route.continue(); });
  const dp = await d.newPage(); const derrs = []; dp.on('pageerror', e => derrs.push(e.message));
  await dp.addInitScript(() => { localStorage.setItem('wos.share.receivers.v1', JSON.stringify({ messenger: { accepts: ['text', 'url'], targets: [{ id: 'p-miguel', name: 'Miguel', detail: 'Wizard' }, { id: 'p-novaire', name: 'Novaire', detail: 'Telegram' }], at: Date.now() } })); });
  await dp.goto(BASE + 'desktop.html', { waitUntil: 'domcontentloaded' });
  await dp.waitForFunction(() => window.WosShareSheet && window.WizCore?.apps?.('desktop')?.APP?.messenger, null, { timeout: 90000 }).catch(() => {});
  await dp.waitForTimeout(2500);
  dp.evaluate(() => { window.__res = window.WosChat.shareText('desktop share'); });
  await dp.waitForSelector('.wos-share.on', { timeout: 5000 }).catch(() => {}); await dp.waitForTimeout(300);
  await dp.screenshot({ path: OUT + '/sheet-desktop.png' });
  await dp.keyboard.press('Escape'); await dp.waitForTimeout(300);
  step('desktop: sheet opens and Escape cancels', !(await dp.$('.wos-share')) && (await dp.evaluate(() => window.__res)) === 'cancelled');
  step('desktop: zero page errors', derrs.length === 0, derrs.slice(0, 3).join(' | '));

  // Light skin screenshot on phone.
  console.log('skins', await p.evaluate(() => (window.WosSkin.list || []).map(x => x.id || x).join(',')));
  await p.evaluate(() => window.WosSkin.set('obsidian-light')); await p.waitForTimeout(1500);
  console.log('skin', await p.evaluate(() => document.documentElement.dataset.skin));
  p.evaluate(() => { window.__res = window.WosChat.shareText('skin check'); });
  await p.waitForSelector('.wos-share.on'); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/sheet-phone-light.png' });
  step('phone: zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  const fail = results.filter(x => !x.ok).length;
  console.log(JSON.stringify({ pass: results.length - fail, fail }));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
