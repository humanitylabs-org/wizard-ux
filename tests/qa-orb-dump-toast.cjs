'use strict';
// Orb dump "Got it" toast (wizard-ux issue 1588; on for everyone since wizard-ux issue 1778, no switch) in a real
// browser, through the real orb:
// Chromium's fake capture device records a take, the shell stages it, the outbox transcribes it and asks the router
// with accept_dump. Disposable synthetic transport only: the fake box answers the router with a dump (record written,
// hidden worker started on its side), so the shell must show "Got it · <title>" and create no thread and no run.
// Phone 412x915 and Classic desktop 1440x900, Nebula + Grove. Timing: send tap -> toast visible (fake STT + router at
// QA_ROUTER_MS, default 400 ms, about the live fast classifier).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://orb-dump-toast.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'orb-dump-toast-evidence');
const ROUTER_MS = +(process.env.QA_ROUTER_MS || 400);
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SAID = 'Research flights to Lisbon for next Friday';
const ROWS = [{ id: 'qa-chat-1', title: 'Weekend plans', at: now - 20 * 6e4, preview: 'A walk by the river.' }]
  .map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: s.preview }));
const report = { origin, web, routerMs: ROUTER_MS, cases: [] };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], routes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}), serviceWorkers: 'block', permissions: ['microphone'] });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ phone, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wux.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { phone, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p, at: Date.now() });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            if (method === 'POST' && p === '/wizard/files/upload') return r.fulfill({ json: { file: { id: 'qa-up-' + entry.writes.length, filename: 'voice.webm', mime: 'audio/webm', bytes: 10 } } });
            if (method === 'POST' && /\/(transcribe|transcriptions|stt)\b/.test(p)) return r.fulfill({ json: { text: SAID, transcript: SAID, ms: 120 } });
            if (method === 'POST' && (p === '/wizard/v1/route' || p === prefix + 'api/route')) {
              const body = q.postDataJSON() || {}; entry.routes.push(body);
              await nap(ROUTER_MS);
              return r.fulfill({ json: body.accept_dump === true
                ? { cmd: { route: 'dump', title: 'Lisbon flights for Friday', deadline: null, summary: body.text, record_id: 'inbox_' + 'c'.repeat(24), thread_id: 'wizard_hidden_qa', created: true }, ms: ROUTER_MS }
                : { cmd: { route: 'agent', summary: body.text }, ms: ROUTER_MS } });
            }
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { (entry.created = entry.created || []).push((q.postDataJSON() || {}).id); return r.fulfill({ json: { session: { id: (q.postDataJSON() || {}).id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { entry.runs = (entry.runs || 0) + 1; return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix) && !p.startsWith(prefix + 'api/')) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/desktop-chats'), null, { timeout: 15000 });
        await nap(1200);
        const rowsBefore = await page.evaluate(() => (window.WizLive?.sessions || []).map(s => s.id));
        // The orb: tap to talk, about 1.6 s of the fake microphone, tap to send.
        const orb = async () => { if (phone) await page.locator('#orbWrap').tap(); else await page.keyboard.press('Alt+KeyV'); };
        await orb();
        await page.waitForFunction(() => { const v = window.__wos?.voiceState?.() ?? null; return v === 'listen' || document.documentElement.classList.contains('voice-on') || !!document.querySelector('#voice.on, .listening, #voicePill.on, #voicePill:not([hidden])'); }, null, { timeout: 8000 }).catch(() => {});
        await nap(1600);
        const sentAt = Date.now();
        await orb();
        const toast = page.locator('.toast.got-it');
        await page.waitForFunction(() => { const t = document.querySelector('.toast.got-it'); return t && (t.classList.contains('show') || t.classList.contains('on')); }, null, { timeout: 8000 });
        entry.toastMs = Date.now() - sentAt;
        entry.toast = (await toast.innerText()).replace(/\s+/g, ' ').trim();
        entry.style = await toast.evaluate(n => { const s = getComputedStyle(n); return { bg: s.backgroundColor, bgImage: s.backgroundImage, color: s.color }; });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(out, stem + '-got-it.png') });
        assert.match(entry.toast, /Got it · Lisbon flights for Friday/, entry.toast);
        assert.equal(entry.routes.length, 1, 'one router call');
        assert.equal(entry.routes[0].accept_dump, true); assert.equal(entry.routes[0].text, SAID);
        assert.ok(entry.toastMs < 2000, 'toast within 2 s of Send: ' + entry.toastMs + ' ms');
        assert.ok(!/rgba\([^)]*, 0(\.\d+)?\)/.test(entry.style.bg), 'opaque panel: ' + entry.style.bg);
        await nap(1500);
        assert.equal((entry.created || []).length, 0, 'no thread created');
        assert.equal(entry.runs || 0, 0, 'no run sent from the shell');
        const rowsAfter = await page.evaluate(() => (window.WizLive?.sessions || []).map(s => s.id));
        assert.deepEqual(rowsAfter, rowsBefore, 'no new row in the chat list');
        entry.nav = await page.evaluate(() => location.pathname + location.search);
        assert.ok(entry.nav.endsWith(phone ? 'index.html?phone' : 'desktop.html'), 'no navigation: ' + entry.nav);
        entry.pass = true;
      } catch (e) {
        entry.pass = false; entry.failure = String(e.stack || e).split('\n').slice(0, 3).join(' ');
        entry.items = await context.pages()[0]?.evaluate(() => [...(window.WosOutbox?._items?.values() || [])].map(it => ({ kind: it.kind, dump: it.dump, dumped: !!it.dumped, state: it.state, agent: it.agent, files: (it.files || []).length, typed: !!it.typed, reply: !!it.reply }))).catch(() => null);
      }
      finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  for (const c of report.cases) console.log(c.stem, c.pass ? 'PASS' : 'FAIL', c.toastMs != null ? c.toastMs + ' ms' : '', c.toast || '', c.failure || '', c.items ? JSON.stringify(c.items) : '', c.errors.length ? 'errors: ' + c.errors.join(' | ') : '');
  if (report.cases.some(c => !c.pass)) process.exitCode = 1;
})();
