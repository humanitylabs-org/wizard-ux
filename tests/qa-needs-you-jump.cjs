'use strict';
// wizard-ux issue 1359 in a real browser: the jump-to-Needs-you pill at the top of a thread. With an open Needs you
// (amber) or replies that were unread when the thread opened (green) above the view, a pill reads their counts; one
// tap lands on the nearest (amber first), the count drops, and the pill goes when none are left; Mark done drops the
// amber count at once; a marker below gets the bottom pill. Main (Archimedes) and routed (Claude) threads. Phone
// 412x915 (browser and the APK's WizardOS-DocScroll document scroll) and desktop 1440x900 (Classic and AI apps),
// Nebula + Grove, Channels on. Routed threads cover each kind: Claude, a host profile, a container and a restricted agent. Synthetic transport only; writes are answered in memory.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline (no pill); QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'needs-jump-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'WizardOS Chats', agent: 'hermes', threads: ['qa-y1', 'qa-w1'], createdAt: iso(now - 9e8) }];
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_assistant_at: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: !!s.archived, preview: s.preview || 'Done.', ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const ROWS = [
  { id: 'qa-w1', title: 'Press notes', status: 'running', at: now - 20 * 6e4, preview: 'Drafting…' },
  { id: 'qa-y1', title: 'Launch checklist', at: now - 390e3, attention: { state: 'needs_you', ask: 'Pick a date' }, preview: 'Which date works?' },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 390e3, preview: 'Here is a plan.' },
  { id: 'qa-r1', title: 'Voice keys', at: now - 2 * 36e5 },
  { id: 'qa-r2', title: 'Store listing', at: now - 2 * 864e5 },
  { id: 'qa-a1', title: 'Old idea', at: now - 3 * 864e5, archived: true },
].map(shape);
const CLAUDE = [{ id: 'qa-c1', title: 'Essay outline', at: now - 390e3, attention: { state: 'needs_you', ask: 'Pick a title' }, preview: 'Which title?' }].map(shape);
// Routed agents of each kind (host profile, container, restricted), each with its own Needs you or unread thread.
const ROUTED = {
  claude: CLAUDE,
  host: [{ id: 'qa-h1', title: 'Host disk check', at: now - 390e3, attention: { state: 'needs_you', ask: 'Approve cleanup' }, preview: 'Which date works?' }].map(shape),
  container: [{ id: 'qa-k1', title: 'Container build', at: now - 390e3, preview: 'Here is a plan.' }].map(shape),
  restricted: [{ id: 'qa-x1', title: 'Locked notes', at: now - 390e3, attention: { state: 'needs_you', ask: 'Pick one' }, preview: 'Which date works?' }].map(shape),
};
for (const [id, label] of [['host', 'Host ops'], ['container', 'Box'], ['restricted', 'Locked']]) AGENTS.push({ id, label, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: id[0], hue: 120 }, model: { provider: 'anthropic', model: 'claude-opus-4' } });
const ALL = [...ROWS, ...Object.values(ROUTED).flat()];
// mixed = amber + green (Mark done drops amber); green = unread replies only; amber = top and bottom pill
const SCEN = { 'qa-y1': 'mixed', 'qa-g1': 'green', 'qa-c1': 'amber', 'qa-h1': 'mixed', 'qa-k1': 'green', 'qa-x1': 'mixed' };
const para = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}: the launch needs a date, a venue and a short list of people to invite before we can print anything.`).join('\n\n');
const LONG = [];
for (let i = 0; i < 8; i++) LONG.push({ role: 'user', content: 'Step ' + (i + 1) + '?', timestamp: now / 1000 - 9000 + i * 600 }, { role: 'assistant', content: para(4), timestamp: now / 1000 - 8990 + i * 600 });
LONG.push({ role: 'user', content: 'What do you need from me?', timestamp: now / 1000 - 400 }, { role: 'assistant', content: 'Which date works?\n\n' + para(14), timestamp: now / 1000 - 390 });
const repAt = i => iso((now / 1000 - 8990 + i * 600) * 1000); // reply i of LONG (0..7), then the asking one
// Read through reply 5: replies 6 and 7 are green on open (the asking reply counts once, as amber).
const SEEN = { initializedAt: 1, threads: Object.fromEntries([['qa-y1', ''], ['qa-g1', ''], ['qa-h1', 'agent/host/'], ['qa-k1', 'agent/container/'], ['qa-x1', 'agent/restricted/']].map(([id, k]) => [k + 'direct:' + id, { messageCount: 2, status: 'completed', updatedAt: repAt(5), assistantActivityAt: repAt(5), seenAt: now - 864e5 }]).concat(['direct:qa-r1', 'direct:qa-r2', 'agent/claude/direct:qa-c1'].map(id => [id, { messageCount: 2, status: 'completed', updatedAt: iso(now), assistantActivityAt: iso(now), seenAt: now }]))) };
const cases = (process.env.QA_CASES || 'phone,phone-doc,classic,ai-apps').split(','), expectBroken = process.env.QA_EXPECT === 'broken';
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) for (const sid of (process.env.QA_THREADS || Object.keys(SCEN).join(',')).split(',')) {
      const phone = shell.startsWith('phone'), ai = shell === 'ai-apps', stem = `${shell}-${skin}-${sid}`, entry = { stem, errors: [], writes: [], steps: [] }; report.push(entry);
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (shell === 'phone-doc' ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce', ...(phone ? { userAgent: ua } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ shell, skin, mix, spaces, ai }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': ai ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES, ai });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        let seen = structuredClone(SEEN);
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push(method + ' ' + p);
            if (method === 'PUT' && p === '/wizard/thread-seen') { const next = q.postDataJSON(); seen = next?.threads ? next : seen; return r.fulfill({ json: { ok: true, state: seen } }); }
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROUTED[u.searchParams.get('agent')] || ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ALL.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: SCEN[s.id] ? LONG : [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis(ai ? `.aad-rw[data-sid="${sid}"] .aad-row` : `[data-chopen="${sid}"]`).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-msgs .msg.a')].filter(n => n.getClientRects().length).length >= 9, null, { timeout: 15000 });
        await nap(3600); // through the opening settle
        // The visible pills' words ('' when hidden) and the thread's scroll box.
        const pills = () => page.evaluate(() => Object.fromEntries(['up', 'down'].map(d => { const b = [...document.querySelectorAll(`[data-chjump="${d}"]`)].find(n => !n.hidden && n.getClientRects().length); return [d, b ? [...b.children].map(c => c.textContent.trim()).join(' ') : '']; })));
        const toBottom = () => page.evaluate(() => { const nb = [...document.querySelectorAll('.ch-msgs')].find(n => n.getClientRects().length); const sc = nb.scrollHeight > nb.clientHeight + 1 ? nb : document.scrollingElement; sc.scrollTop = sc.scrollHeight; });
        const toTop = () => page.evaluate(() => { const nb = [...document.querySelectorAll('.ch-msgs')].find(n => n.getClientRects().length); const sc = nb.scrollHeight > nb.clientHeight + 1 ? nb : document.scrollingElement; sc.scrollTop = 0; });
        const step = async (name, want) => { await nap(350); const got = await pills(); entry.steps.push({ name, got, want }); if (!expectBroken) assert.deepEqual(got, want, `${stem}: ${name}`); };
        const tapUp = async () => { await vis('[data-chjump="up"]').click(); await nap(400); };
        // The tapped marker is on screen just under the header.
        const landedOn = sel => page.evaluate(sel => { const n = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); const nb = n.closest('.ch-msgs'), head = n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect(); const own = nb.scrollHeight > nb.clientHeight + 1; const top = Math.max(head.bottom, own ? nb.getBoundingClientRect().top : 0); const r = n.getBoundingClientRect(); return Math.round(r.top - top); }, sel);
        if (expectBroken) { await toBottom(); await nap(400); entry.ok = !!(await pills()).up; continue; }
        if (SCEN[sid] === 'green') {
          // Green only: lands on the newest reply (read), the two older unread replies above.
          await step('opened', { up: '↑ 2 New', down: '' });
          await tapUp(); const k7 = await landedOn(`.ch-msgs .msg.a[data-morph-key="a${Date.parse(repAt(7))}"]`); assert.ok(Math.abs(k7 - 8) <= 3, `${stem}: first tap lands on the nearer reply (${k7})`);
          await step('after one tap', { up: '↑ 1 New', down: '' });
          await tapUp(); const k6 = await landedOn(`.ch-msgs .msg.a[data-morph-key="a${Date.parse(repAt(6))}"]`); assert.ok(Math.abs(k6 - 8) <= 3, `${stem}: second tap lands on the other reply (${k6})`);
          await step('after two taps', { up: '', down: '' });
          await toBottom(); await step('back at the bottom, both seen', { up: '', down: '' });
        } else if (SCEN[sid] === 'mixed') {
          // Amber + green: amber goes first; Mark done drops the amber count at once.
          await step('opened on the line', { up: '↑ 2 New', down: '' });
          await toBottom(); await step('scrolled to the end', { up: '↑ 1 Needs you 2 New', down: '' });
          await page.screenshot({ path: path.join(out, `${stem}-pill.png`) });
          await tapUp(); const ln = await landedOn('.ch-msgs [data-needs-line]'); assert.ok(Math.abs(ln - 8) <= 3, `${stem}: the tap lands on the amber line (${ln})`);
          await step('amber first', { up: '↑ 2 New', down: '' });
          await toBottom(); await step('end again', { up: '↑ 1 Needs you 2 New', down: '' });
          // Mark done in the thread's action row: the pill updates on the next frame.
          const after = await page.evaluate(() => new Promise(res => { const b = [...document.querySelectorAll('.ch-tacts [data-chmarkdone]')].find(n => n.getClientRects().length); b.click();
            requestAnimationFrame(() => { const p = [...document.querySelectorAll('[data-chjump="up"]')].find(n => !n.hidden && n.getClientRects().length); res(p ? [...p.children].map(c => c.textContent.trim()).join(' ') : ''); }); }));
          entry.steps.push({ name: 'Mark done (next frame)', got: after }); assert.equal(after, '↑ 2 New', `${stem}: Mark done drops the amber count at once`);
        } else {
          // Routed agent: amber only, plus the bottom pill when the line is below.
          await step('opened on the line', { up: '', down: '' });
          await toBottom(); await step('end', { up: '↑ 1 Needs you', down: '' });
          await tapUp(); await step('tapped', { up: '', down: '' });
          await toTop(); await step('top: the line is below', { up: '', down: '↓ 1 Needs you' });
          await vis('[data-chjump="down"]').click(); await nap(400); await step('tapped down', { up: '', down: '' });
          await page.screenshot({ path: path.join(out, `${stem}-landed.png`) });
        }
        entry.ok = true;
        assert.equal(entry.writes.filter(w => !w.startsWith('PUT /wizard/thread-seen')).length, 0, 'only seen marks are written: ' + entry.writes.join(', '));
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
    if (expectBroken) assert.ok(report.every(e => !e.ok), 'baseline: expected no pill');
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'NO PILL', JSON.stringify(e.steps));
  }
})().catch(e => { console.error(e); process.exit(1); });
