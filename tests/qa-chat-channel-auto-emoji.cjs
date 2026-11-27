'use strict';
// Auto channel emoji (wizard-ux issue 1580, on for everyone) in a real browser, on the synthetic transport of
// qa-chat-channel-emoji.cjs (nothing reaches a box). Phone 390x844 + desktop 1440x960 (classic Chats window), Nebula + Grove.
// Per case: + New channel, type "Money" / "Podcast" / "Zzzqx" / "🎯 Plans" and Create: the stored names (the one add op
// each) are "💰 Money", "🎙️ Podcast", "Zzzqx" (shown with 💬) and "🎯 Plans" (the owner's own emoji wins), and the list shows
// them. QA_EXPECT=broken with QA_WEB=<a build without it>/web checks every name is stored exactly as typed.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-auto-emoji.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-auto-emoji-evidence');
const off = false, broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [
  { id: 'launch', name: '🚀 Launch', agent: 'hermes', threads: ['qa-l1'], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', agent: 'hermes', threads: ['qa-v1'], createdAt: iso(now - 8e8) },
  { id: 'ideas', name: '💡Ideas', agent: 'hermes', threads: [], createdAt: iso(now - 7e8) },
];
const FIRST = 'Get the launch checklist ready for Friday.', chip = '';
const PNG = fs.readFileSync(path.join(repo, 'web', 'robert-thread-orb.png'));
const ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Which date works?' },
  { id: 'qa-v1', title: 'Voice keys', status: 'completed', at: now - 2 * 36e5, preview: 'Shipped.' },
  { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 4, messageCount: 4, archived: false, preview: s.preview }));
const report = { origin, web, broken, off, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      if (process.env.QA_ONLY && process.env.QA_ONLY !== `${shell}-${skin}`) continue;
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: Number(process.env.QA_PHONE_W) || 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.chats.view.v1': 'channels', 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES });
        let prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            // The channel box's synthetic photo and send (accepted like a box would; nothing leaves the browser).
            if (method === 'POST' && p === '/wizard/files/upload') { const id = 'qa-up-' + entry.writes.length; return r.fulfill({ json: { file: { id, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: PNG.length } } }); }
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { const b = q.postDataJSON() || {}; entry.created = b; return r.fulfill({ json: { session: { id: b.id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { entry.runs = (entry.runs || []).concat(q.postData() || ''); return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs.length } }); }
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') {
              for (const op of q.postDataJSON()?.ops || []) { entry.ops = (entry.ops || []).concat(op); const n = /^spaces\/([a-z0-9-]+)\/name$/.exec(op.key); if (op.op === 'add' && op.key === 'spaces') prefs.spaces = prefs.spaces.concat(op.item); if (n && op.op === 'set') prefs.spaces = prefs.spaces.map(s => s.id === n[1] ? { ...s, name: op.item } : s); }
              for (const op of q.postDataJSON()?.ops || []) { const m = /^spaces\/([a-z0-9-]+)\/threads$/.exec(op.key); if (m && op.op === 'add') prefs.spaces = prefs.spaces.map(s => s.id === m[1] && !s.threads.includes(op.item) ? { ...s, threads: s.threads.concat(op.item) } : s); }
              return r.fulfill({ json: prefs });
            }
            // Channel emoji from a model (issue 1605, on for everyone): a box without the lookup broker answers 503, so 💬 stays.
            if (method === 'POST' && p === '/wizard/v1/channel-emoji') return r.fulfill({ status: 503, json: { error: 'channel_emoji_unavailable' } });
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
          if (p === '/wizard/files/qa-img-1/content' || /^\/wizard\/files\/qa-up-\d+\/content$/.test(p)) return r.fulfill({ body: PNG, contentType: 'image/png' });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const ask = s.id === 'qa-l1' ? FIRST + chip : 'Synthetic ask for ' + s.title;
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: ask, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const menu = async loc => {
          if (!phone) return loc.click({ button: 'right' });
          const b = await loc.boundingBox(), at = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
          await loc.dispatchEvent('pointerdown', at); await nap(650); await loc.dispatchEvent('pointerup', at);
        };
        const tab = vis('[data-chtab="tags"], [data-chview="channels"]'); await tab.waitFor();
        if (await tab.getAttribute('aria-pressed') !== 'true') await tab.click();
        await vis('.ch-chan-open[data-chchan="voice"]').waitFor();
        await page.evaluate(() => document.fonts.ready); await nap(300);
        const lines = () => page.evaluate(() => [...document.querySelectorAll('.ch-chan-open')].filter(b => b.getClientRects().length).map(b => [b.querySelector('.ch-chan-hash')?.textContent || '', b.querySelector('b')?.textContent || '']));
        const TYPED = ['Money', 'Podcast', 'Zzzqx', '🎯 Plans'];
        for (const [i, typed] of TYPED.entries()) {
          await nap(phone ? 800 : 300);
          await vis('.ch-chan-add').click();
          const inp = vis('#chSpaceName'); await inp.waitFor(); await inp.fill(typed);
          if (i === 0) await page.screenshot({ path: path.join(out, stem + '-new.png') });
          await vis('.ch-space-picker [type="submit"]').click();
          await page.waitForFunction(() => !document.querySelector('[data-chspacepicker]'), null, { timeout: 8000 });
          if (i === 0) { await nap(400); await page.screenshot({ path: path.join(out, stem + '-feed.png') }); }
          const back = vis('[data-chchanback]'); await back.waitFor({ timeout: 8000 }); await back.click();
          await vis('.ch-chan-open[data-chchan="voice"]').waitFor();
        }
        entry.stored = (entry.ops || []).filter(o => o.op === 'add' && o.key === 'spaces').map(o => o.item.name);
        await nap(400);
        entry.list = await lines();
        await page.screenshot({ path: path.join(out, stem + '-list.png') });
        if (broken) {
          assert.deepEqual(entry.stored, TYPED, 'a build without it: every name stored exactly as typed');
          entry.pass = true; continue;
        }
        assert.deepEqual(entry.stored, ['💰 Money', '🎙️ Podcast', 'Zzzqx', '🎯 Plans'], 'a fitting emoji in front, none for no match, the owner\'s own kept');
        for (const want of [['💰', 'Money'], ['🎙️', 'Podcast'], ['💬', 'Zzzqx'], ['🎯', 'Plans']]) assert.ok(entry.list.some(l => l[0] === want[0] && l[1] === want[1]), 'list shows ' + want.join(' '));
        assert.deepEqual(entry.errors, []); assert.deepEqual(entry.refused, []);
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.error = String(e.stack || e); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.error ? c.error.split('\n')[0] : JSON.stringify(c.list));
  if (report.cases.some(c => !c.pass)) process.exit(1);
})();
