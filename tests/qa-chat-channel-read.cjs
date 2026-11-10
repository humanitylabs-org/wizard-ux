'use strict';
// Channels read state, reply counts and unread colours (wizard/chat-channels, wizard-ux issue 1266), in a real browser
// on a disposable synthetic transport (no box reads or writes). Phone 390x844 + desktop 1440x960, Nebula + Grove.
// A 14-post # Launch channel: posts 0-7 read, 8-13 unread, post 3 a busy thread (71 stored messages, 2 replies he sees)
// and post 12 needs you. Per case:
//  - the busy post says "2 replies", and no post shows a count of stored messages;
//  - unread posts have a green dot, the needs-you post an amber one, no violet dot anywhere in Channels;
//  - opening the channel and scrolling to the bottom reads every post (the shared /wizard/thread-seen record), with the
//    New line kept on this open; Back: the channel count is gone; re-enter: no New line, no unread markers;
//  - a reload keeps it read (the channel line has no count);
//  - switch off: no Channels, and Activity's own unread dot keeps its colour.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-read.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-read-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const N = 14, READ = 8, BUSY = 3, NEEDS = 12, ids = Array.from({ length: N }, (_, i) => 'qa-r' + String(i).padStart(2, '0'));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ids, createdAt: iso(now - 9e8) }];
const at = i => now - (N - i) * 50 * 6e4;
function history(i) {
  const t = at(i) / 1000, out = [{ role: 'user', content: i === BUSY ? 'I just had a call with Jonathan. Pass the transcript to the philosopher.' : `Post ${i}: the launch plan needs a look.`, timestamp: t - 600 }];
  if (i === BUSY) {
    for (let k = 0; k < 33; k++) out.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + k, function: { name: 'read_file' } }], timestamp: t - 500 }, { role: 'tool', tool_call_id: 'c' + k, content: 'tool output', timestamp: t - 500 });
    out.push({ role: 'assistant', content: 'Sent it to the philosopher.', timestamp: t - 400 }, { role: 'user', content: 'And the summary?', timestamp: t - 300 },
      { role: 'assistant', content: 'Working on it', display_kind: 'commentary', timestamp: t - 200 }, { role: 'assistant', content: 'Here is the summary.', timestamp: t });
  } else out.push({ role: 'assistant', content: `Reply ${i}`, timestamp: t });
  return out;
}
const ROWS = ids.map((id, i) => ({ id, title: 'Post ' + i, runtime: 'direct', status: 'completed', ...(i === NEEDS ? { wizard_attention: { state: 'needs_you', ask: 'Approve the launch plan' } } : {}), updated_at: iso(at(i)), updatedAt: iso(at(i)), last_active: at(i) / 1000,
  last_assistant_at: iso(at(i)), message_count: history(i).length, messageCount: history(i).length, archived: false, preview: `Reply ${i}` }));
const report = { origin, web, cases: [] };
const rgb = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
// A green dot is greener than it is red or blue; amber is redder than it is blue; violet is bluer than it is green.
const greenish = c => { const [r, g, b] = rgb(c); return g > r && g > b; };
const violetish = c => { const [r, g, b] = rgb(c); return b > g + 20 && r > g; };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) for (const mode of ['on', 'off']) {
      const phone = shell === 'phone', on = mode === 'on', stem = `${shell}-${skin}-${mode}`;
      const entry = { stem, errors: [], refused: [], seenPuts: 0 }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
        // Only on the first load: a reload must read the seen state the first visit wrote.
        await context.addInitScript(({ shell, skin, mix, spaces }) => {
          if (window !== top || sessionStorage.getItem('qa.booted')) return; sessionStorage.setItem('qa.booted', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.view.v1': 'channels', 'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        let seen = { initializedAt: 1, threads: Object.fromEntries(ROWS.slice(0, READ).map(s => ['direct:' + s.id, { messageCount: s.messageCount, status: s.status, updatedAt: s.updatedAt, assistantActivityAt: s.last_assistant_at, seenAt: now }])) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') { entry.seenPuts++; const next = q.postDataJSON(); seen = next?.threads ? next : seen; return r.fulfill({ json: { ok: true, state: seen } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const i = ids.indexOf(decodeURIComponent(m[1])), s = ROWS[i]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            if (!m[2]) return r.fulfill({ json: { session: s } });
            const all = history(i), off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 500), page = all.slice(off, off + lim);
            return r.fulfill({ json: { messages: page, pagination: { returned: page.length } } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(String(e.stack || e.message).slice(0, 900)));
        const boot = async () => {
          await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
          if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 }).catch(() => {});
          await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        };
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html')); await boot();
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (!on) {
          await vis('.ch-list [data-chopen]').waitFor();
          assert.equal(await page.locator('.ch-chan-tabs').count(), 0, 'switch off: no Channels tabs');
          await vis('.ch-list .ch-row.unread').waitFor();
          // Activity's own unread marker (its first child), compared with the baseline run on main.
          entry.activityDot = await vis('.ch-list .ch-row.unread').evaluate(e => { const m = e.firstElementChild; const c = m && getComputedStyle(m); return c ? c.backgroundColor + ' / ' + c.color : ''; });
          entry.violet2 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--violet-2').trim());
          await page.screenshot({ path: path.join(out, stem + '.png') });
          assert.deepEqual(entry.errors, [], 'no page errors'); entry.pass = true; continue;
        }
        const chanLine = () => vis('.ch-chan[data-morph-key="chan:launch"]').evaluate(e => ({ unread: e.classList.contains('unread'), n: e.querySelector('.ch-chan-n')?.textContent || '' }));
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor();
        entry.before = await chanLine();
        assert.deepEqual(entry.before, { unread: true, n: String(N - READ) }, 'unread posts counted');
        await page.screenshot({ path: path.join(out, stem + '-list-before.png') });
        await vis('.ch-chan-open[data-chchan="launch"]').click();
        await vis('.ch-chan-h').waitFor();
        await page.waitForFunction(() => !document.querySelector('.ch-post-wait') && [...document.querySelectorAll('.ch-post-r')].some(e => /2 replies/.test(e.textContent)), null, { timeout: 15000 });
        await nap(800);
        const feed = () => page.evaluate(() => {
          // Any CSS colour (oklch too) as rgb(), read back from a 1px canvas.
          const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
          const rgbOf = c => { if (!c || c === 'rgba(0, 0, 0, 0)') return c; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
          const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
          const posts = [...sc.querySelectorAll('.ch-post[data-chrow]')].map(p => ({ id: p.dataset.chrow.split('|')[1], unread: p.classList.contains('unread'), line: p.querySelector('.ch-post-r')?.textContent.replace(/\s+/g, ' ').trim() || '' }));
          const dot = sc.querySelector('.ch-post-r .st.unread'), needs = sc.querySelector('.ch-post-st.needs .ch-chan-dot');
          const dots = [...sc.querySelectorAll('.st, .ch-chan-dot')].map(e => rgbOf(getComputedStyle(e).backgroundColor));
          return { posts, lines: sc.querySelectorAll('.ch-chan-new').length, newColour: sc.querySelector('.ch-chan-new') ? rgbOf(getComputedStyle(sc.querySelector('.ch-chan-new')).color) : '',
            unreadDot: dot ? rgbOf(getComputedStyle(dot).backgroundColor) : '', needsDot: needs ? rgbOf(getComputedStyle(needs).backgroundColor) : '', dots,
            unreadText: (t => t ? { color: getComputedStyle(t).color, weight: getComputedStyle(t).fontWeight } : null)(sc.querySelector('.ch-post-r.unread span:not(.ch-post-st):not(.ch-post-av)')) };
        });
        const first = await feed(); entry.first = { lines: first.lines, unreadDot: first.unreadDot, needsDot: first.needsDot, unreadText: first.unreadText, newColour: first.newColour };
        entry.busyLine = first.posts.find(p => p.id === ids[BUSY])?.line;
        assert.match(entry.busyLine, /2 replies/, 'the Jonathan-style post: the replies he sees');
        for (const p of first.posts) assert.doesNotMatch(p.line, /\b(70|71|3\d|[4-9]\d) (new )?repl/, 'no stored-message counts: ' + p.line);
        assert.equal(first.lines, 1, 'one New line on this open');
        assert.ok(greenish(first.unreadDot), `unread dot is green (${first.unreadDot})`);
        assert.ok(!greenish(first.needsDot) && !violetish(first.needsDot), `needs-you dot is amber (${first.needsDot})`);
        assert.notEqual(first.unreadDot, first.needsDot);
        for (const c of first.dots) assert.ok(!violetish(c), 'no violet dot in Channels: ' + c);
        await page.screenshot({ path: path.join(out, stem + '-open.png') });
        // Scroll to the bottom with real input, then leave.
        await page.mouse.move(phone ? 195 : 400, 500);
        const sc = page.locator('.ch-list > .ch-scroll').filter({ visible: true }).first();
        await sc.evaluate(e => { e.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 4000 })); e.scrollTop = e.scrollHeight; });
        await nap(1200);
        const after = await feed();
        entry.keptMarkers = after.posts.filter(p => p.unread).length;
        assert.equal(after.lines, 1, 'the New line stays on this open');
        entry.seenAfterScroll = await page.evaluate(ids => ids.filter(id => { const s = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('wizard.thread-seen')) || 'null')); return !!s?.threads?.['direct:' + id]; }).length, ids);
        assert.ok(entry.seenPuts > 0, 'the read went to the shared seen record');
        await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor(); await nap(400);
        entry.back = await chanLine();
        assert.deepEqual(entry.back, { unread: false, n: '' }, 'Back: the channel count is gone');
        await page.screenshot({ path: path.join(out, stem + '-list-after.png') });
        await vis('.ch-chan-open[data-chchan="launch"]').click(); await vis('.ch-chan-h').waitFor(); await nap(800);
        const again = await feed(); entry.again = { lines: again.lines, unread: again.posts.filter(p => p.unread).length };
        assert.deepEqual(entry.again, { lines: 0, unread: 0 }, 're-enter: no New line, no unread markers');
        // A reload reads the record back (this device's copy and the box's).
        await page.reload();
        await boot(); await nap(1500);
        // The window comes back as it was left (the feed open): nothing in it is unread, then Back to the channel line.
        if (await page.locator('.ch-chan-h').filter({ visible: true }).count()) {
          const f2 = await feed(); entry.reloadFeed = { lines: f2.lines, unread: f2.posts.filter(p => p.unread).length };
          assert.deepEqual(entry.reloadFeed, { lines: 0, unread: 0 }, 'reload: the feed has nothing unread');
          await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        }
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor(); await nap(600);
        entry.reload = await chanLine();
        assert.deepEqual(entry.reload, { unread: false, n: '' }, 'reload: still read');
        assert.deepEqual(entry.errors, [], 'no page errors');
        assert.deepEqual(entry.refused, [], 'no unexpected requests');
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = String(e.message || e).slice(0, 600); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.failure || '', JSON.stringify({ before: c.before, busy: c.busyLine, first: c.first, kept: c.keptMarkers, back: c.back, again: c.again, reload: c.reload, reloadFeed: c.reloadFeed, errs: c.errors, puts: c.seenPuts, activityDot: c.activityDot, violet2: c.violet2 }));
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
