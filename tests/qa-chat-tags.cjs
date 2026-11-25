'use strict';
// Tags (wizard-agent-service issue 608, switch wizard/chat-tags) in a real browser, phone 412 px, Nebula + Obsidian Light.
// Disposable synthetic transport only: a fake box answers /wizard/v1/channels (with `tags: true` while Tags are on),
// PUT /wizard/v1/channels/tags, PUT membership, the Sent log (so the Inbox · Tags · Sent tabs show) and the channel
// feeds; nothing reaches a box. Tags on: the Tags tab lists the tags (pinned first) plus Archived; a chat's Tags… sheet
// shows both its tags ticked, a tap adds or removes one and the sheet stays open; a tag opens today's channel view with
// every chat carrying it; Archived opens the archived chats; Back from a tag returns to Tags and Back never leaves
// Chats. Tags off (the box says nothing about tags): the same chat's sheet is today's "Move to channel" (QA_TAGS=off
// gives only the off cases, the Before shots).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-tags.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-tags-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const CHANNELS = () => [
  { id: 'alerts', agent: 'hermes', name: 'Alerts', order: -1, createdAt: iso(now - 1e8), archived: false, pinned: true, pinOrder: 0, kind: 'alerts' },
  { id: 'philosopher', agent: 'hermes', name: '🧠 Philosopher', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 1 },
  { id: 'wizardos', agent: 'hermes', name: 'WizardOS', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'money', agent: 'hermes', name: '💰 Money', order: 2, createdAt: iso(now - 7e8), archived: false, pinned: false },
];
const ROWS = [
  { id: 'qa-free-will', title: 'Free will and agents', at: now - 2 * 36e5, preview: 'Compatibilism says…', firstRequest: 'Can an agent have free will?', tags: ['philosopher', 'wizardos'] },
  { id: 'qa-stoics', title: 'Stoic mornings', at: now - 5 * 36e5, preview: 'Marcus wrote…', firstRequest: 'What did the Stoics do each morning?', tags: ['philosopher'] },
  { id: 'qa-release', title: 'Release notes', at: now - 3 * 36e5, preview: 'Drafted.', firstRequest: 'Draft the WizardOS release notes', tags: ['wizardos'] },
  { id: 'qa-budget', title: 'Old budget', at: now - 4 * 864e5, preview: 'Done.', firstRequest: 'Sum up last month', tags: ['money'], archived: true },
];
const SENT = [{ id: 'sent_' + 'a'.repeat(24), idempotency_key: null, at: now - 6e4, source: 'orb', text: 'Free will again #philosopher', route: 'agent', decided_by: 'owner_words', rules_matched: ['tag:philosopher'], model: '', tags: ['philosopher'], urgent: false, correction_id: null, thread_id: 'qa-free-will', record_id: null, state: 'done' }];
const report = { origin, web, cases: [] };
const only = process.env.QA_TAGS || '';
(async () => {
  const browser = await chromium.launch();
  try {
    const cases = [['nebula', true], ['obsidian-light', true], ['nebula', false], ['obsidian-light', false]].filter(([, on]) => !only || (only === 'on') === on);
    for (const [skin, tagsOn] of cases) {
      const stem = `phone-${skin}-tags-${tagsOn ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.view.v1': 'channels',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
        }, { skin });
        // The box: membership = primary tag, tagged = the others.
        const box = { channels: CHANNELS(), members: {}, tagged: {} };
        for (const s of ROWS) { box.members['hermes|' + s.id] = s.tags[0]; box.tagged['hermes|' + s.id] = s.tags.slice(1); }
        const tagsOf = id => { const k = 'hermes|' + id; return [...new Set([...(box.members[k] ? [box.members[k]] : []), ...(box.tagged[k] || [])])]; };
        const raw = s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: !!s.archived, preview: s.preview, firstRequest: s.firstRequest, startedAt: iso(s.at - 6e5),
          ...(box.members['hermes|' + s.id] ? { channel: box.members['hermes|' + s.id] } : {}), ...(tagsOn ? { tags: tagsOf(s.id) } : {}) });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: [] };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            const b = q.postDataJSON?.() ?? null; entry.writes.push({ method, path: p, body: b });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: b } });
            if (method === 'PUT' && p === '/wizard/v1/channels/tags' && tagsOn) {
              const k = 'hermes|' + b.sessionId, id = b.add || b.remove, all = tagsOf(b.sessionId).filter(x => x !== id).concat(b.add ? [id] : []);
              box.members[k] = all[0]; if (!all.length) delete box.members[k]; box.tagged[k] = all.slice(1);
              return r.fulfill({ json: { sessionId: b.sessionId, agent: 'hermes', channel: box.members[k] || null, tags: tagsOf(b.sessionId) } });
            }
            if (method === 'PUT' && p === '/wizard/v1/channels/membership') { const k = 'hermes|' + b.sessionId; if (b.channelId) box.members[k] = b.channelId; else delete box.members[k]; box.tagged[k] = []; return r.fulfill({ json: { sessionId: b.sessionId, agent: 'hermes', channel: b.channelId } }); }
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { schema: 'wizard.channel-reads/1', at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: SENT, next: null, check: null } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { schema: 'wizard.channel-reads/1', at: {} } });
          if (p === '/wizard/v1/channels/tags') return tagsOn ? r.fulfill({ json: { sessionId: u.searchParams.get('sessionId'), tags: tagsOf(u.searchParams.get('sessionId')) } }) : r.fulfill({ status: 404, json: { error: 'not_found' } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - 864e5), channels: box.channels.map(c => ({ ...c, count: ROWS.filter(s => (tagsOn ? tagsOf(s.id) : [box.members['hermes|' + s.id]]).includes(c.id)).length })), ...(tagsOn ? { tags: true } : {}) } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel');
            if (!box.channels.some(c => c.id === id)) return r.fulfill({ status: 404, json: { error: 'not_found' } });
            const data = ROWS.filter(s => (tagsOn ? tagsOf(s.id) : [box.members['hermes|' + s.id]]).includes(id)).sort((a, b) => a.at - b.at).map(s => ({ ...raw(s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS.map(raw), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: s.firstRequest, timestamp: s.at / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: s.at / 1000 - 590 }] } : { session: raw(s) } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(() => __wos.openSheet('inbox'));
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const count = sel => page.locator(sel).filter({ visible: true }).count();
        const back = () => page.evaluate(() => __wos.onBack());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(350); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const menu = async loc => {
          const b = await loc.boundingBox(), at = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
          await loc.dispatchEvent('pointerdown', at); await nap(650); await loc.dispatchEvent('pointerup', at);
        };
        const order = () => page.locator('.ch-chan-list > .ch-chan .ch-chan-open').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chchan));
        const tabs = () => page.locator('.ch-tabbar').filter({ visible: true }).first().locator('[role=tab]').evaluateAll(b => b.map(x => `${x.innerText.trim()}${x.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        if (!(await count('.ch-chan-list'))) await vis('.ch-tabbar [data-chtab="tags"]').click();
        await vis('.ch-chan-open[data-chchan="alerts"]').waitFor({ timeout: 10000 });
        entry.tabs = await tabs(); assert.deepEqual(entry.tabs, ['Inbox', 'Tags*', 'Sent']);
        entry.order = await order();
        const feedIds = () => page.locator('.ch-chan-feed .ch-post-b').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        if (!tagsOn) {
          assert.deepEqual(entry.order, ['alerts', 'philosopher', 'money', 'wizardos', '__general__'], 'off: today\'s channel list');
          assert.equal(await count('[data-chchan="__archived__"]'), 0, 'off: no Archived tag view');
          await shot('1-tags-list');
          await vis('.ch-chan-open[data-chchan="philosopher"]').click(); await vis('.ch-chan-h').waitFor();
          await vis('.ch-post-b[data-chopen="qa-stoics"]').waitFor({ timeout: 8000 });
          entry.feed = await feedIds(); assert.deepEqual(entry.feed, ['qa-free-will', 'qa-stoics'].sort((a, b) => ROWS.find(x => x.id === a).at - ROWS.find(x => x.id === b).at));
          await menu(vis('.ch-post-b[data-chopen="qa-free-will"]'));
          entry.sheet = (await vis('.ch-sheet [data-rsspacepicker]').innerText()).trim();
          assert.equal(entry.sheet, 'Move to channel…');
          await vis('.ch-sheet [data-rsspacepicker]').click(); await vis('.ch-space-picker').waitFor();
          entry.title = (await vis('.ch-space-picker header b').innerText()).trim(); assert.equal(entry.title, 'Move to channel');
          entry.ticked = await page.locator('.ch-space-picker [data-spspace][aria-pressed="true"]').evaluateAll(b => b.map(x => x.dataset.spspace));
          assert.deepEqual(entry.ticked, ['philosopher'], 'off: one channel per chat');
          await shot('2-chat-sheet');
          assert.equal(entry.writes.filter(w => w.path === '/wizard/v1/channels/tags').length, 0);
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        // 1. The Tags tab: the box's tags, pinned first (Alerts, Philosopher), then A–Z, General, then Archived.
        assert.deepEqual(entry.order, ['alerts', 'philosopher', 'money', 'wizardos', '__general__', '__archived__']);
        assert.match((await vis('.ch-chan-open[data-chchan="philosopher"]').innerText()).replace(/\s+/g, ' '), /🧠\s*Philosopher/, 'same name and emoji as the channel');
        assert.match(await vis('.ch-chan-add').innerText(), /New tag/);
        await shot('1-tags-list');
        // 2. A tag opens today's channel view with every chat carrying it, also those whose first tag is another.
        await vis('.ch-chan-open[data-chchan="wizardos"]').click(); await vis('.ch-chan-h').waitFor();
        await vis('.ch-post-b[data-chopen="qa-free-will"]').waitFor({ timeout: 8000 });
        entry.wizardosFeed = await feedIds(); assert.deepEqual(entry.wizardosFeed.sort(), ['qa-free-will', 'qa-release']);
        await shot('2-wizardos-feed');
        // 3. Back from a tag returns to Tags.
        await back(); await vis('.ch-chan-list').waitFor({ timeout: 5000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags*', 'Sent'], 'Back from a tag is the Tags tab');
        // 4. On a chat: Tags… shows both tags ticked; a tap adds one, the sheet stays open; a second removes it.
        await vis('.ch-chan-open[data-chchan="philosopher"]').click(); await vis('.ch-post-b[data-chopen="qa-stoics"]').waitFor({ timeout: 8000 });
        entry.philosopherFeed = await feedIds(); assert.deepEqual(entry.philosopherFeed.sort(), ['qa-free-will', 'qa-stoics']);
        await menu(vis('.ch-post-b[data-chopen="qa-free-will"]'));
        entry.sheet = await page.locator('.ch-sheet button').filter({ visible: true }).evaluateAll(b => b.map(x => x.innerText.trim()));
        assert.ok(entry.sheet.includes('Tags…'), JSON.stringify(entry.sheet));
        assert.ok(entry.sheet.includes('Remove tag · 🧠 Philosopher') && entry.sheet.includes('Remove tag · WizardOS'), JSON.stringify(entry.sheet));
        await vis('.ch-sheet [data-rsspacepicker]').click(); await vis('.ch-space-picker').waitFor();
        entry.title = (await vis('.ch-space-picker header b').innerText()).trim(); assert.equal(entry.title, 'Tags');
        const ticked = () => page.locator('.ch-space-picker [data-spspace][aria-pressed="true"]').evaluateAll(b => b.map(x => x.dataset.spspace).sort());
        entry.ticked = await ticked(); assert.deepEqual(entry.ticked, ['philosopher', 'wizardos'], 'both tags ticked');
        await shot('3-chat-tags');
        await vis('.ch-space-picker [data-spspace="money"]').click(); await nap(400);
        assert.equal(await count('.ch-space-picker'), 1, 'the sheet stays open');
        entry.afterAdd = await ticked(); assert.deepEqual(entry.afterAdd, ['money', 'philosopher', 'wizardos']);
        await shot('4-chat-tag-added');
        await vis('.ch-space-picker [data-spspace="wizardos"]').click(); await nap(400);
        entry.afterRemove = await ticked(); assert.deepEqual(entry.afterRemove, ['money', 'philosopher']);
        entry.tagWrites = entry.writes.filter(w => w.path === '/wizard/v1/channels/tags').map(w => w.body);
        assert.deepEqual(entry.tagWrites, [{ sessionId: 'qa-free-will', agent: 'hermes', add: 'money' }, { sessionId: 'qa-free-will', agent: 'hermes', remove: 'wizardos' }]);
        assert.equal(entry.writes.filter(w => w.path === '/wizard/v1/channels/membership').length, 0, 'never a move');
        await page.keyboard.press('Escape'); await nap(200);
        if (await count('.ch-space-picker')) await vis('[data-spclose]').click();
        // 5. Back from the tag: Tags again. Back once more is the shell's own Back (Chats closes to Home, as today);
        // the app itself never exits (onBack says it handled it).
        await back(); await nap(300);
        await vis('.ch-chan-list').waitFor({ timeout: 5000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags*', 'Sent']);
        entry.lastBack = await page.evaluate(() => __wos.onBack()); await nap(400);
        assert.notEqual(entry.lastBack, false, 'Back never exits the app');
        await page.evaluate(() => __wos.openSheet('inbox')); await vis('.ch-tabbar').waitFor({ timeout: 5000 });
        if (!(await count('.ch-chan-list'))) await vis('.ch-tabbar [data-chtab="tags"]').click();
        await vis('.ch-chan-list').waitFor({ timeout: 5000 });
        // 6. Archived is a tag view.
        await vis('.ch-chan-open[data-chchan="__archived__"]').click();
        await vis('.ch-post-b[data-chopen="qa-budget"]').waitFor({ timeout: 8000 });
        entry.archived = await feedIds(); assert.deepEqual(entry.archived, ['qa-budget']);
        assert.equal(await count('[data-chchanform]'), 0, 'Archived takes no new posts: no message box');
        await shot('5-archived');
        await back(); await vis('.ch-chan-list').waitFor({ timeout: 5000 });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
