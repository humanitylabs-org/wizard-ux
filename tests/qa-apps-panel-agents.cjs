'use strict';
// wizard-ux issue 1989 in a real browser: the phone Apps panel (on for everyone) with other agents and
// connectors installed. A synthetic box with two agents (the main one and Philosopher Agent), two apps and two
// connectors (wizard.md `type: external`: Claude, ChatGPT). At 412 px, Nebula and Light (obsidian-light), it checks:
// All apps lists the apps and Philosopher Agent and no connector; search finds the agent and no connector; the star on
// Philosopher sticks, is saved to ui-preferences as `agent.philosopher` and is still a Favorite after a reload that
// reads the box's list; tapping the row opens Philosopher's own chat list (not the main Inbox) and it is on Recent.
// QA_WEB=<another web dir> runs the same steps on a baseline (QA_EXPECT=broken: asserts today's failures instead).
// Synthetic transport only (no box is reached). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const { applyPanelOps } = require('./fixtures/qa-prefs-patch.cjs');
const repo = path.resolve(__dirname, '..'), origin = 'https://apps-panel-agents.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'apps-panel-agents-evidence');
const broken = process.env.QA_EXPECT === 'broken';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const APPS = [['notes', 'Notes'], ['wizard-music', 'Music'], ['wizard-claude', 'Claude', 'external'], ['wizard-chatgpt', 'ChatGPT', 'external']]
  .map(([id, name, type]) => ({ id, name, url: `/${id}/`, source: 'apps.json', kind: 'wizard', ...(type ? { type } : {}) }));
const AGENTS = { agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running', appearance: { glyph: 'star', hue: 200 } },
  { id: 'philosopher', label: 'Philosopher Agent', status: 'running', privacy: 'standard', appearance: { glyph: 'moon', hue: 30 } }] };
const CONNECTORS = ['wizard-claude', 'wizard-chatgpt'];
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));

async function boot(browser, skin, prefs) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ANDROID });
  const puts = [];
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ APPS, skin }) => {
    if (window !== top || sessionStorage.getItem('qa-seeded')) return; sessionStorage.setItem('qa-seeded', '1');
    const seed = { 'wux.apps.v1': JSON.stringify(APPS), 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
      'wos.recent': JSON.stringify(['notes']) };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { APPS, skin });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== origin) return r.abort();
    if (p.includes('/v1/runs')) return r.abort();
    if (APPS.some(a => p.startsWith(a.url))) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="background:#26324d;color:#fff"><h1>app</h1>' });
    if (p.startsWith(prefix)) {
      const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
    }
    // PATCH: the panel's item operations (wizard-ux#2047); a colon id is refused here too.
    if (p === '/wizard/v1/ui-preferences' && method === 'PATCH') {
      const next = applyPanelOps(prefs, JSON.parse(q.postData() || '{}').ops); if (!next) return r.fulfill({ status: 400, json: { error: 'invalid_preferences' } });
      Object.assign(prefs, next); puts.push(next); return r.fulfill({ json: prefs });
    }
    if (p === '/wizard/v1/ui-preferences' && method === 'PUT') {
      const body = JSON.parse(q.postData() || '{}');
      // The box's own rule (wizard-agent-service ui-preferences appIdList): a list with a colon id is refused.
      for (const k of ['appFavorites', 'appRecentHidden']) if (k in body && !body[k].every(id => /^[A-Za-z0-9._-]{1,80}$/.test(id))) return r.fulfill({ status: 400, json: { error: 'invalid_preferences' } });
      puts.push(body); Object.assign(prefs, body); return r.fulfill({ json: prefs });
    }
    if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
    if (p === '/wizard/v1/agents') return r.fulfill({ json: AGENTS });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [], has_more: false, limit: 100, offset: 0 } });
    if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (p === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
    return r.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + 'index.html?phone');
  await page.waitForFunction(() => window.__wos && window.WizCore?.appsPanel && document.querySelector('.sec-tile') && window.WosAgents?.ready);
  await nap(1200);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page, errors, puts };
}

(async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const skin of SKINS) {
      const tag = `412-${skin}`, steps = { tag }, prefs = { migrations: { 'launcher-seed-v1': true, 'launcher.v1': true }, spaces: [], pinnedChats: [] };
      const { context, page, errors, puts } = await boot(browser, skin, prefs);
      const tap = async sel => { const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await nap(600); };
      const rows = () => page.evaluate(() => [...document.querySelectorAll('#appsPanel .ap-row')].map(r => r.dataset.aprow));
      const shot = s => page.screenshot({ path: path.join(out, `${tag}-${s}.png`) });
      try {
        await tap('.sec-tile[data-sec="apps"]'); await tap('[data-apall]');
        steps.all = await rows(); await shot('all-apps');
        if (broken) {
          assert.ok(CONNECTORS.some(id => steps.all.includes(id)), 'baseline: connectors are listed');
        } else {
          for (const id of CONNECTORS) assert.ok(!steps.all.includes(id), `${id} is not in All apps`);
          for (const id of ['notes', 'wizard-music', 'agent:philosopher']) assert.ok(steps.all.includes(id), `${id} is in All apps`);
          await page.fill('[data-apq]', 'claude'); await nap(300); steps.searchClaude = await rows(); assert.deepEqual(steps.searchClaude, [], 'search finds no connector');
          await page.fill('[data-apq]', 'philo'); await nap(300); steps.searchPhilo = await rows(); assert.deepEqual(steps.searchPhilo, ['agent:philosopher'], 'search finds the agent');
          await page.fill('[data-apq]', ''); await nap(300);
        }
        await tap('[data-apback]'); await tap('[data-apadd]');
        if (await page.$('[data-apstar="agent:philosopher"]')) await tap('[data-apstar="agent:philosopher"]');
        steps.favs = await page.evaluate(() => WizCore.appsPanel.favorites()); steps.saved = prefs.appFavorites || null;
        await shot('add-favorites');
        if (broken) assert.deepEqual(steps.favs, [], 'baseline: the star does not stick');
        else {
          assert.deepEqual(steps.favs, ['agent:philosopher'], 'the star sticks');
          assert.deepEqual(steps.saved, ['agent.philosopher'], 'saved on the box');
        }
        await tap('[data-apdone]'); await tap('[data-apdone]');
        steps.home = await rows(); await shot('favorites');
        await page.evaluate(() => WizCore.appsPanel.close()); await nap(900); // past the tile's own 500 ms close-toggle
        // Opening it from All apps: Philosopher's own list, and it is a recent app.
        await tap('.sec-tile[data-sec="apps"]'); await tap('[data-apall]');
        steps.agentRow = !!(await page.$('[data-apopen="agent:philosopher"]'));
        if (broken && !steps.agentRow) { await shot('opened'); report.push({ tag, ok: true, steps }); await context.close(); continue; } // baseline: no agent row on a fresh load
        await tap('[data-apopen="agent:philosopher"]'); await nap(1200);
        steps.opened = await page.evaluate(() => { const d = __wos.desks[__wos.idx], w = d && __wos.wins[d.focus]; return { app: w?.app || '', focus: w?.focus || null, head: document.querySelector('#appsPanel')?.hidden, recent: JSON.parse(localStorage.getItem('wos.recent') || '[]') }; });
        steps.title = await page.evaluate(() => [...document.querySelectorAll('.win, .ch-wrap, body')].map(e => e.innerText).join(' ').includes('Philosopher Agent'));
        await shot('opened');
        if (broken) assert.equal(steps.opened.focus, null, 'baseline: lands on the main Inbox');
        else {
          assert.equal(steps.opened.app, 'chats'); assert.deepEqual(steps.opened.focus, { kind: 'agent', key: 'philosopher' }, 'Philosopher\'s own list');
          assert.equal(steps.opened.recent[0], 'agent:philosopher', 'on Recent (this device)');
          // A reload that reads the box's lists (another device, or this one after clearing): still a Favorite.
          const second = await boot(browser, skin, prefs);
          steps.reload = await second.page.evaluate(() => WizCore.appsPanel.favorites());
          assert.deepEqual(steps.reload, ['agent:philosopher'], 'still a Favorite after a reload from the box');
          assert.deepEqual(second.errors, []); await second.context.close();
        }
        assert.deepEqual(errors, [], 'no page errors');
        report.push({ tag, ok: true, steps });
      } catch (e) { failed++; report.push({ tag, ok: false, error: e.message, steps }); }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const r of report) console.log(JSON.stringify({ tag: r.tag, ok: r.ok, error: r.error }));
  console.log(failed ? `FAIL ${failed}/${report.length}` : `PASS ${report.length}/${report.length}${broken ? ' (baseline broken as expected)' : ''}`);
  process.exit(failed ? 1 : 0);
})();
