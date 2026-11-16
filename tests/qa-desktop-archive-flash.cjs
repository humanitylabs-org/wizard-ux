'use strict';
// Synthetic origin only: no owner reads, sends, preference writes or /v1/runs.
// Run with QA_PLAYWRIGHT and optional QA_REF=<pre-#1060 revision> for failing-first proof.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..'), origin = 'https://archive-flash.test', prefix = '/wizard-os-home/';
const out = process.env.QA_OUT || 'archive-flash-evidence';
fs.mkdirSync(out, { recursive: true });
const mime = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.json') ? 'application/json' : 'text/html';
// Select the entire immutable web tree, including assets missing from the candidate.
// Never silently substitute candidate bytes when QA_REF cannot supply a file.
const ref = process.env.QA_REF && execFileSync('git', ['rev-parse', '--verify', process.env.QA_REF + '^{commit}'], { cwd: repo, encoding: 'utf8' }).trim();
const refFiles = ref && new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'web/'], { cwd: repo, encoding: 'utf8' }).trim().split('\n'));
const refCache = new Map();
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const report = { ref: ref || null, cases: [] }, failures = [];
  try {
    for (const skin of ['nebula', 'sepia']) for (const action of ['row', 'inside', 'voice']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', permissions: ['microphone'] });
      const errors = [], blocked = [], writes = [];
      try {
        await c.routeWebSocket('**/*', w => w.close());
        await c.addInitScript(skin => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
        }, skin);
        await c.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url());
          if (u.origin !== origin) return r.abort();
          if (u.pathname.includes('/v1/runs')) { blocked.push(u.pathname); return r.abort(); }
          // Fulfill mutations locally, before the static route: nothing reaches a server.
          if (!['GET', 'HEAD'].includes(q.method())) {
            writes.push({ method: q.method(), path: u.pathname, body: q.postData() });
            return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } });
          }
          if (u.pathname.startsWith(prefix)) {
            const f = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(repo, 'web', f);
            if (!abs.startsWith(path.join(repo, 'web') + path.sep)) return r.abort();
            if (ref) {
              const key = 'web/' + f;
              if (!refFiles.has(key)) return r.fulfill({ status: 404, body: 'Not in QA_REF' });
              if (!refCache.has(key)) refCache.set(key, execFileSync('git', ['show', ref + ':' + key], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }));
              return r.fulfill({ body: refCache.get(key), contentType: mime(f) });
            }
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'Missing fixture asset' });
          }
          if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          // Dated from now: a fixed day aged out of the sidebar's 7-day recent window on 13 Nov 2026 (same trap as PR #1392).
          const AT = new Date(Date.now() - 2 * 864e5).toISOString(), TS = Math.floor(Date.parse(AT) / 1000);
          const row = { id: 'qa-thread', title: 'Synthetic archive conversation', runtime: 'direct', status: 'completed', updated_at: AT, updatedAt: AT, message_count: 2, messageCount: 2 };
          if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row], has_more: false } });
          if (u.pathname.includes('/sessions/qa-thread/messages')) return r.fulfill({ json: { messages: [{ role: 'user', content: 'Synthetic question', timestamp: TS }, { role: 'assistant', content: 'Synthetic answer remains visible', timestamp: TS + 1 }] } });
          if (u.pathname.endsWith('/sessions/qa-thread')) return r.fulfill({ json: { session: row } });
          return r.fulfill({ json: ownerRead(u.pathname) });
        });
        const p = await c.newPage();
        p.on('pageerror', e => errors.push(e.message));
        await p.goto(origin + prefix + 'desktop.html');
        await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy);
        await p.evaluate(() => __wux.openThread('qa-thread'));
        await p.locator('.pane-main .ch-compose').waitFor({ state: 'visible' });
        await p.getByText('Synthetic answer remains visible', { exact: true }).waitFor({ state: 'visible' });
        await p.waitForTimeout(900);
        const stem = skin + '-' + action;
        await p.screenshot({ path: path.join(out, stem + '-before.png') });
        if (action === 'row') {
          await p.locator('.aad-rw[data-sid="qa-thread"] .aad-row').dispatchEvent('contextmenu');
          // No internal-action fallback: this case must exercise the row menu.
          await p.locator('[role="menuitem"]').filter({ hasText: /Archive/ }).first().waitFor({ state: 'visible' });
        }
        if (action === 'voice') {
          // Archive with a reply recording active; never send audio or create a run.
          const result = await p.evaluate(() => {
            const w = Object.values(__wux.wins).find(w => w.thread === 'qa-thread');
            return __wux.recordReply(w.id, w.thread);
          });
          assert.equal(result, 'recording', stem + ': reply recording must actually start');
        }
        await p.evaluate(() => {
          window.archiveFrames = [];
          window.archiveSampling = true;
          // Include ancestor display/visibility/opacity and viewport clipping, not
          // just the child's box (a hidden .pane-main leaves child boxes behind).
          const visible = n => {
            if (!n || !n.isConnected) return false;
            const r = n.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
            for (let a = n; a; a = a.parentElement) {
              const s = getComputedStyle(a);
              if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
              if (a !== n && /(hidden|clip|auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY)) {
                const b = a.getBoundingClientRect();
                if (r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom) return false;
              }
            }
            return true;
          };
          function sample(t) {
            const panes = [...document.querySelectorAll('#stage > .wsp[data-aad-role="chat"]')].map(pane => {
              const body = pane.querySelector('.pane-main'), messages = body?.querySelector('.ch-msgs');
              const answer = messages && [...messages.querySelectorAll('*')].find(n => n.textContent === 'Synthetic answer remains visible');
              return { paneVisible: visible(pane), messagesVisible: visible(messages), answerPresent: !!answer, answerVisible: visible(answer), composerVisible: visible(body?.querySelector('.ch-compose')), text: body?.innerText?.slice(0, 500) };
            });
            archiveFrames.push({ t, panes });
            if (archiveSampling) requestAnimationFrame(sample);
          }
          // Installed before dispatch so the first post-action paint cannot escape.
          requestAnimationFrame(sample);
        });
        if (action === 'row') {
          await p.locator('[role="menuitem"]').filter({ hasText: /Archive/ }).first().click();
        } else {
          await p.evaluate(() => {
            const w = Object.values(__wux.wins).find(w => w.thread === 'qa-thread');
            return __wux.chats.threadAct(w.id, 'qa-thread', 'done');
          });
        }
        for (let i = 0; i < 24; i++) {
          await p.screenshot({ path: path.join(out, stem + '-' + String(i).padStart(3, '0') + '.png') });
          await p.waitForTimeout(16);
        }
        const frames = await p.evaluate(() => { archiveSampling = false; return archiveFrames; });
        // Desktop Archive opens the next chat, or the list when none is left (James, 7 Nov 2026). This fixture has one
        // thread, so the pane may close on the action's own frame: then there is no chat pane left to sample.
        const leftForList = await p.evaluate(() => !Object.values(__wux.wins).some(w => w.thread === 'qa-thread'));
        const invalid = frames.flatMap((f, frame) => f.panes.flatMap((pane, index) => pane.paneVisible && !(pane.messagesVisible && pane.answerPresent && pane.answerVisible && pane.composerVisible) ? [{ frame, index, ...pane }] : []));
        const checks = [];
        const check = (ok, message) => { if (!ok) checks.push(stem + ': ' + message); };
        check(frames.length > 0, 'no animation frames sampled');
        check(leftForList || frames.some(f => f.panes.some(p => p.paneVisible)), 'no visible chat pane sampled and the thread is still open');
        check(invalid.length === 0, `header-only/empty chat pane in ${invalid.length} sampled frames; first=${JSON.stringify(invalid[0])}`);
        check(writes.some(w => w.method === 'PATCH' && w.path === '/wizard/hermes/api/sessions/qa-thread' && JSON.parse(w.body).archived === true), 'Archive action was not dispatched');
        check(writes.every(w => (w.method === 'PUT' && w.path === '/wizard/thread-seen') || (w.method === 'PATCH' && w.path === '/wizard/hermes/api/sessions/qa-thread' && JSON.parse(w.body).archived === true)), 'unexpected synthetic mutation (send/preferences/upload)');
        check(blocked.length === 0, 'attempted /v1/runs');
        check(errors.length === 0, 'browser errors: ' + errors.join('; '));
        report.cases.push({ skin, action, frames, invalid, errors, blocked, writes, failures: checks });
        failures.push(...checks);
        if (action === 'voice') await p.evaluate(() => __wux.talk('cancel'));
      } finally {
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await c.close();
      }
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ ref: report.ref, cases: report.cases.map(x => ({ skin: x.skin, action: x.action, frames: x.frames.length, invalidFrames: x.invalid.length, errors: x.errors, blocked: x.blocked, failures: x.failures })) }, null, 2));
  assert.equal(report.cases.length, 6, 'all actions must run on both skins');
  assert.deepEqual(failures, [], 'Archive must never leave a visible header-only chat pane');
})().catch(e => { console.error(e); process.exitCode = 1; });
