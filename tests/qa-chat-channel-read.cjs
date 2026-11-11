'use strict';
// Channels read state, reply counts and indicators (wizard/chat-channels, wizard-ux issues 1266 and 1269), in a real
// browser on a disposable synthetic transport (no box reads or writes). Phone 390x844 + desktop 1440x960, on Nebula,
// Grove and the Light skin. A 14-post # Launch channel: posts 0-7 read, 8-13 unread, post 3 a busy thread (71 stored
// messages, 2 replies he sees), post 5 working, post 9 a long thread whose view=wizard first page holds 46 rows while
// the service returned 50 (14 replies), and post 12 needs you. Per case (issue 1269 overrides 1266's "seeing reads"):
//  - the channel line has one slot at the right, before the chevron: spinner, amber, green, in that order; no number pill;
//  - the busy post says "2 replies" and the long one "14 replies"; no post shows a count of stored messages;
//  - unread posts say "● N new replies" at the right of their reply line (the needs-you slot), with no left-side dot;
//    the green is bright (contrast >= 3 against the base) and apart from amber, and nothing is violet;
//  - viewing the feed, scrolling to the bottom, Back, re-entering and a reload all keep every green dot (no seen write);
//  - opening one post clears only that post's dot, and the channel's count drops by one;
//  - switch off: no Channels, and Activity's own unread dot keeps its colour.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-read.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-read-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const N = 14, READ = 8, BUSY = 3, WORKING = 5, LONG = 9, NEEDS = 12, ids = Array.from({ length: N }, (_, i) => 'qa-r' + String(i).padStart(2, '0'));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ids, createdAt: iso(now - 9e8) }];
const at = i => now - (N - i) * 50 * 6e4;
function history(i) {
  const t = at(i) / 1000, out = [{ role: 'user', content: i === BUSY ? 'I just had a call with Jonathan. Pass the transcript to the philosopher.' : `Post ${i}: the launch plan needs a look.`, timestamp: t - 600 }];
  if (i === LONG) {
    // 14 answers he sees (one per follow-up), each after two tool calls: 84 stored rows.
    for (let k = 0; k < 14; k++) {
      if (k) out.push({ role: 'user', content: `And ${k}?`, timestamp: t - 450 + k });
      for (const c of ['a', 'b']) out.push({ role: 'assistant', content: '', tool_calls: [{ id: c + k, function: { name: 'search' } }], timestamp: t - 500 + k }, { role: 'tool', tool_call_id: c + k, content: 'tool output', timestamp: t - 500 + k });
      out.push({ role: 'assistant', content: `Finding ${k}`, timestamp: t - 400 + k });
    }
    return out;
  }
  if (i === BUSY) {
    for (let k = 0; k < 33; k++) out.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + k, function: { name: 'read_file' } }], timestamp: t - 500 }, { role: 'tool', tool_call_id: 'c' + k, content: 'tool output', timestamp: t - 500 });
    out.push({ role: 'assistant', content: 'Sent it to the philosopher.', timestamp: t - 400 }, { role: 'user', content: 'And the summary?', timestamp: t - 300 },
      { role: 'assistant', content: 'Working on it', display_kind: 'commentary', timestamp: t - 200 }, { role: 'assistant', content: 'Here is the summary.', timestamp: t });
  } else out.push({ role: 'assistant', content: `Reply ${i}`, timestamp: t });
  return out;
}
const ROWS = ids.map((id, i) => ({ id, title: 'Post ' + i, runtime: 'direct', status: i === WORKING ? 'running' : 'completed', ...(i === NEEDS ? { wizard_attention: { state: 'needs_you', ask: 'Approve the launch plan' } } : {}), updated_at: iso(at(i)), updatedAt: iso(at(i)), last_active: at(i) / 1000,
  last_assistant_at: iso(at(i)), message_count: history(i).length, messageCount: history(i).length, archived: false, preview: `Reply ${i}` }));
const report = { origin, web, cases: [] };
const rgb = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
// A green dot is greener than it is red or blue; amber is redder than it is blue; violet is bluer than it is green.
const greenish = c => { const [r, g, b] = rgb(c); return g > r && g > b; };
const violetish = c => { const [r, g, b] = rgb(c); return b > g + 20 && r > g; };
const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove', 'obsidian-light']) for (const mode of ['on', 'off']) {
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
            const all = history(i), off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 500), raw = all.slice(off, off + lim);
            // The service's view=wizard page drops some rows it returned (here 4 tool results of the long thread).
            const page = i === LONG && off === 0 && lim < 500 ? raw.filter((x, k) => !(x.role === 'tool' && k < 12)) : raw;
            return r.fulfill({ json: { messages: page, pagination: { returned: raw.length } } }); }
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
        // The channel line: bold, and its markers in one slot at the right, just before the chevron.
        const chanLine = () => vis('.ch-chan[data-morph-key="chan:launch"]').evaluate(e => {
          const ind = e.querySelector('.ch-chan-ind'), name = e.querySelector('.ch-chan-open b'), x = e.querySelector('.ch-chan-x'), open = e.querySelector('.ch-chan-open');
          const box = n => n?.getBoundingClientRect();
          return { unread: e.classList.contains('unread'), pill: !!e.querySelector('.ch-chan-n, small'),
            order: ind ? [...ind.children].map(c => c.classList.contains('ch-spin') ? 'spin' : c.classList.contains('new') ? 'green' : 'amber') : [],
            label: ind?.querySelector('.new')?.getAttribute('aria-label') || '',
            beside: [...open.children].filter(c => c !== ind && !c.matches('b, .ch-chan-hash, .ch-chan-pin')).length,
            gapToChevron: ind ? Math.round(box(x).left - box(ind).right) : null, gapFromName: ind ? Math.round(box(ind).left - box(name).right) : null };
        });
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor();
        entry.before = await chanLine();
        assert.deepEqual(entry.before.order, ['spin', 'amber', 'green'], 'spinner, amber, green, in that order');
        assert.equal(entry.before.label, `${N - READ} unread`);
        assert.equal(entry.before.pill, false, 'no number pill');
        assert.equal(entry.before.beside, 0, 'nothing beside the name');
        assert.ok(entry.before.gapToChevron >= 0 && entry.before.gapToChevron <= 12, 'the slot sits just before the chevron: ' + entry.before.gapToChevron);
        assert.ok(entry.before.gapFromName > 20, 'right-aligned, away from the name: ' + entry.before.gapFromName);
        await nap(600); await page.screenshot({ path: path.join(out, stem + '-list-before.png') });
        await vis('.ch-chan-open[data-chchan="launch"]').click();
        await vis('.ch-chan-h').waitFor();
        await page.waitForFunction(() => !document.querySelector('.ch-post-wait') && [...document.querySelectorAll('.ch-post-r')].some(e => /14 replies/.test(e.textContent)), null, { timeout: 15000 }).catch(() => {});
        await nap(800);
        const feed = () => page.evaluate(() => {
          // Any CSS colour (oklch too) as rgb(), read back from a 1px canvas.
          const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
          const rgbOf = c => { if (!c || c === 'rgba(0, 0, 0, 0)') return c; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
          const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
          const posts = [...sc.querySelectorAll('.ch-post[data-chrow]')].map(p => {
            const r = p.querySelector('.ch-post-r'), nw = r?.querySelector('.ch-post-st.new'), t = r?.querySelector('time');
            return { id: p.dataset.chrow.split('|')[1], unread: !!nw, line: r?.textContent.replace(/\s+/g, ' ').trim() || '', right: nw && t ? (b => b.left >= t.getBoundingClientRect().right - 1 || b.top >= t.getBoundingClientRect().bottom - 1)(nw.getBoundingClientRect()) : null, leftDot: !!r?.querySelector('.st') };
          });
          const nw = sc.querySelector('.ch-post-st.new'), needs = sc.querySelector('.ch-post-st.needs .ch-chan-dot');
          const probe = Object.assign(document.createElement('i'), { style: 'background: var(--wz-base, var(--bg))' }); sc.appendChild(probe); const base = rgbOf(getComputedStyle(probe).backgroundColor); probe.remove();
          const dots = [...sc.querySelectorAll('.st, .ch-chan-dot')].map(e => rgbOf(getComputedStyle(e).backgroundColor));
          return { posts, lines: sc.querySelectorAll('.ch-chan-new').length, base,
            newText: nw ? rgbOf(getComputedStyle(nw).color) : '', newDot: nw ? rgbOf(getComputedStyle(nw.querySelector('.ch-chan-dot')).backgroundColor) : '', needsDot: needs ? rgbOf(getComputedStyle(needs).backgroundColor) : '', dots };
        });
        const first = await feed(); entry.first = { lines: first.lines, newText: first.newText, newDot: first.newDot, needsDot: first.needsDot, base: first.base };
        entry.busyLine = first.posts.find(p => p.id === ids[BUSY])?.line; entry.longLine = first.posts.find(p => p.id === ids[LONG])?.line;
        assert.match(entry.busyLine, /2 replies/, 'the Jonathan-style post: the replies he sees');
        assert.match(entry.longLine, /14 replies/, 'the long thread (first page returned full): every reply');
        for (const p of first.posts) assert.doesNotMatch(p.line, /\b(70|71|3\d|[4-9]\d) (new )?repl/, 'no stored-message counts: ' + p.line);
        const unreadN = posts => posts.filter(p => p.unread).length;
        assert.equal(unreadN(first.posts), N - READ, 'every unread post says so');
        for (const p of first.posts) { assert.equal(p.leftDot, false, 'no left-side dot: ' + p.id); if (p.unread) { assert.equal(p.right, true, 'green words after the time (its right, or the line below on a narrow pane): ' + p.id); assert.match(p.line, /new repl|New reply/); } }
        assert.equal(first.lines, 1, 'one New line on this open');
        assert.ok(greenish(first.newDot) && greenish(first.newText), `unread is green (${first.newDot} / ${first.newText})`);
        assert.ok(contrast(first.newText, first.base) >= 3, `the green words read on the base (${first.newText} on ${first.base}: ${contrast(first.newText, first.base).toFixed(2)})`);
        entry.first.contrast = +contrast(first.newText, first.base).toFixed(2);
        assert.ok(!greenish(first.needsDot) && !violetish(first.needsDot), `needs-you dot is amber (${first.needsDot})`);
        for (const c of first.dots) assert.ok(!violetish(c), 'no violet dot in Channels: ' + c);
        await page.screenshot({ path: path.join(out, stem + '-open.png') });
        // Scroll to the bottom with real input, then leave: nothing is read.
        await page.mouse.move(phone ? 195 : 400, 500);
        const sc = page.locator('.ch-list > .ch-scroll').filter({ visible: true }).first();
        await sc.evaluate(e => { e.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 4000 })); e.scrollTop = e.scrollHeight; });
        await nap(1200);
        const after = await feed(); entry.afterScroll = unreadN(after.posts);
        assert.equal(entry.afterScroll, N - READ, 'scrolled to the end: every green dot stays');
        assert.equal(entry.seenPuts, 0, 'the feed wrote no seen record');
        await page.screenshot({ path: path.join(out, stem + '-open-end.png') });
        await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor(); await nap(400);
        entry.back = await chanLine();
        assert.equal(entry.back.label, `${N - READ} unread`, 'Back: the channel keeps its green dot');
        await vis('.ch-chan-open[data-chchan="launch"]').click(); await vis('.ch-chan-h').waitFor(); await nap(800);
        const again = await feed(); entry.again = unreadN(again.posts);
        assert.equal(entry.again, N - READ, 're-enter: every green dot is there');
        await page.reload();
        await boot(); await nap(1500);
        if (!(await page.locator('.ch-chan-h').filter({ visible: true }).count())) { await vis('.ch-chan-open[data-chchan="launch"]').click(); await vis('.ch-chan-h').waitFor(); await nap(800); }
        const f2 = await feed(); entry.reloadFeed = unreadN(f2.posts);
        assert.equal(entry.reloadFeed, N - READ, 'reload: every green dot is there');
        // Open one post (post 10): only it is read; the channel's count drops by one.
        const target = ids[10];
        await page.locator(`.ch-post[data-chrow$="|${target}"] .ch-post-r`).filter({ visible: true }).first().click();
        await page.waitForFunction(() => document.querySelector('.ch-thread, .ch-msgs, [data-chthread]'), null, { timeout: 8000 }).catch(() => {});
        await nap(1200);
        entry.openedPuts = entry.seenPuts;
        await page.screenshot({ path: path.join(out, stem + '-thread.png') });
        if (phone) { await page.evaluate(() => __wos.onBack()); await vis('.ch-chan-h').waitFor(); await nap(600); }
        const f3 = await feed(); entry.afterOpen = { unread: unreadN(f3.posts), target: f3.posts.find(p => p.id === target)?.unread };
        assert.deepEqual(entry.afterOpen, { unread: N - READ - 1, target: false }, 'opening one post clears only that post');
        await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep()); await nap(300);
        if (!(await page.locator('.ch-chan-open[data-chchan="launch"]').filter({ visible: true }).count())) await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor(); await nap(400);
        entry.reload = await chanLine();
        assert.equal(entry.reload.label, `${N - READ - 1} unread`, 'the channel counts one fewer');
        await page.screenshot({ path: path.join(out, stem + '-list-after.png') });
        assert.deepEqual(entry.errors, [], 'no page errors');
        assert.deepEqual(entry.refused, [], 'no unexpected requests');
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = String(e.message || e).slice(0, 600); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.failure || '', JSON.stringify({ before: c.before, busy: c.busyLine, long: c.longLine, first: c.first, afterScroll: c.afterScroll, back: c.back?.label, again: c.again, reloadFeed: c.reloadFeed, afterOpen: c.afterOpen, after: c.reload?.label, errs: c.errors, puts: c.seenPuts, activityDot: c.activityDot }));
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
