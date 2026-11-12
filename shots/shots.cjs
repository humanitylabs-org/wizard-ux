'use strict';
// wizard-ux issue 1312 before/after: phone, Channels › # General (no agent picked), Opus picked in the General box,
// orb tap take started there; while it records the main Chats is switched to Philosopher (agent shortcut), then the
// take is sent. Records which agent and model the new chat is created with, plus screenshots.
const repo = process.env.REPO, web = process.env.QA_WEB || require('path').join(repo, 'web');
const { chromium } = require(require('path').join(repo, 'tools/qa-playwright.cjs'));
const { ownerRead } = require(require('path').join(repo, 'tools/qa-desktop-frame-fixture.cjs'));
const fs = require('node:fs'), path = require('node:path');
const origin = 'https://chat-general-agent.test', prefix = '/wizard-os-home/', out = process.env.QA_OUT, tag = process.env.TAG || 'after';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-a1'], createdAt: iso(now - 9e8) }];
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } },
  { id: 'philosopher', label: 'Philosopher', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'p', hue: 40 }, model: { provider: 'anthropic', model: 'claude-fable-5-1', allowed_models: ['claude-fable-5-1', 'claude-opus-4'] } },
];
const ROWS = [
  { id: 'qa-a1', title: 'App list', at: now - 36e5 },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 6e5 },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const writes = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'], userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(({ spaces }) => {
      if (window !== top || sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
        'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/chat-channels': true } }) })) localStorage.setItem(k, v);
    }, { spaces: SPACES });
    const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (!['GET', 'HEAD'].includes(method)) {
        let body = q.postData() || ''; try { body = JSON.parse(body); } catch (_) { body = body.slice(0, 200); }
        writes.push({ method, path: p, body });
        if (method === 'POST' && p.endsWith('/files/upload')) return r.fulfill({ json: { file: { id: 'qa-up-' + writes.length, filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
        if (method === 'POST' && /\/(transcribe|transcriptions|stt)\b/.test(p)) return r.fulfill({ json: { text: 'Synthetic voice post', transcript: 'Synthetic voice post' } });
        if (method === 'POST' && /\/api\/sessions$/.test(p)) return r.fulfill({ json: { session: { id: body?.id } } });
        if (method === 'POST' && /\/v1\/runs$/.test(p)) return r.fulfill({ json: { run_id: 'run-qa-' + writes.length } });
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
      if (/\/api\/sessions$/.test(p)) return r.fulfill({ json: { data: p.startsWith('/wizard/hermes/') ? ROWS : [], has_more: false } });
      const m = /\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
        return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
    await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
    await page.waitForFunction(() => window.WosAgents?.list?.length === 2, null, { timeout: 15000 });
    const vis = sel => page.locator(sel).filter({ visible: true }).first();
    await page.evaluate(() => __wos.openSheet('inbox')); await nap(500);
    await vis('[data-chview="channels"]').click(); await nap(300);
    await vis('.ch-chan-open[data-chchan="__general__"]').click(); await nap(800);
    await page.screenshot({ path: path.join(out, `${tag}-1-general.png`) });
    // Orb take started in # General.
    await vis('#orbWrap').tap(); await nap(1800);
    await page.screenshot({ path: path.join(out, `${tag}-2-recording.png`) });
    // While it records, the main Chats moves to Philosopher (his agent shortcut).
    await page.evaluate(() => __wos.openAgentChats('philosopher')); await nap(600);
    await vis('#orbWrap').tap();
    await page.waitForFunction(() => (window.__wos.outbox?.list?.() || []).length || true); await nap(4000);
    const items = await page.evaluate(() => { try { return (__wos.outbox.list?.() || __wos.outbox.items?.() || []).map(i => ({ kind: i.kind, agent: i.agent || '', model: i.model, state: i.state })); } catch (e) { return String(e); } });
    await page.evaluate(() => __wos.openSheet('inbox')); await nap(800);
    await page.screenshot({ path: path.join(out, `${tag}-3-after-send.png`) });
    await page.evaluate(() => __wos.openAgentChats('hermes')); await nap(800);
    await page.screenshot({ path: path.join(out, `${tag}-4-main-general.png`) });
    const runs = writes.filter(w => /runs$|api\/sessions$/.test(w.path)).map(w => ({ path: w.path, model: w.body?.model, provider: w.body?.provider }));
    const res = { tag, items, runs, errors };
    fs.writeFileSync(path.join(out, `${tag}-report.json`), JSON.stringify({ ...res, writes }, null, 2));
    console.log(JSON.stringify(res, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
