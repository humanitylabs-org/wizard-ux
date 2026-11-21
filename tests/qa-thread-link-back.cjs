'use strict';
// wizard-ux issue 1581 in a real browser: James reads a long reply, taps a link to another thread, does something there
// and goes Back. The first thread must come back at the exact place he left (within a line), never at the top of the
// latest reply. Cases: a read thread, a thread that was unread (bold in Ready) when he opened it, and a thread with a
// Working reply. Back by the header button and by the system Back (swipe / browser Back). Phone 412x915 (browser and the
// APK's document scroll) and desktop 1440x900 (two panes: Esc is Back there), Nebula + Grove. Synthetic transport only.
// QA_WEB=<main>/web QA_EXPECT=broken runs the baseline; QA_OUT=<dir> keeps the screenshots.
// Issue 1653 adds what he does in the linked thread (QA_ACTS): look (scroll + a draft), send (a typed reply, then Back)
// and send-go (a typed reply with Send and go on: the phone steps back by itself), and two more parents: newreply (a new
// reply lands in the parent while he is away), working-newreply (the parent was Working and its reply lands) and daily
// (the parent is today's thread of the Daily channel, opened from Channels in the Daily view with an earlier day folded
// above it, and a new reply lands there while he is away: Back must bring the Daily view back at his place) and routed
// (both threads are a routed Claude agent's, with an agent-qualified link, and a new reply lands in the parent).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-activity.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'link-back-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const para = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}: the ready list needs a short look at each thread before we decide what to keep and what to close today.`).join('\n\n');
const linkTo = (id, agent) => `${origin}${prefix}?session=${id}${agent ? '&agent=' + agent : ''}`;
const replyTo = agent => `Here is the triage.\n\n${para(10, 'Before')}\n\nOpen [Press notes](${linkTo('qa-b', agent)}) and check the draft.\n\n${para(14, 'After')}`;
const reply = replyTo('');
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const msgs = [];
for (let i = 0; i < 4; i++) msgs.push({ role: 'user', content: 'Step ' + (i + 1) + '?', timestamp: now / 1000 - 9000 + i * 600 }, { role: 'assistant', content: para(4, 'Old'), timestamp: now / 1000 - 8990 + i * 600 });
msgs.push({ role: 'user', content: 'Triage the ready list', timestamp: now / 1000 - 400 }, { role: 'assistant', content: reply, timestamp: now / 1000 - 390 });
const shape = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.count || 2, messageCount: s.count || 2, archived: false, preview: s.preview || 'Done.',
  ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const cases = (process.env.QA_CASES || 'phone,phone-doc,desktop').split(','), kinds = (process.env.QA_KINDS || 'read,unread,working').split(',');
const backs = (process.env.QA_BACKS || 'button,system').split(','), expectBroken = process.env.QA_EXPECT === 'broken';
const acts = (process.env.QA_ACTS || 'look,send,send-go').split(',');
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of (process.env.QA_SKINS || 'nebula,grove').split(',')) for (const kind of kinds) for (const act of acts) for (const back of (act === 'send-go' ? ['auto'] : shell === 'desktop' ? ['escape'] : backs)) {
      const phone = shell.startsWith('phone'); if (act === 'send-go' && !phone) continue; // desktop keeps its thread pane
      const stem = `${shell}-${skin}-${kind}-${act}-${back}`, entry = { stem, errors: [] }; report.push(entry);
      const working = kind === 'working' || kind === 'working-newreply', daily = kind === 'daily', routed = kind === 'routed';
      const msgsA = routed ? msgs.map(m => m.content === reply ? { ...m, content: replyTo('claude') } : m) : msgs.slice();
      const DAY = d => new Date(now - d * 864e5).toISOString().slice(0, 10);
      const ROWS = [
        { id: 'qa-a', title: 'Ready list triage', at: now - 6 * 6e4, preview: 'Here is the triage.', count: msgs.length, status: working ? 'running' : 'completed' },
        { id: 'qa-b', title: 'Press notes', at: now - 60 * 6e4, preview: 'The draft is ready.' },
        { id: 'qa-c', title: 'Weekend plans', at: now - 2 * 36e5 },
        ...(daily ? [{ id: 'qa-y', title: 'Daily · ' + DAY(1), at: now - 864e5, preview: 'Yesterday.' }] : []),
      ].map(shape);
      if (daily) for (const s of ROWS) if (s.id === 'qa-a' || s.id === 'qa-y') s.channel = 'daily';
      const CLAUDE = routed ? ROWS.filter(s => s.id === 'qa-a' || s.id === 'qa-b') : [];
      if (routed) for (const s of CLAUDE) ROWS.splice(ROWS.indexOf(s), 1);
      const CHANNELS = [{ id: 'daily', agent: 'hermes', name: 'Daily', order: -2, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 0, kind: 'daily', dayStartsAt: '05:00' }];
      const dayRow = (id, d) => ({ day: DAY(d), sessionId: id, title: 'Daily · ' + DAY(d), opener: id === 'qa-a' ? 'Step 1?' : 'Yesterday', count: id === 'qa-a' ? msgsA.length : 2, lastAt: iso(now - d * 864e5) });
      // Read threads carry a seen mark at their latest activity; the unread case leaves qa-a without one (bold in Ready).
      const seen = { version: 1, threads: {} };
      for (const s of ROWS) if (!(kind === 'unread' && s.id === 'qa-a')) seen.threads['direct:' + s.id] = { seenAt: now, updatedAt: s.updated_at, assistantActivityAt: s.updated_at, messageCount: s.message_count, status: s.status };
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (shell === 'phone-doc' ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: ua } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, skin, go, daily, routed }) => {
          if (window !== top) return;
          if (go) localStorage.setItem('wos.chats.afterAction.v1', 'list');
          for (const [k, v] of Object.entries({ 'wos.shell': shell.startsWith('phone') ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, ...(daily || routed ? { 'wizard/chat-channels': true } : {}) } }) })) localStorage.setItem(k, v);
          if (daily) localStorage.setItem('wos.chats.view.v1', 'channels');
        }, { shell, skin, go: act === 'send-go', daily, routed });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'POST' && p === '/wizard/v1/channels/daily/today') return r.fulfill({ json: { channel: 'daily', agent: 'hermes', day: DAY(0), sessionId: 'qa-a', created: false } });
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
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: routed ? AGENTS : [] } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: daily ? CHANNELS : [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/v1/channels/daily/days') return r.fulfill({ json: { channel: 'daily', agent: 'hermes', dayStartsAt: '05:00', today: 'qa-a', days: [dayRow('qa-a', 0), dayRow('qa-y', 1)], next: null } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const data = daily && u.searchParams.get('channel') === 'daily' ? ROWS.filter(x => x.channel === 'daily').reverse().map(x => ({ ...x, listVersion: 1, agent: '' })) : [];
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') === 'claude' ? CLAUDE : u.searchParams.get('agent') ? [] : ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...ROWS, ...CLAUDE].find(x => x.id === decodeURIComponent(m[1]) && (x.id !== 'qa-a' && x.id !== 'qa-b' || !routed || u.searchParams.get('agent') === 'claude')); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: s.id === 'qa-a' ? msgsA : [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 3600 }, { role: 'assistant', content: s.preview + '\n\n' + para(3, 'Note'), timestamp: now / 1000 - 3590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (routed) await page.waitForFunction(() => WizLive.agentOf?.('qa-a') === 'claude', null, { timeout: 15000 });
        entry.unreadAtOpen = await page.evaluate(() => !!WizLive.isNew(WizLive.session('qa-a')));
        if (!routed) assert.equal(entry.unreadAtOpen, kind === 'unread', `${stem}: the first thread is ${kind === 'unread' ? '' : 'not '}unread in Ready before it opens`);
        if (daily) {
          await page.waitForFunction(() => true, null, { timeout: 15000 });
          await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
          if (!(await page.locator('.ch-chan-open[data-chchan="daily"]').filter({ visible: true }).count())) await vis('[data-chview="channels"]').click().catch(() => {});
          await page.screenshot({ path: path.join(out, `${stem}-0-channels.png`) });
          await vis('.ch-chan-open[data-chchan="daily"]').click();
          await page.waitForFunction(() => [...document.querySelectorAll('.ch-dday-h')].some(b => b.getClientRects().length), null, { timeout: 15000 });
        } else await vis('[data-chopen="qa-a"]').click();
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
        // Do something there: scroll it and type a draft (look), or send a reply (send, send-go).
        await page.mouse.move(phone ? 206 : 900, mid); await page.mouse.wheel(0, 300); await nap(300); await page.mouse.wheel(0, -200);
        const ta = vis('.ch-compose textarea');
        if (act === 'look') { if (await ta.count()) { await ta.click(); await ta.fill('Looks good'); await ta.fill(''); await page.keyboard.press('Tab').catch(() => {}); } }
        else { await ta.click(); await ta.fill('Looks good, send it'); await vis('.ch-compose .ch-send').click(); }
        // A new reply lands in the parent while he is away (issue 1653): the list and the thread both say so.
        if (kind === 'newreply' || kind === 'working-newreply' || daily || routed) {
          await nap(400);
          msgsA.push({ role: 'assistant', content: 'One more thing: ' + para(3, 'Later'), timestamp: Date.now() / 1000 });
          const a = [...ROWS, ...CLAUDE].find(x => x.id === 'qa-a'); Object.assign(a, { status: 'completed', updated_at: iso(Date.now()), updatedAt: iso(Date.now()), last_active: Date.now() / 1000, message_count: msgsA.length, messageCount: msgsA.length, preview: 'One more thing' });
          delete a.wizard_run_id; delete a.wizard_assigned_at;
          await page.evaluate(() => WizLive.refresh?.()).catch(() => {});
        }
        await nap(1500);
        if (back === 'auto') { /* Send and go already stepped back to the parent */ }
        else if (back === 'button') await vis('[data-chback]').click();
        else if (phone) await page.goBack(); else await page.keyboard.press('Escape');
        if (daily) await page.waitForFunction(() => [...document.querySelectorAll('.ch-dday-h')].some(b => b.getClientRects().length), null, { timeout: 15000 }).catch(() => { entry.noDailyView = true; });
        else await page.waitForFunction(() => [...document.querySelectorAll('.ch-head .ti b')].some(b => b.getClientRects().length && /Ready list triage/.test(b.textContent)), null, { timeout: 15000 });
        entry.samples = [];
        for (let i = 0; i < 10; i++) { entry.samples.push(await spot()); await nap(400); }
        await page.screenshot({ path: path.join(out, `${stem}-2-back.png`) });
        const last = entry.samples[entry.samples.length - 1];
        entry.ok = last != null && Math.abs(last - entry.before) <= 24 && !entry.noDailyView;
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
