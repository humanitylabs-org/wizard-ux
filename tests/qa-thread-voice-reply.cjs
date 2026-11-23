'use strict';
// wizard-ux issue 1547 in a real browser: a voice reply recorded in an existing thread on the desktop goes INTO that
// thread (one run on the thread's own id), never a new thread. Desktop 1440x900 AI apps, Channels on and off, the
// thread opened from the sidebar; the take is started and sent with the thread's own composer mic (and, as a second
// way, the orb; native = Wizard for Mac's orb / Right ⌘, the wizard:orb event, with QA_APP=1 an app beside holding focus).
// Disposable synthetic transport (as tests/qa-chat-channel-new-chat.cjs): nothing reaches a box, a
// fake microphone records. QA_EXPECT=broken (with QA_WEB=<main>/web) checks the baseline still fails.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://thread-voice.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'thread-voice-reply-evidence');
const MODES = (process.env.QA_MODES || 'channels,feed,plain').split(','), WAYS = (process.env.QA_WAYS || 'orb,key').split(',');
const BROKEN = process.env.QA_EXPECT === 'broken', VIEW = process.env.QA_VIEW || 'ai-apps';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [
  { id: 'qa-t1', title: 'Tracker review', at: now - 20 * 6e4, preview: 'Here is the review.' },
  { id: 'qa-t2', title: 'Weekend plans', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: process.env.QA_WORKING && s.id === 'qa-t1' ? 'running' : 'completed', ...(process.env.QA_WORKING && s.id === 'qa-t1' ? { runId: 'run-live', run_id: 'run-live', active_run_id: 'run-live' } : {}), updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: false, preview: s.preview }));
const SPACES = process.env.QA_SPACE ? [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-t1'], createdAt: iso(now - 9e8) }] : [];
const report = { origin, web, expect: BROKEN ? 'broken' : 'fixed', cases: [] };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const mode of MODES) for (const way of WAYS) {
      const stem = `${mode}-${way}${BROKEN ? '-before' : ''}`;
      const entry = { stem, errors: [], refused: [], created: [], runs: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: +(process.env.QA_W || 1440), height: 900 }, serviceWorkers: 'block', permissions: ['microphone'] });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ channels, view, spaces }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          const mix = { 'wizard/desktop-chats': true, ...(channels ? { 'wizard/chat-channels': true } : {}) };
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': view, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.chats.spaces.v1': JSON.stringify(spaces),
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { channels: mode !== 'plain', view: VIEW, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: SPACES };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'POST' && p === '/wizard/files/upload') return r.fulfill({ json: { file: { id: 'qa-up-' + entry.runs.length, filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
            if (method === 'POST' && /\/(transcribe|transcriptions|stt)\b/.test(p)) return r.fulfill({ json: { text: 'I am looking at the very thing', transcript: 'I am looking at the very thing' } });
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { const b = q.postDataJSON() || {}; entry.created.push(b.id); return r.fulfill({ json: { session: { id: b.id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { const b = q.postDataJSON() || {}; entry.runs.push({ session: b.session_id, input: b.input, instructions: b.instructions }); return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs.length } }); }
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Synthetic ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (VIEW === 'ai-apps') { await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 }); await vis('.aad-side').waitFor({ timeout: 15000 }); }
        else { await nap(2000); await page.evaluate(() => __wux.openChatsList()); await nap(1500); }
        if (VIEW !== 'ai-apps') {
          if (mode === 'feed') { await vis('[data-chview="channels"]').click().catch(() => {}); await nap(500); await vis(SPACES.length ? '.ch-chan-open[data-chchan="apps"]' : '.ch-chan-open').click(); await nap(800); await vis('.ch-post-b[data-chopen="qa-t1"]').click(); }
          else { if (mode === 'channels') { await vis('[data-chview="activity"]').click().catch(() => {}); await nap(500); } await vis('[data-chopen="qa-t1"]').click(); }
        } else if (mode === 'feed' || mode === 'feedthen' || mode === 'feedwin') {
          // The thread opened from its channel's feed (General): the feed was in the main column first.
          if (await page.locator('.aad-chan [data-chview="channels"]').filter({ visible: true }).count()) await vis('.aad-chan [data-chview="channels"]').click();
          await nap(600); await vis(SPACES.length ? '.aad-chan .ch-chan-open[data-chchan="apps"]' : '.aad-chan .ch-chan-open').click();
          await vis('.aad-feed .ch-chan-feed').waitFor({ timeout: 10000 }); await nap(600);
          if (mode === 'feedwin') await page.evaluate(() => __wux.openThread('qa-t1', { fresh: true }));
          else if (mode === 'feed') await vis('.aad-feed .ch-post-b[data-chopen="qa-t1"]').click();
          else if (mode === 'feedline') { if (process.env.QA_DUMP) fs.writeFileSync(path.join(out, 'side.html'), await page.locator('.aad-side').innerHTML()); await vis('.aad-chan [data-chopen="qa-t1"]').click(); }
          else { await vis('.aad-chan [data-chview="activity"]').click(); await nap(600); await vis('.aad-side [data-sid="qa-t1"], .aad-side [data-chopen="qa-t1"]').click(); }
        } else {
          if (mode === 'channels' && await page.locator('.aad-chan [data-chview="activity"]').filter({ visible: true }).count()) await vis('.aad-chan [data-chview="activity"]').click();
          await nap(600);
          await vis('[data-sid="qa-t1"], [data-chopen="qa-t1"]').click();
        }
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Here is the review/.test(t.innerText)), null, { timeout: 10000 });
        await nap(600);
        if (process.env.QA_APP) { await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store'])); await nap(2500); const fr = page.locator('iframe').filter({ visible: true }).first(); const b = await fr.boundingBox().catch(() => null); if (b) await page.mouse.click(b.x + b.width / 2, b.y + 200); await nap(600); }
        await page.screenshot({ path: path.join(out, stem + '-thread.png') });
        // The voice button in the thread's message box (the orb docked there), or ⌥Space (the orb's key).
        const start = async () => way === 'mic' ? page.locator('.ch-compose:not(.ch-chan-compose) [data-chmic]').filter({ visible: true }).last().click() : way === 'orb' ? vis('.aad-orb, #orbWrap, .orb-app').click() : way === 'native' ? page.evaluate(async () => { let st; const h = e => { st = e.detail.state; }; addEventListener('wizard:orb-state', h); window.dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'toggle' } })); for (let i = 0; i < 30 && !st; i++) await new Promise(r => setTimeout(r, 100)); removeEventListener('wizard:orb-state', h); }) : way === 'rcmd' ? page.keyboard.press('MetaRight') : page.keyboard.press('AltRight+Space');
        await start();
        await page.waitForFunction(() => document.documentElement.classList.contains('voice-on') || document.querySelector('.ch-mic.on'), null, { timeout: 8000 }).catch(() => {});
        await nap(1800);
        entry.said = (await page.evaluate(() => document.querySelector('#voiceText')?.innerText || '')).replace(/\s+/g, ' ');
        await page.screenshot({ path: path.join(out, stem + '-recording.png') });
        await start();
        await page.waitForFunction(n => window.__qaRuns > n, 0, { timeout: 1 }).catch(() => {});
        for (let i = 0; i < 40 && !entry.runs.length; i++) await nap(300);
        await nap(1200);
        await page.screenshot({ path: path.join(out, stem + '-sent.png') });
        entry.result = { runs: entry.runs.map(r => r.session), created: entry.created };
        if (BROKEN) assert.ok(entry.runs.some(r => r.session !== 'qa-t1') || entry.created.length, 'baseline: the reply leaves the thread');
        else {
          assert.deepEqual(entry.runs.map(r => r.session), ['qa-t1'], 'one run, on the thread it was recorded in');
          assert.deepEqual(entry.created, [], 'no new thread is made');
        }
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: report.expect, cases: report.cases.map(c => ({ stem: c.stem, pass: !!c.pass, said: c.said, result: c.result, errors: c.errors, refused: c.refused.filter(x => x.reason === 'unexpected-write'), failure: c.failure && String(c.failure).split('\n').slice(0, 2).join(' | ') })) }, null, 1));
  if (failed.length || report.cases.length !== MODES.length * WAYS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
