'use strict';
// wizard-ux issue 1362 second re-review in a real browser: while the Agent Service holds new sends for a graceful
// restart (wizard/graceful-restart on, /wizard/health restart.holding), a message sent then is saved, not Working:
//   1. an existing chat: no "Working · Ns" line in the thread, one quiet "Saved · sends after Wizard restarts" line;
//   2. a new chat: the same, and its header shows the saved clock, not the working spinner;
//   3. the Chats list: both under a Saved heading, Working counts only the chat that really runs;
//   4. the restart note beside the message box stays through thread repaints (sampled every second, no gaps).
// Phone 412x915 (classic). Synthetic transport only (no box is reached): the run POST answers 202 queued with
// queue_reason restart_pending, as the Agent Service does during a hold (wizard-agent-service docs/graceful-restart.md).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://graceful-restart-held.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'graceful-restart-held-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const row = (id, title, status, at) => ({ id, title, runtime: 'direct', status, updated_at: iso(at), updatedAt: iso(at), last_active: at / 1000, message_count: 2, messageCount: 2, preview: 'Working on it.' });
const HOLD = { phase: 'waiting', holding: true, reason: 'update', active: 1, held: 1, oldest_active_s: 40, wait_until: iso(now + 6e5) };
(async () => {
  const browser = await chromium.launch(), report = {};
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
  const rows = [row('qa-long', 'Long research', 'running', now - 6e5), row('qa-done', 'Weekend plans', 'completed', now - 36e5)];
  const said = new Map(); // session id -> the owner's words sent during the hold
  const runs = [];
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(() => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/graceful-restart': true } }) })) localStorage.setItem(k, v);
    });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (p === '/wizard/health') return r.fulfill({ json: { status: 'ok', restart: HOLD } });
      if (method === 'POST' && p === '/wizard/hermes/api/sessions') {
        const b = q.postDataJSON() || {}; if (b.id && !rows.some(s => s.id === b.id)) rows.unshift(row(b.id, 'New chat', 'queued', Date.now()));
        return r.fulfill({ json: { session: { id: b.id } } });
      }
      if (method === 'POST' && p === '/wizard/hermes/v1/runs') {
        const b = q.postDataJSON() || {}, sid = b.session_id || b.sessionId || '';
        runs.push(sid); said.set(sid, String(b.input || b.message || b.text || 'sent during the hold'));
        const s = rows.find(x => x.id === sid); if (s) { s.status = 'queued'; s.updated_at = s.updatedAt = iso(Date.now()); }
        return r.fulfill({ status: 202, json: { run_id: 'wizardq_held_' + runs.length, status: 'queued', queue_reason: 'restart_pending' } });
      }
      if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
      if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) {
        const s = rows.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
        const msgs = s.id === 'qa-done' ? [{ role: 'user', content: 'Plan the weekend', timestamp: now / 1000 - 3600 }, { role: 'assistant', content: 'Here is a plan.', timestamp: now / 1000 - 3590 }] : [];
        if (said.has(s.id)) msgs.push({ role: 'user', content: said.get(s.id), timestamp: Date.now() / 1000 - 2 });
        return r.fulfill({ json: m[2] ? { messages: msgs } : { session: s } });
      }
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage();
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.WizReach?.restart?.()?.phase === 'waiting', null, { timeout: 20000 });
    const vis = sel => page.locator(sel).filter({ visible: true }).first();
    const thread = async () => page.evaluate(() => {
      const box = [...document.querySelectorAll('.ch-msgs')].find(el => el.getClientRects().length);
      const head = [...document.querySelectorAll('.ch-head .emo.sti')].find(el => el.getClientRects().length);
      return { working: /Working ·|Working\b/.test([...(box?.querySelectorAll('.steps.live summary') || [])].map(x => x.textContent).join(' ')),
        held: !!box?.querySelector('[data-restart-held]'), head: head ? [...head.classList].find(c => !['emo', 'sti'].includes(c)) : '',
        note: !![...document.querySelectorAll('[data-restart-notice]')].find(el => el.getClientRects().length) };
    });
    const sample = async (label, n = 12) => {
      const got = [];
      for (let i = 0; i < n; i++) { got.push(await thread()); await nap(1000); }
      const res = { label, workingShown: got.filter(x => x.working).length, heldLine: got.filter(x => x.held).length, noteGaps: got.filter(x => !x.note).length, head: got.at(-1).head, samples: n };
      report[label] = res; console.log(JSON.stringify(res));
      return res;
    };
    // 1. an existing chat
    await page.evaluate(() => window.__wos.openWizardThread('qa-done'));
    await vis('.ch-compose textarea').waitFor({ timeout: 15000 });
    await vis('.ch-compose textarea').fill('Add sandwiches');
    await vis('.ch-compose .ch-send').click();
    await page.waitForFunction(() => [...(window.WosOutbox?._items?.values() || [])].some(it => it.state === 'sent'), null, { timeout: 15000 });
    await nap(3000);
    const existing = await sample('existing chat');
    await page.screenshot({ path: path.join(out, `existing-chat-${broken ? 'before' : 'after'}.png`) });
    // 2. a new chat
    await page.evaluate(() => window.__wos.openSheet('inbox'));
    await nap(800);
    await vis('.ch-fab').click();
    await vis('.ch-compose textarea').waitFor({ timeout: 15000 });
    await vis('.ch-compose textarea').fill('Find a ferry time');
    await vis('.ch-compose .ch-send').click();
    await page.waitForFunction(() => [...(window.WosOutbox?._items?.values() || [])].filter(it => it.state === 'sent').length >= 2, null, { timeout: 15000 }).catch(() => {});
    await nap(3000);
    // The send may leave the thread (send-and-go): open the new chat again if the list is in front.
    const newId = runs.find(x => x && x !== 'qa-done');
    if (newId) await page.evaluate(id => window.__wos.openWizardThread(id), newId);
    await nap(2000);
    const fresh = await sample('new chat', 8);
    await page.screenshot({ path: path.join(out, `new-chat-${broken ? 'before' : 'after'}.png`) });
    // 3. the Chats list
    await page.evaluate(() => window.__wos.openSheet('inbox'));
    await nap(1500);
    const list = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('.ch-sec[data-sec]')].filter(el => el.getClientRects().length);
      const of = k => secs.find(s => s.dataset.sec === k);
      const ids = s => [...(s?.querySelectorAll('[data-chopen]') || [])].map(x => x.dataset.chopen);
      return { sections: secs.map(s => s.dataset.sec), working: ids(of('working')), workingCount: of('working')?.querySelector('.ch-sec-h small')?.textContent || '', saved: ids(of('saved')) };
    });
    report.list = list; report.runs = runs; console.log(JSON.stringify(list));
    await page.screenshot({ path: path.join(out, `list-${broken ? 'before' : 'after'}.png`) });
    assert.equal(runs.length, 2, 'both sends reached the (synthetic) service');
    if (broken) {
      assert.ok(existing.workingShown > 0 || fresh.workingShown > 0 || list.working.length > 1, 'main shows a held send as Working');
    } else {
      for (const r of [existing, fresh]) {
        assert.equal(r.workingShown, 0, `${r.label}: no Working line in the thread`);
        assert.ok(r.heldLine >= r.samples - 1, `${r.label}: the saved line shows`);
        assert.equal(r.head, 'held', `${r.label}: header shows the saved clock`);
        assert.equal(r.noteGaps, 0, `${r.label}: the restart note never goes missing`);
      }
      assert.deepEqual(list.working, ['qa-long'], 'Working holds only the chat that really runs');
      assert.equal(list.workingCount, '1');
      assert.deepEqual([...list.saved].sort(), [...runs].sort(), 'both held sends under Saved');
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(broken ? 'baseline confirmed: held sends show as Working on main' : 'ok: held sends read as saved in the thread, header and list; the note stays');
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
