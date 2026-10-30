// Store × Connection Router: install sheet and "Models and connections" against fixture data only.
// Serves this tree's web/ itself and fulfils every Store data/install/router call; nothing reaches a real Wizard.
// node tests/qa-store-router.cjs   (QA_WEB_DIR=<tree>  QA_OUT=<dir for screenshots>  QA_CHROME=<binary, optional>)
const pw = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.join(process.env.QA_WEB_DIR || path.join(__dirname, '..'), 'web'), out = process.env.QA_OUT || '';
const BASE = 'http://store.qa/wizard-os-home/store/index.html';
const C = 'a'.repeat(40);
const app = (id, name, extra = {}) => ({ id, name, summary: name + ' summary', publisher: 'QA', version: '1.0.0', type: 'view', category: 'Reading',
  repo: 'https://github.com/qa/' + id, source: 'standard', channel: 'standard', commit: C, releases: [], ...extra });
const catalog = { apps: [app('wisdom', 'Wisdom'), app('wizard-claude', 'Wizard Claude', { provides: ['ai-connection'], category: 'Connections', type: 'service' }),
  app('wizard-chatgpt', 'Wizard ChatGPT', { provides: ['ai-connection'], category: 'Connections', type: 'service' })], sources: [], next_offset: null };
const providers = (claude, opus) => [
  { id: 'wizard-chatgpt', name: 'Wizard ChatGPT', status: 'connected', error: null, fix_url: '/wizard-os-home/?open=wizard-chatgpt', models: [{ id: 'gpt-5.1', label: 'GPT-5.1', tier: 'frontier' }, { id: 'gpt-5.1-mini', label: 'GPT-5.1 mini', tier: 'standard' }] },
  ...(claude ? [{ id: 'wizard-claude', name: 'Wizard Claude', status: 'connected', error: null, fix_url: '', models: [{ id: 'claude-sonnet-4.5', label: 'Sonnet', tier: 'standard' }, ...(opus ? [{ id: 'claude-opus-4.1', label: 'Opus', tier: 'frontier' }] : [])] }] : [])];
function needs(st) {
  if (st.scenario === 'match') return { type: 'needs', app: 'wisdom', services: [], providers: providers(true, true), models: [
    { feature: 'ask-ai', tier: 'standard', tested_on: 'claude-sonnet-4.5', swap: 'ask', status: 'ready', route: { provider: 'wizard-claude', model: 'claude-sonnet-4.5', tier: 'standard', chosen: 'match' }, offered: null, error: null },
    { feature: 'chapter-authoring', tier: 'frontier', tested_on: 'claude-opus-4.1', swap: 'never', status: 'ready', route: { provider: 'wizard-claude', model: 'claude-opus-4.1', tier: 'frontier', chosen: 'match' }, offered: null, error: null }] };
  if (st.scenario === 'none') return { type: 'needs', app: 'wisdom', services: [], providers: [], models: [
    { feature: 'ask-ai', tier: 'standard', tested_on: 'claude-sonnet-4.5', swap: 'ask', status: 'needs_owner', route: null, offered: null, error: { code: 'needs_owner', message: 'Needs your choice.' } },
    { feature: 'chapter-authoring', tier: 'frontier', tested_on: 'claude-opus-4.1', swap: 'never', status: 'blocked', route: null, offered: null, error: { code: 'blocked', message: 'Off until connected.' } }] };
  const ask = st.approved ? { feature: 'ask-ai', tier: 'standard', tested_on: 'claude-sonnet-4.5', swap: 'ask', status: 'ready', route: { provider: 'wizard-chatgpt', model: 'gpt-5.1-mini', tier: 'standard', chosen: 'owner-swap' }, offered: null, error: null }
    : { feature: 'ask-ai', tier: 'standard', tested_on: 'claude-sonnet-4.5', swap: 'ask', status: 'needs_owner', route: null, offered: { provider: 'wizard-chatgpt', model: 'gpt-5.1-mini', tier: 'standard', standing_in: false }, error: { code: 'needs_owner', message: 'Needs your choice.' } };
  return { type: 'needs', app: 'wisdom', models: [ask,
    { feature: 'chapter-authoring', tier: 'frontier', tested_on: 'claude-opus-4.1', swap: 'never', status: 'blocked', route: null, offered: null, error: { code: 'blocked', message: 'Off until connected.' } }],
    services: [], providers: providers(false) };
}

(async () => {
  const browser = await pw.chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
  try {
    for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) for (const scenario of ['swap', 'match', 'none']) {
      const st = { scenario, installed: false, approved: false, approvals: [], installs: 0, providerInstalls: 0, writes: [] };
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}), serviceWorkers: 'block' });
      const errors = []; const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await ctx.route('**/*', async r => {
        const u = new URL(r.request().url()), m = r.request().method();
        if (u.host !== 'store.qa') return r.abort();
        const p = u.pathname;
        if (p.startsWith('/wizard-os-home/store-data/')) {
          const sub = p.slice('/wizard-os-home/store-data/'.length);
          if (sub === 'wizard/v1/index/search') return json(r, 200, catalog);
          if (sub === 'api/apps/installed') return json(r, 200, { installed: [] });
          if (sub === 'wizard/v1/installed-apps') return json(r, 200, { complete: true, architecture: 'amd64', wam: [...(st.installed ? [{ id: 'wisdom', repo: catalog.apps[0].repo, commit: C, source: 'standard', status: 'running' }] : []), ...(st.providerInstalls ? [{ id: 'wizard-claude', repo: catalog.apps[1].repo, commit: C, source: 'standard', status: 'running' }] : [])], shell: [] });
          if (sub === 'router/v1/needs/wisdom' && m === 'GET') return st.installed ? json(r, 200, needs(st)) : json(r, 403, { code: 'blocked', message: 'Calling app is not installed.' });
          if (sub === 'router/v1/approve' && m === 'POST') {
            const b = JSON.parse(r.request().postData()); st.approvals.push({ b, h: r.request().headers() }); st.approved = true;
            return json(r, 200, { type: 'approved', route: { provider: b.provider, model: b.model } });
          }
          st.writes.push(m + ' ' + p); return json(r, 404, {});
        }
        if (p === '/wizard-os-home/store-install/wizard-claude' && m === 'POST') {
          st.providerInstalls++; return json(r, 200, { state: 'installed', selection: JSON.parse(r.request().postData()) });
        }
        if (p === '/wizard-os-home/store-install/wisdom') {
          if (m === 'POST') { st.installs++; st.installed = true; const b = JSON.parse(r.request().postData()); return json(r, 200, { state: 'installed', selection: b }); }
          return json(r, 200, { state: 'installed' });
        }
        if (m !== 'GET') { st.writes.push(m + ' ' + p); return r.abort(); }
        const f = path.join(web, p.replace(/^\/wizard-os-home\//, ''));
        if (!f.startsWith(web) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
        const ext = path.extname(f);
        return r.fulfill({ status: 200, contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream', body: fs.readFileSync(f) });
      });
      const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(e.message));
      const tag = `[${w} ${scenario}]`, shot = async n => { if (out) { fs.mkdirSync(out, { recursive: true }); await pg.waitForTimeout(700); await pg.screenshot({ path: path.join(out, `${w}-${scenario}-${n}.png`) }); } };
      await pg.goto(BASE + '?app=wisdom');
      await pg.locator('#detail [data-get]').first().waitFor({ timeout: 10000 });
      ok(await pg.locator('#detail .mc').count() === 0, `${tag} not installed: no Models and connections section`);
      await pg.locator('#detail [data-get]').first().click();
      await pg.locator('#sheet:not([hidden]) .mc-row').first().waitFor({ timeout: 10000 });
      ok(st.installs === 1, `${tag} one install POST`);
      ok(await pg.locator('#sheet .mc-detail:visible').count() === 0, `${tag} compact rows start collapsed`);
      await pg.locator('#sheet .mc-row summary').first().click();
      await pg.locator('#sheet .mc-row summary').nth(1).click();
      const sheet = await pg.evaluate(() => ({ layers: window.__store.state().layers, title: document.querySelector('#sheet h2').textContent, sub: document.querySelector('#sheet .list-head p').textContent,
        rows: [...document.querySelectorAll('#sheet .mc-row')].map(r => ({ f: r.dataset.mcFeature, state: r.querySelector('.mc-state').getAttribute('aria-label'), text: r.innerText, btns: [...r.querySelectorAll('button')].map(b => b.textContent) })) }));
      ok(sheet.layers.at(-1) === 'sheet', `${tag} install opens the sheet layer`);
      if (scenario !== 'swap') {
        const [a1, c1] = ['ask-ai', 'chapter-authoring'].map(f => sheet.rows.find(r => r.f === f));
        if (scenario === 'match') {
          ok(/Every connection is ready/.test(sheet.sub) && a1?.state === 'Ready' && c1?.state === 'Ready', `${tag} matching: every feature Ready (${sheet.sub})`);
          ok(/Using Sonnet · Claude/.test(a1?.text) && /Using Opus · Claude/.test(c1?.text) && a1.btns.every(b => b === 'Use another for this') && c1.btns.length === 0, `${tag} matching: tested models in use, no swap or connect offered`);
          ok(await pg.locator('#sheet .was-primary').innerText() === 'Open Wisdom', `${tag} matching: single Open Wisdom action`);
        } else {
          ok(/2 connections need setup/.test(sheet.sub) && a1?.state === 'Not ready' && a1.btns.length === 2 && a1.btns[0] === 'Set up Claude', `${tag} no provider: ask feature offers Set up Claude and Use another`);
          ok(c1?.state === 'Not ready' && c1.btns.length === 2 && c1.btns[0] === 'Set up Claude' && !sheet.rows.some(r => r.btns.some(b => /swap/i.test(b))), `${tag} no provider: strict feature off, no swap anywhere`);
        }
        await shot('sheet');
        await pg.locator('#sheet .mc-row[open] summary').first().click();
        await pg.locator('#sheet .mc-row[open] summary').first().click();
        await pg.locator('#sheet [data-back]').first().click();
        await pg.locator('#detail .mc .mc-row').first().waitFor({ timeout: 5000 });
        ok(await pg.evaluate(() => window.__store.state().layers.at(-1)) === 'detail', `${tag} Back returns to detail`);
        await pg.locator('#detail .mc').scrollIntoViewIfNeeded(); await shot('detail');
        ok(st.writes.length === 0 && st.approvals.length === 0, `${tag} no writes: ${st.writes.join(', ')}`);
        ok(errors.length === 0, `${tag} no page errors: ${errors.join(' | ')}`);
        await ctx.close(); continue;
      }
      ok(/Wisdom is installed/.test(sheet.title) && /2 connections need setup/.test(sheet.sub), `${tag} sheet title and count: ${sheet.sub}`);
      const ask = sheet.rows.find(r => r.f === 'ask-ai'), ch = sheet.rows.find(r => r.f === 'chapter-authoring');
      ok(ask && /Model: claude-sonnet-4\.5/.test(ask.text) && !ask.btns.includes('Connect Claude') && ask.btns.includes('Approve swap to gpt-5.1-mini') && ask.btns.includes('Use another for this'), `${tag} ask-ai: tested model, named approval primary and Use another`);
      ok(ask && /Results may differ/.test(ask.text), `${tag} ask-ai warns results may differ`);
      ok(ch && ch.state === 'Not ready' && ch.btns.length === 2 && ch.btns[0] === 'Set up Claude' && /tested model only/.test(ch.text), `${tag} strict feature: off, connect only, no swap`);
      // Buttons are thumb-sized and nothing overflows the window.
      const geo = await pg.evaluate(() => ({ minH: Math.min(...[...document.querySelectorAll('#sheet .mc-btn:where(:not(details:not([open]) *))')].map(b => b.getBoundingClientRect().height)), over: document.documentElement.scrollWidth - innerWidth }));
      ok(geo.minH >= 40 && geo.over <= 0, `${tag} buttons ≥40px (${geo.minH}) and no horizontal overflow (${geo.over})`);
      await shot('sheet');
      // Approve the swap: one POST with the Store header, and the row reads Ready · approved swap.
      await pg.locator('#sheet [data-mc-approve="ask-ai"]').click();
      await pg.locator('#sheet .mc-row[data-mc-feature="ask-ai"] .mc-state.ready').waitFor({ timeout: 5000 });
      const ap = st.approvals[0];
      ok(st.approvals.length === 1 && ap.b.app === 'wisdom' && ap.b.provider === 'wizard-chatgpt' && ap.b.model === 'gpt-5.1-mini' && ap.h['x-wizard-store'] === '1', `${tag} approve sends one exact owner choice`);
      await pg.locator('#sheet [data-mc-feature="ask-ai"] summary').click();
      const after = await pg.evaluate(() => ({ state: document.querySelector('#sheet .mc-row[data-mc-feature="ask-ai"] .mc-state').getAttribute('aria-label'), text: document.querySelector('#sheet .mc-row[data-mc-feature="ask-ai"]').innerText, sub: document.querySelector('#sheet .list-head p').textContent }));
      ok(after.state === 'Ready' && /Using GPT-5\.1 mini · ChatGPT/.test(after.text) && /Approved replacement model/.test(after.text), `${tag} approved row shows the swap in use`);
      ok(/1 connection needs setup/.test(after.sub), `${tag} sheet count updates: ${after.sub}`);
      await shot('approved');
      // Back closes the sheet; the app's detail now carries Models and connections.
      await pg.locator('#sheet .mc-row[open] summary').first().click();
      await pg.locator('#sheet [data-back]').first().click();
      await pg.locator('#detail .mc .mc-row').first().waitFor({ timeout: 5000 });
      const det = await pg.evaluate(() => ({ layers: window.__store.state().layers, h: document.querySelector('#detail .mc h3')?.textContent, rows: document.querySelectorAll('#detail .mc .mc-row').length }));
      ok(det.layers.at(-1) === 'detail' && det.h === 'Models and connections' && det.rows === 2, `${tag} Back returns to detail with Models and connections`);
      await pg.locator('#detail .mc').scrollIntoViewIfNeeded(); await shot('detail');
      // Setup reuses the Store's qualified install transaction, not a second installer.
      await pg.locator('#detail .mc-row[data-mc-feature="chapter-authoring"] summary').click();
      await pg.locator('#detail .mc-row[data-mc-feature="chapter-authoring"] [data-mc-connect]').click();
      await pg.waitForFunction(() => /Open this provider from Apps/.test(document.querySelector('#toast').textContent));
      ok(st.providerInstalls === 1, `${tag} Set up Claude installs recommended provider once via Store`);
      ok(st.writes.length === 0, `${tag} no other writes: ${st.writes.join(', ')}`);
      ok(errors.length === 0, `${tag} no page errors: ${errors.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
