// Settings acceptance 1–6. Run on a browser worker against a read-only qa-origin.
// QA_SHOTS=<private evidence dir> QA_CHROME=<Chromium> node qa-settings-redesign.cjs [origin]
// Live registry/thread reads; candidate Chats/update/voice fixtures; ALL mutations intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const BASE = process.argv[2] || 'http://127.0.0.1:9450/wizard-os-home/';
const OUT = process.env.QA_SHOTS || path.join(process.env.TMPDIR || require('node:os').tmpdir(), 'settings-redesign');
fs.mkdirSync(OUT, { recursive: true });
const checks = [], errors = [], mutations = [];
function ok(value, name, detail) { checks.push({ pass: !!value, name, detail }); console.log(value ? 'PASS' : 'FAIL', name, value ? '' : JSON.stringify(detail)); }
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureModule = fs.readFileSync(path.join(__dirname, 'web/core/chats-fixture-view.js'), 'utf8').replace("id: 'chats-fixture'", "id: 'mizel-chats'");
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
 try {
  for (const phone of [true, false]) {
   const kind = phone ? 'phone' : 'desktop';
   const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 892 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' } : {}) });
   let installed = false, selected = 'wizard-chats', failPost = false, update = false, voice = true;
   const posts = [];
   await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url()), json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/wizard-os-home/store-install/_slots/chats') {
     if (q.method() === 'POST') { const body = q.postDataJSON(); posts.push(body); mutations.push({ fixture: true, kind, path: u.pathname, body }); if (failPost) return json({ error: 'QA owner connection unavailable' }, 503); selected = body.default; }
     return json({ default: selected, candidates: ['wizard-chats', ...(installed ? ['mizel-chats'] : [])] });
    }
    if (!['GET', 'HEAD'].includes(q.method())) { mutations.push({ fixture: false, kind, method: q.method(), path: u.pathname }); return json({ error: 'QA refuses writes' }, 403); }
    if (u.pathname === '/qa-chats/view.js') return route.fulfill({ contentType: 'application/javascript', body: fixtureModule });
    if (u.pathname === '/wizard/v1/apps') {
     const response = await route.fetch(), snapshot = await response.json();
     snapshot.apps = (snapshot.apps || []).filter(a => !a.provides?.includes('chats'));
     if (installed) snapshot.apps.push({ id: 'mizel-chats', name: 'Mizel Chats', source: 'apps.json', url: '/qa-chats/', provides: ['chats'], chats_view: { contract: 'wizard.chats-view/1', module: 'view.js' } });
     snapshot.slots = { ...snapshot.slots, chats: { default: selected, candidates: ['wizard-chats', ...(installed ? ['mizel-chats'] : [])] } }; return json(snapshot);
    }
    if (u.pathname.endsWith('/store-install/_updates')) return json({ mode: 'ask', chosen: true, update_available: update });
    if (u.pathname.endsWith('/voice/status')) return json({ ready: voice, name: 'QA voice', model: 'fixture' });
    return route.continue();
   });
   await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (_) { /* Sandbox/opaque-origin hosted frames do not expose storage. */ } navigator.sendBeacon = () => false; });
   const p = await ctx.newPage(); p.on('pageerror', e => errors.push({ kind, error: String(e) }));
   const open = async view => { await p.evaluate(v => WizCore.deeplink.route('/wizard-os-home/?view=' + v), view); await nap(250); };
   const tap = async selector => { for (let i = 0; ; i++) { try { const el = p.locator(selector + ':visible').first(); await el.scrollIntoViewIfNeeded({ timeout: 5000 }); if (phone) await el.tap({ timeout: 5000 }); else await el.click({ timeout: 5000 }); break; } catch (e) { if (i >= 2 || !/not attached|detached/i.test(String(e))) throw e; await nap(250); } } await nap(180); }; // Settings may re-render once when skin preview images load
   const shot = async name => { await p.locator('.mz-intro').waitFor({ state: 'detached' }); await p.screenshot({ path: path.join(OUT, `${kind}-${name}.png`) }); };
   await p.goto(BASE); await p.waitForFunction(() => WizLive?.ok && (window.__wos || window.__wux) && window.WosSettings && WosOutbox.recoveryComplete, null, { timeout: 60000 });
   await p.evaluate(() => WizCore.appsLoaded()); await p.evaluate(() => WizCore.voiceStatus.load());
   for (const skin of ['nebula', 'obsidian-light']) {
    await open('skin');
    if (skin === 'obsidian-light') { await tap('[data-skinpick="obsidian-light"]'); await p.locator('.mz-intro').waitFor({ state: 'detached' }); if (await p.evaluate(() => WosSkin.current) !== 'obsidian-light') await tap('[data-skinpick="obsidian-light"]'); }
    ok(await p.evaluate(s => WosSkin.current === s && document.querySelector('[data-skinpick][aria-pressed="true"]')?.dataset.skinpick === s, skin), `${kind} ${skin}: real picker wears the selected palette`);
    await shot(`${skin}-appearance`);
    const touch = await p.locator('#settingsBody').evaluate(e => [...e.querySelectorAll('button, summary')].filter(b => b.getClientRects().length && !b.closest('[hidden]')).map(b => ({ label: b.textContent.trim().slice(0, 50), width: Math.round(b.getBoundingClientRect().width * 1000) / 1000, height: Math.round(b.getBoundingClientRect().height * 1000) / 1000 })));
    ok(touch.every(b => b.width >= 48 && b.height >= 48), `${kind} ${skin}: all visible Appearance controls ≥48px`, touch.filter(b => b.width < 48 || b.height < 48));
    if (skin === 'obsidian-light') {
     ok(await p.locator('[data-chats-suggestion]:visible').count() === 1 && await p.locator('[data-chats-suggest]:visible').innerText() === 'Get it', `${kind}: uninstalled recommendation offers Get it`);
     await tap('[data-chats-suggest]');
     ok(await p.locator('iframe[src*="store/index.html?app=mizel-chats"]').count() === 1 && await p.evaluate(() => Object.values((window.__wos || window.__wux).wins).some(w => w.appId === 'app-store' && w.url?.includes('?app=mizel-chats') && !w.from)), `${kind}: Get it opens exact Store app as a normal app window`);
    }
    await open('settings');
    const geometry = await p.locator('#settingsBody').evaluate(e => { const nav = e.querySelector('.st-index'), pane = e.querySelector('.st-page'); return { client: e.clientHeight, scroll: e.scrollHeight, index: nav.getBoundingClientRect().toJSON(), pane: pane.getBoundingClientRect().toJSON(), rows: [...e.querySelectorAll('.st-category')].map(b => ({ height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width })), text: nav.textContent }; });
    ok(phone ? geometry.scroll <= geometry.client + 1 : geometry.index.right <= geometry.pane.left && geometry.pane.width > 300, `${kind} ${skin}: ${phone ? 'root fits one screen without scrolling' : 'two panes'}`, geometry);
    ok(geometry.rows.length === (phone ? 7 : 6) && geometry.rows.every(r => r.height >= 48 && r.width >= 48), `${kind} ${skin}: capability-gated index and ≥48px rows`, geometry.rows);
    ok(await p.locator('.st-attention').count() === 0, `${kind} ${skin}: no empty attention chrome`);
    await shot(`${skin}-root`);
    await tap('[data-st-page="chats"]');
    ok(await p.locator('[data-chats-choice="wizard-chats"][aria-checked="true"]').count() === 1 && await p.locator('.st-store-hint').count() === 1, `${kind} ${skin}: built-in-only selected plus Store hint`);
    ok(posts.length === 0, `${kind} ${skin}: skins never switch Chats automatically`);
   }
   installed = true; await p.evaluate(() => WizCore.refreshApps());
   await p.evaluate(() => { const A = window.__wos || window.__wux; A.openApp(WizCore.apps(window.__wos ? 'mobile' : 'desktop').APP.wizard); });
   await open('chats-default');
   ok(await p.locator('[data-chats-choice]').count() === 2 && (await p.locator('[data-chats-choice]').first().innerText()).includes('Wizard Chats (built in)'), `${kind}: two installed providers, built-in first`);
   ok(await p.locator('[data-chats-suggestion]:visible').innerText().then(t => t.includes('Mizel goes with Mizel Chats') && t.includes('Use it')), `${kind}: installed recommendation offers Use it`);
   await shot('obsidian-light-chats-suggestion');
   await tap('[data-chats-suggest]');
   ok(await p.locator('[role="alertdialog"]').innerText().then(t => t.includes('Use Mizel Chats for all your chats?') && t.includes('You can switch back here any time.')) && posts.length === 0, `${kind}: confirmation before any POST`);
   await tap('[data-chats-cancel]'); ok(posts.length === 0 && selected === 'wizard-chats', `${kind}: Cancel leaves default unchanged`);
   await tap('[data-chats-choice="mizel-chats"]'); await tap('[data-chats-confirm]');
   await p.waitForFunction(() => WizChatsHost.defaultId() === 'mizel-chats');
   ok(posts.length === 1 && posts[0].default === 'mizel-chats' && await p.locator('[data-chats-choice="mizel-chats"][aria-checked="true"]').count() === 1, `${kind}: confirmed POST and registry readback select new default`);
   await p.waitForSelector('[data-chats-fixture]', { timeout: 10000 });
   ok(await p.locator('[data-chats-fixture]').count() > 0, `${kind}: existing Chats rerenders with new provider`);
   failPost = true; await tap('[data-chats-choice="wizard-chats"]'); await tap('[data-chats-confirm]');
   await nap(300);
   ok(selected === 'mizel-chats' && await p.locator('[data-chats-choice="mizel-chats"][aria-checked="true"]').count() === 1, `${kind}: failed POST keeps old selection`);
   ok((await p.locator('body').innerText()).includes('QA owner connection unavailable'), `${kind}: failed POST toasts error`);
   failPost = false; await tap('[data-chats-choice="wizard-chats"]'); await tap('[data-chats-confirm]');
   await p.waitForFunction(() => WizChatsHost.defaultId() === 'wizard-chats');
   await tap('[data-chats-dismiss]');
   await open('skin'); ok(await p.locator('[data-chats-suggestion]').count() === 0, `${kind}: Not now dismisses on Appearance too`);
   await p.reload(); await p.waitForFunction(() => WizLive?.ok && (window.__wos || window.__wux)); await open('chats-default');
   ok(await p.locator('[data-chats-suggestion]').count() === 0 && await p.evaluate(() => localStorage.getItem('wos.settings.chats.dismiss.mizel') === 'mizel-chats'), `${kind}: Not now persists per skin`);
   for (const [alias, page] of [['skin', 'appearance'], ['usage', 'usage'], ['updates', 'about'], ['mic', 'voice'], ['own-views', 'chats'], ['features', 'about'], ['unsent', 'recovery'], ['chats-default', 'chats']]) {
    await open(alias); ok(await p.locator('#settingsBody').getAttribute('data-settings-page') === page, `${kind}: ${alias} alias → ${page}`);
   }
   const id = await p.evaluate(async () => { const x = await WosOutbox.stage({ kind: 'new', intent: 'command', audio: new Blob(['retained fixture audio'.repeat(150)], { type: 'audio/webm' }), source: 'orb' }); await WosOutbox.transition(x.id, 'held', 'QA retained recording'); return x.id; });
   update = true; await p.evaluate(() => WosUpdates.load(true)); await open('settings');
   for (const [feature, title, page] of [['unsent', 'message', 'recovery'], ['cancelled', 'recording', 'recovery'], ['updates', 'Update ready', 'about']]) {
    ok((await p.locator(`[data-st-attention="${feature}"]`).innerText()).includes(title), `${kind}: ${title} attention shown`);
    await tap(`[data-st-attention="${feature}"]`); ok(await p.locator('#settingsBody').getAttribute('data-settings-page') === page, `${kind}: ${feature} attention opens resolving page`); await open('settings');
   }
   await p.evaluate(id => { (window.__wos || window.__wux).openSettings('unsent'); WosSettings.focusUnsent(id); }, id); await nap(200);
   ok(await p.locator(`[data-ubid="${id}"] button`).first().evaluate(e => e === document.activeElement), `${kind}: recoverUnsent focuses selected record`);
   await p.evaluate(id => WosOutbox.remove(id), id); update = false; await p.evaluate(() => WosUpdates.load(true));
   await open('settings');
   const reachable = [];
   for (const page of ['appearance', 'chats', 'voice', ...(phone ? ['phone'] : []), 'recovery', 'usage', 'about']) {
    await tap(`[data-st-page="${page}"]`); reachable.push(...await p.locator('[data-settings-feature]').evaluateAll(es => es.map(e => e.dataset.settingsFeature))); await open('settings');
   }
   ok(['look', 'chats-default', 'voice', 'selection', 'unsent', 'cancelled', 'usage', 'wizard', 'updates', 'features'].every(id => reachable.includes(id)), `${kind}: all common options one category tap away`, reachable);
   if (!phone) {
    await p.locator('[data-st-page="appearance"]').focus(); await p.keyboard.press('ArrowDown');
    ok(await p.locator('#settingsBody').getAttribute('data-settings-page') === 'chats' && await p.locator('[data-st-page="chats"]').evaluate(e => e === document.activeElement), 'desktop: category arrows swap pane and keep keyboard focus');
    await p.keyboard.press('Escape'); ok(await p.locator('#settingsBody').getAttribute('data-settings-page') === '', 'desktop: Esc leaves category first');
    await p.keyboard.press('Escape'); ok(await p.locator('#dsettings').isHidden(), 'desktop: next Esc closes Settings');
   } else {
    await tap('[data-st-page="chats"]'); await p.evaluate(() => { window.__settingsDocument = document; history.back(); }); await nap(500);
    ok(await p.locator('#settingsBody').getAttribute('data-settings-page') === '' && await p.locator('#settings.open').isVisible(), 'phone: browser Back page → root');
    await p.evaluate(() => history.back()); await nap(500);
    ok(await p.locator('#settings.open').count() === 0 && await p.evaluate(() => document === window.__settingsDocument && !!window.__wos), 'phone: browser Back root → closed; app document survives');
   }
   await ctx.close();
  }
 } finally {
  await browser.close();
  ok(errors.length === 0, 'no page errors', errors);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, errors, mutations, passed: checks.filter(x => x.pass).length, failed: checks.filter(x => !x.pass).length, forwardedWrites: 0 }, null, 2));
 }
 assert.equal(checks.filter(x => !x.pass).length, 0, 'Settings acceptance failures');
 console.log(`${checks.filter(x => x.pass).length} passed; zero forwarded writes`);
})().catch(e => { console.error(e); process.exitCode = 1; });
