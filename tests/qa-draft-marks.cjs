'use strict';
// wizard-ux issue 1445 in a real browser: the saved-draft mark on Activity rows and Channels lines, behind
// wizard/draft-marks (with wizard/chat-channels on). Phone 412x915 (classic Chats), desktop 1440x900 (Classic Chats
// window and the AI apps view), Nebula + Grove. Disposable synthetic transport only (no box is reached). Steps: type into
// a thread's box -> its Activity row says "✎ Draft" (live where the list shows beside the thread), rows keep their order;
// type into a channel's box -> its Channels line wears ✎; reload -> both still there; empty the box -> gone.
// QA_ONLY_OFF=1 runs the switch-off pass only (no mark anywhere); QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://draft-marks.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'draft-marks-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'WizardOS Chats', agent: 'hermes', threads: ['qa-y1', 'qa-g1'], createdAt: iso(now - 9e8) }];
const AGENTS = [{ id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2,
  archived: false, preview: s.preview || 'Done.', ...(s.attention ? { wizard_attention: s.attention } : {}) });
const ROWS = [
  { id: 'qa-y1', title: 'Launch checklist', at: now - 5 * 36e5, attention: { state: 'needs_you', ask: 'Pick a date' }, preview: 'Which date works?' },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 60 * 6e4, preview: 'Here is a plan.' },
  { id: 'qa-r1', title: 'Voice keys', at: now - 2 * 36e5, preview: 'Mapped the keys.' },
].map(shape);
const cases = (process.env.QA_CASES || 'phone,classic,ai-apps').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) for (const on of process.env.QA_ONLY_OFF ? [false] : [true, false]) {
      const phone = shell === 'phone', ai = shell === 'ai-apps', stem = `${shell}-${skin}-${on ? 'on' : 'off'}`, entry = { stem, errors: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true, ...(on ? { 'wizard/draft-marks': true } : {}) };
        await context.addInitScript(({ shell, skin, mix, spaces, ai }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': ai ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES, ai });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
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
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') ? [] : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        const boot = async () => {
          await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
          if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
          await page.waitForFunction(on => { const t = (document.documentElement.dataset.tweaks || '').split(' '); return t.includes('wizard/chat-channels') && t.includes('wizard/draft-marks') === on; }, on, { timeout: 15000 });
          await page.waitForFunction(() => window.WizLive?.ok && WizLive.sessions.length === 3, null, { timeout: 15000 });
          if (!ai) await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
          await page.evaluate(() => document.fonts.ready); await nap(700);
        };
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html')); await boot();
        const vis = sel => page.locator(sel).filter({ visible: true }).first(), shot = n => page.screenshot({ path: path.join(out, `${stem}-${n}.png`) });
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        // The rows in Activity (id order) and which say Draft.
        const rowSel = ai ? '.aad-side .aad-rw' : '.ch-list .ch-row-wrap';
        const activity = () => page.locator(rowSel).filter({ visible: true }).evaluateAll((n, ai) => n.map(x => {
          const id = ai ? x.dataset.sid : x.querySelector('[data-chopen]')?.dataset.chopen;
          // the tag must be on screen: the phone's one-line rows show the channel line, the desktop rows the preview line
          const draft = ai ? 'draft' in x.dataset && /✎ Draft/.test(getComputedStyle(x.querySelector('.aad-chan-line'), '::before').content) : [...x.querySelectorAll('.ch-draft-tag')].some(t => t.getClientRects().length > 0);
          return [id, draft];
        }), ai);
        const drafted = async () => (await activity()).filter(r => r[1]).map(r => r[0]);
        await vis(ai ? '.aad-side .aad-rw[data-sid="qa-g1"]' : '.ch-list [data-chopen="qa-g1"]').waitFor();
        entry.orderBefore = (await activity()).map(r => r[0]);
        assert.deepEqual(await drafted(), [], 'no draft yet');
        // 1. A thread's box: open Weekend plans, type.
        await vis(ai ? '.aad-side .aad-rw[data-sid="qa-g1"] .aad-row' : '.ch-list [data-chopen="qa-g1"]').click(); await nap(800);
        const ta = vis('.ch-thread .ch-compose textarea, .ch-compose:not([data-chchanform]) textarea');
        await ta.click(); await page.keyboard.type('Half a tho'); await nap(500);
        if (!phone) { // the list beside the thread follows at once, no reload
          entry.liveWhileTyping = await drafted();
          if (on) assert.deepEqual(entry.liveWhileTyping, ['qa-g1'], 'the row says Draft while typing');
          await shot('typing');
        }
        if (!ai) { await back(); await nap(600); }
        entry.afterThread = await drafted();
        assert.deepEqual(entry.afterThread, on ? ['qa-g1'] : []);
        entry.orderAfter = (await activity()).map(r => r[0]);
        assert.deepEqual(entry.orderAfter.slice().sort(), entry.orderBefore.slice().sort(), 'same rows (opening a green thread moves it to Recent; the on/off order is compared at the end)');
        if (on && !ai) entry.preview = (await vis(`.ch-list [data-chopen="qa-g1"] ${phone ? '.ch-chan-line' : '.pv'}`).innerText()).replace(/\s+/g, ' ').trim();
        if (on && !ai) assert.match(entry.preview, phone ? /^✎ Draft · # WizardOS Chats$/ : /^# WizardOS Chats · ✎ Draft · /);
        if (on) entry.tagColor = await page.evaluate(ai => getComputedStyle(document.querySelector(ai ? '.aad-rw[data-draft] .aad-chan-line' : '.ch-draft-tag'), ai ? '::before' : null).color, ai);
        await shot('activity');
        // 2. A channel's box: Channels tab, open the channel, type, back to the list.
        if (ai) { await vis('.aad-side [data-chview="channels"]').click(); await nap(400); }
        else { await vis('[data-chview="channels"]').click(); await nap(400); }
        const chanLine = () => page.locator('.ch-chan-open[data-chchan="launch"]').filter({ visible: true }).first();
        await chanLine().click(); await nap(900);
        const box = vis('[data-chchanform] textarea');
        await box.click(); await page.keyboard.type('Post idea'); await nap(500);
        if (ai) { entry.chanLive = await chanLine().evaluate(b => !!b.querySelector('.ch-chan-draft')); if (on) assert.equal(entry.chanLive, true, 'the sidebar line wears the pencil while typing'); await shot('channel-typing'); }
        else { await vis('[data-chchanback]').click(); await nap(500); }
        entry.chanMarks = await page.locator('.ch-chan-open').filter({ visible: true }).evaluateAll(n => n.map(b => [b.dataset.chchan, !!b.querySelector('.ch-chan-draft')]));
        assert.deepEqual(entry.chanMarks.filter(r => r[1]).map(r => r[0]), on ? ['launch'] : []);
        if (on) { const m = await chanLine().evaluate(b => { const d = b.querySelector('.ch-chan-draft').getBoundingClientRect(), r = b.getBoundingClientRect(); return { inside: d.left >= r.left && d.right <= r.right + 1, h: Math.round(d.height) }; }); entry.pencilBox = m; assert.ok(m.inside); }
        await shot('channels');
        // 3. Reload: both marks are still there.
        await page.reload(); await boot();
        if (ai) { await vis('.aad-side [data-chview="channels"]').click(); await nap(400); }
        else { await vis('[data-chview="channels"]').click(); await nap(400); if (await page.locator('[data-chchanback]').filter({ visible: true }).count()) { await vis('[data-chchanback]').click(); await nap(400); } }
        entry.chanAfterReload = await page.locator('.ch-chan-open').filter({ visible: true }).evaluateAll(n => n.filter(b => b.querySelector('.ch-chan-draft')).map(b => b.dataset.chchan));
        assert.deepEqual(entry.chanAfterReload, on ? ['launch'] : []);
        await vis(ai ? '.aad-side [data-chview="activity"]' : '[data-chview="activity"]').click(); await nap(500);
        entry.afterReload = await drafted();
        assert.deepEqual(entry.afterReload, on ? ['qa-g1'] : []);
        // 4. Emptying the thread's box takes the mark away.
        await vis(ai ? '.aad-side .aad-rw[data-sid="qa-g1"] .aad-row' : '.ch-list [data-chopen="qa-g1"]').click(); await nap(800);
        const ta2 = vis('.ch-thread .ch-compose textarea, .ch-compose:not([data-chchanform]) textarea');
        assert.equal(await ta2.inputValue(), 'Half a tho', 'the draft came back into its box');
        await ta2.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await nap(500);
        if (!ai) { await back(); await nap(600); }
        entry.afterEmpty = await drafted();
        assert.deepEqual(entry.afterEmpty, []);
        assert.deepEqual(entry.errors, []);
        entry.pass = true;
      } catch (e) { entry.fail = String(e && e.stack || e); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  // The draft never moves a row: with the switch on, the rows after typing sit exactly as with it off.
  for (const e of report.filter(x => x.pass && x.stem.endsWith('-on'))) {
    const off = report.find(x => x.stem === e.stem.replace(/-on$/, '-off'));
    if (off?.pass && JSON.stringify(off.orderAfter) !== JSON.stringify(e.orderAfter)) { e.pass = false; e.fail = 'row order differs from the switch-off run: ' + JSON.stringify([e.orderAfter, off.orderAfter]); }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const e of report) console.log((e.pass ? 'PASS ' : 'FAIL ') + e.stem + (e.fail ? '\n  ' + e.fail.split('\n').slice(0, 3).join('\n  ') : ''));
  process.exitCode = report.every(e => e.pass) ? 0 : 1;
})();
