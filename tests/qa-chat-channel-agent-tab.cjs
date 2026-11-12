'use strict';
// Since wizard-ux issue 1336 the focus strip is gone while Channels is on (agents live in the Channels list's Agents row):
// run this only against a tree from before it (QA_WEB=<that tree>/web).
// wizard-ux issue 1340 in a real browser: phone 412x915, Nebula + Grove, Channels on, two agents. Open a named channel,
// go Back, open General: the agent tab in the Chats focus strip names the agent ("Archimedes"), never the channel
// ("WizardOS Apps"), in every step. Synthetic transport only (no box is reached; writes are answered in memory).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-channel-agent-tab.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-agent-tab-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-a1'], createdAt: iso(now - 9e8) }];
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
];
const ROWS = [
  { id: 'qa-a1', title: 'App list', at: now - 36e5 },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 6e5 },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of ['nebula', 'grove']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      const errors = [];
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
        }, { skin, spaces: SPACES });
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
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.waitForFunction(() => window.WosAgents?.list?.length === 2, null, { timeout: 15000 });
        await page.evaluate(() => __wos.openSheet('inbox'));
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const tab = async () => (await vis('.ch-focus-strip [data-chfocusopt="agent:hermes"]').innerText()).trim().split('\n')[0]; // the caret ⌄ sits on its own line
        await vis('[data-chview="channels"]').click(); await nap(300);
        // The strip sits under the Channels list (a feed's message box takes its place): read it after each Back.
        const steps = {}, shot = async n => page.screenshot({ path: path.join(out, `${skin}-${n}${broken ? '-before' : ''}.png`) });
        await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(400);
        await vis('[data-chchanback]').click(); await nap(300);
        steps.afterNamed = await tab(); await shot('1-after-named-channel');
        await vis('.ch-chan-open[data-chchan="__general__"]').click(); await nap(400);
        await vis('[data-chchanback]').click(); await nap(300);
        steps.afterGeneral = await tab(); await shot('2-after-general');
        // On Archimedes (its tab) and then a named channel and Back: still the agent.
        await vis('.ch-focus-strip [data-chfocusopt="agent:hermes"]').click(); await nap(400);
        steps.agentTapped = await tab();
        await vis('[data-chview="channels"]').click(); await nap(300);
        await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(400);
        await vis('[data-chchanback]').click(); await nap(300);
        steps.agentThenNamed = await tab(); await shot('3-agent-then-named');
        report.push({ skin, steps, errors });
        if (broken) assert.ok(Object.values(steps).includes('WizardOS Apps'), `${skin}: main shows the channel name on the agent tab`);
        else for (const [k, v] of Object.entries(steps)) assert.equal(v, 'Archimedes', `${skin} ${k}: the agent tab names the agent`);
        assert.deepEqual(errors, [], `${skin}: no page errors`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
