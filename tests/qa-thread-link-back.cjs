'use strict';
// wizard-ux issue 1581 in a real browser: James reads a long reply, taps a link to another thread, does something there
// and goes Back. The first thread must come back at the exact place he left (within a line), never at the top of the
// latest reply. Cases: a read thread, a thread that was unread (bold in Ready) when he opened it, and a thread with a
// Working reply. Back by the header button and by the system Back (swipe / browser Back). Phone 412x915 (browser and the
// APK's document scroll) and desktop 1440x900 (two panes: Esc is Back there), Nebula + Grove. Synthetic transport only.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'link-back-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const para = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}: the ready list needs a short look at each thread before we decide what to keep and what to close today.`).join('\n\n');
const linkTo = id => `${origin}${prefix}?session=${id}`;
const reply = `Here is the triage.\n\n${para(10, 'Before')}\n\nOpen [Press notes](${linkTo('qa-b')}) and check the draft.\n\n${para(14, 'After')}`;
const msgs = [];
for (let i = 0; i < 4; i++) msgs.push({ role: 'user', content: 'Step ' + (i + 1) + '?', timestamp: now / 1000 - 9000 + i * 600 }, { role: 'assistant', content: para(4, 'Old'), timestamp: now / 1000 - 8990 + i * 600 });
msgs.push({ role: 'user', content: 'Triage the ready list', timestamp: now / 1000 - 400 }, { role: 'assistant', content: reply, timestamp: now / 1000 - 390 });
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.count || 2, messageCount: s.count || 2, archived: false, preview: s.preview || 'Done.',
  ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const cases = (process.env.QA_CASES || 'phone,phone-doc,desktop').split(','), kinds = (process.env.QA_KINDS || 'read,unread,working').split(',');
const backs = (process.env.QA_BACKS || 'button,system').split(','), expectBroken = process.env.QA_EXPECT === 'broken';
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) for (const kind of kinds) for (const back of (shell === 'desktop' ? ['escape'] : backs)) {
      const phone = shell.startsWith('phone'), stem = `${shell}-${skin}-${kind}-${back}`, entry = { stem, errors: [] }; report.push(entry);
      const ROWS = [
        { id: 'qa-a', title: 'Ready list triage', at: now - 6 * 6e4, preview: 'Here is the triage.', count: msgs.length, status: kind === 'working' ? 'running' : 'completed' },
        { id: 'qa-b', title: 'Press notes', at: now - 60 * 6e4, preview: 'The draft is ready.' },
        { id: 'qa-c', title: 'Weekend plans', at: now - 2 * 36e5 },
      ].map(shape);
      // Read threads carry a seen mark at their latest activity; the unread case leaves qa-a without one (bold in Ready).
      const seen = { version: 1, threads: {} };
      for (const s of ROWS) if (!(kind === 'unread' && s.id === 'qa-a')) seen.threads[s.id] = { seenAt: now, updatedAt: s.updated_at, assistantActivityAt: s.updated_at, messageCount: s.message_count, status: s.status };
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (shell === 'phone-doc' ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: ua } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, skin }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell.startsWith('phone') ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
        }, { shell, skin });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') { const b = q.postDataJSON() || {}; if (b.threads) Object.assign(seen.threads, b.threads); return r.fulfill({ json: { ok: true, state: seen } }); }
            const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)$/.exec(p);
            if (method === 'PATCH' && m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (s) Object.assign(s, q.postDataJSON() || {}); return r.fulfill({ json: { session: s || {} } }); }
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: seen });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: [] } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: s.id === 'qa-a' ? msgs : [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 3600 }, { role: 'assistant', content: s.preview + '\n\n' + para(3, 'Note'), timestamp: now / 1000 - 3590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis('[data-chopen="qa-a"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-msgs .bub a')].some(a => a.getClientRects().length && /Press notes/.test(a.textContent)), null, { timeout: 15000 });
        await nap(3500); // past the opening settle
        // Read down the reply until the link sits in the middle of the screen, the way a reader scrolls (wheel / touch).
        const linkY = () => page.evaluate(() => { const a = [...document.querySelectorAll('.ch-msgs .bub a')].find(x => x.getClientRects().length && /Press notes/.test(x.textContent)); return a.getBoundingClientRect().top; });
        const mid = (phone ? 915 : 900) / 2;
        for (let i = 0; i < 40; i++) {
          const y = await linkY(); if (Math.abs(y - mid) < 30) break;
          const dy = Math.max(-400, Math.min(400, y - mid));
          await page.mouse.move(phone ? 206 : 900, mid); await page.mouse.wheel(0, dy); await nap(120);
        }
        await nap(800);
        // Where he is reading: the paragraph at the eye line (link) and its offset on screen.
        const spot = () => page.evaluate(() => { const a = [...document.querySelectorAll('.ch-msgs .bub a')].find(x => x.getClientRects().length && /Press notes/.test(x.textContent)); return a ? Math.round(a.getBoundingClientRect().top) : null; });
        entry.before = await spot();
        await page.screenshot({ path: path.join(out, `${stem}-1-reading.png`) });
        await vis('.ch-msgs .bub a:has-text("Press notes")').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-head .ti b')].some(b => b.getClientRects().length && /Press notes/.test(b.textContent)), null, { timeout: 15000 });
        await nap(1200);
        // Do something there: scroll it and type a draft (a send is not needed to lose the place).
        await page.mouse.move(phone ? 206 : 900, mid); await page.mouse.wheel(0, 300); await nap(300); await page.mouse.wheel(0, -200);
        const ta = vis('.ch-compose textarea'); if (await ta.count()) { await ta.click(); await ta.fill('Looks good'); await ta.fill(''); await page.keyboard.press('Tab').catch(() => {}); }
        await nap(1500);
        if (back === 'button') await vis('[data-chback]').click();
        else if (phone) await page.goBack(); else await page.keyboard.press('Escape');
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-head .ti b')].some(b => b.getClientRects().length && /Ready list triage/.test(b.textContent)), null, { timeout: 15000 });
        entry.samples = [];
        for (let i = 0; i < 10; i++) { entry.samples.push(await spot()); await nap(400); }
        await page.screenshot({ path: path.join(out, `${stem}-2-back.png`) });
        const last = entry.samples[entry.samples.length - 1];
        entry.ok = last != null && Math.abs(last - entry.before) <= 24;
        if (!expectBroken) assert.ok(entry.ok, `${stem}: Back did not restore the reading place: before ${entry.before}, after ${JSON.stringify(entry.samples)}`);
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
    if (expectBroken) assert.ok(report.some(e => !e.ok), 'baseline: expected at least one case to lose the place');
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'PLACE LOST', e.before, '->', JSON.stringify(e.samples));
  }
})().catch(e => { console.error(e); process.exit(1); });
