'use strict';
// wizard-ux issue 2007 in a real browser: an agent opened from the phone Apps panel (on for everyone) opens in
// the Apps section as its own window (that agent's chats, locked to it), and the main Chats section stays as it was.
// A synthetic box with two agents (the main one and Philosopher Agent, plus a private agent), Music, and one thread per
// agent. At 412 px, Nebula and Light (obsidian-light), three cases:
//   list    Chats shows the main agent's list; Apps panel → All apps → Philosopher Agent: the Apps section is in front
//           with Philosopher's own list, the Apps tile says Philosopher Agent, Chats is the same window with the same
//           focus, list and no thread. A new chat in the Philosopher window stays Philosopher's. After a reload it is
//           still there, in the Apps section.
//   thread  Chats has the main thread open; the same open leaves that thread open in Chats.
//   flip    Music, then Philosopher from the panel: a sideways swipe on the Apps tile flips between them, and neither
//           window (Music's frame, Philosopher's list) is rebuilt.
//   private Private Agent opens the same way, and its new chat goes to the private agent (privacy routing unchanged).
// QA_WEB=<another web dir> runs on a baseline; QA_EXPECT=broken asserts today's failure (Chats taken over).
// Synthetic transport only (no box is reached, every write is answered locally). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://apps-section-agent.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'apps-section-agent-evidence');
const broken = process.env.QA_EXPECT === 'broken';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const CASES = (process.env.QA_CASES || 'list,thread,flip,private').split(',');
const APPS = [['notes', 'Notes'], ['wizard-music', 'Music']].map(([id, name]) => ({ id, name, url: `/${id}/`, source: 'apps.json', kind: 'wizard' }));
const AGENTS = { agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running', appearance: { glyph: 'star', hue: 200 } },
  { id: 'philosopher', label: 'Philosopher Agent', status: 'running', privacy: 'standard', appearance: { glyph: 'moon', hue: 30 } },
  { id: 'private', label: 'Private Agent', status: 'running', privacy: 'private', appearance: { glyph: 'lock', hue: 300 } }] };
const now = Date.now(), iso = t => new Date(t).toISOString();
const THREADS = { '': [['main-1', 'Main thread about gardens']], philosopher: [['philo-1', 'On the nature of time']], private: [['priv-1', 'Private notes']] };
const raw = ([id, title], k) => ({ id, title, runtime: 'direct', status: 'completed', updated_at: iso(now - k * 60000), updatedAt: iso(now - k * 60000), last_active: (now - k * 60000) / 1000, message_count: 2, messageCount: 2, preview: 'hello' });
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));

async function boot(browser, skin, ctxIn) {
  const context = ctxIn || await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ANDROID });
  const sent = [];
  if (!ctxIn) {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(({ APPS, skin }) => {
      if (window !== top || localStorage.getItem('qa-seeded')) return; localStorage.setItem('qa-seeded', '1');
      const seed = { 'wux.apps.v1': JSON.stringify(APPS), 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
        'wos.recent': JSON.stringify(['notes']) };
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, { APPS, skin });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (p.includes('/v1/runs')) return r.abort();
      if (APPS.some(a => p.startsWith(a.url))) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="background:#26324d;color:#fff"><h1>app</h1><script>window.loadedAt=Math.random()</script>' });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (!['GET', 'HEAD'].includes(method)) { (context.__sent ||= []).push({ method, path: p, body: q.postData() || '' }); return r.fulfill({ json: { ok: true } }); }
      if (p === '/wizard/v1/agents') return r.fulfill({ json: AGENTS });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true, 'launcher.v1': true }, spaces: [], pinnedChats: [] } });
      if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
      if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: (THREADS[u.searchParams.get('agent') || ''] || []).map(raw), has_more: false, limit: 100, offset: 0 } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) {
        const id = decodeURIComponent(m[1]), t = Object.values(THREADS).flat().find(x => x[0] === id);
        if (!t) return r.fulfill({ status: 404, json: { error: 'missing' } });
        return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'hello', timestamp: now / 1000 - 60 }, { role: 'assistant', content: 'hi there', timestamp: now / 1000 - 50 }] } : { session: raw(t, 1) } });
      }
      if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
      if (p === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
      return r.fulfill({ json: {} });
    });
  }
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + 'index.html?phone');
  await page.waitForFunction(() => window.__wos && window.WizCore?.appsPanel && document.querySelector('.sec-tile') && window.WosAgents?.ready);
  await nap(1200);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page, errors, sent };
}

// The phone's state as a person sees it: the section in front, the Apps tile's name, every Chats window.
const state = page => page.evaluate(() => {
  const S = WizCore.phoneSections, d = __wos.desks[__wos.idx], f = d && __wos.wins[d.focus];
  const chats = Object.values(__wos.wins).filter(w => w && w.app === 'chats').map(w => ({ id: w.id, agent: w.agent || '', focus: w.focus || null, thread: w.thread || null, desk: __wos.desks.findIndex(x => x.wins.includes(w.id)) }));
  const tile = document.querySelector('.sec-tile[data-sec="apps"] .sec-nm')?.textContent || '';
  const vis = el => !!el && el.getClientRects().length > 0;
  const frontEl = d && document.querySelector(`[data-win="${CSS.escape(d.focus)}"]`);
  const rows = frontEl ? [...frontEl.querySelectorAll('.ch-list [data-chopen]')].filter(vis).map(r => r.dataset.chopen) : [];
  return { section: S.current(), sections: S.sections(), front: f ? { id: f.id, app: f.app, agent: f.agent || '', focus: f.focus || null, thread: f.thread || null } : null, chats, tile, rows };
});

async function openFromPanel(page, id) {
  const tap = async sel => { const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await nap(600); };
  if (!(await page.evaluate(() => !!document.querySelector('#appsPanel:not([hidden])')))) await tap('.sec-tile[data-sec="apps"]');
  await tap('[data-apall]');
  await tap(`[data-apopen="${id}"]`); await nap(1500);
}
async function goChats(page) {
  const b = await page.locator('.sec-tile[data-sec="chats"]').boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await nap(1200);
}
const mainOf = s => s.chats.find(c => !c.agent);

module.exports = { boot, state, openFromPanel, goChats };
if (require.main === module) (async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const skin of SKINS) for (const kase of CASES) {
      const tag = `412-${skin}-${kase}`, steps = { tag };
      const { context, page, errors } = await boot(browser, skin);
      const shot = s => page.screenshot({ path: path.join(out, `${tag}-${s}.png`) });
      try {
        await goChats(page);
        if (kase === 'thread') {
          await page.locator('.ch-list [data-chopen="main-1"]').first().waitFor({ state: 'visible' });
          const b = await page.locator('.ch-list [data-chopen="main-1"]').first().boundingBox(); await page.touchscreen.tap(b.x + 30, b.y + b.height / 2); await nap(1500);
        }
        steps.before = await state(page); await shot('1-chats-before');
        const main0 = mainOf(steps.before);
        assert.ok(main0, 'a main Chats window');
        if (kase === 'thread') assert.equal(main0.thread, 'main-1', 'the main thread is open in Chats');
        if (kase === 'flip') { await openFromPanel(page, 'wizard-music'); steps.music = await state(page); }
        const agent = kase === 'private' ? 'private' : 'philosopher', label = kase === 'private' ? 'Private Agent' : 'Philosopher Agent';
        if (kase === 'flip') await page.evaluate(() => { const f = document.querySelector('iframe[title="Music"]') || [...document.querySelectorAll('iframe')].find(x => /wizard-music/.test(x.src)); if (f) f.dataset.qaMark = 'kept'; });
        await openFromPanel(page, 'agent:' + agent);
        steps.opened = await state(page); await shot('2-apps-agent');
        if (broken) {
          assert.equal(steps.opened.section, 'chats', 'baseline: the agent takes over Chats');
          assert.equal(steps.opened.front.id, main0.id, 'baseline: it is the main Chats window');
          report.push({ tag, ok: true, steps }); await context.close(); continue;
        }
        assert.equal(steps.opened.section, 'apps', 'the Apps section is in front');
        assert.equal(steps.opened.front.app, 'chats'); assert.equal(steps.opened.front.agent, agent, 'a window locked to the agent');
        assert.notEqual(steps.opened.front.id, main0.id, 'not the main Chats window');
        assert.equal(steps.opened.tile, label, 'the Apps tile names the agent');
        await page.waitForFunction(a => { const d = __wos.desks[__wos.idx], el = document.querySelector(`[data-win="${CSS.escape(d.focus)}"]`); return el && [...el.querySelectorAll('.ch-list [data-chopen]')].some(r => r.dataset.chopen === a); }, THREADS[agent][0][0]);
        steps.opened = await state(page);
        assert.deepEqual(steps.opened.rows, [THREADS[agent][0][0]], "the agent's own list");
        const keptMain = mainOf(steps.opened);
        assert.deepEqual({ ...keptMain, desk: 0 }, { ...main0, desk: 0 }, 'the main Chats window is untouched');
        if (kase === 'list' || kase === 'private') {
          // A thread opened in the agent's window opens there; Back returns to its list.
          const own = THREADS[agent][0][0];
          await page.locator(`[data-win="${steps.opened.front.id}"] .ch-list [data-chopen="${own}"]`).first().tap(); await nap(1500);
          steps.thread = await state(page); await shot('2b-agent-thread');
          assert.equal(steps.thread.front.id, steps.opened.front.id, 'the thread opens in the agent window'); assert.equal(steps.thread.front.thread, own);
          assert.equal(steps.thread.section, 'apps');
          // (the synthetic box's Welcome sheet is hidden by style but still takes the first Back)
          steps.backDid = await page.evaluate(() => { let d = __wos.onBack(); if (d === 'welcome') d = __wos.onBack(); return d; }); await nap(1000);
          steps.threadBack = await state(page);
          assert.equal(steps.threadBack.section, 'apps', 'Back from the thread stays in the Apps section'); assert.equal(steps.threadBack.front.id, steps.opened.front.id); assert.equal(steps.threadBack.front.thread, null, 'on the agent\'s list');
          // New chat in the agent's window: a chat with that agent (the private one stays private), in that window.
          await page.locator(`[data-win="${steps.opened.front.id}"] [data-chfab]`).tap(); await nap(1200);
          await page.locator(`[data-win="${steps.opened.front.id}"] textarea:visible`).last().fill('qa 2007 hello'); await nap(300);
          await page.locator(`[data-win="${steps.opened.front.id}"] .ch-send:visible`).last().tap(); await nap(3000);
          steps.sent = await page.evaluate(id => { const w = __wos.wins[id]; return { thread: w.thread, agentOf: w.thread ? WizLive.agentOf(w.thread) : '', private: w.thread ? !!WizLive.isPrivate?.(w.thread) : false }; }, steps.opened.front.id);
          await shot('2c-agent-new-chat');
          assert.ok(steps.sent.thread && steps.sent.thread !== '__new__', 'the new chat started in the agent window');
          assert.equal(steps.sent.agentOf, agent, 'the new chat belongs to the agent');
          if (kase === 'private') assert.equal(steps.sent.private, true, 'the private agent\'s chat is private');
        }
        await goChats(page);
        steps.back = await state(page); await shot('3-chats-after');
        assert.equal(steps.back.section, 'chats');
        assert.equal(steps.back.front.id, main0.id, 'Chats is the main window');
        assert.deepEqual(steps.back.front.focus, main0.focus, 'Chats focus unchanged'); assert.equal(steps.back.front.thread, main0.thread, 'Chats thread unchanged');
        if (kase === 'list') {
          assert.deepEqual(steps.back.rows, steps.before.rows, 'Chats shows the same list');
          // A reload keeps the agent's window in the Apps section.
          await page.reload(); await page.waitForFunction(() => window.__wos && document.querySelector('.sec-tile') && window.WosAgents?.ready); await nap(1500);
          steps.reload = await state(page);
          const kept = steps.reload.chats.find(c => c.agent === agent);
          assert.ok(kept, "the agent's window is still there after a reload");
          assert.equal(steps.reload.sections.apps && steps.reload.tile, label, 'and still the Apps section');
          assert.ok(mainOf(steps.reload), 'the main Chats window too');
        }
        if (kase === 'flip') {
          const tile = await page.locator('.sec-tile[data-sec="apps"]').boundingBox(), y = tile.y + tile.height / 2;
          // With the Apps panel a sideways swipe on the tile steps one app through Recent (left = older, right = newer).
          const swipe = async dir => { const x0 = tile.x + tile.width / 2, x1 = x0 + dir * 60; await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 4 }); await page.mouse.up(); await nap(1200); };
          const agWin = steps.opened.front.id;
          await page.evaluate(id => { document.querySelector(`[data-win="${CSS.escape(id)}"]`).dataset.qaMark = 'kept'; }, agWin);
          await swipe(-1); steps.flip1 = await state(page); await shot('4-flip-music');
          assert.equal(steps.flip1.tile, 'Music', 'the flip shows Music');
          await swipe(1); steps.flip2 = await state(page); await shot('5-flip-agent');
          assert.equal(steps.flip2.tile, label, 'and back to the agent');
          steps.kept = await page.evaluate(id => ({ agent: document.querySelector(`[data-win="${CSS.escape(id)}"]`)?.dataset.qaMark || '', music: [...document.querySelectorAll('iframe')].some(f => f.dataset.qaMark === 'kept') }), agWin);
          assert.deepEqual(steps.kept, { agent: 'kept', music: true }, 'neither window reloaded');
        }
        assert.deepEqual(errors, [], 'no page errors');
        report.push({ tag, ok: true, steps });
      } catch (e) { failed++; await shot('fail').catch(() => {}); report.push({ tag, ok: false, error: e.message, steps }); }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const r of report) console.log(JSON.stringify({ tag: r.tag, ok: r.ok, error: r.error }));
  console.log(failed ? `FAIL ${failed}/${report.length}` : `PASS ${report.length}/${report.length}${broken ? ' (baseline broken as expected)' : ''}`);
  process.exit(failed ? 1 : 0);
})();
