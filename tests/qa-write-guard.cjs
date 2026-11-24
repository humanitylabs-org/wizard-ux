'use strict';
// wizard-ux issue 1439: the shell's write guard (core/write-guard.js, switch wizard/write-guard, off by default),
// in the real phone and desktop shells on a synthetic box (nothing leaves the test).
// Per shell, switch off and on:
//   - loop: the box never keeps one thread-seen record. A fixture feature in the page does what the shell did before
//     wizard-ux#1429 (issue 1428): every 300 ms it reads /wizard/thread-seen and, when the record is missing, PUTs the
//     whole state again. Off: it goes on the wire every time. On: the first write and at most one resend, then nothing.
//     The shell's own thread-seen resend (live.js) is counted apart and stays at most one.
//   - burst: 25 different PATCHes in a few seconds to one endpoint. On: 20 reach the box, the rest get a local 429 with
//     Retry-After, and one bug report goes to the Feedback app (endpoint, rate, build). Off: all 25, no report.
//   - box limit: the box answers 429 Retry-After: 3. On: nothing goes to that endpoint for 3 s. Off: every write goes.
// QA_OUT=<dir> keeps report.json and a Settings screenshot per case. QA_SHELLS=phone|desktop, QA_SECS (loop length).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://write-guard.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const out = process.env.QA_OUT || ''; if (out) fs.mkdirSync(out, { recursive: true });
const SECS = Number(process.env.QA_SECS || 25), ID = 'wizard/write-guard', LOST = 'direct:lost';
const now = Date.now(), sec = Math.floor(now / 1000);
const row = (id, n) => ({ id, title: 'Chat ' + id, runtime: 'direct', status: 'completed', updated_at: new Date(now - n * 60000).toISOString(), updatedAt: new Date(now - n * 60000).toISOString(), message_count: 2, messageCount: 2, archived: false, preview: 'Hi.' });
const ROWS = [row('a', 1), row('b', 2), row('lost', 3)];
const nap = ms => new Promise(r => setTimeout(r, ms));
const report = { root, cases: [] };

async function run(browser, shell, on) {
  const phone = shell === 'phone', entry = { shell, on, errors: [], writes: [] }; report.cases.push(entry);
  const c = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce',
    ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  try {
    await c.routeWebSocket('**/*', ws => ws.close());
    await c.addInitScript(({ shell, LOST, now, on, ID }) => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.channel.v1': 'latest' })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
      localStorage.setItem('wizard.thread-seen.v1:wizard-account-local', JSON.stringify({ initializedAt: 1, threads: { [LOST]: { seenAt: now, assistantActivityAt: now - 180000 } } }));
      localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: on ? { [ID]: true } : {}, defaultsMigrated: true, machinesHomeMoved: true }));
    }, { shell, LOST, now, on, ID });
    let kept = { initializedAt: 1, threads: {} }, limitedUntil = 0;
    await c.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
      if (u.pathname.includes('/v1/runs')) return r.abort();
      if (!['GET', 'HEAD'].includes(q.method())) {
        entry.writes.push({ t: Date.now(), m: q.method(), p: u.pathname, s: u.search, body: u.pathname === '/feedback/api/feedback' ? q.postDataJSON() : undefined });
        if (u.pathname === '/wizard/thread-seen') {   // never keeps LOST
          const s = q.postDataJSON(); const threads = { ...(s.threads || {}) }; delete threads[LOST];
          kept = { initializedAt: s.initializedAt, threads }; return r.fulfill({ json: { state: kept } });
        }
        if (u.pathname === '/wizard/v1/qa-limited' && !limitedUntil) { limitedUntil = 1; return r.fulfill({ status: 429, headers: { 'Retry-After': '3' }, json: { error: 'client_storm' } }); }
        if (u.pathname === '/feedback/api/feedback') return r.fulfill({ status: 201, json: { sent: 'Thanks', item: { id: 1 } } });
        if (u.pathname === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ json: { version: 'qa-2' } });
        return r.fulfill({ json: {} });
      }
      if (u.pathname === '/wizard/thread-seen') return r.fulfill({ json: { state: kept } });
      if (u.pathname === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: {}, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
      if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{ id: 'feedback', name: 'Feedback', url: '/feedback/', source: 'apps.json', type: 'service', category: 'app' }] } });
      if (u.pathname === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
      if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (u.pathname === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
      if (/\/messages$/.test(u.pathname)) return r.fulfill({ json: { messages: [{ role: 'user', content: 'Hello', timestamp: sec - 300 }, { role: 'assistant', content: 'Hi.', timestamp: sec - 200 }] } });
      if (u.pathname.startsWith('/feedback/')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Feedback</title>' });
      if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
      if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, decodeURIComponent(u.pathname.slice(prefix.length)) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); return r.fulfill({ status: 404, body: 'none' }); }
      return r.fulfill({ json: {} });
    });
    const p = await c.newPage(); p.on('pageerror', e => entry.errors.push(e.message));
    await p.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
    await p.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
    await p.waitForFunction(() => window.WizLive?.sessions?.length >= 3, null, { timeout: 20000 });
    entry.switchOn = await p.evaluate(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), ID);
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('wux.apps.v1') || '[]') || []).some(a => a.id === 'feedback'), null, { timeout: 10000 });
    // 1. loop: the pre-#1429 resend, through the page's own fetch (tagged ?qa-loop so it is counted apart)
    entry.loopTicks = await p.evaluate(async ({ LOST, ms }) => {
      let n = 0; const end = Date.now() + ms;
      while (Date.now() < end) {
        n++;
        const box = await (await fetch('/wizard/thread-seen', { cache: 'no-store' })).json();
        if (!box.state?.threads?.[LOST]) await fetch('/wizard/thread-seen?qa-loop=1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') }).catch(() => {});
        await new Promise(r => setTimeout(r, 300));
      }
      return n;
    }, { LOST, ms: SECS * 1000 });
    const seen = entry.writes.filter(w => w.p === '/wizard/thread-seen');
    entry.loopPuts = seen.filter(w => w.s === '?qa-loop=1').length;
    entry.shellPuts = seen.filter(w => w.s !== '?qa-loop=1').length;
    entry.loopTimes = seen.filter(w => w.s === '?qa-loop=1').map(w => w.t);
    // 2. burst: 25 different PATCHes to one endpoint
    entry.burst = await p.evaluate(async () => {
      const st = [];
      for (let i = 0; i < 25; i++) { const r = await fetch('/wizard/v1/qa-burst', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: i }) }); st.push([r.status, r.headers.get('Retry-After')]); await new Promise(r => setTimeout(r, 60)); }
      return st;
    });
    await nap(800);
    entry.burstOnWire = entry.writes.filter(w => w.p === '/wizard/v1/qa-burst').length;
    entry.reports = entry.writes.filter(w => w.p === '/feedback/api/feedback').map(w => w.body);
    // 3. the box asks to wait 3 s
    entry.limited = await p.evaluate(async () => {
      const st = [], t0 = Date.now();
      for (let i = 0; i < 20; i++) { const r = await fetch('/wizard/v1/qa-limited', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: i }) }); st.push([Date.now() - t0, r.status]); await new Promise(r => setTimeout(r, 200)); }
      return st;
    });
    const lim = entry.writes.filter(w => w.p === '/wizard/v1/qa-limited').map(w => w.t);
    entry.limitedGapMs = lim.length > 1 ? lim[1] - lim[0] : null; entry.limitedOnWire = lim.length;
    entry.stats = await p.evaluate(() => window.WosWriteGuard?.stats() || null);
    // the Settings row for the switch (Before/After shots)
    if (out) {
      const row = p.locator(`[data-tweak-toggle="${ID}"]`).filter({ visible: true }).first();
      for (const page of ['try-features', 'appearance']) {
        await p.evaluate(page => (window.__wux?.openSettings || window.__wos?.openSettings)(page), page).catch(() => {}); await nap(1200);
        if (await row.count()) break;
      }
      if (await row.count()) { await row.scrollIntoViewIfNeeded(); await nap(300); entry.settingsRow = await row.getAttribute('aria-checked'); }
      await p.screenshot({ path: path.join(out, `${shell}-${on ? 'on' : 'off'}-settings.png`) });
    }
    return entry;
  } finally { await c.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of (process.env.QA_SHELLS || 'phone,desktop').split(',')) {
      const off = await run(browser, shell, false);
      assert.deepEqual(off.errors, [], `${shell} off: no page errors`);
      assert.equal(off.switchOn, false);
      assert.ok(off.loopPuts >= off.loopTicks - 2 && off.loopPuts > 20, `${shell} off: the looping write goes out every time (${off.loopPuts}/${off.loopTicks})`);
      assert.equal(off.burstOnWire, 25, `${shell} off: all 25 burst writes reach the box`);
      assert.deepEqual(off.reports, [], `${shell} off: no bug report`);
      assert.equal(off.limitedOnWire, 20, `${shell} off: every write goes even after the box asked to wait`);
      assert.deepEqual(off.stats, {}, `${shell} off: the guard counted nothing`);
      const on = await run(browser, shell, true);
      assert.deepEqual(on.errors, [], `${shell} on: no page errors`);
      assert.equal(on.switchOn, true, `${shell}: the switch is on`);
      assert.ok(on.loopPuts >= 1 && on.loopPuts <= 2, `${shell} on: the never-kept record is sent once and resent at most once (${on.loopPuts} of ${on.loopTicks} tries)`);
      if (on.loopPuts === 2) assert.ok(on.loopTimes[1] - on.loopTimes[0] >= 10000, `${shell} on: the resend comes after 10 s`);
      assert.ok(on.shellPuts <= 1, `${shell} on: the shell's own resend stays at most one (${on.shellPuts})`);
      assert.equal(on.burstOnWire, 20, `${shell} on: 20 burst writes reach the box`);
      assert.deepEqual(on.burst.slice(20).map(s => s[0]), [429, 429, 429, 429, 429], `${shell} on: the rest get a 429`);
      assert.equal(on.burst[20][1], '30', `${shell} on: with Retry-After 30`);
      assert.equal(on.reports.length, 1, `${shell} on: one bug report through Feedback`);
      assert.equal(on.reports[0].kind, 'bug');
      assert.match(on.reports[0].text, new RegExp(`PATCH /wizard/v1/qa-burst went out 21 times in one minute on this ${shell}`));
      assert.match(on.reports[0].text, /\nBuild: \S{1,60}\n/, 'a short build id');
      assert.ok(on.limitedGapMs >= 2900, `${shell} on: nothing goes to the limited endpoint for 3 s (gap ${on.limitedGapMs} ms)`);
      assert.ok(on.limited.filter(([t, s]) => t < 2800).every(([, s]) => s === 429), `${shell} on: callers get a 429 meanwhile`);
    }
    if (out) fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS write guard: identical resends dropped (one resend, then none), bursts paused with one report, box Retry-After honoured; switch off unchanged; phone + desktop');
  } catch (e) { if (out) fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
