'use strict';
// wizard-ux issue 1380 in a real browser: Chats is open (Channels list on Spaces) when Channels is switched on, the box's
// channel store answers 404 for its first seconds and then its list (with Alerts), and a channel row holds focus (the
// shells' Live repaint skips a focused list). Alerts must show within 2.5 s of that first answer, not on the next
// unrelated repaint. Phone 412x915 and desktop 1440x900 (Classic and AI apps), Nebula + Grove. Synthetic transport only.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline (Alerts late or never).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-store.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channels-flip-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
// The ui-preferences projection the store serves to older shells: deliberately stale (qa-l1 is in Launch on its row).
const SPACES = [
  { id: 'launch', name: 'Launch', threads: ['qa-l2'], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', threads: ['qa-l1', 'qa-v1'], createdAt: iso(now - 8e8) },
  { id: 'ideas', name: 'Ideas', threads: [], createdAt: iso(now - 7e8) },
];
const CHANNELS = () => [
  { id: 'alerts', agent: 'hermes', name: 'Alerts', order: -1, createdAt: iso(now - 1e8), archived: false, pinned: true, pinOrder: 0, kind: 'alerts' },
  { id: 'launch', agent: 'hermes', name: 'Launch', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: false },
  { id: 'voice', agent: 'hermes', name: 'Voice', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'ideas', agent: 'hermes', name: 'Ideas', order: 2, createdAt: iso(now - 7e8), archived: false, pinned: false },
  { id: 'old-stuff', agent: 'hermes', name: 'Old stuff', order: 3, createdAt: iso(now - 7e8), archived: true, archivedAt: iso(now - 864e5), pinned: false },
];
const raw = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: !!s.archived, preview: s.preview,
  ...(s.channel ? { channel: s.channel } : {}), ...(s.firstRequest ? { firstRequest: s.firstRequest } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const LIVE_ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Which date works?', channel: 'launch', firstRequest: 'Get the launch checklist ready for Friday' },
  { id: 'qa-l2', title: 'Press notes', status: 'running', at: now - 30 * 6e4, preview: 'Drafting…', channel: 'launch', firstRequest: 'Draft the press notes' },
  { id: 'qa-v1', title: 'Voice keys', status: 'completed', at: now - 2 * 36e5, preview: 'Shipped.', channel: 'voice', firstRequest: 'Ship the voice keys' },
  { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.', firstRequest: 'Plan my weekend' },
];
// Only the channel's own list has it: five days old and Done, outside the live list.
const OLD = { id: 'qa-old', title: 'Launch venue', status: 'completed', at: now - 5 * 864e5, preview: 'Booked.', channel: 'launch', firstRequest: 'Find a venue for the launch party' };

const expectBroken = process.env.QA_EXPECT === 'broken', report = { cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const [shell, skin, view] of [['phone', 'nebula', 'classic'], ['phone', 'grove', 'classic'], ['desktop', 'nebula', 'classic'], ['desktop', 'grove', 'ai-apps']]) {
      const phone = shell === 'phone', entry = { stem: `${shell}-${skin}-${view}`, errors: [], timeline: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix, spaces, view }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': view, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.view.v1': 'channels',
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES, view });
        let onAt = Infinity;
        const box = { sort: 'az', channels: CHANNELS(), members: {} };
        for (const s of [...LIVE_ROWS, OLD]) if (s.channel) box.members['hermes|' + s.id] = s.channel;
        const rowsNow = () => LIVE_ROWS.map(s => raw({ ...s, channel: box.members['hermes|' + s.id] }));
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (p.startsWith('/wizard/v1/channels') && Date.now() < onAt) { entry.timeline.push(['404', Date.now() - (isFinite(onAt) ? onAt : Date.now())]); return r.fulfill({ status: 404, json: { error: 'not_found' } }); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
            return r.fulfill({ status: 200, json: {} });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/channels') { entry.timeline.push(['200', Date.now() - onAt]); return r.fulfill({ json: { schema: 'wizard.channels/1', sort: box.sort, migratedAt: iso(now - 864e5), channels: box.channels } }); }
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel');
            const data = [OLD, ...LIVE_ROWS].filter(s => box.members['hermes|' + s.id] === id).sort((a, b) => a.at - b.at).map(s => ({ ...raw({ ...s, channel: id }), listVersion: 1, agent: '', updatedAt: iso(s.at), createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rowsNow(), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...LIVE_ROWS, OLD].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: s.firstRequest, timestamp: s.at / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: s.at / 1000 - 590 }] } : { session: raw(s) } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await nap(1500);
        const order = () => page.locator('.ch-chan-list > .ch-chan .ch-chan-open').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chchan));
        const flip = Date.now();
        await page.evaluate(() => WosExperience.toggle('wizard/chat-channels'));
        onAt = flip + Number(process.env.QA_STORE_DELAY || 3400);
        // Focus inside the list (a tapped channel row, as on a real desk): the shells' Live repaint skips such a list.
        await nap(600);
        entry.focused = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-chats] .ch-chan-open')].find(x => x.offsetParent); b?.focus(); return !!b && document.activeElement === b; });
        assert.ok(entry.focused, 'a channel row holds focus');
        let shown = 0;
        for (const t0 = Date.now(); !shown && Date.now() - t0 < 20000;) { await nap(250); if ((await order()).includes('alerts')) shown = Date.now(); }
        const answered = (entry.timeline.find(t => t[0] === '200') || [])[1];
        entry.afterAnswer = shown && answered != null ? shown - (onAt + answered) : null;
        entry.order = await order();
        await page.screenshot({ path: path.join(out, entry.stem + '-after-flip.png') });
        if (expectBroken) entry.pass = entry.afterAnswer == null || entry.afterAnswer > 2500;
        else {
          assert.ok(entry.afterAnswer != null && entry.afterAnswer <= 2500, `Alerts shows within 2.5 s of the box's first answer (${entry.afterAnswer} ms)`);
          assert.deepEqual(entry.order, ['alerts', 'ideas', 'launch', 'voice', '__general__'], 'the store list: Alerts pinned at the top');
          assert.deepEqual(entry.errors, []);
          entry.pass = true;
        }
      } catch (e) { entry.failure = e.stack; }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  for (const c of report.cases) console.log(c.stem, c.pass ? (expectBroken ? 'BROKEN AS EXPECTED' : 'OK') : 'FAIL', 'Alerts shown ms after the first answer:', c.afterAnswer, c.errors.join(';'), c.failure ? String(c.failure).split('\n')[0] : '');
  if (report.cases.some(c => !c.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
