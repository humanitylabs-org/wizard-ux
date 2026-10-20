// Live preview assets, isolated browser storage and mocked API: no agent run is created.
// NODE_PATH=<playwright-core parent> QA_CHROME=/usr/bin/google-chrome node qa-send-working-race.cjs
// Negative control: QA_CONTROL_REF=80a2cc3 replaces only live.js with pre-fix bytes and must fail.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8806/wizard-os-home/';
const OUT = process.env.QA_ARTIFACTS || '/home/oscar/.hermes/cache/scratch/wizard-send-working';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const now = Date.now(), sid = 'qa-working-race', iso = new Date(now - 60000).toISOString();
    let row = { id: sid, title: 'Working race regression', status: 'completed', model: 'claude-opus-5-5', provider: 'claude-subscription-directsdk-experimental', updated_at: iso, wizard_last_assistant_at: iso, wizard_last_user_at: iso, message_count: 2, latest_message: { role: 'assistant', content: 'Ready for your next message', timestamp: iso } };
    let runBody, key, writes = [], reads = 0;
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await context.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (process.env.QA_CONTROL_REF && u.pathname.endsWith('/wizard-os-home/live.js')) {
        const body = require('node:child_process').execFileSync('git', ['show', `${process.env.QA_CONTROL_REF}:web/live.js`], { encoding: 'utf8' });
        return route.fulfill({ status: 200, contentType: 'application/javascript', body });
      }
      const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      if (req.method() !== 'GET') {
        writes.push({ path: u.pathname, method: req.method() });
        if (u.pathname.endsWith('/v1/runs')) {
          runBody = req.postDataJSON(); key = req.headers()['idempotency-key'];
          await sleep(900);
          return json({ run_id: 'qa-new-run', status: 'queued' });
        }
        return json({ accepted: true });
      }
      if (u.pathname.endsWith('/api/model/options')) return route.continue(); // authoritative installed catalogue
      if (u.pathname.endsWith('/api/sessions')) { reads++; const snapshot = structuredClone(row); await sleep(150); return json({ data: [snapshot], has_more: false }); }
      if (u.pathname.endsWith('/messages')) return json({ data: [{ role: 'user', content: 'Previous request', timestamp: iso }, { role: 'assistant', content: 'Ready for your next message', timestamp: iso }], has_more: false });
      if (u.pathname.endsWith('/api/sessions/' + sid)) return json(row);
      if (u.pathname.startsWith('/wizard/')) return json({ state: {}, data: [], agents: [] });
      return route.continue();
    });
    await page.addInitScript(() => { localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.skin', 'obsidian'); });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__wos?.live?.session('qa-working-race'));
    const wid = await page.evaluate(() => { __wos.openApp({ id: 'wizard', kind: 'chats' }); return Object.values(__wos.wins).find(w => w.app === 'chats').id; });
    await page.evaluate(([wid, sid]) => __wos.openChat(wid, sid), [wid, sid]);
    await page.locator('.win textarea').first().fill('Regression: keep this in Working');
    await page.evaluate(sid => {
      window.raceTrace = []; window.watchSend = false;
      const sample = () => { if (!window.watchSend) return; const s = __wos.live.session(sid); const row = document.querySelector(`[data-chopen="${sid}"]`); const section = row?.closest('[data-sec]')?.dataset.sec; const item = { status: s?.status, section: section || null, pending: s?.pend || null }; if (JSON.stringify(item) !== JSON.stringify(raceTrace.at(-1))) raceTrace.push(item); };
      new MutationObserver(sample).observe(document.body, { subtree: true, childList: true });
      window.raceTimer = setInterval(sample, 10);
      document.addEventListener('click', e => { if (e.target.closest('.ch-send')) window.watchSend = true; }, true);
    }, sid);
    await page.locator('button.ch-send').first().click();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(sid => __wos.live.workGroups().working.some(s => s.id === sid), sid), true, 'Working during delayed admission');
    await page.evaluate(() => __wos.live.refresh()); // stale Ready response during send
    await page.waitForFunction(() => [...WosOutbox._items.values()].some(i => i.state === 'sent'));
    key = await page.evaluate(() => [...WosOutbox._items.values()][0].id);
    assert.ok(runBody, 'real composer reached mocked run endpoint');
    // The newest receipt can be projected before canonical thread status catches up.
    row = { ...row, wizard_last_run_idempotency_key: key, wizard_last_run_id: 'qa-new-run', wizard_last_run_status: 'queued' };
    await page.evaluate(() => __wos.live.refresh());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(sid => __wos.live.workGroups().working.some(s => s.id === sid), sid), true, 'receipt plus stale completed status must not release hold');
    row = { ...row, status: 'running', wizard_run_id: 'qa-new-run', wizard_last_run_status: 'running' };
    await page.evaluate(() => __wos.live.refresh());
    row = { ...row, status: 'completed', wizard_run_id: '', wizard_last_run_idempotency_key: 'old-key', wizard_last_run_id: 'old-run', wizard_last_run_status: 'completed' };
    await page.evaluate(() => __wos.live.refresh());
    assert.equal(await page.evaluate(sid => __wos.live.workGroups().working.some(s => s.id === sid), sid), true, 'late stale poll after running acknowledgement must not return to Ready');
    await page.screenshot({ path: path.join(OUT, 'working-no-flicker.png') });
    const trace = await page.evaluate(() => { clearInterval(raceTimer); watchSend = false; return raceTrace; });
    assert.ok(trace.every(x => x.section !== 'ready' && ['submitting', 'queued', 'running'].includes(x.status)), JSON.stringify(trace));
    row = { ...row, wizard_last_run_idempotency_key: key, wizard_last_run_id: 'qa-new-run', wizard_last_run_status: 'completed', wizard_last_assistant_at: new Date().toISOString() };
    await page.evaluate(() => __wos.live.refresh());
    assert.equal(await page.evaluate(sid => __wos.live.workGroups().ready.some(s => s.id === sid), sid), true, 'matching completion releases to Ready');
    assert.deepEqual(errors, []);
    const report = { base: BASE, trace, writes, reads, errors, realRunsCreated: 0, completed: true };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
