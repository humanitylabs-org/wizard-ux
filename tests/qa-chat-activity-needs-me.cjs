'use strict';
// wizard-ux issue 1336 in a real browser: Activity as a short what-needs-me list, behind wizard/chat-channels.
// Phone 412x915 (classic), desktop 1440x900 (Classic Chats window and the AI apps view), Nebula + Grove, switch off and
// on. Disposable synthetic transport only (no box is reached; writes are answered in memory). Two agents (Archimedes and
// Claude). Switch on: no agent chip strip, Working / Ready / Recent / Snoozed / Archived, the one sort (Newest first,
// Oldest first, Needs you first), a green thread leaves Ready once opened, a yellow one stays, no violet marker, Agents
// folded above Archive in Channels (an agent opens its feed), and Undo after an archive. Switch off: today's list.
// QA_WEB=<another tree>/web runs a baseline; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-activity-evidence');
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
const CLAUDE = [{ id: 'qa-c1', title: 'Essay outline', at: now - 30 * 6e4, preview: 'Outline ready.' }].map(shape);
const READ = ['qa-y1', 'qa-r1', 'qa-r2'];
const cases = (process.env.QA_CASES || 'phone,classic,ai-apps').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) for (const on of [false, true]) {
      const phone = shell === 'phone', ai = shell === 'ai-apps', stem = `${shell}-${skin}-${on ? 'on' : 'off'}`, entry = { stem, errors: [], writes: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
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
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.waitForFunction(() => window.WosAgents?.list?.length === 2, null, { timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.ok && (window.WizLive.agentSessions?.claude || []).length === 1, null, { timeout: 15000 });
        await page.evaluate(ids => { for (const id of ids) WizLive.markSeen(id); WizLive.emit(); dispatchEvent(new Event('wos:experience')); }, READ);
        if (!ai) await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first(), shot = n => page.screenshot({ path: path.join(out, `${stem}-${n}.png`) });
        await page.evaluate(() => document.fonts.ready); await nap(600);
        if (ai) {
          await vis('.aad-side .aad-rw[data-sid="qa-g1"]').waitFor();
          entry.chips = await page.locator('.aad-agents').filter({ visible: true }).count();
          entry.sections = await page.locator('.aad-side .aad-sec .aad-sec-w').filter({ visible: true }).allInnerTexts();
          if (!on) { assert.equal(entry.chips, 1, 'switch off: the agent chips'); assert.ok(!entry.sections.includes('Recent')); await shot('activity'); entry.pass = true; continue; }
          assert.equal(entry.chips, 0, 'no agent chips');
          assert.deepEqual(entry.sections, ['Working', 'Ready', 'Recent', 'Snoozed', 'Archived']);
          entry.ready = await page.locator('#aad-sec-ready .aad-rw').evaluateAll(n => n.map(x => x.dataset.sid));
          assert.deepEqual(entry.ready.slice().sort(), ['qa-c1', 'qa-g1', 'qa-y1']);
          entry.claudeLine = await vis('.aad-rw[data-sid="qa-c1"] .aad-chan-line').innerText();
          assert.equal(entry.claudeLine, '# General · Claude');
          entry.dots = await page.locator('#aad-sec-ready .aad-rw').evaluateAll(n => n.map(x => [x.dataset.sid, x.querySelector('.aad-st')?.className || '', getComputedStyle(x.querySelector('.aad-st')).backgroundColor]));
          assert.ok(entry.dots.find(d => d[0] === 'qa-y1')[1].includes('is-needs'));
          await vis('.aad-act-orderb').click(); await nap(200);
          entry.sorts = (await page.locator('.aad-sortmenu .aad-pop-i').allInnerTexts()).map(t => t.trim());
          assert.deepEqual(entry.sorts, ['Newest first', 'Oldest first', 'Needs you first']);
          await shot('sort-menu'); await page.keyboard.press('Escape'); await nap(200);
          await shot('activity');
          // Opening green clears it from Ready; opening yellow keeps it.
          await vis('.aad-rw[data-sid="qa-g1"] .aad-row').click(); await nap(700);
          await vis('.aad-rw[data-sid="qa-y1"] .aad-row').click(); await nap(700);
          entry.readyAfter = await page.locator('#aad-sec-ready .aad-rw').evaluateAll(n => n.map(x => x.dataset.sid));
          assert.ok(!entry.readyAfter.includes('qa-g1'), 'green left Ready'); assert.ok(entry.readyAfter.includes('qa-y1'), 'yellow stayed');
          await shot('after-open');
          // Archive from the sidebar's menu: Undo shows, opaque, and brings it back.
          await vis('.aad-rw[data-sid="qa-r1"] .aad-row').click({ button: 'right' }); await nap(300);
          await vis('.aad-rowmenu [data-act="done"]').click(); await nap(300);
        } else {
          await vis('.ch-list [data-chopen="qa-g1"]').waitFor();
          entry.strip = await page.locator('.ch-focus-strip').filter({ visible: true }).count();
          entry.sections = await page.locator('.ch-list .ch-sec-h > span:first-child').filter({ visible: true }).allInnerTexts();
          if (!on) { assert.ok(!entry.sections.includes('Recent'), 'switch off: no Recent'); await shot('activity'); entry.pass = true; continue; }
          assert.equal(entry.strip, 0, 'no agent chip strip');
          assert.deepEqual(entry.sections.map(s => s.trim().toLowerCase()), ['working', 'ready', 'recent', 'snoozed', 'archived']);
          const inSec = k => page.locator(`.ch-list .ch-sec[data-sec="${k}"] [data-chopen]`).evaluateAll(n => [...new Set(n.map(x => x.dataset.chopen))]);
          entry.ready = await inSec('ready'); assert.deepEqual(entry.ready.slice().sort(), ['qa-c1', 'qa-g1', 'qa-y1']);
          entry.recent = await inSec('recent'); assert.deepEqual(entry.recent, ['qa-r1', 'qa-r2']);
          entry.sorts = (await page.locator('.ch-act-sort button').filter({ visible: true }).allInnerTexts()).map(t => t.trim());
          assert.deepEqual(entry.sorts, ['Newest first', 'Oldest first', 'Needs you first']);
          entry.claudeLine = (await vis('.ch-list [data-chopen="qa-c1"]').innerText()).replace(/\s+/g, ' ');
          assert.match(entry.claudeLine, /# General · Claude/);
          entry.marks = await page.locator('.ch-list .ch-sec[data-sec="ready"] .ch-row').evaluateAll(n => n.map(x => [x.dataset.chopen, x.querySelector('.ch-act-ind i')?.getAttribute('aria-label') || '', x.querySelector('time') ? getComputedStyle(x.querySelector('time')).color : '']));
          assert.deepEqual(entry.marks.map(m => m.slice(0, 2)).sort(), [['qa-c1', 'Unread'], ['qa-g1', 'Unread'], ['qa-y1', 'Needs you']]);
          await shot('activity');
          // Opening green clears it from Ready; opening yellow keeps it (Back between).
          const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
          await vis('.ch-list [data-chopen="qa-g1"]').click(); await nap(700); await back(); await nap(500);
          await vis('.ch-list [data-chopen="qa-y1"]').click(); await nap(700); await back(); await nap(500);
          await page.waitForFunction(() => ![...document.querySelectorAll('.ch-list .ch-sec[data-sec="ready"] [data-chopen="qa-g1"]')].some(e => e.getClientRects().length), null, { timeout: 4000 }).catch(() => {});
          entry.readyAfter = await inSec('ready');
          assert.ok(!entry.readyAfter.includes('qa-g1'), 'green left Ready'); assert.ok(entry.readyAfter.includes('qa-y1'), 'yellow stayed');
          await shot('after-open');
          // Channels: Agents folded just above Archive; an agent opens its feed.
          await vis('[data-chview="channels"]').click(); await nap(300);
          entry.channelRows = await page.locator('.ch-chan-list > *').filter({ visible: true }).evaluateAll(n => n.map(x => x.dataset.sec || x.querySelector('[data-chchan]')?.dataset.chchan || x.className));
          await vis('[data-chchanagents]').click(); await nap(300);
          await shot('channels-agents');
          await vis('[data-chchan="@agent:claude"]').click(); await nap(600);
          entry.agentFeed = (await vis('.ch-chan-h').innerText()).trim();
          entry.agentPosts = await page.locator('.ch-chan-feed .ch-post').filter({ visible: true }).count();
          assert.equal(entry.agentFeed, 'Claude'); assert.equal(entry.agentPosts, 1);
          entry.agentBox = await vis('[data-chchanform] textarea').getAttribute('placeholder');
          await shot('agent-feed');
          await vis('[data-chchanback]').click(); await nap(300);
          await vis('[data-chview="activity"]').click(); await nap(300);
          // Archive from the row's sheet: Undo shows, opaque, and brings it back.
          if (phone) { const loc = vis('.ch-list [data-chopen="qa-r1"]'), b = await loc.boundingBox(), at = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
            await loc.dispatchEvent('pointerdown', at); await nap(650); await loc.dispatchEvent('pointerup', at); }
          else await vis('.ch-list [data-chopen="qa-r1"]').click({ button: 'right' });
          await vis('.ch-sheet [data-rsact="done"]').click(); await nap(300);
        }
        const undo = vis('.ch-undo');
        await undo.waitFor({ timeout: 3000 });
        // Opaque: the panel's own pixels, read back from a 1px canvas of its computed background colour (any syntax).
        entry.undo = await undo.evaluate(e => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(e).backgroundColor; c.fillRect(0, 0, 1, 1);
          return { text: e.innerText.replace(/\s+/g, ' ').trim(), bg: getComputedStyle(e).backgroundColor, image: getComputedStyle(e).backgroundImage !== 'none', alpha: c.getImageData(0, 0, 1, 1).data[3] }; });
        assert.match(entry.undo.text, /^Archived Undo$/);
        assert.equal(entry.undo.alpha, 255, 'the Undo panel is opaque: ' + entry.undo.bg);
        await shot('undo');
        await undo.locator('[data-chundo]').click(); await nap(600);
        entry.restored = await page.evaluate(() => !WizLive.session('qa-r1')?.archived);
        assert.equal(entry.restored, true, 'Undo restored the thread');
        assert.ok(entry.writes.some(w => w === 'PATCH /wizard/hermes/api/sessions/qa-r1'), 'the restore went to the box');
        assert.deepEqual(entry.errors, []);
        entry.pass = true;
      } catch (e) { entry.fail = String(e && e.stack || e); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const e of report) console.log((e.pass ? 'PASS ' : 'FAIL ') + e.stem + (e.fail ? '\n  ' + e.fail.split('\n').slice(0, 3).join('\n  ') : ''));
  process.exitCode = report.every(e => e.pass) ? 0 : 1;
})();
