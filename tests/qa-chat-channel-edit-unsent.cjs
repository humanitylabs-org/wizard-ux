'use strict';
// Edit on a Not sent channel post (wizard-ux issue 1294) in a real browser, switch wizard/chat-channels on. Disposable
// synthetic transport only: the channel box's post is saved, then the box refuses its new chat (422), so the post shows
// "Not sent · Retry / Edit". Edit must put the words back into the channel's own box, the window staying on the
// feed: no New chat, no second Chats window. Phone 390x844 and desktop 1440x960 (classic), Nebula.
// QA_EXPECT=broken checks the old behaviour instead (the words leave the channel box), for the Before screenshot.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-edit-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1'], createdAt: iso(now - 9e8) }];
const ROWS = [{ id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Ready.' }, { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 36e5, preview: 'A plan.' }]
  .map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: false, preview: s.preview }));
const WORDS = 'Draft the launch post for Friday';
const report = { origin, web, broken, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) {
      const phone = shell === 'phone', stem = `${shell}-${broken ? 'before' : 'after'}`, entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.chats.view.v1': 'channels', 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
        }, { shell, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            // The box refuses the new chat before any run: the outbox marks the post Not sent with Retry / Edit.
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') return r.fulfill({ status: 422, json: { error: 'Synthetic refusal' } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') {
              for (const op of q.postDataJSON()?.ops || []) { const m = /^spaces\/([a-z0-9-]+)\/threads$/.exec(op.key); if (m && op.op === 'add') prefs.spaces = prefs.spaces.map(s => s.id === m[1] && !s.threads.includes(op.item) ? { ...s, threads: s.threads.concat(op.item) } : s); }
              return r.fulfill({ json: prefs });
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
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Synthetic ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const chatsWins = () => page.evaluate(() => document.querySelectorAll('.win[data-win] [data-chats]').length);
        await vis('.ch-chan-open[data-chchan="launch"]').click();
        const box = vis('[data-chchanform] textarea'); await box.waitFor();
        const wins0 = phone ? 0 : await chatsWins();
        await box.fill(WORDS); await vis('[data-chchanform] .ch-send').click();
        await vis('.ch-pill [data-obedit]').waitFor({ timeout: 20000 });
        entry.pill = (await vis('.ch-pill').innerText()).replace(/\s+/g, ' ').trim();
        assert.match(entry.pill, /Not sent/);
        await nap(300); await page.screenshot({ path: path.join(out, stem + '-not-sent.png') });
        await vis('.ch-pill [data-obedit]').click(); await nap(600);
        await page.screenshot({ path: path.join(out, stem + '-edit.png') });
        const boxNow = page.locator('[data-chchanform] textarea').filter({ visible: true });
        entry.boxText = (await boxNow.count()) ? await boxNow.first().inputValue() : null;
        entry.feedOpen = await page.locator('.ch-chan-feed').filter({ visible: true }).count() > 0;
        if (!phone) { entry.chatsWindows = [wins0, await chatsWins()]; }
        entry.focusInBox = await page.evaluate(() => !!document.activeElement?.closest?.('[data-chchanform]'));
        if (broken) {
          assert.notEqual(entry.boxText, WORDS, 'before the fix the words leave the channel box');
        } else {
          assert.equal(entry.boxText, WORDS, 'the words are back in the channel box');
          assert.equal(entry.feedOpen, true, 'still on the channel feed');
          assert.equal(entry.focusInBox, true, 'the channel box has focus');
          if (!phone) assert.equal(entry.chatsWindows[1], entry.chatsWindows[0], 'no second Chats window');
          assert.equal(await page.locator('.ch-pill').filter({ visible: true }).count(), 0, 'the Not sent bar is gone, with no "Sent" flash');
          assert.equal(await page.locator('.ch-post.sending').filter({ visible: true }).count(), 0, 'no post left saying Sending…');
          await nap(4000); entry.postsLeft = await page.locator('.ch-chan-feed .ch-post').filter({ visible: true, hasText: WORDS }).count();
          if (process.env.QA_DEBUG) console.error(JSON.stringify(await page.evaluate(() => ({ items: [...WosOutbox._items.values()].map(i => ({ id: i.id, state: i.state })), html: [...document.querySelectorAll('.ch-chan-feed .ch-post')].map(x => x.outerHTML.slice(0, 300)) }))));
          await page.screenshot({ path: path.join(out, stem + '-edit-later.png') });
          assert.equal(entry.postsLeft, 0, 'the taken-back post is not left in the feed');
        }
        assert.deepEqual(entry.errors, []); assert.deepEqual(entry.refused.filter(x => x.reason === 'external'), []);
        entry.pass = true;
      } catch (e) { entry.failure = String(e.stack || e); } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.map(c => ({ stem: c.stem, pass: !!c.pass, boxText: c.boxText, chatsWindows: c.chatsWindows, pill: c.pill })), failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 3).join(' | ')) }));
  if (failed.length || report.cases.length !== 2) process.exitCode = 1;
})();
