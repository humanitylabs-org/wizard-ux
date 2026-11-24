'use strict';
// wizard-ux issue 1546 in a real browser: a reader who scrolls up while a long reply streams in is never pulled back
// to the bottom. The words he is reading stay put on every chunk, repaint and layout change, and ↓ Latest shows; a
// reader still at the bottom keeps following the stream. A main (Archimedes) thread filed in a channel and a routed
// (Claude) thread; phone 412x915 (browser and the
// APK's WizardOS-DocScroll document scroll) and desktop 1440x900 (Classic and AI apps), Nebula + Grove.
// Synthetic transport only (EventSource is faked so the test pushes each chunk); writes are answered in memory.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline; QA_OUT=<dir> keeps the screenshots; QA_CASES / QA_SKINS narrow it.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'stream-scroll-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'WizardOS Chats', agent: 'hermes', threads: ['qa-w1'], createdAt: iso(now - 9e8) }];
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: false, preview: s.preview || 'Done.', ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const ROWS = [
  { id: 'qa-w1', title: 'Long essay', status: 'running', at: now - 60e3, preview: 'Writing…' },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(shape);
const CLAUDE = [{ id: 'qa-c1', title: 'Long outline', status: 'running', at: now - 50e3, preview: 'Writing…' }].map(shape);
const para = (n, w) => Array.from({ length: n }, (_, i) => `${w} ${i + 1}: the launch needs a date, a venue and a short list of people to invite before we can print anything.`).join('\n\n');
const HISTORY = [];
if (process.env.QA_FRESH !== '1') for (let i = 0; i < 3; i++) HISTORY.push({ role: 'user', content: 'Step ' + (i + 1) + '?', timestamp: now / 1000 - 9000 + i * 600 }, { role: 'assistant', content: para(3, 'Earlier'), timestamp: now / 1000 - 8990 + i * 600 });
HISTORY.push({ role: 'user', content: 'Write me the whole long plan, please.', timestamp: now / 1000 - 60 });
const cases = (process.env.QA_CASES || 'phone,phone-doc,classic,ai-apps').split(','), skins = (process.env.QA_SKINS || 'nebula,grove').split(',');
const sids = (process.env.QA_THREADS || 'qa-w1,qa-c1').split(',');
const expectBroken = process.env.QA_EXPECT === 'broken';
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of skins) for (const sid of sids) {
      const phone = shell.startsWith('phone'), ai = shell === 'ai-apps', stem = `${shell}-${skin}-${sid === 'qa-w1' ? 'main' : 'routed'}`, entry = { stem, errors: [] }; report.push(entry);
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (shell === 'phone-doc' ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: ua } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix, spaces, ai, sid }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': ai ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
          // The run stream, driven by the test: __qaPush(text) sends one numbered message.delta frame to every open read.
          const open = window.__qaES = [];
          let seq = 0;
          window.EventSource = class { constructor(url) { this.url = url; this.on = {}; open.push(this); setTimeout(() => this.onopen?.(), 0); }
            addEventListener(n, f) { (this.on[n] ||= []).push(f); } removeEventListener() {} close() { this.closed = true; } };
          window.__qaPush = delta => { const data = JSON.stringify({ event: 'message.delta', delta, seq: ++seq, session_id: sid, run_id: 'run-' + sid });
            for (const s of open) if (!s.closed) s.onmessage?.({ data, type: 'message', lastEventId: String(seq) }); };
        }, { shell, skin, mix, spaces: SPACES, ai, sid });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          const run = /^\/wizard\/hermes\/v1\/runs\/run-(qa-[wc]1)$/.exec(p);
          if (run) return r.fulfill({ json: { run_id: 'run-' + run[1], session_id: run[1], status: 'running' } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') === 'claude' ? CLAUDE : u.searchParams.get('agent') ? [] : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...ROWS, ...CLAUDE].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: ['qa-w1', 'qa-c1'].includes(s.id) ? HISTORY : [{ role: 'user', content: 'Ask', timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => true, null, { timeout: 15000 });
        if (!ai) await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (ai) await page.getByText('Working', { exact: true }).filter({ visible: true }).first().click(); // the Working fold starts closed
        await vis(ai ? `.aad-rw[data-sid="${sid}"] .aad-row` : `[data-chopen="${sid}"]`).click();
        await page.waitForFunction(sid => window.__qaES.some(s => !s.closed && s.url.includes('run-' + sid) && (sid === 'qa-w1' || s.url.includes('agent=claude'))), sid, { timeout: 15000 });
        // The thread on screen: its scroller (box or document), the header bottom, and the streaming bubble.
        const probe = () => page.evaluate(() => {
          const nb = [...document.querySelectorAll('.ch-msgs')].find(n => n.getClientRects().length && n.querySelector('[data-morph-key]'));
          const doc = !!nb.closest('.wos-doc-thread') || (document.scrollingElement.scrollHeight > innerHeight + 4 && nb.scrollHeight <= nb.clientHeight + 1);
          const sc = doc ? document.scrollingElement : nb, live = nb.querySelector('[data-streaming]');
          const paras = live ? [...live.querySelectorAll('p')] : [];
          const top = doc ? nb.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom : nb.getBoundingClientRect().top;
          const bottom = doc ? innerHeight : nb.getBoundingClientRect().bottom;
          const eye = paras.find(p => p.getBoundingClientRect().top >= top + 20);
          const latest = [...document.querySelectorAll('[data-chlatest]')].find(b => b.closest('[data-chats]')?.contains(nb));
          return { doc, scrollTop: Math.round(sc.scrollTop), gap: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), paras: paras.length,
            eye: eye ? eye.textContent.slice(0, 14) : '', eyeTop: eye ? Math.round(eye.getBoundingClientRect().top) : null, latest: latest ? !latest.hidden : null, top: Math.round(top), bottom: Math.round(bottom) };
        });
        const push = async (n, from) => { for (let i = 0; i < n; i++) { await page.evaluate(t => __qaPush(t), `${i || from ? '\n\n' : ''}Chunk ${from + i + 1}: the launch needs a date, a venue and a short list of people to invite before we can print anything.`); await nap(120); } };
        // 1. At the bottom: the reply follows the stream, as it really arrives (a few words per frame), after the opening settle.
        await push(1, 0);
        await page.waitForFunction(() => document.querySelector('[data-streaming]'), null, { timeout: 15000 });
        await nap(3500);
        const words = n => { const out = []; for (let i = 0; i < n; i++) out.push(...`${i % 3 ? ' ' : '\n\nChunk ' + (i + 2) + ':'} the launch needs a date, a venue and a short list of people to invite.`.split(/(?= )/)); return out; };
        for (const w of words(40)) { await page.evaluate(t => __qaPush(t), w); await nap(25); }
        await nap(400);
        entry.follow = await probe();
        entry.followOk = entry.follow.gap < 80;
        // 2. Scroll up a screen with the wheel (desktop) or a drag/scroll (phone), then keep streaming.
        const st = entry.follow;
        if (phone) { // a real finger drag down the thread (scrolls up), in small steps
          const cdp = await context.newCDPSession(page), x = 200, y0 = Math.max(st.top + 40, 260);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
          for (let y = y0 + 20; y <= y0 + 360; y += 20) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await nap(16); }
          await nap(120); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
          for (let y = y0 + 20; y <= y0 + 360; y += 20) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await nap(16); }
          await nap(120); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else { await page.mouse.move(ai ? 900 : 720, 450); await page.mouse.wheel(0, -700); }
        await nap(800);
        entry.before = await probe();
        await page.screenshot({ path: path.join(out, `${stem}-scrolled-up.png`) });
        entry.samples = [];
        for (let k = 0; k < 6; k++) {
          await push(2, 18 + k * 3);
          for (const w of ' and then a few more words on the same line'.split(/(?= )/)) { await page.evaluate(t => __qaPush(t), w); await nap(60); }
          await nap(250); entry.samples.push(await probe());
        }
        // A repaint without growth (the transcript read) and a layout change (resize) must not move him either.
        await page.setViewportSize(phone ? { width: 412, height: 880 } : { width: 1440, height: 860 }); await nap(800);
        entry.samples.push(await probe());
        await page.screenshot({ path: path.join(out, `${stem}-after-stream.png`) });
        const moved = entry.samples.filter(s => s.eye !== entry.before.eye || Math.abs(s.eyeTop - entry.before.eyeTop) > 2);
        entry.holdOk = entry.before.gap > 200 && !moved.length && entry.samples.every(s => s.latest !== false);
        entry.ok = entry.followOk && entry.holdOk;
        if (!expectBroken) {
          assert.ok(entry.followOk, `${stem}: at the bottom the reply should follow the stream: ${JSON.stringify(entry.follow)}`);
          assert.ok(entry.holdOk, `${stem}: scrolled up, streaming moved the words he reads: ${JSON.stringify(entry.before)} -> ${JSON.stringify(moved[0] || entry.samples.at(-1))}`);
        }
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
    if (expectBroken) assert.ok(report.some(e => !e.ok), 'baseline: expected at least one case to follow or yank wrongly');
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'BROKEN', 'follow', JSON.stringify(e.follow), '\n  up', JSON.stringify(e.before), '\n  ->', JSON.stringify(e.samples?.at(-2)), '\n  resize', JSON.stringify(e.samples?.at(-1)));
  }
})().catch(e => { console.error(e); process.exit(1); });
