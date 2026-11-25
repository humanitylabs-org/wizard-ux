'use strict';
// Signal sweep card buttons (wizard-ux issue 1586; on for everyone since wizard-ux issue 1778, no switch) in a real browser, built on the Open /
// Send to inbox harness (tests/qa-agent-inbox-open-send.cjs). Disposable synthetic transport only: a fake box serves a
// Daily thread whose history ends with the card row (display_kind agent_sweep, as wizard-agent-service
// server/agent-sweep.mjs cardRow() adds it), keeps the inbox records, answers PATCH /wizard/v1/agent-inbox/<id>,
// POST /wizard/v1/agent-inbox/<card>/yes-to-all and GET /wizard/v1/agent-inbox/sweep from them.
// Phone 390x844 and Classic desktop 1440x960, Nebula + Grove:
//   1. the card shows with its buttons (one per token + Later), Open to confirm, the age badge and Yes to all;
//   2. a token tap sends exactly one PATCH {action:'answer', option}, and the item then shows its answer;
//   3. Yes to all sends one POST and leaves the confirm item to the owner;
//   4. a live skin change repaints the card.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://agent-inbox-sweep.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'agent-inbox-sweep-card-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const CARD = 'sweep_' + 'c'.repeat(24), A = 'inbox_' + 'a'.repeat(24), B = 'inbox_' + 'b'.repeat(24), D = 'inbox_' + 'd'.repeat(24);
const THREADS = {
  'qa-daily-1': { title: 'Daily · Thu 19 Nov', at: now - 5 * M, hidden: false, msgs: [['user', 'signal sweep', 0], ['assistant', 'The card is posted below.', 30]] },
  'qa-chat-1': { title: 'Weekend plans', at: now - 20 * M, hidden: false, msgs: [['user', 'What should we do on Saturday?', 0], ['assistant', 'A walk by the river, then the market.', 60]] },
  'qa-worker-1': { title: 'Lisbon flights', at: now - 3 * M, hidden: true, msgs: [['user', 'Research flights to Lisbon by Friday', 0], ['assistant', 'Two fares left: 9:40 or 13:10?', 120]] },
  'qa-worker-2': { title: 'Pay the plumber', at: now - 9 * M, hidden: true, msgs: [['user', 'Pay the plumber when the invoice comes', 0], ['assistant', 'Invoice is here: send €120?', 120]] },
  'qa-worker-3': { title: 'Dentist slot', at: now - 12 * M, hidden: true, msgs: [['user', 'Find a dentist slot', 0], ['assistant', 'Tuesday 10:00 or Thursday 16:00?', 120]] },
};
const recordsFresh = () => ({
  [A]: { id: A, agent: 'hermes', thread_id: 'qa-worker-1', title: 'Lisbon flights', ask: 'Book the 9:40 or the 13:10 flight on Friday?', recommendation: 'The 9:40: €40 cheaper and you land before lunch', options: ['early', 'late'], default_option: 'early', confirm: false, seen: 2, state: 'surfaced' },
  [B]: { id: B, agent: 'hermes', thread_id: 'qa-worker-2', title: 'Pay the plumber', ask: 'Send €120 to Rui Plumbing now?', recommendation: 'Yes: the invoice matches the quote', options: ['yes', 'no'], default_option: 'yes', confirm: true, seen: 1, state: 'surfaced' },
  [D]: { id: D, agent: 'hermes', thread_id: 'qa-worker-3', title: 'Dentist slot', ask: 'Tuesday 10:00 or Thursday 16:00?', recommendation: 'Tuesday: your calendar is free', options: ['tuesday', 'thursday'], default_option: 'tuesday', confirm: false, seen: 1, state: 'surfaced' },
});
// The card as cardView() serves it.
const cardView = recs => {
  const items = Object.values(recs).map(r => ({ id: r.id, agent: r.agent, thread_id: r.thread_id, title: r.title, ask: r.ask, recommendation: r.recommendation, options: r.options.map(token => ({ token })), default_option: r.default_option, confirm: r.confirm, seen: r.seen, link: `/wizard-os-home/?session=${r.thread_id}`, state: r.state, ...(r.answer ? { answer: r.answer } : {}) }));
  const yes = items.filter(i => !i.confirm && (i.state === 'surfaced' || i.state === 'new')).length;
  return { schema: 'wizard.agent-sweep/1', id: CARD, at: now - 2 * M, day: '2026-11-19', thread_id: 'qa-daily-1', agent: 'hermes',
    waiting: { items, more: 0, link: '/wizard-os-home/?inbox=waiting' },
    done: { items: [{ id: 'inbox_' + 'f'.repeat(24), title: 'Tax form filed', link: '/wizard-os-home/?session=qa-chat-1' }], more: 0, link: '/wizard-os-home/?inbox=done' },
    running: { count: 2, stale: 1, link: '/wizard-os-home/?inbox=running' }, later: { count: 3, link: '/wizard-os-home/?inbox=later' }, parked: { count: 0, link: '/wizard-os-home/?inbox=parked' },
    missing: 0, yes_to_all: { count: yes, skipped: items.filter(i => i.confirm && i.state === 'surfaced').length } };
};
const cardRow = recs => { const v = cardView(recs); return { id: v.id, role: 'assistant', session_id: v.thread_id, timestamp: v.at / 1000, display_kind: 'agent_sweep', content: '**Signal sweep**\n\n**Waiting on you** (3)\n1. Lisbon flights: Book the 9:40 or the 13:10 flight on Friday?', agent_sweep: v }; };
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.hidden ? { hidden: true } : {}) });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], answers: [], yesToAll: 0, sweepReads: 0, inboxReads: 0 }; report.cases.push(entry);
      const recs = recordsFresh();
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            const ans = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && ans) {
              const body = q.postDataJSON(), rec = recs[ans[1]]; entry.answers.push({ id: ans[1], ...body });
              await nap(600);
              if (!rec) return r.fulfill({ status: 404, json: { error: 'not_found' } });
              if (body.option === 'later') rec.state = 'new'; else { rec.state = 'answered'; rec.answer = body.option; }
              return r.fulfill({ json: { record: rec, run_id: 'run_1' } });
            }
            if (method === 'POST' && p === `/wizard/v1/agent-inbox/${CARD}/yes-to-all`) {
              entry.yesToAll++;
              const answered = [];
              for (const rec of Object.values(recs)) if (!rec.confirm && (rec.state === 'surfaced' || rec.state === 'new')) { rec.state = 'answered'; rec.answer = rec.default_option; answered.push({ id: rec.id, option: rec.default_option, run_id: 'run_x' }); }
              await nap(600);
              return r.fulfill({ json: { answered, card: cardView(recs) } });
            }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/agent-inbox/sweep') { entry.sweepReads++; return r.fulfill({ json: { card: cardView(recs) } }); }
          if (p === '/wizard/v1/agent-inbox') { entry.inboxReads++; return r.fulfill({ json: { records: [], check: null, stay: ['qa-daily-1'] } }); }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = THREADS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600, rows = s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt }));
            // The Service adds the card as the last row of the Daily thread's newest page.
            if (m[2] && id === 'qa-daily-1') rows.push(cardRow(recs));
            return r.fulfill({ json: m[2] ? { messages: rows } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        await vis('.ch-list [data-chopen="qa-daily-1"]').click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('The card is posted below.').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready); await nap(500);
        const card = vis('.ch-sweep');
        await card.waitFor({ timeout: 8000 });
        await card.scrollIntoViewIfNeeded();
        const buttons = id => page.locator(`.ch-sweep [data-chsweep="${id}"]`).filter({ visible: true }).evaluateAll(b => b.map(x => { const r = x.getBoundingClientRect(); return { opt: x.dataset.opt, text: x.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; }));
        entry.before = { a: await buttons(A), b: await buttons(B), d: await buttons(D) };
        assert.deepEqual(entry.before.a.map(b => b.opt), ['early', 'late', 'later']);
        assert.deepEqual(entry.before.d.map(b => b.opt), ['tuesday', 'thursday', 'later']);
        assert.deepEqual(entry.before.b, [], 'the confirm item has no answer buttons');
        assert.ok([...entry.before.a, ...entry.before.d].every(b => b.h >= 44 && b.w >= 44), 'tappable: ' + JSON.stringify(entry.before));
        assert.equal(await card.locator('.ch-sw-confirm').innerText(), 'Open to confirm');
        assert.equal(await card.locator('.ch-sw-age').innerText(), 'Sweep 2');
        assert.match(await card.locator('[data-chsweepall]').innerText(), /Yes to all \(2\)/);
        await page.screenshot({ path: path.join(out, stem + '-1-card.png') });
        await card.screenshot({ path: path.join(out, stem + '-1-card-only.png') });
        // Live skin change.
        const colour = () => card.evaluate(n => getComputedStyle(n).backgroundColor + ' / ' + getComputedStyle(n.querySelector('[data-chsweep]')).backgroundColor);
        entry.colour = await colour();
        const other = skin === 'nebula' ? 'grove' : 'nebula';
        await page.evaluate(s => WosSkin.set(s), other); await nap(700);
        entry.colourOther = await colour();
        assert.notEqual(entry.colourOther, entry.colour, `the ${other} skin repaints the card (${entry.colour} → ${entry.colourOther})`);
        await card.screenshot({ path: path.join(out, stem + '-2-live-skin-' + other + '.png') });
        await page.evaluate(s => WosSkin.set(s), skin); await nap(500);
        // 2. A token tap: one PATCH, Sending… at once, then the answer.
        await vis(`.ch-sweep [data-chsweep="${A}"][data-opt="early"]`).click();
        entry.sending = await vis(`.ch-sweep [data-chsweep="${A}"][data-opt="early"]`).innerText().catch(() => '');
        await card.getByText('Answered: Early').waitFor({ timeout: 6000 });
        assert.deepEqual(entry.answers, [{ id: A, action: 'answer', option: 'early' }], 'exactly one PATCH with the token');
        assert.deepEqual(await buttons(A), [], 'the answered item has no buttons');
        assert.ok(entry.sweepReads >= 1, 'the card is read again after the tap');
        assert.match(await card.locator('[data-chsweepall]').innerText(), /Yes to all \(1\)/);
        await card.screenshot({ path: path.join(out, stem + '-3-answered.png') });
        // 3. Yes to all: one POST; the confirm item stays for the owner.
        await vis('.ch-sweep [data-chsweepall]').click();
        await card.getByText('Answered: Tuesday').waitFor({ timeout: 6000 });
        assert.equal(entry.yesToAll, 1, 'one Yes to all request');
        assert.equal(entry.answers.length, 1, 'Yes to all sends no per-item PATCH');
        assert.equal(await page.locator('.ch-sweep [data-chsweepall]').count(), 0, 'nothing left for Yes to all');
        assert.equal(await card.locator('.ch-sw-confirm').count(), 1, 'the confirm item still waits');
        await page.screenshot({ path: path.join(out, stem + '-4-yes-to-all.png') });
        // 5. Links: no ?inbox= list link (those views don't exist yet, they show as text); Running opens the Running view.
        assert.equal(await page.locator('.ch-sweep a[href*="?inbox="]').count(), 0, 'no dead ?inbox= links on the card');
        assert.match(await card.locator('.ch-sw-n').innerText(), /Later and FYI: 3/);
        await vis('.ch-sweep [data-chsweeprunning]').click();
        await vis('.ch-run-h').waitFor({ timeout: 6000 });
        entry.runningView = true;
        await page.screenshot({ path: path.join(out, stem + '-5-running-view.png') });
        assert.deepEqual(entry.refused, [], 'nothing refused');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
