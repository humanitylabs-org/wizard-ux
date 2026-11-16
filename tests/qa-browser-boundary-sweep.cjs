// An app removed some other way (the agent, the box command, the Store on another device) also loses the data the
// shell kept on this device for its sandboxed windows (wizard-os#133 slice 42), once the box's app list has shown it
// gone on 2 reads at least a day apart. An app the Store removed here (delete still pending) goes on the next read.
// Real Chromium, the real core/browser-boundary.js writes the data as a sandboxed app's window does, the real
// core/apps.js reads a routed GET /wizard/v1/apps and the real web/store/store-remove.js deletes. No real Wizard.
//   node tests/qa-browser-boundary-sweep.cjs                     candidate (all checks must pass)
//   QA_WEB=<main tree>/web QA_EXPECT=broken node tests/...        main: the data of a removed app stays
// Env: QA_OUTPUT=<dir> for the screenshot (default: <tmp>/boundary-sweep-qa).
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const WEB = process.env.QA_WEB || path.resolve(__dirname, '..', 'web'), OUT = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'boundary-sweep-qa');
const BROKEN = process.env.QA_EXPECT === 'broken', origin = 'https://boundary-sweep.test';
const type = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
const SEED = `<!doctype html><meta charset="utf-8"><script>localStorage.setItem('wos.browser-boundary.v1', '1');</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script><body>seed</body>`;
// The shell's app list with only what core/apps.js needs around it.
const HOST = `<!doctype html><meta charset="utf-8"><title>sweep</title>
<script>window.WizCore = { norm: s => String(s || '').toLowerCase() };
window.WizConfig = { ready: Promise.resolve(), endpoint: k => k === 'apps' ? '/wizard/v1/apps' : '' };</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script src="/wizard-os-home/core/apps.js"></script>
<body style="font:16px system-ui;margin:24px"><h1>App data after the app is gone from the box</h1><pre id="out">…</pre></body>`;
const app = id => ({ id, name: id, url: `/${id}/`, source: 'apps.json' });
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, why: e.message }); } };
  let LIST = [], reads = 0, sweeperLoads = 0;
  const serve = context => context.route('**/*', route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/seed') return route.fulfill({ contentType: 'text/html', body: SEED });
    if (p === '/host') return route.fulfill({ contentType: 'text/html', body: HOST });
    if (p === '/wizard/v1/apps') { reads++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apps: LIST }) }); }
    if (p.startsWith('/wizard-os-home/')) {
      if (p.endsWith('/store/store-remove.js')) sweeperLoads++;
      const f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)));
      if (f.startsWith(WEB) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ contentType: type(f), body: fs.readFileSync(f) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await serve(context);
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-12T10:00:00Z') });
    await page.goto(origin + '/seed');
    // Ledger (removed by the agent elsewhere), Music (stays), Cards (the Store removed it here; its delete failed).
    const seeded = await page.evaluate(async () => {
      const B = window.WizBrowserBoundary; if (!B) return false;
      const mk = async id => {
        B.appStorage.save(id, [{ k: 'theme', v: 'dark-' + id }]);
        return !!(await B.appIdb.commit(id, 'clips', [{ o: 'version', v: 1 }, { o: 'store', s: 'clips', keyPath: 'id' }, { o: 'put', s: 'clips', k: 'c1', v: { id: 'c1', title: 'Clip of ' + id } }], 0))?.idb;
      };
      return (await mk('ledger')) && (await mk('music')) && (await mk('cards'));
    });
    check('real boundary module wrote three apps\' data', () => assert.equal(seeded, true));
    const state = () => page.evaluate(async () => {
      const B = window.WizBrowserBoundary, out = {};
      for (const id of ['ledger', 'music', 'cards']) out[id] = { settings: localStorage.getItem('wos.app-storage.v1.' + id) !== null, dbs: (await B.appIdb.list(id)).idb.map(d => d.name) };
      out.gone = JSON.parse(localStorage.getItem('wos.app-gone.v1') || 'null');
      out.removed = JSON.parse(localStorage.getItem('wos.app-removed.v1') || 'null');
      return out;
    });
    const has = (s, id) => s[id].settings && s[id].dbs.length === 1;
    const settle = () => page.waitForTimeout(400);
    // 1. First read without Ledger: noted only, nothing deleted.
    LIST = [app('music'), app('cards')];
    await page.goto(origin + '/host'); await page.waitForFunction(() => window.WizCore.refreshApps); await settle();
    const first = await state();
    check('the app list was read', () => assert.ok(reads >= 1));
    check('first read without Ledger: its data stays (an app list can miss an app for a moment)', () => assert.ok(has(first, 'ledger')));
    // 2. The same day, still gone: still kept.
    await page.clock.fastForward('03:00:00'); await page.evaluate(() => window.WizCore.refreshApps()); await settle();
    const sameDay = await state();
    check('a few hours later: Ledger still kept', () => assert.ok(has(sameDay, 'ledger')));
    // 3. A day after the first miss and still gone: deleted. Music stays.
    await page.clock.fastForward('22:00:00'); await page.evaluate(() => window.WizCore.refreshApps()); await settle();
    const nextDay = await state();
    check('a day later, still gone: Ledger\'s saved settings and databases are deleted', () => { assert.equal(nextDay.ledger.settings, false); assert.deepEqual(nextDay.ledger.dbs, []); });
    check('an app still on the box keeps everything', () => { assert.ok(has(nextDay, 'music')); assert.ok(has(nextDay, 'cards')); });
    check('Ledger is marked removed, so a window of it opened earlier writes nothing back', () => assert.ok(Number.isFinite(nextDay.removed?.ledger?.at)));
    // 4. Cards: the Store removed it on this device but its delete failed (pending). Once the box list lacks it, the
    // next read deletes it at once.
    await page.evaluate(async () => { const m = await import('/wizard-os-home/store/store-remove.js'); m.markRemoved?.('cards'); });
    LIST = [app('music')];
    await page.clock.fastForward('00:11:00'); await page.evaluate(() => window.WizCore.refreshApps()); await settle();
    const store = await state();
    check('an app the Store removed here goes on the next read without it', () => { assert.equal(store.cards.settings, false); assert.deepEqual(store.cards.dbs, []); });
    // 5. A box that lists no installed app at all is a broken read: nothing is deleted, whatever the time.
    LIST = [];
    await page.clock.fastForward('30:00:00'); await page.evaluate(() => window.WizCore.refreshApps()); await settle();
    await page.clock.fastForward('30:00:00'); await page.evaluate(() => window.WizCore.refreshApps()); await settle();
    const empty = await state();
    check('an empty app list deletes nothing', () => assert.ok(has(empty, 'music')));
    check('no page errors', () => assert.deepEqual(errors, []));
    await page.evaluate(([a, b]) => {
      const row = (s, id) => `${id.padEnd(7)} saved settings: ${s[id].settings ? 'yes' : 'no '}   databases: ${s[id].dbs.join(', ') || '-'}`;
      document.getElementById('out').textContent = 'Ledger was removed on another device. Box app list: Music, Cards.\n\nFirst read:\n'
        + ['ledger', 'music', 'cards'].map(id => row(a, id)).join('\n') + '\n\nA day later, still gone:\n' + ['ledger', 'music', 'cards'].map(id => row(b, id)).join('\n');
    }, [first, nextDay]);
    await page.screenshot({ path: path.join(OUT, (BROKEN ? 'before' : 'after') + '-sweep.png'), fullPage: true });
    // 6. A device that never kept app data never loads the sweeper and creates no shell database.
    const c2 = await browser.newContext({ serviceWorkers: 'block' }); await serve(c2);
    const p2 = await c2.newPage(); sweeperLoads = 0; LIST = [app('music')];
    await p2.goto(origin + '/host'); await p2.waitForTimeout(600);
    const dbs = await p2.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
    check('no data here: the sweeper is not loaded and no shell database is created', () => { assert.equal(sweeperLoads, 0); assert.deepEqual(dbs, []); });
  } finally { await browser.close(); }
  const failed = checks.filter(c => !c.ok);
  console.log(JSON.stringify({ mode: BROKEN ? 'main (expect broken)' : 'candidate', passed: checks.length - failed.length, failed }, null, 1));
  if (BROKEN ? failed.length === 0 : failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
