'use strict';
// An agent's post in a channel feed (Alerts) shows its inline markdown, never raw "**" (wizard/chat-channels,
// wizard-ux issue 1287). Real browser, disposable synthetic transport (no box reads or writes). Phone 412x915 +
// desktop 1440x900, Nebula + Grove. # Alerts holds one post the agent started ("**Bold point.** rest …" with a link).
// Pass: the post shows "Bold point." in <strong> with no asterisks, the link is an <a>, and tapping it opens the link
// (a new tab) without opening the thread. QA_EXPECT=broken (run against main's web with QA_WEB) asserts the bug:
// the asterisks are on screen and there is no link.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-md.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-md-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const LINK = 'https://example.com/report';
const SAID = `**Disk is 91% full on the box.** Old backups take most of it; details in ${LINK} and the \`backups\` folder.`;
const report = { origin, web, expect: broken ? 'broken' : 'fixed', cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const t0 = Date.now() - 60e3, SPACES = [{ id: 'alerts', name: 'Alerts', agent: 'hermes', threads: ['qa-alert'], createdAt: iso(t0 - 9e8) }];
        await context.addInitScript(({ shell, skin, spaces }) => {
          if (window !== top || sessionStorage.getItem('qa.booted')) return; sessionStorage.setItem('qa.booted', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.view.v1': 'channels', 'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
        }, { shell, skin, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        const alert = { id: 'qa-alert', title: 'Disk space alert', runtime: 'direct', status: 'completed', updated_at: iso(t0), last_active: t0 / 1000, last_assistant_at: iso(t0), message_count: 1, preview: SAID, archived: false };
        const hist = { 'qa-alert': [{ role: 'assistant', content: SAID, timestamp: t0 / 1000 }] };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { if (q.url() !== LINK) entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [alert], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const id = decodeURIComponent(m[1]); if (id !== alert.id) return r.fulfill({ status: 404, json: { error: 'missing' } });
            if (!m[2]) return r.fulfill({ json: { session: alert } });
            // A real box answers the first message a moment after the list, so the feed paints a loading post first and
            // then repaints it with the words (the repaint that doubled the words on main).
            await nap(Number(process.env.QA_HIST_DELAY || 1500));
            const all = hist[id], off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim);
            return r.fulfill({ json: { messages: page, pagination: { returned: page.length } } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); await page.clock.install(); page.on('pageerror', e => entry.errors.push(String(e.stack || e.message).slice(0, 900)));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis('.ch-chan-open[data-chchan="alerts"]').click(); await vis('.ch-chan-h').waitFor();
        const t = vis('.ch-post.by-agent .ch-post-t:not(.ch-post-wait)'); await t.waitFor(); await nap(800);
        const seen = await t.evaluate(el => ({ text: el.textContent, strong: el.querySelector('strong')?.textContent || '', link: el.querySelector('a[href]')?.getAttribute('href') || '', code: el.querySelector('code')?.textContent || '', strongWeight: el.querySelector('strong') ? getComputedStyle(el.querySelector('strong')).fontWeight : '', inButton: !!el.querySelector('a[href]')?.closest('button'), focusable: (() => { const a = el.querySelector('a[href]'); if (!a) return false; a.focus(); return document.activeElement === a; })() }));
        entry.seen = seen;
        // Repaints (live ticks, focus, a resize) must keep one words block per agent post: the header button and the
        // words share a morph key, and main inserted a second copy of the words on repaint (issue 1287 review).
        const words = () => page.evaluate(() => [...document.querySelectorAll('.ch-post.by-agent')].filter(e => e.getClientRects().length).map(e => e.querySelectorAll('.ch-post-tb').length));
        entry.words = [await words()];
        for (let i = 0; i < 3; i++) {
          await page.clock.fastForward('01:05'); await nap(1200); // the minute tick repaints the feed's relative times
          entry.words.push(await words());
          if (i === 0) await page.screenshot({ path: path.join(out, stem + '-repaint' + (process.env.QA_TAG || '') + '.png') });
        }
        entry.doubled = entry.words.some(w => w.some(n => n !== 1));
        await page.screenshot({ path: path.join(out, stem + (broken ? '-before' : '') + '.png') });
        if (broken) {
          assert.ok(seen.text.includes('**Disk is 91% full'), 'main shows the raw asterisks');
          assert.equal(seen.link, '', 'main has no tappable link');
          if (process.env.QA_BROKEN === 'doubled') assert.ok(entry.doubled, 'main shows the agent words twice after a repaint: ' + JSON.stringify(entry.words));
        } else {
          assert.ok(!seen.text.includes('*'), 'no asterisks on screen: ' + seen.text);
          assert.equal(entry.doubled, false, 'one words block per agent post after every repaint: ' + JSON.stringify(entry.words));
          assert.equal(seen.strong, 'Disk is 91% full on the box.');
          assert.ok(Number(seen.strongWeight) >= 600, 'the first sentence is bold: ' + seen.strongWeight);
          assert.equal(seen.link, LINK, 'the link is a link');
          assert.equal(seen.code, 'backups');
          assert.equal(seen.inButton, false, 'the link is not inside the post button');
          assert.equal(seen.focusable, true, 'the link takes keyboard focus');
          // Tapping the link opens it (a new tab) and does not open the thread.
          const popup = context.waitForEvent('page', { timeout: 5000 });
          await vis('.ch-post.by-agent .ch-post-t a[href]').click();
          const tab = await popup; entry.opened = tab.url(); await tab.close().catch(() => {});
          await nap(600);
          entry.threadOpened = await page.evaluate(() => [...document.querySelectorAll('.ch-msgs .bub')].some(e => e.getClientRects().length));
          assert.equal(entry.threadOpened, false, 'the link tap did not open the thread');
          assert.ok(await vis('.ch-chan-feed').isVisible(), 'the feed is still on screen after the link tap');
          // Tapping the post's words (not the link) still opens its thread.
          await vis('.ch-post.by-agent .ch-post-tb strong').click(); await nap(800);
          entry.threadAfterWords = await page.evaluate(() => [...document.querySelectorAll('.ch-msgs .bub')].some(e => e.getClientRects().length));
          assert.ok(entry.threadAfterWords, 'tapping the post still opens its thread');
        }
        assert.deepEqual(entry.errors, [], 'no page errors');
        assert.deepEqual(entry.refused, [], 'no unexpected requests');
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = String(e.message || e).slice(0, 600); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.failure || '', JSON.stringify({ words: c.words, seen: c.seen, opened: c.opened, linkOpenedThread: c.threadOpened, thread: c.threadAfterWords, errs: c.errors, refused: c.refused }));
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
