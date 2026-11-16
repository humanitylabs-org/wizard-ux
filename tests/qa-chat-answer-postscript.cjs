'use strict';
// ux#1319 in a real browser: a reply written in the same message as a tool call, then a short postscript. The reply
// must show as the answer (outside the collapsed work log), with the postscript under it. Phone + desktop classic.
// Synthetic transport only. QA_WEB=<main checkout>/web QA_EXPECT=broken proves main hides it.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-answer-postscript.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-answer-postscript-evidence');
const broken = process.env.QA_EXPECT === 'broken', now = Date.now();
fs.mkdirSync(out, { recursive: true });
const ANSWER = `**Short answer:** yes, the essay holds up.\n\n${Array.from({ length: 12 }, (_, i) => `Point ${i + 1}: the argument in section ${i + 1} follows from the one before it, and the evidence you cite there is enough to carry it.`).join('\n\n')}`;
const PS = 'The reply above stands as written; I also saved it to your notes.';
const row = { id: 'qa-ps', title: 'Essay check', runtime: 'direct', status: 'completed', updated_at: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), message_count: 4, messageCount: 4, archived: false, preview: PS };
const messages = [{ role: 'user', content: 'Does my essay hold up?', timestamp: now / 1000 - 60 },
  { role: 'assistant', content: ANSWER, timestamp: now / 1000 - 50, tool_calls: [{ id: 'c1', function: { name: 'patch', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}', timestamp: now / 1000 - 45 },
  { role: 'assistant', content: PS, timestamp: now / 1000 - 40 }];
(async () => {
  const browser = await chromium.launch(), results = [];
  try {
    for (const shell of ['phone', 'desktop']) {
      const phone = shell === 'phone', errors = [];
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(shell => { if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done' })) localStorage.setItem(k, v); }, shell);
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: p === '/wizard/thread-seen' ? 200 : 405, json: { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (abs.startsWith(path.resolve(web) + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: {} });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row], has_more: false } });
          if (p === '/wizard/hermes/api/sessions/qa-ps/messages') return r.fulfill({ json: { messages } });
          if (p === '/wizard/hermes/api/sessions/qa-ps') return r.fulfill({ json: { session: row } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const listRow = page.locator('.ch-list [data-chopen="qa-ps"]').filter({ visible: true }).first();
        await listRow.waitFor(); await listRow.click();
        const thread = page.locator('.ch-thread').filter({ visible: true }).first();
        await thread.getByText('Point 12', { exact: false }).first().waitFor({ state: 'attached' });
        await page.waitForTimeout(500);
        const seen = await thread.evaluate(t => {
          const a = [...t.querySelectorAll('.msg.a')].map(x => x.innerText).join('\n');
          return { answer: a, inLog: [...t.querySelectorAll('details.steps')].some(d => /Point 12/.test(d.textContent)) };
        });
        const shown = /Point 12/.test(seen.answer) && /stands as written/.test(seen.answer) && !seen.inLog;
        await thread.getByText('Short answer', { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(out, `${broken ? 'before' : 'after'}-${shell}.png`) });
        assert.equal(shown, !broken, `${shell}: answer ${broken ? 'hidden in the work log on main' : 'shown as the reply'} (${JSON.stringify({ inLog: seen.inLog, answer: seen.answer.slice(0, 120) })})`);
        assert.equal(errors.length, 0, errors.join('; '));
        results.push({ shell, shown, inLog: seen.inLog });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ expect: broken ? 'broken' : 'fixed', results }));
})().catch(e => { console.error(e); process.exitCode = 1; });
