'use strict';
// Inline action cards in chat (wizard-ux issue 1463, on for everyone) in a real browser. A disposable
// synthetic transport (no box is read or written) and a stand-in Messenger that keeps three proposed actions under its
// own api/actions/<id> (wizard-os spec/APP_ACTIONS.md, wizard.app-actions/1). A thread whose replies carry
// [WIZARD_ACTION_V1] markers. Phone 412x915 and desktop 1440x900 (Classic), Nebula.
//   Each marker is a card (also with an old saved "off" for the removed switch wizard/action-cards) with the app's own preview; Edit changes the message, Send POSTs the
//     edited field with X-Wizard-Action: 1 and the card reads "Approved"; Reject on the second; Open in app opens
//     Messenger at that item's own page; an item the app no longer has says so; no marker text anywhere.
//   Agent parity: the same card in a routed thread of each kind (a host profile, a container and a restricted agent,
//     served by /sessions?agent=): it reads the same app item path, Send posts and the card reads Approved.
//   QA_EXPECT=broken (QA_WEB=<main worktree>/web) records
//     main's thread text (the marker shows as raw text there).
// Screens in QA_OUT: <shell>.png (+ -edit, -approved).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-action-cards.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-action-cards-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const APP = { id: 'wizard-messenger', name: 'Messenger', url: '/wizard-messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const MARK = id => `[WIZARD_ACTION_V1]${JSON.stringify({ app: APP.id, id })}[/WIZARD_ACTION_V1]`;
const ACTIONS = () => ({
  'draft-1': { schema: 'wizard.app-actions/1', id: 'draft-1', kind: 'Draft reply', title: 'Reply to Sam', body: 'In your chat with Sam', state: 'pending', open: '?thread=sam', approve_label: 'Send',
    fields: [{ id: 'to', label: 'To', value: 'Sam' }, { id: 'text', label: 'Message', value: 'Sounds good, see you at 7!', editable: true, multiline: true }] },
  'draft-2': { schema: 'wizard.app-actions/1', id: 'draft-2', kind: 'Draft reply', title: 'Reply to Dana', state: 'pending', open: '?thread=dana', approve_label: 'Send',
    fields: [{ id: 'text', label: 'Message', value: 'Can we move it to Friday?', editable: true }] },
});
const REPLY1 = `I drafted a reply to Sam in Messenger:\n\n${MARK('draft-1')}\n\nSend it as is, or change it first.`;
const REPLY2 = `And one for Dana, plus an older one:\n\n${MARK('draft-2')}\n${MARK('gone-3')}`;
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const KINDS = [['host', 'Host ops'], ['container', 'Box'], ['restricted', 'Locked']];
for (const [id, label] of KINDS) AGENTS.push({ id, label, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: id[0], hue: 120 }, model: { provider: 'anthropic', model: 'claude-opus-4' } });
const routedRow = id => ({ id: 'qa-act-' + id, title: 'Draft from ' + id, runtime: 'direct', status: 'completed', updated_at: iso(now - 9e4), updatedAt: iso(now - 9e4), last_active: (now - 9e4) / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'A draft for you' });
const ROUTED = Object.fromEntries(KINDS.map(([id]) => [id, [routedRow(id)]]));
const routedDraft = id => ({ schema: 'wizard.app-actions/1', id: 'draft-' + id, kind: 'Draft reply', title: 'Reply to ' + id, state: 'pending', approve_label: 'Send', fields: [{ id: 'text', label: 'Message', value: 'From the ' + id + ' agent', editable: true }] });
const ROW = { id: 'qa-act', title: 'Messenger drafts', runtime: 'direct', status: 'completed', updated_at: iso(now - 6e4), updatedAt: iso(now - 6e4), last_active: (now - 6e4) / 1000, message_count: 4, messageCount: 4, archived: false, preview: REPLY2 };
const PAGE = `<!doctype html><meta charset="utf-8"><title>Messenger</title><body style="font:16px system-ui;padding:24px"><h1>Messenger (stand-in)</h1><p id="at"></p><script>window.seenAt = location.search; document.getElementById('at').textContent = 'Open: ' + (location.search || 'home');</script></body>`;
const report = { origin, web, expect: EXPECT, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) {
      const phone = shell === 'phone', stem = `${shell}${EXPECT === 'broken' ? '-main' : ''}`;
      const entry = { stem, errors: [], refused: [], app: [] }; report.cases.push(entry);
      const actions = { ...ACTIONS(), ...Object.fromEntries(KINDS.map(([id]) => ['draft-' + id, routedDraft(id)])) };
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, app }) => {
          if (window !== top) return;
          localStorage.setItem('wux.apps.v1', JSON.stringify([app]));
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/action-cards': false } }) })) localStorage.setItem(k, v);
        }, { shell, app: APP });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          const am = /^\/wizard-messenger\/api\/actions\/([^/]+)$/.exec(p);
          if (am) {
            const id = decodeURIComponent(am[1]), a = actions[id], h = q.headers();
            entry.app.push({ method, id, header: h['x-wizard-action'] || '', body: method === 'POST' ? q.postDataJSON() : null });
            if (!a) return r.fulfill({ status: 404, json: { error: 'not_found' } });
            if (method === 'GET') return r.fulfill({ json: a });
            if (method !== 'POST' || h['x-wizard-action'] !== '1') return r.fulfill({ status: 403, json: { error: 'forbidden' } });
            const b = q.postDataJSON() || {};
            if (a.state !== 'pending') return r.fulfill({ status: 409, json: a });
            await nap(400);
            if (b.decision === 'approve') { for (const f of a.fields) if (b.fields && typeof b.fields[f.id] === 'string' && f.editable) f.value = b.fields[f.id]; a.state = 'approved'; a.message = `Sent to ${a.title.replace(/^Reply to /, '')}`; }
            else if (b.decision === 'reject') a.state = 'rejected';
            else return r.fulfill({ status: 400, json: { error: 'bad_decision' } });
            return r.fulfill({ json: a });
          }
          if (p === APP.url || p === APP.url + 'index.html') return r.fulfill({ body: PAGE, contentType: 'text/html' });
          if (p.startsWith(APP.url)) return r.fulfill({ json: {} });
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP] } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROUTED[u.searchParams.get('agent')] || [ROW], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          const routed = m && KINDS.find(([id]) => decodeURIComponent(m[1]) === 'qa-act-' + id);
          if (routed) { const [id] = routed; entry.routedReads = [...new Set([...(entry.routedReads || []), id + ':' + (u.searchParams.get('agent') || '')])];
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Draft a reply', timestamp: now / 1000 - 100 }, { role: 'assistant', content: `Here it is:\n\n${MARK('draft-' + id)}`, timestamp: now / 1000 - 90 }] } : { session: ROUTED[id][0] } }); }
          if (m) { if (decodeURIComponent(m[1]) !== ROW.id) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Answer Sam and Dana for me', timestamp: now / 1000 - 120 }, { role: 'assistant', content: REPLY1, timestamp: now / 1000 - 110 },
              { role: 'user', content: 'Anything else?', timestamp: now / 1000 - 70 }, { role: 'assistant', content: REPLY2, timestamp: now / 1000 - 60 }] } : { session: ROW } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        // The removed switch's old saved choice is cleared from this device (core/experience.js GONE).
        entry.staleCleared = await page.evaluate(() => !Object.hasOwn(JSON.parse(localStorage.getItem('wos.skin-tweaks.v1') || '{}').mix || {}, 'wizard/action-cards'));
        if (EXPECT !== 'broken') assert.equal(entry.staleCleared, true, 'old saved choice cleared');
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const listRow = page.locator('.ch-list [data-chopen="qa-act"]').filter({ visible: true }).first();
        await listRow.waitFor({ timeout: 15000 });
        entry.listText = await listRow.innerText();
        await listRow.click();
        const thread = page.locator('.ch-thread').filter({ visible: true }).first();
        await page.locator('.ch-thread .msg.a').filter({ hasText: 'one for Dana' }).first().waitFor({ timeout: 15000 });
        await nap(1500);
        entry.threadText = (await thread.innerText()).slice(0, 1500);
        const cards = page.locator('.ch-thread [data-action-card]').filter({ visible: true });
        if (EXPECT === 'broken') {
          entry.cards = await cards.count();
          await page.locator('.ch-thread .msg.a').first().scrollIntoViewIfNeeded().catch(() => {});
          await page.screenshot({ path: path.join(out, stem + '.png') });
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        // On: three cards, the app's own words, no marker text anywhere.
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread [data-action-card]')].filter(n => n.getClientRects().length).every(n => !/Loading from/.test(n.textContent)) , null, { timeout: 10000 });
        entry.threadText = (await thread.innerText()).slice(0, 1500);
        assert.equal(await cards.count(), 3, 'three cards');
        assert.doesNotMatch(entry.threadText + entry.listText, /WIZARD_ACTION|"app":/, 'marker never shows as text');
        assert.match(entry.threadText, /I drafted a reply to Sam in Messenger:[\s\S]*Send it as is, or change it first\.[\s\S]*Messenger · Draft reply[\s\S]*Reply to Sam[\s\S]*Sounds good, see you at 7!/);
        const c1 = page.locator('.ch-thread [data-action-card="wizard-messenger/draft-1"]').filter({ visible: true }).first();
        const c2 = page.locator('.ch-thread [data-action-card="wizard-messenger/draft-2"]').filter({ visible: true }).first();
        const c3 = page.locator('.ch-thread [data-action-card="wizard-messenger/gone-3"]').filter({ visible: true }).first();
        entry.buttons = await c1.locator('[data-act]').allInnerTexts();
        assert.deepEqual(entry.buttons, ['Send', 'Edit', 'Open in app', 'Reject']);
        assert.match(await c3.innerText(), /This item is no longer in Messenger\./);
        entry.look = await c1.evaluate(n => ({ bg: getComputedStyle(n).backgroundImage, w: n.getBoundingClientRect().width, vw: innerWidth }));
        assert.ok(/gradient/.test(entry.look.bg), 'opaque card');
        assert.ok(entry.look.w <= entry.look.vw, 'card fits the screen');
        await c1.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(out, stem + '.png') });
        // Edit: the message becomes a text box; change it; Send sends the edited words.
        await c1.locator('[data-act="edit"]').click();
        const box = c1.locator('textarea[data-act-field="text"]');
        await box.waitFor(); assert.equal(await box.inputValue(), 'Sounds good, see you at 7!');
        await box.fill('Sounds good, see you at 8!');
        entry.editButtons = await c1.locator('[data-act]').allInnerTexts();
        await page.screenshot({ path: path.join(out, stem + '-edit.png') });
        await c1.locator('[data-act="approve"]').click();
        await page.waitForFunction(() => /Approved/.test(document.querySelector('.ch-thread [data-action-card="wizard-messenger/draft-1"]')?.textContent || ''), null, { timeout: 8000 });
        const post1 = entry.app.find(x => x.method === 'POST' && x.id === 'draft-1');
        assert.deepEqual(post1, { method: 'POST', id: 'draft-1', header: '1', body: { decision: 'approve', fields: { text: 'Sounds good, see you at 8!' } } });
        entry.c1After = await c1.innerText();
        assert.match(entry.c1After, /✓ Approved · Sent to Sam/); assert.match(entry.c1After, /see you at 8!/);
        assert.deepEqual(await c1.locator('[data-act]').allInnerTexts(), ['Open in app'], 'done: only Open in app');
        await page.screenshot({ path: path.join(out, stem + '-approved.png') });
        // Reject the second.
        await c2.scrollIntoViewIfNeeded(); await c2.locator('[data-act="reject"]').click();
        await page.waitForFunction(() => /Rejected/.test(document.querySelector('.ch-thread [data-action-card="wizard-messenger/draft-2"]')?.textContent || ''), null, { timeout: 8000 });
        assert.deepEqual(entry.app.find(x => x.method === 'POST' && x.id === 'draft-2')?.body, { decision: 'reject' });
        // Agent parity: a routed thread of each kind draws the same card from the same app item and sends the same way.
        entry.routed = {};
        for (const [id] of KINDS) {
          const sid = 'qa-act-' + id, key = `wizard-messenger/draft-${id}`;
          await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
          const row = page.locator(`.ch-list [data-chopen="${sid}"]`).filter({ visible: true }).first();
          for (let i = 0; i < 20 && !(await row.isVisible().catch(() => false)); i++) { const back = page.locator('.ch-back').filter({ visible: true }).first(); if (await back.isVisible().catch(() => false)) await back.click().catch(() => {}); await nap(300); }
          await row.click();
          const rc = page.locator(`.ch-thread [data-action-card="${key}"]`).filter({ visible: true }).first();
          await rc.waitFor({ timeout: 10000 });
          await page.waitForFunction(k => /Reply to/.test(document.querySelector(`.ch-thread [data-action-card="${k}"]`)?.textContent || ''), key, { timeout: 10000 });
          await rc.locator('[data-act="approve"]').click();
          await page.waitForFunction(k => /Approved/.test([...document.querySelectorAll(`.ch-thread [data-action-card="${k}"]`)].find(n => n.getClientRects().length)?.textContent || ''), key, { timeout: 8000 });
          const post = entry.app.find(x => x.method === 'POST' && x.id === 'draft-' + id);
          assert.deepEqual(post, { method: 'POST', id: 'draft-' + id, header: '1', body: { decision: 'approve' } }, id + ': Send posts the same decision');
          entry.routed[id] = (await rc.innerText()).replace(/\s+/g, ' ');
          assert.match(entry.routed[id], /Reply to \w+ .*From the \w+ agent.*✓ Approved/, id);
        }
        await page.screenshot({ path: path.join(out, stem + '-routed.png') });
        // Back to the first thread for Open in app.
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        for (let i = 0; i < 20 && !(await listRow.isVisible().catch(() => false)); i++) { const back = page.locator('.ch-back').filter({ visible: true }).first(); if (await back.isVisible().catch(() => false)) await back.click().catch(() => {}); await nap(300); }
        await listRow.click(); await c2.waitFor({ timeout: 10000 }); await c2.scrollIntoViewIfNeeded();
        // Open in app: Messenger opens at that item's own page.
        await c2.locator('[data-act="open"]').click();
        let at = null;
        for (let i = 0; i < 40 && !at; i++) { for (const f of page.frames()) { try { const u = new URL(f.url()); if (u.pathname === APP.url) at = await f.evaluate(() => window.seenAt).catch(() => null); } catch (_) {} } if (!at) await nap(200); }
        entry.openedAt = at;
        assert.equal(at, '?thread=dana', 'Messenger opened at the item');
        await page.screenshot({ path: path.join(out, stem + '-open.png') });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, `report-${EXPECT}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
