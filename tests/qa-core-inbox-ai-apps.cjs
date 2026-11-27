'use strict';
// wizard-ux issue 1352: Notifications in Chats and the AI apps view are built into the shell, not tweak packages.
// The real phone and desktop shells on a synthetic origin only (synthetic notifications, every write refused).
// Per shell (phone 412 px, desktop 1440 px) and skin (Nebula, Grove):
//   - fresh: the yellow notification rows are in Chats, Settings › Chats shows Notifications in Chats on, Settings › Look
//     (and its New skin sheet) lists neither id as a switch, the desktop picker offers Desks and AI apps, AI apps worn;
//   - saved off (this device, and the owner's look.json `defaults` from look sync): stays off, no yellow rows;
//   - desktop saved Desks / AI apps (`views.desktop`): kept.
// On this branch (QA_EXPECT unset) nothing is read from web/tweaks/wizard/unified-inbox or web/tweaks/miguel/ai-apps.
// QA_WEB=<main worktree>/web QA_EXPECT=baseline gives the same run on main for comparison (Before screenshots).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://core-inbox.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const out = process.env.QA_OUT || 'core-inbox-ai-apps-evidence'; fs.mkdirSync(out, { recursive: true });
const baseline = process.env.QA_EXPECT === 'baseline';
const now = Math.floor(Date.now() / 1000);
const NOTES = ['a', 'b'].map((k, n) => ({ id: 'qa-note-' + k, title: 'Synthetic alert ' + k.toUpperCase(), message: 'A synthetic notification for the core inbox check.', time: now - n * 60, source: 'preview', priority: 3, read: false, archived: false }));
const ROW = { id: 'qa-chat', title: 'A synthetic chat', runtime: 'direct', status: 'completed', updated_at: new Date((now - 119) * 1000).toISOString(), updatedAt: new Date((now - 119) * 1000).toISOString(), message_count: 2, messageCount: 2, archived: false, preview: 'Hi there.' };
const OFF = JSON.stringify({ version: 1, off: {}, preset: 'none', mix: {}, defaultsOff: ['wizard/unified-inbox'], defaultsMigrated: true, machinesHomeMoved: true });
const VIEWS = desktop => JSON.stringify({ version: 1, off: {}, preset: 'none', mix: {}, views: { desktop }, defaultsMigrated: true, machinesHomeMoved: true });
const LOOK_OFF = { version: 1, skin: { id: 'nebula', at: 1 }, tweaks: {}, defaults: { 'wizard/unified-inbox': { on: false, at: Date.now() } }, updated: Date.now() };
const report = { root, baseline, cases: [] };
const nap = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, { shell, skin, name, storage = {}, look = null }) {
  look = look && JSON.parse(JSON.stringify(look));
  const phone = shell === 'phone', entry = { shell, skin, name, errors: [], writes: [], tweakReads: [] }; report.cases.push(entry);
  const c = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce',
    ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  try {
    await c.routeWebSocket('**/*', ws => ws.close());
    await c.addInitScript(({ shell, skin, storage }) => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, ...storage })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }, { shell, skin, storage });
    await c.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
      if (u.pathname.startsWith(prefix + 'tweaks/') && /unified-inbox|ai-apps/.test(u.pathname)) entry.tweakReads.push(u.pathname);
      if (u.pathname.includes('/v1/runs')) return r.abort();
      // look sync saves the merged Look file back (the box's Pages API answers with a new version); nothing else is written
      if (look && q.method() === 'PUT' && u.pathname === '/wizard/v1/pages/wizard-look/look.json') { entry.writes.push('PUT look.json'); look = JSON.parse(q.postDataJSON().text); return r.fulfill({ json: { version: 'qa-' + entry.writes.length } }); }
      if (!['GET', 'HEAD'].includes(q.method())) { entry.writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
      if (u.pathname === '/notifications/api/items') return r.fulfill({ json: { items: NOTES } });
      if (u.pathname === '/notifications/api/count') return r.fulfill({ json: { unread: NOTES.length, needs: 0 } });
      if (u.pathname.startsWith('/notifications/')) return r.fulfill({ json: {} });
      if (u.pathname === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: {}, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
      if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{ id: 'notifications', name: 'Notifications', type: 'agent', source: 'apps.json' }] } });
      if (u.pathname === '/wizard/v1/pages/wizard-look/look.json') return look ? r.fulfill({ json: { text: JSON.stringify(look), version: 'qa-1' } }) : r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [ROW], has_more: false } });
      if (u.pathname === '/wizard/hermes/api/sessions/qa-chat/messages') return r.fulfill({ json: { messages: [{ role: 'user', content: 'Hello', timestamp: now - 120 }, { role: 'assistant', content: 'Hi there.', timestamp: now - 119 }] } });
      if (u.pathname === '/wizard/hermes/api/sessions/qa-chat') return r.fulfill({ json: { session: ROW } });
      if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
      if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, decodeURIComponent(u.pathname.slice(prefix.length)) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); return r.fulfill({ status: 404, body: 'none' }); }
      return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
    });
    const p = await c.newPage(); p.on('pageerror', e => entry.errors.push(e.message));
    await p.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
    await p.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
    await nap(look ? 2500 : 1200);   // look sync's first read
    await p.waitForFunction(() => (window.WosBell?.items?.() || []).length >= 2, null, { timeout: 10000 }).catch(() => {});   // the bell's first read
    await p.waitForFunction(() => !window.WosExperience.state.busy);
    const state = () => p.evaluate(() => ({
      tweaksAttr: document.documentElement.dataset.tweaks || '', layout: document.documentElement.dataset.layout || '', desktopView: WosExperience.desktopView,
      inbox: !!WosSkinHost.inboxThreads, setting: WosExperience.state.tweaks.find(t => t.id === 'wizard/unified-inbox')?.on ?? null, error: WosExperience.state.error }));
    Object.assign(entry, await state());
    // Chats with the notifications
    await p.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList?.(), phone); await nap(900);
    entry.yellowRows = await p.evaluate(() => [...document.querySelectorAll('.ch-al-wrap')].filter(n => n.getClientRects().length).length);
    entry.yellowColour = await p.evaluate(() => { const n = [...document.querySelectorAll('.ch-al-wrap')].find(n => n.getClientRects().length); return n ? getComputedStyle(n).backgroundColor + ' / ' + getComputedStyle(n).boxShadow : ''; });
    await p.screenshot({ path: path.join(out, `${shell}-${skin}-${name}-chats.png`) });
    // A notification opened in the chat window: one yellow message with Done, Snooze and Resolve this.
    entry.opened = await p.evaluate(id => !!window.WosSkinHost.inboxAct?.('open', id), NOTES[0].id); await nap(1200);
    entry.noteThread = await p.evaluate(() => [...document.querySelectorAll('.ch-notif-thread .msg.ch-notif')].filter(n => n.getClientRects().length).map(n => getComputedStyle(n.querySelector('.bub') || n).backgroundColor));
    entry.resolveButton = await p.evaluate(() => [...document.querySelectorAll('.ch-notif-thread [data-chact="resolve"]')].some(n => n.getClientRects().length));
    await p.screenshot({ path: path.join(out, `${shell}-${skin}-${name}-notification.png`) });
    await p.keyboard.press('Escape').catch(() => {}); await nap(300);
    // Settings › Chats and Settings › Look (+ its New skin sheet)
    const open = page => p.evaluate(page => (window.__wux?.openSettings || window.__wos?.openSettings)(page), page);
    const rows = sel => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length).map(n => [n.dataset.tweakToggle || n.dataset.desktopView, n.getAttribute('aria-checked')]), sel);
    await open('chats'); await nap(900);
    entry.chatsRow = (await rows('[data-tweak-toggle="wizard/unified-inbox"]'))[0] || null;
    await p.screenshot({ path: path.join(out, `${shell}-${skin}-${name}-settings-chats.png`) });
    await open('look'); await nap(900);
    entry.lookSwitches = (await rows('[data-tweak-toggle]')).map(r => r[0]);
    entry.desktopViews = await rows('[data-desktop-view]');
    await p.screenshot({ path: path.join(out, `${shell}-${skin}-${name}-settings-look.png`) });
    const add = p.locator('[data-newskin]').filter({ visible: true }).first();
    if (await add.count()) { await add.click(); await nap(1500); entry.newSkinSwitches = await p.evaluate(() => [...document.querySelectorAll('[data-newskin-sheet] [role="switch"], [data-newskin-sheet] [role="radio"]')].filter(n => n.getClientRects().length).map(n => n.querySelector('b')?.textContent || n.textContent.trim())); entry.newSkinText = await p.evaluate(() => document.querySelector('[data-newskin-sheet]')?.innerText || ''); await p.evaluate(() => { const h = [...document.querySelectorAll('[data-newskin-sheet] *')].find(n => n.children.length === 0 && n.textContent.trim() === 'Tweaks'); h?.scrollIntoView({ block: 'start' }); }); await nap(300); await p.screenshot({ path: path.join(out, `${shell}-${skin}-${name}-new-skin.png`) }); }
    entry.after = await state();
    return entry;
  } finally { await c.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of (process.env.QA_SHELLS || 'phone,desktop').split(',')) for (const skin of (process.env.QA_SKINS || 'nebula,grove').split(',')) {
      const fresh = await run(browser, { shell, skin, name: 'fresh' });
      assert.deepEqual(fresh.errors, [], 'no page errors'); assert.equal(fresh.error, '');
      assert.ok(fresh.tweaksAttr.split(' ').includes('wizard/unified-inbox') && fresh.inbox, `${shell} ${skin}: Notifications in Chats runs by default`);
      if (shell === 'phone') assert.ok(fresh.yellowRows >= 1, `${shell} ${skin}: yellow notification rows in Chats`);
      assert.ok(fresh.noteThread.length === 1 && fresh.resolveButton, `${shell} ${skin}: a notification opens as one yellow message with Resolve this`);
      assert.deepEqual(fresh.chatsRow, ['wizard/unified-inbox', 'true'], 'Settings › Chats shows it on');
      if (shell === 'desktop') { assert.equal(fresh.desktopView, 'ai-apps'); assert.equal(fresh.layout, 'ai-apps'); assert.deepEqual(fresh.desktopViews.map(v => v[0]), ['classic', 'ai-apps']); }
      else assert.notEqual(fresh.layout, 'ai-apps', 'the phone keeps its stock view');
      for (const id of ['wizard/unified-inbox', 'miguel/ai-apps']) assert.ok(!fresh.lookSwitches.includes(id), `${shell} ${skin}: Look lists no ${id} switch`);
      if (!baseline) {
        assert.ok(Array.isArray(fresh.newSkinSwitches), 'New skin opened');
        for (const name of ['Notifications in Chats', 'AI apps']) assert.ok(!fresh.newSkinSwitches.some(n => n.includes(name)) && !fresh.newSkinText.includes(name), `${shell} ${skin}: New skin lists no ${name} switch`);
        assert.deepEqual(fresh.tweakReads, [], 'nothing read from the old tweak packages');
      }
      for (const [name, opts] of [['saved-off', { storage: { 'wos.skin-tweaks.v1': OFF } }], ['look-sync-off', { look: LOOK_OFF }]]) {
        const off = await run(browser, { shell, skin, name, ...opts });
        assert.deepEqual(off.errors, []); assert.equal(off.after.setting, false, `${shell} ${skin} ${name}: the owner's off is kept`);
        assert.ok(!off.after.tweaksAttr.split(' ').includes('wizard/unified-inbox') && !off.after.inbox, `${name}: not running`);
        assert.equal(off.yellowRows, 0, `${name}: no yellow rows`); assert.deepEqual(off.noteThread, [], `${name}: no notification thread`); assert.deepEqual(off.chatsRow, ['wizard/unified-inbox', 'false']);
        if (!baseline) assert.deepEqual(off.tweakReads, []);
      }
      if (shell === 'desktop') for (const [saved, want] of [['', 'classic'], ['miguel/ai-apps', 'ai-apps']]) {
        const v = await run(browser, { shell, skin, name: 'saved-' + want, storage: { 'wos.skin-tweaks.v1': VIEWS(saved), 'wos.desktop-view.v1': want } });
        assert.deepEqual(v.errors, []); assert.equal(v.desktopView, want, `saved desktop view ${saved || 'Desks'} kept`);
        assert.equal(v.layout || 'classic', want); assert.deepEqual(v.desktopViews.find(r => r[1] === 'true')?.[0], want);
      }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`PASS${baseline ? ' (baseline)' : ''} Notifications in Chats and AI apps: defaults, saved offs, look sync and saved desktop views; phone + desktop × Nebula + Grove`);
  } catch (e) { fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
