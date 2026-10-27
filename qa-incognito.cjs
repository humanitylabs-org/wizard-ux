// Synthetic fixture browser evidence ONLY. Real stock/Tinfoil acceptance is a separate required check.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.argv[2] || 'http://127.0.0.1:19743/wizard-os-home/';
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-incognito-out'); fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (value, label) => { assert(value, label); results.push({ label, pass: true }); console.log('PASS', label); };
async function browserState(page) {
  return page.evaluate(async () => {
    const state = { local: { ...localStorage }, session: { ...sessionStorage }, indexed: {}, cache: {} };
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const data = {}; for (const store of db.objectStoreNames) data[store] = await new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      db.close(); state.indexed[name] = data;
    }
    for (const name of await caches.keys()) { const cache = await caches.open(name), values = []; for (const request of await cache.keys()) { const response = await cache.match(request); if (response && /(?:json|text)/.test(response.headers.get('content-type') || '')) values.push(await response.text()); } state.cache[name] = values; }
    return JSON.stringify(state);
  });
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const mobile of [true, false]) {
      const tag = mobile ? 'phone' : 'desktop', ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
      const p = await ctx.newPage(), errors = [], writes = [];
      p.on('pageerror', e => errors.push(String(e)));
      p.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push({ url: r.url(), body: r.postData() || '' }); });
      await p.goto(BASE + (mobile ? '' : 'desktop.html'));
      await p.waitForFunction(() => window.WosAgents?.ready && WosAgents.get('private')?.incognito_available);
      await p.evaluate(() => window.WizOpenAgentChats('private'));
      await p.waitForFunction(() => Object.values((window.__wos || window.__wux).wins).some(w => w.app === 'chats' && w.agent === 'private'));
      const wid = await p.evaluate(() => Object.values((window.__wos || window.__wux).wins).find(w => w.app === 'chats' && w.agent === 'private').id);
      if (mobile) await p.evaluate(id => __wos.goDesk(__wos.desks.findIndex(d => d.wins.includes(id))), wid);
      const pane = p.locator(`[data-chats="${wid}"]`);
      await pane.locator('[data-chopen="synthetic-normal"]').first().click();
      await pane.getByText('Normal private history stays saved.', { exact: false }).waitFor();
      check(await pane.locator('[data-incog-start]').count() === 0, tag + ': no toggle in existing private threads');
      await pane.locator('[data-chback]').click();
      check(await pane.locator('[data-incog-start]').count() === 0, tag + ': no toggle on the Chats list');
      await pane.locator('[data-chnew]').first().click();
      await pane.locator('[data-incog-start]').waitFor();
      if (mobile) await p.screenshot({ path: path.join(OUT, 'phone-new-chat-toggle.png') });
      const ordinaryDraft = 'ordinary-draft-kept-' + crypto.randomUUID();
      await pane.locator('.ch-compose textarea').fill(ordinaryDraft);
      await pane.locator('[data-incog-start]').click();
      await pane.locator('[data-incog-field]:not([disabled])').waitFor();
      check((await pane.innerText()).includes('This chat is never saved.'), tag + ': permanent privacy warning');
      check(await pane.locator('[data-chfiles],[data-chvoice],[data-chat-model]').count() === 0, tag + ': no uploads/voice/model picker');
      const canary = 'incognito-canary-' + crypto.randomUUID();
      for (const input of [canary + '-one', canary + '-two']) {
        await pane.locator('[data-incog-field]').fill(input);
        await pane.locator('[data-incog-form] button[type="submit"]').click();
        await pane.locator('.msg.a').filter({ hasText: input }).waitFor();
      }
      check(await pane.locator('.msg.a').count() === 2, tag + ': multiple temporary turns');
      check(await pane.locator('[data-incog-off],[data-incog-start]').count() === 0, tag + ': toggle disappears after the first send');
      check(!(await browserState(p)).includes(canary), tag + ': no canary in local/session storage, IndexedDB, or cache');
      check(!writes.some(r => r.body.includes(canary) && !r.url.includes('/incognito/')), tag + ': no canary reaches normal Service writes');
      for (const skin of ['nebula', 'grove']) {
        await p.evaluate(s => WosSkin.set(s), skin); await p.waitForTimeout(500);
        await p.screenshot({ path: path.join(OUT, tag + '-' + skin + '.png') });
      }
      p.once('dialog', d => d.dismiss()); await pane.locator('[data-incog-close]').last().click();
      check(await pane.locator('[data-incog-thread]').count() === 1, tag + ': Cancel keeps temporary thread');
      p.once('dialog', d => d.accept()); await pane.locator('[data-incog-close]').last().click();
      await pane.locator('[data-incog-start]').waitFor();
      check(!await pane.innerText().then(x => x.includes(canary)), tag + ': close removes transcript');
      check(await pane.locator('.ch-compose textarea').inputValue() === ordinaryDraft, tag + ': ordinary private draft unchanged');
      check(!(await browserState(p)).includes(canary), tag + ': no browser resurrection after close');
      await pane.locator('[data-incog-start]').click(); await pane.locator('[data-incog-field]:not([disabled])').waitFor();
      p.once('dialog', d => d.accept()); await pane.locator('.ch-back[data-incog-close]').click();
      await pane.locator('[data-chnew]').first().waitFor();
      check(await pane.locator('[data-incog-thread]').count() === 0, tag + ': nested Back ends one thread level without exiting the app');
      await pane.locator('[data-chnew]').first().click();
      await pane.locator('[data-incog-start]').click(); await pane.locator('[data-incog-field]:not([disabled])').waitFor();
      await pane.locator('[data-incog-field]').fill(canary + '-reload');
      await p.reload(); await p.waitForFunction(() => window.WosAgents?.ready);
      check(!await p.locator('body').innerText().then(x => x.includes(canary)), tag + ': reload cannot restore transient draft or transcript');
      check(!(await browserState(p)).includes(canary), tag + ': reload does not migrate temporary draft into normal storage');
      check(errors.length === 0, tag + ': no browser runtime errors');
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify({ mode: 'synthetic-browser-fixture-only', real_provider_verified: false, real_hermes_verified: false, results }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
