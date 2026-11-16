// Removing an app from the Store also deletes the data the shell kept on this device for its sandboxed windows
// (wizard-os#133): the saved settings (`wos.app-storage.v1.<id>`) and its databases in the shell IndexedDB
// (`wos-app-idb-v1`). Real Chromium, real core/browser-boundary.js to write the data exactly as a sandboxed app's
// window does, real web/store/store-remove.js to forget it. Nothing reaches a real Wizard.
//   node tests/qa-browser-boundary-forget.cjs                     candidate (all checks must pass)
//   QA_WEB=<main tree>/web QA_EXPECT=broken node tests/...        main: forgetAppData is missing, the data stays
// Env: QA_OUTPUT=<dir> for the screenshot (default: <tmp>/boundary-forget-qa).
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const WEB = process.env.QA_WEB || path.resolve(__dirname, '..', 'web'), OUT = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'boundary-forget-qa');
const BROKEN = process.env.QA_EXPECT === 'broken', origin = 'https://boundary-forget.test';
const type = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
const HOST = `<!doctype html><meta charset="utf-8"><title>forget</title>
<script>localStorage.setItem('wos.browser-boundary.v1', '1');</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<body style="font:16px system-ui;margin:24px"><h1>App data after Remove</h1><pre id="out">…</pre></body>`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, why: e.message }); } };
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/host') return route.fulfill({ contentType: 'text/html', body: HOST });
      if (p.startsWith('/wizard-os-home/')) {
        const f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)));
        if (f.startsWith(WEB) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ contentType: type(f), body: fs.readFileSync(f) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/host');
    // Two apps, the second one's id starts like the first: its data must stay.
    const seeded = await page.evaluate(async () => {
      const B = window.WizBrowserBoundary; if (!B) return { boundary: false };
      const put = (id, s, k, v) => ({ o: 'put', s, k, v });
      const mk = async id => {
        B.appStorage.save(id, [{ k: 'theme', v: 'dark-' + id }, { k: 'last', v: '42' }]);
        const r = await B.appIdb.commit(id, 'clips', [{ o: 'version', v: 1 }, { o: 'store', s: 'clips', keyPath: 'id' }, put(id, 'clips', 'c1', { id: 'c1', title: 'Clip of ' + id }), put(id, 'clips', 'c2', { id: 'c2', title: 'Second' })], 0);
        const r2 = await B.appIdb.commit(id, 'cache', [{ o: 'version', v: 1 }, { o: 'store', s: 'frames' }, put(id, 'frames', 'f1', 'bytes')], 0);
        return !!(r && r.idb && r2 && r2.idb);
      };
      return { boundary: true, ledger: await mk('ledger'), other: await mk('ledger-two') };
    });
    check('real boundary module wrote both apps\' data', () => assert.deepEqual(seeded, { boundary: true, ledger: true, other: true }));
    const read = () => page.evaluate(async () => {
      const B = window.WizBrowserBoundary;
      const one = async id => ({ settings: Object.fromEntries(B.appStorage.load(id).store), dbs: (await B.appIdb.list(id)).idb.map(d => d.name).sort(),
        clips: (await B.appIdb.load(id, 'clips')).idb?.rows?.[0]?.[1]?.length || 0, key: localStorage.getItem('wos.app-storage.v1.' + id) !== null });
      return { ledger: await one('ledger'), other: await one('ledger-two') };
    });
    const before = await read();
    check('before: Ledger has settings and two databases', () => { assert.equal(before.ledger.settings.theme, 'dark-ledger'); assert.deepEqual(before.ledger.dbs, ['cache', 'clips']); assert.equal(before.ledger.clips, 2); });
    // The Store's own function, as store.js calls it once the App Manager and the readback both say Ledger is gone.
    const forgot = await page.evaluate(async () => {
      const m = await import('/wizard-os-home/store/store-remove.js');
      if (typeof m.forgetAppData !== 'function') return 'missing';
      return m.forgetAppData('ledger');
    });
    const after = await read();
    check('forgetAppData exists and reports success', () => assert.equal(forgot, true));
    check('after: Ledger\'s saved settings are gone', () => { assert.deepEqual(after.ledger.settings, {}); assert.equal(after.ledger.key, false); });
    check('after: Ledger\'s databases are gone', () => { assert.deepEqual(after.ledger.dbs, []); assert.equal(after.ledger.clips, 0); });
    check('after: another app whose id starts the same keeps everything', () => assert.deepEqual(after.other, before.other));
    // A reinstall starts empty: the boundary module can write fresh data for the same id at revision 0.
    const fresh = await page.evaluate(async () => !!(await window.WizBrowserBoundary.appIdb.commit('ledger', 'clips', [{ o: 'version', v: 1 }, { o: 'store', s: 'clips', keyPath: 'id' }], 0))?.idb);
    check('a reinstalled Ledger starts a fresh database', () => assert.equal(fresh, true));
    // A device that never kept app data: forgetting creates no shell database.
    const page2 = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
    await page2.context().route('**/*', route => { const p = new URL(route.request().url()).pathname; if (p === '/blank') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>blank' }); const f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length))); return fs.existsSync(f) ? route.fulfill({ contentType: type(f), body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); });
    await page2.goto(origin + '/blank');
    const none = await page2.evaluate(async () => { const m = await import('/wizard-os-home/store/store-remove.js'); const r = m.forgetAppData ? await m.forgetAppData('ledger') : 'missing'; return { r, dbs: (await indexedDB.databases()).map(d => d.name) }; });
    check('no shell database is created where there was none', () => { assert.equal(none.r, true); assert.deepEqual(none.dbs, []); });
    check('no page errors', () => assert.deepEqual(errors, []));
    await page.evaluate(([b, a]) => { document.getElementById('out').textContent = 'Before Remove (Ledger): ' + JSON.stringify(b.ledger, null, 1) + '\n\nAfter Remove (Ledger): ' + JSON.stringify(a.ledger, null, 1) + '\n\nOther app (ledger-two) after: ' + JSON.stringify(a.other); }, [before, after]);
    await page.screenshot({ path: path.join(OUT, (BROKEN ? 'before' : 'after') + '-forget.png'), fullPage: true });
  } finally { await browser.close(); }
  const failed = checks.filter(c => !c.ok);
  console.log(JSON.stringify({ mode: BROKEN ? 'main (expect broken)' : 'candidate', passed: checks.length - failed.length, failed }, null, 1));
  if (BROKEN ? failed.length === 0 : failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
