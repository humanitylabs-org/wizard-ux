'use strict';
// wizard-ux issue 1331 (second AI review) in a real browser: opening a thread with an open Needs you lands with the
// amber line fully on screen under the header, and it STAYS there through the opening settle (the reading-place
// restore used to pull it back). Main (Archimedes) and routed (Claude) threads. Phone 412x915 (browser and the APK's WizardOS-DocScroll document scroll) and desktop
// 1440x900 (Classic and AI apps), Nebula + Grove, Channels on. Synthetic transport only; writes are answered in memory.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'needs-landing-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'WizardOS Chats', agent: 'hermes', threads: ['qa-y1', 'qa-w1'], createdAt: iso(now - 9e8) }];
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: !!s.archived, preview: s.preview || 'Done.', ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const ROWS = [
  { id: 'qa-w1', title: 'Press notes', status: 'running', at: now - 20 * 6e4, preview: 'Drafting…' },
  { id: 'qa-y1', title: 'Launch checklist', at: now - 5 * 36e5, attention: { state: 'needs_you', ask: 'Pick a date' }, preview: 'Which date works?' },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 60 * 6e4, preview: 'Here is a plan.' },
  { id: 'qa-r1', title: 'Voice keys', at: now - 2 * 36e5 },
  { id: 'qa-r2', title: 'Store listing', at: now - 2 * 864e5 },
  { id: 'qa-a1', title: 'Old idea', at: now - 3 * 864e5, archived: true },
].map(shape);
const CLAUDE = [{ id: 'qa-c1', title: 'Essay outline', at: now - 30 * 6e4, attention: { state: 'needs_you', ask: 'Pick a title' }, preview: 'Which title?' }].map(shape);
const READ = ['qa-y1', 'qa-r1', 'qa-r2'];
const para = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}: the launch needs a date, a venue and a short list of people to invite before we can print anything.`).join('\n\n');
const LONG = [];
for (let i = 0; i < 8; i++) LONG.push({ role: 'user', content: 'Step ' + (i + 1) + '?', timestamp: now / 1000 - 9000 + i * 600 }, { role: 'assistant', content: para(4), timestamp: now / 1000 - 8990 + i * 600 });
LONG.push({ role: 'user', content: 'What do you need from me?', timestamp: now / 1000 - 400 }, { role: 'assistant', content: 'Which date works?\n\n' + para(14), timestamp: now / 1000 - 390 });
const cases = (process.env.QA_CASES || 'phone,phone-doc,classic,ai-apps').split(','), expectBroken = process.env.QA_EXPECT === 'broken';
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) for (const sid of ['qa-y1', 'qa-c1']) {
      const phone = shell.startsWith('phone'), ai = shell === 'ai-apps', stem = `${shell}-${skin}-${sid === 'qa-y1' ? 'main' : 'routed'}`, entry = { stem, errors: [], writes: [] }; report.push(entry);
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (shell === 'phone-doc' ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: ua } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ shell, skin, mix, spaces, ai }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': ai ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES, ai });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push(method + ' ' + p);
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
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
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') === 'claude' ? CLAUDE : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...ROWS, ...CLAUDE].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: ['qa-y1', 'qa-c1'].includes(s.id) ? LONG : [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis(ai ? `.aad-rw[data-sid="${sid}"] .aad-row` : `[data-chopen="${sid}"]`).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-msgs [data-needs-line]')].some(n => n.getClientRects().length), null, { timeout: 15000 });
        // Where the line is against the header and the visible thread, sampled through the opening settle (about 3.5 s).
        const where = () => page.evaluate(() => {
          const line = [...document.querySelectorAll('.ch-msgs [data-needs-line]')].find(n => n.getClientRects().length), t = line.closest('.ch-thread'), nb = line.closest('.ch-msgs');
          const head = t.querySelector('.ch-head').getBoundingClientRect(), r = line.getBoundingClientRect(), b = nb.getBoundingClientRect(), own = nb.scrollHeight > nb.clientHeight + 1;
          const viewTop = Math.max(head.bottom, own ? b.top : 0), viewBottom = Math.min(innerHeight, own ? b.bottom : innerHeight);
          const btn = line.querySelector('[data-chmarkdone]').getBoundingClientRect(), hit = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2);
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewTop: Math.round(viewTop), viewBottom: Math.round(viewBottom), doneHit: !!hit?.closest('[data-chmarkdone]') };
        });
        entry.samples = [];
        for (let i = 0; i < 12; i++) { entry.samples.push(await where()); await nap(300); }
        await page.screenshot({ path: path.join(out, `${stem}-landed.png`) });
        const last = entry.samples[entry.samples.length - 1];
        entry.ok = last.top >= last.viewTop - 1 && last.bottom <= last.viewBottom + 1 && last.doneHit && last.top - last.viewTop < 40;
        if (!expectBroken) assert.ok(entry.ok, `${stem}: the amber line is not fully on screen under the header after the settle: ${JSON.stringify(last)}`);
        assert.equal(entry.writes.filter(w => !w.startsWith('PUT /wizard/thread-seen')).length, 0, 'only seen marks are written: ' + entry.writes.join(', '));
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
    if (expectBroken) assert.ok(report.some(e => !e.ok), 'baseline: expected at least one case to lose the line');
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'LINE LOST', JSON.stringify(e.samples?.[0]), '->', JSON.stringify(e.samples?.[e.samples.length - 1]));
  }
})().catch(e => { console.error(e); process.exit(1); });
